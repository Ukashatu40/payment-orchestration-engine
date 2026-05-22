// src/modules/gateways/router/gateway-router.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { GatewayAdapterRegistry } from '../adapters/gateway-adapter.registry';
import { CircuitBreakerService } from '../circuit-breaker/circuit-breaker.service';
import { GatewayHealthService } from '../health/gateway-health.service';
import { GatewayConfigRepository } from '../repositories/gateway-config.repository';
import { GatewayRoute } from '../entities/gateway-route.entity';
import { RoutingConfig } from '../entities/routing-config.entity';
import { GatewayScore, RoutingResult } from './interfaces/routing-result.interface';
import { CircuitBreakerState } from '../circuit-breaker/circuit-breaker-state.enum';
import { PaymentGateway, PaymentMethod } from '../../../common/enums';
import { NoGatewayAvailableException } from '../../../common/exceptions';

@Injectable()
export class GatewayRouterService {
  private readonly logger = new Logger(GatewayRouterService.name);

  constructor(
    private readonly registry: GatewayAdapterRegistry,
    private readonly circuitBreaker: CircuitBreakerService,
    private readonly healthService: GatewayHealthService,
    private readonly gatewayConfigRepo: GatewayConfigRepository,
    private readonly dataSource: DataSource,
  ) {}

  // ----------------------------------------------------------------
  // Primary method — selects the best gateway for a transaction.
  // Records all scores to gateway_routes for auditability.
  // Satisfies Section A3.1, A3.2, A3.3.
  // ----------------------------------------------------------------
  async selectGateway(
    transactionId: string,
    paymentMethod: PaymentMethod,
    traceId: string,
  ): Promise<PaymentGateway> {
    // Step 1: Load routing weights from DB (not hardcoded — Section A3.1)
    const config = await this.loadRoutingConfig();

    // Step 2: Get sliding window metrics for all gateways
    const metrics = await this.healthService.getSlidingWindowMetrics(config.slidingWindowMinutes);

    const metricsMap = new Map(metrics.map((m) => [m.gateway, m]));

    // Step 3: Load cost config for all gateways
    const enabledConfigs = await this.gatewayConfigRepo.findEnabledForMethod(paymentMethod);

    if (enabledConfigs.length === 0) {
      throw new NoGatewayAvailableException(paymentMethod);
    }

    // Step 4: Get cost bounds for normalisation (Deliberate Error 2 fix)
    // Handle edge case where min === max to avoid division by zero
    const costs = enabledConfigs.map(
      (c) => Number(c.costPercentage) + Number(c.costFixedPaise) / 100_000,
    );
    const minCost = Math.min(...costs);
    const maxCost = Math.max(...costs);
    const costRange = maxCost - minCost || 1; // avoid division by zero

    // Get latency bounds
    const latencies = enabledConfigs
      .map((c) => metricsMap.get(c.gateway)?.p95LatencyMs ?? 0)
      .filter((l) => l > 0);
    const minLatency = latencies.length > 0 ? Math.min(...latencies) : 0;
    const maxLatency = latencies.length > 0 ? Math.max(...latencies) : 1;
    const latencyRange = maxLatency - minLatency || 1; // avoid division by zero

    // Step 5: Score every eligible gateway
    const scores: GatewayScore[] = [];

    for (const gwConfig of enabledConfigs) {
      const gateway = gwConfig.gateway;
      const m = metricsMap.get(gateway);

      const cbState = this.circuitBreaker.getState(gateway, paymentMethod);
      if (cbState === CircuitBreakerState.OPEN) {
        this.logger.debug(`Excluding ${gateway} — circuit breaker OPEN`);
        continue;
      }

      // Success rate score — higher is better
      const successRate = m ? m.successRate : 0.95; // default for new gateways with no history
      const scoreSuccess = successRate;

      // Latency score — lower latency = higher score
      // Correctly inverted: gateway AT minLatency scores 1.0,
      // gateway AT maxLatency scores 0.0 (Deliberate Error 2 fix)
      const p95 = m?.p95LatencyMs ?? maxLatency;
      const normalisedLatency = (p95 - minLatency) / latencyRange;
      const scoreLatency = 1 - normalisedLatency;

      // Cost score — lower cost = higher score
      const gatewayCost =
        Number(gwConfig.costPercentage) + Number(gwConfig.costFixedPaise) / 100_000;
      const normalisedCost = (gatewayCost - minCost) / costRange;
      const scoreCost = 1 - normalisedCost;

      // Health score from circuit breaker (1.0 / 0.5 / 0.0)
      const scoreHealth = this.circuitBreaker.getHealthScore(gateway, paymentMethod);

      // Fit score — 1.0 if gateway supports this payment method
      const scoreFit = gwConfig.supportedMethods.includes(paymentMethod) ? 1.0 : 0.0;

      // Skip gateways that don't support this method at all
      if (scoreFit === 0.0) continue;

      // Composite score (Section A3.2)
      const compositeScore =
        config.weightSuccessRate * scoreSuccess +
        config.weightLatency * scoreLatency +
        config.weightCost * scoreCost +
        config.weightHealth * scoreHealth +
        config.weightFit * scoreFit;

      scores.push({
        gateway,
        compositeScore,
        scoreSuccess,
        scoreLatency,
        scoreCost,
        scoreHealth,
        scoreFit,
        successRate,
        p95LatencyMs: p95,
        selectionReason: '',
      });
    }

    if (scores.length === 0) {
      throw new NoGatewayAvailableException(paymentMethod);
    }

    // Step 6: Sort by composite score descending
    scores.sort((a, b) => b.compositeScore - a.compositeScore);

    // Step 7: Apply degraded gateway skip logic (Section A3.2)
    // If the top scorer is HALF_OPEN and the second scorer is within
    // the degraded skip threshold, prefer the second scorer.
    let selected = scores[0];

    if (
      scores.length > 1 &&
      this.circuitBreaker.getState(selected.gateway, paymentMethod) ===
        CircuitBreakerState.HALF_OPEN
    ) {
      const secondBest = scores[1];
      const scoreDiff = selected.compositeScore - secondBest.compositeScore;

      if (scoreDiff <= config.degradedSkipThreshold) {
        selected = secondBest;
        selected.selectionReason = 'Preferred over degraded top-scorer (within threshold)';
      } else {
        selected.selectionReason = 'Selected despite HALF_OPEN (score gap exceeds threshold)';
      }
    } else {
      selected.selectionReason = 'Highest composite score';
    }

    // Step 8: Record all scores to gateway_routes for audit
    await this.recordRoutingDecision(transactionId, scores, selected);

    this.logger.log('Gateway selected', {
      transactionId,
      gateway: selected.gateway,
      score: selected.compositeScore,
      traceId,
    });

    return selected.gateway;
  }

  // ----------------------------------------------------------------
  // Records the routing decision to gateway_routes table.
  // Every scored gateway gets a row — not just the winner.
  // This enables post-hoc analysis of routing decisions.
  // ----------------------------------------------------------------
  private async recordRoutingDecision(
    transactionId: string,
    allScores: GatewayScore[],
    selected: GatewayScore,
  ): Promise<void> {
    const repo = this.dataSource.getRepository(GatewayRoute);

    const entries = allScores.map((score) =>
      repo.create({
        transactionId,
        gateway: score.gateway,
        compositeScore: score.compositeScore,
        scoreSuccess: score.scoreSuccess,
        scoreLatency: score.scoreLatency,
        scoreCost: score.scoreCost,
        scoreHealth: score.scoreHealth,
        scoreFit: score.scoreFit,
        successRate: score.successRate,
        p95LatencyMs: score.p95LatencyMs,
        selectionReason: score.selectionReason,
        wasSelected: score.gateway === selected.gateway,
      }),
    );

    await repo.save(entries);
  }

  private async loadRoutingConfig(): Promise<RoutingConfig> {
    const config = await this.dataSource
      .getRepository(RoutingConfig)
      .findOne({ where: { configKey: 'default' } });

    if (!config) {
      // Return safe defaults if config row missing
      return {
        configKey: 'default',
        weightSuccessRate: 0.35,
        weightLatency: 0.2,
        weightCost: 0.2,
        weightHealth: 0.15,
        weightFit: 0.1,
        slidingWindowMinutes: 10,
        degradedSkipThreshold: 0.2,
        updatedAt: new Date(),
      };
    }

    return config;
  }
}

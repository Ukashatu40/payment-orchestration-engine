// src/modules/gateways/circuit-breaker/circuit-breaker.service.ts

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CircuitBreakerState } from './circuit-breaker-state.enum';
import { CircuitBreakerEntry } from './circuit-breaker-store.interface';
import { GatewayConfigRepository } from '../repositories/gateway-config.repository';
import { PaymentGateway, PaymentMethod } from '../../../common/enums';
import { GatewayUnavailableException } from '../../../common/exceptions';

@Injectable()
export class CircuitBreakerService implements OnModuleInit {
  private readonly logger = new Logger(CircuitBreakerService.name);

  // In-memory store — keyed by `${gateway}:${paymentMethod ?? 'ALL'}`
  // Circuit breaker is per-gateway AND per-payment-method (Section A3.3)
  private readonly store = new Map<string, CircuitBreakerEntry>();

  // Loaded from gateway_config table on startup
  private configs = new Map<
    PaymentGateway,
    { failureThreshold: number; timeoutMs: number; halfOpenRequests: number }
  >();

  constructor(private readonly gatewayConfigRepo: GatewayConfigRepository) {}

  async onModuleInit(): Promise<void> {
    await this.loadConfigs();
  }

  // ----------------------------------------------------------------
  // Called by GatewayRouterService before routing a transaction.
  // Throws GatewayUnavailableException if the circuit is OPEN.
  // ----------------------------------------------------------------
  async guardRequest(
    gateway: PaymentGateway,
    paymentMethod: PaymentMethod,
  ): Promise<void> {
    const entry = this.getOrCreateEntry(gateway, paymentMethod);
    const config = this.getConfig(gateway);

    switch (entry.state) {
      case CircuitBreakerState.CLOSED:
        // Normal — allow request through
        return;

      case CircuitBreakerState.OPEN: {
        // Check if timeout has elapsed — if so, move to HALF_OPEN
        const elapsed = Date.now() - (entry.openedAt?.getTime() ?? 0);
        if (elapsed >= config.timeoutMs) {
          this.transitionTo(entry, CircuitBreakerState.HALF_OPEN);
          this.logger.log(`Circuit HALF_OPEN for ${gateway}`, {
            gateway,
            paymentMethod,
          });
          // Allow this single probe request through
          return;
        }

        // Still within timeout window — fail fast (FS-01, FS-07)
        throw new GatewayUnavailableException(
          gateway,
          `Circuit breaker OPEN. Resets in ${Math.ceil(
            (config.timeoutMs - elapsed) / 1000,
          )}s`,
        );
      }

      case CircuitBreakerState.HALF_OPEN:
        // Allow single probe through — subsequent requests blocked
        if (entry.successCountInHalfOpen > 0) {
          throw new GatewayUnavailableException(
            gateway,
            'Circuit breaker HALF_OPEN — probe already in flight',
          );
        }
        return;
    }
  }

  // ----------------------------------------------------------------
  // Called after a successful gateway response.
  // ----------------------------------------------------------------
  recordSuccess(gateway: PaymentGateway, paymentMethod: PaymentMethod): void {
    const entry = this.getOrCreateEntry(gateway, paymentMethod);

    if (entry.state === CircuitBreakerState.HALF_OPEN) {
      // Probe succeeded — close the circuit
      entry.successCountInHalfOpen += 1;
      const config = this.getConfig(gateway);

      if (entry.successCountInHalfOpen >= config.halfOpenRequests) {
        this.transitionTo(entry, CircuitBreakerState.CLOSED);
        this.logger.log(`Circuit CLOSED for ${gateway}`, {
          gateway,
          paymentMethod,
        });
      }
      return;
    }

    // Reset failure count on success in CLOSED state
    if (entry.state === CircuitBreakerState.CLOSED) {
      entry.failureCount = 0;
    }
  }

  // ----------------------------------------------------------------
  // Called after any gateway failure (timeout, 5xx, unavailable).
  // ----------------------------------------------------------------
  recordFailure(gateway: PaymentGateway, paymentMethod: PaymentMethod): void {
    const entry = this.getOrCreateEntry(gateway, paymentMethod);
    const config = this.getConfig(gateway);

    entry.failureCount += 1;
    entry.lastFailureAt = new Date();

    if (entry.state === CircuitBreakerState.HALF_OPEN) {
      // Probe failed — re-open the circuit and reset timeout
      this.transitionTo(entry, CircuitBreakerState.OPEN);
      this.logger.warn(`Circuit re-OPEN for ${gateway} (probe failed)`, {
        gateway,
        paymentMethod,
      });
      return;
    }

    if (
      entry.state === CircuitBreakerState.CLOSED &&
      entry.failureCount >= config.failureThreshold
    ) {
      // Threshold exceeded — trip the circuit
      this.transitionTo(entry, CircuitBreakerState.OPEN);
      this.logger.warn(
        `Circuit OPEN for ${gateway} after ${entry.failureCount} failures`,
        { gateway, paymentMethod },
      );
    }
  }

  // ----------------------------------------------------------------
  // Read-only helpers — used by GatewayRouterService for scoring
  // ----------------------------------------------------------------
  getState(
    gateway: PaymentGateway,
    paymentMethod: PaymentMethod,
  ): CircuitBreakerState {
    return this.getOrCreateEntry(gateway, paymentMethod).state;
  }

  // Returns health score for routing algorithm (Section A3.1)
  // 1.0 = CLOSED (healthy), 0.5 = HALF_OPEN (degraded), 0.0 = OPEN (down)
  getHealthScore(
    gateway: PaymentGateway,
    paymentMethod: PaymentMethod,
  ): number {
    const state = this.getState(gateway, paymentMethod);
    switch (state) {
      case CircuitBreakerState.CLOSED:
        return 1.0;
      case CircuitBreakerState.HALF_OPEN:
        return 0.5;
      case CircuitBreakerState.OPEN:
        return 0.0;
    }
  }

  getAllStates(): CircuitBreakerEntry[] {
    return Array.from(this.store.values());
  }

  // ----------------------------------------------------------------
  // Internal helpers
  // ----------------------------------------------------------------
  private getOrCreateEntry(
    gateway: PaymentGateway,
    paymentMethod: PaymentMethod,
  ): CircuitBreakerEntry {
    const key = `${gateway}:${paymentMethod}`;

    if (!this.store.has(key)) {
      this.store.set(key, {
        gateway,
        paymentMethod,
        state: CircuitBreakerState.CLOSED,
        failureCount: 0,
        lastFailureAt: null,
        openedAt: null,
        halfOpenAt: null,
        successCountInHalfOpen: 0,
      });
    }

    return this.store.get(key)!;
  }

  private transitionTo(
    entry: CircuitBreakerEntry,
    newState: CircuitBreakerState,
  ): void {
    entry.state = newState;

    if (newState === CircuitBreakerState.OPEN) {
      entry.openedAt = new Date();
      entry.successCountInHalfOpen = 0;
    }

    if (newState === CircuitBreakerState.HALF_OPEN) {
      entry.halfOpenAt = new Date();
      entry.successCountInHalfOpen = 0;
    }

    if (newState === CircuitBreakerState.CLOSED) {
      entry.failureCount = 0;
      entry.openedAt = null;
      entry.halfOpenAt = null;
      entry.successCountInHalfOpen = 0;
    }
  }

  private getConfig(gateway: PaymentGateway) {
    return (
      this.configs.get(gateway) ?? {
        failureThreshold: 5,
        timeoutMs: 30_000,
        halfOpenRequests: 1,
      }
    );
  }

  // Loads circuit breaker config from gateway_config table.
  // Called on startup and can be called again after a config update
  // to pick up changes without redeployment (Section A3.3).
  async loadConfigs(): Promise<void> {
    const configs = await this.gatewayConfigRepo.findAll();

    for (const config of configs) {
      this.configs.set(config.gateway, {
        failureThreshold: config.cbFailureThreshold,
        timeoutMs: config.cbTimeoutMs,
        halfOpenRequests: config.cbHalfOpenRequests,
      });
    }

    this.logger.log('Circuit breaker configs loaded', {
      gateways: configs.map((c) => c.gateway),
    });
  }
}

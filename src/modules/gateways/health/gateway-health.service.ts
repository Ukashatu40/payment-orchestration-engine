// src/modules/gateways/health/gateway-health.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { GatewayHealthMetrics } from '../entities/gateway-health-metrics.entity';
import { PaymentGateway, PaymentMethod } from '../../../common/enums';

export interface SlidingWindowMetrics {
  gateway: PaymentGateway;
  successRate: number; // 0.0 – 1.0
  p95LatencyMs: number;
  totalCount: number;
}

export interface LatencySample {
  gateway: PaymentGateway;
  paymentMethod: PaymentMethod;
  latencyMs: number;
  success: boolean;
}

@Injectable()
export class GatewayHealthService {
  private readonly logger = new Logger(GatewayHealthService.name);

  // In-memory buffer for the current minute's samples.
  // Flushed to DB every minute by a scheduled task.
  private readonly buffer = new Map<string, LatencySample[]>();

  constructor(private readonly dataSource: DataSource) {}

  // ----------------------------------------------------------------
  // Called by gateway adapters after every request completes.
  // Records the result for the current minute's aggregate.
  // ----------------------------------------------------------------
  record(sample: LatencySample): void {
    const key = `${sample.gateway}:${sample.paymentMethod}`;

    if (!this.buffer.has(key)) {
      this.buffer.set(key, []);
    }

    this.buffer.get(key)!.push(sample);
  }

  // ----------------------------------------------------------------
  // Flushes the current buffer to the database.
  // Called every minute by a scheduled task (Level 13).
  // ----------------------------------------------------------------
  async flush(): Promise<void> {
    if (this.buffer.size === 0) return;

    const repo = this.dataSource.getRepository(GatewayHealthMetrics);
    const now = new Date();
    const entries: Partial<GatewayHealthMetrics>[] = [];

    for (const [key, samples] of this.buffer.entries()) {
      if (samples.length === 0) continue;

      const [gateway, paymentMethod] = key.split(':') as [
        PaymentGateway,
        PaymentMethod,
      ];

      const successCount = samples.filter((s) => s.success).length;
      const latencies = samples.map((s) => s.latencyMs).sort((a, b) => a - b);

      const p95Index = Math.floor(latencies.length * 0.95);
      const p95LatencyMs = latencies[p95Index] ?? latencies.at(-1) ?? 0;
      const avgLatencyMs = Math.round(
        latencies.reduce((sum, l) => sum + l, 0) / latencies.length,
      );

      entries.push({
        gateway,
        paymentMethod,
        successCount,
        totalCount: samples.length,
        p95LatencyMs,
        avgLatencyMs,
        recordedAt: now,
      });
    }

    if (entries.length > 0) {
      await repo.save(entries);
      this.logger.debug(`Flushed ${entries.length} health metric entries`);
    }

    this.buffer.clear();
  }

  // ----------------------------------------------------------------
  // Sliding window query — used by GatewayRouterService for scoring.
  // Returns aggregated metrics across the last N minutes.
  // Satisfies Section A3.1 — per-minute sliding window.
  // ----------------------------------------------------------------
  async getSlidingWindowMetrics(
    windowMinutes: number,
  ): Promise<SlidingWindowMetrics[]> {
    const since = new Date(Date.now() - windowMinutes * 60 * 1000);

    const rows = await this.dataSource
      .getRepository(GatewayHealthMetrics)
      .createQueryBuilder('ghm')
      .select('ghm.gateway', 'gateway')
      .addSelect('SUM(ghm.successCount)', 'totalSuccess')
      .addSelect('SUM(ghm.totalCount)', 'totalCount')
      .addSelect('MAX(ghm.p95LatencyMs)', 'p95LatencyMs')
      .where('ghm.recordedAt >= :since', { since })
      .groupBy('ghm.gateway')
      .getRawMany();

    return rows.map((row) => ({
      gateway: row.gateway as PaymentGateway,
      successRate:
        row.totalCount > 0
          ? parseFloat(row.totalSuccess) / parseFloat(row.totalCount)
          : 0,
      p95LatencyMs: parseInt(row.p95LatencyMs, 10) || 0,
      totalCount: parseInt(row.totalCount, 10) || 0,
    }));
  }

  // ----------------------------------------------------------------
  // Returns min/max across all gateways for normalisation
  // in the routing scoring formula (Section A3.2).
  // ----------------------------------------------------------------
  async getNormalisationBounds(windowMinutes: number): Promise<{
    minLatency: number;
    maxLatency: number;
    minCost: number;
    maxCost: number;
  }> {
    const metrics = await this.getSlidingWindowMetrics(windowMinutes);

    const latencies = metrics.map((m) => m.p95LatencyMs).filter((l) => l > 0);

    return {
      minLatency: latencies.length > 0 ? Math.min(...latencies) : 0,
      maxLatency: latencies.length > 0 ? Math.max(...latencies) : 1,
      // Cost bounds loaded separately from gateway_config by the router
      minCost: 0,
      maxCost: 1,
    };
  }
}

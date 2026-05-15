// src/modules/reconciliation/reconciliation.scheduler.ts

import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ReconciliationService } from './reconciliation.service';
import { GatewayHealthService } from '../gateways/health/gateway-health.service';
import { IdempotencyService } from '../idempotency/idempotency.service';

@Injectable()
export class ReconciliationScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReconciliationScheduler.name);
  private readonly intervals: NodeJS.Timeout[] = [];

  constructor(
    private readonly reconciliationService: ReconciliationService,
    private readonly healthService: GatewayHealthService,
    private readonly idempotencyService: IdempotencyService,
  ) {}

  onModuleInit(): void {
    // Reconciliation — every 15 minutes (Section A5.5)
    this.intervals.push(
      setInterval(() => this.runReconciliation(), 15 * 60 * 1000),
    );

    // Health metrics flush — every 60 seconds (Section A3.1)
    this.intervals.push(
      setInterval(() => this.flushHealthMetrics(), 60 * 1000),
    );

    // Idempotency key cleanup — every 6 hours
    this.intervals.push(
      setInterval(() => this.purgeIdempotencyKeys(), 6 * 60 * 60 * 1000),
    );

    this.logger.log('Schedulers started', {
      reconciliation: '15 minutes',
      healthMetrics: '60 seconds',
      idempotencyCleanup: '6 hours',
    });
  }

  onModuleDestroy(): void {
    this.intervals.forEach(clearInterval);
    this.logger.log('Schedulers stopped');
  }

  private async runReconciliation(): Promise<void> {
    try {
      const result = await this.reconciliationService.run();
      this.logger.log('Scheduled reconciliation complete', {
        totalChecked: result.totalChecked,
        discrepanciesFound: result.discrepanciesFound,
        requiresReview: result.requiresReview,
      });
    } catch (err) {
      this.logger.error('Scheduled reconciliation failed', {
        error: (err as Error).message,
      });
    }
  }

  private async flushHealthMetrics(): Promise<void> {
    try {
      await this.healthService.flush();
    } catch (err) {
      this.logger.error('Health metrics flush failed', {
        error: (err as Error).message,
      });
    }
  }

  private async purgeIdempotencyKeys(): Promise<void> {
    try {
      const count = await this.idempotencyService.purgeExpired();
      if (count > 0) {
        this.logger.log(`Purged ${count} expired idempotency keys`);
      }
    } catch (err) {
      this.logger.error('Idempotency key purge failed', {
        error: (err as Error).message,
      });
    }
  }
}

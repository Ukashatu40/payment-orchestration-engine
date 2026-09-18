// src/modules/reconciliation/reconciliation.module.ts

import { Module } from '@nestjs/common';
import { ReconciliationService } from './reconciliation.service';
import { ReconciliationController } from './reconciliation.controller';
import { ReconciliationScheduler } from './reconciliation.scheduler';
import { ReconciliationLogRepository } from './repositories/reconciliation-log.repository';
import { TransactionsModule } from '../transactions/transactions.module';
import { GatewaysModule } from '../gateways/gateways.module';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [TransactionsModule, GatewaysModule, IdempotencyModule, UsersModule],
  providers: [ReconciliationService, ReconciliationScheduler, ReconciliationLogRepository],
  controllers: [ReconciliationController],
  exports: [ReconciliationService],
})
export class ReconciliationModule {}

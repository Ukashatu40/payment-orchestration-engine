// src/modules/transactions/transactions.module.ts

import { Module } from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { TransactionsController } from './transactions.controller';
import { TransactionRepository } from './repositories/transaction.repository';
import { TransactionStateLogRepository } from './repositories/transaction-state-log.repository';
import { TransactionStateMachineService } from './state-machine/transaction-state-machine.service';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { GatewaysModule } from '../gateways/gateways.module';

@Module({
  imports: [IdempotencyModule, GatewaysModule],
  providers: [
    TransactionsService,
    TransactionStateMachineService,
    TransactionRepository,
    TransactionStateLogRepository,
  ],
  controllers: [TransactionsController],
  exports: [
    TransactionsService,
    TransactionStateMachineService,
    TransactionRepository,
    TransactionStateLogRepository,
  ],
})
export class TransactionsModule {}

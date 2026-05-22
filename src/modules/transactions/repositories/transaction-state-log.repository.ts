// src/modules/transactions/repositories/transaction-state-log.repository.ts

import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { TransactionStateLog } from '../entities/transaction-state-log.entity';

@Injectable()
export class TransactionStateLogRepository {
  private readonly repo: Repository<TransactionStateLog>;

  constructor(private readonly dataSource: DataSource) {
    this.repo = this.dataSource.getRepository(TransactionStateLog);
  }

  // Append only — no update, no delete methods exist on this class
  async append(data: Partial<TransactionStateLog>): Promise<TransactionStateLog> {
    const entry = this.repo.create(data);
    return this.repo.save(entry);
  }

  async findByTransactionId(transactionId: string): Promise<TransactionStateLog[]> {
    return this.repo.find({
      where: { transactionId },
      order: { createdAt: 'ASC' },
    });
  }

  async findByTraceId(traceId: string): Promise<TransactionStateLog[]> {
    return this.repo.find({
      where: { traceId },
      order: { createdAt: 'ASC' },
    });
  }
}

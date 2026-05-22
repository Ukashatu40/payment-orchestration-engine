// src/modules/transactions/repositories/refund.repository.ts

import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { Refund } from '../entities/refund.entity';

@Injectable()
export class RefundRepository {
  private readonly repo: Repository<Refund>;

  constructor(private readonly dataSource: DataSource) {
    this.repo = this.dataSource.getRepository(Refund);
  }

  async findByTransactionId(transactionId: string): Promise<Refund[]> {
    return this.repo.find({
      where: { transactionId },
      order: { createdAt: 'DESC' },
    });
  }

  async create(data: Partial<Refund>): Promise<Refund> {
    const refund = this.repo.create(data);
    return this.repo.save(refund);
  }
}

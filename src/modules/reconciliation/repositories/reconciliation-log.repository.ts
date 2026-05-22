// src/modules/reconciliation/repositories/reconciliation-log.repository.ts

import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { ReconciliationLog } from '../entities/reconciliation-log.entity';

@Injectable()
export class ReconciliationLogRepository {
  private readonly repo: Repository<ReconciliationLog>;

  constructor(private readonly dataSource: DataSource) {
    this.repo = this.dataSource.getRepository(ReconciliationLog);
  }

  async create(data: Partial<ReconciliationLog>): Promise<ReconciliationLog> {
    const entry = this.repo.create(data);
    return this.repo.save(entry);
  }

  async createMany(entries: Partial<ReconciliationLog>[]): Promise<ReconciliationLog[]> {
    const records = this.repo.create(entries);
    return this.repo.save(records);
  }

  async findByRunId(runId: string): Promise<ReconciliationLog[]> {
    return this.repo.find({
      where: { runId },
      order: { createdAt: 'ASC' },
    });
  }

  async findUnresolved(): Promise<ReconciliationLog[]> {
    return this.repo.find({
      where: { requiresReview: true, resolved: false },
      order: { createdAt: 'DESC' },
    });
  }

  async markResolved(id: string, notes: string): Promise<void> {
    await this.repo.update(id, { resolved: true, notes });
  }
}

// src/modules/idempotency/repositories/idempotency-key.repository.ts

import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { IdempotencyKey } from '../entities/idempotency-key.entity';

@Injectable()
export class IdempotencyKeyRepository {
  private readonly repo: Repository<IdempotencyKey>;

  constructor(private readonly dataSource: DataSource) {
    this.repo = this.dataSource.getRepository(IdempotencyKey);
  }

  // Must be called inside an EntityManager transaction
  // that also holds a pg_advisory_xact_lock (Section A8.2)
  async findByKey(
    merchantId: string,
    key: string,
    entityManager?: EntityManager,
  ): Promise<IdempotencyKey | null> {
    const repo = entityManager
      ? entityManager.getRepository(IdempotencyKey)
      : this.repo;

    return repo.findOne({ where: { merchantId, key } });
  }

  async insertProcessing(
    merchantId: string,
    key: string,
    requestHash: string,
    entityManager: EntityManager,
  ): Promise<IdempotencyKey | null> {
    const repo = entityManager.getRepository(IdempotencyKey);

    const result = await repo
      .createQueryBuilder()
      .insert()
      .into(IdempotencyKey)
      .values({ merchantId, key, requestHash, status: 'PROCESSING' })
      .orIgnore() // ON CONFLICT DO NOTHING
      .returning('*')
      .execute();

    if (!result.raw.length) return null;
    return result.raw[0] as IdempotencyKey;
  }

  async markCompleted(
    merchantId: string,
    key: string,
    responseCode: number,
    responseBody: Record<string, unknown>,
    transactionId: string,
  ): Promise<void> {
    await this.repo.update(
      { merchantId, key },
      {
        status: 'COMPLETED',
        responseCode,
        responseBody: responseBody as any,
        transactionId,
      },
    );
  }

  async markFailed(merchantId: string, key: string): Promise<void> {
    await this.repo.update({ merchantId, key }, { status: 'FAILED' });
  }

  // Cleanup job — runs on a schedule to remove expired keys
  async deleteExpired(): Promise<number> {
    const result = await this.repo
      .createQueryBuilder()
      .delete()
      .where('expires_at < NOW()')
      .andWhere("status != 'COMPLETED'")
      .execute();

    return result.affected ?? 0;
  }
}

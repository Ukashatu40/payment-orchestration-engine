// src/modules/transactions/repositories/transaction.repository.ts

import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Transaction } from '../entities/transaction.entity';
import { TransactionState, PaymentGateway, PaymentMethod } from '../../../common/enums';
import { RECONCILABLE_STATES } from '../state-machine/state-transitions.map';

@Injectable()
export class TransactionRepository {
  private readonly repo: Repository<Transaction>;

  constructor(private readonly dataSource: DataSource) {
    this.repo = this.dataSource.getRepository(Transaction);
  }

  // ----------------------------------------------------------------
  // Writes
  // ----------------------------------------------------------------
  async create(data: Partial<Transaction>): Promise<Transaction> {
    const transaction = this.repo.create(data);
    return this.repo.save(transaction);
  }

  // ----------------------------------------------------------------
  // Reads — no locking
  // ----------------------------------------------------------------
  async findById(id: string): Promise<Transaction | null> {
    return this.repo.findOne({ where: { id } });
  }

  async findByIdWithLogs(id: string): Promise<Transaction | null> {
    return this.repo
      .createQueryBuilder('txn')
      .leftJoinAndSelect('txn.stateLogs', 'log')
      .where('txn.id = :id', { id })
      .orderBy('log.createdAt', 'ASC')
      .getOne();
  }

  async findByMerchantOrderId(
    merchantId: string,
    merchantOrderId: string,
  ): Promise<Transaction | null> {
    return this.repo.findOne({
      where: { merchantId, merchantOrderId },
    });
  }

  async findByGatewayReference(
    gateway: PaymentGateway,
    gatewayReference: string,
  ): Promise<Transaction | null> {
    return this.repo.findOne({
      where: { gateway, gatewayReference },
    });
  }

  // ----------------------------------------------------------------
  // Paginated, filterable list — backs GET /payments (no filters).
  // merchantId is a hard filter, not optional-in-name-only: callers
  // (transactions.service.ts) are responsible for always supplying it
  // for merchant-scoped callers and omitting it only for internal
  // roles/API-key callers who are allowed to see across merchants.
  // ----------------------------------------------------------------
  async findPaginated(filters: {
    merchantId?: string;
    state?: TransactionState;
    gateway?: PaymentGateway;
    fromDate?: Date;
    toDate?: Date;
    page: number;
    pageSize: number;
  }): Promise<{ data: Transaction[]; total: number }> {
    const qb = this.repo.createQueryBuilder('txn');

    if (filters.merchantId) {
      qb.andWhere('txn.merchantId = :merchantId', { merchantId: filters.merchantId });
    }
    if (filters.state) {
      qb.andWhere('txn.state = :state', { state: filters.state });
    }
    if (filters.gateway) {
      qb.andWhere('txn.gateway = :gateway', { gateway: filters.gateway });
    }
    if (filters.fromDate) {
      qb.andWhere('txn.createdAt >= :fromDate', { fromDate: filters.fromDate });
    }
    if (filters.toDate) {
      qb.andWhere('txn.createdAt <= :toDate', { toDate: filters.toDate });
    }

    qb.orderBy('txn.createdAt', 'DESC')
      .skip((filters.page - 1) * filters.pageSize)
      .take(filters.pageSize);

    const [data, total] = await qb.getManyAndCount();
    return { data, total };
  }

  // ----------------------------------------------------------------
  // Pessimistic read lock — used by state machine before transition.
  // Caller must be inside an active EntityManager transaction.
  // Satisfies A8.1 — lock acquired before state validation.
  // ----------------------------------------------------------------
  async findByIdWithLock(id: string, entityManager: EntityManager): Promise<Transaction | null> {
    return entityManager
      .createQueryBuilder(Transaction, 'txn')
      .setLock('pessimistic_write')
      .where('txn.id = :id', { id })
      .getOne();
  }

  // ----------------------------------------------------------------
  // Reconciliation engine query (Section A5.5)
  // Finds transactions stuck in an in-progress state longer than
  // the given threshold — these need gateway status polling.
  // ----------------------------------------------------------------
  async findStaleTransactions(thresholdMinutes: number): Promise<Transaction[]> {
    const reconcilableStates = Array.from(RECONCILABLE_STATES);
    const threshold = new Date(Date.now() - thresholdMinutes * 60 * 1000);

    return this.repo
      .createQueryBuilder('txn')
      .where('txn.state IN (:...states)', { states: reconcilableStates })
      .andWhere('txn.updatedAt < :threshold', { threshold })
      .andWhere('txn.gatewayReference IS NOT NULL')
      .orderBy('txn.updatedAt', 'ASC')
      .getMany();
  }

  // ----------------------------------------------------------------
  // Analytics queries (Section A7.1 endpoints 21-22)
  // ----------------------------------------------------------------
  async getSuccessRateByGateway(
    fromDate: Date,
    toDate: Date,
    merchantId?: string,
  ): Promise<{ gateway: string; successRate: number; total: number }[]> {
    const qb = this.repo
      .createQueryBuilder('txn')
      .select('txn.gateway', 'gateway')
      .addSelect('COUNT(*)', 'total')
      .addSelect(
        `SUM(CASE WHEN txn.state = '${TransactionState.CAPTURED}' THEN 1 ELSE 0 END)`,
        'captured',
      )
      .where('txn.createdAt BETWEEN :fromDate AND :toDate', {
        fromDate,
        toDate,
      })
      .andWhere('txn.gateway IS NOT NULL')
      .groupBy('txn.gateway');

    if (merchantId) {
      qb.andWhere('txn.merchantId = :merchantId', { merchantId });
    }

    const result = await qb.getRawMany();

    return result.map((row) => ({
      gateway: row.gateway,
      total: parseInt(row.total, 10),
      successRate: row.total > 0 ? parseFloat(row.captured) / parseInt(row.total, 10) : 0,
    }));
  }

  async getVolumeByDay(
    fromDate: Date,
    toDate: Date,
    merchantId?: string,
  ): Promise<{ date: string; count: number; totalPaise: string }[]> {
    const qb = this.repo
      .createQueryBuilder('txn')
      .select('DATE(txn.createdAt)', 'date')
      .addSelect('COUNT(*)', 'count')
      .addSelect('SUM(txn.amountPaise)', 'totalPaise')
      .where('txn.createdAt BETWEEN :fromDate AND :toDate', {
        fromDate,
        toDate,
      })
      .groupBy('DATE(txn.createdAt)')
      .orderBy('DATE(txn.createdAt)', 'ASC');

    if (merchantId) {
      qb.andWhere('txn.merchantId = :merchantId', { merchantId });
    }

    return qb.getRawMany();
  }
}

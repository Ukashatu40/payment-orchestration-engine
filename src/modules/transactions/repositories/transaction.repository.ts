// src/modules/transactions/repositories/transaction.repository.ts

import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Transaction } from '../entities/transaction.entity';
import {
  TransactionState,
  PaymentGateway,
  PaymentMethod,
} from '../../../common/enums';
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
  // Pessimistic read lock — used by state machine before transition.
  // Caller must be inside an active EntityManager transaction.
  // Satisfies A8.1 — lock acquired before state validation.
  // ----------------------------------------------------------------
  async findByIdWithLock(
    id: string,
    entityManager: EntityManager,
  ): Promise<Transaction | null> {
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
  async findStaleTransactions(
    thresholdMinutes: number,
  ): Promise<Transaction[]> {
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
  ): Promise<{ gateway: string; successRate: number; total: number }[]> {
    const result = await this.repo
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
      .groupBy('txn.gateway')
      .getRawMany();

    return result.map((row) => ({
      gateway: row.gateway,
      total: parseInt(row.total, 10),
      successRate:
        row.total > 0 ? parseFloat(row.captured) / parseInt(row.total, 10) : 0,
    }));
  }

  async getVolumeByDay(
    fromDate: Date,
    toDate: Date,
  ): Promise<{ date: string; count: number; totalPaise: string }[]> {
    return this.repo
      .createQueryBuilder('txn')
      .select('DATE(txn.createdAt)', 'date')
      .addSelect('COUNT(*)', 'count')
      .addSelect('SUM(txn.amountPaise)', 'totalPaise')
      .where('txn.createdAt BETWEEN :fromDate AND :toDate', {
        fromDate,
        toDate,
      })
      .groupBy('DATE(txn.createdAt)')
      .orderBy('DATE(txn.createdAt)', 'ASC')
      .getRawMany();
  }
}

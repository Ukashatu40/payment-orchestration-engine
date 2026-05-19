// src/modules/transactions/entities/transaction-state-log.entity.ts

import {
  Entity,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  PrimaryGeneratedColumn,
  Index,
} from 'typeorm';
import { Transaction } from './transaction.entity';
import { TransactionState } from '../../../common/enums';

// No BaseEntity extension — this table has NO updatedAt by design.
// Audit logs are append-only. The DB rule + NestJS entity enforce this.
@Entity('transaction_state_log')
@Index(['transactionId', 'createdAt'])
@Index(['traceId'])
export class TransactionStateLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'transaction_id', type: 'uuid' })
  @Index()
  transactionId!: string;

  @ManyToOne(() => Transaction, (txn) => txn.stateLogs, {
    onDelete: 'RESTRICT', // never delete parent if logs exist
    nullable: false,
  })
  @JoinColumn({ name: 'transaction_id' })
  transaction!: Transaction;

  @Column({
    name: 'from_state',
    type: 'enum',
    enum: TransactionState,
  })
  fromState!: TransactionState;

  @Column({
    name: 'to_state',
    type: 'enum',
    enum: TransactionState,
  })
  toState!: TransactionState;

  @Column({ name: 'event', type: 'varchar', length: 100 })
  event!: string;

  // Who or what triggered this transition
  // e.g. 'api_server' | 'webhook_processor' | 'reconciliation_engine'
  @Column({ name: 'triggered_by', type: 'varchar', length: 100 })
  triggeredBy!: string;

  @Column({
    name: 'trace_id',
    type: 'uuid',
    default: () => 'gen_random_uuid()', // DB-level fallback
  })
  traceId!: string;

  @Column({
    name: 'gateway_reference',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  gatewayReference!: string | null;

  // PII redacted before storage (Section A2.3)
  @Column({
    name: 'gateway_response',
    type: 'jsonb',
    nullable: true,
  })
  gatewayResponse!: Record<string, unknown> | null;

  @Column({
    name: 'metadata',
    type: 'jsonb',
    default: {},
  })
  metadata!: Record<string, unknown>;

  // Only createdAt — no updatedAt. This column is immutable.
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

// src/modules/transactions/entities/refund.entity.ts

import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Transaction } from './transaction.entity';
import { PaymentGateway } from '../../../common/enums';
import { RefundState } from '../../../common/enums';

@Entity('refunds')
@Index(['transactionId'])
@Index(['gateway', 'gatewayRefundId'])
export class Refund {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'transaction_id', type: 'uuid' })
  transactionId!: string;

  @ManyToOne(() => Transaction, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'transaction_id' })
  transaction!: Transaction;

  // ----------------------------------------------------------------
  // Financial amount — BIGINT paise (ADR-002)
  // ----------------------------------------------------------------
  @Column({ name: 'amount_paise', type: 'bigint' })
  amountPaise!: bigint;

  @Column({ name: 'currency', type: 'char', length: 3, default: 'INR' })
  currency!: string;

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------
  @Column({
    name: 'state',
    type: 'enum',
    enum: RefundState,
    default: RefundState.INITIATED,
  })
  state!: RefundState;

  // ----------------------------------------------------------------
  // Gateway fields
  // ----------------------------------------------------------------
  @Column({
    name: 'gateway',
    type: 'enum',
    enum: PaymentGateway,
  })
  gateway!: PaymentGateway;

  @Column({
    name: 'gateway_refund_id',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  gatewayRefundId!: string | null;

  // ----------------------------------------------------------------
  // Audit context
  // ----------------------------------------------------------------
  @Column({ name: 'initiated_by', type: 'varchar', length: 100 })
  initiatedBy!: string;

  @Column({ name: 'reason', type: 'text', nullable: true })
  reason!: string | null;

  // Idempotency for refund requests — prevents duplicate refunds
  @Column({
    name: 'idempotency_key',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  @Index({ unique: true, sparse: true })
  idempotencyKey!: string | null;

  @Column({ name: 'failure_reason', type: 'text', nullable: true })
  failureReason!: string | null;

  @Column({ name: 'metadata', type: 'jsonb', default: {} })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  // ----------------------------------------------------------------
  // Computed helper — display only, never used in DB operations
  // ----------------------------------------------------------------
  get amountRupees(): number {
    return Number(this.amountPaise) / 100;
  }
}

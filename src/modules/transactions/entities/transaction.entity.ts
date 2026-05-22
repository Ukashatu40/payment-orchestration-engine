// src/modules/transactions/entities/transaction.entity.ts

import { Entity, Column, Index, OneToMany, VersionColumn } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { TransactionState, PaymentGateway, PaymentMethod } from '../../../common/enums';

@Entity('transactions')
@Index(['merchantId', 'idempotencyKey'], { unique: true })
@Index(['merchantId', 'merchantOrderId'], { unique: true })
export class Transaction extends BaseEntity {
  @Column({ name: 'merchant_id', type: 'uuid' })
  merchantId!: string;

  @Column({ name: 'merchant_order_id', type: 'varchar', length: 255 })
  merchantOrderId!: string;

  // ----------------------------------------------------------------
  // Financial amounts — all stored as BIGINT paise (ADR-002)
  // NEVER use number type here — TypeScript bigint enforces this
  // ----------------------------------------------------------------
  @Column({ name: 'amount_paise', type: 'bigint' })
  amountPaise!: bigint;

  @Column({ name: 'captured_paise', type: 'bigint', default: 0 })
  capturedPaise!: bigint;

  @Column({ name: 'refunded_paise', type: 'bigint', default: 0 })
  refundedPaise!: bigint;

  @Column({ name: 'currency', type: 'char', length: 3, default: 'INR' })
  currency!: string;

  // ----------------------------------------------------------------
  // State machine fields
  // ----------------------------------------------------------------
  @Column({
    name: 'state',
    type: 'enum',
    enum: TransactionState,
    default: TransactionState.CREATED,
  })
  state!: TransactionState;

  @Column({
    name: 'payment_method',
    type: 'enum',
    enum: PaymentMethod,
  })
  paymentMethod!: PaymentMethod;

  @Column({
    name: 'gateway',
    type: 'enum',
    enum: PaymentGateway,
    nullable: true,
  })
  gateway!: PaymentGateway | null;

  // ----------------------------------------------------------------
  // Gateway reference IDs
  // ----------------------------------------------------------------
  @Column({
    name: 'gateway_order_id',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  gatewayOrderId!: string | null;

  @Column({
    name: 'gateway_payment_id',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  gatewayPaymentId!: string | null;

  @Column({
    name: 'gateway_reference',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  gatewayReference!: string | null;

  // ----------------------------------------------------------------
  // Optimistic lock version (A8.1 — used for non-critical reads)
  // ----------------------------------------------------------------
  @VersionColumn({ name: 'version' })
  version!: number;

  // ----------------------------------------------------------------
  // Distributed tracing (Section A8.5)
  // ----------------------------------------------------------------
  @Column({
    name: 'trace_id',
    type: 'uuid',
    generated: 'uuid',
  })
  traceId!: string;

  // ----------------------------------------------------------------
  // Idempotency — scoped to merchant (FS-13)
  // ----------------------------------------------------------------
  @Column({
    name: 'idempotency_key',
    type: 'varchar',
    length: 255,
  })
  idempotencyKey!: string;

  // ----------------------------------------------------------------
  // Auth hold expiry — for UPI mandate window and gateway holds
  // ----------------------------------------------------------------
  @Column({
    name: 'auth_expires_at',
    type: 'timestamptz',
    nullable: true,
  })
  authExpiresAt!: Date | null;

  // ----------------------------------------------------------------
  // Failure context
  // ----------------------------------------------------------------
  @Column({
    name: 'failure_reason',
    type: 'text',
    nullable: true,
  })
  failureReason!: string | null;

  @Column({
    name: 'metadata',
    type: 'jsonb',
    default: {},
  })
  metadata!: Record<string, unknown>;

  // ----------------------------------------------------------------
  // Relations — declared here, no circular imports
  // ----------------------------------------------------------------
  @OneToMany(
    () => TransactionStateLog,
    (log) => log.transaction,
    { cascade: false }, // logs are immutable, never cascade
  )
  stateLogs!: TransactionStateLog[];

  // Add inside the Transaction class, after the stateLogs relation

  @OneToMany(() => Refund, (refund) => refund.transaction, { cascade: false })
  refunds!: Refund[];

  // ----------------------------------------------------------------
  // Computed helper — display amount in rupees (never used in DB ops)
  // ----------------------------------------------------------------
  get amountRupees(): number {
    return Number(this.amountPaise) / 100;
  }
}

// Forward reference to avoid circular import
// TransactionStateLog is defined in its own file but referenced here
import { TransactionStateLog } from './transaction-state-log.entity';
import { Refund } from './refund.entity';

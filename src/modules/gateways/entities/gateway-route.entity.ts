// src/modules/gateways/entities/gateway-route.entity.ts

import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Transaction } from '../../transactions/entities/transaction.entity';
import { PaymentGateway } from '../../../common/enums';

@Entity('gateway_routes')
@Index(['transactionId'])
@Index(['gateway', 'createdAt'])
export class GatewayRoute {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'transaction_id', type: 'uuid' })
  transactionId: string;

  @ManyToOne(() => Transaction, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'transaction_id' })
  transaction: Transaction;

  @Column({
    name: 'gateway',
    type: 'enum',
    enum: PaymentGateway,
  })
  gateway: PaymentGateway;

  // ----------------------------------------------------------------
  // Composite routing score and individual factor scores (Section A3.2)
  // Stored as NUMERIC in DB — mapped to number here (read-only scores,
  // not financial amounts, so number precision is acceptable)
  // ----------------------------------------------------------------
  @Column({
    name: 'composite_score',
    type: 'numeric',
    precision: 6,
    scale: 4,
  })
  compositeScore: number;

  @Column({
    name: 'score_success',
    type: 'numeric',
    precision: 6,
    scale: 4,
  })
  scoreSuccess: number;

  @Column({
    name: 'score_latency',
    type: 'numeric',
    precision: 6,
    scale: 4,
  })
  scoreLatency: number;

  @Column({
    name: 'score_cost',
    type: 'numeric',
    precision: 6,
    scale: 4,
  })
  scoreCost: number;

  @Column({
    name: 'score_health',
    type: 'numeric',
    precision: 6,
    scale: 4,
  })
  scoreHealth: number;

  @Column({
    name: 'score_fit',
    type: 'numeric',
    precision: 6,
    scale: 4,
  })
  scoreFit: number;

  // ----------------------------------------------------------------
  // Snapshot of live metrics at the moment routing decision was made
  // Stored for audit and routing algorithm analysis
  // ----------------------------------------------------------------
  @Column({
    name: 'success_rate',
    type: 'numeric',
    precision: 6,
    scale: 4,
    nullable: true,
  })
  successRate: number | null;

  @Column({
    name: 'p95_latency_ms',
    type: 'int',
    nullable: true,
  })
  p95LatencyMs: number | null;

  // ----------------------------------------------------------------
  // Selection context
  // ----------------------------------------------------------------
  @Column({
    name: 'selection_reason',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  selectionReason: string | null;

  // TRUE = this gateway was actually selected for the transaction
  // FALSE = gateway was scored but not chosen (runner-up record)
  @Column({
    name: 'was_selected',
    type: 'boolean',
    default: true,
  })
  wasSelected: boolean;

  // No updatedAt — routing decisions are immutable records
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

// src/modules/reconciliation/entities/reconciliation-log.entity.ts

import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { PaymentGateway } from '../../../common/enums';

export enum DiscrepancyType {
  INTERNAL_CAPTURED_GATEWAY_FAILED = 'INTERNAL_CAPTURED_GATEWAY_FAILED',
  INTERNAL_PENDING_GATEWAY_SUCCEEDED = 'INTERNAL_PENDING_GATEWAY_SUCCEEDED',
  AMOUNT_MISMATCH = 'AMOUNT_MISMATCH',
  STATUS_MISMATCH = 'STATUS_MISMATCH',
  MISSING_IN_GATEWAY = 'MISSING_IN_GATEWAY',
}

@Entity('reconciliation_log')
@Index(['transactionId'])
@Index(['runId'])
export class ReconciliationLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Groups all records from a single reconciliation run
  @Column({ name: 'run_id', type: 'uuid' })
  runId: string;

  @Column({ name: 'transaction_id', type: 'uuid', nullable: true })
  transactionId: string | null;

  @Column({
    name: 'gateway',
    type: 'enum',
    enum: PaymentGateway,
    nullable: true,
  })
  gateway: PaymentGateway | null;

  @Column({
    name: 'discrepancy_type',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  discrepancyType: DiscrepancyType | null;

  @Column({
    name: 'internal_state',
    type: 'varchar',
    length: 50,
    nullable: true,
  })
  internalState: string | null;

  @Column({
    name: 'gateway_state',
    type: 'varchar',
    length: 50,
    nullable: true,
  })
  gatewayState: string | null;

  // true = human review required, false = auto-resolved
  @Column({ name: 'requires_review', type: 'boolean', default: false })
  requiresReview: boolean;

  @Column({ name: 'resolved', type: 'boolean', default: false })
  resolved: boolean;

  @Column({ name: 'notes', type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

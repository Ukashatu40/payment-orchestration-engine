// src/modules/webhooks/entities/webhook-queue.entity.ts

import {
  Entity,
  Column,
  CreateDateColumn,
  PrimaryGeneratedColumn,
  Index,
} from 'typeorm';
import { PaymentGateway, WebhookStatus } from '../../../common/enums';

@Entity('webhook_queue')
export class WebhookQueue {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: string; // bigint from DB, string in JS to avoid precision loss

  @Column({
    name: 'gateway',
    type: 'enum',
    enum: PaymentGateway,
  })
  gateway!: PaymentGateway;

  @Column({ name: 'event_id', type: 'varchar', length: 255 })
  eventId!: string;

  @Column({ name: 'payload', type: 'jsonb' })
  payload!: Record<string, unknown>;

  // Raw signature stored for re-verification on DLQ replay
  @Column({ name: 'signature', type: 'text' })
  signature!: string;

  @Column({
    name: 'status',
    type: 'enum',
    enum: WebhookStatus,
    default: WebhookStatus.PENDING,
  })
  status!: WebhookStatus;

  @Column({ name: 'retry_count', type: 'int', default: 0 })
  retryCount!: number;

  @Column({ name: 'max_retries', type: 'int', default: 3 })
  maxRetries!: number;

  // Null = ready to process immediately
  @Index()
  @Column({ name: 'next_retry_at', type: 'timestamptz', nullable: true })
  nextRetryAt!: Date | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'processed_at', type: 'timestamptz', nullable: true })
  processedAt!: Date | null;
}

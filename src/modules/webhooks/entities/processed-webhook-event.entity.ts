// src/modules/webhooks/entities/processed-webhook-event.entity.ts

import {
  Entity,
  Column,
  CreateDateColumn,
  PrimaryColumn,
  Index,
} from 'typeorm';
import { PaymentGateway } from '../../../common/enums';

// Deduplication store — composite PK (gateway, event_id)
// Different gateways may reuse event IDs, hence composite (Section A5.4)
@Entity('processed_webhook_events')
export class ProcessedWebhookEvent {
  @PrimaryColumn({
    name: 'gateway',
    type: 'enum',
    enum: PaymentGateway,
  })
  gateway: PaymentGateway;

  @PrimaryColumn({ name: 'event_id', type: 'varchar', length: 255 })
  eventId: string;

  @Column({ name: 'event_type', type: 'varchar', length: 100 })
  eventType: string;

  @Column({ name: 'payload_hash', type: 'varchar', length: 64 })
  payloadHash: string;

  @Index()
  @Column({ name: 'transaction_id', type: 'uuid', nullable: true })
  transactionId: string | null;

  @CreateDateColumn({ name: 'processed_at', type: 'timestamptz' })
  processedAt: Date;
}

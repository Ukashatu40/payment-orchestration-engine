// src/modules/webhooks/webhook-queue.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { WebhookQueueRepository } from './repositories/webhook-queue.repository';
import { ProcessedWebhookEventRepository } from './repositories/processed-webhook-event.repository';
import { WebhookQueue } from './entities/webhook-queue.entity';
import { PaymentGateway, WebhookStatus } from '../../common/enums';
import * as crypto from 'crypto';

export interface InboundWebhook {
  gateway: PaymentGateway;
  eventId: string;
  eventType: string;
  payload: Record<string, unknown>;
  rawBody: Buffer;
  signature: string;
}

@Injectable()
export class WebhookQueueService {
  private readonly logger = new Logger(WebhookQueueService.name);

  constructor(
    private readonly webhookQueueRepo: WebhookQueueRepository,
    private readonly processedEventRepo: ProcessedWebhookEventRepository,
  ) {}

  // ----------------------------------------------------------------
  // Enqueues an inbound webhook for async processing.
  // Called immediately by the webhook controller after signature
  // verification — decouples ingestion from processing (Section A5.2).
  // ----------------------------------------------------------------
  async enqueue(webhook: InboundWebhook): Promise<WebhookQueue> {
    const entry = await this.webhookQueueRepo.enqueue({
      gateway: webhook.gateway,
      eventId: webhook.eventId,
      payload: webhook.payload,
      signature: webhook.signature,
    });

    this.logger.log('Webhook enqueued', {
      gateway: webhook.gateway,
      eventId: webhook.eventId,
      eventType: webhook.eventType,
      queueId: entry.id,
    });

    return entry;
  }

  // ----------------------------------------------------------------
  // Fetches due webhooks for the processor to consume.
  // Uses the partial index on next_retry_at for performance.
  // ----------------------------------------------------------------
  async fetchDue(limit = 50): Promise<WebhookQueue[]> {
    return this.webhookQueueRepo.findDue(limit);
  }

  // ----------------------------------------------------------------
  // DLQ management
  // ----------------------------------------------------------------
  async getDLQ(gateway?: PaymentGateway): Promise<WebhookQueue[]> {
    return this.webhookQueueRepo.findDLQ(gateway);
  }

  async replayFromDLQ(queueId: string): Promise<void> {
    await this.webhookQueueRepo.requeueFromDLQ(queueId);

    this.logger.log('Webhook re-queued from DLQ', { queueId });
  }

  // ----------------------------------------------------------------
  // Status updates — called by the processor
  // ----------------------------------------------------------------
  async markProcessing(queueId: string): Promise<void> {
    await this.webhookQueueRepo.markProcessing(queueId);
  }

  async markCompleted(queueId: string): Promise<void> {
    await this.webhookQueueRepo.markCompleted(queueId);
  }

  async markFailed(queueId: string, error: string, retryCount: number): Promise<void> {
    await this.webhookQueueRepo.markFailedWithRetry(queueId, error, retryCount);
  }

  // ----------------------------------------------------------------
  // Extracts the gateway-specific event ID from the payload.
  // Each gateway uses a different field name (Section A5.4).
  // ----------------------------------------------------------------
  extractEventId(gateway: PaymentGateway, payload: Record<string, unknown>): string {
    switch (gateway) {
      case PaymentGateway.RAZORPAY:
        return (
          (payload['event'] as string) +
          ':' +
          ((payload['payload'] as any)?.['payment']?.['entity']?.['id'] ?? '')
        );
      case PaymentGateway.STRIPE:
        return payload['id'] as string;
      case PaymentGateway.PAYU:
        return payload['txnid'] as string;
      case PaymentGateway.UPI:
        return payload['txnRef'] as string;
      case PaymentGateway.PAYSTACK:
        return (payload['event'] as string) + ':' + ((payload['data'] as any)?.['reference'] ?? '');
      case PaymentGateway.FLUTTERWAVE:
        return (payload['event'] as string) + ':' + ((payload['data'] as any)?.['tx_ref'] ?? '');
      case PaymentGateway.INTERSWITCH:
        // TODO: confirm Interswitch's webhook payload field names against
        // current merchant docs — best-effort placeholder for now.
        return (payload['transactionReference'] as string) ?? '';
      case PaymentGateway.OPAY:
        // TODO: confirm Opay's webhook payload field names against
        // current merchant docs — best-effort placeholder for now.
        return (payload['reference'] as string) ?? '';
      default:
        throw new Error(`Unknown gateway for event ID extraction: ${gateway}`);
    }
  }

  // ----------------------------------------------------------------
  // Extracts the event type from the payload.
  // Used for audit logging and state machine routing.
  // ----------------------------------------------------------------
  extractEventType(gateway: PaymentGateway, payload: Record<string, unknown>): string {
    switch (gateway) {
      case PaymentGateway.RAZORPAY:
        return payload['event'] as string;
      case PaymentGateway.STRIPE:
        return payload['type'] as string;
      case PaymentGateway.PAYU:
        return payload['status'] as string;
      case PaymentGateway.UPI:
        return payload['status'] as string;
      case PaymentGateway.PAYSTACK:
      case PaymentGateway.FLUTTERWAVE:
        return (payload['event'] as string) ?? 'unknown';
      case PaymentGateway.INTERSWITCH:
      case PaymentGateway.OPAY:
        // TODO: confirm event-type field name against current docs.
        return (payload['event'] as string) ?? 'unknown';
      default:
        return 'unknown';
    }
  }

  // ----------------------------------------------------------------
  // SHA-256 of the raw payload — stored in processed_webhook_events
  // for tamper detection on replay (Section A5.4, FS-10).
  // ----------------------------------------------------------------
  hashPayload(rawBody: Buffer): string {
    return crypto.createHash('sha256').update(rawBody).digest('hex');
  }
}

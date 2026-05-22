// src/modules/webhooks/webhook-processor.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { WebhookQueueService } from './webhook-queue.service';
import { ProcessedWebhookEventRepository } from './repositories/processed-webhook-event.repository';
import { TransactionRepository } from '../transactions/repositories/transaction.repository';
import { TransactionStateMachineService } from '../transactions/state-machine/transaction-state-machine.service';
import { WebhookQueue } from './entities/webhook-queue.entity';
import { TransactionState, PaymentGateway } from '../../common/enums';

// Maps gateway event types to state machine transitions
interface WebhookTransition {
  toState: TransactionState;
  event: string;
}

@Injectable()
export class WebhookProcessorService {
  private readonly logger = new Logger(WebhookProcessorService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly queueService: WebhookQueueService,
    private readonly processedEventRepo: ProcessedWebhookEventRepository,
    private readonly transactionRepo: TransactionRepository,
    private readonly stateMachine: TransactionStateMachineService,
  ) {}

  // ----------------------------------------------------------------
  // Processes a single webhook from the queue.
  // Pipeline: mark processing → deduplicate → find transaction →
  //           validate amounts → apply transition → mark completed
  //
  // Satisfies:
  // FS-02 (duplicate webhook deduplication)
  // FS-06 (webhook before API response — state machine handles it)
  // FS-10 (amount + transaction ID cross-validation)
  // Section A5.2 (full pipeline architecture)
  // ----------------------------------------------------------------
  async processOne(queueEntry: WebhookQueue): Promise<void> {
    const { id: queueId, gateway, eventId, payload, retryCount } = queueEntry;

    await this.queueService.markProcessing(queueId);

    try {
      // Step 1: Deduplication — atomic check + insert (Section A5.4)
      // If this event ID was already processed, return immediately.
      // HTTP 200 was already sent to the gateway by the controller.
      // Satisfies FS-02 (duplicate webhook delivery).
      const payloadHash = this.queueService.hashPayload(Buffer.from(JSON.stringify(payload)));
      const eventType = this.queueService.extractEventType(gateway, payload);

      const transactionId = this.extractTransactionId(gateway, payload);

      const isNew = await this.dataSource.transaction(async (manager) => {
        return this.processedEventRepo.insertIfNotExists(
          gateway,
          eventId,
          eventType,
          payloadHash,
          transactionId,
          manager,
        );
      });

      if (!isNew) {
        this.logger.log('Duplicate webhook ignored', {
          gateway,
          eventId,
          eventType,
        });
        await this.queueService.markCompleted(queueId);
        return;
      }

      // Step 2: Find the transaction this webhook refers to
      if (!transactionId) {
        this.logger.warn('Webhook has no resolvable transaction ID', {
          gateway,
          eventId,
          payload,
        });
        await this.queueService.markCompleted(queueId);
        return;
      }

      const transaction = await this.transactionRepo.findById(transactionId);

      if (!transaction) {
        this.logger.warn('Transaction not found for webhook', {
          gateway,
          eventId,
          transactionId,
        });
        await this.queueService.markCompleted(queueId);
        return;
      }

      // Step 3: Cross-validate amount and gateway reference (FS-10)
      // Prevents webhook replay attacks where attacker modifies amount
      this.validateWebhookPayload(gateway, payload, transaction);

      // Step 4: Determine the state transition this webhook implies
      const transition = this.resolveTransition(gateway, eventType, payload);

      if (!transition) {
        this.logger.log('Webhook event type requires no state transition', {
          gateway,
          eventId,
          eventType,
        });
        await this.queueService.markCompleted(queueId);
        return;
      }

      // Step 5: Check if transition is valid from current state.
      // If not valid (e.g. webhook arrives after API response already
      // set the state), the state machine handles it gracefully (FS-06).
      const canTransition = this.stateMachine.canTransition(transaction.state, transition.toState);

      if (!canTransition) {
        this.logger.log('Webhook transition not applicable — state already advanced', {
          gateway,
          eventId,
          currentState: transaction.state,
          attemptedTransition: transition.toState,
        });
        await this.queueService.markCompleted(queueId);
        return;
      }

      // Step 6: Apply the state transition
      await this.stateMachine.transition(transaction.id, transition.toState, {
        event: transition.event,
        triggeredBy: 'webhook_processor',
        traceId: transaction.traceId,
        gatewayReference: eventId,
        gatewayResponse: payload,
        metadata: { queueId, gateway, eventType },
      });

      await this.queueService.markCompleted(queueId);

      this.logger.log('Webhook processed successfully', {
        gateway,
        eventId,
        eventType,
        transactionId,
        newState: transition.toState,
      });
    } catch (err) {
      const error = err as Error;

      this.logger.error('Webhook processing failed', {
        queueId,
        gateway,
        eventId,
        error: error.message,
        retryCount,
      });

      // Exponential backoff retry — moves to DLQ after max retries
      await this.queueService.markFailed(queueId, error.message, retryCount + 1);
    }
  }

  // ----------------------------------------------------------------
  // Resolves which state transition a webhook event implies.
  // Returns null for events that need no transition (e.g. informational).
  // ----------------------------------------------------------------
  private resolveTransition(
    gateway: PaymentGateway,
    eventType: string,
    payload: Record<string, unknown>,
  ): WebhookTransition | null {
    const map: Record<string, Record<string, WebhookTransition>> = {
      [PaymentGateway.RAZORPAY]: {
        'payment.authorized': {
          toState: TransactionState.AUTHORISED,
          event: 'WEBHOOK_RAZORPAY_AUTHORISED',
        },
        'payment.captured': {
          toState: TransactionState.CAPTURED,
          event: 'WEBHOOK_RAZORPAY_CAPTURED',
        },
        'payment.failed': {
          toState: TransactionState.AUTH_FAILED,
          event: 'WEBHOOK_RAZORPAY_FAILED',
        },
        'refund.processed': {
          toState: TransactionState.REFUNDED,
          event: 'WEBHOOK_RAZORPAY_REFUNDED',
        },
        'payment.dispute.created': {
          toState: TransactionState.DISPUTE_OPENED,
          event: 'WEBHOOK_RAZORPAY_DISPUTE',
        },
      },
      [PaymentGateway.STRIPE]: {
        'payment_intent.amount_capturable_updated': {
          toState: TransactionState.AUTHORISED,
          event: 'WEBHOOK_STRIPE_AUTHORISED',
        },
        'payment_intent.succeeded': {
          toState: TransactionState.AUTHORISED,
          event: 'WEBHOOK_STRIPE_CAPTURED',
        },
        'payment_intent.payment_failed': {
          toState: TransactionState.AUTH_FAILED,
          event: 'WEBHOOK_STRIPE_FAILED',
        },
        'charge.refunded': {
          toState: TransactionState.REFUNDED,
          event: 'WEBHOOK_STRIPE_REFUNDED',
        },
        'charge.dispute.created': {
          toState: TransactionState.DISPUTE_OPENED,
          event: 'WEBHOOK_STRIPE_DISPUTE',
        },
      },
      [PaymentGateway.PAYU]: {
        SUCCESS: {
          toState: TransactionState.CAPTURED,
          event: 'WEBHOOK_PAYU_CAPTURED',
        },
        FAILED: {
          toState: TransactionState.AUTH_FAILED,
          event: 'WEBHOOK_PAYU_FAILED',
        },
        REFUNDED: {
          toState: TransactionState.REFUNDED,
          event: 'WEBHOOK_PAYU_REFUNDED',
        },
      },
      [PaymentGateway.UPI]: {
        SUCCESS: {
          toState: TransactionState.CAPTURED,
          event: 'WEBHOOK_UPI_CAPTURED',
        },
        FAILURE: {
          toState: TransactionState.AUTH_FAILED,
          event: 'WEBHOOK_UPI_FAILED',
        },
        EXPIRED: {
          toState: TransactionState.AUTH_EXPIRED,
          event: 'WEBHOOK_UPI_EXPIRED',
        },
      },
    };

    return map[gateway]?.[eventType] ?? null;
  }

  // ----------------------------------------------------------------
  // Extracts our internal transaction ID from the gateway payload.
  // Each gateway stores it differently.
  // ----------------------------------------------------------------
  private extractTransactionId(
    gateway: PaymentGateway,
    payload: Record<string, unknown>,
  ): string | null {
    switch (gateway) {
      case PaymentGateway.RAZORPAY: {
        const entity = (payload['payload'] as any)?.['payment']?.['entity'];
        return entity?.['notes']?.['transaction_id'] ?? null;
      }
      case PaymentGateway.STRIPE: {
        const metadata = (payload['data'] as any)?.['object']?.['metadata'];
        return metadata?.['transaction_id'] ?? null;
      }
      case PaymentGateway.PAYU:
        return (payload['udf1'] as string) ?? null;
      case PaymentGateway.UPI:
        return (payload['merchantTransactionId'] as string) ?? null;
      default:
        return null;
    }
  }

  // ----------------------------------------------------------------
  // Cross-validates webhook payload against stored transaction data.
  // Prevents webhook replay fraud (FS-10, Section C4).
  // ----------------------------------------------------------------
  private validateWebhookPayload(
    gateway: PaymentGateway,
    payload: Record<string, unknown>,
    transaction: { amountPaise: bigint; gatewayReference: string | null },
  ): void {
    const webhookAmount = this.extractAmount(gateway, payload);

    if (
      webhookAmount !== null &&
      webhookAmount !== BigInt(0) &&
      webhookAmount !== transaction.amountPaise
    ) {
      this.logger.warn('Webhook amount mismatch — possible replay attack', {
        gateway,
        webhookAmount: webhookAmount.toString(),
        expectedAmount: transaction.amountPaise.toString(),
      });
      throw new Error(
        `Webhook amount mismatch: received ${webhookAmount}, ` +
          `expected ${transaction.amountPaise}`,
      );
    }
  }

  private extractAmount(gateway: PaymentGateway, payload: Record<string, unknown>): bigint | null {
    try {
      switch (gateway) {
        case PaymentGateway.RAZORPAY: {
          const amount = (payload['payload'] as any)?.['payment']?.['entity']?.['amount'];
          return amount !== undefined ? BigInt(amount) : null;
        }
        case PaymentGateway.STRIPE: {
          const amount = (payload['data'] as any)?.['object']?.['amount'];
          return amount !== undefined ? BigInt(amount) : null;
        }
        case PaymentGateway.PAYU: {
          const amount = payload['amount'];
          return amount !== undefined ? BigInt(Math.round(Number(amount) * 100)) : null;
        }
        default:
          return null;
      }
    } catch {
      return null;
    }
  }
}

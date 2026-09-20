// src/modules/webhooks/webhook-processor.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { WebhookQueueService } from './webhook-queue.service';
import { ProcessedWebhookEventRepository } from './repositories/processed-webhook-event.repository';
import { TransactionRepository } from '../transactions/repositories/transaction.repository';
import { TransactionStateMachineService } from '../transactions/state-machine/transaction-state-machine.service';
import { WebhookQueue } from './entities/webhook-queue.entity';
import { Transaction } from '../transactions/entities/transaction.entity';
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

    // Set once this attempt has claimed the dedup marker, so a failure
    // releases only a marker this attempt created (never a genuine
    // duplicate's, which belongs to the run that actually processed it).
    let claimedDedupMarker = false;

    try {
      // Step 1: Resolve the transaction, then deduplicate (Section A5.4).
      // A duplicate event ID returns immediately; HTTP 200 was already sent
      // to the gateway by the controller. Satisfies FS-02.
      const payloadHash = this.queueService.hashPayload(Buffer.from(JSON.stringify(payload)));
      const eventType = this.queueService.extractEventType(gateway, payload);

      const transactionId = this.extractTransactionId(gateway, payload);

      // If the webhook names a transaction, make sure this database has it
      // BEFORE recording the dedupe marker: the marker has a foreign key to
      // transactions, so a webhook for a transaction that doesn't exist here
      // (created against another environment, or deleted) would otherwise fail
      // the insert and retry into the DLQ forever. (A null ID is allowed by
      // the FK, so events without one still get their dedupe marker.)
      const transaction = transactionId ? await this.transactionRepo.findById(transactionId) : null;

      if (transactionId && !transaction) {
        this.logger.warn('Transaction not found for webhook', {
          gateway,
          eventId,
          transactionId,
        });
        await this.queueService.markCompleted(queueId);
        return;
      }

      // Step 2: Deduplication — atomic check + insert (Section A5.4)
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

      claimedDedupMarker = isNew;

      if (!isNew) {
        this.logger.log('Duplicate webhook ignored', {
          gateway,
          eventId,
          eventType,
        });
        await this.queueService.markCompleted(queueId);
        return;
      }

      if (!transactionId || !transaction) {
        this.logger.warn('Webhook has no resolvable transaction ID', {
          gateway,
          eventId,
          payload,
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

      // Step 5+6: walk the transaction to the target state (see advanceTransaction)
      const advanced = await this.advanceTransaction(transaction, transition.toState, {
        event: transition.event,
        triggeredBy: 'webhook_processor',
        gatewayReference: eventId,
        gatewayResponse: payload,
        metadata: { queueId, gateway, eventType },
      });

      if (!advanced) {
        this.logger.log('Webhook transition not applicable — state already advanced', {
          gateway,
          eventId,
          currentState: transaction.state,
          attemptedTransition: transition.toState,
        });
        await this.queueService.markCompleted(queueId);
        return;
      }

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

      if (claimedDedupMarker) {
        await this.processedEventRepo.remove(gateway, eventId);
      }

      // Exponential backoff retry — moves to DLQ after max retries
      await this.queueService.markFailed(queueId, error.message, retryCount + 1);
    }
  }

  // ----------------------------------------------------------------
  // Moves a transaction to `toState`, walking (and logging) intermediate
  // states where the state machine has no direct edge. Gateways that
  // auto-capture (Paystack, Flutterwave, ...) report a single "paid" event,
  // but there is no direct AUTH_INITIATED/AUTHORISED -> CAPTURED edge.
  // Returns false if the target is unreachable from the current state (e.g.
  // the state already advanced — FS-06), true once applied.
  // Also used by the Interswitch browser-return handler, which verifies the
  // payment server-side and does not depend on a webhook being configured.
  // ----------------------------------------------------------------
  async advanceTransaction(
    transaction: Transaction,
    toState: TransactionState,
    opts: {
      event: string;
      triggeredBy: string;
      gatewayReference: string;
      gatewayResponse: Record<string, unknown>;
      metadata: Record<string, unknown>;
    },
  ): Promise<boolean> {
    const path = this.pathTo(transaction.state, toState);
    if (!path) return false;

    for (const [i, step] of path.entries()) {
      const isFinal = i === path.length - 1;
      await this.stateMachine.transition(transaction.id, step, {
        event: isFinal ? opts.event : `${opts.event}_VIA_${step}`,
        triggeredBy: opts.triggeredBy,
        traceId: transaction.traceId,
        gatewayReference: opts.gatewayReference,
        gatewayResponse: opts.gatewayResponse,
        metadata: opts.metadata,
      });
    }

    // The API capture path records capturedPaise itself; a webhook-driven
    // capture must too, or a fully captured payment reads as zero captured
    // (and later refund-limit checks see nothing to refund).
    if (toState === TransactionState.CAPTURED) {
      await this.dataSource
        .getRepository(Transaction)
        .update({ id: transaction.id }, { capturedPaise: BigInt(transaction.amountPaise) });
    }

    return true;
  }

  // Direct edge if the state machine allows it; otherwise, for CAPTURED
  // only, the auto-capture chain. Returns null when unreachable.
  private pathTo(from: TransactionState, to: TransactionState): TransactionState[] | null {
    if (this.stateMachine.canTransition(from, to)) return [to];

    if (to === TransactionState.CAPTURED) {
      const chain = [
        TransactionState.AUTH_INITIATED,
        TransactionState.AUTHORISED,
        TransactionState.CAPTURE_INITIATED,
        TransactionState.CAPTURED,
      ];
      const idx = chain.indexOf(from);
      if (idx !== -1 && idx < chain.length - 1) return chain.slice(idx + 1);
    }

    return null;
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
      // Paystack auto-captures on charge success, so the success event
      // maps straight to CAPTURED rather than AUTHORISED — there is no
      // separate capture step in the flow this adapter uses (see
      // paystack.adapter.ts). Event type strings below are Paystack's
      // documented event names — reconfirm against current docs.
      [PaymentGateway.PAYSTACK]: {
        'charge.success': {
          toState: TransactionState.CAPTURED,
          event: 'WEBHOOK_PAYSTACK_CAPTURED',
        },
        'charge.failed': {
          toState: TransactionState.AUTH_FAILED,
          event: 'WEBHOOK_PAYSTACK_FAILED',
        },
        'refund.processed': {
          toState: TransactionState.REFUNDED,
          event: 'WEBHOOK_PAYSTACK_REFUNDED',
        },
      },
      [PaymentGateway.FLUTTERWAVE]: {
        'charge.completed': {
          toState: TransactionState.CAPTURED,
          event: 'WEBHOOK_FLUTTERWAVE_CAPTURED',
        },
        'charge.failed': {
          toState: TransactionState.AUTH_FAILED,
          event: 'WEBHOOK_FLUTTERWAVE_FAILED',
        },
        'transfer.refund': {
          toState: TransactionState.REFUNDED,
          event: 'WEBHOOK_FLUTTERWAVE_REFUNDED',
        },
      },
      // Interswitch's TRANSACTION.COMPLETED event doesn't itself say
      // success vs failure — extractEventType (webhook-queue.service.ts)
      // encodes data.responseCode into the type string, so the keys
      // here are the composite form, not the raw `event` field value.
      // See https://docs.interswitchgroup.com/v1.1/docs/webhooks
      [PaymentGateway.INTERSWITCH]: {
        'TRANSACTION.COMPLETED:SUCCESS': {
          toState: TransactionState.CAPTURED,
          event: 'WEBHOOK_INTERSWITCH_CAPTURED',
        },
        'TRANSACTION.COMPLETED:FAILURE': {
          toState: TransactionState.AUTH_FAILED,
          event: 'WEBHOOK_INTERSWITCH_FAILED',
        },
      },
      [PaymentGateway.OPAY]: {
        SUCCESS: {
          toState: TransactionState.CAPTURED,
          event: 'WEBHOOK_OPAY_CAPTURED',
        },
        FAIL: {
          toState: TransactionState.AUTH_FAILED,
          event: 'WEBHOOK_OPAY_FAILED',
        },
        // The payer never completed checkout and Opay closed the order
        // ("closed due to timeout") — the payment is dead, not still pending.
        CLOSE: {
          toState: TransactionState.AUTH_EXPIRED,
          event: 'WEBHOOK_OPAY_CLOSED',
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
      case PaymentGateway.PAYSTACK: {
        const metadata = (payload['data'] as any)?.['metadata'];
        return metadata?.['transaction_id'] ?? null;
      }
      case PaymentGateway.FLUTTERWAVE: {
        const meta = (payload['data'] as any)?.['meta'];
        return meta?.['transaction_id'] ?? null;
      }
      case PaymentGateway.INTERSWITCH: {
        // Confirmed callback shape has no metadata passthrough field —
        // interswitch.adapter.ts sends our transactionId AS
        // merchant_reference, echoed back as data.merchantReference.
        // See https://docs.interswitchgroup.com/v1.1/docs/webhooks
        return (payload['data'] as any)?.['merchantReference'] ?? null;
      }
      case PaymentGateway.OPAY: {
        // Opay's confirmed callback shape has no metadata passthrough
        // field — opay.adapter.ts sends our transactionId AS the
        // `reference` sent to Opay, so the callback's
        // payload.payload.reference IS the transaction ID directly.
        // See https://doc.opaycheckout.com/callback-signature
        return (payload['payload'] as any)?.['reference'] ?? null;
      }
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
    // pg returns BIGINT columns as strings at runtime despite the
    // `bigint` type annotation, so a strict !== against the raw
    // entity value is always true — normalise before comparing.
    const expectedAmount = BigInt(transaction.amountPaise);

    if (webhookAmount !== null && webhookAmount !== BigInt(0) && webhookAmount !== expectedAmount) {
      this.logger.warn('Webhook amount mismatch — possible replay attack', {
        gateway,
        webhookAmount: webhookAmount.toString(),
        expectedAmount: expectedAmount.toString(),
      });
      throw new Error(
        `Webhook amount mismatch: received ${webhookAmount}, ` + `expected ${expectedAmount}`,
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
        // Paystack/Interswitch/Opay amounts are natively kobo (their
        // smallest currency unit for NGN), matching this codebase's
        // bigint minor-unit convention directly — do NOT apply PayU's
        // *100 conversion for these three.
        case PaymentGateway.PAYSTACK: {
          const amount = (payload['data'] as any)?.['amount'];
          return amount !== undefined ? BigInt(amount) : null;
        }
        // Flutterwave is the exception among the NGN gateways — like
        // PayU, its webhook payload amount is in naira (major units),
        // not kobo, so it DOES need the *100 conversion (see
        // flutterwave.adapter.ts for the matching outbound conversion).
        case PaymentGateway.FLUTTERWAVE: {
          const amount = (payload['data'] as any)?.['amount'];
          return amount !== undefined ? BigInt(Math.round(Number(amount) * 100)) : null;
        }
        case PaymentGateway.INTERSWITCH: {
          const amount = (payload['data'] as any)?.['amount'];
          return amount !== undefined ? BigInt(amount) : null;
        }
        case PaymentGateway.OPAY: {
          // Confirmed callback shape: payload.payload.amount is a
          // kobo-denominated numeric string (e.g. "30000"), not an
          // {total, currency} object. See
          // https://doc.opaycheckout.com/callback-signature
          const amount = (payload['payload'] as any)?.['amount'];
          return amount !== undefined ? BigInt(amount) : null;
        }
        default:
          return null;
      }
    } catch {
      return null;
    }
  }
}

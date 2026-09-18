// src/modules/transactions/transactions.service.ts

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { TransactionRepository } from './repositories/transaction.repository';
import { TransactionStateLogRepository } from './repositories/transaction-state-log.repository';
import { TransactionStateMachineService } from './state-machine/transaction-state-machine.service';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { GatewayRouterService } from '../gateways/router/gateway-router.service';
import { GatewayAdapterRegistry } from '../gateways/adapters/gateway-adapter.registry';
import { CircuitBreakerService } from '../gateways/circuit-breaker/circuit-breaker.service';
import { GatewayHealthService } from '../gateways/health/gateway-health.service';
import { Transaction } from './entities/transaction.entity';
import { TransactionStateLog } from './entities/transaction-state-log.entity';
import { RefundState, TransactionState, PaymentGateway } from '../../common/enums';
import { PaymentResponseDto } from './dto/payment-response.dto';
import { ListPaymentsResponseDto } from './dto/list-payments-response.dto';
import { GatewayTimeoutException, GatewayUnavailableException } from '../../common/exceptions';
import {
  InitiatePaymentDto,
  CapturePaymentDto,
  RefundPaymentDto,
  VoidPaymentDto,
} from './interfaces/initiate-payment.interface';
import { Refund } from './entities/refund.entity';
import { RefundRepository } from './repositories/refund.repository';

@Injectable()
export class TransactionsService {
  private readonly logger = new Logger(TransactionsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly transactionRepo: TransactionRepository,
    private readonly stateLogRepo: TransactionStateLogRepository,
    private readonly refundRepo: RefundRepository, // ← added refund repository
    private readonly stateMachine: TransactionStateMachineService,
    private readonly idempotencyService: IdempotencyService,
    private readonly gatewayRouter: GatewayRouterService,
    private readonly gatewayRegistry: GatewayAdapterRegistry,
    private readonly circuitBreaker: CircuitBreakerService,
    private readonly healthService: GatewayHealthService,
  ) {}

  // ----------------------------------------------------------------
  // POST /api/v1/payments
  //
  // Full payment initiation flow:
  // 1. Idempotency check (advisory lock)
  // 2. Create transaction record
  // 3. Select gateway (router + circuit breaker)
  // 4. Transition to AUTH_INITIATED (lock released before gateway call)
  // 5. Call gateway authorise
  // 6. Transition to AUTHORISED or AUTH_FAILED/AUTH_TIMEOUT
  // 7. Mark idempotency key completed
  //
  // Satisfies: FS-01, FS-03, FS-09, FS-13
  // ----------------------------------------------------------------
  async initiatePayment(dto: InitiatePaymentDto): Promise<Transaction> {
    const startTime = Date.now();

    // Step 1: Idempotency check — advisory lock prevents FS-09
    const idempotencyResult = await this.idempotencyService.acquireOrReturn(
      dto.merchantId,
      dto.idempotencyKey,
      { merchantOrderId: dto.merchantOrderId, amountPaise: dto.amountPaise },
    );

    // Duplicate request — return cached response without hitting gateway
    if (!idempotencyResult.isNewRequest) {
      this.logger.log('Returning cached idempotency response', {
        merchantId: dto.merchantId,
        idempotencyKey: dto.idempotencyKey,
        traceId: dto.traceId,
      });

      const cached = await this.transactionRepo.findByMerchantOrderId(
        dto.merchantId,
        dto.merchantOrderId,
      );

      if (cached) return cached;
    }

    // Step 2: Create transaction record in CREATED state
    const transaction = await this.transactionRepo.create({
      merchantId: dto.merchantId,
      merchantOrderId: dto.merchantOrderId,
      amountPaise: BigInt(dto.amountPaise), // convert here
      currency: dto.currency,
      paymentMethod: dto.paymentMethod,
      idempotencyKey: dto.idempotencyKey,
      traceId: dto.traceId,
      metadata: dto.metadata ?? {},
      state: TransactionState.CREATED,
    });

    this.logger.log('Transaction created', {
      transactionId: transaction.id,
      traceId: dto.traceId,
    });

    try {
      // Step 3: Select gateway
      let selectedGateway: string;

      try {
        selectedGateway = await this.gatewayRouter.selectGateway(
          transaction.id,
          dto.paymentMethod,
          dto.currency,
          dto.traceId,
        );
      } catch (err) {
        // No gateway available — transition to ROUTE_FAILED
        await this.stateMachine.transition(transaction.id, TransactionState.ROUTE_SELECTED, {
          event: 'ROUTE_SELECTION_STARTED',
          triggeredBy: 'api_server',
          traceId: dto.traceId,
        });

        await this.stateMachine.transition(transaction.id, TransactionState.ROUTE_FAILED, {
          event: 'NO_GATEWAY_AVAILABLE',
          triggeredBy: 'api_server',
          traceId: dto.traceId,
          metadata: { error: (err as Error).message },
        });

        throw err;
      }

      // Step 4a: Transition CREATED → ROUTE_SELECTED
      await this.stateMachine.transition(transaction.id, TransactionState.ROUTE_SELECTED, {
        event: 'GATEWAY_SELECTED',
        triggeredBy: 'api_server',
        traceId: dto.traceId,
        metadata: { gateway: selectedGateway },
      });

      // Step 4b: Transition ROUTE_SELECTED → AUTH_INITIATED
      // Lock is acquired and released inside transition().
      // Gateway call happens AFTER this returns — lock not held. (A8.1)
      const authInitiated = await this.stateMachine.transition(
        transaction.id,
        TransactionState.AUTH_INITIATED,
        {
          event: 'AUTH_REQUEST_SENT',
          triggeredBy: 'api_server',
          traceId: dto.traceId,
          metadata: { gateway: selectedGateway },
        },
      );

      // Update gateway on transaction for reconciliation engine.
      // Must be awaited — an unawaited fire-and-forget update here
      // races with the very next read of this row (surfaced by the
      // 'pending' branch below, which re-fetches the transaction
      // almost immediately after this write with no gateway-call
      // delay in between to mask the race).
      await this.dataSource
        .getRepository(Transaction)
        .update({ id: transaction.id }, { gateway: selectedGateway as any });

      // Step 5: Call gateway — no DB lock held during this I/O
      const adapter = this.gatewayRegistry.get(selectedGateway as any);
      const gatewayStart = Date.now();

      let authResponse: Awaited<ReturnType<typeof adapter.authorise>>;

      try {
        authResponse = await adapter.authorise({
          transactionId: transaction.id,
          merchantId: dto.merchantId,
          amountPaise: BigInt(dto.amountPaise),
          currency: dto.currency,
          paymentMethod: dto.paymentMethod,
          idempotencyKey: dto.idempotencyKey,
          traceId: dto.traceId,
          metadata: dto.metadata,
        });

        // 'pending' (redirect/async gateways like Paystack/Flutterwave,
        // which don't resolve synchronously) counts as a successful
        // gateway call for health/circuit-breaker purposes — the HTTP
        // call succeeded, final settlement just hasn't arrived yet.
        const gatewayCallSucceeded =
          authResponse.status === 'authorised' || authResponse.status === 'pending';

        // Record latency sample for routing algorithm
        this.healthService.record({
          gateway: selectedGateway as any,
          paymentMethod: dto.paymentMethod,
          latencyMs: Date.now() - gatewayStart,
          success: gatewayCallSucceeded,
        });

        // Record circuit breaker result
        if (gatewayCallSucceeded) {
          this.circuitBreaker.recordSuccess(selectedGateway as any, dto.paymentMethod);
        } else {
          this.circuitBreaker.recordFailure(selectedGateway as any, dto.paymentMethod);
        }
      } catch (err) {
        // Gateway call failed — record failure and determine next state
        this.healthService.record({
          gateway: selectedGateway as any,
          paymentMethod: dto.paymentMethod,
          latencyMs: Date.now() - gatewayStart,
          success: false,
        });

        this.circuitBreaker.recordFailure(selectedGateway as any, dto.paymentMethod);

        const isTimeout = err instanceof GatewayTimeoutException;
        const nextState = isTimeout ? TransactionState.AUTH_TIMEOUT : TransactionState.AUTH_FAILED;

        // Step 6a: Transition to failure state
        await this.stateMachine.transition(transaction.id, nextState, {
          event: isTimeout ? 'GATEWAY_TIMEOUT' : 'GATEWAY_ERROR',
          triggeredBy: 'api_server',
          traceId: dto.traceId,
          metadata: { error: (err as Error).message, gateway: selectedGateway },
        });

        await this.idempotencyService.markFailed(dto.merchantId, dto.idempotencyKey);

        throw err;
      }

      // Step 6b: Transition to AUTHORISED or AUTH_FAILED based on response
      if (authResponse.status === 'declined') {
        await this.stateMachine.transition(transaction.id, TransactionState.AUTH_FAILED, {
          event: 'GATEWAY_DECLINED',
          triggeredBy: 'api_server',
          traceId: dto.traceId,
          gatewayReference: authResponse.gatewayReference,
          gatewayResponse: authResponse.rawResponse,
        });

        await this.idempotencyService.markFailed(dto.merchantId, dto.idempotencyKey);

        throw new Error(`Payment declined by gateway: ${selectedGateway}`);
      }

      // Redirect/async gateways (Paystack, Flutterwave) return 'pending'
      // from authorise() — there is no synchronous result yet. The
      // transaction stays in AUTH_INITIATED; the webhook processor
      // advances it to AUTHORISED/CAPTURED once the gateway confirms
      // the charge (see webhook-processor.service.ts resolveTransition).
      if (authResponse.status === 'pending') {
        await this.dataSource.getRepository(Transaction).update(
          { id: transaction.id },
          {
            gatewayPaymentId: authResponse.gatewayPaymentId,
            gatewayOrderId: authResponse.gatewayOrderId ?? null,
            gatewayReference: authResponse.gatewayReference,
          },
        );

        await this.idempotencyService.markCompleted(
          dto.merchantId,
          dto.idempotencyKey,
          202,
          { transactionId: transaction.id, state: TransactionState.AUTH_INITIATED },
          transaction.id,
        );

        this.logger.log('Payment initiation pending — awaiting webhook confirmation', {
          transactionId: transaction.id,
          gateway: selectedGateway,
          traceId: dto.traceId,
        });

        return this.findOrThrow(transaction.id);
      }

      // Success path
      const authorised = await this.stateMachine.transition(
        transaction.id,
        TransactionState.AUTHORISED,
        {
          event: 'GATEWAY_AUTH_SUCCESS',
          triggeredBy: 'api_server',
          traceId: dto.traceId,
          gatewayReference: authResponse.gatewayReference,
          gatewayResponse: authResponse.rawResponse,
        },
      );

      // Update gateway payment IDs on transaction
      await this.dataSource.getRepository(Transaction).update(
        { id: transaction.id },
        {
          gatewayPaymentId: authResponse.gatewayPaymentId,
          gatewayOrderId: authResponse.gatewayOrderId ?? null,
          gatewayReference: authResponse.gatewayReference,
        },
      );

      // Step 7: Cache successful response in idempotency store
      await this.idempotencyService.markCompleted(
        dto.merchantId,
        dto.idempotencyKey,
        201,
        { transactionId: transaction.id, state: TransactionState.AUTHORISED },
        transaction.id,
      );

      this.logger.log('Payment initiated successfully', {
        transactionId: transaction.id,
        gateway: selectedGateway,
        durationMs: Date.now() - startTime,
        traceId: dto.traceId,
      });

      return authorised;
    } catch (err) {
      // Idempotency already marked failed inside the catch blocks above
      // for gateway failures. This outer catch handles unexpected errors.
      this.logger.error('Payment initiation failed', {
        transactionId: transaction.id,
        error: (err as Error).message,
        traceId: dto.traceId,
      });

      throw err;
    }
  }

  // ----------------------------------------------------------------
  // POST /api/v1/payments/:id/capture
  // Satisfies: FS-04, FS-05
  // ----------------------------------------------------------------
  async capturePayment(dto: CapturePaymentDto): Promise<Transaction> {
    const transaction = await this.findOrThrow(dto.transactionId);
    const captureAmount = dto.amountPaise ? BigInt(dto.amountPaise) : transaction.amountPaise;

    // Transition to CAPTURE_INITIATED (lock released before gateway call)
    await this.stateMachine.transition(transaction.id, TransactionState.CAPTURE_INITIATED, {
      event: 'CAPTURE_REQUESTED',
      triggeredBy: dto.triggeredBy,
      traceId: dto.traceId,
      metadata: { amountPaise: captureAmount.toString() },
    });

    const adapter = this.gatewayRegistry.get(transaction.gateway!);

    let captureResponse: Awaited<ReturnType<typeof adapter.capture>>;

    try {
      captureResponse = await adapter.capture({
        transactionId: transaction.id,
        gatewayPaymentId: transaction.gatewayPaymentId!,
        amountPaise: captureAmount,
        currency: transaction.currency,
        traceId: dto.traceId,
      });
    } catch (err) {
      // Capture failed — move to CAPTURE_FAILED for retry (FS-04)
      await this.stateMachine.transition(transaction.id, TransactionState.CAPTURE_FAILED, {
        event: 'CAPTURE_GATEWAY_ERROR',
        triggeredBy: dto.triggeredBy,
        traceId: dto.traceId,
        metadata: { error: (err as Error).message },
      });

      throw err;
    }

    // Determine if full or partial capture (FS-05)
    const isPartial = captureResponse.capturedAmountPaise < transaction.amountPaise;

    const nextState = isPartial ? TransactionState.PARTIALLY_CAPTURED : TransactionState.CAPTURED;

    const captured = await this.stateMachine.transition(transaction.id, nextState, {
      event: 'CAPTURE_SUCCESS',
      triggeredBy: dto.triggeredBy,
      traceId: dto.traceId,
      gatewayReference: captureResponse.gatewayReference,
      gatewayResponse: captureResponse.rawResponse,
    });

    // Update captured amount
    await this.dataSource
      .getRepository(Transaction)
      .update({ id: transaction.id }, { capturedPaise: captureResponse.capturedAmountPaise });

    return captured;
  }

  // ----------------------------------------------------------------
  // POST /api/v1/payments/:id/refund
  // Satisfies: FS-08
  // ----------------------------------------------------------------
  async refundPayment(dto: RefundPaymentDto): Promise<Transaction> {
    const transaction = await this.findOrThrow(dto.transactionId);

    await this.stateMachine.transition(transaction.id, TransactionState.REFUND_INITIATED, {
      event: 'REFUND_REQUESTED',
      triggeredBy: dto.triggeredBy,
      traceId: dto.traceId,
      metadata: {
        amountPaise: dto.amountPaise.toString(),
        reason: dto.reason,
      },
    });

    const adapter = this.gatewayRegistry.get(transaction.gateway!);

    let refundResponse: Awaited<ReturnType<typeof adapter.refund>>;

    try {
      refundResponse = await adapter.refund({
        transactionId: transaction.id,
        refundId: uuidv4(),
        gatewayPaymentId: transaction.gatewayPaymentId!,
        amountPaise: BigInt(dto.amountPaise),
        currency: transaction.currency,
        reason: dto.reason,
        traceId: dto.traceId,
      });
    } catch (err) {
      await this.stateMachine.transition(transaction.id, TransactionState.REFUND_FAILED, {
        event: 'REFUND_GATEWAY_ERROR',
        triggeredBy: dto.triggeredBy,
        traceId: dto.traceId,
        metadata: { error: (err as Error).message },
      });

      throw err;
    }

    const isPartial = refundResponse.status === 'partially_refunded';

    const nextState = isPartial ? TransactionState.PARTIALLY_REFUNDED : TransactionState.REFUNDED;

    const refunded = await this.stateMachine.transition(transaction.id, nextState, {
      event: 'REFUND_SUCCESS',
      triggeredBy: dto.triggeredBy,
      traceId: dto.traceId,
      gatewayReference: refundResponse.gatewayRefundId,
      gatewayResponse: refundResponse.rawResponse,
    });

    // Update refunded amount
    await this.dataSource
      .getRepository(Transaction)
      .update(
        { id: transaction.id },
        { refundedPaise: transaction.refundedPaise + BigInt(dto.amountPaise) },
      );

    // Persist refund record
    await this.refundRepo.create({
      transactionId: transaction.id,
      amountPaise: BigInt(dto.amountPaise),
      currency: transaction.currency,
      state: RefundState.COMPLETED,
      gateway: transaction.gateway!,
      gatewayRefundId: refundResponse.gatewayRefundId,
      reason: dto.reason,
      initiatedBy: dto.triggeredBy,
      idempotencyKey: dto.idempotencyKey,
    });

    return refunded;
  }

  // ----------------------------------------------------------------
  // POST /api/v1/payments/:id/void
  // ----------------------------------------------------------------
  async voidPayment(dto: VoidPaymentDto): Promise<Transaction> {
    const transaction = await this.findOrThrow(dto.transactionId);

    await this.stateMachine.transition(transaction.id, TransactionState.VOID_INITIATED, {
      event: 'VOID_REQUESTED',
      triggeredBy: dto.triggeredBy,
      traceId: dto.traceId,
    });

    const adapter = this.gatewayRegistry.get(transaction.gateway!);

    try {
      await adapter.void({
        transactionId: transaction.id,
        gatewayPaymentId: transaction.gatewayPaymentId!,
        traceId: dto.traceId,
      });
    } catch (err) {
      // Void failed — can retry capture
      await this.stateMachine.transition(transaction.id, TransactionState.CAPTURE_INITIATED, {
        event: 'VOID_FAILED_RETRY_CAPTURE',
        triggeredBy: dto.triggeredBy,
        traceId: dto.traceId,
        metadata: { error: (err as Error).message },
      });

      throw err;
    }

    return this.stateMachine.transition(transaction.id, TransactionState.VOIDED, {
      event: 'VOID_SUCCESS',
      triggeredBy: dto.triggeredBy,
      traceId: dto.traceId,
    });
  }

  async getRefunds(transactionId: string): Promise<Refund[]> {
    await this.findOrThrow(transactionId);
    return this.refundRepo.findByTransactionId(transactionId);
  }

  // ----------------------------------------------------------------
  // GET /api/v1/payments/:id
  // ----------------------------------------------------------------
  async findById(id: string): Promise<Transaction> {
    return this.findOrThrow(id);
  }

  // ----------------------------------------------------------------
  // GET /api/v1/payments/:id/timeline
  // ----------------------------------------------------------------
  async getTimeline(transactionId: string): Promise<TransactionStateLog[]> {
    await this.findOrThrow(transactionId);
    return this.stateLogRepo.findByTransactionId(transactionId);
  }

  // ----------------------------------------------------------------
  // GET /api/v1/payments?merchant_order_id=
  // ----------------------------------------------------------------
  async findByMerchantOrderId(merchantId: string, merchantOrderId: string): Promise<Transaction> {
    const transaction = await this.transactionRepo.findByMerchantOrderId(
      merchantId,
      merchantOrderId,
    );

    if (!transaction) {
      throw new NotFoundException(`Transaction not found for order ${merchantOrderId}`);
    }

    return transaction;
  }

  // ----------------------------------------------------------------
  // GET /api/v1/payments (list, no merchant_order_id) — A.6.1
  // merchantId, when passed, is a hard filter — callers are
  // responsible for always supplying it for merchant-scoped callers
  // (see transactions.controller.ts's use of @CurrentMerchant).
  // ----------------------------------------------------------------
  async listPayments(filters: {
    merchantId?: string;
    state?: TransactionState;
    gateway?: PaymentGateway;
    fromDate?: Date;
    toDate?: Date;
    page: number;
    pageSize: number;
  }): Promise<ListPaymentsResponseDto> {
    const { data, total } = await this.transactionRepo.findPaginated(filters);

    return {
      data: data.map((txn) => PaymentResponseDto.fromEntity(txn)),
      page: filters.page,
      pageSize: filters.pageSize,
      total,
      totalPages: Math.ceil(total / filters.pageSize),
    };
  }

  // ----------------------------------------------------------------
  // Analytics
  // ----------------------------------------------------------------
  async getSuccessRateAnalytics(fromDate: Date, toDate: Date, merchantId?: string) {
    return this.transactionRepo.getSuccessRateByGateway(fromDate, toDate, merchantId);
  }

  async getVolumeAnalytics(fromDate: Date, toDate: Date, merchantId?: string) {
    return this.transactionRepo.getVolumeByDay(fromDate, toDate, merchantId);
  }

  // ----------------------------------------------------------------
  // Internal helpers
  // ----------------------------------------------------------------
  private async findOrThrow(id: string): Promise<Transaction> {
    const transaction = await this.transactionRepo.findById(id);

    if (!transaction) {
      throw new NotFoundException(`Transaction not found: ${id}`);
    }

    return transaction;
  }
}

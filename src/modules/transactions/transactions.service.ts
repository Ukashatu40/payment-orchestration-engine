// src/modules/transactions/transactions.service.ts (excerpt)
// Demonstrates the lock → intermediate state → release → gateway → lock → final state pattern
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TransactionStateMachineService } from './state-machine/transaction-state-machine.service';
import { GatewayRouterService } from '../gateway-router/gateway-router.service';
import { InitiatePaymentDto } from './dto/initiate-payment.dto';
import { Transaction, TransactionState } from './entities/transaction.entity';

@Injectable()
export class TransactionsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly stateMachine: TransactionStateMachineService,
    private readonly gatewayRouter: GatewayRouterService,
  ) {}
  async initiatePayment(dto: InitiatePaymentDto): Promise<Transaction> {
    // ── Phase 1: Acquire lock, write AUTH_INITIATED, RELEASE LOCK ──────────
    // The lock is released the moment this .transaction() block returns.
    // Connection is returned to pool. Gateway call happens OUTSIDE the lock.
    const { transaction, gateway, gatewayOrderId } =
      await this.dataSource.transaction(async (manager) => {
        // SELECT FOR UPDATE happens inside stateMachine.transition()
        const txn = await this.stateMachine.transition(
          dto.transactionId,
          TransactionState.AUTH_INITIATED,
          {
            event: 'PAYMENT_INITIATION_REQUESTED',
            triggeredBy: 'api_server',
            traceId: dto.traceId,
          },
          manager, // pass the manager so the lock is scoped to this txn
        );

        const selectedGateway = await this.gatewayRouter.selectGateway(
          dto.paymentMethod,
          manager,
        );

        return { transaction: txn, gateway: selectedGateway };
      });
    // ── Lock released here. DB connection back in pool. ────────────────────

    // ── Phase 2: Gateway call — no DB lock held ────────────────────────────
    // If the process crashes here, the reconciliation engine (Section A5.5)
    // will poll the gateway and recover the state. (FS-11)
    let gatewayResult: GatewayAuthResult;
    try {
      gatewayResult = await gateway.authorise({
        transactionId: transaction.id,
        amountPaise: transaction.amountPaise,
        currency: transaction.currency,
        traceId: dto.traceId,
      });
    } catch (err) {
      // Gateway call failed — write AUTH_FAILED/AUTH_TIMEOUT state
      // Acquire a new lock for this second transition
      await this.stateMachine.transition(
        transaction.id,
        err instanceof GatewayTimeoutError
          ? TransactionState.AUTH_TIMEOUT // → triggers failover (FS-01)
          : TransactionState.AUTH_FAILED,
        {
          event: 'GATEWAY_AUTH_ERROR',
          triggeredBy: 'api_server',
          traceId: dto.traceId,
          metadata: { error: err.message },
        },
      );
      throw err;
    }

    // ── Phase 3: Acquire new lock, write final state, release ──────────────
    return this.stateMachine.transition(
      transaction.id,
      TransactionState.AUTHORISED,
      {
        event: 'GATEWAY_AUTH_SUCCESS',
        triggeredBy: 'api_server',
        traceId: dto.traceId,
        gatewayReference: gatewayResult.paymentId,
        gatewayResponse: gatewayResult.rawResponse,
      },
    );
  }
}

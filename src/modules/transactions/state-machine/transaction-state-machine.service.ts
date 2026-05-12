// src/modules/transactions/state-machine/transaction-state-machine.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { Transaction } from '../entities/transaction.entity';
import { TransactionStateLog } from '../entities/transaction-state-log.entity';
import { TransactionState } from '../../../common/enums/transaction-state.enum';
import { VALID_TRANSITIONS, TERMINAL_STATES } from './state-transitions.map';
import { TransitionContext } from './interfaces/transition-context.interface';
import { sanitisePII } from './pii-sanitiser';
import { InvalidStateTransitionException } from '../../../common/exceptions';

@Injectable()
export class TransactionStateMachineService {
  private readonly logger = new Logger(TransactionStateMachineService.name);

  constructor(private readonly dataSource: DataSource) {}

  // ----------------------------------------------------------------
  // Primary method — the ONLY way state changes in this system.
  //
  // Concurrency strategy (Section A8.1):
  // 1. Acquire pessimistic row lock  (SELECT FOR UPDATE)
  // 2. Validate current state
  // 3. Write new state + audit log   (lock still held)
  // 4. Commit → lock auto-released
  //
  // The caller makes any gateway API calls OUTSIDE this method,
  // between two separate calls to transition().
  // This ensures the DB lock is never held during external I/O.
  // ----------------------------------------------------------------
  async transition(
    transactionId: string,
    toState: TransactionState,
    context: TransitionContext,
    // Optional: caller can pass an existing EntityManager to
    // participate in a larger transaction (e.g. idempotency check
    // and state transition in one atomic operation)
    entityManager?: EntityManager,
  ): Promise<Transaction> {
    const manager = entityManager ?? this.dataSource.manager;

    return manager.transaction(async (txnManager) => {
      // Step 1: Acquire pessimistic write lock on this transaction row.
      // Any concurrent request for the same transaction will block here
      // until this transaction commits. Satisfies FS-09.
      const transaction = await txnManager
        .createQueryBuilder(Transaction, 'txn')
        .setLock('pessimistic_write')
        .where('txn.id = :id', { id: transactionId })
        .getOne();

      if (!transaction) {
        throw new Error(`Transaction not found: ${transactionId}`);
      }

      const fromState = transaction.state;

      // Step 2: Validate the transition is permitted.
      // Throws InvalidStateTransitionException if not.
      // Satisfies FS-15 (corruption attempt rejection).
      this.assertValidTransition(transactionId, fromState, toState);

      // Step 3: Handle duplicate transition gracefully.
      // This covers FS-06 — webhook arrives before API response,
      // both attempt to set state to CAPTURED. Second attempt is
      // silently ignored, no error, no double processing.
      if (fromState === toState) {
        this.logger.warn('Duplicate transition attempt ignored', {
          transactionId,
          state: fromState,
          event: context.event,
          traceId: context.traceId,
        });
        return transaction;
      }

      // Step 4: Update transaction state and bump version.
      await txnManager
        .createQueryBuilder()
        .update(Transaction)
        .set({
          state: toState,
          version: () => 'version + 1',
          updatedAt: new Date(),
          ...(context.gatewayReference && {
            gatewayReference: context.gatewayReference,
          }),
        })
        .where('id = :id', { id: transactionId })
        .execute();

      // Step 5: Write immutable audit log entry.
      // PII is redacted before storage (Section A2.3, PCI-DSS).
      const sanitisedResponse = context.gatewayResponse
        ? sanitisePII(context.gatewayResponse)
        : null;

      const logEntry = txnManager.create(TransactionStateLog, {
        transactionId,
        fromState,
        toState,
        event: context.event,
        triggeredBy: context.triggeredBy,
        traceId: context.traceId,
        gatewayReference: context.gatewayReference ?? null,
        gatewayResponse: sanitisedResponse,
        metadata: context.metadata ?? {},
      });

      await txnManager.save(TransactionStateLog, logEntry);

      // Step 6: Structured log for distributed tracing (Section A8.5).
      this.logger.log('State transition committed', {
        transactionId,
        fromState,
        toState,
        event: context.event,
        triggeredBy: context.triggeredBy,
        traceId: context.traceId,
      });

      transaction.state = toState;
      return transaction;
    });
  }

  // ----------------------------------------------------------------
  // Pure validation — synchronous, no DB calls.
  // Called by transition() internally.
  // Also called directly in unit tests to validate the map.
  // ----------------------------------------------------------------
  assertValidTransition(
    transactionId: string,
    fromState: TransactionState,
    toState: TransactionState,
  ): void {
    // Terminal states have no valid outgoing transitions
    if (TERMINAL_STATES.has(fromState)) {
      throw new InvalidStateTransitionException(
        transactionId,
        fromState,
        toState,
        [],
      );
    }

    const validTargets = VALID_TRANSITIONS.get(fromState);

    // fromState not in the map at all — should never happen
    // if VALID_TRANSITIONS is complete, but guard defensively
    if (!validTargets) {
      throw new InvalidStateTransitionException(
        transactionId,
        fromState,
        toState,
        [],
      );
    }

    if (!validTargets.has(toState)) {
      throw new InvalidStateTransitionException(
        transactionId,
        fromState,
        toState,
        Array.from(validTargets),
      );
    }
  }

  // ----------------------------------------------------------------
  // Read-only helpers — no DB calls
  // ----------------------------------------------------------------
  isTerminal(state: TransactionState): boolean {
    return TERMINAL_STATES.has(state);
  }

  getValidTransitions(state: TransactionState): TransactionState[] {
    return Array.from(VALID_TRANSITIONS.get(state) ?? []);
  }

  canTransition(
    fromState: TransactionState,
    toState: TransactionState,
  ): boolean {
    return VALID_TRANSITIONS.get(fromState)?.has(toState) ?? false;
  }
}

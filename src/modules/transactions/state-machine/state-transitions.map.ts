// src/modules/transactions/state-machine/state-transitions.map.ts

import { TransactionState } from '../../../common/enums/transaction-state.enum';

// Every valid transition in the system.
// To add a new transition: add it here and nowhere else.
// Satisfies FS-15 — any attempt to transition outside this map
// throws InvalidStateTransitionException before reaching the DB.
export const VALID_TRANSITIONS: ReadonlyMap<
  TransactionState,
  ReadonlySet<TransactionState>
> = new Map([
  [
    TransactionState.CREATED,
    new Set([TransactionState.ROUTE_SELECTED, TransactionState.ABANDONED]),
  ],

  [
    TransactionState.ROUTE_SELECTED,
    new Set([TransactionState.AUTH_INITIATED, TransactionState.ROUTE_FAILED]),
  ],

  [
    TransactionState.AUTH_INITIATED,
    new Set([
      TransactionState.AUTHORISED,
      TransactionState.AUTH_FAILED,
      TransactionState.AUTH_TIMEOUT,
      TransactionState.AUTH_EXPIRED, // UPI mandate window elapsed (FS-12)
    ]),
  ],

  [
    TransactionState.AUTHORISED,
    new Set([
      TransactionState.CAPTURE_INITIATED,
      TransactionState.VOID_INITIATED,
      TransactionState.AUTH_EXPIRED, // gateway hold period elapsed
    ]),
  ],

  [
    TransactionState.AUTH_FAILED,
    new Set([
      TransactionState.ROUTE_SELECTED, // retry with different gateway
      TransactionState.FAILED, // max retries exceeded
    ]),
  ],

  [
    TransactionState.AUTH_TIMEOUT,
    new Set([
      TransactionState.ROUTE_SELECTED, // failover to next gateway (FS-01)
      TransactionState.FAILED, // all gateways exhausted
    ]),
  ],

  [
    TransactionState.CAPTURE_INITIATED,
    new Set([
      TransactionState.CAPTURED,
      TransactionState.PARTIALLY_CAPTURED,
      TransactionState.CAPTURE_FAILED,
    ]),
  ],

  [
    TransactionState.CAPTURED,
    new Set([
      TransactionState.REFUND_INITIATED,
      TransactionState.SETTLED,
      TransactionState.DISPUTE_OPENED,
    ]),
  ],

  [
    TransactionState.PARTIALLY_CAPTURED,
    new Set([
      TransactionState.CAPTURE_INITIATED, // capture the remainder (FS-05)
      TransactionState.REFUND_INITIATED,
      TransactionState.SETTLED,
    ]),
  ],

  [
    TransactionState.CAPTURE_FAILED,
    new Set([
      TransactionState.CAPTURE_INITIATED, // retry capture (FS-04)
      TransactionState.VOID_INITIATED, // give up, void the auth
    ]),
  ],

  [
    TransactionState.VOID_INITIATED,
    new Set([
      TransactionState.VOIDED,
      TransactionState.CAPTURE_INITIATED, // void failed, retry capture
    ]),
  ],

  [
    TransactionState.REFUND_INITIATED,
    new Set([
      TransactionState.REFUNDED,
      TransactionState.PARTIALLY_REFUNDED,
      TransactionState.REFUND_FAILED,
    ]),
  ],

  [
    TransactionState.REFUND_FAILED,
    new Set([
      TransactionState.REFUND_INITIATED, // retry refund
    ]),
  ],

  [
    TransactionState.SETTLED,
    new Set([
      TransactionState.REFUND_INITIATED, // refund within window (FS-08)
      TransactionState.DISPUTE_OPENED,
    ]),
  ],

  [
    TransactionState.DISPUTE_OPENED,
    new Set([TransactionState.DISPUTE_RESOLVED]),
  ],

  // Terminal states — empty sets, no outgoing transitions allowed
  [TransactionState.REFUNDED, new Set()],
  [TransactionState.PARTIALLY_REFUNDED, new Set()],
  [TransactionState.VOIDED, new Set()],
  [TransactionState.FAILED, new Set()],
  [TransactionState.ABANDONED, new Set()],
  [TransactionState.ROUTE_FAILED, new Set()],
  [TransactionState.AUTH_EXPIRED, new Set()],
  [TransactionState.DISPUTE_RESOLVED, new Set()],
]);

// All states from which no further transition is possible.
// Used by the state machine to fast-fail transition attempts
// on already-terminal transactions.
export const TERMINAL_STATES: ReadonlySet<TransactionState> = new Set([
  TransactionState.REFUNDED,
  TransactionState.PARTIALLY_REFUNDED,
  TransactionState.VOIDED,
  TransactionState.FAILED,
  TransactionState.ABANDONED,
  TransactionState.ROUTE_FAILED,
  TransactionState.AUTH_EXPIRED,
  TransactionState.DISPUTE_RESOLVED,
]);

// States where a gateway hold on customer funds exists.
// Reconciliation engine uses this to find transactions
// that need gateway status polling (Section A5.5).
export const STATES_WITH_ACTIVE_HOLD: ReadonlySet<TransactionState> = new Set([
  TransactionState.AUTHORISED,
  TransactionState.CAPTURE_INITIATED,
  TransactionState.PARTIALLY_CAPTURED,
  TransactionState.VOID_INITIATED,
]);

// States the reconciliation engine considers "stale"
// if stuck for longer than gateway expected response time.
// Used by the batch job to build its polling query (Section A5.5).
export const RECONCILABLE_STATES: ReadonlySet<TransactionState> = new Set([
  TransactionState.AUTH_INITIATED,
  TransactionState.CAPTURE_INITIATED,
  TransactionState.REFUND_INITIATED,
  TransactionState.VOID_INITIATED,
]);

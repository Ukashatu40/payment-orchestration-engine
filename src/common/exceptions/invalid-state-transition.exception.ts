// src/common/exceptions/invalid-state-transition.exception.ts

import { TransactionState } from '../enums/transaction-state.enum';

export class InvalidStateTransitionException extends Error {
  public readonly transactionId: string;
  public readonly fromState: TransactionState;
  public readonly toState: TransactionState;
  public readonly validTargets: TransactionState[];

  constructor(
    transactionId: string,
    fromState: TransactionState,
    toState: TransactionState,
    validTargets: TransactionState[],
  ) {
    super(
      `Invalid state transition for transaction ${transactionId}: ` +
        `${fromState} → ${toState}. ` +
        `Valid targets from ${fromState}: [${validTargets.join(', ')}]`,
    );

    this.name = 'InvalidStateTransitionException';
    this.transactionId = transactionId;
    this.fromState = fromState;
    this.toState = toState;
    this.validTargets = validTargets;

    Error.captureStackTrace(this, InvalidStateTransitionException);
  }
}

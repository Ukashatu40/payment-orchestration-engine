// src/common/exceptions/idempotency-conflict.exception.ts

export class IdempotencyConflictException extends Error {
  public readonly idempotencyKey: string;
  public readonly merchantId: string;

  constructor(idempotencyKey: string, merchantId: string) {
    super(
      `Request with idempotency key ${idempotencyKey} ` +
        `is already being processed for merchant ${merchantId}`,
    );

    this.name = 'IdempotencyConflictException';
    this.idempotencyKey = idempotencyKey;
    this.merchantId = merchantId;

    Error.captureStackTrace(this, IdempotencyConflictException);
  }
}

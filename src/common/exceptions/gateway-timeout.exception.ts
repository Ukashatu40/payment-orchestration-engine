// src/common/exceptions/gateway-timeout.exception.ts

export class GatewayTimeoutException extends Error {
  public readonly gateway: string;
  public readonly timeoutMs: number;
  public readonly transactionId: string;

  constructor(gateway: string, timeoutMs: number, transactionId: string) {
    super(
      `Gateway ${gateway} timed out after ${timeoutMs}ms ` + `for transaction ${transactionId}`,
    );

    this.name = 'GatewayTimeoutException';
    this.gateway = gateway;
    this.timeoutMs = timeoutMs;
    this.transactionId = transactionId;

    Error.captureStackTrace(this, GatewayTimeoutException);
  }
}

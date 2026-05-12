// src/common/exceptions/gateway-unavailable.exception.ts

export class GatewayUnavailableException extends Error {
  public readonly gateway: string;
  public readonly reason: string;

  constructor(gateway: string, reason: string) {
    super(`Gateway ${gateway} is unavailable: ${reason}`);

    this.name = 'GatewayUnavailableException';
    this.gateway = gateway;
    this.reason = reason;

    Error.captureStackTrace(this, GatewayUnavailableException);
  }
}

// src/common/exceptions/webhook-signature-invalid.exception.ts

export class WebhookSignatureInvalidException extends Error {
  public readonly gateway: string;

  constructor(gateway: string) {
    super(`Webhook signature verification failed for gateway ${gateway}`);

    this.name = 'WebhookSignatureInvalidException';
    this.gateway = gateway;

    Error.captureStackTrace(this, WebhookSignatureInvalidException);
  }
}

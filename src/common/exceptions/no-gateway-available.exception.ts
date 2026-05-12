// src/common/exceptions/no-gateway-available.exception.ts

import { PaymentMethod } from '../enums/payment-method.enum';

export class NoGatewayAvailableException extends Error {
  public readonly paymentMethod: PaymentMethod;

  constructor(paymentMethod: PaymentMethod) {
    super(`No healthy gateway available for payment method ${paymentMethod}`);

    this.name = 'NoGatewayAvailableException';
    this.paymentMethod = paymentMethod;

    Error.captureStackTrace(this, NoGatewayAvailableException);
  }
}

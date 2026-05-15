// src/modules/transactions/interfaces/initiate-payment.interface.ts

import { PaymentMethod } from '../../../common/enums';

export interface InitiatePaymentDto {
  merchantId: string;
  merchantOrderId: string;
  amountPaise: bigint;
  currency: string;
  paymentMethod: PaymentMethod;
  idempotencyKey: string;
  traceId: string;
  metadata?: Record<string, unknown>;
}

export interface CapturePaymentDto {
  transactionId: string;
  amountPaise?: bigint; // omit = capture full authorised amount
  traceId: string;
  triggeredBy: string;
}

export interface RefundPaymentDto {
  transactionId: string;
  amountPaise: bigint;
  reason?: string;
  idempotencyKey: string;
  traceId: string;
  triggeredBy: string;
}

export interface VoidPaymentDto {
  transactionId: string;
  traceId: string;
  triggeredBy: string;
}

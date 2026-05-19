// src/modules/transactions/interfaces/initiate-payment.interface.ts

import { PaymentMethod } from '../../../common/enums';

export interface InitiatePaymentDto {
  merchantId: string;
  merchantOrderId: string;
  amountPaise: number; // number from DTO, converted to bigint when saving
  currency: string;
  paymentMethod: PaymentMethod;
  idempotencyKey: string;
  traceId: string;
  metadata?: Record<string, unknown>;
}

export interface CapturePaymentDto {
  transactionId: string;
  amountPaise?: number;
  traceId: string;
  triggeredBy: string;
}

export interface RefundPaymentDto {
  transactionId: string;
  amountPaise: number;
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

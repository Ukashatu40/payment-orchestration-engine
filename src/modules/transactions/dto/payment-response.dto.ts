// src/modules/transactions/dto/payment-response.dto.ts

import {
  TransactionState,
  PaymentGateway,
  PaymentMethod,
} from '../../../common/enums';
import { Transaction } from '../entities/transaction.entity';

// Shapes the API response — converts bigint to number for JSON
export class PaymentResponseDto {
  id!: string;
  merchantId!: string;
  merchantOrderId!: string;
  amountPaise!: number; // bigint → number for JSON serialisation
  amountRupees!: number;
  capturedPaise!: number;
  refundedPaise!: number;
  currency!: string;
  state!: TransactionState;
  paymentMethod!: PaymentMethod;
  gateway!: PaymentGateway | null;
  gatewayPaymentId!: string | null;
  gatewayReference!: string | null;
  traceId!: string;
  createdAt!: Date;
  updatedAt!: Date;

  static fromEntity(txn: Transaction): PaymentResponseDto {
    const dto = new PaymentResponseDto();
    dto.id = txn.id;
    dto.merchantId = txn.merchantId;
    dto.merchantOrderId = txn.merchantOrderId;
    dto.amountPaise = Number(txn.amountPaise);
    dto.amountRupees = Number(txn.amountPaise) / 100;
    dto.capturedPaise = Number(txn.capturedPaise);
    dto.refundedPaise = Number(txn.refundedPaise);
    dto.currency = txn.currency;
    dto.state = txn.state;
    dto.paymentMethod = txn.paymentMethod;
    dto.gateway = txn.gateway;
    dto.gatewayPaymentId = txn.gatewayPaymentId;
    dto.gatewayReference = txn.gatewayReference;
    dto.traceId = txn.traceId;
    dto.createdAt = txn.createdAt;
    dto.updatedAt = txn.updatedAt;
    return dto;
  }
}

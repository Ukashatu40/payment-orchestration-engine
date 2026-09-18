// src/modules/transactions/dto/payment-response.dto.ts

import { ApiProperty } from '@nestjs/swagger';
import { TransactionState, PaymentGateway, PaymentMethod } from '../../../common/enums';
import { Transaction } from '../entities/transaction.entity';

// Shapes the API response — converts bigint to number for JSON
export class PaymentResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  merchantId!: string;

  @ApiProperty()
  merchantOrderId!: string;

  @ApiProperty({ description: 'bigint → number for JSON serialisation' })
  amountPaise!: number;

  @ApiProperty()
  amountRupees!: number;

  @ApiProperty()
  capturedPaise!: number;

  @ApiProperty()
  refundedPaise!: number;

  @ApiProperty()
  currency!: string;

  @ApiProperty({ enum: TransactionState })
  state!: TransactionState;

  @ApiProperty({ enum: PaymentMethod })
  paymentMethod!: PaymentMethod;

  @ApiProperty({ enum: PaymentGateway, nullable: true })
  gateway!: PaymentGateway | null;

  @ApiProperty({ type: String, nullable: true })
  gatewayPaymentId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  gatewayReference!: string | null;

  @ApiProperty()
  traceId!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
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

// src/modules/transactions/dto/refund-response.dto.ts

import { Refund } from '../entities/refund.entity';
import { PaymentGateway, RefundState } from '../../../common/enums';

export class RefundResponseDto {
  id!: string;
  transactionId!: string;
  amountPaise!: number;
  amountRupees!: number;
  currency!: string;
  state!: RefundState;
  gateway!: PaymentGateway;
  gatewayRefundId!: string | null;
  reason!: string | null;
  createdAt!: Date;
  updatedAt!: Date;

  static fromEntity(refund: Refund): RefundResponseDto {
    const dto = new RefundResponseDto();
    dto.id = refund.id;
    dto.transactionId = refund.transactionId;
    dto.amountPaise = Number(refund.amountPaise);
    dto.amountRupees = Number(refund.amountPaise) / 100;
    dto.currency = refund.currency;
    dto.state = refund.state;
    dto.gateway = refund.gateway;
    dto.gatewayRefundId = refund.gatewayRefundId;
    dto.reason = refund.reason ?? null;
    dto.createdAt = refund.createdAt;
    dto.updatedAt = refund.updatedAt;
    return dto;
  }
}

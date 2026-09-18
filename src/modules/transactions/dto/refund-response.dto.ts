// src/modules/transactions/dto/refund-response.dto.ts

import { ApiProperty } from '@nestjs/swagger';
import { Refund } from '../entities/refund.entity';
import { PaymentGateway, RefundState } from '../../../common/enums';

export class RefundResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  transactionId!: string;

  @ApiProperty()
  amountPaise!: number;

  @ApiProperty()
  amountRupees!: number;

  @ApiProperty()
  currency!: string;

  @ApiProperty({ enum: RefundState })
  state!: RefundState;

  @ApiProperty({ enum: PaymentGateway })
  gateway!: PaymentGateway;

  @ApiProperty({ type: String, nullable: true })
  gatewayRefundId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  reason!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
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

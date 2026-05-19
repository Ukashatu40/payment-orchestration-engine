// src/modules/transactions/dto/refund-payment.dto.ts

import { IsString, IsOptional, IsInt, Min, IsNotEmpty } from 'class-validator';

export class RefundPaymentRequestDto {
  @IsInt()
  @Min(1)
  amountPaise!: number;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsString()
  @IsNotEmpty()
  idempotencyKey!: string;
}

// src/modules/transactions/dto/refund-payment.dto.ts

import { IsString, IsOptional, Min, IsNotEmpty } from 'class-validator';
import { Transform } from 'class-transformer';

export class RefundPaymentRequestDto {
  @Transform(({ value }) => BigInt(value))
  @Min(1)
  amountPaise: bigint;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsString()
  @IsNotEmpty()
  idempotencyKey: string;
}

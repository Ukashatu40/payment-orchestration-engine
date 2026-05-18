// src/modules/transactions/dto/refund-payment.dto.ts

import { IsString, IsOptional, IsInt, Min, IsNotEmpty } from 'class-validator';
import { Transform } from 'class-transformer';

export class RefundPaymentRequestDto {
  @IsInt()
  @Min(1)
  @Transform(({ value }) => BigInt(Number(value)))
  amountPaise!: bigint;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsString()
  @IsNotEmpty()
  idempotencyKey!: string;
}

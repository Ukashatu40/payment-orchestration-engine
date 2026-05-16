// src/modules/transactions/dto/capture-payment.dto.ts

import { IsOptional, Min } from 'class-validator';
import { Transform } from 'class-transformer';

export class CapturePaymentRequestDto {
  // Optional — omit to capture full authorised amount (FS-05)
  @IsOptional()
  @Transform(({ value }) => (value !== undefined ? BigInt(value) : undefined))
  @Min(1)
  amountPaise?: bigint;
}

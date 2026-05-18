// src/modules/transactions/dto/capture-payment.dto.ts

import { IsOptional, IsInt, Min } from 'class-validator';
import { Transform } from 'class-transformer';

export class CapturePaymentRequestDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Transform(({ value }) =>
    value !== undefined ? BigInt(Number(value)) : undefined,
  )
  amountPaise?: bigint;
}

// src/modules/transactions/dto/capture-payment.dto.ts

import { IsOptional, IsInt, Min } from 'class-validator';

export class CapturePaymentRequestDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  amountPaise?: number;
}

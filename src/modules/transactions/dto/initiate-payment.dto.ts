// src/modules/transactions/dto/initiate-payment.dto.ts

import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsOptional,
  IsObject,
  IsInt,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { PaymentMethod } from '../../../common/enums';

export class InitiatePaymentRequestDto {
  @IsString()
  @IsNotEmpty()
  merchantOrderId!: string;

  // Store as bigint but validate the raw number before transforming
  // class-validator @Min does not support bigint — validate as number first
  @IsInt()
  @Min(1)
  @Transform(({ value }) => {
    const num = Number(value);
    if (!Number.isInteger(num) || num < 1) {
      throw new Error('amountPaise must be a positive integer');
    }
    return BigInt(num);
  })
  amountPaise!: bigint;

  @IsString()
  @IsNotEmpty()
  currency: string = 'INR';

  @IsEnum(PaymentMethod)
  paymentMethod!: PaymentMethod;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

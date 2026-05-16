// src/modules/transactions/dto/initiate-payment.dto.ts

import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsOptional,
  IsObject,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { PaymentMethod } from '../../../common/enums';

export class InitiatePaymentRequestDto {
  @IsString()
  @IsNotEmpty()
  merchantOrderId: string;

  // Accepts number from JSON body, transforms to bigint
  // Validation runs after transform
  @Transform(({ value }) => BigInt(value))
  @Min(1)
  amountPaise: bigint;

  @IsString()
  @IsNotEmpty()
  currency: string = 'INR';

  @IsEnum(PaymentMethod)
  paymentMethod: PaymentMethod;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

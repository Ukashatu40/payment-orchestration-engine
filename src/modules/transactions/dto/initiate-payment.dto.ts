// src/modules/transactions/dto/initiate-payment.dto.ts

import { IsString, IsNotEmpty, IsEnum, IsOptional, IsObject, IsInt, Min } from 'class-validator';
import { PaymentMethod } from '../../../common/enums';

export class InitiatePaymentRequestDto {
  @IsString()
  @IsNotEmpty()
  merchantOrderId!: string;

  // Keep as number — TypeORM handles number → BIGINT conversion
  // Services convert to bigint when passing to entities
  @IsInt()
  @Min(1)
  amountPaise!: number;

  @IsString()
  @IsNotEmpty()
  currency: string = 'INR';

  @IsEnum(PaymentMethod)
  paymentMethod!: PaymentMethod;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

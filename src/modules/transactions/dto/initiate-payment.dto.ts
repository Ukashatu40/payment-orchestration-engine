// src/modules/transactions/dto/initiate-payment.dto.ts

import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsOptional,
  IsObject,
  IsInt,
  IsEmail,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentMethod } from '../../../common/enums';

export class InitiatePaymentRequestDto {
  @ApiProperty({ description: "Your own order/reference ID — must be unique per merchant" })
  @IsString()
  @IsNotEmpty()
  merchantOrderId!: string;

  // Keep as number — TypeORM handles number → BIGINT conversion
  // Services convert to bigint when passing to entities
  @ApiProperty({ minimum: 1, description: 'Amount in minor units (e.g. paise, kobo)' })
  @IsInt()
  @Min(1)
  amountPaise!: number;

  @ApiProperty({ default: 'INR' })
  @IsString()
  @IsNotEmpty()
  currency: string = 'INR';

  @ApiProperty({ enum: PaymentMethod })
  @IsEnum(PaymentMethod)
  paymentMethod!: PaymentMethod;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @ApiPropertyOptional({
    description:
      'Customer email — required by some gateways (e.g. Paystack, Flutterwave) to authorise a charge. Falls back to a merchant-scoped placeholder if omitted, which those gateways will reject.',
  })
  @IsOptional()
  @IsEmail()
  customerEmail?: string;
}

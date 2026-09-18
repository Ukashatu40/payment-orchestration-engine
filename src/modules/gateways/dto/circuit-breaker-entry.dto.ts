// src/modules/gateways/dto/circuit-breaker-entry.dto.ts

import { ApiProperty } from '@nestjs/swagger';
import { PaymentGateway, PaymentMethod } from '../../../common/enums';
import { CircuitBreakerState } from '../circuit-breaker/circuit-breaker-state.enum';

export class CircuitBreakerEntryDto {
  @ApiProperty({ enum: PaymentGateway })
  gateway!: PaymentGateway;

  @ApiProperty({ enum: PaymentMethod, nullable: true, description: 'null = applies to all methods' })
  paymentMethod!: PaymentMethod | null;

  @ApiProperty({ enum: CircuitBreakerState })
  state!: CircuitBreakerState;

  @ApiProperty()
  failureCount!: number;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  lastFailureAt!: Date | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  openedAt!: Date | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  halfOpenAt!: Date | null;

  @ApiProperty()
  successCountInHalfOpen!: number;
}

// src/modules/gateways/dto/gateway-health.dto.ts

import { ApiProperty } from '@nestjs/swagger';
import { PaymentGateway } from '../../../common/enums';
import { CircuitBreakerEntryDto } from './circuit-breaker-entry.dto';

export class GatewayHealthDto {
  @ApiProperty({ enum: PaymentGateway })
  gateway!: PaymentGateway;

  @ApiProperty()
  isEnabled!: boolean;

  @ApiProperty({ description: 'Consecutive failure count that trips the circuit breaker open' })
  cbFailureThreshold!: number;

  @ApiProperty({ type: [CircuitBreakerEntryDto] })
  circuitBreakerStates!: CircuitBreakerEntryDto[];
}

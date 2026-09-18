// src/modules/gateways/dto/gateway-summary.dto.ts

import { ApiProperty } from '@nestjs/swagger';
import { PaymentGateway } from '../../../common/enums';
import { CircuitBreakerState } from '../circuit-breaker/circuit-breaker-state.enum';

export class GatewaySummaryDto {
  @ApiProperty({ enum: PaymentGateway })
  gateway!: PaymentGateway;

  @ApiProperty()
  isEnabled!: boolean;

  @ApiProperty({ description: '0-1 rolling health score derived from the circuit breaker' })
  healthScore!: number;

  @ApiProperty({ enum: CircuitBreakerState, required: false })
  circuitState?: CircuitBreakerState;

  @ApiProperty({ type: [String] })
  supportedMethods!: string[];
}

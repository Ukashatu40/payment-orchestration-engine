// src/modules/gateways/dto/gateway-metrics.dto.ts

import { ApiProperty } from '@nestjs/swagger';
import { PaymentGateway } from '../../../common/enums';

export class GatewayMetricsDto {
  @ApiProperty({ enum: PaymentGateway })
  gateway!: PaymentGateway;

  @ApiProperty({ description: 'Fraction between 0 and 1' })
  successRate!: number;

  @ApiProperty()
  p95LatencyMs!: number;

  @ApiProperty()
  totalCount!: number;
}

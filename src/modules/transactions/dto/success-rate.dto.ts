// src/modules/transactions/dto/success-rate.dto.ts

import { ApiProperty } from '@nestjs/swagger';

export class SuccessRateByGatewayDto {
  @ApiProperty()
  gateway!: string;

  @ApiProperty({ description: 'Fraction between 0 and 1 (captured / total)' })
  successRate!: number;

  @ApiProperty()
  total!: number;
}

// src/modules/gateways/dto/update-routing-config.dto.ts

import { IsNumber, Min, Max } from 'class-validator';

export class UpdateRoutingConfigDto {
  @IsNumber()
  @Min(0)
  @Max(1)
  weightSuccessRate!: number;

  @IsNumber()
  @Min(0)
  @Max(1)
  weightLatency!: number;

  @IsNumber()
  @Min(0)
  @Max(1)
  weightCost!: number;

  @IsNumber()
  @Min(0)
  @Max(1)
  weightHealth!: number;

  @IsNumber()
  @Min(0)
  @Max(1)
  weightFit!: number;
}

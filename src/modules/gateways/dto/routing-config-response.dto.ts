// src/modules/gateways/dto/routing-config-response.dto.ts

import { ApiProperty } from '@nestjs/swagger';
import { RoutingConfig } from '../entities/routing-config.entity';

// Postgres `numeric` columns come back from pg as strings (no global type
// parser registered — see database.module.ts), not numbers, despite the
// entity declaring `number`. Coerce explicitly here rather than trusting
// the declared type, the same way PaymentResponseDto.fromEntity() coerces
// bigint columns.
export class RoutingConfigResponseDto {
  @ApiProperty()
  configKey!: string;

  @ApiProperty()
  weightSuccessRate!: number;

  @ApiProperty()
  weightLatency!: number;

  @ApiProperty()
  weightCost!: number;

  @ApiProperty()
  weightHealth!: number;

  @ApiProperty()
  weightFit!: number;

  @ApiProperty()
  slidingWindowMinutes!: number;

  @ApiProperty()
  degradedSkipThreshold!: number;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;

  static fromEntity(config: RoutingConfig): RoutingConfigResponseDto {
    const dto = new RoutingConfigResponseDto();
    dto.configKey = config.configKey;
    dto.weightSuccessRate = Number(config.weightSuccessRate);
    dto.weightLatency = Number(config.weightLatency);
    dto.weightCost = Number(config.weightCost);
    dto.weightHealth = Number(config.weightHealth);
    dto.weightFit = Number(config.weightFit);
    dto.slidingWindowMinutes = config.slidingWindowMinutes;
    dto.degradedSkipThreshold = Number(config.degradedSkipThreshold);
    dto.updatedAt = config.updatedAt;
    return dto;
  }
}

// src/modules/reconciliation/dto/resolve-anomaly-result.dto.ts

import { ApiProperty } from '@nestjs/swagger';

export class ResolveAnomalyResultDto {
  @ApiProperty()
  resolved!: boolean;
}

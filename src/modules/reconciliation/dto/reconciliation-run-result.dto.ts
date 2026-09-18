// src/modules/reconciliation/dto/reconciliation-run-result.dto.ts

import { ApiProperty } from '@nestjs/swagger';

export class ReconciliationRunResultDto {
  @ApiProperty({ format: 'uuid' })
  runId!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  startedAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  completedAt!: Date;

  @ApiProperty()
  totalChecked!: number;

  @ApiProperty()
  discrepanciesFound!: number;

  @ApiProperty()
  autoResolved!: number;

  @ApiProperty()
  requiresReview!: number;
}

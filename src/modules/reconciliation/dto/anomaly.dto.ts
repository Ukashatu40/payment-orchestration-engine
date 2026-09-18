// src/modules/reconciliation/dto/anomaly.dto.ts

import { ApiProperty } from '@nestjs/swagger';
import { PaymentGateway } from '../../../common/enums';
import { DiscrepancyType } from '../entities/reconciliation-log.entity';

export class AnomalyDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  runId!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  transactionId!: string | null;

  @ApiProperty({ enum: PaymentGateway, nullable: true })
  gateway!: PaymentGateway | null;

  @ApiProperty({ enum: DiscrepancyType, nullable: true })
  discrepancyType!: DiscrepancyType | null;

  @ApiProperty({ type: String, nullable: true })
  internalState!: string | null;

  @ApiProperty({ type: String, nullable: true })
  gatewayState!: string | null;

  @ApiProperty()
  requiresReview!: boolean;

  @ApiProperty()
  resolved!: boolean;

  @ApiProperty({ type: String, nullable: true })
  notes!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;
}

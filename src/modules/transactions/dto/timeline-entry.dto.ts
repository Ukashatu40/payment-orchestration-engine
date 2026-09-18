// src/modules/transactions/dto/timeline-entry.dto.ts

import { ApiProperty } from '@nestjs/swagger';
import { TransactionState } from '../../../common/enums';
import { TransactionStateLog } from '../entities/transaction-state-log.entity';

export class TimelineEntryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: TransactionState })
  fromState!: TransactionState;

  @ApiProperty({ enum: TransactionState })
  toState!: TransactionState;

  @ApiProperty()
  event!: string;

  @ApiProperty({ description: "e.g. 'api_server' | 'webhook_processor' | 'reconciliation_engine'" })
  triggeredBy!: string;

  @ApiProperty({ format: 'uuid' })
  traceId!: string;

  @ApiProperty({ type: String, nullable: true })
  gatewayReference!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  static fromEntity(log: TransactionStateLog): TimelineEntryDto {
    const dto = new TimelineEntryDto();
    dto.id = log.id;
    dto.fromState = log.fromState;
    dto.toState = log.toState;
    dto.event = log.event;
    dto.triggeredBy = log.triggeredBy;
    dto.traceId = log.traceId;
    dto.gatewayReference = log.gatewayReference;
    dto.createdAt = log.createdAt;
    return dto;
  }
}

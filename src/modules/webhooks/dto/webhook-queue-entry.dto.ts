// src/modules/webhooks/dto/webhook-queue-entry.dto.ts

import { ApiProperty } from '@nestjs/swagger';
import { PaymentGateway, WebhookStatus } from '../../../common/enums';

export class WebhookQueueEntryDto {
  @ApiProperty({ description: 'bigint PK, kept as a string to avoid precision loss' })
  id!: string;

  @ApiProperty({ enum: PaymentGateway })
  gateway!: PaymentGateway;

  @ApiProperty()
  eventId!: string;

  @ApiProperty({ type: 'object', additionalProperties: true })
  payload!: Record<string, unknown>;

  @ApiProperty({ enum: WebhookStatus })
  status!: WebhookStatus;

  @ApiProperty()
  retryCount!: number;

  @ApiProperty()
  maxRetries!: number;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  nextRetryAt!: Date | null;

  @ApiProperty({ type: String, nullable: true })
  errorMessage!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  processedAt!: Date | null;
}

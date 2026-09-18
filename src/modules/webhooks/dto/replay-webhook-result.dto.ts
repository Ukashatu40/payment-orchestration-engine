// src/modules/webhooks/dto/replay-webhook-result.dto.ts

import { ApiProperty } from '@nestjs/swagger';

export class ReplayWebhookResultDto {
  @ApiProperty()
  replayed!: true;
}

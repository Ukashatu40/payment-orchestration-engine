// src/modules/webhooks/dto/webhook-event.dto.ts

import { PaymentGateway } from '../../../common/enums';

// Internal shape passed from controller to queue service
// after signature verification
export class WebhookEventDto {
  gateway: PaymentGateway;
  eventId: string;
  eventType: string;
  payload: Record<string, unknown>;
  rawBody: Buffer;
  signature: string;
}

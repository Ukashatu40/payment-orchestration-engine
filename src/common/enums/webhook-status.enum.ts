// src/common/enums/webhook-status.enum.ts

export enum WebhookStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  DLQ = 'DLQ',
}

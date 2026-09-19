// src/modules/webhooks/webhooks.module.ts

import { Module } from '@nestjs/common';
import { WebhookSignatureService } from './verification/webhook-signature.service';
import { WebhookQueueService } from './webhook-queue.service';
import { WebhookProcessorService } from './webhook-processor.service';
import { WebhookWorkerService } from './webhook-worker.service';
import { WebhookQueueRepository } from './repositories/webhook-queue.repository';
import { ProcessedWebhookEventRepository } from './repositories/processed-webhook-event.repository';
import { WebhooksController } from './webhooks.controller';
import { TransactionsModule } from '../transactions/transactions.module';
import { GatewaysModule } from '../gateways/gateways.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [TransactionsModule, GatewaysModule, UsersModule],
  providers: [
    WebhookSignatureService,
    WebhookQueueService,
    WebhookProcessorService,
    WebhookWorkerService,
    WebhookQueueRepository,
    ProcessedWebhookEventRepository,
  ],
  controllers: [WebhooksController],
  exports: [WebhookQueueService, WebhookProcessorService],
})
export class WebhooksModule {}

// src/modules/webhooks/webhook-worker.service.ts

import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { WebhookQueueService } from './webhook-queue.service';
import { WebhookProcessorService } from './webhook-processor.service';

const POLL_INTERVAL_MS = 2_000;

// Drains webhook_queue. The controller only verifies + enqueues (so it can
// 200 fast); without this worker nothing ever consumes those rows and
// gateway confirmations never advance a transaction's state.
@Injectable()
export class WebhookWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhookWorkerService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly queueService: WebhookQueueService,
    private readonly processor: WebhookProcessorService,
  ) {}

  onModuleInit(): void {
    // Scenario tests call processOne() themselves and assert on the
    // intermediate queue state — a background drain would race them.
    if (process.env.NODE_ENV === 'test') return;

    this.timer = setInterval(() => void this.drain(), POLL_INTERVAL_MS);
    this.logger.log('Webhook worker started', { pollIntervalMs: POLL_INTERVAL_MS });
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const due = await this.queueService.fetchDue();
      for (const entry of due) {
        await this.processor.processOne(entry);
      }
    } catch (err) {
      this.logger.error('Webhook worker drain failed', { error: (err as Error).message });
    } finally {
      this.running = false;
    }
  }
}

// src/modules/webhooks/repositories/webhook-queue.repository.ts

import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { WebhookQueue } from '../entities/webhook-queue.entity';
import { WebhookStatus, PaymentGateway } from '../../../common/enums';

@Injectable()
export class WebhookQueueRepository {
  private readonly repo: Repository<WebhookQueue>;

  constructor(private readonly dataSource: DataSource) {
    this.repo = this.dataSource.getRepository(WebhookQueue);
  }

  async enqueue(data: Partial<WebhookQueue>): Promise<WebhookQueue> {
    const entry = this.repo.create({
      ...data,
      status: WebhookStatus.PENDING,
      nextRetryAt: new Date(),
    });
    return this.repo.save(entry);
  }

  // Fetch due webhooks for processing — uses the partial index
  // idx_webhook_queue_due for performance (Section A8.3)
  async findDue(limit = 50): Promise<WebhookQueue[]> {
    return this.repo
      .createQueryBuilder('wq')
      .where('wq.status IN (:...statuses)', {
        statuses: [WebhookStatus.PENDING, WebhookStatus.FAILED],
      })
      .andWhere('(wq.next_retry_at IS NULL OR wq.next_retry_at <= NOW())')
      .orderBy('wq.next_retry_at', 'ASC')
      .limit(limit)
      .getMany();
  }

  async markProcessing(id: string): Promise<void> {
    await this.repo.update(id, { status: WebhookStatus.PROCESSING });
  }

  async markCompleted(id: string): Promise<void> {
    await this.repo.update(id, {
      status: WebhookStatus.COMPLETED,
      processedAt: new Date(),
    });
  }

  // Exponential backoff: 1s → 2s → 4s (Section A8.3)
  async markFailedWithRetry(id: string, errorMessage: string, retryCount: number): Promise<void> {
    const maxRetries = 3;

    if (retryCount >= maxRetries) {
      await this.repo.update(id, {
        status: WebhookStatus.DLQ,
        retryCount,
        errorMessage,
      });
      return;
    }

    const backoffMs = Math.pow(2, retryCount) * 1000;
    const nextRetryAt = new Date(Date.now() + backoffMs);

    await this.repo.update(id, {
      status: WebhookStatus.FAILED,
      retryCount,
      errorMessage,
      nextRetryAt,
    });
  }

  async findDLQ(gateway?: PaymentGateway): Promise<WebhookQueue[]> {
    const query = this.repo
      .createQueryBuilder('wq')
      .where('wq.status = :status', { status: WebhookStatus.DLQ });

    if (gateway) {
      query.andWhere('wq.gateway = :gateway', { gateway });
    }

    return query.orderBy('wq.createdAt', 'DESC').getMany();
  }

  async requeueFromDLQ(id: string): Promise<void> {
    await this.repo.update(id, {
      status: WebhookStatus.PENDING,
      retryCount: 0,
      nextRetryAt: new Date(),
      errorMessage: null,
    });
  }
}

// src/modules/webhooks/repositories/processed-webhook-event.repository.ts

import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { ProcessedWebhookEvent } from '../entities/processed-webhook-event.entity';
import { PaymentGateway } from '../../../common/enums';

@Injectable()
export class ProcessedWebhookEventRepository {
  private readonly repo: Repository<ProcessedWebhookEvent>;

  constructor(private readonly dataSource: DataSource) {
    this.repo = this.dataSource.getRepository(ProcessedWebhookEvent);
  }

  // Check + insert must be atomic to prevent race conditions (Section A5.4)
  // Caller must pass an EntityManager that is inside an active transaction
  async insertIfNotExists(
    gateway: PaymentGateway,
    eventId: string,
    eventType: string,
    payloadHash: string,
    transactionId: string | null,
    entityManager: EntityManager,
  ): Promise<boolean> {
    const repo = entityManager.getRepository(ProcessedWebhookEvent);

    const result = await repo
      .createQueryBuilder()
      .insert()
      .into(ProcessedWebhookEvent)
      .values({ gateway, eventId, eventType, payloadHash, transactionId })
      .orIgnore() // ON CONFLICT (gateway, event_id) DO NOTHING
      .returning('event_id')
      .execute();

    // true = inserted (new event), false = already existed (duplicate)
    return result.raw.length > 0;
  }

  async findByGatewayAndEventId(
    gateway: PaymentGateway,
    eventId: string,
  ): Promise<ProcessedWebhookEvent | null> {
    return this.repo.findOne({ where: { gateway, eventId } });
  }
}

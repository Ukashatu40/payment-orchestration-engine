// test/scenarios/fs-02-duplicate-webhook.spec.ts

import { NestFastifyApplication } from '@nestjs/platform-fastify';
import * as crypto from 'crypto';
import { buildApp, closeApp, getDataSource } from '../integration/helpers/app.helper';
import { cleanDatabase } from '../integration/helpers/db-cleaner.helper';
import { initiatePayment, makeHeaders } from '../integration/helpers/request.helper';
import { v4 as uuidv4 } from 'uuid';
import { WebhookProcessorService } from '../../src/modules/webhooks/webhook-processor.service';
import { WebhookQueueService } from '../../src/modules/webhooks/webhook-queue.service';
describe('FS-02: Duplicate Webhook Delivery', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await buildApp();
  });
  afterAll(async () => {
    await closeApp();
  });
  beforeEach(async () => {
    await cleanDatabase(getDataSource());
  });

  it('should process first webhook and idempotently ignore duplicates', async () => {
    const eventId = `evt_${uuidv4()}`;
    const payload = {
      id: eventId,
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_test', amount: 280050, metadata: {} } },
    };

    const body = JSON.stringify(payload);
    const secret = 'mock-webhook-secret';
    const ts = Math.floor(Date.now() / 1000).toString();
    const sig = crypto.createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');

    const headers = {
      ...makeHeaders(),
      'stripe-signature': `t=${ts},v1=${sig}`,
      'content-type': 'application/json',
    };

    const [r1, r2, r3] = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/api/v1/webhooks/stripe',
        headers,
        payload: body,
      }),
      app.inject({
        method: 'POST',
        url: '/api/v1/webhooks/stripe',
        headers,
        payload: body,
      }),
      app.inject({
        method: 'POST',
        url: '/api/v1/webhooks/stripe',
        headers,
        payload: body,
      }),
    ]);

    expect(r1.statusCode).toBe(200);
    expect(r2.statusCode).toBe(200);
    expect(r3.statusCode).toBe(200);

    // Wait for async webhook processor to run
    await new Promise((r) => setTimeout(r, 1000));

    // Trigger processor manually since scheduler hasn't run
    const processor = app.get(WebhookProcessorService);
    const queueService = app.get(WebhookQueueService);
    const due = await queueService.fetchDue(10);
    for (const entry of due) {
      await processor.processOne(entry);
    }

    const ds = getDataSource();
    const events = await ds.query(
      `SELECT COUNT(*) as count FROM processed_webhook_events WHERE event_id = $1`,
      [eventId],
    );

    expect(parseInt(events[0].count)).toBe(1);
  });
});

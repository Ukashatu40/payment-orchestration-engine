// test/scenarios/fs-09-concurrent-race.spec.ts

import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { buildApp, closeApp, getDataSource } from '../integration/helpers/app.helper';
import { cleanDatabase } from '../integration/helpers/db-cleaner.helper';
import { makeHeaders } from '../integration/helpers/request.helper';
import { v4 as uuidv4 } from 'uuid';

describe('FS-09: Concurrent Idempotency Race Condition', () => {
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

  it('should never create duplicate charges under concurrent load', async () => {
    const idempotencyKey = uuidv4();
    const orderPayload = {
      merchantOrderId: `order-${uuidv4()}`,
      amountPaise: 500000,
      currency: 'INR',
      paymentMethod: 'CARD_CREDIT',
    };

    // Fire 5 concurrent requests with the same idempotency key
    const requests = Array.from({ length: 5 }, () =>
      app.inject({
        method: 'POST',
        url: '/api/v1/payments',
        headers: makeHeaders({ 'idempotency-key': idempotencyKey }),
        payload: orderPayload,
      }),
    );

    const responses = await Promise.all(requests);
    const statusCodes = responses.map((r) => r.statusCode);

    // Log first failure for diagnosis
    const firstFailure = responses.find((r) => r.statusCode >= 400);
    if (firstFailure) {
      console.log('Failed response:', firstFailure.statusCode, firstFailure.body);
    }
    // Exactly one success — rest must be 409 or same cached 200/201
    const successCount = statusCodes.filter((s) => s === 200 || s === 201).length;

    expect(successCount).toBeGreaterThanOrEqual(1);

    // Database must have exactly ONE transaction
    const ds = getDataSource();
    const txns = await ds.query(
      `SELECT COUNT(*) as count FROM transactions WHERE idempotency_key = $1`,
      [idempotencyKey],
    );

    expect(parseInt(txns[0].count)).toBe(1);
  });
});

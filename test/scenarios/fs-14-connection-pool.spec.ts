// test/scenarios/fs-14-connection-pool.spec.ts

import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { buildApp, closeApp, getDataSource } from '../integration/helpers/app.helper';
import { cleanDatabase } from '../integration/helpers/db-cleaner.helper';
import { makeHeaders } from '../integration/helpers/request.helper';
import { v4 as uuidv4 } from 'uuid';

describe('FS-14: Hot-Path Database Connection Exhaustion', () => {
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

  it('should handle 20 concurrent payment requests without deadlock or data corruption', async () => {
    // Fire 20 concurrent requests — each with unique idempotency key
    const requests = Array.from({ length: 20 }, (_, i) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/payments',
        headers: makeHeaders({ 'idempotency-key': uuidv4() }),
        payload: {
          merchantOrderId: `order-load-${uuidv4()}`,
          amountPaise: 280050,
          currency: 'INR',
          paymentMethod: 'CARD_CREDIT',
        },
      }),
    );

    const responses = await Promise.all(requests);
    const statusCodes = responses.map((r) => r.statusCode);

    // No request should return 500 — errors must be handled gracefully
    const serverErrors = statusCodes.filter((s) => s === 500);
    expect(serverErrors.length).toBe(0);

    // Count successes
    const successes = statusCodes.filter((s) => s === 200 || s === 201);
    expect(successes.length).toBeGreaterThan(0);

    // Verify no duplicate transactions created
    const ds = getDataSource();
    const result = await ds.query(`
      SELECT merchant_order_id, COUNT(*) as count
      FROM transactions
      GROUP BY merchant_order_id
      HAVING COUNT(*) > 1
    `);

    // No duplicate merchant order IDs
    expect(result.length).toBe(0);
  }, 30000);

  it('should keep health endpoint responsive under concurrent load', async () => {
    // Fire payment requests concurrently
    const paymentRequests = Array.from({ length: 10 }, () =>
      app.inject({
        method: 'POST',
        url: '/api/v1/payments',
        headers: makeHeaders({ 'idempotency-key': uuidv4() }),
        payload: {
          merchantOrderId: `order-${uuidv4()}`,
          amountPaise: 280050,
          currency: 'INR',
          paymentMethod: 'CARD_CREDIT',
        },
      }),
    );

    // Health check must respond during load
    const healthCheck = app.inject({
      method: 'GET',
      url: '/api/v1/health',
      headers: makeHeaders(),
    });

    const [healthResponse] = await Promise.all([healthCheck, ...paymentRequests]);

    expect(healthResponse.statusCode).toBe(200);
    const body = JSON.parse(healthResponse.body);
    expect(body.status).toBe('ok');
  }, 30000);
});

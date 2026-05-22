// test/scenarios/fs-03-double-submit.spec.ts

import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { buildApp, closeApp, getDataSource } from '../integration/helpers/app.helper';
import { cleanDatabase } from '../integration/helpers/db-cleaner.helper';
import { makeHeaders } from '../integration/helpers/request.helper';
import { v4 as uuidv4 } from 'uuid';

describe('FS-03: Double Submit by Customer', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await buildApp();
  });
  afterAll(async () => {
    await closeApp();
  });
  beforeEach(async () => {
    await cleanDatabase(getDataSource());
    const configs = await getDataSource().query('SELECT * FROM gateway_config');
    console.log('Gateway configs:', configs.length, configs);
  });

  it('should prevent double charge when same idempotency key submitted concurrently', async () => {
    const idempotencyKey = uuidv4();
    const merchantOrderId = `order-${uuidv4()}`;

    const payload = {
      merchantOrderId,
      amountPaise: 280050,
      currency: 'INR',
      paymentMethod: 'CARD_CREDIT',
    };

    const headers = makeHeaders({ 'idempotency-key': idempotencyKey });

    // Submit same request twice concurrently
    const [r1, r2] = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/api/v1/payments',
        headers,
        payload,
      }),
      app.inject({
        method: 'POST',
        url: '/api/v1/payments',
        headers,
        payload,
      }),
    ]);

    // Log for diagnosis
    if (r1.statusCode >= 400 && r2.statusCode >= 400) {
      console.log('Both failed — r1:', r1.statusCode, r1.body);
      console.log('Both failed — r2:', r2.statusCode, r2.body);
    }

    const codes = [r1.statusCode, r2.statusCode];

    // At least one must succeed or return idempotent cached response
    // The other may conflict (409) or also succeed with cached result
    const successCodes = codes.filter((c) => c === 200 || c === 201);
    const conflictCodes = codes.filter((c) => c === 409);

    // Must have at least one non-error response
    expect(successCodes.length + conflictCodes.length).toBeGreaterThanOrEqual(1);
    expect(successCodes.length).toBeGreaterThanOrEqual(1);

    // Database must have exactly ONE transaction for this idempotency key
    const ds = getDataSource();
    const txns = await ds.query(
      `SELECT COUNT(*) as count FROM transactions WHERE idempotency_key = $1`,
      [idempotencyKey],
    );

    expect(parseInt(txns[0].count)).toBe(1);
  });
});

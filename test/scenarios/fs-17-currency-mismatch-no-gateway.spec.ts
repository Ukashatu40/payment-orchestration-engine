// test/scenarios/fs-17-currency-mismatch-no-gateway.spec.ts

import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { buildApp, closeApp, getDataSource } from '../integration/helpers/app.helper';
import { cleanDatabase } from '../integration/helpers/db-cleaner.helper';
import { makeHeaders } from '../integration/helpers/request.helper';
import { v4 as uuidv4 } from 'uuid';

// Exercises GatewayRouterService's currency filter directly: NET_BANKING
// is only supported by RAZORPAY/PAYU (both INR-only, per the migration
// 013 backfill), and none of the 4 NGN gateways support NET_BANKING —
// so an NGN + NET_BANKING request has zero eligible candidates and must
// fail with 503 NO_GATEWAY_AVAILABLE, rather than silently falling back
// to an INR gateway.
describe('FS-17: No Gateway Available for an Unsupported Currency/Method Combination', () => {
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

  it('returns 503 NO_GATEWAY_AVAILABLE for NGN + NET_BANKING', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/payments',
      headers: makeHeaders(),
      payload: {
        merchantOrderId: `order-${uuidv4()}`,
        amountPaise: 500000,
        currency: 'NGN',
        paymentMethod: 'NET_BANKING',
      },
    });

    expect(response.statusCode).toBe(503);

    const body = JSON.parse(response.body);
    expect(body.error.code).toBe('NO_GATEWAY_AVAILABLE');

    const ds = getDataSource();
    const logs = await ds.query(`
      SELECT to_state, event
      FROM transaction_state_log
      ORDER BY created_at ASC
    `);

    expect(logs.some((l: { to_state: string }) => l.to_state === 'ROUTE_FAILED')).toBe(true);
  });

  it('still routes a CARD_CREDIT + INR request normally (regression check)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/payments',
      headers: makeHeaders(),
      payload: {
        merchantOrderId: `order-${uuidv4()}`,
        amountPaise: 280050,
        currency: 'INR',
        paymentMethod: 'CARD_CREDIT',
      },
    });

    expect(response.statusCode).toBe(201);

    const body = JSON.parse(response.body);
    // RAZORPAY, STRIPE, and PAYU all support CARD_CREDIT + INR
    expect(['RAZORPAY', 'STRIPE', 'PAYU']).toContain(body.gateway);
  });
});

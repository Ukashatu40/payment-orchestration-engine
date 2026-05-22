// test/scenarios/fs-13-idempotency-key-collision.spec.ts

import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { buildApp, closeApp, getDataSource } from '../integration/helpers/app.helper';
import { cleanDatabase } from '../integration/helpers/db-cleaner.helper';
import { makeHeaders } from '../integration/helpers/request.helper';
import { v4 as uuidv4 } from 'uuid';

describe('FS-13: Gateway Idempotency Key Collision', () => {
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

  it('should treat same idempotency key from different merchants as independent requests', async () => {
    const sharedIdempotencyKey = uuidv4();
    const merchantA = '11111111-1111-1111-1111-111111111111';
    const merchantB = '22222222-2222-2222-2222-222222222222';

    // Merchant A submits payment
    const responseA = await app.inject({
      method: 'POST',
      url: '/api/v1/payments',
      headers: makeHeaders({
        'x-merchant-id': merchantA,
        'idempotency-key': sharedIdempotencyKey,
      }),
      payload: {
        merchantOrderId: `order-${uuidv4()}`,
        amountPaise: 280050,
        currency: 'INR',
        paymentMethod: 'CARD_CREDIT',
      },
    });

    // Merchant B submits payment with SAME idempotency key
    const responseB = await app.inject({
      method: 'POST',
      url: '/api/v1/payments',
      headers: makeHeaders({
        'x-merchant-id': merchantB,
        'idempotency-key': sharedIdempotencyKey,
      }),
      payload: {
        merchantOrderId: `order-${uuidv4()}`,
        amountPaise: 500000,
        currency: 'INR',
        paymentMethod: 'CARD_CREDIT',
      },
    });

    // Both must succeed — different merchants, key collision is expected
    expect([200, 201]).toContain(responseA.statusCode);
    expect([200, 201]).toContain(responseB.statusCode);

    // Two separate transactions must exist — one per merchant
    const ds = getDataSource();
    const txns = await ds.query(
      `SELECT merchant_id, idempotency_key FROM transactions
       WHERE idempotency_key = $1`,
      [sharedIdempotencyKey],
    );

    expect(txns.length).toBe(2);

    const merchantIds = txns.map((t: any) => t.merchant_id);
    expect(merchantIds).toContain(merchantA);
    expect(merchantIds).toContain(merchantB);
  });

  it('should scope idempotency check to merchant — same merchant same key returns cached', async () => {
    const idempotencyKey = uuidv4();
    const merchantId = '11111111-1111-1111-1111-111111111111';
    const orderPayload = {
      merchantOrderId: `order-${uuidv4()}`,
      amountPaise: 280050,
      currency: 'INR',
      paymentMethod: 'CARD_CREDIT',
    };

    // First request
    const r1 = await app.inject({
      method: 'POST',
      url: '/api/v1/payments',
      headers: makeHeaders({
        'x-merchant-id': merchantId,
        'idempotency-key': idempotencyKey,
      }),
      payload: orderPayload,
    });

    // Second request — same merchant, same key
    const r2 = await app.inject({
      method: 'POST',
      url: '/api/v1/payments',
      headers: makeHeaders({
        'x-merchant-id': merchantId,
        'idempotency-key': idempotencyKey,
      }),
      payload: orderPayload,
    });

    expect([200, 201]).toContain(r1.statusCode);

    // Second request must be idempotent — same result, no new transaction
    const ds = getDataSource();
    const txns = await ds.query(
      `SELECT COUNT(*) as count FROM transactions WHERE idempotency_key = $1`,
      [idempotencyKey],
    );

    expect(parseInt(txns[0].count)).toBe(1);
  });
});

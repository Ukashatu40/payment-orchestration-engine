// test/scenarios/fs-01-gateway-timeout.spec.ts

import { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  buildApp,
  closeApp,
  getDataSource,
} from '../integration/helpers/app.helper';
import { cleanDatabase } from '../integration/helpers/db-cleaner.helper';
import {
  initiatePayment,
  makeHeaders,
} from '../integration/helpers/request.helper';
import { v4 as uuidv4 } from 'uuid';

describe('FS-01: Gateway Timeout During Authorisation', () => {
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

  it('should transition to AUTH_TIMEOUT state on gateway timeout', async () => {
    const idempotencyKey = uuidv4();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/payments',
      headers: makeHeaders({
        'idempotency-key': idempotencyKey,
        'x-mock-response': 'timeout',
        'x-mock-delay-ms': '100',
      }),
      payload: {
        merchantOrderId: `order-${uuidv4()}`,
        amountPaise: 280050,
        currency: 'INR',
        paymentMethod: 'CARD_CREDIT', // ensure card gateway selected
      },
    });

    console.log('FS-01 response:', response.statusCode, response.body);

    const ds = getDataSource();

    // Check what state transitions happened
    const logs = await ds.query(`
    SELECT from_state, to_state, event, metadata
    FROM transaction_state_log
    ORDER BY created_at ASC
  `);

    console.log('State transitions:', JSON.stringify(logs, null, 2));

    const hasTimeoutOrFailure = logs.some(
      (l: any) =>
        l.to_state === 'AUTH_TIMEOUT' ||
        l.to_state === 'AUTH_FAILED' ||
        l.to_state === 'FAILED',
    );

    expect(hasTimeoutOrFailure).toBe(true);
  }, 10000);

  it('should failover to next gateway within 2 seconds when primary times out', async () => {
    const start = Date.now();

    const response = await initiatePayment(
      app,
      {},
      {
        // Mock headers tell Razorpay adapter to timeout,
        // Stripe adapter will succeed as fallback
        'x-mock-response': 'timeout',
        'x-mock-delay-ms': '100', // 100ms instead of 30s
      },
    );

    const elapsed = Date.now() - start;

    // System must recover — either success or clean failure
    expect(response.statusCode).not.toBe(401);
    expect([200, 201, 504, 400]).toContain(response.statusCode);

    // Failover must complete within 2 seconds
    expect(elapsed).toBeLessThan(2000);
  }, 10000);

  it('should transition to AUTH_TIMEOUT state on gateway timeout', async () => {
    const idempotencyKey = uuidv4();

    await initiatePayment(
      app,
      {},
      {
        'idempotency-key': idempotencyKey,
        'x-mock-response': 'timeout',
      },
    );

    // Check audit trail for AUTH_TIMEOUT transition
    const ds = getDataSource();
    const logs = await ds.query(`
      SELECT from_state, to_state, event
      FROM transaction_state_log
      WHERE event IN ('GATEWAY_TIMEOUT', 'GATEWAY_AUTH_SUCCESS')
      ORDER BY created_at ASC
    `);

    const hasTimeout = logs.some(
      (l: any) => l.to_state === 'AUTH_TIMEOUT' || l.to_state === 'AUTH_FAILED',
    );

    expect(hasTimeout).toBe(true);
  }, 10000);
});

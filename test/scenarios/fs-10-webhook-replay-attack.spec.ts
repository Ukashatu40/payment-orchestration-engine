// test/scenarios/fs-10-webhook-replay-attack.spec.ts

import { NestFastifyApplication } from '@nestjs/platform-fastify';
import * as crypto from 'crypto';
import {
  buildApp,
  closeApp,
  getDataSource,
} from '../integration/helpers/app.helper';
import { cleanDatabase } from '../integration/helpers/db-cleaner.helper';
import { makeHeaders } from '../integration/helpers/request.helper';
import { v4 as uuidv4 } from 'uuid';

describe('FS-10: Webhook Replay Attack', () => {
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

  it('should reject webhook with invalid signature', async () => {
    const payload = JSON.stringify({
      event: 'payment.captured',
      payload: { payment: { entity: { id: 'pay_123', amount: 10000000 } } },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/razorpay',
      headers: {
        ...makeHeaders(),
        'x-razorpay-signature': 'invalid-signature-attempting-fraud',
        'content-type': 'application/json',
      },
      payload,
    });

    expect(response.statusCode).toBe(401);

    const body = JSON.parse(response.body);
    expect(body.error.code).toBe('WEBHOOK_SIGNATURE_INVALID');
  });

  it('should reject tampered payload even with valid original signature', async () => {
    const secret = 'mock-webhook-secret';
    const original = JSON.stringify({ event: 'payment.captured', amount: 100 });
    const tampered = JSON.stringify({
      event: 'payment.captured',
      amount: 10000000,
    });

    // Sign the ORIGINAL payload
    const validSig = crypto
      .createHmac('sha256', secret)
      .update(Buffer.from(original))
      .digest('hex');

    // Send the TAMPERED payload with the original signature
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/razorpay',
      headers: {
        ...makeHeaders(),
        'x-razorpay-signature': validSig,
        'content-type': 'application/json',
      },
      payload: tampered,
    });

    expect(response.statusCode).toBe(401);
  });
});

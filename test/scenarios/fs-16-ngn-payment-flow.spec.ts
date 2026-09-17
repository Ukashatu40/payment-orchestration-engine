// test/scenarios/fs-16-ngn-payment-flow.spec.ts

import nock from 'nock';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { buildApp, closeApp, getDataSource } from '../integration/helpers/app.helper';
import { cleanDatabase } from '../integration/helpers/db-cleaner.helper';
import { makeHeaders } from '../integration/helpers/request.helper';
import { v4 as uuidv4 } from 'uuid';

// Unlike fs-01..fs-15, which exercise the mock adapters (Razorpay/
// Stripe/PayU/UPI) via x-mock-* headers, the NGN gateways added here
// make real outbound HTTP calls — so this scenario test intercepts
// them with nock instead. nock patches Node's http/https modules
// globally, so it still works even though the *inbound* request to
// this test's own app goes through Fastify's in-process app.inject()
// rather than a real socket.
describe('FS-16: NGN Payment Flow Routes to a Nigerian Gateway', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await buildApp();
    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1'); // allow app.inject()'s loopback, if any
  });

  afterAll(async () => {
    nock.enableNetConnect();
    nock.restore();
    await closeApp();
  });

  beforeEach(async () => {
    await cleanDatabase(getDataSource());
    nock.cleanAll();

    // The router may select any of the 4 NGN gateways depending on
    // scoring (all start with equal default health/cost on a clean
    // DB) — mock all four sandbox endpoints so the test doesn't
    // depend on which one wins.
    nock('https://api.paystack.co')
      .post('/transaction/initialize')
      .reply(200, { status: true, message: 'ok', data: { reference: 'psk_scenario_ref' } });

    nock('https://api.flutterwave.com')
      .post('/v3/payments')
      .reply(200, {
        status: 'success',
        message: 'ok',
        data: { link: 'https://checkout.flutterwave.com/x' },
      });

    nock('https://sandboxapi.opaycheckout.com')
      .post('/api/v1/cashier/create')
      .reply(200, { code: '00000', message: 'ok', data: { orderNo: 'opay_scenario_order' } });

    nock('https://qa.interswitchng.com')
      .post('/passport/oauth/token')
      .reply(200, { access_token: 'scenario-token', expires_in: 3600 });
    nock('https://qa.interswitchng.com')
      .post('/api/v2/payments')
      .reply(200, { data: { transactionReference: 'isw_scenario_ref' } });
  });

  it('routes an NGN card payment to one of the 4 Nigerian gateways and leaves it pending on AUTH_INITIATED', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/payments',
      headers: makeHeaders(),
      payload: {
        merchantOrderId: `order-${uuidv4()}`,
        amountPaise: 500000, // 5000 NGN in kobo
        currency: 'NGN',
        paymentMethod: 'CARD_CREDIT',
      },
    });

    expect(response.statusCode).toBe(201);

    const body = JSON.parse(response.body);

    expect(['PAYSTACK', 'FLUTTERWAVE', 'INTERSWITCH', 'OPAY']).toContain(body.gateway);
    // Real NGN adapters return 'pending' from authorise() — the
    // transaction stays in AUTH_INITIATED until the gateway webhook
    // arrives, unlike the mock adapters which resolve synchronously.
    expect(body.state).toBe('AUTH_INITIATED');
    expect(body.gatewayPaymentId).toBeTruthy();
    expect(body.gatewayReference).toBeTruthy();
  });

  it('does not select an INR/USD-only gateway for an NGN transaction', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/payments',
      headers: makeHeaders(),
      payload: {
        merchantOrderId: `order-${uuidv4()}`,
        amountPaise: 500000,
        currency: 'NGN',
        paymentMethod: 'CARD_CREDIT',
      },
    });

    const body = JSON.parse(response.body);

    expect(['RAZORPAY', 'STRIPE', 'PAYU', 'UPI']).not.toContain(body.gateway);
  });
});

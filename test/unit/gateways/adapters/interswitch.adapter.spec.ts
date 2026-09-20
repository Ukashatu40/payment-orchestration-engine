// test/unit/gateways/adapters/interswitch.adapter.spec.ts

import nock from 'nock';
import { InterswitchAdapter } from '../../../../src/modules/gateways/adapters/interswitch.adapter';
import { GatewayConfigRepository } from '../../../../src/modules/gateways/repositories/gateway-config.repository';
import { GatewayConfig } from '../../../../src/modules/gateways/entities/gateway-config.entity';
import { PaymentGateway, PaymentMethod } from '../../../../src/common/enums';
import {
  GatewayTimeoutException,
  GatewayUnavailableException,
} from '../../../../src/common/exceptions';

const BASE_URL = 'https://sandbox.interswitchng.com';
const PUBLIC_URL = 'https://api.example.com';

function mockConfig(overrides: Partial<GatewayConfig> = {}): GatewayConfig {
  return {
    gateway: PaymentGateway.INTERSWITCH,
    isEnabled: true,
    supportedMethods: [PaymentMethod.CARD_CREDIT],
    supportedCurrencies: ['NGN'],
    cbFailureThreshold: 5,
    cbTimeoutMs: 45000,
    cbHalfOpenRequests: 1,
    costPercentage: 0.0175,
    costFixedPaise: BigInt(10000),
    timeoutMs: 500,
    rateLimitPerSec: 80,
    apiKey: null,
    webhookSecret: null,
    metadata: {
      baseUrl: BASE_URL,
      merchantCode: 'MX000',
      payItemId: 'Default_Payable_MX000',
      publicBaseUrl: PUBLIC_URL,
    },
    ...overrides,
  };
}

const baseAuthRequest = {
  transactionId: '6f1b0f0e-8f8f-4f3e-9c55-0d8e5a1b2c3d',
  merchantId: 'merchant-1',
  amountPaise: BigInt(500000),
  currency: 'NGN',
  paymentMethod: PaymentMethod.CARD_CREDIT,
  traceId: 'trace-1',
  idempotencyKey: 'idem-1',
};

describe('InterswitchAdapter', () => {
  let adapter: InterswitchAdapter;
  const findByGateway = jest.fn();

  beforeAll(() => {
    nock.disableNetConnect();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    nock.cleanAll();
    findByGateway.mockResolvedValue(mockConfig());
    adapter = new InterswitchAdapter({ findByGateway } as unknown as GatewayConfigRepository);
  });

  afterAll(() => {
    nock.enableNetConnect();
    nock.restore();
  });

  describe('authorise', () => {
    it('makes no network call and returns a checkout URL on this backend', async () => {
      const result = await adapter.authorise({ ...baseAuthRequest, customerEmail: 'a@b.com' });

      expect(result.status).toBe('pending');
      expect(result.gatewayPaymentId).toBe(baseAuthRequest.transactionId);
      expect(result.checkoutUrl).toBe(
        `${PUBLIC_URL}/api/v1/checkout/interswitch/${baseAuthRequest.transactionId}?email=a%40b.com`,
      );
    });

    it('fails clearly when merchantCode/payItemId are not configured', async () => {
      findByGateway.mockResolvedValue(mockConfig({ metadata: { baseUrl: BASE_URL } }));

      await expect(adapter.authorise(baseAuthRequest)).rejects.toThrow(/metadata\.merchantCode/);
    });

    it('fails clearly when no public base URL is available', async () => {
      const saved = { ...process.env };
      delete process.env.PUBLIC_BASE_URL;
      delete process.env.RENDER_EXTERNAL_URL;
      findByGateway.mockResolvedValue(
        mockConfig({
          metadata: { baseUrl: BASE_URL, merchantCode: 'MX000', payItemId: 'P' },
        }),
      );

      await expect(adapter.authorise(baseAuthRequest)).rejects.toThrow(/public URL/);
      process.env = saved;
    });
  });

  describe('buildCheckoutForm', () => {
    it('builds the documented redirect fields (kobo amount, numeric currency)', () => {
      const form = adapter.buildCheckoutForm(mockConfig(), {
        transactionId: 'txn-1',
        amountPaise: BigInt(500000),
        currency: 'NGN',
        email: 'a@b.com',
      });

      expect(form.action).toBe(`${BASE_URL}/collections/w/pay`);
      expect(form.fields).toEqual({
        merchant_code: 'MX000',
        pay_item_id: 'Default_Payable_MX000',
        txn_ref: 'txn-1',
        amount: '500000',
        currency: '566',
        site_redirect_url: `${PUBLIC_URL}/api/v1/checkout/interswitch/return/txn-1`,
        cust_email: 'a@b.com',
      });
    });

    it('rejects an unsupported currency', () => {
      expect(() =>
        adapter.buildCheckoutForm(mockConfig(), {
          transactionId: 't',
          amountPaise: BigInt(1),
          currency: 'INR',
        }),
      ).toThrow(GatewayUnavailableException);
    });
  });

  describe('fetchStatus', () => {
    it('maps ResponseCode 00 to captured and sends the documented query', async () => {
      nock(BASE_URL)
        .get('/collections/api/v1/gettransaction.json')
        .query({ merchantcode: 'MX000', transactionreference: 'txn-1', amount: '500000' })
        .reply(200, { ResponseCode: '00', Amount: 500000, MerchantReference: 'txn-1' });

      const result = await adapter.fetchStatus('txn-1', 'trace-1', BigInt(500000));

      expect(result.status).toBe('captured');
      expect(result.amountPaise).toBe(BigInt(500000));
    });

    it('treats Z25 (transaction not found yet) as still pending, not failed', async () => {
      nock(BASE_URL)
        .get('/collections/api/v1/gettransaction.json')
        .query(true)
        .reply(200, { ResponseCode: 'Z25', ResponseDescription: 'Transaction not Found' });

      expect((await adapter.fetchStatus('t', 'x', BigInt(1))).status).toBe('authorised');
    });

    it('maps 09 to authorised and any other code to failed', async () => {
      nock(BASE_URL)
        .get('/collections/api/v1/gettransaction.json')
        .query(true)
        .reply(200, { ResponseCode: '09' });
      expect((await adapter.fetchStatus('t', 'x', BigInt(1))).status).toBe('authorised');

      nock(BASE_URL)
        .get('/collections/api/v1/gettransaction.json')
        .query(true)
        .reply(200, { ResponseCode: 'Z6' });
      expect((await adapter.fetchStatus('t', 'x', BigInt(1))).status).toBe('failed');
    });

    it('maps a timeout to GatewayTimeoutException', async () => {
      findByGateway.mockResolvedValue(mockConfig({ timeoutMs: 50 }));
      nock(BASE_URL)
        .get('/collections/api/v1/gettransaction.json')
        .query(true)
        .delay(200)
        .reply(200, {});

      await expect(adapter.fetchStatus('t', 'x', BigInt(1))).rejects.toThrow(
        GatewayTimeoutException,
      );
    });

    it('maps a 5xx response to GatewayUnavailableException', async () => {
      nock(BASE_URL).get('/collections/api/v1/gettransaction.json').query(true).reply(500, {});

      await expect(adapter.fetchStatus('t', 'x', BigInt(1))).rejects.toThrow(
        GatewayUnavailableException,
      );
    });
  });

  describe('capture', () => {
    it('captures the full amount when the gateway approves', async () => {
      nock(BASE_URL)
        .get('/collections/api/v1/gettransaction.json')
        .query(true)
        .reply(200, { ResponseCode: '00', Amount: 500000 });

      const result = await adapter.capture({
        transactionId: 'txn-1',
        gatewayPaymentId: 'txn-1',
        amountPaise: BigInt(500000),
        currency: 'NGN',
        traceId: 'trace-1',
      });

      expect(result.status).toBe('captured');
      expect(result.capturedAmountPaise).toBe(BigInt(500000));
    });
  });

  describe('refund / void', () => {
    it('report unsupported without calling the network', async () => {
      const refund = await adapter.refund({
        transactionId: 't',
        gatewayPaymentId: 'p',
        amountPaise: BigInt(1),
        currency: 'NGN',
        traceId: 'x',
      } as never);
      const voided = await adapter.void({
        transactionId: 't',
        gatewayPaymentId: 'p',
        traceId: 'x',
      } as never);

      expect(refund.status).toBe('failed');
      expect(voided.status).toBe('failed');
    });
  });
});

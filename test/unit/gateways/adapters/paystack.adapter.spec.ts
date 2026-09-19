// test/unit/gateways/adapters/paystack.adapter.spec.ts

import nock from 'nock';
import { PaystackAdapter } from '../../../../src/modules/gateways/adapters/paystack.adapter';
import { GatewayConfigRepository } from '../../../../src/modules/gateways/repositories/gateway-config.repository';
import { GatewayConfig } from '../../../../src/modules/gateways/entities/gateway-config.entity';
import { PaymentGateway, PaymentMethod } from '../../../../src/common/enums';
import {
  GatewayTimeoutException,
  GatewayUnavailableException,
} from '../../../../src/common/exceptions';

const BASE_URL = 'https://api.paystack.co';

function mockConfig(overrides: Partial<GatewayConfig> = {}): GatewayConfig {
  return {
    gateway: PaymentGateway.PAYSTACK,
    isEnabled: true,
    supportedMethods: [PaymentMethod.CARD_CREDIT],
    supportedCurrencies: ['NGN'],
    cbFailureThreshold: 5,
    cbTimeoutMs: 30000,
    cbHalfOpenRequests: 1,
    costPercentage: 0.015,
    costFixedPaise: BigInt(0),
    timeoutMs: 500,
    rateLimitPerSec: 100,
    apiKey: 'sk_test_xxx',
    webhookSecret: 'whsec_xxx',
    metadata: { baseUrl: BASE_URL },
    ...overrides,
  };
}

const baseAuthRequest = {
  transactionId: 'txn-1',
  merchantId: 'merchant-1',
  amountPaise: BigInt(500000), // 5000 NGN in kobo
  currency: 'NGN',
  paymentMethod: PaymentMethod.CARD_CREDIT,
  traceId: 'trace-1',
  idempotencyKey: 'idem-1',
};

describe('PaystackAdapter', () => {
  let adapter: PaystackAdapter;
  const findByGateway = jest.fn();

  beforeAll(() => {
    nock.disableNetConnect();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    nock.cleanAll();
    findByGateway.mockResolvedValue(mockConfig());
    adapter = new PaystackAdapter({ findByGateway } as unknown as GatewayConfigRepository);
  });

  afterAll(() => {
    nock.enableNetConnect();
    nock.restore();
  });

  describe('authorise', () => {
    it('returns pending with the gateway reference on success', async () => {
      nock(BASE_URL)
        .post('/transaction/initialize')
        .reply(200, {
          status: true,
          message: 'Authorization URL created',
          data: {
            authorization_url: 'https://checkout.paystack.com/abc123',
            access_code: 'abc123',
            reference: 'psk_ref_001',
          },
        });

      const result = await adapter.authorise(baseAuthRequest);

      expect(result.status).toBe('pending');
      expect(result.gatewayReference).toBe('psk_ref_001');
      expect(result.gatewayPaymentId).toBe('psk_ref_001');
    });

    it('sends callback_url with {transactionId} substituted when returnUrl is configured', async () => {
      findByGateway.mockResolvedValue(
        mockConfig({
          metadata: {
            baseUrl: BASE_URL,
            returnUrl: 'https://portal.example.com/transactions/{transactionId}',
          },
        }),
      );
      let capturedBody: { callback_url?: string } | undefined;
      nock(BASE_URL)
        .post('/transaction/initialize', (body: typeof capturedBody) => {
          capturedBody = body;
          return true;
        })
        .reply(200, { status: true, message: 'ok', data: { reference: 'psk_ref_cb' } });

      await adapter.authorise(baseAuthRequest);

      expect(capturedBody?.callback_url).toBe(
        `https://portal.example.com/transactions/${baseAuthRequest.transactionId}`,
      );
    });

    it('omits callback_url when returnUrl is not configured', async () => {
      let capturedBody: { callback_url?: string } | undefined;
      nock(BASE_URL)
        .post('/transaction/initialize', (body: typeof capturedBody) => {
          capturedBody = body;
          return true;
        })
        .reply(200, { status: true, message: 'ok', data: { reference: 'psk_ref_nocb' } });

      await adapter.authorise(baseAuthRequest);

      expect(capturedBody).not.toHaveProperty('callback_url');
    });

    it('sends amount in kobo with no conversion', async () => {
      let capturedBody:
        | { amount: string; currency: string; metadata: { transaction_id: string } }
        | undefined;
      nock(BASE_URL)
        .post('/transaction/initialize', (body: typeof capturedBody) => {
          capturedBody = body;
          return true;
        })
        .reply(200, { status: true, message: 'ok', data: { reference: 'psk_ref_002' } });

      await adapter.authorise(baseAuthRequest);

      expect(capturedBody?.amount).toBe('500000');
      expect(capturedBody?.currency).toBe('NGN');
      expect(capturedBody?.metadata.transaction_id).toBe('txn-1');
    });

    it('maps a timeout to GatewayTimeoutException', async () => {
      findByGateway.mockResolvedValue(mockConfig({ timeoutMs: 50 }));
      nock(BASE_URL).post('/transaction/initialize').delay(200).reply(200, { status: true });

      await expect(adapter.authorise(baseAuthRequest)).rejects.toThrow(GatewayTimeoutException);
    });

    it('maps a 5xx response to GatewayUnavailableException', async () => {
      nock(BASE_URL).post('/transaction/initialize').reply(500, { status: false });

      await expect(adapter.authorise(baseAuthRequest)).rejects.toThrow(GatewayUnavailableException);
    });

    it('maps a 429 response to GatewayUnavailableException', async () => {
      nock(BASE_URL).post('/transaction/initialize').reply(429, { status: false });

      await expect(adapter.authorise(baseAuthRequest)).rejects.toThrow(GatewayUnavailableException);
    });
  });

  describe('capture', () => {
    it('reports captured when verify returns status=success', async () => {
      nock(BASE_URL)
        .get('/transaction/verify/psk_ref_001')
        .reply(200, { status: true, message: 'ok', data: { status: 'success' } });

      const result = await adapter.capture({
        transactionId: 'txn-1',
        gatewayPaymentId: 'psk_ref_001',
        amountPaise: BigInt(500000),
        currency: 'NGN',
        traceId: 'trace-1',
      });

      expect(result.status).toBe('captured');
      expect(result.capturedAmountPaise).toBe(BigInt(500000));
    });

    it('reports failed when verify returns a non-success status (declined)', async () => {
      nock(BASE_URL)
        .get('/transaction/verify/psk_ref_001')
        .reply(200, { status: true, message: 'ok', data: { status: 'failed' } });

      const result = await adapter.capture({
        transactionId: 'txn-1',
        gatewayPaymentId: 'psk_ref_001',
        amountPaise: BigInt(500000),
        currency: 'NGN',
        traceId: 'trace-1',
      });

      expect(result.status).toBe('failed');
      expect(result.capturedAmountPaise).toBe(BigInt(0));
    });
  });

  describe('refund', () => {
    it('returns refunded on success', async () => {
      nock(BASE_URL)
        .post('/refund')
        .reply(200, { status: true, message: 'ok', data: { id: 998877 } });

      const result = await adapter.refund({
        transactionId: 'txn-1',
        refundId: 'refund-1',
        gatewayPaymentId: 'psk_ref_001',
        amountPaise: BigInt(500000),
        currency: 'NGN',
        traceId: 'trace-1',
      });

      expect(result.status).toBe('refunded');
      expect(result.gatewayRefundId).toBe('998877');
    });
  });

  describe('void', () => {
    it('returns failed without calling the network (unsupported operation)', async () => {
      const result = await adapter.void({
        transactionId: 'txn-1',
        gatewayPaymentId: 'psk_ref_001',
        traceId: 'trace-1',
      });

      expect(result.status).toBe('failed');
    });
  });

  describe('fetchStatus', () => {
    it('maps success to captured', async () => {
      nock(BASE_URL)
        .get('/transaction/verify/psk_ref_001')
        .reply(200, { status: true, message: 'ok', data: { status: 'success', amount: 500000 } });

      const result = await adapter.fetchStatus('psk_ref_001', 'trace-1');

      expect(result.status).toBe('captured');
      expect(result.amountPaise).toBe(BigInt(500000));
    });
  });
});

// test/unit/gateways/adapters/flutterwave.adapter.spec.ts

import nock from 'nock';
import { FlutterwaveAdapter } from '../../../../src/modules/gateways/adapters/flutterwave.adapter';
import { GatewayConfigRepository } from '../../../../src/modules/gateways/repositories/gateway-config.repository';
import { GatewayConfig } from '../../../../src/modules/gateways/entities/gateway-config.entity';
import { PaymentGateway, PaymentMethod } from '../../../../src/common/enums';
import {
  GatewayTimeoutException,
  GatewayUnavailableException,
} from '../../../../src/common/exceptions';

const BASE_URL = 'https://api.flutterwave.com/v3';

function mockConfig(overrides: Partial<GatewayConfig> = {}): GatewayConfig {
  return {
    gateway: PaymentGateway.FLUTTERWAVE,
    isEnabled: true,
    supportedMethods: [PaymentMethod.CARD_CREDIT],
    supportedCurrencies: ['NGN'],
    cbFailureThreshold: 5,
    cbTimeoutMs: 30000,
    cbHalfOpenRequests: 1,
    costPercentage: 0.014,
    costFixedPaise: BigInt(0),
    timeoutMs: 500,
    rateLimitPerSec: 100,
    apiKey: 'flw_test_xxx',
    webhookSecret: 'flw_hash_xxx',
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

describe('FlutterwaveAdapter', () => {
  let adapter: FlutterwaveAdapter;
  const findByGateway = jest.fn();

  beforeAll(() => {
    nock.disableNetConnect();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    nock.cleanAll();
    findByGateway.mockResolvedValue(mockConfig());
    adapter = new FlutterwaveAdapter({ findByGateway } as unknown as GatewayConfigRepository);
  });

  afterAll(() => {
    nock.enableNetConnect();
    nock.restore();
  });

  describe('authorise', () => {
    it('returns pending and converts kobo to naira in the outbound request', async () => {
      let capturedBody: { amount: string; meta: { transaction_id: string } } | undefined;
      nock(BASE_URL)
        .post('/payments', (body: typeof capturedBody) => {
          capturedBody = body;
          return true;
        })
        .reply(200, {
          status: 'success',
          message: 'ok',
          data: { link: 'https://checkout.flutterwave.com/x' },
        });

      const result = await adapter.authorise(baseAuthRequest);

      expect(result.status).toBe('pending');
      expect(capturedBody?.amount).toBe('5000'); // 500000 kobo -> 5000 naira
      expect(capturedBody?.meta.transaction_id).toBe('txn-1');
    });

    it('maps a timeout to GatewayTimeoutException', async () => {
      findByGateway.mockResolvedValue(mockConfig({ timeoutMs: 50 }));
      nock(BASE_URL).post('/payments').delay(200).reply(200, { status: 'success' });

      await expect(adapter.authorise(baseAuthRequest)).rejects.toThrow(GatewayTimeoutException);
    });

    it('maps a 5xx response to GatewayUnavailableException', async () => {
      nock(BASE_URL).post('/payments').reply(503, { status: 'error' });

      await expect(adapter.authorise(baseAuthRequest)).rejects.toThrow(GatewayUnavailableException);
    });
  });

  describe('capture (verify_by_reference)', () => {
    it('reports captured when status=successful', async () => {
      nock(BASE_URL)
        .get('/transactions/verify_by_reference')
        .query({ tx_ref: 'flw_ref_1' })
        .reply(200, { status: 'success', message: 'ok', data: { status: 'successful' } });

      const result = await adapter.capture({
        transactionId: 'txn-1',
        gatewayPaymentId: 'flw_ref_1',
        amountPaise: BigInt(500000),
        currency: 'NGN',
        traceId: 'trace-1',
      });

      expect(result.status).toBe('captured');
    });

    it('reports failed for a declined charge', async () => {
      nock(BASE_URL)
        .get('/transactions/verify_by_reference')
        .query({ tx_ref: 'flw_ref_1' })
        .reply(200, { status: 'success', message: 'ok', data: { status: 'failed' } });

      const result = await adapter.capture({
        transactionId: 'txn-1',
        gatewayPaymentId: 'flw_ref_1',
        amountPaise: BigInt(500000),
        currency: 'NGN',
        traceId: 'trace-1',
      });

      expect(result.status).toBe('failed');
    });
  });

  describe('fetchStatus', () => {
    it('converts naira amount back to kobo', async () => {
      nock(BASE_URL)
        .get('/transactions/verify_by_reference')
        .query({ tx_ref: 'flw_ref_1' })
        .reply(200, {
          status: 'success',
          message: 'ok',
          data: { status: 'successful', amount: 5000 },
        });

      const result = await adapter.fetchStatus('flw_ref_1', 'trace-1');

      expect(result.status).toBe('captured');
      expect(result.amountPaise).toBe(BigInt(500000));
    });
  });
});

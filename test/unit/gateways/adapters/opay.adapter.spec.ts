// test/unit/gateways/adapters/opay.adapter.spec.ts

import nock from 'nock';
import { OpayAdapter } from '../../../../src/modules/gateways/adapters/opay.adapter';
import { GatewayConfigRepository } from '../../../../src/modules/gateways/repositories/gateway-config.repository';
import { GatewayConfig } from '../../../../src/modules/gateways/entities/gateway-config.entity';
import { PaymentGateway, PaymentMethod } from '../../../../src/common/enums';
import {
  GatewayTimeoutException,
  GatewayUnavailableException,
} from '../../../../src/common/exceptions';

const BASE_URL = 'https://sandboxapi.opaycheckout.com';

function mockConfig(overrides: Partial<GatewayConfig> = {}): GatewayConfig {
  return {
    gateway: PaymentGateway.OPAY,
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
    apiKey: 'merchant-id-xxx',
    webhookSecret: null,
    metadata: { baseUrl: BASE_URL, secretKey: 'secret-key-xxx' },
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

describe('OpayAdapter', () => {
  let adapter: OpayAdapter;
  const findByGateway = jest.fn();

  beforeAll(() => {
    nock.disableNetConnect();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    nock.cleanAll();
    findByGateway.mockResolvedValue(mockConfig());
    adapter = new OpayAdapter({ findByGateway } as unknown as GatewayConfigRepository);
  });

  afterAll(() => {
    nock.enableNetConnect();
    nock.restore();
  });

  describe('authorise', () => {
    it('signs the request and returns pending on success', async () => {
      let capturedHeaders: Record<string, string> = {};
      nock(BASE_URL)
        .post('/api/v1/cashier/create')
        .reply(function () {
          capturedHeaders = this.req.headers;
          return [200, { code: '00000', message: 'ok', data: { orderNo: 'opay_order_1' } }];
        });

      const result = await adapter.authorise(baseAuthRequest);

      expect(result.status).toBe('pending');
      expect(result.gatewayPaymentId).toBe('opay_order_1');
      expect(capturedHeaders['authorization']).toMatch(/^Bearer /);
      expect(capturedHeaders['merchantid']).toBe('merchant-id-xxx');
    });

    it('sends amount as kobo, no conversion', async () => {
      let capturedBody:
        | { amount: { total: number }; metadata: { transaction_id: string } }
        | undefined;
      nock(BASE_URL)
        .post('/api/v1/cashier/create', (body: typeof capturedBody) => {
          capturedBody = body;
          return true;
        })
        .reply(200, { code: '00000', message: 'ok', data: { orderNo: 'opay_order_2' } });

      await adapter.authorise(baseAuthRequest);

      expect(capturedBody?.amount.total).toBe(500000);
      expect(capturedBody?.metadata.transaction_id).toBe('txn-1');
    });

    it('maps a timeout to GatewayTimeoutException', async () => {
      findByGateway.mockResolvedValue(mockConfig({ timeoutMs: 50 }));
      nock(BASE_URL).post('/api/v1/cashier/create').delay(200).reply(200, { code: '00000' });

      await expect(adapter.authorise(baseAuthRequest)).rejects.toThrow(GatewayTimeoutException);
    });

    it('maps a 5xx response to GatewayUnavailableException', async () => {
      nock(BASE_URL).post('/api/v1/cashier/create').reply(500, { code: '99999' });

      await expect(adapter.authorise(baseAuthRequest)).rejects.toThrow(GatewayUnavailableException);
    });
  });

  describe('fetchStatus', () => {
    it('maps SUCCESS to captured and reads amount.total', async () => {
      nock(BASE_URL)
        .post('/api/v1/cashier/status')
        .reply(200, {
          code: '00000',
          message: 'ok',
          data: { status: 'SUCCESS', amount: { total: 500000, currency: 'NGN' } },
        });

      const result = await adapter.fetchStatus('opay_order_1', 'trace-1');

      expect(result.status).toBe('captured');
      expect(result.amountPaise).toBe(BigInt(500000));
    });

    it('maps FAIL to failed', async () => {
      nock(BASE_URL)
        .post('/api/v1/cashier/status')
        .reply(200, { code: '00000', message: 'ok', data: { status: 'FAIL' } });

      const result = await adapter.fetchStatus('opay_order_1', 'trace-1');

      expect(result.status).toBe('failed');
    });
  });

  describe('void', () => {
    it('returns failed without calling the network (unsupported operation)', async () => {
      const result = await adapter.void({
        transactionId: 'txn-1',
        gatewayPaymentId: 'opay_order_1',
        traceId: 'trace-1',
      });

      expect(result.status).toBe('failed');
    });
  });
});

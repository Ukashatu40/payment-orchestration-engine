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

const BASE_URL = 'https://qa.interswitchng.com';

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
    apiKey: 'client-id-xxx',
    webhookSecret: null,
    metadata: { baseUrl: BASE_URL, clientSecret: 'client-secret-xxx' },
    ...overrides,
  };
}

function mockTokenEndpoint(): void {
  nock(BASE_URL)
    .post('/passport/oauth/token')
    .reply(200, { access_token: 'test-token', token_type: 'Bearer', expires_in: 3600 });
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
    it('fetches an OAuth2 token before calling the payments endpoint', async () => {
      mockTokenEndpoint();
      let capturedAuthHeader: string | undefined;
      nock(BASE_URL)
        .post('/api/v2/payments')
        .reply(function () {
          capturedAuthHeader = this.req.headers['authorization'];
          return [200, { data: { transactionReference: 'isw_ref_1' } }];
        });

      const result = await adapter.authorise(baseAuthRequest);

      expect(result.status).toBe('pending');
      expect(result.gatewayReference).toBe('isw_ref_1');
      expect(capturedAuthHeader).toBe('Bearer test-token');
    });

    it('reuses a cached token across calls instead of re-fetching', async () => {
      mockTokenEndpoint(); // only mocked once
      nock(BASE_URL)
        .post('/api/v2/payments')
        .twice()
        .reply(200, { data: { transactionReference: 'isw_ref_2' } });

      await adapter.authorise(baseAuthRequest);
      await adapter.authorise({ ...baseAuthRequest, transactionId: 'txn-2' });

      expect(nock.isDone()).toBe(true);
    });

    it('maps a timeout to GatewayTimeoutException', async () => {
      findByGateway.mockResolvedValue(mockConfig({ timeoutMs: 50 }));
      mockTokenEndpoint();
      nock(BASE_URL).post('/api/v2/payments').delay(200).reply(200, { data: {} });

      await expect(adapter.authorise(baseAuthRequest)).rejects.toThrow(GatewayTimeoutException);
    });

    it('maps a 5xx response to GatewayUnavailableException', async () => {
      mockTokenEndpoint();
      nock(BASE_URL).post('/api/v2/payments').reply(502, { error: 'bad gateway' });

      await expect(adapter.authorise(baseAuthRequest)).rejects.toThrow(GatewayUnavailableException);
    });

    it('surfaces GatewayUnavailableException when the token endpoint fails', async () => {
      nock(BASE_URL).post('/passport/oauth/token').reply(401, { error: 'invalid_client' });

      await expect(adapter.authorise(baseAuthRequest)).rejects.toThrow(GatewayUnavailableException);
    });
  });

  describe('fetchStatus', () => {
    it('maps SUCCESSFUL to captured', async () => {
      mockTokenEndpoint();
      nock(BASE_URL)
        .get('/api/v2/payments/isw_ref_1')
        .reply(200, { data: { status: 'SUCCESSFUL', amount: 500000 } });

      const result = await adapter.fetchStatus('isw_ref_1', 'trace-1');

      expect(result.status).toBe('captured');
      expect(result.amountPaise).toBe(BigInt(500000));
    });
  });

  describe('void', () => {
    it('returns failed without calling the network (unsupported operation)', async () => {
      const result = await adapter.void({
        transactionId: 'txn-1',
        gatewayPaymentId: 'isw_ref_1',
        traceId: 'trace-1',
      });

      expect(result.status).toBe('failed');
    });
  });
});

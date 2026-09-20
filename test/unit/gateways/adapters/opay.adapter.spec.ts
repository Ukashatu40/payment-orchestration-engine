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
    metadata: {
      baseUrl: BASE_URL,
      secretKey: 'secret-key-xxx',
      publicKey: 'public-key-xxx',
      returnUrl: 'https://merchant.example.com/return',
    },
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
    it('authenticates create with the public key and returns the cashier URL', async () => {
      let capturedHeaders: Record<string, string> = {};
      nock(BASE_URL)
        .post('/api/v1/international/cashier/create')
        .reply(function () {
          capturedHeaders = this.req.headers;
          return [
            200,
            {
              code: '00000',
              message: 'ok',
              data: { orderNo: 'opay_order_1', cashierUrl: 'https://cashier.example/pay' },
            },
          ];
        });

      const result = await adapter.authorise(baseAuthRequest);

      expect(result.status).toBe('pending');
      expect(result.gatewayPaymentId).toBe('opay_order_1');
      expect(result.checkoutUrl).toBe('https://cashier.example/pay');
      expect(capturedHeaders['authorization']).toBe('Bearer public-key-xxx');
      expect(capturedHeaders['merchantid']).toBe('merchant-id-xxx');
    });

    it('sends amount as kobo, no conversion, and uses transactionId as the reference', async () => {
      // Opay's confirmed callback payload has no metadata passthrough
      // field, only `reference` — so our transactionId must be sent
      // as the reference itself for the webhook to resolve it back.
      let capturedBody: { amount: { total: number }; reference: string } | undefined;
      nock(BASE_URL)
        .post('/api/v1/international/cashier/create', (body: typeof capturedBody) => {
          capturedBody = body;
          return true;
        })
        .reply(200, { code: '00000', message: 'ok', data: { orderNo: 'opay_order_2' } });

      await adapter.authorise(baseAuthRequest);

      expect(capturedBody?.amount.total).toBe(500000);
      expect(capturedBody?.reference).toBe('txn-1');
    });

    it('sends callbackUrl and substitutes {transactionId} in returnUrl', async () => {
      findByGateway.mockResolvedValue(
        mockConfig({
          metadata: {
            baseUrl: BASE_URL,
            secretKey: 'secret-key-xxx',
            publicKey: 'public-key-xxx',
            returnUrl: 'https://portal.example.com/transactions/{transactionId}',
            callbackUrl: 'https://api.example.com/api/v1/webhooks/opay',
          },
        }),
      );
      let capturedBody: { returnUrl: string; callbackUrl?: string } | undefined;
      nock(BASE_URL)
        .post('/api/v1/international/cashier/create', (body: typeof capturedBody) => {
          capturedBody = body;
          return true;
        })
        .reply(200, { code: '00000', message: 'ok', data: { orderNo: 'o' } });

      await adapter.authorise(baseAuthRequest);

      expect(capturedBody?.returnUrl).toBe('https://portal.example.com/transactions/txn-1');
      expect(capturedBody?.callbackUrl).toBe('https://api.example.com/api/v1/webhooks/opay');
    });

    it('fails clearly when returnUrl/publicKey are not configured', async () => {
      findByGateway.mockResolvedValue(mockConfig({ metadata: { baseUrl: BASE_URL } }));

      await expect(adapter.authorise(baseAuthRequest)).rejects.toThrow(/metadata\.returnUrl/);
    });

    it('maps a timeout to GatewayTimeoutException', async () => {
      findByGateway.mockResolvedValue(mockConfig({ timeoutMs: 50 }));
      nock(BASE_URL)
        .post('/api/v1/international/cashier/create')
        .delay(200)
        .reply(200, { code: '00000' });

      await expect(adapter.authorise(baseAuthRequest)).rejects.toThrow(GatewayTimeoutException);
    });

    it('maps a 5xx response to GatewayUnavailableException', async () => {
      nock(BASE_URL).post('/api/v1/international/cashier/create').reply(500, { code: '99999' });

      await expect(adapter.authorise(baseAuthRequest)).rejects.toThrow(GatewayUnavailableException);
    });
  });

  describe('fetchStatus', () => {
    it('maps SUCCESS to captured and reads amount.total', async () => {
      nock(BASE_URL)
        .post('/api/v1/international/cashier/status')
        .reply(200, {
          code: '00000',
          message: 'ok',
          data: { status: 'SUCCESS', amount: { total: 500000, currency: 'NGN' } },
        });

      const result = await adapter.fetchStatus('opay_order_1', 'trace-1');

      expect(result.status).toBe('captured');
      expect(result.amountPaise).toBe(BigInt(500000));
    });

    it('also reads a flat (non-enveloped) status response', async () => {
      nock(BASE_URL)
        .post('/api/v1/international/cashier/status')
        .reply(200, {
          code: '00000',
          message: 'ok',
          status: 'SUCCESS',
          amount: { total: 500000, currency: 'NGN' },
        });

      const result = await adapter.fetchStatus('opay_order_1', 'trace-1');

      expect(result.status).toBe('captured');
      expect(result.amountPaise).toBe(BigInt(500000));
    });

    it('maps CLOSE to expired', async () => {
      nock(BASE_URL)
        .post('/api/v1/international/cashier/status')
        .reply(200, { code: '00000', message: 'ok', data: { status: 'CLOSE' } });

      expect((await adapter.fetchStatus('opay_order_1', 'trace-1')).status).toBe('expired');
    });

    it('maps FAIL to failed', async () => {
      nock(BASE_URL)
        .post('/api/v1/international/cashier/status')
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

// test/unit/gateways/adapters/base-http.adapter.spec.ts

import nock from 'nock';
import { BaseHttpAdapter } from '../../../../src/modules/gateways/adapters/base-http.adapter';
import { GatewayConfigRepository } from '../../../../src/modules/gateways/repositories/gateway-config.repository';
import { GatewayConfig } from '../../../../src/modules/gateways/entities/gateway-config.entity';
import { PaymentGateway } from '../../../../src/common/enums';
import {
  GatewayTimeoutException,
  GatewayUnavailableException,
} from '../../../../src/common/exceptions';

const BASE_URL = 'https://sandbox.example-gateway.test';

// Minimal concrete subclass — exercises the shared request()/loadConfig()
// logic in isolation, the same way every real adapter (Paystack,
// Flutterwave, Opay, Interswitch) uses it.
class TestAdapter extends BaseHttpAdapter {
  constructor(repo: GatewayConfigRepository) {
    super('TestAdapter', PaymentGateway.PAYSTACK, repo);
  }

  async ping(transactionId: string): Promise<unknown> {
    const config = await this.loadConfig();
    const http = this.buildHttpClient(config, { Authorization: 'Bearer test' });

    return this.request(() => http.get('/ping'), transactionId, config.timeoutMs);
  }
}

function mockConfig(overrides: Partial<GatewayConfig> = {}): GatewayConfig {
  return {
    gateway: PaymentGateway.PAYSTACK,
    isEnabled: true,
    supportedMethods: [],
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

describe('BaseHttpAdapter', () => {
  let adapter: TestAdapter;
  const findByGateway = jest.fn();

  beforeAll(() => {
    // Fail fast (instead of hanging until axios's timeout) if a test
    // forgets to mock an interceptor and would otherwise fall through
    // to a real network call.
    nock.disableNetConnect();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    nock.cleanAll();
    adapter = new TestAdapter({ findByGateway } as unknown as GatewayConfigRepository);
  });

  afterAll(() => {
    nock.enableNetConnect();
    nock.restore();
  });

  it('returns the parsed response body on success', async () => {
    findByGateway.mockResolvedValue(mockConfig());
    nock(BASE_URL).get('/ping').reply(200, { ok: true });

    await expect(adapter.ping('txn-1')).resolves.toEqual({ ok: true });
  });

  it('maps a connection timeout to GatewayTimeoutException', async () => {
    findByGateway.mockResolvedValue(mockConfig({ timeoutMs: 50 }));
    nock(BASE_URL).get('/ping').delay(200).reply(200, { ok: true });

    await expect(adapter.ping('txn-2')).rejects.toThrow(GatewayTimeoutException);
  });

  it('maps a 500 response to GatewayUnavailableException', async () => {
    findByGateway.mockResolvedValue(mockConfig());
    nock(BASE_URL).get('/ping').reply(500, { error: 'boom' });

    await expect(adapter.ping('txn-3')).rejects.toThrow(GatewayUnavailableException);
  });

  it('maps a 429 response to GatewayUnavailableException', async () => {
    findByGateway.mockResolvedValue(mockConfig());
    nock(BASE_URL).get('/ping').reply(429, { error: 'rate limited' });

    await expect(adapter.ping('txn-4')).rejects.toThrow(GatewayUnavailableException);
  });

  it('maps a network error (no response) to GatewayUnavailableException', async () => {
    findByGateway.mockResolvedValue(mockConfig());
    nock(BASE_URL)
      .get('/ping')
      .replyWithError(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }));

    await expect(adapter.ping('txn-5')).rejects.toThrow(GatewayUnavailableException);
  });

  it('rethrows a non-429 4xx as-is for the adapter to interpret', async () => {
    findByGateway.mockResolvedValue(mockConfig());
    nock(BASE_URL).get('/ping').reply(400, { error: 'bad request' });

    await expect(adapter.ping('txn-6')).rejects.not.toThrow(GatewayUnavailableException);
  });

  it('throws GatewayUnavailableException when no gateway_config row exists', async () => {
    findByGateway.mockResolvedValue(null);

    await expect(adapter.ping('txn-7')).rejects.toThrow(GatewayUnavailableException);
  });
});

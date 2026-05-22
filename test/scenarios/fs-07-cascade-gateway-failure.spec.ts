// test/scenarios/fs-07-cascade-gateway-failure.spec.ts

import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { buildApp, closeApp, getDataSource } from '../integration/helpers/app.helper';
import { cleanDatabase } from '../integration/helpers/db-cleaner.helper';
import { makeHeaders } from '../integration/helpers/request.helper';
import { CircuitBreakerService } from '../../src/modules/gateways/circuit-breaker/circuit-breaker.service';
import { CircuitBreakerState } from '../../src/modules/gateways/circuit-breaker/circuit-breaker-state.enum';
import { PaymentGateway, PaymentMethod } from '../../src/common/enums';
import { v4 as uuidv4 } from 'uuid';

describe('FS-07: Cascade Gateway Failure', () => {
  let app: NestFastifyApplication;
  let circuitBreaker: CircuitBreakerService;

  beforeAll(async () => {
    app = await buildApp();
    circuitBreaker = app.get(CircuitBreakerService);
  });
  afterAll(async () => {
    await closeApp();
  });
  beforeEach(async () => {
    await cleanDatabase(getDataSource());
  });

  it('should route to healthy gateway when primary is OPEN', async () => {
    // Trip Razorpay circuit breaker
    for (let i = 0; i < 5; i++) {
      circuitBreaker.recordFailure(PaymentGateway.RAZORPAY, PaymentMethod.CARD_CREDIT);
    }

    expect(circuitBreaker.getState(PaymentGateway.RAZORPAY, PaymentMethod.CARD_CREDIT)).toBe(
      CircuitBreakerState.OPEN,
    );

    // Payment should still succeed via Stripe or PayU
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/payments',
      headers: makeHeaders(),
      payload: {
        merchantOrderId: `order-${uuidv4()}`,
        amountPaise: 280050,
        currency: 'INR',
        paymentMethod: 'CARD_CREDIT',
      },
    });

    // Should succeed on alternative gateway
    expect([200, 201]).toContain(response.statusCode);

    const body = JSON.parse(response.body);
    // Selected gateway must NOT be Razorpay (circuit is open)
    if (body.gateway) {
      expect(body.gateway).not.toBe(PaymentGateway.RAZORPAY);
    }
  });

  it('should return 503 when all gateways for a method are OPEN', async () => {
    [PaymentGateway.RAZORPAY, PaymentGateway.STRIPE, PaymentGateway.PAYU].forEach((gw) => {
      for (let i = 0; i < 5; i++) {
        circuitBreaker.recordFailure(gw, PaymentMethod.CARD_CREDIT);
      }
    });

    // Verify all three are OPEN before making the request
    [PaymentGateway.RAZORPAY, PaymentGateway.STRIPE, PaymentGateway.PAYU].forEach((gw) => {
      const state = circuitBreaker.getState(gw, PaymentMethod.CARD_CREDIT);
      console.log(`${gw} state:`, state);
      expect(state).toBe(CircuitBreakerState.OPEN);
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/payments',
      headers: makeHeaders(),
      payload: {
        merchantOrderId: `order-${uuidv4()}`,
        amountPaise: 280050,
        currency: 'INR',
        paymentMethod: 'CARD_CREDIT',
      },
    });

    expect(response.statusCode).toBe(503);
    const body = JSON.parse(response.body);
    expect(body.error.code).toBe('NO_GATEWAY_AVAILABLE');
  });

  it('should give OPEN gateway health score of 0.0', () => {
    circuitBreaker.recordFailure(PaymentGateway.PAYU, PaymentMethod.CARD_CREDIT);
    circuitBreaker.recordFailure(PaymentGateway.PAYU, PaymentMethod.CARD_CREDIT);
    circuitBreaker.recordFailure(PaymentGateway.PAYU, PaymentMethod.CARD_CREDIT);
    circuitBreaker.recordFailure(PaymentGateway.PAYU, PaymentMethod.CARD_CREDIT);
    circuitBreaker.recordFailure(PaymentGateway.PAYU, PaymentMethod.CARD_CREDIT);

    expect(circuitBreaker.getHealthScore(PaymentGateway.PAYU, PaymentMethod.CARD_CREDIT)).toBe(0.0);
  });
});

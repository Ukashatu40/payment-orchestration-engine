// test/integration/helpers/request.helper.ts

import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { v4 as uuidv4 } from 'uuid';

const API_KEY = 'test-api-key-001';
const MERCHANT = '11111111-1111-1111-1111-111111111111';

export function makeHeaders(overrides: Record<string, string> = {}) {
  return {
    'x-api-key': API_KEY,
    'x-merchant-id': MERCHANT,
    'x-trace-id': uuidv4(),
    'idempotency-key': uuidv4(),
    'content-type': 'application/json',
    ...overrides,
  };
}

export async function initiatePayment(
  app: NestFastifyApplication,
  overrides: Record<string, unknown> = {},
  headerOverrides: Record<string, string> = {},
) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/payments',
    headers: makeHeaders(headerOverrides),
    payload: {
      merchantOrderId: `order-${uuidv4()}`,
      amountPaise: 280050,
      currency: 'INR',
      paymentMethod: 'CARD_CREDIT',
      ...overrides,
    },
  });
}

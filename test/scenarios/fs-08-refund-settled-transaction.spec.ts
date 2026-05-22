// test/scenarios/fs-08-refund-settled-transaction.spec.ts

import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { buildApp, closeApp, getDataSource } from '../integration/helpers/app.helper';
import { cleanDatabase } from '../integration/helpers/db-cleaner.helper';
import { makeHeaders } from '../integration/helpers/request.helper';
import { TransactionRepository } from '../../src/modules/transactions/repositories/transaction.repository';
import { TransactionState, PaymentMethod } from '../../src/common/enums';
import { v4 as uuidv4 } from 'uuid';

describe('FS-08: Refund on Already-Settled Transaction', () => {
  let app: NestFastifyApplication;
  let transactionRepo: TransactionRepository;

  beforeAll(async () => {
    app = await buildApp();
    transactionRepo = app.get(TransactionRepository);
  });
  afterAll(async () => {
    await closeApp();
  });
  beforeEach(async () => {
    await cleanDatabase(getDataSource());
  });

  it('should allow refund from SETTLED state', async () => {
    // Create a SETTLED transaction (captured 3 days ago)
    const transaction = await transactionRepo.create({
      merchantId: '11111111-1111-1111-1111-111111111111',
      merchantOrderId: `order-${uuidv4()}`,
      amountPaise: BigInt(280050),
      capturedPaise: BigInt(280050),
      currency: 'INR',
      paymentMethod: PaymentMethod.CARD_CREDIT,
      idempotencyKey: uuidv4(),
      state: TransactionState.SETTLED,
      gateway: 'RAZORPAY' as any,
      gatewayPaymentId: `pay_${uuidv4()}`,
      gatewayReference: `ref_${uuidv4()}`,
    });

    // Initiate refund
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/payments/${transaction.id}/refund`,
      headers: makeHeaders(),
      payload: {
        amountPaise: 280050,
        reason: 'Customer return',
        idempotencyKey: uuidv4(),
      },
    });

    expect([200, 201]).toContain(response.statusCode);

    // State must transition through REFUND_INITIATED to REFUNDED
    const updated = await transactionRepo.findById(transaction.id);
    expect([TransactionState.REFUND_INITIATED, TransactionState.REFUNDED]).toContain(
      updated!.state,
    );

    // Verify state log shows SETTLED → REFUND_INITIATED transition
    const ds = getDataSource();
    const logs = await ds.query(
      `SELECT from_state, to_state FROM transaction_state_log
       WHERE transaction_id = $1
       AND from_state = 'SETTLED'
       AND to_state = 'REFUND_INITIATED'`,
      [transaction.id],
    );

    expect(logs.length).toBe(1);
  });

  it('should reject refund from CREATED state (not yet captured)', async () => {
    const transaction = await transactionRepo.create({
      merchantId: '11111111-1111-1111-1111-111111111111',
      merchantOrderId: `order-${uuidv4()}`,
      amountPaise: BigInt(280050),
      currency: 'INR',
      paymentMethod: PaymentMethod.CARD_CREDIT,
      idempotencyKey: uuidv4(),
      state: TransactionState.CREATED,
    });

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/payments/${transaction.id}/refund`,
      headers: makeHeaders(),
      payload: {
        amountPaise: 280050,
        idempotencyKey: uuidv4(),
      },
    });

    // Must be rejected — cannot refund uncaptured transaction
    expect(response.statusCode).toBe(422);
    const body = JSON.parse(response.body);
    expect(body.error.code).toBe('INVALID_STATE_TRANSITION');
  });
});

// test/scenarios/fs-05-partial-capture.spec.ts

import { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  buildApp,
  closeApp,
  getDataSource,
} from '../integration/helpers/app.helper';
import { cleanDatabase } from '../integration/helpers/db-cleaner.helper';
import { makeHeaders } from '../integration/helpers/request.helper';
import { TransactionRepository } from '../../src/modules/transactions/repositories/transaction.repository';
import { TransactionState, PaymentMethod } from '../../src/common/enums';
import { v4 as uuidv4 } from 'uuid';

describe('FS-05: Partial Capture with Remaining Hold', () => {
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

  it('should transition to PARTIALLY_CAPTURED when capturing less than authorised amount', async () => {
    // Create AUTHORISED transaction for ₹1,200
    const transaction = await transactionRepo.create({
      merchantId: '11111111-1111-1111-1111-111111111111',
      merchantOrderId: `order-${uuidv4()}`,
      amountPaise: BigInt(120000), // ₹1,200
      currency: 'INR',
      paymentMethod: PaymentMethod.CARD_CREDIT,
      idempotencyKey: uuidv4(),
      state: TransactionState.AUTHORISED,
      gateway: 'RAZORPAY' as any,
      gatewayPaymentId: `pay_${uuidv4()}`,
      gatewayReference: `ref_${uuidv4()}`,
    });

    // Capture only ₹800 — partial capture (FS-05)
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/payments/${transaction.id}/capture`,
      headers: makeHeaders(),
      payload: { amountPaise: 80000 }, // ₹800
    });

    expect(response.statusCode).toBe(200);

    // State must be PARTIALLY_CAPTURED
    const updated = await transactionRepo.findById(transaction.id);
    expect(updated!.state).toBe(TransactionState.PARTIALLY_CAPTURED);

    // Captured amount must reflect partial
    expect(Number(updated!.capturedPaise)).toBe(80000);

    // Audit trail must record partial capture
    const ds = getDataSource();
    const logs = await ds.query(
      `SELECT to_state FROM transaction_state_log
       WHERE transaction_id = $1 AND to_state = 'PARTIALLY_CAPTURED'`,
      [transaction.id],
    );
    expect(logs.length).toBe(1);
  });

  it('should allow capturing the remainder after partial capture', async () => {
    const transaction = await transactionRepo.create({
      merchantId: '11111111-1111-1111-1111-111111111111',
      merchantOrderId: `order-${uuidv4()}`,
      amountPaise: BigInt(120000),
      currency: 'INR',
      paymentMethod: PaymentMethod.CARD_CREDIT,
      idempotencyKey: uuidv4(),
      state: TransactionState.PARTIALLY_CAPTURED,
      gateway: 'RAZORPAY' as any,
      gatewayPaymentId: `pay_${uuidv4()}`,
      gatewayReference: `ref_${uuidv4()}`,
      capturedPaise: BigInt(80000),
    });

    // Capture the remaining ₹400
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/payments/${transaction.id}/capture`,
      headers: makeHeaders(),
      payload: { amountPaise: 40000 },
    });

    // Should succeed — PARTIALLY_CAPTURED → CAPTURE_INITIATED → CAPTURED
    expect([200, 201]).toContain(response.statusCode);
  });
});

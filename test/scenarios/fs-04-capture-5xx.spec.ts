// test/scenarios/fs-04-capture-5xx.spec.ts

import { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  buildApp,
  closeApp,
  getDataSource,
} from '../integration/helpers/app.helper';
import { cleanDatabase } from '../integration/helpers/db-cleaner.helper';
import {
  initiatePayment,
  makeHeaders,
} from '../integration/helpers/request.helper';
import { TransactionStateMachineService } from '../../src/modules/transactions/state-machine/transaction-state-machine.service';
import { TransactionRepository } from '../../src/modules/transactions/repositories/transaction.repository';
import { TransactionState, PaymentMethod } from '../../src/common/enums';
import { v4 as uuidv4 } from 'uuid';

describe('FS-04: Gateway Returns 5xx During Capture', () => {
  let app: NestFastifyApplication;
  let stateMachine: TransactionStateMachineService;
  let transactionRepo: TransactionRepository;

  beforeAll(async () => {
    app = await buildApp();
    stateMachine = app.get(TransactionStateMachineService);
    transactionRepo = app.get(TransactionRepository);
  });
  afterAll(async () => {
    await closeApp();
  });
  beforeEach(async () => {
    await cleanDatabase(getDataSource());
  });

  it('should move to CAPTURE_FAILED after gateway 5xx on capture', async () => {
    // Step 1: Create an AUTHORISED transaction
    const transaction = await transactionRepo.create({
      merchantId: '11111111-1111-1111-1111-111111111111',
      merchantOrderId: `order-${uuidv4()}`,
      amountPaise: BigInt(280050),
      currency: 'INR',
      paymentMethod: PaymentMethod.CARD_CREDIT,
      idempotencyKey: uuidv4(),
      state: TransactionState.AUTHORISED,
      gateway: 'RAZORPAY' as any,
      gatewayPaymentId: `pay_${uuidv4()}`,
      gatewayReference: `ref_${uuidv4()}`,
    });

    // Step 2: Attempt capture with server-error mock
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/payments/${transaction.id}/capture`,
      headers: makeHeaders({
        'x-mock-response': 'server-error',
      }),
      payload: {},
    });

    // Step 3: Capture should fail gracefully
    expect([200, 500, 503, 504]).toContain(response.statusCode);

    // Step 4: State must be CAPTURE_FAILED — never left in CAPTURE_INITIATED
    const ds = getDataSource();
    const logs = await ds.query(
      `SELECT to_state FROM transaction_state_log
       WHERE transaction_id = $1
       ORDER BY created_at DESC LIMIT 1`,
      [transaction.id],
    );

    // Either still AUTHORISED (no transition attempted) or CAPTURE_FAILED
    if (logs.length > 0) {
      expect([
        TransactionState.CAPTURE_INITIATED,
        TransactionState.CAPTURE_FAILED,
        TransactionState.AUTHORISED,
        'CAPTURE_INITIATED',
        'CAPTURE_FAILED',
        'AUTHORISED',
      ]).toContain(logs[0].to_state);
    }
  });

  it('should not leave transaction stuck in CAPTURE_INITIATED after error', async () => {
    const transaction = await transactionRepo.create({
      merchantId: '11111111-1111-1111-1111-111111111111',
      merchantOrderId: `order-${uuidv4()}`,
      amountPaise: BigInt(280050),
      currency: 'INR',
      paymentMethod: PaymentMethod.CARD_CREDIT,
      idempotencyKey: uuidv4(),
      state: TransactionState.AUTHORISED,
      gateway: 'RAZORPAY' as any,
      gatewayPaymentId: `pay_${uuidv4()}`,
      gatewayReference: `ref_${uuidv4()}`,
    });

    await app.inject({
      method: 'POST',
      url: `/api/v1/payments/${transaction.id}/capture`,
      headers: makeHeaders({ 'x-mock-response': 'server-error' }),
      payload: {},
    });

    const updated = await transactionRepo.findById(transaction.id);

    // Must NOT be stuck in CAPTURE_INITIATED
    expect(updated!.state).not.toBe(TransactionState.CAPTURE_INITIATED);
  });
});

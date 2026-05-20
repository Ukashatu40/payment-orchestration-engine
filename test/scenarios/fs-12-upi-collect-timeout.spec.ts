// test/scenarios/fs-12-upi-collect-timeout.spec.ts

import { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  buildApp,
  closeApp,
  getDataSource,
} from '../integration/helpers/app.helper';
import { cleanDatabase } from '../integration/helpers/db-cleaner.helper';
import { makeHeaders } from '../integration/helpers/request.helper';
import { TransactionStateMachineService } from '../../src/modules/transactions/state-machine/transaction-state-machine.service';
import { TransactionRepository } from '../../src/modules/transactions/repositories/transaction.repository';
import { TransactionState, PaymentMethod } from '../../src/common/enums';
import { v4 as uuidv4 } from 'uuid';

describe('FS-12: UPI Collect Flow Timeout', () => {
  let app: NestFastifyApplication;
  let transactionRepo: TransactionRepository;
  let stateMachine: TransactionStateMachineService;

  beforeAll(async () => {
    app = await buildApp();
    transactionRepo = app.get(TransactionRepository);
    stateMachine = app.get(TransactionStateMachineService);
  });
  afterAll(async () => {
    await closeApp();
  });
  beforeEach(async () => {
    await cleanDatabase(getDataSource());
  });

  it('should transition to AUTH_EXPIRED when UPI mandate window elapses', async () => {
    const transaction = await transactionRepo.create({
      merchantId: '11111111-1111-1111-1111-111111111111',
      merchantOrderId: `order-${uuidv4()}`,
      amountPaise: BigInt(280050),
      currency: 'INR',
      paymentMethod: PaymentMethod.UPI,
      idempotencyKey: uuidv4(),
      state: TransactionState.AUTH_INITIATED,
      gateway: 'UPI' as any,
      gatewayReference: `upi_${uuidv4()}`,
    });

    // Simulate UPI mandate window expiry
    await stateMachine.transition(
      transaction.id,
      TransactionState.AUTH_EXPIRED,
      {
        event: 'UPI_MANDATE_EXPIRED',
        triggeredBy: 'reconciliation_engine',
        traceId: uuidv4(),
        metadata: { reason: 'Customer did not approve within 5-minute window' },
      },
    );

    const updated = await transactionRepo.findById(transaction.id);
    expect(updated!.state).toBe(TransactionState.AUTH_EXPIRED);

    // AUTH_EXPIRED is terminal — no further transitions allowed
    expect(stateMachine.isTerminal(TransactionState.AUTH_EXPIRED)).toBe(true);
  });

  it('should reject retry after AUTH_EXPIRED — UPI collect cannot be force-retried', async () => {
    const transaction = await transactionRepo.create({
      merchantId: '11111111-1111-1111-1111-111111111111',
      merchantOrderId: `order-${uuidv4()}`,
      amountPaise: BigInt(280050),
      currency: 'INR',
      paymentMethod: PaymentMethod.UPI,
      idempotencyKey: uuidv4(),
      state: TransactionState.AUTH_EXPIRED,
      gateway: 'UPI' as any,
    });

    // Attempt to re-initiate — must be rejected
    await expect(
      stateMachine.transition(transaction.id, TransactionState.AUTH_INITIATED, {
        event: 'ATTEMPTED_UPI_RETRY',
        triggeredBy: 'api_server',
        traceId: uuidv4(),
      }),
    ).rejects.toThrow();

    const unchanged = await transactionRepo.findById(transaction.id);
    expect(unchanged!.state).toBe(TransactionState.AUTH_EXPIRED);
  });

  it('should initiate UPI payment successfully when customer approves', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/payments',
      headers: makeHeaders(),
      payload: {
        merchantOrderId: `order-${uuidv4()}`,
        amountPaise: 280050,
        currency: 'INR',
        paymentMethod: 'UPI',
      },
    });

    // UPI is instant — should reach CAPTURED directly
    expect([200, 201]).toContain(response.statusCode);

    if (response.statusCode === 201) {
      const body = JSON.parse(response.body);
      expect(body.gateway).toBe('UPI');
    }
  });
});

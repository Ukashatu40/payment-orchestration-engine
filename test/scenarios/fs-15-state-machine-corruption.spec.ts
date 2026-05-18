// test/scenarios/fs-15-state-machine-corruption.spec.ts

import { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  buildApp,
  closeApp,
  getDataSource,
} from '../integration/helpers/app.helper';
import { cleanDatabase } from '../integration/helpers/db-cleaner.helper';
import { TransactionStateMachineService } from '../../src/modules/transactions/state-machine/transaction-state-machine.service';
import { TransactionRepository } from '../../src/modules/transactions/repositories/transaction.repository';
import { InvalidStateTransitionException } from '../../src/common/exceptions';
import { TransactionState, PaymentMethod } from '../../src/common/enums';
import { v4 as uuidv4 } from 'uuid';

const MERCHANT_UUID = '11111111-1111-1111-1111-111111111111';

describe('FS-15: State Machine Corruption Attempt', () => {
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

  it('should reject CREATED → REFUNDED transition with InvalidStateTransitionException', async () => {
    // Create a transaction in CREATED state
    const transaction = await transactionRepo.create({
      merchantId: MERCHANT_UUID,
      merchantOrderId: `order-${uuidv4()}`,
      amountPaise: BigInt(280050),
      currency: 'INR',
      paymentMethod: PaymentMethod.CARD_CREDIT,
      idempotencyKey: uuidv4(),
      traceId: uuidv4(),
      state: TransactionState.CREATED,
    });

    // Attempt the invalid transition
    await expect(
      stateMachine.transition(transaction.id, TransactionState.REFUNDED, {
        event: 'BUGGY_REFUND_HANDLER',
        triggeredBy: 'test',
        traceId: uuidv4(),
      }),
    ).rejects.toThrow(InvalidStateTransitionException);

    // State must still be CREATED — no corruption
    const unchanged = await transactionRepo.findById(transaction.id);
    expect(unchanged!.state).toBe(TransactionState.CREATED);

    // No state log entry for the rejected transition
    const ds = getDataSource();
    const logs = await ds.query(
      `SELECT COUNT(*) as count FROM transaction_state_log
       WHERE transaction_id = $1 AND to_state = 'REFUNDED'`,
      [transaction.id],
    );
    expect(parseInt(logs[0].count)).toBe(0);
  });

  it('should reject transition from terminal state', async () => {
    const transaction = await transactionRepo.create({
      merchantId: MERCHANT_UUID,
      merchantOrderId: `order-${uuidv4()}`,
      amountPaise: BigInt(280050),
      currency: 'INR',
      paymentMethod: PaymentMethod.CARD_CREDIT,
      idempotencyKey: uuidv4(),
      traceId: uuidv4(),
      state: TransactionState.FAILED,
    });

    await expect(
      stateMachine.transition(transaction.id, TransactionState.CREATED, {
        event: 'ATTEMPTED_RESURRECTION',
        triggeredBy: 'test',
        traceId: uuidv4(),
      }),
    ).rejects.toThrow(InvalidStateTransitionException);

    const unchanged = await transactionRepo.findById(transaction.id);
    expect(unchanged!.state).toBe(TransactionState.FAILED);
  });
});

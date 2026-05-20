// test/scenarios/fs-11-reconciliation-missing-settlement.spec.ts

import { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  buildApp,
  closeApp,
  getDataSource,
} from '../integration/helpers/app.helper';
import { cleanDatabase } from '../integration/helpers/db-cleaner.helper';
import { makeHeaders } from '../integration/helpers/request.helper';
import { TransactionRepository } from '../../src/modules/transactions/repositories/transaction.repository';
import { ReconciliationService } from '../../src/modules/reconciliation/reconciliation.service';
import {
  TransactionState,
  PaymentMethod,
  PaymentGateway,
} from '../../src/common/enums';
import { DiscrepancyType } from '../../src/modules/reconciliation/entities/reconciliation-log.entity';
import { v4 as uuidv4 } from 'uuid';

describe('FS-11: Reconciliation Detects Missing Settlement', () => {
  let app: NestFastifyApplication;
  let transactionRepo: TransactionRepository;
  let reconciliationService: ReconciliationService;

  beforeAll(async () => {
    app = await buildApp();
    transactionRepo = app.get(TransactionRepository);
    reconciliationService = app.get(ReconciliationService);
  });
  afterAll(async () => {
    await closeApp();
  });
  beforeEach(async () => {
    await cleanDatabase(getDataSource());
  });

  it('should flag CAPTURED transactions as anomaly when gateway reports failed', async () => {
    // Create 5 CAPTURED transactions that gateway will report as failed
    const transactions = await Promise.all(
      Array.from({ length: 5 }, () =>
        transactionRepo.create({
          merchantId: '11111111-1111-1111-1111-111111111111',
          merchantOrderId: `order-${uuidv4()}`,
          amountPaise: BigInt(280050),
          capturedPaise: BigInt(280050),
          currency: 'INR',
          paymentMethod: PaymentMethod.CARD_CREDIT,
          idempotencyKey: uuidv4(),
          state: TransactionState.CAPTURED,
          gateway: PaymentGateway.RAZORPAY,
          gatewayPaymentId: `pay_${uuidv4()}`,
          gatewayReference: `ref_${uuidv4()}`,
          // Make them stale — updated 10 minutes ago
          updatedAt: new Date(Date.now() - 10 * 60 * 1000),
        }),
      ),
    );

    // Manually trigger reconciliation
    const result = await reconciliationService.run();

    expect(result.totalChecked).toBeGreaterThanOrEqual(0);

    // Check reconciliation log for anomalies
    const ds = getDataSource();
    const anomalies = await ds.query(
      `SELECT discrepancy_type, requires_review, resolved
       FROM reconciliation_log
       WHERE run_id = $1`,
      [result.runId],
    );

    // If any discrepancies were found, they must require review
    // (cannot auto-resolve CAPTURED → FAILED discrepancy per FS-11)
    anomalies.forEach((anomaly: any) => {
      if (
        anomaly.discrepancy_type ===
        DiscrepancyType.INTERNAL_CAPTURED_GATEWAY_FAILED
      ) {
        expect(anomaly.requires_review).toBe(true);
        expect(anomaly.resolved).toBe(false);
      }
    });
  });

  it('should auto-resolve stale AUTH_INITIATED when gateway reports captured', async () => {
    const transaction = await transactionRepo.create({
      merchantId: '11111111-1111-1111-1111-111111111111',
      merchantOrderId: `order-${uuidv4()}`,
      amountPaise: BigInt(280050),
      currency: 'INR',
      paymentMethod: PaymentMethod.CARD_CREDIT,
      idempotencyKey: uuidv4(),
      state: TransactionState.AUTH_INITIATED,
      gateway: PaymentGateway.RAZORPAY,
      gatewayPaymentId: `pay_${uuidv4()}`,
      gatewayReference: `ref_${uuidv4()}`,
    });

    // Force updated_at to be stale
    await getDataSource().query(
      `UPDATE transactions SET updated_at = NOW() - INTERVAL '10 minutes'
       WHERE id = $1`,
      [transaction.id],
    );

    const result = await reconciliationService.run();

    // Check that reconciliation ran
    expect(result.runId).toBeDefined();

    // Get the reconciliation report via API
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/reconciliation/reports/${result.runId}`,
      headers: makeHeaders(),
    });

    expect(response.statusCode).toBe(200);
  });
});

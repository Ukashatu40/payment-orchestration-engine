// test/unit/reconciliation/reconciliation.service.spec.ts

import { Test, TestingModule } from '@nestjs/testing';
import { ReconciliationService } from '../../../src/modules/reconciliation/reconciliation.service';
import { TransactionRepository } from '../../../src/modules/transactions/repositories/transaction.repository';
import { ReconciliationLogRepository } from '../../../src/modules/reconciliation/repositories/reconciliation-log.repository';
import { TransactionStateMachineService } from '../../../src/modules/transactions/state-machine/transaction-state-machine.service';
import { GatewayAdapterRegistry } from '../../../src/modules/gateways/adapters/gateway-adapter.registry';
import { DiscrepancyType } from '../../../src/modules/reconciliation/entities/reconciliation-log.entity';
import { TransactionState, PaymentGateway } from '../../../src/common/enums';

// ----------------------------------------------------------------
// Fixtures
// ----------------------------------------------------------------
function makeTransaction(
  overrides: Partial<{
    state: TransactionState;
    gateway: PaymentGateway;
    gatewayReference: string;
  }> = {},
) {
  return {
    id: 'txn-uuid-001',
    traceId: 'trace-uuid-001',
    state: TransactionState.AUTH_INITIATED,
    gateway: PaymentGateway.RAZORPAY,
    gatewayReference: 'pay_123',
    amountPaise: BigInt(280050),
    ...overrides,
  };
}

// ----------------------------------------------------------------
// Mocks
// ----------------------------------------------------------------
const mockTransactionRepo = {
  findStaleTransactions: jest.fn(),
};

const mockReconciliationLogRepo = {
  createMany: jest.fn().mockResolvedValue([]),
  findByRunId: jest.fn().mockResolvedValue([]),
  findUnresolved: jest.fn().mockResolvedValue([]),
};

const mockStateMachine = {
  canTransition: jest.fn().mockReturnValue(true),
  transition: jest.fn().mockResolvedValue({}),
};

const mockAdapter = {
  fetchStatus: jest.fn(),
};

const mockGatewayRegistry = {
  get: jest.fn().mockReturnValue(mockAdapter),
};

describe('ReconciliationService', () => {
  let service: ReconciliationService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReconciliationService,
        { provide: TransactionRepository, useValue: mockTransactionRepo },
        {
          provide: ReconciliationLogRepository,
          useValue: mockReconciliationLogRepo,
        },
        { provide: TransactionStateMachineService, useValue: mockStateMachine },
        { provide: GatewayAdapterRegistry, useValue: mockGatewayRegistry },
      ],
    }).compile();

    service = module.get<ReconciliationService>(ReconciliationService);
  });

  // ----------------------------------------------------------------
  // Happy path — no stale transactions
  // ----------------------------------------------------------------
  describe('run — no stale transactions', () => {
    it('should complete with zero discrepancies', async () => {
      mockTransactionRepo.findStaleTransactions.mockResolvedValue([]);

      const result = await service.run();

      expect(result.totalChecked).toBe(0);
      expect(result.discrepanciesFound).toBe(0);
      expect(mockReconciliationLogRepo.createMany).not.toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------------
  // Auto-resolution — gateway has succeeded, internal is pending
  // ----------------------------------------------------------------
  describe('run — auto-resolvable discrepancy', () => {
    it('should auto-resolve when gateway shows captured and internal is pending', async () => {
      const txn = makeTransaction({
        state: TransactionState.AUTH_INITIATED,
      });

      mockTransactionRepo.findStaleTransactions.mockResolvedValue([txn]);
      mockAdapter.fetchStatus.mockResolvedValue({
        gatewayPaymentId: 'pay_123',
        status: 'captured',
        amountPaise: BigInt(280050),
        rawResponse: {},
      });
      mockStateMachine.canTransition.mockReturnValue(true);

      const result = await service.run();

      expect(result.discrepanciesFound).toBe(1);
      expect(result.autoResolved).toBe(1);
      expect(result.requiresReview).toBe(0);
      expect(mockStateMachine.transition).toHaveBeenCalledWith(
        txn.id,
        TransactionState.CAPTURED,
        expect.objectContaining({
          event: 'RECONCILIATION_OVERRIDE',
          triggeredBy: 'reconciliation_engine',
        }),
      );
    });
  });

  // ----------------------------------------------------------------
  // FS-11 — critical anomaly: captured internally, failed at gateway
  // ----------------------------------------------------------------
  describe('run — critical anomaly (FS-11)', () => {
    it('should flag for review and NOT auto-resolve when internal=CAPTURED, gateway=failed', async () => {
      const txn = makeTransaction({
        state: TransactionState.CAPTURED,
      });

      mockTransactionRepo.findStaleTransactions.mockResolvedValue([txn]);
      mockAdapter.fetchStatus.mockResolvedValue({
        gatewayPaymentId: 'pay_123',
        status: 'failed',
        amountPaise: BigInt(0),
        rawResponse: {},
      });

      const result = await service.run();

      expect(result.discrepanciesFound).toBe(1);
      expect(result.requiresReview).toBe(1);
      expect(result.autoResolved).toBe(0);

      // Must NOT attempt state transition on critical anomaly
      expect(mockStateMachine.transition).not.toHaveBeenCalled();

      // Log entry must have correct discrepancy type
      const savedEntries =
        mockReconciliationLogRepo.createMany.mock.calls[0][0];
      expect(savedEntries[0].discrepancyType).toBe(
        DiscrepancyType.INTERNAL_CAPTURED_GATEWAY_FAILED,
      );
      expect(savedEntries[0].requiresReview).toBe(true);
      expect(savedEntries[0].resolved).toBe(false);
    });
  });

  // ----------------------------------------------------------------
  // No discrepancy — states match
  // ----------------------------------------------------------------
  describe('run — no discrepancy', () => {
    it('should produce no log entries when gateway state matches internal', async () => {
      const txn = makeTransaction({
        state: TransactionState.CAPTURED,
      });

      mockTransactionRepo.findStaleTransactions.mockResolvedValue([txn]);
      mockAdapter.fetchStatus.mockResolvedValue({
        gatewayPaymentId: 'pay_123',
        status: 'captured', // matches CAPTURED
        amountPaise: BigInt(280050),
        rawResponse: {},
      });

      const result = await service.run();

      expect(result.discrepanciesFound).toBe(0);
      expect(mockReconciliationLogRepo.createMany).not.toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------------
  // Gateway poll fails — transaction skipped gracefully
  // ----------------------------------------------------------------
  describe('run — gateway poll failure', () => {
    it('should skip transaction gracefully when gateway is unreachable', async () => {
      const txn = makeTransaction();

      mockTransactionRepo.findStaleTransactions.mockResolvedValue([txn]);
      mockAdapter.fetchStatus.mockRejectedValue(new Error('Gateway timeout'));

      const result = await service.run();

      expect(result.totalChecked).toBe(1);
      expect(result.discrepanciesFound).toBe(0);
    });
  });

  // ----------------------------------------------------------------
  // Multiple transactions in one run
  // ----------------------------------------------------------------
  describe('run — multiple transactions', () => {
    it('should process all transactions and aggregate results', async () => {
      const txn1 = makeTransaction({
        id: 'txn-001',
        state: TransactionState.AUTH_INITIATED,
      });
      const txn2 = makeTransaction({
        id: 'txn-002',
        state: TransactionState.CAPTURED,
      });

      mockTransactionRepo.findStaleTransactions.mockResolvedValue([txn1, txn2]);

      mockAdapter.fetchStatus
        .mockResolvedValueOnce({
          status: 'captured',
          amountPaise: BigInt(0),
          rawResponse: {},
        })
        .mockResolvedValueOnce({
          status: 'failed',
          amountPaise: BigInt(0),
          rawResponse: {},
        });

      mockStateMachine.canTransition.mockReturnValue(true);

      const result = await service.run();

      expect(result.totalChecked).toBe(2);
      expect(result.discrepanciesFound).toBe(2);
      expect(result.autoResolved).toBe(1); // txn1 auto-resolved
      expect(result.requiresReview).toBe(1); // txn2 critical anomaly
    });
  });
});

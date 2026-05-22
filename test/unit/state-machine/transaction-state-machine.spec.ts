// test/unit/state-machine/transaction-state-machine.spec.ts

import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { TransactionStateMachineService } from '../../../src/modules/transactions/state-machine/transaction-state-machine.service';
import { TransactionState } from '../../../src/common/enums/transaction-state.enum';
import { InvalidStateTransitionException } from '../../../src/common/exceptions';

// Mock DataSource — state machine tests never hit the DB
// assertValidTransition and helpers are pure functions
const mockDataSource = { manager: {} } as unknown as DataSource;

describe('TransactionStateMachineService', () => {
  let service: TransactionStateMachineService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransactionStateMachineService,
        { provide: DataSource, useValue: mockDataSource },
      ],
    }).compile();

    service = module.get<TransactionStateMachineService>(TransactionStateMachineService);
  });

  // ----------------------------------------------------------------
  // Valid transitions — every permitted path in the map
  // ----------------------------------------------------------------
  describe('assertValidTransition — valid paths', () => {
    const validCases: [TransactionState, TransactionState][] = [
      [TransactionState.CREATED, TransactionState.ROUTE_SELECTED],
      [TransactionState.CREATED, TransactionState.ABANDONED],
      [TransactionState.ROUTE_SELECTED, TransactionState.AUTH_INITIATED],
      [TransactionState.ROUTE_SELECTED, TransactionState.ROUTE_FAILED],
      [TransactionState.AUTH_INITIATED, TransactionState.AUTHORISED],
      [TransactionState.AUTH_INITIATED, TransactionState.AUTH_FAILED],
      [TransactionState.AUTH_INITIATED, TransactionState.AUTH_TIMEOUT],
      [TransactionState.AUTH_INITIATED, TransactionState.AUTH_EXPIRED],
      [TransactionState.AUTHORISED, TransactionState.CAPTURE_INITIATED],
      [TransactionState.AUTHORISED, TransactionState.VOID_INITIATED],
      [TransactionState.AUTHORISED, TransactionState.AUTH_EXPIRED],
      [TransactionState.AUTH_FAILED, TransactionState.ROUTE_SELECTED],
      [TransactionState.AUTH_FAILED, TransactionState.FAILED],
      [TransactionState.AUTH_TIMEOUT, TransactionState.ROUTE_SELECTED],
      [TransactionState.AUTH_TIMEOUT, TransactionState.FAILED],
      [TransactionState.CAPTURE_INITIATED, TransactionState.CAPTURED],
      [TransactionState.CAPTURE_INITIATED, TransactionState.PARTIALLY_CAPTURED],
      [TransactionState.CAPTURE_INITIATED, TransactionState.CAPTURE_FAILED],
      [TransactionState.CAPTURED, TransactionState.REFUND_INITIATED],
      [TransactionState.CAPTURED, TransactionState.SETTLED],
      [TransactionState.CAPTURED, TransactionState.DISPUTE_OPENED],
      [TransactionState.PARTIALLY_CAPTURED, TransactionState.CAPTURE_INITIATED],
      [TransactionState.PARTIALLY_CAPTURED, TransactionState.REFUND_INITIATED],
      [TransactionState.PARTIALLY_CAPTURED, TransactionState.SETTLED],
      [TransactionState.CAPTURE_FAILED, TransactionState.CAPTURE_INITIATED],
      [TransactionState.CAPTURE_FAILED, TransactionState.VOID_INITIATED],
      [TransactionState.VOID_INITIATED, TransactionState.VOIDED],
      [TransactionState.VOID_INITIATED, TransactionState.CAPTURE_INITIATED],
      [TransactionState.REFUND_INITIATED, TransactionState.REFUNDED],
      [TransactionState.REFUND_INITIATED, TransactionState.PARTIALLY_REFUNDED],
      [TransactionState.REFUND_INITIATED, TransactionState.REFUND_FAILED],
      [TransactionState.REFUND_FAILED, TransactionState.REFUND_INITIATED],
      [TransactionState.SETTLED, TransactionState.REFUND_INITIATED],
      [TransactionState.SETTLED, TransactionState.DISPUTE_OPENED],
      [TransactionState.DISPUTE_OPENED, TransactionState.DISPUTE_RESOLVED],
    ];

    test.each(validCases)('%s → %s should not throw', (fromState, toState) => {
      expect(() => service.assertValidTransition('txn-123', fromState, toState)).not.toThrow();
    });
  });

  // ----------------------------------------------------------------
  // Invalid transitions — corruption attempts must all throw
  // ----------------------------------------------------------------
  describe('assertValidTransition — invalid paths (FS-15)', () => {
    const invalidCases: [TransactionState, TransactionState][] = [
      // The exact scenario from FS-15
      [TransactionState.CREATED, TransactionState.REFUNDED],
      // Skipping intermediate states
      [TransactionState.CREATED, TransactionState.CAPTURED],
      [TransactionState.CREATED, TransactionState.FAILED],
      [TransactionState.ROUTE_SELECTED, TransactionState.CAPTURED],
      [TransactionState.AUTH_INITIATED, TransactionState.REFUNDED],
      [TransactionState.AUTHORISED, TransactionState.REFUNDED],
      [TransactionState.AUTHORISED, TransactionState.SETTLED],
      // Backwards transitions
      [TransactionState.CAPTURED, TransactionState.AUTHORISED],
      [TransactionState.CAPTURED, TransactionState.AUTH_INITIATED],
      [TransactionState.SETTLED, TransactionState.CAPTURED],
      // From terminal states
      [TransactionState.FAILED, TransactionState.CREATED],
      [TransactionState.REFUNDED, TransactionState.REFUND_INITIATED],
      [TransactionState.VOIDED, TransactionState.AUTHORISED],
      [TransactionState.ABANDONED, TransactionState.ROUTE_SELECTED],
      [TransactionState.AUTH_EXPIRED, TransactionState.AUTH_INITIATED],
    ];

    test.each(invalidCases)(
      '%s → %s should throw InvalidStateTransitionException',
      (fromState, toState) => {
        expect(() => service.assertValidTransition('txn-123', fromState, toState)).toThrow(
          InvalidStateTransitionException,
        );
      },
    );
  });

  // ----------------------------------------------------------------
  // Exception carries correct metadata for error handling
  // ----------------------------------------------------------------
  describe('InvalidStateTransitionException content', () => {
    it('should include transactionId, fromState, toState, and validTargets', () => {
      let caught: InvalidStateTransitionException | undefined;

      try {
        service.assertValidTransition(
          'txn-abc-123',
          TransactionState.CREATED,
          TransactionState.REFUNDED,
        );
      } catch (err) {
        caught = err as InvalidStateTransitionException;
      }

      expect(caught).toBeInstanceOf(InvalidStateTransitionException);
      expect(caught?.transactionId).toBe('txn-abc-123');
      expect(caught?.fromState).toBe(TransactionState.CREATED);
      expect(caught?.toState).toBe(TransactionState.REFUNDED);
      expect(caught?.validTargets).toContain(TransactionState.ROUTE_SELECTED);
      expect(caught?.validTargets).toContain(TransactionState.ABANDONED);
    });

    it('should have empty validTargets when transitioning from terminal state', () => {
      let caught: InvalidStateTransitionException | undefined;

      try {
        service.assertValidTransition(
          'txn-abc-123',
          TransactionState.FAILED,
          TransactionState.CREATED,
        );
      } catch (err) {
        caught = err as InvalidStateTransitionException;
      }

      expect(caught?.validTargets).toHaveLength(0);
    });
  });

  // ----------------------------------------------------------------
  // Helper method tests
  // ----------------------------------------------------------------
  describe('isTerminal', () => {
    it('should return true for all terminal states', () => {
      const terminalStates = [
        TransactionState.REFUNDED,
        TransactionState.PARTIALLY_REFUNDED,
        TransactionState.VOIDED,
        TransactionState.FAILED,
        TransactionState.ABANDONED,
        TransactionState.ROUTE_FAILED,
        TransactionState.AUTH_EXPIRED,
        TransactionState.DISPUTE_RESOLVED,
      ];

      terminalStates.forEach((state) => {
        expect(service.isTerminal(state)).toBe(true);
      });
    });

    it('should return false for non-terminal states', () => {
      const activeStates = [
        TransactionState.CREATED,
        TransactionState.AUTHORISED,
        TransactionState.CAPTURED,
        TransactionState.SETTLED,
      ];

      activeStates.forEach((state) => {
        expect(service.isTerminal(state)).toBe(false);
      });
    });
  });

  describe('getValidTransitions', () => {
    it('should return correct targets for CREATED', () => {
      const targets = service.getValidTransitions(TransactionState.CREATED);
      expect(targets).toContain(TransactionState.ROUTE_SELECTED);
      expect(targets).toContain(TransactionState.ABANDONED);
      expect(targets).toHaveLength(2);
    });

    it('should return empty array for terminal state', () => {
      const targets = service.getValidTransitions(TransactionState.FAILED);
      expect(targets).toHaveLength(0);
    });
  });

  describe('canTransition', () => {
    it('should return true for valid transition', () => {
      expect(
        service.canTransition(TransactionState.AUTHORISED, TransactionState.CAPTURE_INITIATED),
      ).toBe(true);
    });

    it('should return false for invalid transition', () => {
      expect(service.canTransition(TransactionState.CREATED, TransactionState.REFUNDED)).toBe(
        false,
      );
    });
  });
});

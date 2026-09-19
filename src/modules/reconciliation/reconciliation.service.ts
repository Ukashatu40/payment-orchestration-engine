// src/modules/reconciliation/reconciliation.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { TransactionRepository } from '../transactions/repositories/transaction.repository';
import { ReconciliationLogRepository } from './repositories/reconciliation-log.repository';
import { TransactionStateMachineService } from '../transactions/state-machine/transaction-state-machine.service';
import { GatewayAdapterRegistry } from '../gateways/adapters/gateway-adapter.registry';
import { ReconciliationLog, DiscrepancyType } from './entities/reconciliation-log.entity';
import { TransactionState, PaymentGateway } from '../../common/enums';
import { Transaction } from '../transactions/entities/transaction.entity';

// Gateway status → internal state mapping
const GATEWAY_STATUS_MAP: Record<string, TransactionState> = {
  authorised: TransactionState.AUTHORISED,
  captured: TransactionState.CAPTURED,
  failed: TransactionState.FAILED,
  refunded: TransactionState.REFUNDED,
  expired: TransactionState.AUTH_EXPIRED,
};

export interface ReconciliationRunResult {
  runId: string;
  startedAt: Date;
  completedAt: Date;
  totalChecked: number;
  discrepanciesFound: number;
  autoResolved: number;
  requiresReview: number;
}

@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  // Default: transactions stuck for more than 5 minutes are stale
  private readonly STALE_THRESHOLD_MINUTES = 5;

  constructor(
    private readonly transactionRepo: TransactionRepository,
    private readonly reconciliationLogRepo: ReconciliationLogRepository,
    private readonly stateMachine: TransactionStateMachineService,
    private readonly gatewayRegistry: GatewayAdapterRegistry,
  ) {}

  // ----------------------------------------------------------------
  // Main batch job entry point.
  // Called every 15 minutes by the scheduler (Section A5.5).
  // Can also be triggered manually via POST /api/v1/reconciliation/trigger
  // ----------------------------------------------------------------
  async run(): Promise<ReconciliationRunResult> {
    const runId = uuidv4();
    const startedAt = new Date();

    this.logger.log('Reconciliation run started', { runId });

    // Step 1: Find stale transactions
    const staleTransactions = await this.transactionRepo.findStaleTransactions(
      this.STALE_THRESHOLD_MINUTES,
    );

    this.logger.log(`Found ${staleTransactions.length} stale transactions`, {
      runId,
    });

    const logEntries: Partial<ReconciliationLog>[] = [];
    let autoResolved = 0;
    let requiresReview = 0;

    // Step 2: Process each stale transaction
    for (const transaction of staleTransactions) {
      try {
        const result = await this.reconcileOne(transaction, runId);

        if (result) {
          logEntries.push(result);

          if (result.requiresReview) {
            requiresReview++;
          } else {
            autoResolved++;
          }
        }
      } catch (err) {
        this.logger.error('Failed to reconcile transaction', {
          transactionId: transaction.id,
          error: (err as Error).message,
          runId,
        });
      }
    }

    // Step 3: Persist all log entries for this run
    if (logEntries.length > 0) {
      await this.reconciliationLogRepo.createMany(logEntries);
    }

    const completedAt = new Date();

    const result: ReconciliationRunResult = {
      runId,
      startedAt,
      completedAt,
      totalChecked: staleTransactions.length,
      discrepanciesFound: logEntries.length,
      autoResolved,
      requiresReview,
    };

    this.logger.log('Reconciliation run completed', result);

    return result;
  }

  // ----------------------------------------------------------------
  // Reconciles a single transaction against its gateway.
  // Returns a log entry if a discrepancy is found, null otherwise.
  // ----------------------------------------------------------------
  private async reconcileOne(
    transaction: Transaction,
    runId: string,
  ): Promise<Partial<ReconciliationLog> | null> {
    if (!transaction.gateway || !transaction.gatewayReference) {
      return null;
    }

    // Step 1: Poll gateway for current status
    let gatewayStatus: string;

    try {
      const adapter = this.gatewayRegistry.get(transaction.gateway);
      const response = await adapter.fetchStatus(
        transaction.gatewayReference,
        transaction.traceId,
        BigInt(transaction.amountPaise),
      );
      gatewayStatus = response.status;
    } catch (err) {
      this.logger.warn('Could not fetch gateway status', {
        transactionId: transaction.id,
        gateway: transaction.gateway,
        error: (err as Error).message,
      });
      return null;
    }

    const internalState = transaction.state;
    const gatewayMappedState = GATEWAY_STATUS_MAP[gatewayStatus];

    // Step 2: Compare internal state with gateway state
    if (!gatewayMappedState || internalState === gatewayMappedState) {
      // States match — no discrepancy
      return null;
    }

    // Step 3: Determine discrepancy type and severity
    const discrepancyType = this.classifyDiscrepancy(internalState, gatewayStatus);

    // Step 4: Critical anomaly — internal shows captured but gateway shows failed
    // This requires immediate human review. Do NOT auto-resolve. (FS-11)
    if (discrepancyType === DiscrepancyType.INTERNAL_CAPTURED_GATEWAY_FAILED) {
      this.logger.error('CRITICAL: Transaction captured internally but failed at gateway', {
        transactionId: transaction.id,
        gateway: transaction.gateway,
        internalState,
        gatewayStatus,
        runId,
      });

      return {
        runId,
        transactionId: transaction.id,
        gateway: transaction.gateway,
        discrepancyType,
        internalState,
        gatewayState: gatewayStatus,
        requiresReview: true,
        resolved: false,
        notes:
          'CRITICAL: Internal state shows CAPTURED but gateway reports ' +
          `${gatewayStatus}. Manual investigation required.`,
      };
    }

    // Step 5: Auto-resolvable discrepancy
    // Gateway is the source of truth — apply its state (Section A5.5)
    if (gatewayMappedState && this.stateMachine.canTransition(internalState, gatewayMappedState)) {
      try {
        await this.stateMachine.transition(transaction.id, gatewayMappedState, {
          event: 'RECONCILIATION_OVERRIDE',
          triggeredBy: 'reconciliation_engine',
          traceId: transaction.traceId,
          metadata: {
            runId,
            gatewayStatus,
            previousState: internalState,
          },
        });

        this.logger.log('Transaction auto-reconciled', {
          transactionId: transaction.id,
          fromState: internalState,
          toState: gatewayMappedState,
          runId,
        });

        return {
          runId,
          transactionId: transaction.id,
          gateway: transaction.gateway,
          discrepancyType,
          internalState,
          gatewayState: gatewayStatus,
          requiresReview: false,
          resolved: true,
          notes: `Auto-resolved: applied gateway state ${gatewayMappedState}`,
        };
      } catch (err) {
        this.logger.error('Auto-reconciliation transition failed', {
          transactionId: transaction.id,
          error: (err as Error).message,
          runId,
        });
      }
    }

    // Step 6: Cannot auto-resolve — flag for review
    return {
      runId,
      transactionId: transaction.id,
      gateway: transaction.gateway,
      discrepancyType,
      internalState,
      gatewayState: gatewayStatus,
      requiresReview: true,
      resolved: false,
      notes:
        `State mismatch: internal=${internalState}, ` +
        `gateway=${gatewayStatus}. Transition not possible.`,
    };
  }

  private classifyDiscrepancy(
    internalState: TransactionState,
    gatewayStatus: string,
  ): DiscrepancyType {
    const capturedStates = new Set([
      TransactionState.CAPTURED,
      TransactionState.PARTIALLY_CAPTURED,
      TransactionState.SETTLED,
    ]);

    if (
      capturedStates.has(internalState) &&
      (gatewayStatus === 'failed' || gatewayStatus === 'expired')
    ) {
      return DiscrepancyType.INTERNAL_CAPTURED_GATEWAY_FAILED;
    }

    if (
      (internalState === TransactionState.AUTH_INITIATED ||
        internalState === TransactionState.CAPTURE_INITIATED) &&
      gatewayStatus === 'captured'
    ) {
      return DiscrepancyType.INTERNAL_PENDING_GATEWAY_SUCCEEDED;
    }

    return DiscrepancyType.STATUS_MISMATCH;
  }

  // ----------------------------------------------------------------
  // Returns a reconciliation run report by runId.
  // Used by GET /api/v1/reconciliation/reports/:runId
  // ----------------------------------------------------------------
  async getReport(runId: string): Promise<ReconciliationLog[]> {
    return this.reconciliationLogRepo.findByRunId(runId);
  }

  async getUnresolvedAnomalies(): Promise<ReconciliationLog[]> {
    return this.reconciliationLogRepo.findUnresolved();
  }

  // Marks an anomaly resolved/investigated — ops has had no way to
  // acknowledge these before; getUnresolvedAnomalies() was previously
  // the only way to interact with them.
  async resolveAnomaly(id: string, notes: string): Promise<void> {
    await this.reconciliationLogRepo.markResolved(id, notes);
  }
}

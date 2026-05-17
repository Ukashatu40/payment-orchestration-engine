// src/database/migrations/007-create-reconciliation-log.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateReconciliationLog1748000000007 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE reconciliation_log (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        run_id              UUID NOT NULL,
        transaction_id      UUID REFERENCES transactions(id)
                              ON DELETE RESTRICT,
        gateway             payment_gateway,
        discrepancy_type    VARCHAR(100),
        internal_state      VARCHAR(50),
        gateway_state       VARCHAR(50),
        requires_review     BOOLEAN NOT NULL DEFAULT FALSE,
        resolved            BOOLEAN NOT NULL DEFAULT FALSE,
        notes               TEXT,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX idx_reconciliation_run
        ON reconciliation_log (run_id, created_at DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX idx_reconciliation_transaction
        ON reconciliation_log (transaction_id)
    `);

    // -- Index for unresolved anomalies dashboard
    await queryRunner.query(`
      CREATE INDEX idx_reconciliation_unresolved
        ON reconciliation_log (requires_review, resolved)
        WHERE requires_review = TRUE AND resolved = FALSE
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS reconciliation_log');
  }
}

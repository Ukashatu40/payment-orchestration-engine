// src/database/migrations/002-create-transaction-state-log.ts
import { MigrationInterface, QueryRunner } from 'typeorm';
export class CreateTransactionStateLog1748000000002 implements MigrationInterface {
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS transaction_state_log`);
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE transaction_state_log (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        transaction_id      UUID NOT NULL
                              REFERENCES transactions(id)
                              ON DELETE RESTRICT,   -- never cascade delete audit
        from_state          transaction_state NOT NULL,
        to_state            transaction_state NOT NULL,
        event               VARCHAR(100) NOT NULL,

        gateway_reference   VARCHAR(255),
        -- PII redacted before storage (Section A2.3)
        gateway_response    JSONB,

        -- Tracing correlation
        trace_id            UUID NOT NULL,
        metadata            JSONB DEFAULT '{}',

        -- Who triggered this transition
        triggered_by        VARCHAR(100) NOT NULL,
                            -- e.g. 'api_server', 'webhook_processor',
                            --      'reconciliation_engine', 'circuit_breaker'

        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        -- IMMUTABLE: no updated_at column — rows are never updated

        CONSTRAINT chk_no_self_transition
          CHECK (from_state != to_state)
      )
    `);

    // -- Make the table truly append-only via a trigger
    await queryRunner.query(`
      CREATE RULE no_update_state_log AS
        ON UPDATE TO transaction_state_log DO INSTEAD NOTHING
    `);

    await queryRunner.query(`
      CREATE RULE no_delete_state_log AS
        ON DELETE TO transaction_state_log DO INSTEAD NOTHING
    `);

    await queryRunner.query(`
      CREATE INDEX idx_state_log_transaction
        ON transaction_state_log (transaction_id, created_at DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX idx_state_log_trace
        ON transaction_state_log (trace_id)
    `);
  }
}

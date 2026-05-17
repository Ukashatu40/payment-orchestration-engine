// src/database/migrations/008-create-refunds.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateRefunds1748000000008 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE refund_state AS ENUM (
        'INITIATED',
        'PROCESSING',
        'COMPLETED',
        'FAILED',
        'PARTIALLY_COMPLETED'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE refunds (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        transaction_id      UUID NOT NULL
                              REFERENCES transactions(id)
                              ON DELETE RESTRICT,

        -- BIGINT paise — same rule as transactions (ADR-002)
        amount_paise        BIGINT NOT NULL CHECK (amount_paise > 0),
        currency            CHAR(3) NOT NULL DEFAULT 'INR',

        state               refund_state NOT NULL DEFAULT 'INITIATED',

        gateway             payment_gateway NOT NULL,
        gateway_refund_id   VARCHAR(255),

        -- Who initiated and why
        initiated_by        VARCHAR(100) NOT NULL,
        reason              TEXT,

        -- Idempotency for refund requests
        idempotency_key     VARCHAR(255),

        metadata            JSONB DEFAULT '{}',
        failure_reason      TEXT,

        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX idx_refunds_transaction
        ON refunds (transaction_id)
    `);

    await queryRunner.query(`
      CREATE INDEX idx_refunds_gateway_ref
        ON refunds (gateway, gateway_refund_id)
        WHERE gateway_refund_id IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX idx_refunds_state
        ON refunds (state)
        WHERE state NOT IN ('COMPLETED', 'FAILED')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS refunds');
    await queryRunner.query('DROP TYPE IF EXISTS refund_state');
  }
}

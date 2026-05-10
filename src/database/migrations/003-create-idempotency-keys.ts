// src/database/migrations/003-create-idempotency-keys.ts
import { MigrationInterface, QueryRunner } from 'typeorm';
export class CreateIdempotencyKeys1003 implements MigrationInterface {
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS idempotency_keys`);
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE idempotency_keys (
        -- Composite PK: merchant-scoped (FS-13)
        merchant_id     UUID NOT NULL,
        key             VARCHAR(255) NOT NULL,

        request_hash    VARCHAR(64) NOT NULL,  -- SHA-256 of request body
        status          VARCHAR(20) NOT NULL DEFAULT 'PROCESSING'
                          CHECK (status IN ('PROCESSING','COMPLETED','FAILED')),
        response_code   INTEGER,
        response_body   JSONB,
        transaction_id  UUID REFERENCES transactions(id),

        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at      TIMESTAMPTZ NOT NULL
                          DEFAULT NOW() + INTERVAL '24 hours',

        PRIMARY KEY (merchant_id, key)
      )
    `);

    // Partial index for cleanup job — only non-completed keys expire
    await queryRunner.query(`
      CREATE INDEX idx_idempotency_expires
        ON idempotency_keys (expires_at)
      WHERE status != 'COMPLETED'
    `);
  }
}

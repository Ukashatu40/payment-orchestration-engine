import { MigrationInterface, QueryRunner } from 'typeorm';

// src/database/migrations/004-create-webhook-tables.ts
export class CreateWebhookTables1004 implements MigrationInterface {
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS processed_webhook_events`);
    await queryRunner.query(`DROP TABLE IF EXISTS webhook_queue`);
    await queryRunner.query(`DROP TYPE IF EXISTS webhook_status`);
  }
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Deduplication store (FS-02, FS-10)
    await queryRunner.query(`
      CREATE TABLE processed_webhook_events (
        event_id        VARCHAR(255) NOT NULL,
        gateway         payment_gateway NOT NULL,
        event_type      VARCHAR(100) NOT NULL,
        payload_hash    VARCHAR(64) NOT NULL,
        transaction_id  UUID REFERENCES transactions(id),
        processed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

        -- Composite PK: gateways may reuse event IDs cross-gateway
        PRIMARY KEY (gateway, event_id)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX idx_webhook_events_txn
        ON processed_webhook_events (transaction_id)
    `);

    // Durable webhook queue with DLQ support (Section A8.3)
    await queryRunner.query(`
      CREATE TYPE webhook_status AS ENUM (
        'PENDING','PROCESSING','COMPLETED','FAILED','DLQ'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE webhook_queue (
        id              BIGSERIAL PRIMARY KEY,
        gateway         payment_gateway NOT NULL,
        event_id        VARCHAR(255) NOT NULL,
        payload         JSONB NOT NULL,
        signature       TEXT NOT NULL,
        status          webhook_status NOT NULL DEFAULT 'PENDING',
        retry_count     INTEGER NOT NULL DEFAULT 0,
        max_retries     INTEGER NOT NULL DEFAULT 3,
        next_retry_at   TIMESTAMPTZ,
        error_message   TEXT,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        processed_at    TIMESTAMPTZ
      )
    `);

    // Partial index for queue consumer — only pending/failed with due retry
    await queryRunner.query(`
      CREATE INDEX idx_webhook_queue_due
        ON webhook_queue (next_retry_at ASC)
      WHERE status IN ('PENDING', 'FAILED')
    `);
  }
}

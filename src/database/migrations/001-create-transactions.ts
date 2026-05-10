// src/database/migrations/001-create-transactions.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTransactions1001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Enums first — define every state upfront
    await queryRunner.query(`
      CREATE TYPE transaction_state AS ENUM (
        'CREATED',
        'ROUTE_SELECTED',
        'AUTH_INITIATED',
        'AUTHORISED',
        'AUTH_FAILED',
        'AUTH_TIMEOUT',
        'AUTH_EXPIRED',
        'CAPTURE_INITIATED',
        'CAPTURED',
        'PARTIALLY_CAPTURED',
        'CAPTURE_FAILED',
        'VOID_INITIATED',
        'VOIDED',
        'REFUND_INITIATED',
        'REFUNDED',
        'PARTIALLY_REFUNDED',
        'REFUND_FAILED',
        'SETTLED',
        'DISPUTE_OPENED',
        'DISPUTE_RESOLVED',
        'ABANDONED',
        'ROUTE_FAILED',
        'FAILED'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE payment_gateway AS ENUM (
        'RAZORPAY', 'STRIPE', 'PAYU', 'UPI'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE payment_method AS ENUM (
        'CARD_CREDIT', 'CARD_DEBIT', 'UPI',
        'NET_BANKING', 'WALLET'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE transactions (
        id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        merchant_id       UUID NOT NULL,
        merchant_order_id VARCHAR(255) NOT NULL,

        -- CRITICAL: BIGINT paise, never FLOAT (Section A6.2)
        amount_paise      BIGINT NOT NULL CHECK (amount_paise > 0),
        captured_paise    BIGINT NOT NULL DEFAULT 0,
        refunded_paise    BIGINT NOT NULL DEFAULT 0,
        currency          CHAR(3) NOT NULL DEFAULT 'INR',

        state             transaction_state NOT NULL DEFAULT 'CREATED',
        payment_method    payment_method NOT NULL,
        gateway           payment_gateway,
        gateway_order_id  VARCHAR(255),
        gateway_payment_id VARCHAR(255),
        gateway_reference  VARCHAR(255),

        -- Optimistic lock version for non-critical reads
        version           INTEGER NOT NULL DEFAULT 1,

        -- Distributed tracing (Section A8.5)
        trace_id          UUID NOT NULL DEFAULT gen_random_uuid(),

        -- Idempotency scoped to merchant (FS-13)
        idempotency_key   VARCHAR(255) NOT NULL,

        metadata          JSONB DEFAULT '{}',
        failure_reason    TEXT,

        -- Auth hold expiry tracking (Section A1.2)
        auth_expires_at   TIMESTAMPTZ,

        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Composite unique: merchant-scoped idempotency (FS-13)
    await queryRunner.query(`
      CREATE UNIQUE INDEX idx_txn_merchant_idempotency
        ON transactions (merchant_id, idempotency_key)
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX idx_txn_merchant_order
        ON transactions (merchant_id, merchant_order_id)
    `);

    await queryRunner.query(`
      CREATE INDEX idx_txn_state ON transactions (state)
    `);

    await queryRunner.query(`
      CREATE INDEX idx_txn_gateway_ref
        ON transactions (gateway, gateway_reference)
      WHERE gateway_reference IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX idx_txn_created_at ON transactions (created_at DESC)
    `);

    // Partial index for reconciliation engine (Section A5.5)
    await queryRunner.query(`
      CREATE INDEX idx_txn_stale_auth
        ON transactions (gateway, created_at)
      WHERE state IN ('AUTH_INITIATED', 'CAPTURE_INITIATED')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS transactions');
    await queryRunner.query('DROP TYPE IF EXISTS transaction_state');
    await queryRunner.query('DROP TYPE IF EXISTS payment_gateway');
    await queryRunner.query('DROP TYPE IF EXISTS payment_method');
  }
}

// src/database/migrations/009-create-gateway-config.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateGatewayConfig1009 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE gateway_config (
        gateway               payment_gateway PRIMARY KEY,
        is_enabled            BOOLEAN NOT NULL DEFAULT TRUE,
        supported_methods     payment_method[] NOT NULL DEFAULT '{}',

        -- Circuit breaker config (Section A3.3)
        -- Stored in DB so changeable without redeployment
        cb_failure_threshold  INTEGER NOT NULL DEFAULT 5,
        cb_timeout_ms         INTEGER NOT NULL DEFAULT 30000,
        cb_half_open_requests INTEGER NOT NULL DEFAULT 1,

        -- Cost for routing algorithm (Section A3.1)
        cost_percentage       NUMERIC(5, 4) NOT NULL DEFAULT 0,
        cost_fixed_paise      BIGINT NOT NULL DEFAULT 0,

        -- Per-gateway timeouts (Section A1.3)
        timeout_ms            INTEGER NOT NULL DEFAULT 30000,

        -- Rate limits (Section A8.4)
        rate_limit_per_sec    INTEGER NOT NULL DEFAULT 100,

        -- Secrets stored encrypted at rest in production
        api_key               VARCHAR(500),
        webhook_secret        VARCHAR(500),

        metadata              JSONB NOT NULL DEFAULT '{}',
        updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    //-- Seed with gateway-specific values from Section A1.3 and A3.4
    await queryRunner.query(`
      INSERT INTO gateway_config (
        gateway, is_enabled, supported_methods,
        cb_failure_threshold, cb_timeout_ms,
        cost_percentage, cost_fixed_paise,
        timeout_ms, rate_limit_per_sec
      ) VALUES
        (
          'RAZORPAY', TRUE,
          ARRAY['CARD_CREDIT','CARD_DEBIT','NET_BANKING','WALLET']::payment_method[],
          5, 30000, 0.02, 200, 30000, 200
        ),
        (
          'STRIPE', TRUE,
          ARRAY['CARD_CREDIT','CARD_DEBIT']::payment_method[],
          5, 30000, 0.025, 300, 30000, 100
        ),
        (
          'PAYU', TRUE,
          ARRAY['CARD_CREDIT','CARD_DEBIT','NET_BANKING','WALLET']::payment_method[],
          5, 45000, 0.018, 150, 45000, 150
        ),
        (
          'UPI', TRUE,
          ARRAY['UPI']::payment_method[],
          5, 60000, 0.0, 0, 60000, 100
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS gateway_config');
  }
}

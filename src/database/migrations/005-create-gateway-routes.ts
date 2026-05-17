// src/database/migrations/005-create-gateway-routes.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateGatewayRoutes1748000000005 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE gateway_routes (
        id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        transaction_id    UUID NOT NULL
                            REFERENCES transactions(id)
                            ON DELETE RESTRICT,
        gateway           payment_gateway NOT NULL,

        -- Routing algorithm scores (Section A3.2)
        composite_score   NUMERIC(6, 4) NOT NULL,
        score_success     NUMERIC(6, 4) NOT NULL,
        score_latency     NUMERIC(6, 4) NOT NULL,
        score_cost        NUMERIC(6, 4) NOT NULL,
        score_health      NUMERIC(6, 4) NOT NULL,
        score_fit         NUMERIC(6, 4) NOT NULL,

        -- Snapshot of metrics at routing time
        success_rate      NUMERIC(6, 4),
        p95_latency_ms    INTEGER,

        -- Why this gateway was chosen or skipped
        selection_reason  VARCHAR(255),
        was_selected      BOOLEAN NOT NULL DEFAULT TRUE,

        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX idx_gateway_routes_transaction
        ON gateway_routes (transaction_id)
    `);

    await queryRunner.query(`
      CREATE INDEX idx_gateway_routes_gateway
        ON gateway_routes (gateway, created_at DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS gateway_routes');
  }
}

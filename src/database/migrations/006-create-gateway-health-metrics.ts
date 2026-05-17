// src/database/migrations/006-create-gateway-health-metrics.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateGatewayHealthMetrics1748000000006 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE gateway_health_metrics (
        id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        gateway           payment_gateway NOT NULL,
        payment_method    payment_method,
        success_count     INTEGER NOT NULL DEFAULT 0,
        total_count       INTEGER NOT NULL DEFAULT 0,
        p95_latency_ms    INTEGER,
        avg_latency_ms    INTEGER,
        recorded_at       TIMESTAMPTZ NOT NULL
      )
    `);

    await queryRunner.query(`
      CREATE INDEX idx_health_metrics_gateway_time
        ON gateway_health_metrics (gateway, payment_method, recorded_at DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS gateway_health_metrics');
  }
}

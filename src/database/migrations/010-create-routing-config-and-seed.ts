// src/database/migrations/010-create-routing-config-and-seed.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateRoutingConfigAndSeed1748000000010 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE routing_config (
        config_key              VARCHAR(100) PRIMARY KEY,
        weight_success_rate     NUMERIC(4, 3) NOT NULL DEFAULT 0.35,
        weight_latency          NUMERIC(4, 3) NOT NULL DEFAULT 0.20,
        weight_cost             NUMERIC(4, 3) NOT NULL DEFAULT 0.20,
        weight_health           NUMERIC(4, 3) NOT NULL DEFAULT 0.15,
        weight_fit              NUMERIC(4, 3) NOT NULL DEFAULT 0.10,
        sliding_window_minutes  INTEGER NOT NULL DEFAULT 10,
        degraded_skip_threshold NUMERIC(4, 3) NOT NULL DEFAULT 0.20,
        updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

        CONSTRAINT chk_weights_sum
          CHECK (
            ROUND(
              weight_success_rate + weight_latency +
              weight_cost + weight_health + weight_fit,
              3
            ) = 1.000
          )
      )
    `);

    // -- Default routing config row
    await queryRunner.query(`
      INSERT INTO routing_config (config_key)
      VALUES ('default')
    `);

    // -- Seed historical performance data from Section A3.4
    // Used to validate routing algorithm makes correct decisions
    await queryRunner.query(`
      INSERT INTO gateway_health_metrics (
        gateway, success_count, total_count,
        p95_latency_ms, recorded_at
      ) VALUES
        -- Razorpay
        ('RAZORPAY', 4137, 4200, 320,
          NOW() - INTERVAL '18 hours'),
        ('RAZORPAY', 17994, 18500, 450,
          NOW() - INTERVAL '12 hours'),
        ('RAZORPAY', 30112, 32000, 780,
          NOW() - INTERVAL '6 hours'),
        ('RAZORPAY', 24490, 25300, 520,
          NOW() - INTERVAL '1 hour'),

        -- Stripe
        ('STRIPE', 3766, 3800, 280,
          NOW() - INTERVAL '18 hours'),
        ('STRIPE', 15018, 15200, 310,
          NOW() - INTERVAL '12 hours'),
        ('STRIPE', 27788, 28500, 420,
          NOW() - INTERVAL '6 hours'),
        ('STRIPE', 21682, 22100, 350,
          NOW() - INTERVAL '1 hour'),

        -- PayU
        ('PAYU', 2016, 2100, 400,
          NOW() - INTERVAL '18 hours'),
        ('PAYU', 9163, 9800, 620,
          NOW() - INTERVAL '12 hours'),
        ('PAYU', 13826, 15500, 950,
          NOW() - INTERVAL '6 hours'),
        ('PAYU', 11200, 12200, 750,
          NOW() - INTERVAL '1 hour'),

        -- UPI
        ('UPI', 5572, 5600, 180,
          NOW() - INTERVAL '18 hours'),
        ('UPI', 21824, 22000, 210,
          NOW() - INTERVAL '12 hours'),
        ('UPI', 37240, 38000, 350,
          NOW() - INTERVAL '6 hours'),
        ('UPI', 30134, 30500, 250,
          NOW() - INTERVAL '1 hour')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS routing_config');
    await queryRunner.query('DELETE FROM gateway_health_metrics');
  }
}

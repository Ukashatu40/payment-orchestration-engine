// src/database/migrations/013-add-gateway-config-supported-currencies.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGatewayConfigSupportedCurrencies1748000000013 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE gateway_config
        ADD COLUMN supported_currencies text[] NOT NULL DEFAULT '{}'
    `);

    // Backfill the existing gateways — they were implicitly INR-only
    // (RAZORPAY/PAYU/UPI) before currency-aware routing existed. Stripe
    // genuinely supports both USD and INR, so it's backfilled with both
    // rather than narrowed to only what it happened to process before.
    await queryRunner.query(`
      UPDATE gateway_config SET supported_currencies = '{INR}'
      WHERE gateway IN ('RAZORPAY', 'PAYU', 'UPI')
    `);
    await queryRunner.query(`
      UPDATE gateway_config SET supported_currencies = '{USD,INR}'
      WHERE gateway = 'STRIPE'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE gateway_config DROP COLUMN supported_currencies`);
  }
}

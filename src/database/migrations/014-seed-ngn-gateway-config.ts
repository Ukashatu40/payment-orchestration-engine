// src/database/migrations/014-seed-ngn-gateway-config.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class SeedNgnGatewayConfig1748000000014 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Safe to use PAYSTACK/FLUTTERWAVE/INTERSWITCH/OPAY here — migration
    // 011 already committed the ALTER TYPE that added these values.
    //
    // api_key / webhook_secret are intentionally left NULL. Sandbox
    // credentials are not committed to migrations — see
    // scripts/seed-gateway-secrets.ts and README.md.
    await queryRunner.query(`
      INSERT INTO gateway_config (
        gateway, is_enabled, supported_methods, supported_currencies,
        cb_failure_threshold, cb_timeout_ms, cb_half_open_requests,
        cost_percentage, cost_fixed_paise,
        timeout_ms, rate_limit_per_sec,
        metadata
      ) VALUES
        ('PAYSTACK', TRUE,
         '{CARD_CREDIT,CARD_DEBIT,BANK_TRANSFER,USSD,VIRTUAL_ACCOUNT}',
         '{NGN}',
         5, 30000, 1, 0.015, 10000, 30000, 100,
         '{"baseUrl":"https://api.paystack.co","env":"sandbox"}'),
        ('FLUTTERWAVE', TRUE,
         '{CARD_CREDIT,CARD_DEBIT,BANK_TRANSFER,USSD,MOBILE_MONEY}',
         '{NGN}',
         5, 30000, 1, 0.014, 10000, 30000, 100,
         '{"baseUrl":"https://api.flutterwave.com/v3","env":"sandbox"}'),
        ('INTERSWITCH', TRUE,
         '{CARD_CREDIT,CARD_DEBIT,BANK_TRANSFER,USSD,VIRTUAL_ACCOUNT}',
         '{NGN}',
         5, 45000, 1, 0.0175, 10000, 45000, 80,
         '{"baseUrl":"https://qa.interswitchng.com","env":"sandbox"}'),
        ('OPAY', TRUE,
         '{CARD_CREDIT,CARD_DEBIT,BANK_TRANSFER,MOBILE_MONEY}',
         '{NGN}',
         5, 30000, 1, 0.015, 0, 30000, 100,
         '{"baseUrl":"https://sandboxapi.opaycheckout.com","env":"sandbox"}')
      ON CONFLICT (gateway) DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM gateway_config WHERE gateway IN ('PAYSTACK', 'FLUTTERWAVE', 'INTERSWITCH', 'OPAY')
    `);
  }
}

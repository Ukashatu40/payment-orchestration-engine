// src/database/migrations/012-add-ngn-payment-method-enum-values.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddNgnPaymentMethodEnumValues1748000000012 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Same ALTER TYPE transaction-isolation constraint as migration 011 —
    // this migration adds enum values only, nothing that uses them yet.
    await queryRunner.query(`ALTER TYPE payment_method ADD VALUE IF NOT EXISTS 'BANK_TRANSFER'`);
    await queryRunner.query(`ALTER TYPE payment_method ADD VALUE IF NOT EXISTS 'USSD'`);
    await queryRunner.query(`ALTER TYPE payment_method ADD VALUE IF NOT EXISTS 'MOBILE_MONEY'`);
    await queryRunner.query(`ALTER TYPE payment_method ADD VALUE IF NOT EXISTS 'VIRTUAL_ACCOUNT'`);
  }

  public async down(): Promise<void> {
    // Postgres has no DROP VALUE for enums — see 011's down() for the
    // manual procedure this would require.
  }
}

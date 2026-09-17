// src/database/migrations/011-add-ngn-gateway-enum-values.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddNgnGatewayEnumValues1748000000011 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Postgres forbids using a newly-added enum value in the same
    // transaction as the ALTER TYPE that adds it, so this migration
    // does *only* the ALTER TYPE statements — the seed insert that
    // uses these values lives in a later, separately-committed
    // migration (014-seed-ngn-gateway-config.ts).
    await queryRunner.query(`ALTER TYPE payment_gateway ADD VALUE IF NOT EXISTS 'PAYSTACK'`);
    await queryRunner.query(`ALTER TYPE payment_gateway ADD VALUE IF NOT EXISTS 'FLUTTERWAVE'`);
    await queryRunner.query(`ALTER TYPE payment_gateway ADD VALUE IF NOT EXISTS 'INTERSWITCH'`);
    await queryRunner.query(`ALTER TYPE payment_gateway ADD VALUE IF NOT EXISTS 'OPAY'`);
  }

  public async down(): Promise<void> {
    // Postgres has no DROP VALUE for enums. Reverting this requires a
    // manual procedure: create a new enum type without the removed
    // values, migrate every dependent column to it, drop the old type,
    // rename the new one into place. Not attempted automatically here.
  }
}

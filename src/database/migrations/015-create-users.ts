// src/database/migrations/015-create-users.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUsers1748000000015 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS citext`);

    await queryRunner.query(`
      CREATE TYPE user_role AS ENUM (
        'SUPER_ADMIN', 'OPS_ADMIN', 'OPS_VIEWER', 'MERCHANT_ADMIN', 'MERCHANT_VIEWER'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE users (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email               CITEXT NOT NULL,
        password_hash       VARCHAR(255) NOT NULL,
        role                user_role NOT NULL,

        -- NULL for internal roles (SUPER_ADMIN/OPS_ADMIN/OPS_VIEWER),
        -- required for merchant roles. Pushed into the DB rather than
        -- app code only, mirroring transactions' amount_paise CHECK.
        merchant_id         UUID NULL,
        CHECK (
          (role IN ('MERCHANT_ADMIN', 'MERCHANT_VIEWER') AND merchant_id IS NOT NULL)
          OR
          (role IN ('SUPER_ADMIN', 'OPS_ADMIN', 'OPS_VIEWER') AND merchant_id IS NULL)
        ),

        status              VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
                             CHECK (status IN ('ACTIVE', 'DISABLED')),

        last_login_at       TIMESTAMPTZ NULL,
        failed_login_count  SMALLINT NOT NULL DEFAULT 0,
        locked_until        TIMESTAMPTZ NULL,

        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`CREATE UNIQUE INDEX idx_users_email ON users (email)`);
    await queryRunner.query(
      `CREATE INDEX idx_users_merchant_id ON users (merchant_id) WHERE merchant_id IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS users');
    await queryRunner.query('DROP TYPE IF EXISTS user_role');
  }
}

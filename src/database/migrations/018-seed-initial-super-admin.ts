// src/database/migrations/018-seed-initial-super-admin.ts
import { MigrationInterface, QueryRunner } from 'typeorm';
import * as argon2 from 'argon2';

// Break-glass bootstrap account — the only way to create further users
// before any UI/admin-management endpoint has been used. Locally the
// password is the well-known "ChangeMe123!" (argon2id-hashed below).
// In production the migration refuses to run without
// INITIAL_ADMIN_PASSWORD, and INITIAL_ADMIN_EMAIL overrides the address,
// so a public deployment never carries a publicly known credential.
const SUPER_ADMIN_EMAIL = process.env.INITIAL_ADMIN_EMAIL || 'admin@payflow.local';
const SUPER_ADMIN_PASSWORD_HASH =
  '$argon2id$v=19$m=65536,p=4,t=3$d65MpU2Hxyf5ef3sItFLog$KWACWJqWPyHziKpGW9ZrcoQzlBAbkSo//i4GU4Gf7/Q';

export class SeedInitialSuperAdmin1748000000018 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const envPassword = process.env.INITIAL_ADMIN_PASSWORD;
    if (process.env.NODE_ENV === 'production' && !envPassword) {
      throw new Error('INITIAL_ADMIN_PASSWORD must be set to seed the super admin in production');
    }
    const passwordHash = envPassword ? await argon2.hash(envPassword) : SUPER_ADMIN_PASSWORD_HASH;

    await queryRunner.query(
      `
      INSERT INTO users (email, password_hash, role, merchant_id, status)
      VALUES ($1, $2, 'SUPER_ADMIN', NULL, 'ACTIVE')
      ON CONFLICT (email) DO NOTHING
    `,
      [SUPER_ADMIN_EMAIL, passwordHash],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM users WHERE email = $1`, [SUPER_ADMIN_EMAIL]);
  }
}

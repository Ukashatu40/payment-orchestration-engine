// src/database/migrations/018-seed-initial-super-admin.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

// Break-glass bootstrap account — the only way to create further users
// before any UI/admin-management endpoint has been used. Password is
// "ChangeMe123!" (argon2id-hashed below). MUST be rotated immediately
// after first login in any real environment — this is a well-known
// default, not a secret.
const SUPER_ADMIN_EMAIL = 'admin@payflow.local';
const SUPER_ADMIN_PASSWORD_HASH =
  '$argon2id$v=19$m=65536,p=4,t=3$d65MpU2Hxyf5ef3sItFLog$KWACWJqWPyHziKpGW9ZrcoQzlBAbkSo//i4GU4Gf7/Q';

export class SeedInitialSuperAdmin1748000000018 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `
      INSERT INTO users (email, password_hash, role, merchant_id, status)
      VALUES ($1, $2, 'SUPER_ADMIN', NULL, 'ACTIVE')
      ON CONFLICT (email) DO NOTHING
    `,
      [SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD_HASH],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM users WHERE email = $1`, [SUPER_ADMIN_EMAIL]);
  }
}

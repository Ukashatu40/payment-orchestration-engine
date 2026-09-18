// src/database/migrations/016-create-refresh-tokens.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateRefreshTokens1748000000016 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE refresh_tokens (
        id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

        -- SHA-256 hash of the token — the raw token is never stored,
        -- so a DB leak alone doesn't yield usable session tokens.
        token_hash            VARCHAR(64) NOT NULL,

        -- Shared across a token's whole rotation chain. On reuse of an
        -- already-revoked token (replay of a stolen token after it was
        -- rotated), the entire family is revoked, forcing re-login.
        family_id             UUID NOT NULL,

        expires_at            TIMESTAMPTZ NOT NULL,
        revoked_at            TIMESTAMPTZ NULL,
        replaced_by_token_id  UUID NULL REFERENCES refresh_tokens(id),

        user_agent            VARCHAR(255) NULL,
        ip                    VARCHAR(45) NULL,

        created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(
      `CREATE UNIQUE INDEX idx_refresh_tokens_token_hash ON refresh_tokens (token_hash)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_refresh_tokens_user_revoked ON refresh_tokens (user_id, revoked_at)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_refresh_tokens_family ON refresh_tokens (family_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS refresh_tokens');
  }
}

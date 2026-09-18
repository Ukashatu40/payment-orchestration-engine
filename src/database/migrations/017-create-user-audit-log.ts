// src/database/migrations/017-create-user-audit-log.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUserAuditLog1748000000017 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE user_audit_log (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

        -- Who performed the action. RESTRICT (not CASCADE) — an audit
        -- row must never disappear just because the actor's account
        -- was later deleted, same rationale as transaction_state_log.
        actor_user_id   UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

        action          VARCHAR(50) NOT NULL,
                        -- LOGIN_SUCCESS, LOGIN_FAILURE, LOGOUT,
                        -- PASSWORD_CHANGED, ROLE_CHANGED,
                        -- GATEWAY_CONFIG_CHANGED, ROUTING_CONFIG_CHANGED,
                        -- WEBHOOK_REPLAYED, RECONCILIATION_TRIGGERED,
                        -- ANOMALY_RESOLVED

        target_type     VARCHAR(50) NULL,   -- e.g. 'gateway', 'user', 'webhook_queue'
        target_id       VARCHAR(255) NULL,  -- free-form: gateway name, user UUID, etc.

        metadata        JSONB DEFAULT '{}',
        ip              VARCHAR(45) NULL,

        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
        -- IMMUTABLE: no updated_at column — rows are never updated
      )
    `);

    // Append-only, same enforcement mechanism as transaction_state_log
    await queryRunner.query(`
      CREATE RULE no_update_user_audit_log AS
        ON UPDATE TO user_audit_log DO INSTEAD NOTHING
    `);
    await queryRunner.query(`
      CREATE RULE no_delete_user_audit_log AS
        ON DELETE TO user_audit_log DO INSTEAD NOTHING
    `);

    await queryRunner.query(
      `CREATE INDEX idx_user_audit_log_actor ON user_audit_log (actor_user_id, created_at DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_user_audit_log_action ON user_audit_log (action, created_at DESC)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS user_audit_log');
  }
}

// src/modules/users/entities/user-audit-log.entity.ts

import {
  Entity,
  Column,
  ManyToOne,
  JoinColumn,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { User } from './user.entity';

export type UserAuditAction =
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAILURE'
  | 'LOGOUT'
  | 'PASSWORD_CHANGED'
  | 'ROLE_CHANGED'
  | 'GATEWAY_CONFIG_CHANGED'
  | 'ROUTING_CONFIG_CHANGED'
  | 'WEBHOOK_REPLAYED'
  | 'RECONCILIATION_TRIGGERED'
  | 'ANOMALY_RESOLVED'
  | 'USER_CREATED'
  | 'USER_STATUS_CHANGED';

// No BaseEntity extension — append-only, no updatedAt, matching
// transaction_state_log. The DB rule (migration 017) enforces this.
@Entity('user_audit_log')
@Index(['actorUserId', 'createdAt'])
@Index(['action', 'createdAt'])
export class UserAuditLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'actor_user_id', type: 'uuid' })
  actorUserId!: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'actor_user_id' })
  actor!: User;

  @Column({ name: 'action', type: 'varchar', length: 50 })
  action!: UserAuditAction;

  @Column({ name: 'target_type', type: 'varchar', length: 50, nullable: true })
  targetType!: string | null;

  @Column({ name: 'target_id', type: 'varchar', length: 255, nullable: true })
  targetId!: string | null;

  @Column({ name: 'metadata', type: 'jsonb', default: {} })
  metadata!: Record<string, unknown>;

  @Column({ name: 'ip', type: 'varchar', length: 45, nullable: true })
  ip!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

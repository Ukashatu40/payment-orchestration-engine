// src/modules/users/entities/user.entity.ts

import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { UserRole } from '../../../common/enums';

export type UserStatus = 'ACTIVE' | 'DISABLED';

@Entity('users')
export class User extends BaseEntity {
  @Column({ name: 'email', type: 'citext' })
  @Index({ unique: true })
  email!: string;

  // Never selected by default — see UserRepository, which explicitly
  // excludes this column from every read except the login lookup.
  @Column({ name: 'password_hash', type: 'varchar', length: 255, select: false })
  passwordHash!: string;

  @Column({ name: 'role', type: 'enum', enum: UserRole })
  role!: UserRole;

  // NULL for internal roles, required for merchant roles — enforced
  // by a DB CHECK constraint (migration 015), not just here.
  @Column({ name: 'merchant_id', type: 'uuid', nullable: true })
  merchantId!: string | null;

  @Column({ name: 'status', type: 'varchar', length: 20, default: 'ACTIVE' })
  status!: UserStatus;

  @Column({ name: 'last_login_at', type: 'timestamptz', nullable: true })
  lastLoginAt!: Date | null;

  @Column({ name: 'failed_login_count', type: 'smallint', default: 0 })
  failedLoginCount!: number;

  @Column({ name: 'locked_until', type: 'timestamptz', nullable: true })
  lockedUntil!: Date | null;
}

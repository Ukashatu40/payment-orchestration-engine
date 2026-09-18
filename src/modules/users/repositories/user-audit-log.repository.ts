// src/modules/users/repositories/user-audit-log.repository.ts

import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { UserAuditLog, UserAuditAction } from '../entities/user-audit-log.entity';

export interface RecordAuditEntryInput {
  actorUserId: string;
  action: UserAuditAction;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  ip?: string;
}

@Injectable()
export class UserAuditLogRepository {
  private readonly repo: Repository<UserAuditLog>;

  constructor(private readonly dataSource: DataSource) {
    this.repo = this.dataSource.getRepository(UserAuditLog);
  }

  async record(input: RecordAuditEntryInput): Promise<void> {
    const entry = this.repo.create({
      actorUserId: input.actorUserId,
      action: input.action,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      metadata: input.metadata ?? {},
      ip: input.ip ?? null,
    });
    await this.repo.save(entry);
  }
}

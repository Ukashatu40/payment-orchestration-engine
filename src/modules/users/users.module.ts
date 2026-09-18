// src/modules/users/users.module.ts

import { Module } from '@nestjs/common';
import { UserRepository } from './repositories/user.repository';
import { RefreshTokenRepository } from './repositories/refresh-token.repository';
import { UserAuditLogRepository } from './repositories/user-audit-log.repository';

@Module({
  providers: [UserRepository, RefreshTokenRepository, UserAuditLogRepository],
  exports: [UserRepository, RefreshTokenRepository, UserAuditLogRepository],
})
export class UsersModule {}

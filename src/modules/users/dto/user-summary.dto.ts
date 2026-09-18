// src/modules/users/dto/user-summary.dto.ts

import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '../../../common/enums';
import { User } from '../entities/user.entity';

// Never includes password_hash — the repository excludes it from every
// read except the login lookup (select: false on the column), so there's
// nothing to accidentally leak here even if a caller forgot to map fields.
export class UserSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty({ enum: UserRole })
  role!: UserRole;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  merchantId!: string | null;

  @ApiProperty({ enum: ['ACTIVE', 'DISABLED'] })
  status!: 'ACTIVE' | 'DISABLED';

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  lastLoginAt!: Date | null;

  @ApiProperty()
  failedLoginCount!: number;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  lockedUntil!: Date | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  static fromEntity(user: User): UserSummaryDto {
    const dto = new UserSummaryDto();
    dto.id = user.id;
    dto.email = user.email;
    dto.role = user.role;
    dto.merchantId = user.merchantId;
    dto.status = user.status;
    dto.lastLoginAt = user.lastLoginAt;
    dto.failedLoginCount = user.failedLoginCount;
    dto.lockedUntil = user.lockedUntil;
    dto.createdAt = user.createdAt;
    return dto;
  }
}

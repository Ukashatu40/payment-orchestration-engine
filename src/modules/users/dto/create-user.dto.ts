// src/modules/users/dto/create-user.dto.ts

import { IsEmail, IsEnum, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '../../../common/enums';

export class CreateUserDto {
  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  password!: string;

  @ApiProperty({ enum: UserRole })
  @IsEnum(UserRole)
  role!: UserRole;

  // Required for merchant roles, forbidden for internal roles — the exact
  // pairing (mirroring the DB CHECK constraint from migration 015) is
  // enforced in the controller so a mismatch 400s with a clear message
  // instead of surfacing as a raw constraint-violation 500.
  @ApiProperty({ type: String, format: 'uuid', required: false })
  @IsOptional()
  @IsUUID()
  merchantId?: string;
}

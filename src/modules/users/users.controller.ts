// src/modules/users/users.controller.ts

import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  Body,
  Query,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiSecurity, ApiQuery } from '@nestjs/swagger';
import * as argon2 from 'argon2';
import { UserRepository } from './repositories/user.repository';
import { UserAuditLogRepository } from './repositories/user-audit-log.repository';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequireCsrf } from '../auth/decorators/require-csrf.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { type AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { UserRole } from '../../common/enums';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserRoleDto } from './dto/update-user-role.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { ListUsersResponseDto } from './dto/list-users-response.dto';
import { UserSummaryDto } from './dto/user-summary.dto';
import { ResetUserPasswordDto } from './dto/reset-user-password.dto';
import { ResetUserPasswordResultDto } from './dto/reset-user-password-result.dto';

const MERCHANT_ROLES = [UserRole.MERCHANT_ADMIN, UserRole.MERCHANT_VIEWER];

// Mirrors the DB CHECK constraint (migration 015): merchant roles require
// merchantId, internal roles must not have one. Enforced here too so a
// mismatch 400s with a clear message instead of surfacing as a raw
// constraint-violation 500.
function assertRoleMerchantPairing(role: UserRole, merchantId: string | undefined): void {
  const isMerchantRole = MERCHANT_ROLES.includes(role);
  if (isMerchantRole && !merchantId) {
    throw new BadRequestException(`${role} requires a merchantId`);
  }
  if (!isMerchantRole && merchantId) {
    throw new BadRequestException(`${role} must not have a merchantId`);
  }
}

@ApiTags('users')
@ApiSecurity('X-API-Key')
@Controller({ path: 'users', version: '1' })
export class UsersController {
  constructor(
    private readonly userRepo: UserRepository,
    private readonly auditLogRepo: UserAuditLogRepository,
  ) {}

  // GET /api/v1/users
  @Get()
  @Roles(UserRole.SUPER_ADMIN, UserRole.OPS_ADMIN, UserRole.OPS_VIEWER)
  @ApiOperation({ summary: 'List users' })
  @ApiQuery({ name: 'role', required: false, enum: UserRole })
  @ApiQuery({ name: 'status', required: false, enum: ['ACTIVE', 'DISABLED'] })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Users retrieved', type: ListUsersResponseDto })
  async listUsers(@Query() query: ListUsersQueryDto): Promise<ListUsersResponseDto> {
    const { data, total } = await this.userRepo.findAllPaginated({
      role: query.role,
      status: query.status,
      page: query.page,
      pageSize: query.pageSize,
    });

    return {
      data: data.map(UserSummaryDto.fromEntity),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }

  // GET /api/v1/users/:id
  @Get(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.OPS_ADMIN, UserRole.OPS_VIEWER)
  @ApiOperation({ summary: 'Get a user by id' })
  @ApiResponse({ status: 200, description: 'User found', type: UserSummaryDto })
  @ApiResponse({ status: 404, description: 'User not found' })
  async getUser(@Param('id', ParseUUIDPipe) id: string): Promise<UserSummaryDto> {
    const user = await this.userRepo.findById(id);
    if (!user) {
      throw new NotFoundException(`User not found: ${id}`);
    }
    return UserSummaryDto.fromEntity(user);
  }

  // POST /api/v1/users
  // Dangerous: creates a new internal or merchant account. Restricted to
  // SUPER_ADMIN only — OPS_ADMIN cannot create accounts (including other
  // OPS_ADMINs or itself an escalation path), let alone SUPER_ADMINs.
  @Post()
  @Roles(UserRole.SUPER_ADMIN)
  @RequireCsrf()
  @ApiOperation({ summary: 'Create a user' })
  @ApiResponse({ status: 201, description: 'User created', type: UserSummaryDto })
  @ApiResponse({ status: 403, description: 'Requires SUPER_ADMIN' })
  @ApiResponse({ status: 409, description: 'Email already in use' })
  async createUser(
    @Body() body: CreateUserDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<UserSummaryDto> {
    assertRoleMerchantPairing(body.role, body.merchantId);

    if (await this.userRepo.existsByEmail(body.email)) {
      throw new ConflictException('A user with this email already exists');
    }

    const passwordHash = await argon2.hash(body.password);
    const created = await this.userRepo.create({
      email: body.email,
      passwordHash,
      role: body.role,
      merchantId: body.merchantId ?? null,
    });

    await this.auditLogRepo.record({
      actorUserId: actor.id,
      action: 'USER_CREATED',
      targetType: 'user',
      targetId: created.id,
      metadata: { email: created.email, role: created.role },
    });

    return UserSummaryDto.fromEntity(created);
  }

  // PUT /api/v1/users/:id/role
  // Dangerous, privilege-escalation-sensitive: SUPER_ADMIN only, and a
  // SUPER_ADMIN cannot change their own role (must be done by another
  // admin — prevents accidental self-lockout).
  @Put(':id/role')
  @Roles(UserRole.SUPER_ADMIN)
  @RequireCsrf()
  @ApiOperation({ summary: "Change a user's role" })
  @ApiResponse({ status: 200, description: 'Role updated', type: UserSummaryDto })
  @ApiResponse({ status: 403, description: 'Requires SUPER_ADMIN' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async updateUserRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateUserRoleDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<UserSummaryDto> {
    if (id === actor.id) {
      throw new ForbiddenException('Cannot change your own role — ask another admin');
    }

    const user = await this.userRepo.findById(id);
    if (!user) {
      throw new NotFoundException(`User not found: ${id}`);
    }

    assertRoleMerchantPairing(body.role, body.merchantId);

    await this.userRepo.update(id, {
      role: body.role,
      merchantId: body.merchantId ?? null,
    });

    await this.auditLogRepo.record({
      actorUserId: actor.id,
      action: 'ROLE_CHANGED',
      targetType: 'user',
      targetId: id,
      metadata: { from: user.role, to: body.role },
    });

    const updated = await this.userRepo.findById(id);
    return UserSummaryDto.fromEntity(updated!);
  }

  // PUT /api/v1/users/:id/status
  // Dangerous: disabling blocks the account from logging in entirely.
  // SUPER_ADMIN only; cannot disable your own account.
  @Put(':id/status')
  @Roles(UserRole.SUPER_ADMIN)
  @RequireCsrf()
  @ApiOperation({ summary: "Enable or disable a user's account" })
  @ApiResponse({ status: 200, description: 'Status updated', type: UserSummaryDto })
  @ApiResponse({ status: 403, description: 'Requires SUPER_ADMIN' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async updateUserStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateUserStatusDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<UserSummaryDto> {
    if (id === actor.id) {
      throw new ForbiddenException('Cannot change your own account status — ask another admin');
    }

    const user = await this.userRepo.findById(id);
    if (!user) {
      throw new NotFoundException(`User not found: ${id}`);
    }

    // Re-activating also clears any accumulated login-failure lockout —
    // an admin confirming "this account should work again" should mean
    // that, not leave a stale 15-minute lock (see MAX_FAILED_LOGIN_ATTEMPTS
    // in auth.service.ts) silently still in effect.
    await this.userRepo.update(id, {
      status: body.status,
      ...(body.status === 'ACTIVE' ? { failedLoginCount: 0, lockedUntil: null } : {}),
    });

    await this.auditLogRepo.record({
      actorUserId: actor.id,
      action: 'USER_STATUS_CHANGED',
      targetType: 'user',
      targetId: id,
      metadata: { from: user.status, to: body.status },
    });

    const updated = await this.userRepo.findById(id);
    return UserSummaryDto.fromEntity(updated!);
  }

  // PUT /api/v1/users/:id/password
  // Dangerous: an admin-initiated reset, not self-service password change.
  // SUPER_ADMIN only; also clears any accumulated lockout, since setting a
  // known-good password implies the account should work again.
  @Put(':id/password')
  @Roles(UserRole.SUPER_ADMIN)
  @RequireCsrf()
  @ApiOperation({ summary: "Reset a user's password (admin-initiated)" })
  @ApiResponse({
    status: 200,
    description: 'Password reset',
    type: ResetUserPasswordResultDto,
  })
  @ApiResponse({ status: 403, description: 'Requires SUPER_ADMIN' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async resetUserPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ResetUserPasswordDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<ResetUserPasswordResultDto> {
    const user = await this.userRepo.findById(id);
    if (!user) {
      throw new NotFoundException(`User not found: ${id}`);
    }

    const passwordHash = await argon2.hash(body.password);
    await this.userRepo.update(id, { passwordHash, failedLoginCount: 0, lockedUntil: null });

    await this.auditLogRepo.record({
      actorUserId: actor.id,
      action: 'USER_PASSWORD_RESET',
      targetType: 'user',
      targetId: id,
    });

    return { reset: true };
  }
}

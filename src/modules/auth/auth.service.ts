// src/modules/auth/auth.service.ts

import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { UserRepository } from '../users/repositories/user.repository';
import { RefreshTokenRepository } from '../users/repositories/refresh-token.repository';
import { UserAuditLogRepository } from '../users/repositories/user-audit-log.repository';
import { User } from '../users/entities/user.entity';
import { JwtPayload } from './interfaces/jwt-payload.interface';

const MAX_FAILED_LOGIN_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;
const REFRESH_TOKEN_DAYS = 30;

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  refreshTokenId: string;
  refreshTokenExpiresAt: Date;
}

export interface LoginContext {
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly userRepo: UserRepository,
    private readonly refreshTokenRepo: RefreshTokenRepository,
    private readonly auditLogRepo: UserAuditLogRepository,
    private readonly jwtService: JwtService,
  ) {}

  async login(
    email: string,
    password: string,
    ctx: LoginContext,
  ): Promise<{ user: User; tokens: TokenPair }> {
    const user = await this.userRepo.findByEmailWithPassword(email.toLowerCase());

    // Constant-shape failure: don't reveal whether the email exists.
    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (user.status === 'DISABLED') {
      throw new UnauthorizedException('Account is disabled');
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new UnauthorizedException(
        `Account is temporarily locked. Try again after ${user.lockedUntil.toISOString()}`,
      );
    }

    const passwordValid = await argon2.verify(user.passwordHash, password).catch(() => false);

    if (!passwordValid) {
      const failedCount = user.failedLoginCount + 1;
      const lockedUntil =
        failedCount >= MAX_FAILED_LOGIN_ATTEMPTS
          ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000)
          : null;

      await this.userRepo.recordLoginFailure(user.id, failedCount, lockedUntil);
      await this.auditLogRepo.record({
        actorUserId: user.id,
        action: 'LOGIN_FAILURE',
        ip: ctx.ip,
        metadata: { failedCount, locked: lockedUntil !== null },
      });

      throw new UnauthorizedException('Invalid email or password');
    }

    await this.userRepo.recordLoginSuccess(user.id);
    await this.auditLogRepo.record({ actorUserId: user.id, action: 'LOGIN_SUCCESS', ip: ctx.ip });

    const tokens = await this.issueTokens(user, uuidv4(), ctx);

    return { user, tokens };
  }

  // Issues a fresh access token + a new refresh token row in the given
  // rotation family. familyId is preserved across rotate() calls and
  // freshly generated on login (a new session = a new family).
  private async issueTokens(user: User, familyId: string, ctx: LoginContext): Promise<TokenPair> {
    const payload: JwtPayload = { sub: user.id, role: user.role, merchantId: user.merchantId };
    const accessToken = await this.jwtService.signAsync(payload);

    const rawRefreshToken = crypto.randomBytes(48).toString('hex');
    const tokenHash = this.hashToken(rawRefreshToken);
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60_000);

    const row = await this.refreshTokenRepo.create({
      userId: user.id,
      tokenHash,
      familyId,
      expiresAt,
      userAgent: ctx.userAgent ?? null,
      ip: ctx.ip ?? null,
    });

    return {
      accessToken,
      refreshToken: rawRefreshToken,
      refreshTokenId: row.id,
      refreshTokenExpiresAt: expiresAt,
    };
  }

  // Rotates a refresh token: validates it, marks it revoked, issues a
  // new one in the same family. If the presented token was already
  // revoked (a stolen token replayed after the legitimate rotation),
  // the entire family is killed and the caller must fully re-login —
  // standard refresh-token reuse detection.
  async refresh(
    rawRefreshToken: string,
    ctx: LoginContext,
  ): Promise<{ user: User; tokens: TokenPair }> {
    const tokenHash = this.hashToken(rawRefreshToken);
    const existing = await this.refreshTokenRepo.findByTokenHash(tokenHash);

    if (!existing) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (existing.revokedAt) {
      this.logger.warn('Refresh token reuse detected — revoking family', {
        familyId: existing.familyId,
        userId: existing.userId,
      });
      await this.refreshTokenRepo.revokeFamily(existing.familyId);
      throw new UnauthorizedException('Refresh token has already been used — session revoked');
    }

    if (existing.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    const user = await this.userRepo.findById(existing.userId);
    if (!user || user.status === 'DISABLED') {
      throw new UnauthorizedException('Account is no longer active');
    }

    const tokens = await this.issueTokens(user, existing.familyId, ctx);
    await this.refreshTokenRepo.markRevoked(existing.id, tokens.refreshTokenId);

    return { user, tokens };
  }

  async logout(rawRefreshToken: string, userId: string, ctx: LoginContext): Promise<void> {
    const tokenHash = this.hashToken(rawRefreshToken);
    const existing = await this.refreshTokenRepo.findByTokenHash(tokenHash);

    if (existing && !existing.revokedAt) {
      await this.refreshTokenRepo.markRevoked(existing.id);
    }

    await this.auditLogRepo.record({ actorUserId: userId, action: 'LOGOUT', ip: ctx.ip });
  }

  async getActiveSessions(userId: string) {
    return this.refreshTokenRepo.findActiveByUser(userId);
  }

  // Ownership-checked: a user may only revoke their own sessions.
  // Without this, any authenticated user could revoke an arbitrary
  // session by guessing/enumerating IDs — access control must never
  // rely on ID unguessability alone.
  async revokeSession(refreshTokenId: string, requestingUserId: string): Promise<void> {
    const sessions = await this.refreshTokenRepo.findActiveByUser(requestingUserId);
    const owns = sessions.some((s) => s.id === refreshTokenId);

    if (!owns) {
      throw new UnauthorizedException('Session not found');
    }

    await this.refreshTokenRepo.markRevoked(refreshTokenId);
  }

  private hashToken(raw: string): string {
    return crypto.createHash('sha256').update(raw).digest('hex');
  }
}

// src/modules/auth/auth.controller.ts

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Delete,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { type FastifyReply, type FastifyRequest } from 'fastify';
import { AuthService, type TokenPair } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { CurrentUser } from './decorators/current-user.decorator';
import { type AuthenticatedUser } from './interfaces/jwt-payload.interface';
import { UserRepository } from '../users/repositories/user.repository';

const ACCESS_COOKIE = 'payflow_access_token';
const REFRESH_COOKIE = 'payflow_refresh_token';
const REFRESH_COOKIE_PATH = '/api/v1/auth/refresh';

@ApiTags('auth')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly userRepo: UserRepository,
  ) {}

  // POST /api/v1/auth/login
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({ auth: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Log in with email + password' })
  @ApiResponse({ status: 200, description: 'Logged in — session cookies set' })
  @ApiResponse({ status: 401, description: 'Invalid credentials, disabled, or locked account' })
  async login(
    @Body() dto: LoginDto,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { user, tokens } = await this.authService.login(dto.email, dto.password, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    this.setAuthCookies(reply, tokens);

    return {
      id: user.id,
      email: user.email,
      role: user.role,
      merchantId: user.merchantId,
    };
  }

  // POST /api/v1/auth/refresh
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({ auth: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Rotate the refresh token and issue a new access token' })
  async refresh(@Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const raw = req.cookies?.[REFRESH_COOKIE];
    if (!raw) {
      throw new UnauthorizedException('No refresh token cookie present');
    }

    const { tokens } = await this.authService.refresh(raw, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    this.setAuthCookies(reply, tokens);

    return { refreshed: true };
  }

  // POST /api/v1/auth/logout
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Log out — revokes the current refresh token' })
  async logout(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const raw = req.cookies?.[REFRESH_COOKIE];
    if (raw) {
      await this.authService.logout(raw, user.id, { ip: req.ip });
    }

    this.clearAuthCookies(reply);
    return { loggedOut: true };
  }

  // GET /api/v1/auth/me
  @Get('me')
  @ApiOperation({ summary: 'Get the current authenticated user' })
  async me(@CurrentUser() user: AuthenticatedUser) {
    const record = await this.userRepo.findById(user.id);
    if (!record) {
      throw new UnauthorizedException('User no longer exists');
    }
    return {
      id: record.id,
      email: record.email,
      role: record.role,
      merchantId: record.merchantId,
      lastLoginAt: record.lastLoginAt,
    };
  }

  // GET /api/v1/auth/sessions
  @Get('sessions')
  @ApiOperation({ summary: 'List active sessions (refresh tokens) for the current user' })
  async sessions(@CurrentUser() user: AuthenticatedUser) {
    const sessions = await this.authService.getActiveSessions(user.id);
    return sessions.map((s) => ({
      id: s.id,
      userAgent: s.userAgent,
      ip: s.ip,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
    }));
  }

  // DELETE /api/v1/auth/sessions/:id
  @Delete('sessions/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke a specific session (must belong to the current user)' })
  async revokeSession(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    await this.authService.revokeSession(id, user.id);
    return { revoked: true };
  }

  private setAuthCookies(reply: FastifyReply, tokens: TokenPair): void {
    const secure = process.env.NODE_ENV === 'production';

    reply.setCookie(ACCESS_COOKIE, tokens.accessToken, {
      httpOnly: true,
      secure,
      sameSite: 'strict',
      path: '/',
      maxAge: 15 * 60, // 15 minutes, matches the JWT's own expiry
    });

    reply.setCookie(REFRESH_COOKIE, tokens.refreshToken, {
      httpOnly: true,
      secure,
      sameSite: 'strict',
      path: REFRESH_COOKIE_PATH, // narrowest possible exposure
      expires: tokens.refreshTokenExpiresAt,
    });
  }

  private clearAuthCookies(reply: FastifyReply): void {
    reply.clearCookie(ACCESS_COOKIE, { path: '/' });
    reply.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
  }
}

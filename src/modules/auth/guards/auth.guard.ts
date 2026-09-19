// src/modules/auth/guards/auth.guard.ts

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  type RequestWithPrincipal,
  type JwtPayload,
  type RequestPrincipal,
} from '../interfaces/jwt-payload.interface';

// Replaces the old standalone ApiKeyGuard as the global guard. Accepts
// EITHER a valid `Authorization: Bearer <JWT>` (new — human-facing
// frontends, populates a role+merchant-scoped principal) OR a valid
// `x-api-key` (legacy — server-to-server merchant integrations,
// unscoped "apiKey" principal). Routes that must never accept the
// legacy path add @Roles(...) + RolesGuard, which rejects an "apiKey"
// principal outright regardless of which roles are listed.
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);
  private readonly validApiKeys: Set<string>;
  private readonly publicPaths = [
    '/api/v1/webhooks/',
    // Interswitch's hosted page POSTs the payer's browser back here; the
    // checkout page is opened by the payer. Neither can carry credentials.
    '/api/v1/checkout/',
    '/api/v1/health',
    '/api/v1/auth/login',
    '/api/v1/auth/refresh',
  ];

  constructor(
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
  ) {
    const raw = this.configService.get<string>('API_KEYS', '');
    this.validApiKeys = new Set(
      raw
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean),
    );
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithPrincipal>();

    const isPublic = this.publicPaths.some((path) => request.url.startsWith(path));
    if (isPublic) return true;

    // Browser sessions (the frontend apps) carry the access token in
    // an httpOnly cookie, set by AuthController.login/refresh — that's
    // the primary path. Authorization: Bearer is also accepted for
    // non-browser JWT clients (tooling, mobile).
    const authHeader = request.headers['authorization'];
    const bearerToken = authHeader?.startsWith('Bearer ')
      ? authHeader.slice('Bearer '.length)
      : undefined;
    const cookieToken = request.cookies?.['payflow_access_token'];
    const jwt = bearerToken ?? cookieToken;

    if (jwt) {
      return this.authenticateJwt(request, jwt);
    }

    const apiKey = request.headers['x-api-key'] as string | undefined;
    if (apiKey) {
      return this.authenticateApiKey(request, apiKey);
    }

    throw new UnauthorizedException(
      'Missing credentials — provide a session cookie, Authorization: Bearer <token>, or X-API-Key',
    );
  }

  private async authenticateJwt(request: RequestWithPrincipal, token: string): Promise<boolean> {
    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token);
      const principal: RequestPrincipal = {
        type: 'user',
        id: payload.sub,
        role: payload.role,
        merchantId: payload.merchantId,
      };
      request.user = principal;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }
  }

  private authenticateApiKey(request: RequestWithPrincipal, apiKey: string): boolean {
    if (!this.validApiKeys.has(apiKey)) {
      this.logger.warn('Invalid API key attempt', { ip: request.ip, url: request.url });
      throw new UnauthorizedException('Invalid API key');
    }
    request.user = { type: 'apiKey' };
    return true;
  }
}

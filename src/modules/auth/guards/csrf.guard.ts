// src/modules/auth/guards/csrf.guard.ts

import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRE_CSRF_KEY } from '../decorators/require-csrf.decorator';
import { type RequestWithPrincipal } from '../interfaces/jwt-payload.interface';

export const CSRF_COOKIE = 'payflow_csrf_token';
export const CSRF_HEADER = 'x-csrf-token';

// Double-submit CSRF check — defense-in-depth alongside SameSite=Strict
// cookies (the primary defense), per Part F of the frontend plan. Applied
// only to routes marked @RequireCsrf(); every other route is unaffected.
//
// The CSRF cookie is deliberately NOT httpOnly (the frontend reads it via
// document.cookie and echoes it as a header) — it carries no secret, its
// only job is proving the request came from JS running on this origin,
// since a cross-site attacker can't read a cookie set on a different
// origin to forge the matching header.
//
// Several @RequireCsrf() routes (capture/void/refund) are dual-use: both
// a browser session AND a merchant's own server-to-server API-key
// integration can call them. CSRF is a browser-cookie-specific attack —
// an API-key caller never has this cookie in the first place, so the
// check is skipped entirely for API-key principals rather than breaking
// legitimate server-to-server calls.
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<boolean | undefined>(REQUIRE_CSRF_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required) return true;

    const request = context.switchToHttp().getRequest<RequestWithPrincipal>();
    if (request.user?.type === 'apiKey') return true;

    const cookieToken = request.cookies?.[CSRF_COOKIE];
    const headerToken = request.headers[CSRF_HEADER];

    if (!cookieToken || !headerToken || cookieToken !== headerToken) {
      throw new ForbiddenException('Missing or invalid CSRF token');
    }

    return true;
  }
}

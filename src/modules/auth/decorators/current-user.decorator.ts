// src/modules/auth/decorators/current-user.decorator.ts

import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import {
  type AuthenticatedUser,
  type RequestWithPrincipal,
} from '../interfaces/jwt-payload.interface';

// Returns the authenticated user principal, rejecting API-key callers
// outright — for routes that only make sense for a logged-in human
// (e.g. GET /auth/me, POST /auth/logout).
export function extractCurrentUser(_data: unknown, ctx: ExecutionContext): AuthenticatedUser {
  const request = ctx.switchToHttp().getRequest<RequestWithPrincipal>();
  const principal = request.user;

  if (!principal || principal.type !== 'user') {
    throw new UnauthorizedException('This endpoint requires a user session');
  }

  return principal;
}

export const CurrentUser = createParamDecorator(extractCurrentUser);

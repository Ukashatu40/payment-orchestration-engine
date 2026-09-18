// src/modules/auth/guards/roles.guard.ts

import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { UserRole } from '../../../common/enums';
import { type RequestWithPrincipal } from '../interfaces/jwt-payload.interface';

// Applied alongside @Roles(...) on routes that must never be reachable
// via the legacy API-key path (see auth.guard.ts) — e.g. gateway
// config, routing config, reconciliation trigger, webhook DLQ replay.
// Rejects an "apiKey" principal outright, regardless of the allowed
// role list, since an API-key caller has no role at all.
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) return true;

    const request = context.switchToHttp().getRequest<RequestWithPrincipal>();
    const principal = request.user;

    if (!principal || principal.type !== 'user') {
      throw new ForbiddenException(
        'This action requires an authenticated user session, not an API key',
      );
    }

    if (!requiredRoles.includes(principal.role)) {
      throw new ForbiddenException(
        `Role ${principal.role} is not permitted to perform this action`,
      );
    }

    return true;
  }
}

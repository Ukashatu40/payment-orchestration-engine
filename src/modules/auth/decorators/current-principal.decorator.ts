// src/modules/auth/decorators/current-principal.decorator.ts

import { createParamDecorator, ExecutionContext, ForbiddenException } from '@nestjs/common';
import {
  type RequestPrincipal,
  type RequestWithPrincipal,
} from '../interfaces/jwt-payload.interface';

// Returns the raw principal (user OR apiKey) without restriction —
// for endpoints that need to branch on principal type/role themselves
// (e.g. resource-ownership checks), unlike @CurrentUser() (rejects
// apiKey outright) or @CurrentMerchant() (derives an acting-as merchant
// for creation, not an ownership check on an existing resource).
export function extractCurrentPrincipal(_data: unknown, ctx: ExecutionContext): RequestPrincipal {
  const request = ctx.switchToHttp().getRequest<RequestWithPrincipal>();
  if (!request.user) {
    throw new ForbiddenException('No authenticated principal on request');
  }
  return request.user;
}

export const CurrentPrincipal = createParamDecorator(extractCurrentPrincipal);

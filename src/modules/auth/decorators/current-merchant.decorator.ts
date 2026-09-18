// src/modules/auth/decorators/current-merchant.decorator.ts

import {
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { type RequestWithPrincipal } from '../interfaces/jwt-payload.interface';
import { UserRole } from '../../../common/enums';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// THE fix for the merchant-spoofing gap: derives the merchant a
// request may act as, from the authenticated principal, never from a
// bare client-supplied header for user-authenticated (JWT) requests.
//
//  - MERCHANT_ADMIN/MERCHANT_VIEWER JWT: merchantId comes ONLY from
//    the JWT's own claim (verified server-side at login). Any
//    x-merchant-id header is ignored outright — it cannot override.
//  - OPS_*/SUPER_ADMIN JWT: not scoped to one merchant; may explicitly
//    select one via ?merchantId= query param, validated as a
//    well-formed UUID but not required to match anything (ops needs
//    to view merchants with zero history too).
//  - Legacy API key: preserves the pre-existing header-trust behavior
//    — acceptable now that dangerous/cross-merchant endpoints require
//    a real user JWT via @Roles()+RolesGuard and never accept a bare
//    API key at all.
//
// The extraction logic is exported separately from the
// createParamDecorator() wrapper so it's directly unit-testable with
// a plain mock ExecutionContext, rather than only reachable through
// Nest's decorator/reflection pipeline.
export function extractCurrentMerchant(
  data: { required?: boolean } | undefined,
  ctx: ExecutionContext,
): string | undefined {
  const required = data?.required ?? true;
  const request = ctx.switchToHttp().getRequest<RequestWithPrincipal>();
  const principal = request.user;

  if (!principal) {
    throw new ForbiddenException('No authenticated principal on request');
  }

  if (principal.type === 'apiKey') {
    const headerValue = request.headers['x-merchant-id'] as string | undefined;
    if (!headerValue && required) {
      throw new BadRequestException('x-merchant-id header is required');
    }
    return headerValue;
  }

  // principal.type === 'user'
  if (principal.role === UserRole.MERCHANT_ADMIN || principal.role === UserRole.MERCHANT_VIEWER) {
    if (!principal.merchantId) {
      // Should be unreachable — the DB CHECK constraint on `users`
      // guarantees merchant roles always have a merchant_id — but
      // fail closed rather than silently proceed if it ever is.
      throw new ForbiddenException('Merchant-role user has no associated merchant');
    }
    return principal.merchantId;
  }

  // Internal role (OPS_*/SUPER_ADMIN) — explicit merchant selection
  // via query param only, never trusted from x-merchant-id.
  const queryValue = (request.query as Record<string, string | undefined>)?.['merchantId'];
  if (!queryValue) {
    if (required) {
      throw new BadRequestException('merchantId query parameter is required for this role');
    }
    return undefined;
  }
  if (!UUID_RE.test(queryValue)) {
    throw new BadRequestException('merchantId must be a valid UUID');
  }
  return queryValue;
}

export const CurrentMerchant = createParamDecorator(extractCurrentMerchant);

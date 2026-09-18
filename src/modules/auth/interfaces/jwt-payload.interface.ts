// src/modules/auth/interfaces/jwt-payload.interface.ts

import { type FastifyRequest } from 'fastify';
import { UserRole } from '../../../common/enums';

export interface JwtPayload {
  sub: string; // user id
  role: UserRole;
  merchantId: string | null;
}

// What request.user is populated with by JwtAuthGuard/AuthGuard for a
// JWT-authenticated request — see also the "apiKey" principal shape
// in auth.guard.ts for the legacy API-key path.
export interface AuthenticatedUser {
  type: 'user';
  id: string;
  role: UserRole;
  merchantId: string | null;
}

export interface AuthenticatedApiKey {
  type: 'apiKey';
}

export type RequestPrincipal = AuthenticatedUser | AuthenticatedApiKey;

// AuthGuard attaches the resolved principal to request.user — this
// typed alias replaces `(request as any).user` everywhere it's read.
export type RequestWithPrincipal = FastifyRequest & { user?: RequestPrincipal };

// test/unit/auth/guards/roles.guard.spec.ts

import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { RolesGuard } from '../../../../src/modules/auth/guards/roles.guard';
import { UserRole } from '../../../../src/common/enums';
import {
  type AuthenticatedApiKey,
  type AuthenticatedUser,
  type RequestWithPrincipal,
} from '../../../../src/modules/auth/interfaces/jwt-payload.interface';

const API_KEY_PRINCIPAL: AuthenticatedApiKey = { type: 'apiKey' };

function userPrincipal(role: UserRole, merchantId: string | null = null): AuthenticatedUser {
  return { type: 'user', role, id: 'u1', merchantId };
}

function makeContext(request: Partial<RequestWithPrincipal>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  const reflector = { getAllAndOverride: jest.fn() };
  let guard: RolesGuard;

  beforeEach(() => {
    jest.clearAllMocks();
    guard = new RolesGuard(reflector as unknown as ConstructorParameters<typeof RolesGuard>[0]);
  });

  it('allows the request through when the route has no @Roles() metadata', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    const request = { user: API_KEY_PRINCIPAL };

    expect(guard.canActivate(makeContext(request))).toBe(true);
  });

  it('rejects an apiKey principal outright, regardless of the allowed role list', () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.SUPER_ADMIN, UserRole.OPS_ADMIN]);
    const request = { user: API_KEY_PRINCIPAL };

    expect(() => guard.canActivate(makeContext(request))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(makeContext(request))).toThrow(
      'This action requires an authenticated user session, not an API key',
    );
  });

  it('rejects a user principal whose role is not in the allowed list', () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.SUPER_ADMIN, UserRole.OPS_ADMIN]);
    const request = { user: userPrincipal(UserRole.MERCHANT_ADMIN, 'merchant-1') };

    expect(() => guard.canActivate(makeContext(request))).toThrow(
      'Role MERCHANT_ADMIN is not permitted to perform this action',
    );
  });

  it('allows a user principal whose role is in the allowed list', () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.SUPER_ADMIN, UserRole.OPS_ADMIN]);
    const request = { user: userPrincipal(UserRole.OPS_ADMIN) };

    expect(guard.canActivate(makeContext(request))).toBe(true);
  });

  it('rejects when there is no principal on the request at all', () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.SUPER_ADMIN]);
    const request = {};

    expect(() => guard.canActivate(makeContext(request))).toThrow(ForbiddenException);
  });
});

// test/unit/auth/decorators/current-user.decorator.spec.ts

import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { extractCurrentUser } from '../../../../src/modules/auth/decorators/current-user.decorator';
import { extractCurrentPrincipal } from '../../../../src/modules/auth/decorators/current-principal.decorator';
import { UserRole } from '../../../../src/common/enums';

function makeContext(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('extractCurrentUser', () => {
  it('returns the user principal for a user-authenticated request', () => {
    const principal = { type: 'user', role: UserRole.OPS_VIEWER, id: 'u1', merchantId: null };
    expect(extractCurrentUser(undefined, makeContext({ user: principal }))).toBe(principal);
  });

  it('rejects an apiKey principal — this endpoint only makes sense for a human session', () => {
    expect(() => extractCurrentUser(undefined, makeContext({ user: { type: 'apiKey' } }))).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects when there is no principal at all', () => {
    expect(() => extractCurrentUser(undefined, makeContext({}))).toThrow(UnauthorizedException);
  });
});

describe('extractCurrentPrincipal', () => {
  it('returns a user principal unmodified', () => {
    const principal = { type: 'user', role: UserRole.MERCHANT_VIEWER, id: 'u1', merchantId: 'm1' };
    expect(extractCurrentPrincipal(undefined, makeContext({ user: principal }))).toBe(principal);
  });

  it('returns an apiKey principal unmodified (no restriction, unlike extractCurrentUser)', () => {
    const principal = { type: 'apiKey' as const };
    expect(extractCurrentPrincipal(undefined, makeContext({ user: principal }))).toBe(principal);
  });

  it('throws when there is no principal at all', () => {
    expect(() => extractCurrentPrincipal(undefined, makeContext({}))).toThrow(ForbiddenException);
  });
});

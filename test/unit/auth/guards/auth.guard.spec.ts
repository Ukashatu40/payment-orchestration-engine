// test/unit/auth/guards/auth.guard.spec.ts

import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '../../../../src/modules/auth/guards/auth.guard';
import { UserRole } from '../../../../src/common/enums';
import { type RequestWithPrincipal } from '../../../../src/modules/auth/interfaces/jwt-payload.interface';

function makeContext(request: RequestWithPrincipal): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

function makeRequest(overrides: Partial<RequestWithPrincipal> = {}): RequestWithPrincipal {
  return {
    url: '/api/v1/payments',
    headers: {},
    cookies: {},
    ip: '127.0.0.1',
    ...overrides,
  } as RequestWithPrincipal;
}

describe('AuthGuard', () => {
  let guard: AuthGuard;
  const configService = { get: jest.fn().mockReturnValue('dev-api-key-001,dev-api-key-002') };
  const jwtService = { verifyAsync: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    configService.get.mockReturnValue('dev-api-key-001,dev-api-key-002');
    guard = new AuthGuard(
      configService as unknown as ConstructorParameters<typeof AuthGuard>[0],
      jwtService as unknown as ConstructorParameters<typeof AuthGuard>[1],
    );
  });

  it('allows public paths through with no credentials at all', async () => {
    const request = makeRequest({ url: '/api/v1/health' });
    await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);
  });

  it('allows /auth/login and /auth/refresh through without credentials', async () => {
    await expect(
      guard.canActivate(makeContext(makeRequest({ url: '/api/v1/auth/login' }))),
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(makeContext(makeRequest({ url: '/api/v1/auth/refresh' }))),
    ).resolves.toBe(true);
  });

  it('rejects a request with no credentials on a protected path', async () => {
    const request = makeRequest();
    await expect(guard.canActivate(makeContext(request))).rejects.toThrow(UnauthorizedException);
  });

  it('authenticates via a valid access-token cookie and populates a user principal', async () => {
    jwtService.verifyAsync.mockResolvedValue({
      sub: 'user-1',
      role: UserRole.OPS_ADMIN,
      merchantId: null,
    });
    const request = makeRequest({ cookies: { payflow_access_token: 'valid.jwt' } });

    await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);
    expect(request.user).toEqual({
      type: 'user',
      id: 'user-1',
      role: UserRole.OPS_ADMIN,
      merchantId: null,
    });
  });

  it('authenticates via a valid Authorization: Bearer header', async () => {
    jwtService.verifyAsync.mockResolvedValue({
      sub: 'user-2',
      role: UserRole.MERCHANT_ADMIN,
      merchantId: 'merchant-1',
    });
    const request = makeRequest({ headers: { authorization: 'Bearer valid.jwt' } });

    await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);
    expect(request.user?.type).toBe('user');
    if (request.user?.type === 'user') {
      expect(request.user.id).toBe('user-2');
    }
  });

  it('prefers the Bearer header over the cookie when both are present', async () => {
    jwtService.verifyAsync.mockResolvedValue({
      sub: 'from-header',
      role: UserRole.OPS_VIEWER,
      merchantId: null,
    });
    const request = makeRequest({
      headers: { authorization: 'Bearer header.jwt' },
      cookies: { payflow_access_token: 'cookie.jwt' },
    });

    await guard.canActivate(makeContext(request));

    expect(jwtService.verifyAsync).toHaveBeenCalledWith('header.jwt');
  });

  it('rejects an invalid/expired JWT', async () => {
    jwtService.verifyAsync.mockRejectedValue(new Error('expired'));
    const request = makeRequest({ cookies: { payflow_access_token: 'bad.jwt' } });

    await expect(guard.canActivate(makeContext(request))).rejects.toThrow(
      'Invalid or expired access token',
    );
  });

  it('authenticates via a valid X-API-Key and populates an apiKey principal', async () => {
    const request = makeRequest({ headers: { 'x-api-key': 'dev-api-key-001' } });

    await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);
    expect(request.user).toEqual({ type: 'apiKey' });
  });

  it('rejects an invalid X-API-Key', async () => {
    const request = makeRequest({ headers: { 'x-api-key': 'not-a-real-key' } });

    await expect(guard.canActivate(makeContext(request))).rejects.toThrow('Invalid API key');
  });
});

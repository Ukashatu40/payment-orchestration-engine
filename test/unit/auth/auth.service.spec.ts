// test/unit/auth/auth.service.spec.ts

import * as argon2 from 'argon2';
import * as crypto from 'crypto';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from '../../../src/modules/auth/auth.service';
import { UserRole } from '../../../src/common/enums';
import { User } from '../../../src/modules/users/entities/user.entity';
import { RefreshToken } from '../../../src/modules/users/entities/refresh-token.entity';

const PASSWORD = 'CorrectHorseBattery9!';

async function makeUser(overrides: Partial<User> = {}): Promise<User> {
  const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
  return {
    id: 'user-1',
    email: 'test@example.com',
    passwordHash,
    role: UserRole.MERCHANT_ADMIN,
    merchantId: 'merchant-1',
    status: 'ACTIVE',
    lastLoginAt: null,
    failedLoginCount: 0,
    lockedUntil: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeRefreshTokenRow(overrides: Partial<RefreshToken> = {}): RefreshToken {
  return {
    id: 'rt-1',
    userId: 'user-1',
    tokenHash: 'hash',
    familyId: 'family-1',
    expiresAt: new Date(Date.now() + 1000 * 60 * 60),
    revokedAt: null,
    replacedByTokenId: null,
    userAgent: null,
    ip: null,
    createdAt: new Date(),
    ...overrides,
  } as RefreshToken;
}

type AuthServiceCtorArgs = ConstructorParameters<typeof AuthService>;

describe('AuthService', () => {
  let service: AuthService;
  const userRepo = {
    findByEmailWithPassword: jest.fn(),
    findById: jest.fn(),
    recordLoginSuccess: jest.fn(),
    recordLoginFailure: jest.fn<Promise<void>, [string, number, Date | null]>(),
  };
  const refreshTokenRepo = {
    create: jest.fn(),
    findByTokenHash: jest.fn(),
    markRevoked: jest.fn(),
    revokeFamily: jest.fn(),
    findActiveByUser: jest.fn(),
  };
  const auditLogRepo = {
    record: jest.fn(),
  };
  const jwtService = {
    signAsync: jest.fn().mockResolvedValue('signed.jwt.token'),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jwtService.signAsync.mockResolvedValue('signed.jwt.token');
    refreshTokenRepo.create.mockImplementation((data: Partial<RefreshToken>) =>
      Promise.resolve(makeRefreshTokenRow(data)),
    );
    service = new AuthService(
      userRepo as unknown as AuthServiceCtorArgs[0],
      refreshTokenRepo as unknown as AuthServiceCtorArgs[1],
      auditLogRepo as unknown as AuthServiceCtorArgs[2],
      jwtService as unknown as AuthServiceCtorArgs[3],
    );
  });

  describe('login', () => {
    it('succeeds with correct credentials and issues a token pair', async () => {
      const user = await makeUser();
      userRepo.findByEmailWithPassword.mockResolvedValue(user);

      const result = await service.login('test@example.com', PASSWORD, { ip: '1.2.3.4' });

      expect(result.user).toBe(user);
      expect(result.tokens.accessToken).toBe('signed.jwt.token');
      expect(result.tokens.refreshToken).toEqual(expect.any(String));
      expect(userRepo.recordLoginSuccess).toHaveBeenCalledWith('user-1');
      expect(auditLogRepo.record).toHaveBeenCalledWith(
        expect.objectContaining({ actorUserId: 'user-1', action: 'LOGIN_SUCCESS' }),
      );
    });

    it('does not reveal whether the email exists for an unknown user', async () => {
      userRepo.findByEmailWithPassword.mockResolvedValue(null);

      await expect(service.login('nobody@example.com', PASSWORD, {})).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(service.login('nobody@example.com', PASSWORD, {})).rejects.toThrow(
        'Invalid email or password',
      );
    });

    it('rejects a disabled account even with the correct password', async () => {
      const user = await makeUser({ status: 'DISABLED' });
      userRepo.findByEmailWithPassword.mockResolvedValue(user);

      await expect(service.login('test@example.com', PASSWORD, {})).rejects.toThrow(
        'Account is disabled',
      );
    });

    it('rejects while locked out, even with the correct password', async () => {
      const user = await makeUser({ lockedUntil: new Date(Date.now() + 60_000) });
      userRepo.findByEmailWithPassword.mockResolvedValue(user);

      await expect(service.login('test@example.com', PASSWORD, {})).rejects.toThrow(
        /temporarily locked/,
      );
    });

    it('rejects a wrong password without leaking success/failure timing shape', async () => {
      const user = await makeUser();
      userRepo.findByEmailWithPassword.mockResolvedValue(user);

      await expect(service.login('test@example.com', 'wrong-password', {})).rejects.toThrow(
        'Invalid email or password',
      );
      expect(userRepo.recordLoginFailure).toHaveBeenCalledWith('user-1', 1, null);
    });

    it('locks the account after 5 consecutive failed attempts', async () => {
      const user = await makeUser({ failedLoginCount: 4 });
      userRepo.findByEmailWithPassword.mockResolvedValue(user);

      await expect(service.login('test@example.com', 'wrong-password', {})).rejects.toThrow(
        UnauthorizedException,
      );

      expect(userRepo.recordLoginFailure).toHaveBeenCalledWith('user-1', 5, expect.any(Date));
      const lockedUntil = userRepo.recordLoginFailure.mock.calls[0][2];
      expect(lockedUntil?.getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe('refresh', () => {
    it('rotates a valid refresh token and issues a new pair in the same family', async () => {
      const rawToken = 'raw-refresh-token';
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      const existing = makeRefreshTokenRow({ tokenHash, familyId: 'family-xyz' });

      refreshTokenRepo.findByTokenHash.mockResolvedValue(existing);
      userRepo.findById.mockResolvedValue(await makeUser());

      const result = await service.refresh(rawToken, {});

      expect(result.tokens.accessToken).toBe('signed.jwt.token');
      expect(refreshTokenRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ familyId: 'family-xyz' }),
      );
      expect(refreshTokenRepo.markRevoked).toHaveBeenCalledWith(existing.id, expect.any(String));
    });

    it('rejects an unknown refresh token', async () => {
      refreshTokenRepo.findByTokenHash.mockResolvedValue(null);

      await expect(service.refresh('unknown', {})).rejects.toThrow('Invalid refresh token');
    });

    it('rejects an expired refresh token', async () => {
      const existing = makeRefreshTokenRow({ expiresAt: new Date(Date.now() - 1000) });
      refreshTokenRepo.findByTokenHash.mockResolvedValue(existing);

      await expect(service.refresh('raw', {})).rejects.toThrow('Refresh token expired');
    });

    it('detects reuse of an already-revoked token and revokes the whole family', async () => {
      const existing = makeRefreshTokenRow({ revokedAt: new Date(), familyId: 'family-stolen' });
      refreshTokenRepo.findByTokenHash.mockResolvedValue(existing);

      await expect(service.refresh('raw', {})).rejects.toThrow(
        'Refresh token has already been used — session revoked',
      );
      expect(refreshTokenRepo.revokeFamily).toHaveBeenCalledWith('family-stolen');
    });

    it('rejects when the owning user is no longer active', async () => {
      const existing = makeRefreshTokenRow();
      refreshTokenRepo.findByTokenHash.mockResolvedValue(existing);
      userRepo.findById.mockResolvedValue(await makeUser({ status: 'DISABLED' }));

      await expect(service.refresh('raw', {})).rejects.toThrow('Account is no longer active');
    });
  });

  describe('logout', () => {
    it('revokes the presented refresh token and records the audit entry', async () => {
      const existing = makeRefreshTokenRow();
      refreshTokenRepo.findByTokenHash.mockResolvedValue(existing);

      await service.logout('raw', 'user-1', { ip: '1.2.3.4' });

      expect(refreshTokenRepo.markRevoked).toHaveBeenCalledWith(existing.id);
      expect(auditLogRepo.record).toHaveBeenCalledWith(
        expect.objectContaining({ actorUserId: 'user-1', action: 'LOGOUT' }),
      );
    });

    it('does not throw when the refresh token is already gone/invalid', async () => {
      refreshTokenRepo.findByTokenHash.mockResolvedValue(null);

      await expect(service.logout('raw', 'user-1', {})).resolves.not.toThrow();
      expect(refreshTokenRepo.markRevoked).not.toHaveBeenCalled();
    });
  });

  describe('revokeSession', () => {
    it('allows revoking a session the user owns', async () => {
      refreshTokenRepo.findActiveByUser.mockResolvedValue([makeRefreshTokenRow({ id: 'rt-mine' })]);

      await service.revokeSession('rt-mine', 'user-1');

      expect(refreshTokenRepo.markRevoked).toHaveBeenCalledWith('rt-mine');
    });

    it('rejects revoking a session that belongs to someone else, without confirming its existence', async () => {
      // Regression test: this endpoint previously had no ownership
      // check at all — any authenticated user could revoke an
      // arbitrary session ID.
      refreshTokenRepo.findActiveByUser.mockResolvedValue([makeRefreshTokenRow({ id: 'rt-mine' })]);

      await expect(service.revokeSession('someone-elses-session', 'user-1')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(refreshTokenRepo.markRevoked).not.toHaveBeenCalled();
    });
  });
});

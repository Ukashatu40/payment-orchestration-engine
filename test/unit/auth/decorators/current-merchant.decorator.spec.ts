// test/unit/auth/decorators/current-merchant.decorator.spec.ts
//
// Direct unit coverage of the merchant-spoofing fix. See
// current-merchant.decorator.ts for the full design rationale.

import { ExecutionContext, BadRequestException, ForbiddenException } from '@nestjs/common';
import { extractCurrentMerchant } from '../../../../src/modules/auth/decorators/current-merchant.decorator';
import { UserRole } from '../../../../src/common/enums';

function makeContext(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('extractCurrentMerchant', () => {
  it('throws when there is no authenticated principal', () => {
    expect(() =>
      extractCurrentMerchant(undefined, makeContext({ headers: {}, query: {} })),
    ).toThrow(ForbiddenException);
  });

  describe('MERCHANT_ADMIN / MERCHANT_VIEWER JWT', () => {
    it("returns the JWT's own merchantId claim", () => {
      const request = {
        user: {
          type: 'user',
          role: UserRole.MERCHANT_ADMIN,
          merchantId: 'merchant-real',
          id: 'u1',
        },
        headers: {},
        query: {},
      };

      expect(extractCurrentMerchant(undefined, makeContext(request))).toBe('merchant-real');
    });

    it('IGNORES a spoofed x-merchant-id header entirely — this is the core fix', () => {
      const request = {
        user: {
          type: 'user',
          role: UserRole.MERCHANT_ADMIN,
          merchantId: 'merchant-real',
          id: 'u1',
        },
        headers: { 'x-merchant-id': 'merchant-attacker-controlled' },
        query: { merchantId: 'merchant-attacker-controlled' },
      };

      expect(extractCurrentMerchant(undefined, makeContext(request))).toBe('merchant-real');
    });

    it('works identically for MERCHANT_VIEWER', () => {
      const request = {
        user: {
          type: 'user',
          role: UserRole.MERCHANT_VIEWER,
          merchantId: 'merchant-real',
          id: 'u1',
        },
        headers: { 'x-merchant-id': 'someone-elses-merchant' },
        query: {},
      };

      expect(extractCurrentMerchant(undefined, makeContext(request))).toBe('merchant-real');
    });

    it('fails closed if a merchant-role principal somehow has no merchantId', () => {
      const request = {
        user: { type: 'user', role: UserRole.MERCHANT_ADMIN, merchantId: null, id: 'u1' },
        headers: {},
        query: {},
      };

      expect(() => extractCurrentMerchant(undefined, makeContext(request))).toThrow(
        ForbiddenException,
      );
    });
  });

  describe('internal roles (OPS_*/SUPER_ADMIN) JWT', () => {
    it('reads an explicit ?merchantId= query param when provided', () => {
      const validUuid = '11111111-1111-1111-1111-111111111111';
      const request = {
        user: { type: 'user', role: UserRole.OPS_ADMIN, merchantId: null, id: 'u1' },
        headers: {},
        query: { merchantId: validUuid },
      };

      expect(extractCurrentMerchant(undefined, makeContext(request))).toBe(validUuid);
    });

    it('rejects a malformed (non-UUID) merchantId query param', () => {
      const request = {
        user: { type: 'user', role: UserRole.SUPER_ADMIN, merchantId: null, id: 'u1' },
        headers: {},
        query: { merchantId: 'not-a-uuid' },
      };

      expect(() => extractCurrentMerchant(undefined, makeContext(request))).toThrow(
        BadRequestException,
      );
    });

    it('throws when required and no merchantId query param is given', () => {
      const request = {
        user: { type: 'user', role: UserRole.OPS_ADMIN, merchantId: null, id: 'u1' },
        headers: {},
        query: {},
      };

      expect(() => extractCurrentMerchant(undefined, makeContext(request))).toThrow(
        BadRequestException,
      );
    });

    it('returns undefined (unscoped) when not required and no query param is given', () => {
      const request = {
        user: { type: 'user', role: UserRole.SUPER_ADMIN, merchantId: null, id: 'u1' },
        headers: {},
        query: {},
      };

      expect(extractCurrentMerchant({ required: false }, makeContext(request))).toBeUndefined();
    });
  });

  describe('legacy apiKey principal', () => {
    it('trusts the x-merchant-id header (pre-existing behavior, preserved)', () => {
      const request = {
        user: { type: 'apiKey' },
        headers: { 'x-merchant-id': 'merchant-from-header' },
        query: {},
      };

      expect(extractCurrentMerchant(undefined, makeContext(request))).toBe('merchant-from-header');
    });

    it('throws when required and the header is missing', () => {
      const request = { user: { type: 'apiKey' }, headers: {}, query: {} };

      expect(() => extractCurrentMerchant(undefined, makeContext(request))).toThrow(
        BadRequestException,
      );
    });

    it('returns undefined when not required and the header is missing', () => {
      const request = { user: { type: 'apiKey' }, headers: {}, query: {} };

      expect(extractCurrentMerchant({ required: false }, makeContext(request))).toBeUndefined();
    });
  });
});

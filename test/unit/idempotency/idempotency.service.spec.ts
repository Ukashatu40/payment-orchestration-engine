// test/unit/idempotency/idempotency.service.spec.ts

import { Test, TestingModule } from '@nestjs/testing';
import { IdempotencyService } from '../../../src/modules/idempotency/idempotency.service';
import { IdempotencyKeyRepository } from '../../../src/modules/idempotency/repositories/idempotency-key.repository';
import { IdempotencyConflictException } from '../../../src/common/exceptions';
import { DataSource } from 'typeorm';

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------
const MERCHANT_ID = 'merchant-uuid-001';
const IDEM_KEY = 'client-uuid-abc-123';
const REQUEST_BODY = { amount: 280050, currency: 'INR' };

// ----------------------------------------------------------------
// Mock factory — returns a fresh mock for each test
// ----------------------------------------------------------------
function buildMocks(
  overrides: Partial<{
    existing: Record<string, unknown> | null;
    inserted: Record<string, unknown> | null;
  }> = {},
) {
  const existing = overrides.existing ?? null;
  const inserted = overrides.inserted ?? {
    merchantId: MERCHANT_ID,
    key: IDEM_KEY,
  };

  const mockIdempotencyKeyRepo = {
    findByKey: jest.fn().mockResolvedValue(existing),
    insertProcessing: jest
      .fn()
      .mockResolvedValue(
        inserted === undefined ? { merchantId: MERCHANT_ID, key: IDEM_KEY } : inserted,
      ),
    markCompleted: jest.fn().mockResolvedValue(undefined),
    markFailed: jest.fn().mockResolvedValue(undefined),
    deleteExpired: jest.fn().mockResolvedValue(5),
  };

  // DataSource mock — transaction() immediately calls the callback
  // with a mock EntityManager, simulating a real DB transaction
  const mockManager = { query: jest.fn().mockResolvedValue([]) };
  const mockDataSource = {
    transaction: jest
      .fn()
      .mockImplementation((cb: (m: typeof mockManager) => Promise<unknown>) => cb(mockManager)),
  };

  return { mockIdempotencyKeyRepo, mockDataSource, mockManager };
}

describe('IdempotencyService', () => {
  let service: IdempotencyService;
  let mocks: ReturnType<typeof buildMocks>;

  async function buildService(overrides = {}) {
    mocks = buildMocks(overrides);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IdempotencyService,
        {
          provide: DataSource,
          useValue: mocks.mockDataSource,
        },
        {
          provide: IdempotencyKeyRepository,
          useValue: mocks.mockIdempotencyKeyRepo,
        },
      ],
    }).compile();

    service = module.get<IdempotencyService>(IdempotencyService);
  }

  // ----------------------------------------------------------------
  // New request — key has never been seen before
  // ----------------------------------------------------------------
  describe('acquireOrReturn — new request', () => {
    beforeEach(() => buildService({ existing: null }));

    it('should return isNewRequest: true for a new key', async () => {
      const result = await service.acquireOrReturn(MERCHANT_ID, IDEM_KEY, REQUEST_BODY);

      expect(result.isNewRequest).toBe(true);
      expect(result.cachedResponse).toBeUndefined();
    });

    it('should acquire advisory lock before checking the key', async () => {
      await service.acquireOrReturn(MERCHANT_ID, IDEM_KEY, REQUEST_BODY);

      expect(mocks.mockManager.query).toHaveBeenCalledWith(
        expect.stringContaining('pg_advisory_xact_lock'),
        [`${MERCHANT_ID}:${IDEM_KEY}`],
      );
    });

    it('should insert key with PROCESSING status', async () => {
      await service.acquireOrReturn(MERCHANT_ID, IDEM_KEY, REQUEST_BODY);

      expect(mocks.mockIdempotencyKeyRepo.insertProcessing).toHaveBeenCalledWith(
        MERCHANT_ID,
        IDEM_KEY,
        expect.any(String), // SHA-256 hash
        expect.anything(), // entityManager
      );
    });
  });

  // ----------------------------------------------------------------
  // Completed key — idempotent replay (FS-03 second attempt after success)
  // ----------------------------------------------------------------
  describe('acquireOrReturn — completed key', () => {
    const cachedBody = { id: 'txn-xyz', state: 'AUTHORISED' };

    beforeEach(() =>
      buildService({
        existing: {
          status: 'COMPLETED',
          responseCode: 200,
          responseBody: cachedBody,
        },
      }),
    );

    it('should return cached response without hitting gateway again', async () => {
      const result = await service.acquireOrReturn(MERCHANT_ID, IDEM_KEY, REQUEST_BODY);

      expect(result.isNewRequest).toBe(false);
      expect(result.cachedResponse?.code).toBe(200);
      expect(result.cachedResponse?.body).toEqual(cachedBody);
    });

    it('should not attempt to insert a new key', async () => {
      await service.acquireOrReturn(MERCHANT_ID, IDEM_KEY, REQUEST_BODY);

      expect(mocks.mockIdempotencyKeyRepo.insertProcessing).not.toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------------
  // In-flight key — double submit (FS-03 concurrent double-click)
  // ----------------------------------------------------------------
  describe('acquireOrReturn — processing key (FS-03)', () => {
    beforeEach(() => buildService({ existing: { status: 'PROCESSING' } }));

    it('should throw IdempotencyConflictException', async () => {
      await expect(service.acquireOrReturn(MERCHANT_ID, IDEM_KEY, REQUEST_BODY)).rejects.toThrow(
        IdempotencyConflictException,
      );
    });

    it('should not insert a new key', async () => {
      await expect(service.acquireOrReturn(MERCHANT_ID, IDEM_KEY, REQUEST_BODY)).rejects.toThrow();

      expect(mocks.mockIdempotencyKeyRepo.insertProcessing).not.toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------------
  // Failed key — retry is allowed
  // ----------------------------------------------------------------
  describe('acquireOrReturn — failed key (retry allowed)', () => {
    beforeEach(() => buildService({ existing: { status: 'FAILED' } }));

    it('should delete the failed key and allow retry', async () => {
      const result = await service.acquireOrReturn(MERCHANT_ID, IDEM_KEY, REQUEST_BODY);

      // Should have deleted the failed record
      expect(mocks.mockManager.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM idempotency_keys'),
        [MERCHANT_ID, IDEM_KEY],
      );

      // Should have inserted a new PROCESSING record
      expect(mocks.mockIdempotencyKeyRepo.insertProcessing).toHaveBeenCalled();
      expect(result.isNewRequest).toBe(true);
    });
  });

  // ----------------------------------------------------------------
  // Race condition safety net — insert returns null (FS-09)
  // ----------------------------------------------------------------
  // AFTER — explicit, no ambiguity
  describe('acquireOrReturn — insert conflict (FS-09 safety net)', () => {
    beforeEach(async () => {
      mocks = buildMocks({ existing: null, inserted: null });

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          IdempotencyService,
          {
            provide: DataSource,
            useValue: mocks.mockDataSource,
          },
          {
            provide: IdempotencyKeyRepository,
            useValue: mocks.mockIdempotencyKeyRepo,
          },
        ],
      }).compile();

      service = module.get<IdempotencyService>(IdempotencyService);
    });

    it('should throw IdempotencyConflictException when insert returns null', async () => {
      // Explicitly force the mock to return null right before the call
      mocks.mockIdempotencyKeyRepo.insertProcessing.mockResolvedValueOnce(null);

      await expect(service.acquireOrReturn(MERCHANT_ID, IDEM_KEY, REQUEST_BODY)).rejects.toThrow(
        IdempotencyConflictException,
      );
    });
  });

  // ----------------------------------------------------------------
  // markCompleted
  // ----------------------------------------------------------------
  describe('markCompleted', () => {
    beforeEach(() => buildService());

    it('should call repo markCompleted with correct args', async () => {
      const responseBody = { id: 'txn-xyz', state: 'CAPTURED' };

      await service.markCompleted(MERCHANT_ID, IDEM_KEY, 201, responseBody, 'txn-uuid-001');

      expect(mocks.mockIdempotencyKeyRepo.markCompleted).toHaveBeenCalledWith(
        MERCHANT_ID,
        IDEM_KEY,
        201,
        responseBody,
        'txn-uuid-001',
      );
    });
  });

  // ----------------------------------------------------------------
  // markFailed
  // ----------------------------------------------------------------
  describe('markFailed', () => {
    beforeEach(() => buildService());

    it('should call repo markFailed with correct args', async () => {
      await service.markFailed(MERCHANT_ID, IDEM_KEY);

      expect(mocks.mockIdempotencyKeyRepo.markFailed).toHaveBeenCalledWith(MERCHANT_ID, IDEM_KEY);
    });
  });

  // ----------------------------------------------------------------
  // purgeExpired
  // ----------------------------------------------------------------
  describe('purgeExpired', () => {
    beforeEach(() => buildService());

    it('should return count of deleted keys', async () => {
      const count = await service.purgeExpired();
      expect(count).toBe(5);
    });
  });

  // ----------------------------------------------------------------
  // Merchant scoping (FS-13)
  // ----------------------------------------------------------------
  describe('merchant scoping (FS-13)', () => {
    it('should include merchantId in the advisory lock key', async () => {
      mocks = buildMocks({ existing: null });

      const module = await Test.createTestingModule({
        providers: [
          IdempotencyService,
          { provide: DataSource, useValue: mocks.mockDataSource },
          {
            provide: IdempotencyKeyRepository,
            useValue: mocks.mockIdempotencyKeyRepo,
          },
        ],
      }).compile();

      service = module.get<IdempotencyService>(IdempotencyService);

      const merchantA = 'merchant-A';
      const merchantB = 'merchant-B';
      const sharedKey = 'same-uuid-key';

      await service.acquireOrReturn(merchantA, sharedKey, REQUEST_BODY);

      // Lock key must include merchantId — different merchants are independent
      expect(mocks.mockManager.query).toHaveBeenCalledWith(
        expect.stringContaining('pg_advisory_xact_lock'),
        [`${merchantA}:${sharedKey}`],
      );

      // Lock for merchant B would use a different key
      // `merchant-B:same-uuid-key` ≠ `merchant-A:same-uuid-key`
      expect(mocks.mockManager.query).not.toHaveBeenCalledWith(expect.anything(), [
        `${merchantB}:${sharedKey}`,
      ]);
    });
  });
});

// src/modules/idempotency/idempotency.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import * as crypto from 'crypto';
import { IdempotencyKeyRepository } from './repositories/idempotency-key.repository';
import { IdempotencyResult } from './interfaces/idempotency-result.interface';
import { IdempotencyConflictException } from '../../common/exceptions';

@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly idempotencyKeyRepo: IdempotencyKeyRepository,
  ) {}

  // ----------------------------------------------------------------
  // Check-and-lock pattern.
  //
  // Flow:
  // 1. Acquire pg_advisory_xact_lock scoped to (merchantId, key)
  // 2. Check if key exists in DB
  //    a. COMPLETED → return cached response (idempotent replay)
  //    b. PROCESSING → throw ConflictException (FS-03 double-click)
  //    c. FAILED → delete and allow retry
  //    d. Not found → insert with PROCESSING status
  // 3. Return isNewRequest: true — caller proceeds with business logic
  // 4. Caller must call markCompleted() or markFailed() after processing
  //
  // The advisory lock is transaction-scoped — auto-released on commit.
  // This means two concurrent requests with the same key will queue
  // at step 1, not race to step 2. Satisfies FS-09.
  // ----------------------------------------------------------------
  async acquireOrReturn(
    merchantId: string,
    idempotencyKey: string,
    requestBody: unknown,
  ): Promise<IdempotencyResult> {
    const requestHash = this.hashRequest(requestBody);

    return this.dataSource.transaction(async (manager) => {
      // Step 1: Acquire advisory lock scoped to this merchant + key.
      // pg_advisory_xact_lock takes a single bigint — we hash the
      // composite key string into a stable integer.
      // Lock is released automatically when the transaction commits.
      const lockKey = `${merchantId}:${idempotencyKey}`;
      await manager.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [lockKey]);

      // Step 2: Check existing record (with lock held — no race)
      const existing = await this.idempotencyKeyRepo.findByKey(merchantId, idempotencyKey, manager);

      if (existing) {
        // Case A: Already completed — return cached response
        if (existing.status === 'COMPLETED') {
          this.logger.log('Idempotency cache hit — returning cached response', {
            merchantId,
            idempotencyKey,
          });

          return {
            isNewRequest: false,
            cachedResponse: {
              code: existing.responseCode!,
              body: existing.responseBody!,
            },
          };
        }

        // Case B: In-flight — another request is currently processing
        // This is the FS-03 scenario (customer double-clicks Pay)
        if (existing.status === 'PROCESSING') {
          this.logger.warn('Duplicate in-flight request detected', {
            merchantId,
            idempotencyKey,
          });

          throw new IdempotencyConflictException(idempotencyKey, merchantId);
        }

        // Case C: Previous attempt failed — delete and allow retry
        // The idempotency key is reusable after a FAILED attempt
        if (existing.status === 'FAILED') {
          await manager.query(
            `DELETE FROM idempotency_keys
              WHERE merchant_id = $1 AND key = $2`,
            [merchantId, idempotencyKey],
          );
        }
      }

      // Step 3: Insert new key with PROCESSING status.
      // ON CONFLICT DO NOTHING is a safety net — the advisory lock
      // prevents concurrent inserts, but this guards against any
      // degenerate edge cases.
      const inserted = await this.idempotencyKeyRepo.insertProcessing(
        merchantId,
        idempotencyKey,
        requestHash,
        manager,
      );

      // insertProcessing returns null when ON CONFLICT DO NOTHING fires,
      // meaning another concurrent request already holds this key.
      // This is the FS-09 race condition safety net.
      this.logger.log('Attempted to acquire idempotency key', {
        merchantId,
        idempotencyKey,
        insertResult: inserted ? 'INSERTED' : 'CONFLICT',
      });

      if (inserted === null || inserted === undefined) {
        throw new IdempotencyConflictException(idempotencyKey, merchantId);
      }

      return { isNewRequest: true };
    });
  }

  // ----------------------------------------------------------------
  // Called after successful processing.
  // Caches the response so future duplicate requests get it back.
  // ----------------------------------------------------------------
  async markCompleted(
    merchantId: string,
    idempotencyKey: string,
    responseCode: number,
    responseBody: Record<string, unknown>,
    transactionId: string,
  ): Promise<void> {
    await this.idempotencyKeyRepo.markCompleted(
      merchantId,
      idempotencyKey,
      responseCode,
      responseBody,
      transactionId,
    );

    this.logger.log('Idempotency key marked COMPLETED', {
      merchantId,
      idempotencyKey,
      transactionId,
    });
  }

  // ----------------------------------------------------------------
  // Called when processing fails.
  // Marks key as FAILED so the client can retry with the same key.
  // ----------------------------------------------------------------
  async markFailed(merchantId: string, idempotencyKey: string): Promise<void> {
    await this.idempotencyKeyRepo.markFailed(merchantId, idempotencyKey);

    this.logger.log('Idempotency key marked FAILED', {
      merchantId,
      idempotencyKey,
    });
  }

  // ----------------------------------------------------------------
  // Cleanup job — deletes expired non-completed keys.
  // Called on a schedule (Level 13 scheduler).
  // ----------------------------------------------------------------
  async purgeExpired(): Promise<number> {
    const deleted = await this.idempotencyKeyRepo.deleteExpired();

    if (deleted > 0) {
      this.logger.log(`Purged ${deleted} expired idempotency keys`);
    }

    return deleted;
  }

  // ----------------------------------------------------------------
  // SHA-256 of the request body.
  // Stored so we can detect payload tampering on replay attempts.
  // ----------------------------------------------------------------
  private hashRequest(body: unknown): string {
    return crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
  }
}

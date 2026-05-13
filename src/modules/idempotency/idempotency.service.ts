// src/modules/idempotency/idempotency.service.ts

import { ConflictException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import * as crypto from 'crypto';
import { IdempotencyStatus } from 'src/common/enums/enums';

export interface IdempotencyResult {
  isNewRequest: boolean;
  cachedResponse?: { code: number; body: unknown };
}

export interface IdempotencyRecord {
  merchant_id?: string;
  key?: string;
  request_hash: string;
  status: IdempotencyStatus;
  response_code: number;
  response_body: unknown;
}

@Injectable()
export class IdempotencyService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Check-and-lock pattern using PostgreSQL advisory locks.
   * Satisfies: FS-03 (double submit), FS-09 (concurrent race condition)
   *
   * Advisory locks are connection-scoped and auto-released on
   * COMMIT/ROLLBACK — no deadlock risk.
   */
  async acquireOrReturn(
    merchantId: string,
    idempotencyKey: string,
    requestBody: unknown,
  ): Promise<IdempotencyResult> {
    const requestHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(requestBody))
      .digest('hex');

    return this.dataSource.transaction(async (manager) => {
      // Step 1: Acquire advisory lock scoped to this idempotency key.
      // pg_advisory_xact_lock is transaction-scoped — auto-releases on commit.
      // Two concurrent requests with the same key will queue here, not race.
      // This is what prevents the FS-09 microsecond race condition.
      const lockKey = `${merchantId}:${idempotencyKey}`;
      await manager.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
        lockKey,
      ]);

      // Step 2: Check if this key already exists (with lock held)
      const existing: IdempotencyRecord[] = await manager.query(
        `SELECT status, response_code, response_body, request_hash
           FROM idempotency_keys
          WHERE merchant_id = $1 AND key = $2`,
        [merchantId, idempotencyKey],
      );

      if (existing.length > 0) {
        const record = existing[0];

        if (record.status === IdempotencyStatus.PROCESSING) {
          // Another request is in-flight with the same key
          // This is the FS-03 scenario (double-click Pay button)
          throw new ConflictException(
            'A request with this idempotency key is already being processed',
          );
        }

        if (record.status === IdempotencyStatus.COMPLETED) {
          // Return the cached response — idempotent replay
          return {
            isNewRequest: false,
            cachedResponse: {
              code: record.response_code,
              body: record.response_body,
            },
          };
        }

        // Status is FAILED — allow retry by falling through to insert
        await manager.query(
          `DELETE FROM idempotency_keys
            WHERE merchant_id = $1 AND key = $2`,
          [merchantId, idempotencyKey],
        );
      }

      // Step 3: Insert with PROCESSING status (lock still held)
      // ON CONFLICT DO NOTHING is a safety net — the advisory lock
      // prevents concurrent inserts, but handles degenerate cases.
      const inserted: { key: string }[] = await manager.query(
        `INSERT INTO idempotency_keys
           (merchant_id, key, request_hash, status)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (merchant_id, key) DO NOTHING
         RETURNING key`,
        [merchantId, idempotencyKey, requestHash, IdempotencyStatus.PROCESSING],
      );

      if (inserted.length === 0) {
        // Race condition safety net triggered
        throw new ConflictException(
          'Concurrent request with same idempotency key detected',
        );
      }

      // Advisory lock releases on transaction commit.
      // The caller must call markCompleted() or markFailed() after processing.
      return { isNewRequest: true };
    });
  }

  async markCompleted(
    merchantId: string,
    idempotencyKey: string,
    responseCode: number,
    responseBody: unknown,
  ): Promise<void> {
    await this.dataSource.query(
      `UPDATE idempotency_keys
          SET status = $5,
              response_code = $3,
              response_body = $4,
              updated_at = NOW()
        WHERE merchant_id = $1 AND key = $2`,
      [
        merchantId,
        idempotencyKey,
        responseCode,
        responseBody,
        IdempotencyStatus.COMPLETED,
      ],
    );
  }

  async markFailed(merchantId: string, idempotencyKey: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE idempotency_keys
          SET status = $3, updated_at = NOW()
        WHERE merchant_id = $1 AND key = $2`,
      [merchantId, idempotencyKey, IdempotencyStatus.FAILED],
    );
  }
}

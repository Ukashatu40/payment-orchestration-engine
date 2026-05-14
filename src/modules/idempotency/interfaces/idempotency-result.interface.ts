// src/modules/idempotency/interfaces/idempotency-result.interface.ts

export interface IdempotencyResult {
  // true = first time seeing this key, proceed with processing
  // false = duplicate request, return cached response
  isNewRequest: boolean;

  // Only populated when isNewRequest is false
  cachedResponse?: {
    code: number;
    body: Record<string, unknown>;
  };
}

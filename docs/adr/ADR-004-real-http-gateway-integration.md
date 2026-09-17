# ADR-004: Real HTTP Gateway Adapters for Paystack, Flutterwave, Interswitch, Opay

**Status:** Accepted

## Context

The four original gateway adapters (Razorpay, Stripe, PayU, UPI) all extend
`BaseMockAdapter` and never make a real network call — they synthesize
responses in-process, driven by `x-mock-*` request headers, so that
scenario tests can deterministically simulate timeouts, declines, 5xx
errors, and rate limits. Adding Nigerian merchant support required four
adapters (Paystack, Flutterwave, Interswitch, Opay) that call real
sandbox/production gateway APIs — the first departure from the
mock-only precedent in this codebase.

## Decisions

**1. `BaseHttpAdapter` is a sibling of `BaseMockAdapter`, not a subclass.**
The two have no shared behavior — one simulates, one calls a real HTTP
client — so combining them under one hierarchy would only add
confusing conditional logic. `BaseHttpAdapter` owns: (a) per-call
`gateway_config` lookup, since `api_key`/`timeout_ms` are DB-mutable
at runtime via the gateway config update endpoint and caching them at
adapter construction would risk using a stale secret; (b) mapping of
axios transport failures (`ECONNABORTED`/`ETIMEDOUT` → timeout;
network error / 5xx / 429 → unavailable) to the existing
`GatewayTimeoutException`/`GatewayUnavailableException` types, so the
circuit breaker and `GlobalExceptionFilter` require zero changes to
support the new adapters.

**2. `axios`, not `@nestjs/axios`.** Plain axios instances (one per
call, via `axios.create()`) fit this codebase's async/await style;
`@nestjs/axios` wraps every call in an RxJS `Observable`, which would
be the only RxJS usage pattern in an otherwise async/await codebase.

**3. No generic HTTP retry library, deliberately.** The existing
`CircuitBreakerService` (per gateway/payment-method) plus
`GatewayRouterService`'s failover-to-next-best-gateway already provide
resilience at the orchestration layer — the same mechanism the mock
adapters rely on. Adding a second, lower-level retry layer
(`axios-retry` or similar) that silently retries a `POST
/transaction/initialize` on timeout risks double-charging a customer
at the gateway, since these initialize/charge endpoints aren't
documented as safely retryable without a gateway-specific idempotency
key. Mutating calls (`authorise`/`capture`/`refund`/`void`) get a
single attempt with a `gateway_config.timeout_ms`-bounded axios
timeout; `fetchStatus` (read-only, used by reconciliation) may retry
locally without a library.

**4. Secrets live only in `gateway_config` (DB), never in env vars.**
The pre-existing `RAZORPAY_WEBHOOK_SECRET`-style env vars in
`.env.example` were already dead code — `WebhooksController` reads
exclusively from `gateway_config.webhook_secret`/`api_key`. Rather
than reviving the env-var pattern for the 4 new gateways (which would
leave two live-but-inconsistent secret-sourcing mechanisms in the same
codebase), the new gateways standardize on the pattern that's actually
operative: DB-config, seeded via `scripts/seed-gateway-secrets.ts`,
never committed to a migration file.

**5. Webhook-driven completion for redirect/async checkout flows.**
Paystack, Flutterwave, and Opay's checkout APIs return a redirect URL
or hosted-checkout link, not a synchronous authorised/declined result
— unlike the mock adapters, which always resolve `authorise()`
synchronously. These three adapters return `status: 'pending'`
(already a valid member of `GatewayAuthResponse['status']`, previously
unused by any adapter), and `TransactionsService.initiatePayment` was
extended to handle it: the transaction stays in `AUTH_INITIATED`
rather than being force-transitioned to `AUTHORISED`, and the eventual
gateway webhook (`charge.success`, `charge.completed`, etc.) drives
the state machine forward via the existing webhook processor. This
also fixed a latent bug the new code path exposed: the `gateway`
column update in `initiatePayment` was previously an unawaited
fire-and-forget write, racing against any immediate re-read of the
transaction row.

**6. Webhook signature verification, queue extraction, and state
transitions extend the existing switch/map pattern** in
`webhook-signature.service.ts` / `webhook-queue.service.ts` /
`webhook-processor.service.ts` rather than introducing a polymorphic
per-adapter webhook interface. The existing pattern is centralized and
easy to audit; a larger refactor wasn't warranted by 4 more gateways.
All four schemes were confirmed against live current documentation
(not guessed) before implementing, and turned out to differ from each
other more than initially assumed:
- **Paystack**: HMAC-SHA512 of the raw body, header
  `x-paystack-signature` (the other gateways in this file use SHA256).
- **Flutterwave**: a direct pre-shared secret comparison via the
  `verif-hash` header, not an HMAC over the body at all.
- **Interswitch**: HMAC-SHA512 of the raw body, header
  `X-Interswitch-Signature`. Source:
  [docs.interswitchgroup.com/v1.1/docs/webhooks](https://docs.interswitchgroup.com/v1.1/docs/webhooks).
  Confirming this also revealed the webhook envelope's top-level
  `event` field (e.g. `TRANSACTION.COMPLETED`) does **not** itself
  indicate success vs. failure — the docs state such a transaction
  "may or may not be successful." The actual outcome is
  `data.responseCode` (`"00"` = approved). `extractEventType`
  therefore encodes both into a composite type string
  (`TRANSACTION.COMPLETED:SUCCESS`/`:FAILURE`) for
  `resolveTransition` to key on. There is also no metadata-passthrough
  field — `interswitch.adapter.ts` sends our `transactionId` as
  `merchant_reference`, echoed back as `data.merchantReference`.
- **Opay**: the signature is **not header-based** — it's a top-level
  `sha512` field in the callback JSON body, computed as HMAC-**SHA3-512**
  (confirmed distinct from the standard SHA2-512 used elsewhere in
  this file — Node's `crypto` supports `'sha3-512'` as a digest name)
  over a specific formatted string built from named fields of the
  nested `payload` object, not the raw body. Source:
  [doc.opaycheckout.com/callback-signature](https://doc.opaycheckout.com/callback-signature).
  Two callback types are implemented, dispatched on a `type`
  discriminator field: `"transaction-status"` (signing string built
  from amount/currency/reference/refunded/status/timestamp/token/
  transactionId) and `"topup"` (orderNo/merchantOrderNo/merchantId/
  orderAmount/serviceType/orderStatus) — both signing-string templates
  are quoted verbatim from the docs. The JSON *envelope* for `topup`
  (that it's also `{ payload: {...}, sha512, type }`) is **inferred**,
  not independently confirmed — the docs show the topup signing-string
  template but no raw topup JSON example, only that its Java
  verification code reuses the identical `payload.getSignature()`
  accessor as `transaction-status`, implying a shared wrapper class.
  Any other `type` value is rejected rather than guessed. The confirmed
  payload has no metadata-passthrough field, so `opay.adapter.ts` sends
  our `transactionId` as `reference`, echoed back as
  `payload.payload.reference`.

**7. Interswitch OAuth2 token caching.** Unlike the other three
gateways' static bearer/signed-request auth, Interswitch requires a
client-credentials OAuth2 token fetched from a separate endpoint. The
adapter caches the token in-memory with expiry tracking (refreshed
within 60s of expiry) rather than fetching a new token per call.

## Consequences

- New adapters (Paystack, Flutterwave, Opay) return `pending` from
  `authorise()`; consumers of the payment API must not assume
  `AUTHORISED` is reachable synchronously for NGN transactions the way
  it is for the original 4 gateways.
- Opay webhooks with a callback `type` other than `"transaction-status"`
  or `"topup"` are rejected outright. `"topup"` verification itself
  works against the confirmed signing-string template, but its JSON
  envelope assumption is unverified against a real event — test it
  against a real Opay sandbox topup callback before depending on it in
  production, and correct `verifyOpay`/`opayTopupSigningString` in
  `webhook-signature.service.ts` if the real shape differs.
- Endpoint paths and response field shapes for all 4 adapters reflect
  each gateway's public API as of implementation time and should be
  reconfirmed against current docs before production use, since these
  are third-party APIs that evolve independently of this codebase.
- Adding a 9th gateway follows this same pattern (`BaseHttpAdapter`
  subclass + registry/module wiring + webhook switch-case additions),
  not the `BaseMockAdapter` pattern, unless it's explicitly a
  test/sandbox-only addition.

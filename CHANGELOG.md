# Changelog

## [1.0.0] — 2026-05-21

### Added

- Transaction state machine with 23 states and deterministic transitions
- Multi-criteria gateway router (success rate, latency, cost, health, fit)
- Circuit breaker per gateway per payment method (CLOSED/OPEN/HALF-OPEN)
- Idempotency layer using PostgreSQL advisory locks
- Webhook ingestion pipeline with signature verification and deduplication
- Reconciliation engine running every 15 minutes with anomaly detection
- Dead letter queue for failed webhook processing
- 23 REST API endpoints with OpenAPI 3.0 documentation
- Full Docker Compose deployment with health checks
- 112 unit tests across 7 test suites
- 30 end-to-end scenario tests covering all 15 failure scenarios
- 5 deliberate technical errors identified in specification
- Distributed tracing via trace ID propagation
- PII sanitisation in audit log gateway responses
- BIGINT paise storage — zero floating-point error accumulation
- Immutable audit trail with DB-level append-only rules

### Architecture Decisions

- ADR-001: TypeScript + NestJS + Fastify adapter
- ADR-002: BIGINT paise for financial amounts
- ADR-003: Pessimistic locking with lock release before gateway calls

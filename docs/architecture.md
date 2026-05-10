# PayFlow Commerce — Payment Orchestration Layer

# Architecture Document

**Version:** 1.0  
**Date:** [Day 1]  
**Author:** [Your Name]  
**Status:** Living Document (updated through Day 15)

---

## 1. System Overview

PayFlow Commerce processes 100,000+ daily transactions across four payment
gateways. This document describes the back-end payment orchestration layer
that replaces the existing single-gateway integration responsible for 12%
silent failure rates and ~180 double-charge incidents per month.

The orchestration layer sits between the merchant application and payment
gateways, providing:

- Intelligent multi-criteria gateway routing
- Sub-2-second gateway failover
- Absolute idempotency across retries and network failures
- 100% auditable transaction history via immutable state machine
- Automated reconciliation with anomaly detection

---

## 2. Architecture Diagram

┌─────────────────────────────────────────────────────────┐
│ Merchant Application │
└─────────────────────────┬───────────────────────────────┘
│ REST API (HTTPS)
▼
┌─────────────────────────────────────────────────────────┐
│ Payment Orchestration Layer │
│ │
│ ┌──────────────┐ ┌──────────────┐ ┌─────────────┐ │
│ │ API Layer │ │ Idempotency │ │ Trace ID │ │
│ │ (NestJS + │───▶│ Service │ │ Interceptor │ │
│ │ Fastify) │ │ (Adv. Locks) │ └─────────────┘ │
│ └──────┬───────┘ └──────────────┘ │
│ │ │
│ ┌──────▼───────────────────────────────────────────┐ │
│ │ Transaction State Machine │ │
│ │ (SELECT FOR UPDATE + Immutable Audit Trail) │ │
│ └──────┬───────────────────────────────────────────┘ │
│ │ │
│ ┌──────▼───────┐ ┌──────────────┐ │
│ │ Gateway │ │ Circuit │ │
│ │ Router │───▶│ Breaker │ │
│ │ (Multi-score)│ │ (per gateway)│ │
│ └──────┬───────┘ └──────────────┘ │
│ │ │
│ ┌──────▼───────────────────────────────────────────┐ │
│ │ Gateway Adapter Layer │ │
│ │ Razorpay │ Stripe │ PayU │ UPI (NPCI) │ │
│ └──────────────────────────────────────────────────┘ │
│ │
│ ┌──────────────────────────────────────────────────┐ │
│ │ Webhook Ingestion Pipeline │ │
│ │ Verify → Deduplicate → Queue → Process → Audit │ │
│ └──────────────────────────────────────────────────┘ │
│ │
│ ┌──────────────────────────────────────────────────┐ │
│ │ Reconciliation Engine (Batch, 15min) │ │
│ └──────────────────────────────────────────────────┘ │
└─────────────────────────┬───────────────────────────────┘
│
┌───────────▼────────────┐
│ PostgreSQL 15 │
│ (Primary + Replica) │
└────────────────────────┘

---

## 3. Technology Choices

| Component        | Choice              | Justification                                                  |
| ---------------- | ------------------- | -------------------------------------------------------------- |
| Language         | TypeScript (strict) | Compile-time BIGINT safety for financial amounts               |
| Framework        | NestJS 10           | DI container for testable services, module isolation           |
| HTTP Adapter     | Fastify             | Raw body access for webhook HMAC verification; B3 perf targets |
| Database         | PostgreSQL 15       | JSONB, advisory locks, LISTEN/NOTIFY, row-level locking        |
| ORM              | TypeORM             | Migration tooling, QueryBuilder for locking patterns           |
| Containerisation | Docker + Compose    | Single-command deployment for automated test harness           |

See `docs/adr/` for full justification of each decision.

---

## 4. Core Components

### 4.1 Transaction State Machine

Single source of truth for transaction lifecycle. Enforces deterministic
transitions via an immutable transition map. Any invalid transition
(e.g. CREATED → REFUNDED) throws `InvalidStateTransitionException` before
reaching the database. Every valid transition writes an immutable row to
`transaction_state_log`. Satisfies FS-15.

### 4.2 Gateway Router

Multi-criteria scoring algorithm selecting the optimal gateway per
transaction. Factors: success rate (35%), latency P95 (20%), cost (20%),
circuit breaker health (15%), payment method fit (10%). Weights are
DB-stored and changeable without redeployment. Satisfies FS-07.

### 4.3 Circuit Breaker

Per-gateway, per-payment-method circuit breaker with three states:
CLOSED → OPEN → HALF-OPEN. Configuration (failure threshold, timeout,
half-open test count) stored in `gateway_config`. Satisfies FS-01.

### 4.4 Idempotency Layer

PostgreSQL advisory locks (`pg_advisory_xact_lock`) prevent concurrent
duplicate requests at the microsecond level. Idempotency keys scoped to
`(merchant_id, key)` composite to prevent cross-merchant collisions.
Satisfies FS-03, FS-09, FS-13.

### 4.5 Webhook Ingestion Pipeline

Five-stage pipeline: signature verification → deduplication →
persistent queue → state machine processor → audit logger.
Handles at-least-once delivery, out-of-order events, and replay attacks.
Dead letter queue for failed processing. Satisfies FS-02, FS-06, FS-10.

### 4.6 Reconciliation Engine

Batch job running every 15 minutes. Identifies stale transactions,
polls gateway status APIs, detects discrepancies, and flags anomalies
for human review. Never auto-triggers refunds on settlement mismatches.
Satisfies FS-11.

---

## 5. Database Schema Summary

11 tables across 3 domains:

**Transaction Domain**

- `transactions` — core records, current state, BIGINT amounts
- `transaction_state_log` — immutable audit trail, append-only
- `refunds` — refund records linked to parent transactions
- `gateway_routes` — routing decisions with scores for every transaction

**Gateway Domain**

- `gateway_config` — per-gateway config, circuit breaker thresholds
- `gateway_health_metrics` — per-minute aggregates for sliding window
- `routing_config` — algorithm weights, changeable without redeployment

**Infrastructure Domain**

- `idempotency_keys` — duplicate request prevention, 24h TTL
- `processed_webhook_events` — webhook deduplication store
- `webhook_queue` — durable queue with DLQ support
- `reconciliation_log` — discrepancy records with anomaly flags

---

## 6. Concurrency Strategy

Two locking strategies used in combination (Section A8.1):

**Pessimistic locking** (`SELECT FOR UPDATE`) for state machine transitions.
Lock acquired → current state validated → intermediate state written →
**lock released** → gateway API called → lock re-acquired → final state
written → lock released. The DB lock is never held during external calls.

**Advisory locking** (`pg_advisory_xact_lock`) for idempotency checks.
Transaction-scoped, auto-released on commit. Prevents microsecond race
conditions between load-balanced server instances.

---

## 7. Financial Data Integrity

All monetary values stored as `BIGINT` in the smallest currency unit
(paise for INR). No `FLOAT`, `DOUBLE`, or `REAL` anywhere in the schema.
See ADR-002 for full justification.

Display conversion happens exclusively at the API response layer.
No division or multiplication of amounts occurs in SQL.

---

## 8. Failure Scenario Coverage

| Scenario                      | Mechanism                         | Section   |
| ----------------------------- | --------------------------------- | --------- |
| FS-01 Gateway timeout         | Circuit breaker + failover < 2s   | A3.3      |
| FS-02 Duplicate webhook       | processed_webhook_events dedup    | A5.4      |
| FS-03 Double submit           | Advisory lock + idempotency key   | A4.1      |
| FS-04 5xx on capture          | Exponential backoff + status poll | A5.5      |
| FS-05 Partial capture         | PARTIALLY_CAPTURED state          | A2.2      |
| FS-06 Webhook before response | State machine rejects duplicate   | A2.1      |
| FS-07 Cascade failure         | Multi-gateway router + CB         | A3.3      |
| FS-08 Refund settled txn      | SETTLED → REFUND_INITIATED valid  | A2.2      |
| FS-09 Concurrent race         | pg_advisory_xact_lock             | A8.2      |
| FS-10 Replay attack           | HMAC verify + event_id dedup      | A5.3/A5.4 |
| FS-11 Missing settlement      | Reconciliation anomaly detection  | A5.5      |
| FS-12 UPI timeout             | AUTH_EXPIRED terminal state       | A2.2      |
| FS-13 Key collision           | (merchant_id, key) composite PK   | A4.2      |
| FS-14 Connection exhaustion   | PgBouncer + short-lived locks     | A8.1      |
| FS-15 State corruption        | InvalidStateTransitionException   | A2.1      |

---

## 9. API Surface

23 endpoints across 6 resource groups. Full specification in
`docs/api-specification.yaml`.

Base path: `/api/v1`  
Authentication: API Key (`X-API-Key` header)  
Idempotency: `Idempotency-Key` header (required on POST endpoints)  
Tracing: `X-Trace-Id` header (generated if absent)

---

## 10. Deliberate Errors Identified

Five technical errors were identified in the project specification.
See `docs/errors-found.md` for full analysis.

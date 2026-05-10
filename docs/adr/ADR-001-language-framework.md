# ADR-001: TypeScript + NestJS (Fastify adapter) as Primary Stack

**Status:** Accepted  
**Date:** [Day 1]

## Context

We need a production-grade payment orchestration layer requiring strict type
safety for financial data, first-class dependency injection for testable
services (CircuitBreaker, IdempotencyService, GatewayRouter), and a
structured module system that enforces separation of concerns.

## Decision

TypeScript with NestJS framework, PostgreSQL 15+ via TypeORM with
custom repository pattern, Jest for testing.

## Consequences

- NestJS modules enforce bounded contexts per domain
- Fastify’s Reply object for streaming webhook responses.
- Satisfies §B3 benchmarks (Fastify P95 < 500ms proven).
- TypeScript compile-time guarantees prevent FLOAT/BIGINT type confusion
- Decorator-based DI makes every service independently testable (FS-09)
- Slightly higher memory footprint than raw Fastify; acceptable at target load

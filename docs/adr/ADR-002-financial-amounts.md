# ADR-002: Store All Amounts as BIGINT in Paise

**Status:** Accepted

## Context

Section A6.2 explicitly warns that FLOAT/DOUBLE causes compounding
rounding errors. This is a "career-ending mistake" per the spec.

## Decision

All monetary values stored as BIGINT representing the smallest currency
unit (paise for INR, cents for USD). No NUMERIC(15,2) — BIGINT is
preferred for performance-critical systems per A6.2.

Conversion rule: ₹2,800.50 → stored as 280050 (BIGINT)
Display layer divides by 100. Never divide in SQL.

## Consequences

- Zero floating-point error accumulation across 100K+ daily transactions
- Integer arithmetic is faster than NUMERIC in PostgreSQL
- Application layer owns the display conversion (single responsibility)
- Partial paise (sub-unit) amounts are impossible — acceptable for INR

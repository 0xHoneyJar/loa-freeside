---
title: "ADR-005: Budget Unit Convention — micro-USD / micro-cents"
trust_tier: operator-authored
read_state: unread
confidence: 0.5
decay_class: reference
last_confirmed: 2026-06-03
operator_signed: self_attested
---

# ADR-005: Budget Unit Convention — micro-USD / micro-cents

**Status**: Accepted
**Date**: 2026-02-11
**Context**: Hounfour Integration — Arrakis x loa-finn Cross-System Bridge (Sprint 1)

## Context

Arrakis and loa-finn use different monetary unit scales:

| System | Unit | Scale | Example ($1.00) |
|--------|------|-------|------------------|
| loa-finn | micro-USD | 1 USD = 1,000,000 | 1,000,000 |
| arrakis | micro-cents | 1 USD = 100,000,000 | 100,000,000 |

The conversion factor is exactly **100** (micro-cents = micro-USD x 100). Cross-system communication requires a reliable, lossless bridge between these representations.

## Decision

1. **All money values use `bigint` end-to-end** — from wire parsing through storage and display. No `number` type is used for money at any layer.

2. **Upward conversion (micro-USD -> micro-cents) is lossless**: multiply by 100. No rounding required.

3. **Downward conversion (micro-cents -> micro-USD) uses floor division**: `microCents / 100n`. This is lossy (truncates up to 99 micro-cents). Downward conversion is permitted only for display/reporting, **never** for accounting writes.

4. **Safety caps**: micro-USD capped at 100,000,000,000 ($100K per report). micro-cents capped at 10,000,000,000,000. Values exceeding caps throw `RangeError`.

5. **Negative values are rejected** at the conversion boundary with `RangeError`.

6. **Wire parsing** (`parseMicroUnit`) accepts `bigint`, non-negative integer `number`, or digit-only `string`. All other types throw `TypeError`.

## Consequences

- **Positive**: Zero precision loss on the hot path (inbound reports always convert upward). No floating-point bugs. Overflow impossible within `bigint` range with explicit caps.

- **Negative**: `bigint` requires explicit handling in JSON serialization (JSON.stringify cannot serialize bigint natively). PostgreSQL `BIGINT` column type required for `cost_cents` (Sprint 2 migration).

- **Trade-off**: Floor division on downward conversion loses up to 99 micro-cents per report. At $100K cap this is negligible ($0.00000099 max loss per conversion). Acceptable for display-only use.

## Implementation

- `packages/adapters/agent/budget-unit-bridge.ts` — pure conversion functions
- `themes/sietch/tests/unit/budget-unit-bridge.test.ts` — property-based tests (1000 iterations per property)

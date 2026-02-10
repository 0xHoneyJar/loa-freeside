# ADR-003: Two-Counter Budget Model (Reserved + Committed)

**Status**: Accepted
**Date**: 2026-02-09
**Context**: Spice Gate Phase 4 — Budget Manager

## Context

Agent invocations have unpredictable costs (depends on model, token count, streaming duration). The budget system must prevent overspend while allowing concurrent requests.

## Decision

Use a two-counter model: **reserved** (optimistic hold) and **committed** (actual spend), both in Redis with PostgreSQL as the source of truth for reconciliation.

## Rationale

**The problem with a single counter:**
A single "spent" counter can only be updated after the agent response completes. During the 5-30 second response time, other requests don't know about in-flight spend. This allows N concurrent requests to each pass the budget check, potentially spending N × budget.

**How two counters solve this:**
1. **Reserve**: Before forwarding to loa-finn, atomically increment `reserved` by estimated cost. If `committed + reserved > budget`, reject immediately.
2. **Forward**: Send request to loa-finn, stream response.
3. **Finalize**: After response, atomically: decrement `reserved` by estimate, increment `committed` by actual cost.
4. **Abort**: If request fails, decrement `reserved` (no commit).

This ensures concurrent requests see each other's reservations and the budget check accounts for in-flight spend.

**Why Redis + PostgreSQL?**
- Redis: Hot path (every request). Sub-millisecond reads. Atomic Lua operations.
- PostgreSQL: Source of truth. Stores `agent_usage_log` with full audit trail (model, tokens, cost, timestamp).
- Drift monitor (ADR-004) reconciles the two every 15 minutes.

**Trade-offs accepted:**
- Reservations can leak if a process crashes between reserve and finalize. The budget reaper job (every 5 minutes) cleans up expired reservations using TTL markers.
- Redis and PG will drift due to propagation delay. The drift monitor handles this (see ADR-004).
- Estimated cost may differ from actual cost, but the finalize step corrects for this.

## Consequences

- Budget check is O(1) Redis read (fast path for most requests).
- Reservation TTL prevents leaked reservations from permanently consuming budget.
- Stream reconciliation worker handles partial responses (cost known only after stream ends).
- Monthly budget reset is a Redis key rotation (`{communityId}:{month}` key pattern).
- Overspend is bounded by: max concurrent requests × max single-request cost estimate.

## Alternatives Considered

| Alternative | Rejected Because |
|---|---|
| Single counter (post-hoc) | No protection against concurrent overspend during in-flight requests |
| Pessimistic locking | Serializes all requests per community; unacceptable latency under concurrency |
| Token bucket (rate-based) | Budget is dollar-based, not rate-based; token buckets don't map to cost limits |
| PostgreSQL-only | ~5ms per budget check vs ~0.1ms Redis; on hot path for every request |

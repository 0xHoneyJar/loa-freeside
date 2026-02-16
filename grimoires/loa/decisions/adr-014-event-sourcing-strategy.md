# ADR-014: Event Sourcing Strategy — Incremental Adoption

**Status:** Accepted
**Date:** 2026-02-16
**Decision Makers:** Engineering Team

## Context

The billing system is *almost* event-sourced already:
- `credit_ledger` is append-only (double-entry bookkeeping)
- `referral_attribution_log` records every attribution attempt
- `payout_requests` track state transitions
- `revenue_rule_audit_log` / `fraud_rule_audit_log` record governance changes

Unifying these into a single event stream enables temporal queries (reconstruct state at any point in time), replay/audit, and future cross-system projection.

However, a big-bang migration from tables to events is high-risk and unnecessary. The existing tables are well-tested and authoritative.

## Decision

**Incremental dual-write adoption.** No big-bang migration.

### Phase 1: Foundation (Sprint 18)

1. Define typed event vocabulary (`protocol/billing-events.ts`)
2. Create append-only `billing_events` table with triggers blocking UPDATE/DELETE
3. Build `BillingEventEmitter` that accepts the caller's transaction handle
4. Services opt-in to dual-write: primary write + event emission in same transaction
5. Proof-of-concept temporal query: reconstruct balance from events

### Phase 2: Full Dual-Write (Future)

- All monetary services emit events alongside primary writes
- Events become a complete audit trail
- Temporal queries available for any point in time

### Phase 3: CQRS (Future, If Needed)

- Read models projected from events (eventually)
- Existing tables become projections of the event stream
- Events become the primary authority

### Why Not Full Event Sourcing Now

| Approach | Pros | Cons | Verdict |
|----------|------|------|---------|
| **Full event sourcing** | Pure audit trail, replay capability | Requires rewriting all services, high risk, complex error handling | Rejected |
| **Incremental dual-write** | Low risk, progressive validation, existing tests untouched | Temporary duplication, events lag behind tables initially | **Chosen** |
| **No events** | Simplest | Missing temporal queries, audit gaps, no path to CQRS | Rejected |

## Event Design Principles

1. **Causation chain**: Every event includes `causation_id` linking to the operation that triggered it. Enables "why did this happen?" debugging
2. **Aggregate-scoped**: Events belong to an aggregate (account, earning, payout). No cross-aggregate events
3. **Payload as value**: Event payloads are self-contained — include all data needed to understand the event without joining other tables
4. **BigInt as string**: Monetary values serialized as strings in JSON payload to preserve BigInt precision
5. **SQLite timestamp format**: Events use `YYYY-MM-DD HH:MM:SS` (ADR-013) for consistent ordering

## Transaction Propagation Pattern

```typescript
// Service passes its transaction context to the emitter
db.transaction(() => {
  // 1. Primary write
  db.prepare('INSERT INTO referrer_earnings ...').run(...);

  // 2. Event emission (same transaction)
  emitter.emit({
    type: 'EarningRecorded',
    aggregateId: earningId,
    aggregateType: 'earning',
    timestamp: sqliteTimestamp(),
    causationId: chargeId,
    payload: { ... },
  }, { db });
})();
// If transaction rolls back, both writes are rolled back atomically
```

## Consequences

- Existing tables remain the primary authority during dual-write phase
- `billing_events` is a derived append-only log (see Data Authority Map)
- Events can be used for temporal queries (proof of concept in Task 18.4)
- No changes to existing service interfaces or test suites
- Future CQRS migration has a clear, low-risk path

## References

- Event vocabulary: `protocol/billing-events.ts`
- Emitter: `BillingEventEmitter.ts`
- Migration: `049_billing_events.ts`
- Data Authority Map: `grimoires/loa/decisions/data-authority-map.md` (billing_events row)

# ADR-004: Adaptive Budget Drift Thresholds

**Status**: Accepted
**Date**: 2026-02-10
**Context**: Spice Gate Phase 4 — Budget Drift Monitor (Sprint 14)

## Context

The drift monitor compares Redis committed counters against PostgreSQL `agent_usage_log` every 15 minutes. A static threshold of $0.50 (500,000 micro-cents) works well for low-throughput communities but produces false positives for high-throughput ones.

At 1000 requests/minute with average cost $0.05 per request, the expected propagation lag drift is:

```
1000 req/min × (30s / 60s) × 5000 μ¢ = 2,500,000 μ¢ ($2.50)
```

This far exceeds the $0.50 static threshold, triggering alarms that are actually normal operation.

## Decision

Use an adaptive threshold formula that scales with community throughput:

```
adaptive = clamp(static + ratePerMinute × (lagSeconds / 60) × avgCost, floor, ceiling)
```

Where:
- `static` = 500,000 μ¢ ($0.50) — the floor
- `lagSeconds` = 30 — estimated Redis→PG propagation delay
- `ratePerMinute` — trailing 60-minute average request rate
- `avgCost` — trailing 60-minute average cost per request in micro-cents
- `ceiling` = 100,000,000 μ¢ ($100.00) — absolute maximum

## Rationale

**Why not just increase the static threshold?**
A higher static threshold would reduce false positives for high-throughput communities but would miss genuine drift for low-throughput ones. A community doing 1 req/hour should alarm at $0.50 drift; a community doing 1000 req/min should not.

**Why 30-second lag factor?**
Measured propagation delay from Redis write → PG insert via stream reconciliation worker. 30 seconds is the p95 observed delay, providing a conservative estimate.

**Why 60-minute trailing window?**
- Must be longer than the 15-minute drift check interval to avoid feedback loops.
- 60 minutes provides stable throughput estimates without being too sensitive to burst traffic.
- Avoids the scenario where a burst → high threshold → drift during burst goes undetected → burst ends → threshold drops → stale drift triggers alarm.

**Why a $100 ceiling?**
Prevents pathological inputs from disabling drift detection entirely. Even at extreme throughput, drift exceeding $100 should be investigated.

**Hard overspend rule:**
When PG > Redis (with Redis key present), this is never lag — it means actual spend exceeded what Redis tracked. This fires `BUDGET_HARD_OVERSPEND` unconditionally regardless of adaptive threshold.

**Redis key missing (F-2 refinement):**
When Redis returns null but PG has data, this is a distinct failure mode (key expiry, Redis restart, eviction) from genuine overspend. Fires `BUDGET_REDIS_KEY_MISSING` instead, enabling a different runbook response.

## Consequences

- Zero false positives at simulated 1000 req/min with 30s propagation lag.
- Anomalous drift (2x expected) still triggers alarm correctly.
- Low-throughput communities (<10 req/min) effectively use the static threshold.
- Three alarm types: `BUDGET_ACCOUNTING_DRIFT`, `BUDGET_HARD_OVERSPEND`, `BUDGET_REDIS_KEY_MISSING`.
- Monitoring dashboards should group by alarm type for appropriate runbook routing.
- Property tests verify monotonicity (more throughput never decreases threshold) and bounds.

## Alternatives Considered

| Alternative | Rejected Because |
|---|---|
| Higher static threshold | Misses real drift for low-throughput communities |
| Per-community configured thresholds | Operational burden; doesn't adapt to changing traffic patterns |
| Percentile-based threshold | Requires historical drift distribution data; cold start problem |
| Disable drift monitor for high-throughput | Defeats the purpose — high-throughput communities have more money at risk |

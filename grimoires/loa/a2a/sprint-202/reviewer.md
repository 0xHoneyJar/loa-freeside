# Sprint 4 (Global 202): Production Monitoring & Hardening — Implementation Report

## Summary

Sprint 4 adds production-grade observability and operational readiness for the Hounfour Phase 4 agent gateway. CloudWatch EMF metrics, dashboards, alarms, runbooks, and feature flag enablement.

## Tasks Completed

| Task | Title | Bead | Status |
|------|-------|------|--------|
| 4.1 | CloudWatch EMF Integration | arrakis-1zk | CLOSED |
| 4.2 | CloudWatch Dashboard + Alarms | arrakis-2gp | CLOSED |
| 4.3 | Operational Runbooks | arrakis-263 | CLOSED |
| 4.4 | Graduate Pool Claims to Reject Mode | arrakis-3mp | CLOSED |
| 4.5 | Feature Flag Enablement | arrakis-2sp | CLOSED |

## Key Files Created/Modified

### New Files
| File | Purpose |
|------|---------|
| `packages/adapters/agent/agent-metrics.ts` | EMF metrics emitter (8 methods, Arrakis/AgentGateway namespace) |
| `tests/unit/agent-metrics.test.ts` | 15 unit tests for all metric types |
| `infrastructure/terraform/agent-monitoring.tf` | 11-widget dashboard + 6 CloudWatch alarms |
| `grimoires/loa/deployment/agent-circuit-breaker-open.md` | Circuit breaker runbook |
| `grimoires/loa/deployment/agent-budget-drift-high.md` | Budget drift runbook |
| `grimoires/loa/deployment/agent-redis-degraded.md` | Redis degradation runbook |
| `scripts/pool-claim-preflight.sh` | Preflight check for pool claim graduation |

### Modified Files
| File | Changes |
|------|---------|
| `packages/adapters/agent/config.ts` | poolClaimEnforcement default: `warn` → `reject` |
| `infrastructure/terraform/variables.tf` | Added `ensemble_enabled`, `sns_alarm_topic_arn` |
| `infrastructure/terraform/ecs.tf` | Wired ENSEMBLE_ENABLED + BYOK_ENABLED env vars |
| `infrastructure/terraform/environments/staging/terraform.tfvars` | Enabled agent, ensemble, BYOK flags |

## Metrics Emitted (agent-metrics.ts)

| Method | Metric | Dimension | Unit |
|--------|--------|-----------|------|
| `emitRequestComplete` | RequestLatency, RequestCount, Error5xxCount, RateLimitCount | feature | ms, Count |
| `emitBudgetFinalize` | CommittedReportedDelta | accounting_mode | Count |
| `emitPoolClaimEvent` | PoolClaimMismatch, PoolClaimReject | pool_id | Count |
| `emitCircuitBreakerState` | CircuitBreakerState | component | None |
| `emitRedisLatency` | RedisLatency | operation | ms |
| `emitRateLimitHit` | RateLimitHit | dimension | Count |
| `emitFinalizeFailure` | FinalizeFailure | — | Count |
| `emitReservationAge` | ReservationAge | — | ms |

## CloudWatch Alarms

| Alarm | Threshold | Period |
|-------|-----------|--------|
| AgentError5xxRate | > 5% | 5 min |
| AgentP99Latency | > 10,000ms | 5 min |
| CircuitBreakerOpen | > 0 | 1 min |
| BudgetDriftHigh | > 1000 | 15 min |
| StaleReservations | > 100,000ms | 5 min |
| FinalizeFailures | > 0 | 5 min |

## Test Results

- 15 agent metrics unit tests: ALL PASS
- 25 agent unit tests (incl. lifecycle): ALL PASS
- All 43 BYOK + metrics tests: ALL PASS

## Pool Claim Graduation

- Default enforcement changed from `warn` to `reject` (config.ts)
- Preflight script (`pool-claim-preflight.sh`) checks CloudWatch for zero mismatches before deployment
- Override available via `AGENT_POOL_CLAIM_ENFORCEMENT=warn` env var

## Feature Flags (Staging)

```hcl
agent_enabled    = "true"    # Baseline model routing
ensemble_enabled = "true"    # Multi-model orchestration
byok_enabled     = true      # Bring-your-own-key with Network Firewall
```

# Agent Gateway — Capability Mesh (Cycle 019)

> Demand-loaded reference (demoted from CLAUDE.md 2026-06-04 to cut always-loaded prefix). Read when working on `packages/adapters/agent`.

Per-model ensemble accounting, contract protocol negotiation, and fleet-wide observability.

## Per-Model Accounting

Ensemble requests produce a `model_breakdown` array with per-model cost attribution:

```typescript
import { computeEnsembleAccounting } from '@freeside/adapters/agent';

const result = computeEnsembleAccounting(strategy, invocationResults);
// result.model_breakdown — per-model costs
// result.platform_cost_micro — platform budget only
// result.byok_cost_micro — BYOK (no budget charge)
// result.savings_micro — unused reservation capacity
```

## Provider Policy Configuration

Pool-to-provider routing is configurable via environment variable:

```bash
# Override default pool→provider mapping (JSON)
POOL_PROVIDER_HINTS='{"cheap":"openai","reasoning":"anthropic","architect":"anthropic"}'
```

## Capability Audit Events

Structured audit events emitted for every capability exercise:

| Event Type | When | Key Fields |
|-----------|------|------------|
| `pool_access` | Standard request | pool_id, access_level |
| `byok_usage` | BYOK key used | byok_provider |
| `ensemble_invocation` | Ensemble request | model_breakdown, ensemble_strategy |

## Key Files (Agent Gateway)

| File | Purpose |
|------|---------|
| `packages/adapters/agent/ensemble-accounting.ts` | Per-model cost decomposition |
| `packages/adapters/agent/request-lifecycle.ts` | State machine (RECEIVED→FINALIZED) |
| `packages/adapters/agent/redis-circuit-breaker.ts` | Fleet-wide Redis circuit breaker |
| `packages/adapters/agent/token-estimator.ts` | Calibrated token estimation |
| `packages/adapters/agent/capability-audit.ts` | Structured audit event emitter |
| `packages/adapters/agent/byok-proxy-handler.ts` | BYOK egress with key isolation |
| `packages/contracts/src/compatibility.ts` | Contract version negotiation |
| `infrastructure/terraform/agent-monitoring.tf` | CloudWatch dashboard + alarms |

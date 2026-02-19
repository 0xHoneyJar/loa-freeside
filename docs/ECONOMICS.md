# Economic Primitives

<!-- cite: loa-freeside:packages/adapters/agent/budget-manager.ts -->
<!-- cite: loa-freeside:packages/adapters/agent/lua/budget-reserve.lua -->
<!-- cite: loa-freeside:packages/adapters/agent/lua/budget-finalize.lua -->
<!-- cite: loa-freeside:packages/adapters/agent/ensemble-accounting.ts -->
<!-- cite: loa-freeside:themes/sietch/src/packages/core/protocol/arrakis-conservation.ts -->
<!-- cite: loa-freeside:themes/sietch/src/services/TierService.ts -->
<!-- cite: loa-freeside:packages/adapters/agent/pool-mapping.ts -->

> Version: v1.0.0

This document describes the economic model that underpins the Loa platform. Every claim is grounded in source code citations. The economic primitives — BigInt micro-USD precision, two-counter atomic reservation, conservation properties enforced via Lua scripts — are what make this an economic *protocol*, not just a billing system.

---

## Overview

The Loa platform is a multi-model AI inference marketplace with three fundamental requirements:

1. **No precision loss** — costs measured in integer micro-USD (1 cent = 10,000 micro-USD)
2. **No double-charge** — idempotent reservation and finalization via Redis Lua atomicity
3. **Fail-closed reservation** — if Redis is unreachable, deny the request (don't spend what you can't track)

These guarantees are enforced at the Lua script level, below the TypeScript application boundary. The economic model has four layers: budget accounting, lot lifecycle, conservation invariants, and capability tiers.

---

## Budget Accounting Model

<!-- cite: loa-freeside:packages/adapters/agent/budget-manager.ts#L1-L15 -->

The budget system uses a **two-counter model** stored in Redis:

| Counter | Redis Key Pattern | Purpose |
|---------|-------------------|---------|
| `committed` | `agent:budget:committed:{community}:{month}` | Finalized costs (actual spend) |
| `reserved` | `agent:budget:reserved:{community}:{month}` | Pending reservation holds |

**Effective spend** = `committed + reserved`. A request is denied when `effective_spend + estimated_cost > limit`.

### Key Design Decisions

- **Monthly reset**: Budget counters are keyed by `YYYY-MM` (UTC). Keys expire after 35 days for automatic rollover.
- **Integer arithmetic**: All costs stored as integer cents. The `normalizeCostCents()` function rejects NaN/Infinity and rounds up via `Math.ceil()`.
- **Warning threshold**: Lua returns a warning flag when effective spend exceeds 80% of the limit.

### BudgetManager API

<!-- cite: loa-freeside:packages/adapters/agent/budget-manager.ts#L89-L311 -->

| Method | Purpose | Failure Mode |
|--------|---------|--------------|
| `reserve()` | Atomic check-and-reserve via Lua | **Fail-closed**: returns `BUDGET_EXCEEDED` on Redis error |
| `finalize()` | Idempotent move reserved → committed | **Fail-open**: logs error, returns `FINALIZED` (async reconciliation) |
| `cancelReservation()` | Immediate finalize with `actualCost=0` | Same as `finalize()` |
| `reap()` | Clean expired reservations | Returns `{count: 0, totalReclaimed: 0}` on error |
| `estimateCost()` | Pricing table lookup with 2x tool multiplier | Pure function, no failure mode |

### Result Types

<!-- cite: loa-freeside:packages/adapters/agent/budget-manager.ts#L29-L45 -->

**BudgetResult** (from `reserve()`):

| Status | Meaning |
|--------|---------|
| `RESERVED` | Reservation created, remaining budget returned |
| `ALREADY_RESERVED` | Idempotent duplicate — reservation exists |
| `BUDGET_EXCEEDED` | Effective spend + estimated cost > limit |
| `INVALID_INPUT` | Negative cost, NaN, or missing parameters |

**FinalizeResult** (from `finalize()`):

| Status | Meaning |
|--------|---------|
| `FINALIZED` | Normal completion — reserved moved to committed |
| `LATE_FINALIZE` | Reservation already reaped — cost added directly to committed |
| `ALREADY_FINALIZED` | Idempotent duplicate — finalization marker exists |
| `INVALID_INPUT` | Invalid parameters |

---

## Lot Lifecycle

<!-- cite: loa-freeside:packages/adapters/agent/lua/budget-reserve.lua -->
<!-- cite: loa-freeside:packages/adapters/agent/lua/budget-finalize.lua -->

Every AI inference request follows a three-phase lifecycle:

```
reserve() ──→ [request executes] ──→ finalize() ──→ [audit log enqueued]
     │                                    │
     │ (timeout)                          │ (reservation reaped)
     └──→ reap() ──→ reclaim reserved     └──→ LATE_FINALIZE
```

### Worked Example: Complete Request Flow

**Scenario:** Community "guild-42" has a 10,000-cent monthly budget. Current committed = 3,000, reserved = 500.

1. **Reserve**: `estimateCost = 200 cents` for `fast-code` model
   - Effective spend: 3,000 + 500 = 3,500
   - Check: 3,500 + 200 = 3,700 ≤ 10,000 ✓
   - Lua atomically: `INCRBY reserved 200`, stores reservation hash with TTL
   - Returns: `{status: 'RESERVED', remaining: 6300, limit: 10000, warning: false}`

2. **Inference executes** — actual cost = 150 cents (less than estimated)

3. **Finalize**: `actualCost = 150 cents`
   - Lua atomically: reads reservation hash, `DEL` returns 1 (claim won)
   - `DECRBY reserved 200` (original estimate)
   - `INCRBY committed 150` (actual cost)
   - Savings: 200 - 150 = 50 cents returned to available budget
   - Returns: `{status: 'FINALIZED', actualCost: 150}`

4. **Audit log**: Entry enqueued to BullMQ with community, model, tokens, cost, trace

### Failure Modes

| Failure | Behavior | Rationale |
|---------|----------|-----------|
| **Redis unreachable during reserve** | Returns `BUDGET_EXCEEDED` (fail-closed) | Never execute inference without budget tracking |
| **Redis unreachable during finalize** | Returns `FINALIZED` with actual cost (fail-open) | Don't block response delivery; reconciliation catches drift |
| **Reservation expires before finalize** | Reaper reclaims reserved amount; late `finalize()` returns `LATE_FINALIZE` and adds actual cost directly to committed | Prevents reserved counter from growing unbounded |
| **Double finalize** | Returns `ALREADY_FINALIZED` (idempotency marker checked first) | 24-hour finalization marker TTL prevents double-charge |
| **Negative cost input** | Clamped to 0 by both Lua and TypeScript `normalizeCostCents()` | Prevents negative cost injection bypassing budget checks |

### Atomic Claim via DEL

<!-- cite: loa-freeside:packages/adapters/agent/lua/budget-finalize.lua#L45-L49 -->

The finalize and reaper scripts both compete to claim a reservation. The resolution uses Redis `DEL` as an atomic claim signal:

```lua
local estimatedCostRaw = redis.call('HGET', KEYS[3], 'estimated_cost')
local claimed = redis.call('DEL', KEYS[3])
```

Within a single `EVALSHA`, `HGET` + `DEL` is atomic. Between concurrent scripts, only one `DEL` returns 1 for a given key — that script "wins" the right to `DECRBY` the reserved counter. This eliminates race conditions without distributed locks.

---

## Conservation Invariant

<!-- cite: loa-freeside:themes/sietch/src/packages/core/protocol/arrakis-conservation.ts -->

The conservation layer imports 14 canonical properties from `@0xhoneyjar/loa-hounfour/integrity` and adapts them to platform-specific error handling. These properties define what the economic system *promises* — invariants that must hold across all operations.

### Error Codes

<!-- cite: loa-freeside:themes/sietch/src/packages/core/protocol/arrakis-conservation.ts#L25-L31 -->

6 conservation error codes (thrown on violation):

| Code | Invariant | Description |
|------|-----------|-------------|
| `RECEIVABLE_BOUND_EXCEEDED` | I-3 | Receivable amount exceeds allowed bound |
| `BUDGET_OVERSPEND` | I-5 | Committed + reserved exceeds budget limit |
| `TERMINAL_STATE_VIOLATION` | I-8 | Operation on a lot in terminal state |
| `TRANSFER_IMBALANCE` | I-6 | Transfer credits ≠ debits |
| `DEPOSIT_BRIDGE_MISMATCH` | I-7 | On-chain deposit doesn't match platform record |
| `SHADOW_DIVERGENCE` | I-14 | Shadow billing diverges from primary |

### Reconciliation Failure Codes

<!-- cite: loa-freeside:themes/sietch/src/packages/core/protocol/arrakis-conservation.ts#L33-L38 -->

5 reconciliation failure codes (detected by periodic audit):

| Code | Invariant | Scope |
|------|-----------|-------|
| `LOT_CONSERVATION_DRIFT` | I-1 | Per-lot balance drift |
| `ACCOUNT_CONSERVATION_DRIFT` | I-2 | Per-account aggregate drift |
| `PLATFORM_CONSERVATION_DRIFT` | I-4 | Platform-wide balance drift |
| `BUDGET_CONSISTENCY_DRIFT` | I-5 | Budget counter inconsistency |
| `TREASURY_INADEQUATE` | I-13 | Treasury balance below obligations |

### Coverage

loa-hounfour defines 14 canonical conservation properties (I-1 through I-14). Freeside's adapter maps all 14 to its local schema via `fromCanonical()`, but only 10 have explicit error or reconciliation failure codes assigned: I-1, I-2, I-3, I-4, I-5, I-6, I-7, I-8, I-13, I-14. The remaining 4 (I-9, I-10, I-11, I-12) are converted and available via `getCanonicalProperties()` but do not yet trigger specific error handling in the freeside enforcement layer. See `@0xhoneyjar/loa-hounfour/integrity` for the complete canonical property list.

### Universe Scopes

<!-- cite: loa-freeside:themes/sietch/src/packages/core/protocol/arrakis-conservation.ts#L62 -->

Conservation properties operate at four universe scopes:

| Universe | Canonical Mapping | Scope |
|----------|-------------------|-------|
| `per-lot` | `single_lot` | Single transaction lot |
| `per-account` | `account` | Community account aggregate |
| `cross-system` | `bilateral` | Cross-system transfers |
| `platform-wide` | `platform` | Global platform invariants |

### Enforcement Mechanisms

<!-- cite: loa-freeside:themes/sietch/src/packages/core/protocol/arrakis-conservation.ts#L54-L59 -->

| Mechanism | When | Example |
|-----------|------|---------|
| `DB CHECK` | Write-time constraint | Balance ≥ 0 |
| `DB UNIQUE` | Write-time uniqueness | No duplicate lot IDs |
| `Application` | Runtime assertion | Budget check before reservation |
| `Reconciliation-only` | Periodic audit | Treasury adequacy check |

---

## Conviction Scoring → Capability Tiers

<!-- cite: loa-freeside:themes/sietch/src/services/TierService.ts#L25-L35 -->

The platform uses a 9-tier conviction scoring system based on BGT (Berachain Governance Token) holdings. Higher conviction unlocks more capable (and expensive) model pools.

### Tier Thresholds

| Tier | BGT Required | Rank Requirement | Description |
|------|-------------|-----------------|-------------|
| Hajra | 6.9 | — | Journey of seeking — on the path to belonging |
| Ichwan | 69 | — | Brotherhood — first acceptance into community |
| Qanat | 222 | — | Underground water channels — access to hidden depths |
| Sihaya | 420 | — | Desert spring — precious, life-giving |
| Mushtamal | 690 | — | Inner garden — trusted inner space |
| Sayyadina | 888 | — | Fremen priestess rank — spiritual guide |
| Usul | 1,111 | — | Base of the pillar — innermost identity |
| Fedaykin | — | Top 8–69 | Elite warriors — rank overrides BGT |
| Naib | — | Top 1–7 | Tribal leaders — highest rank |

### Rank Precedence

<!-- cite: loa-freeside:themes/sietch/src/services/TierService.ts#L128-L153 -->

Rank-based tiers (Naib, Fedaykin) **always override** BGT-based tiers:

1. If rank 1–7 → **Naib** (regardless of BGT)
2. If rank 8–69 → **Fedaykin** (regardless of BGT)
3. Otherwise → calculate from BGT thresholds (highest matching)

BGT amounts are stored as `bigint` in wei (18 decimals) and never exposed externally. Tier is public; BGT amount is private.

---

## Pool Routing

<!-- cite: loa-freeside:packages/adapters/agent/pool-mapping.ts#L6-L13 -->

5 model pools with tier-aware access:

| Pool | Canonical Source | Default Provider |
|------|-----------------|-----------------|
| `cheap` | loa-hounfour `POOL_IDS` | OpenAI |
| `fast-code` | loa-hounfour `POOL_IDS` | OpenAI |
| `reviewer` | loa-hounfour `POOL_IDS` | OpenAI |
| `reasoning` | loa-hounfour `POOL_IDS` | Anthropic |
| `architect` | loa-hounfour `POOL_IDS` | Anthropic |

### Tier → Pool Access Matrix

<!-- cite: loa-freeside:packages/adapters/agent/pool-mapping.ts#L118-L122 -->

Access levels map to pool capabilities via `TIER_POOL_ACCESS` and `TIER_DEFAULT_POOL` from loa-hounfour:

| Access Level | Default Pool | Allowed Pools |
|-------------|-------------|---------------|
| `free` | Per hounfour config | Limited pool set |
| `pro` | Per hounfour config | Expanded pool set |
| `enterprise` | Per hounfour config | All 5 pools |

Pool IDs are unforgeable capability tokens (Dennis & Van Horn, 1966). Tier routing acts as the capability distribution authority: each access level receives only the pool capabilities it is entitled to.

### `native` Alias Resolution

<!-- cite: loa-freeside:packages/adapters/agent/pool-mapping.ts#L145-L149 -->

The special `native` model alias resolves tier-dependently — it maps to the default pool for the caller's access level. This provides a "give me the best I'm allowed" semantics without exposing pool internals to consumers.

### Pool Claim Validation

<!-- cite: loa-freeside:packages/adapters/agent/pool-mapping.ts#L184-L220 -->

Cross-validation of pool claims prevents confused deputy attacks:
1. `poolId` must be a known pool ID
2. `poolId` must be in the caller's `allowedPools`
3. `allowedPools` must match tier expectations (canonicalized set comparison)

If any check fails, the request falls back to the caller's tier default pool (AC-3.4).

---

## Ensemble Cost Attribution

<!-- cite: loa-freeside:packages/adapters/agent/ensemble-accounting.ts -->

For multi-model ensemble requests (`best_of_n`, `consensus`, `fallback`), costs are decomposed to per-model granularity:

### Accounting Modes

| Mode | Budget Impact | Use Case |
|------|--------------|----------|
| `PLATFORM_BUDGET` | Charged to community budget | Standard platform-hosted inference |
| `BYOK_NO_BUDGET` | Zero budget charge | Community brings their own API key |

### Ensemble Accounting Result

<!-- cite: loa-freeside:packages/adapters/agent/ensemble-accounting.ts#L51-L72 -->

| Field | Description |
|-------|-------------|
| `strategy` | Ensemble strategy (`best_of_n`, `consensus`, `fallback`) |
| `n_requested` / `n_succeeded` / `n_failed` | Model invocation counts |
| `model_breakdown` | Per-model cost, latency, tokens, success/failure |
| `total_cost_micro` | Sum of all succeeded model costs (micro-USD) |
| `platform_cost_micro` | Sum of `PLATFORM_BUDGET` costs only |
| `byok_cost_micro` | Sum of `BYOK_NO_BUDGET` costs only |
| `reserved_cost_micro` | Original reservation amount |
| `savings_micro` | `reserved - total` (unused capacity returned to budget) |

### Hybrid Multiplier

<!-- cite: loa-freeside:packages/adapters/agent/ensemble-accounting.ts#L123-L130 -->

For ensembles mixing BYOK and platform models, only `PLATFORM_BUDGET` models count toward the reservation multiplier. This prevents over-reserving budget for models that won't charge against it.

---

## Model Pricing

<!-- cite: loa-freeside:packages/adapters/agent/budget-manager.ts#L54-L60 -->

Default pricing table (cost per 1K tokens in cents):

| Pool | Input (¢/1K) | Output (¢/1K) | Source |
|------|-------------|--------------|--------|
| `cheap` | 0.015 | 0.06 | Claude 3.5 Haiku |
| `fast-code` | 0.08 | 0.24 | Claude 3.5 Sonnet |
| `reviewer` | 0.15 | 0.60 | Claude 3.5 Sonnet |
| `reasoning` | 1.5 | 6.0 | Claude 3 Opus |
| `native` | 0.3 | 1.2 | Tier-resolved default |

**Note:** The Source column shows the model used to calibrate each pool's default pricing. These are pool pricing tiers, not fixed model bindings — the pool ID (not the model name) is the stable identifier. Actual model assignments are configured per-deployment via `BudgetConfigProvider.getModelPricing()` and may differ from these defaults.

**Tool multiplier**: Requests with tools get a 2x cost estimate (higher token usage from tool descriptions).

**Runtime override**: `BudgetConfigProvider.getModelPricing()` can override these defaults via Redis cache. Pricing updates propagate through the Redis cache layer without redeployment.

---

## Guarantees

The economic system makes three explicit guarantees:

1. **No precision loss**: All monetary values are integer cents (or micro-USD for ensemble). `normalizeCostCents()` rejects NaN/Infinity, rounds up via `Math.ceil()`, and clamps to ≥ 0.

2. **No double-charge**: Finalization is idempotent via a 24-hour marker key (`agent:budget:finalized:{...}`). The `ALREADY_FINALIZED` check runs before any counter mutation.

3. **Fail-closed reservation**: Redis errors during `reserve()` return `BUDGET_EXCEEDED`. The platform never executes inference it cannot account for. (Finalization is fail-open to avoid blocking response delivery — drift is caught by reconciliation.)

---

## Related Documentation

- [API-REFERENCE.md](API-REFERENCE.md) — HTTP endpoints for agent invocation (which trigger this economic model)
- [EVENT-PROTOCOL.md](EVENT-PROTOCOL.md) — NATS event protocol (the machine-facing API surface)
- [ECOSYSTEM.md](ECOSYSTEM.md) — How Freeside fits into the 5-repo Loa protocol
- [INFRASTRUCTURE.md](INFRASTRUCTURE.md) — AWS deployment topology where these systems run

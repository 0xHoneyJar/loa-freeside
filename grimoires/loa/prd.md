# PRD: The Ostrom Protocol — Economic Memory, Velocity, Event Sourcing & Governance

**Version:** 1.2.0
**Date:** 2026-02-24
**Status:** Active
**Cycle:** cycle-038
**Predecessor:** cycle-037 "Proof of Economic Life" (archived — Bridgebuilder converged at 14→3→0, PR #90)
**Source:** Bridgebuilder Architectural Meditation [Part IV: The Creative Edge](https://github.com/0xHoneyJar/loa-freeside/pull/90), [Ostrom Analysis](https://github.com/0xHoneyJar/loa-freeside/pull/90#issuecomment-3942458906)
**Ecosystem Context:** [Launch Readiness RFC](https://github.com/0xHoneyJar/loa-finn/issues/66), [Permissionscape RFC](https://github.com/0xHoneyJar/loa-finn/issues/31), [Billing RFC](https://github.com/0xHoneyJar/loa-freeside/issues/62), [Web4 Manifesto](https://meow.bio/web4.html)

---

## 0. The Question Behind the Question

The request is "implement the four Creative Edge proposals from the Bridgebuilder review." The real question is: **should the economic loop become conscious of itself?**

Cycle-037 proved the economic loop turns. Conservation invariants hold. Three payment sources work. Reconciliation recovers missed webhooks. The code works. But the code doesn't *know what it's doing*. It tracks amounts but not purposes. It measures balances but not velocity. It records events but can't replay them. It enforces limits but doesn't let communities set them.

The Bridgebuilder review found that the architecture unconsciously implements Elinor Ostrom's principles for managing commons — the same framework that won the 2009 Nobel in Economics. Community-scoped budgets as defined boundaries. Conservation invariants as social contracts. Graduated sanctions via circuit breakers. Reconciliation as conflict resolution. These patterns are already in the code. They are not named. They are not deliberate. They are not exposed to the communities they serve.

This cycle makes the unconscious conscious. It adds four capabilities that transform the economic loop from a billing mechanism into an economic protocol:

1. **Economic Memory** — Lots remember what they funded, not just how much
2. **Economic Velocity** — The system predicts when communities will exhaust credits
3. **Event Sourcing** — The append-only ledger becomes a replayable history
4. **Governance Layer** — Communities govern their own economic policies

> "The conservation invariants aren't just accounting rules — they're the social contract that lets a community say: we created 10,000 credits, and we know exactly where every credit went." — Bridgebuilder, PR #90

The deeper insight: when you build an economic system for communities rather than individuals, you inevitably rediscover Ostrom. The question is whether you discover her *consciously* and encode her principles *deliberately*, or whether you stumble into them and encode them *accidentally*. Right now, the code stumbles into Ostrom. This cycle stumbles *on purpose*.

---

## 1. Problem Statement

### What Exists (Cycle-037 Delivery)

| Component | Status | Evidence |
|-----------|--------|----------|
| Conservation Guard | Production-ready | BigInt-pure arithmetic, monotonic fencing, 5 invariants (I-1…I-5) |
| Credit Lot Ledger | Production-ready | Double-entry append-only, earliest-expiry-first debit, multi-lot split |
| NOWPayments | Production-ready | HMAC-SHA512 webhook, idempotent mint, Redis budget adjustment |
| x402 Settlement | Production-ready | Conservative-quote-settle, transactional nonce, credit-back |
| Reconciliation Sweep | Production-ready | Cursor-based, Redis-independent fallback, 5-min EventBridge schedule |
| Feature Flags | In place | `FEATURE_BILLING_ENABLED`, `FEATURE_X402_ENABLED` |
| Observability | In place | CloudWatch EMF metrics for all economic operations |

### What's Missing (The Four Gaps)

| Gap | Current State | Impact |
|-----|--------------|--------|
| **G-1: Economic Memory** | Lots track `source` and `amount_micro` but not what was purchased | Communities can't answer "what did we spend our money on?" — the most basic economic question |
| **G-2: Economic Velocity** | Conservation guard checks snapshots at time T | No predictive capability — communities discover they're out of credits when a request fails, not before |
| **G-3: Event Sourcing** | Lot entries are append-only but lack formal event semantics | Can't replay history, branch for what-if, debug conservation violations, or build cross-community models |
| **G-4: Governance Layer** | Budget limits are admin-set numbers | Communities can't govern their own economics — the Ostrom principle most conspicuously absent |

### The Ostrom Gap

Elinor Ostrom identified 8 principles for successful commons governance. Cycle-037 implements 6 of them unconsciously. This cycle makes them explicit and adds the 2 that are missing:

| Ostrom Principle | Cycle-037 Status | Cycle-038 Action |
|-----------------|------------------|------------------|
| 1. Clearly defined boundaries | `community_id` as tenant key | No change needed |
| 2. Proportional equivalence | Credit lots: what you fund is what you consume | **G-1**: Add purpose tracking — proportionality becomes visible |
| 3. Collective-choice arrangements | Admin-set limits only | **G-4**: Governance layer — communities set their own policies |
| 4. Monitoring | Conservation guard + CloudWatch EMF | **G-2**: Add velocity — monitoring becomes predictive |
| 5. Graduated sanctions | Warning → Critical → Circuit breaker | No change needed |
| 6. Conflict resolution | Reconciliation sweep | No change needed |
| 7. Minimal recognition of rights to organize | Feature flags for adoption pace | **G-4**: Governance layer — communities adopt economic features with agency |
| 8. Nested enterprises | Per-community pools within platform | **G-3**: Event sourcing — cross-community modeling becomes possible |

---

## 2. Goals & Success Metrics

| ID | Goal | Metric | Measurement |
|----|------|--------|-------------|
| G-1 | **Economic Memory**: Lots track what they funded | 100% of new debit lot_entries have `purpose` != 'unclassified' | Query: `SELECT COUNT(*) FROM lot_entries WHERE entry_type = 'debit' AND purpose = 'unclassified' AND created_at > migration_date` = 0 |
| G-2 | **Economic Velocity**: Predictive credit exhaustion | Velocity alerts fire ≥24h before actual exhaustion in test scenarios | E2E test with controlled burn rate validates prediction accuracy |
| G-3 | **Event Sourcing**: Replayable economic history | Community economic state reconstructable from lot_entries alone | Replay test: `rebuild_state(community_id)` matches `lot_balances` view within 1 micro |
| G-4 | **Governance Layer**: Community-governed economic policies | Communities can set budget limits, pool priorities, and spending alerts via governance API | E2E test: governance proposal → approval → policy change → enforcement |

### Non-Goals (Explicit)

| Non-Goal | Rationale |
|----------|-----------|
| User-facing dashboard UI | This cycle builds the data layer; UI is a separate cycle |
| On-chain governance (DAO voting) | Start with off-chain governance via Arrakis conviction scoring; on-chain is future |
| Cross-community credit transfer | Requires bilateral governance agreement — depends on G-4 maturity |
| Real-time streaming of economic events | WebSocket/SSE layer for economic events is future (depends on G-3 event log) |

---

## 3. User & Stakeholder Context

### Primary Persona: Community Operator

A community operator manages a Discord/Telegram community that uses THJ's AI agents. They fund agents via NOWPayments or x402, configure which models are available via pool routing, and monitor usage. Today they see a balance. Tomorrow they should see:
- What their credits funded (inference vs. tool use vs. storage)
- How fast credits are being consumed (and when they'll run out)
- Full economic history from genesis (who spent what, when, why)
- The ability to set their own economic policies (limits, priorities, alerts)

### Secondary Persona: Platform Operator (THJ Team)

The platform operator needs cross-community economic intelligence: which communities are growing? Which are about to churn (credits exhausting with no replenishment)? What's the aggregate revenue velocity? Event sourcing enables this analysis without building separate analytics pipelines.

### Tertiary Persona: AI Agent (Future)

In the Conway-divergent architecture (THJ = communitarian, Conway = sovereign), agents are servants of community governance. The governance layer defines what agents can do economically. An agent that needs more tokens for a complex task should be able to request a budget increase *from the community governance process*, not from an admin.

---

## 4. Functional Requirements

### F-1: Purpose Field on Credit Lots (Economic Memory)

**What**: Add a constrained `purpose` type to `lot_entries` that classifies what the credit funded. Purpose is the **source of truth on lot_entries** — it is populated at debit time from the pool_id → purpose mapping. The `usage_events` table does NOT carry its own purpose field; purpose is derived from lot_entries when needed for cross-referencing.

**Purpose Values** (Postgres ENUM — extensible via ALTER TYPE ADD VALUE):
- `inference` — LLM completion (tokens in + tokens out)
- `tool_use` — Tool execution (function calls, API integrations)
- `embedding` — Embedding generation
- `image_gen` — Image generation
- `storage` — Persistent storage consumption
- `governance` — Governance operations (voting, proposal creation)
- `unclassified` — Legacy entries or entries where purpose couldn't be determined

**Schema Change**:
```sql
-- Migration: Create purpose enum type
CREATE TYPE economic_purpose AS ENUM (
  'inference', 'tool_use', 'embedding', 'image_gen',
  'storage', 'governance', 'unclassified'
);

-- Add purpose to lot_entries with constrained type
ALTER TABLE lot_entries ADD COLUMN purpose economic_purpose NOT NULL DEFAULT 'unclassified';

-- Create purpose breakdown view
CREATE VIEW community_purpose_breakdown AS
SELECT
  community_id,
  purpose,
  SUM(amount_micro) FILTER (WHERE entry_type = 'debit') AS total_spent_micro,
  COUNT(*) FILTER (WHERE entry_type = 'debit') AS operation_count,
  date_trunc('day', created_at) AS day
FROM lot_entries
GROUP BY community_id, purpose, date_trunc('day', created_at);
```

**Pool-to-Purpose Mapping** (configuration, not code):
```typescript
const POOL_PURPOSE_MAP: Record<string, EconomicPurpose> = {
  cheap: 'inference',
  'fast-code': 'inference',
  reasoning: 'inference',
  architect: 'inference',
  reviewer: 'inference',
  embedding: 'embedding',
  image: 'image_gen',
  tool: 'tool_use',
};
// Unknown pool_id → 'unclassified' (never reject, always classify)
```

**Purpose Classification Resilience** (SKP-001 — Flatline BLOCKER, accepted):
The static `POOL_PURPOSE_MAP` is a known simplification. Mitigations:
- **Runtime observability**: CloudWatch metric `purpose_unclassified_rate` tracks the percentage of new debits mapped to `unclassified`. Alert if >5% over any 1h window — indicates mapping staleness or new pool without purpose assignment.
- **Multi-purpose pools**: If a pool serves multiple purposes (e.g., a future `multi-modal` pool doing both inference and tool_use), the mapping returns `unclassified` and the metric fires. Resolution: either split the pool or extend the ENUM with a composite purpose. The PRD does NOT attempt to solve multi-purpose classification at debit time — that requires request-level metadata not available in the current debit path.
- **Mapping as configuration, not code**: The `POOL_PURPOSE_MAP` is loaded from environment/config, not hardcoded. New pools can be mapped without code changes. Missing mappings default to `unclassified` (never reject).
- **Retrospective reclassification**: Event replay (F-3) enables bulk reclassification of `unclassified` entries when better mapping data becomes available. Reclassification emits a `governance` event with the old and new purpose for auditability.

**Integration Points**:
- `debitLots()` in credit-lot-service.ts accepts required `purpose` parameter
- Budget finalize Lua script passes pool_id; application layer maps to purpose before calling debitLots
- Reconciliation sweep backfills purpose from pool_id in usage_events metadata where possible
- New debit entries with unknown purpose are classified as `unclassified` (ENUM constraint ensures only valid values)

**FAANG Parallel**: Google's Borg cost attribution tracks purpose per dollar. This enabled the insight that inference cost was growing faster than training cost, leading to TPU development. Purpose tracking turns a bank statement into an economic dashboard.

**Acceptance Criteria**:
- [ ] AC-1.1: `lot_entries` table has `purpose` column of type `economic_purpose` with default 'unclassified'
- [ ] AC-1.2: All new debit entries populate `purpose` from pool_id → purpose mapping; unknown pool_id maps to 'unclassified'
- [ ] AC-1.3: `community_purpose_breakdown` view returns per-community, per-purpose, per-day aggregates
- [ ] AC-1.4: Existing entries remain valid with 'unclassified' purpose (backwards compatible)
- [ ] AC-1.5: Conservation invariants still hold (purpose field is metadata, not accounting)
- [ ] AC-1.6: Invalid purpose values rejected at database level (ENUM constraint test)
- [ ] AC-1.7: Purpose is queryable from lot_entries only — no parallel purpose column on usage_events

### F-2: Economic Velocity Service (Temporal Dimension)

**What**: A service that computes credit consumption rate and predicts exhaustion.

**Core Computation** (BigInt-only — no floating-point in the economic path):
```typescript
interface VelocitySnapshot {
  community_id: string;
  window_hours: number;        // Observation window (default: 24h) — display only
  velocity_micro_per_hour: bigint;  // Average burn rate (integer division: total_micro / hours)
  acceleration_micro_per_hour_sq: bigint;  // Rate of change (second_half_velocity - first_half_velocity)
  balance_remaining_micro: bigint;
  estimated_exhaustion_hours: bigint | null;  // null = velocity ≤ 0; BigInt integer division
  confidence: 'high' | 'medium' | 'low';  // Based on data density in window
  computed_at: Date;
}
```

**Algorithm** (all arithmetic in BigInt — no Math.*, no Number conversion for monetary values):
1. Query `lot_entries` debits in the observation window (default 24h), bucketed into hourly sums (BigInt)
2. Compute velocity via integer division: `velocity = total_debit_micro / window_hours_bigint` (floor division — conservative estimate)
3. Compute acceleration via half-window comparison: split window into first/second half, compute velocity for each half, acceleration = `(v2 - v1) / half_window_hours` (BigInt integer division)
4. Extrapolate exhaustion: `hours_remaining = balance_remaining_micro / velocity_micro_per_hour` (BigInt integer division, conservative floor)
5. Confidence: `high` if ≥12 hourly buckets with data, `medium` if ≥4, `low` if <4

**Fixed-Point Rationale**: Velocity is expressed in micro-USD per hour (BigInt). Since micro-USD is already 10^6 precision, integer division by hours produces sufficient resolution (±1 micro/hour). No fractional slopes or regression coefficients needed — the half-window acceleration comparison achieves the same predictive value as linear regression for the alert use case, without requiring floating-point arithmetic. This mirrors the `usdToMicroSafe()` pattern from cycle-037: stay in integer space, accept floor-division rounding.

**Acceptance Criteria**:
- [ ] AC-2.1: `VelocityService.computeSnapshot(communityId)` returns accurate velocity for controlled test scenarios
- [ ] AC-2.2: Velocity computation handles edge cases: zero usage, single data point, burst followed by silence
- [ ] AC-2.3: Exhaustion prediction within ±10% of actual for linear consumption patterns
- [ ] AC-2.4: CloudWatch metrics emitted for velocity and estimated exhaustion
- [ ] AC-2.5: Alert thresholds trigger SNS notifications at configured levels
- [ ] AC-2.6: **No floating-point arithmetic** in velocity computation code paths (enforced by lint rule or code review checklist)
- [ ] AC-2.7: Velocity values are BigInt throughout — `number` type only used for display-layer `window_hours` and `confidence`

**Alert Thresholds** (configurable per community via governance layer):
- `warning`: Estimated exhaustion within 72 hours
- `critical`: Estimated exhaustion within 24 hours
- `emergency`: Estimated exhaustion within 4 hours

**Integration Points**:
- EventBridge scheduled task (every 15 min) computes velocity for active communities
- CloudWatch EMF metrics: `velocity_micro_per_hour`, `estimated_exhaustion_hours`
- Alert via SNS topic for warning/critical/emergency thresholds
- Velocity data stored in `community_velocity` table for historical trending

**FAANG Parallel**: Netflix's Zuul gateway tracks not just request rate but rate-of-change-of-rate (second derivative). A sudden increase in *acceleration* triggers circuit breakers before the absolute rate becomes problematic. Our velocity service is the economic equivalent.

### F-3: Event Sourcing Formalization (Replayable History)

**What**: Formalize `lot_entries` as the canonical event log with formal event semantics. The canonical model is **posting-level**: each `lot_entries` row is a posting (one side of a double-entry pair). The `correlation_id` groups postings that belong to the same economic operation (e.g., a debit and credit_back from x402 settlement share a correlation_id). There is no separate envelope table — `lot_entries` IS the event log.

**Event Types** (expanding existing `entry_type`):
```typescript
type EconomicEventType =
  | 'credit'       // Lot funded (purchase, grant, seed, x402, transfer_in, tba_deposit)
  | 'debit'        // Credits consumed (inference, tool_use, etc.)
  | 'reserve'      // Credits reserved for pending operation
  | 'release'      // Reserved credits released (operation cancelled)
  | 'expire'       // Lot expired (time-based)
  | 'credit_back'  // Overpayment returned (x402 settlement remainder)
  | 'governance'   // Governance action (limit change, policy update)
```

**Canonical Model — Posting-Level Events**:
```typescript
// Each lot_entries row IS a posting-level event.
// correlation_id groups related postings into an economic operation.
// Example: x402 settlement produces 3 postings with the same correlation_id:
//   1. credit (lot funded from x402 quote)
//   2. debit (actual cost consumed)
//   3. credit_back (remainder returned)
// Example: multi-lot debit produces N postings with the same correlation_id:
//   N debit rows, one per lot touched, all sharing correlation_id + reservation_id

interface EconomicEvent {
  event_id: string;          // UUID (lot_entries.id), globally unique
  event_type: EconomicEventType;  // lot_entries.entry_type
  community_id: string;
  lot_id: string | null;     // null for governance events only
  amount_micro: bigint;
  purpose: EconomicPurpose;  // From F-1 (Postgres ENUM)
  metadata: Record<string, unknown>;  // Event-type-specific data (JSONB)
  causation_id: string | null;  // What caused this event (parent event_id)
  correlation_id: string;    // Groups postings in same operation
  sequence_number: bigint;   // Monotonic per-community sequence (NOT NULL for new rows)
  created_at: Date;
}
```

**Replay Rules** (how event types map to state changes):
```
credit:      lot.balance += amount_micro
debit:       lot.balance -= amount_micro  (across multiple lots if multi-lot split)
reserve:     community.reserved += amount_micro
release:     community.reserved -= amount_micro
expire:      lot.balance = 0, lot.status = 'expired'
credit_back: lot.balance += amount_micro
governance:  community.policy updated (lot_id = null, metadata contains policy change)
```
Replay processes postings in `sequence_number` order per community. Multi-lot splits are N postings with the same `correlation_id` — each posting debits one lot.

**Consumer Safety — Correlation-Aware Aggregation** (SKP-002 — Flatline BLOCKER, accepted):
The posting-level canonical model means a single economic operation (e.g., a multi-lot debit of 500 micro spread across 3 lots) produces N rows. Naive `SUM(amount_micro)` across all postings counts the operation's total correctly (each posting is a distinct debit from a distinct lot), but operation-level aggregation requires grouping by `correlation_id`:
- **Per-lot queries** (e.g., "how much was debited from lot X?"): Use postings directly — no grouping needed, each row is one lot's contribution.
- **Per-operation queries** (e.g., "how many operations happened today?"): Group by `correlation_id` — `COUNT(DISTINCT correlation_id)` gives operation count; `SUM(amount_micro)` within a correlation group gives operation total.
- **Per-community totals** (e.g., "total spend this month"): `SUM(amount_micro) WHERE entry_type = 'debit'` is correct without grouping — each posting is a real debit from a real lot, and the sum of all postings equals the sum of all operations.
- **Dangerous pattern**: `COUNT(*) WHERE entry_type = 'debit'` counts *postings*, not *operations*. Always document which level (posting vs operation) a query targets.

A database view `community_operations` is provided for operation-level queries:
```sql
CREATE VIEW community_operations AS
SELECT
  correlation_id,
  community_id,
  entry_type,
  purpose,
  SUM(amount_micro) AS total_amount_micro,
  COUNT(*) AS posting_count,
  MIN(created_at) AS operation_at,
  MIN(sequence_number) AS first_sequence
FROM lot_entries
GROUP BY correlation_id, community_id, entry_type, purpose;
```

**Replay Capability**:
```typescript
// Rebuild community economic state from postings (lot_entries)
async function replayState(
  communityId: string,
  options?: { upTo?: Date; eventTypes?: EconomicEventType[] }
): Promise<CommunityEconomicState>;

// Compare replayed state to current materialized state (lot_balances view)
async function verifyConsistency(
  communityId: string
): Promise<ConsistencyReport>;
```

**Per-Community Monotonic Sequencing** (concrete design — application-level counter with SELECT FOR UPDATE):
```sql
-- Counter table: one row per community
CREATE TABLE community_event_sequences (
  community_id UUID PRIMARY KEY REFERENCES communities(id),
  next_sequence BIGINT NOT NULL DEFAULT 1
);

-- Allocation: inside the same transaction as INSERT lot_entries
-- BEGIN;
--   SELECT next_sequence FROM community_event_sequences
--     WHERE community_id = $1 FOR UPDATE;
--   UPDATE community_event_sequences
--     SET next_sequence = next_sequence + 1
--     WHERE community_id = $1;
--   INSERT INTO lot_entries (..., sequence_number) VALUES (..., $allocated_seq);
-- COMMIT;
--
-- FOR UPDATE ensures strict ordering even under concurrent debits/reserves.
-- Advisory locks are an alternative but SELECT FOR UPDATE is simpler and proven.
--
-- SEQUENCE GAPS (IMP-002 — Flatline HIGH_CONSENSUS):
-- Transaction rollbacks produce gaps in sequence_number. This is EXPECTED and ACCEPTABLE.
-- Gaps do NOT indicate lost events — they indicate rolled-back transactions.
-- Replay consumers MUST tolerate gaps (process events in sequence order, skip missing numbers).
-- SELECT FOR UPDATE chosen over advisory locks because:
--   1. Lock scope matches transaction scope automatically (no manual release)
--   2. Deadlock detection is built into Postgres (advisory locks require manual timeout)
--   3. Simpler to reason about in code review and incident response
-- Advisory locks MAY be considered if benchmarking reveals hot-row contention at >100 TPS/community.
--
-- CONTENTION MITIGATION (SKP-003 — Flatline BLOCKER, accepted):
-- Under concurrent load, the sequence row becomes a serialization point.
-- Measured impact: lock queue depth ≈ TPS × avg_txn_duration_ms / 1000.
-- At 50 TPS with 10ms txns: queue depth ≈ 0.5 (negligible).
-- At 200 TPS with 10ms txns: queue depth ≈ 2.0 (noticeable p99 latency).
--
-- Tiered mitigation strategy:
--   Tier 1 (default): SELECT FOR UPDATE as specified. Sufficient for ≤100 TPS/community.
--   Tier 2 (config flag): Advisory lock alternative — pg_advisory_xact_lock(community_id_hash).
--     Eliminates row-level lock overhead but requires manual deadlock timeout (SET LOCAL
--     lock_timeout = '500ms'). Migration: feature flag SEQUENCE_LOCK_MODE = 'advisory'.
--   Tier 3 (future): Pre-allocated sequence ranges — allocate N sequence numbers in one lock
--     acquisition, assign from local cache. Reduces lock frequency by N×. Requires gap tolerance
--     (already established in IMP-002).
--
-- Benchmark AC: Measure p99 latency of sequence allocation under 50, 100, 200 concurrent
-- transactions per community. Document results in SDD. Switch to Tier 2 if p99 > 50ms at
-- expected load.
```

**Schema Changes**:
```sql
-- Add event sourcing columns to lot_entries
ALTER TABLE lot_entries ADD COLUMN causation_id UUID;
ALTER TABLE lot_entries ADD COLUMN correlation_id UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE lot_entries ADD COLUMN sequence_number BIGINT;
-- sequence_number is nullable for legacy rows; NOT NULL enforced at application
-- level when FEATURE_EVENT_SOURCING is enabled for a community.

-- Per-community monotonic sequence counter
CREATE TABLE community_event_sequences (
  community_id UUID PRIMARY KEY,
  next_sequence BIGINT NOT NULL DEFAULT 1
);

-- Index for replay queries (covers both legacy and new rows)
CREATE INDEX idx_lot_entries_replay
  ON lot_entries (community_id, sequence_number ASC)
  WHERE sequence_number IS NOT NULL;

-- Index for velocity windowed queries (F-2 integration)
CREATE INDEX idx_lot_entries_velocity
  ON lot_entries (community_id, created_at DESC)
  WHERE entry_type = 'debit';
```

**Legacy Row Backfill Strategy**:
When `FEATURE_EVENT_SOURCING` is enabled for a community, a one-time backfill job assigns sequence numbers to existing rows ordered by `(created_at, id)`. This produces a deterministic ordering for legacy data. After backfill, the `community_event_sequences.next_sequence` is set to `MAX(sequence_number) + 1`. Replay of legacy rows uses the backfilled order.

**Event Log Lifecycle** (IMP-003 — Flatline HIGH_CONSENSUS):
As event logs grow, production systems require lifecycle management:
- **Snapshots**: Periodic materialized snapshots of community economic state (e.g., monthly). Snapshots record `(community_id, snapshot_at, state_json, last_sequence_number)`. Replay can start from the nearest snapshot instead of genesis, reducing replay time from O(all events) to O(events since snapshot).
- **Compaction**: Events older than the retention window (default: 2 years) MAY be compacted into summary records. Compaction preserves aggregate truth (total debits by purpose, total credits by source) while reducing row count. Compaction is a future operation — the schema supports it but this cycle does NOT implement compaction.
- **Archival**: Events beyond the retention window are archived to cold storage (S3) before compaction. Archived events retain full fidelity and can be restored for forensic replay.
- **Retention policy**: Configurable per community via governance (F-4). Default: 2 years hot, unlimited cold archive.

**FAANG Parallel**: This is the trajectory from PostgreSQL-as-database to PostgreSQL-as-event-store. Stripe's billing system went through three architectures before arriving at append-only entries as the atom of truth. Event sourcing gives you what the Venetians didn't have: the ability to ask "what if?" about any past state.

**Acceptance Criteria**:
- [ ] AC-3.1: All new lot_entries include `correlation_id` and `sequence_number` (when `FEATURE_EVENT_SOURCING` enabled)
- [ ] AC-3.2: `replayState(communityId)` reconstructs community economic state matching `lot_balances` view within 1 micro — validated at posting level (per-lot balance reconstruction)
- [ ] AC-3.3: `verifyConsistency(communityId)` detects intentional drift injected in tests
- [ ] AC-3.4: Existing entries without event sourcing fields remain valid (null causation_id, null sequence_number)
- [ ] AC-3.5: Replay performance: ≤500ms for communities with ≤10,000 events (verified via EXPLAIN ANALYZE with RLS-safe query plan)
- [ ] AC-3.6: Conservation invariants verified through replay (cross-validation with I-1 through I-5)
- [ ] AC-3.7: `sequence_number` is strictly monotonically increasing per community even under concurrent debits/reserves (concurrent test with 10 parallel transactions)
- [ ] AC-3.8: Legacy backfill job correctly assigns sequence numbers ordered by `(created_at, id)` and sets `next_sequence` to `MAX + 1`

### F-4: Governance Layer (Community-Governed Economics)

**What**: A governance API that lets communities define their own economic policies.

**Governance Primitives**:

```typescript
interface EconomicPolicy {
  community_id: string;
  policy_type: PolicyType;
  value: PolicyValue;
  proposed_by: string;        // User/agent who proposed
  approved_at: Date | null;   // null = pending proposal
  approval_method: 'conviction' | 'majority' | 'admin';
  effective_from: Date;
  effective_until: Date | null;  // null = no expiry
}

type PolicyType =
  | 'budget_limit'          // Total budget limit (I-1 limit)
  | 'pool_priority'         // Pool access priority ordering
  | 'spending_alert'        // Custom alert thresholds (extends F-2)
  | 'purpose_allocation'    // Target spend distribution by purpose
  | 'auto_replenish'        // Automatic credit replenishment trigger
  | 'ensemble_strategy';    // Preferred ensemble strategy for this community

type ApprovalMethod =
  | 'conviction'    // Arrakis conviction scoring (time-weighted staking)
  | 'majority'      // Simple majority of community members
  | 'admin';        // Single admin approval (legacy, backwards-compatible)
```

**Governance Lifecycle**:
```
Propose → Review (optional conviction period) → Approve/Reject → Enforce → Log
```

**Schema**:
```sql
CREATE TABLE economic_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id UUID NOT NULL,
  policy_type TEXT NOT NULL,
  policy_value JSONB NOT NULL,
  proposed_by UUID NOT NULL,
  proposal_reason TEXT,
  approval_method TEXT NOT NULL DEFAULT 'admin',
  conviction_score NUMERIC,     -- Arrakis conviction score at approval time
  approved_at TIMESTAMPTZ,
  approved_by UUID,
  effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  effective_until TIMESTAMPTZ,
  superseded_by UUID,           -- Newer policy that replaced this one
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS: community_id = app.current_community_id()
ALTER TABLE economic_policies ENABLE ROW LEVEL SECURITY;

-- Index for active policy lookup
CREATE INDEX idx_active_policies
  ON economic_policies (community_id, policy_type)
  WHERE approved_at IS NOT NULL
    AND (effective_until IS NULL OR effective_until > NOW())
    AND superseded_by IS NULL;
```

**Concurrent Policy Resolution** (IMP-004 — Flatline HIGH_CONSENSUS):
When multiple proposals for the same `policy_type` are approved concurrently:
- **Latest-wins**: The policy with the latest `approved_at` timestamp takes precedence
- **Atomic supersession**: Approval transaction atomically sets `superseded_by` on the previously active policy and activates the new one — single transaction, no window of ambiguity
- **Conflict detection**: If two approvals race, the second `UPDATE ... SET superseded_by` will find the row already superseded and raise a conflict error; the application retries with the new current policy
- **Audit trail**: Both the superseding and superseded policies retain full history in `economic_policies` (no deletes, append-only)

**Integration with Conservation Guard**:
- `budget_limit` policies feed into I-1's `limit` value
- Policy changes emit `governance` events in the event log (F-3)
- Conservation guard reads active policies at fence token acquisition time
- Policy transitions are atomic: old policy superseded, new policy effective, event logged — in one transaction

**Limit Decrease Safety** (critical invariant protection):
Budget limit decreases must not violate `I-1: committed + reserved + available = limit`. Enforcement rules:
1. **Hard floor**: `new_limit >= committed + reserved` at enforcement time. If the proposed limit would make `available` negative, the policy enters `pending_enforcement` state.
2. **Pending enforcement**: A pending policy is checked on every subsequent finalize/release. When `committed + reserved` drops below `new_limit` (through natural consumption or reservation expiry), the policy activates automatically.
3. **Platform minimum**: Governance can never set limit below a platform-defined floor (default: `100_000n` micro = $0.10). This prevents governance-as-DoS.
4. **Limit increases**: Always immediately enforceable — they only expand `available`.

```typescript
type PolicyEnforcementState =
  | 'proposed'            // Awaiting approval (initial state)
  | 'active'              // Policy is currently enforced
  | 'pending_enforcement'  // Approved but waiting for usage to drop below new limit
  | 'superseded'          // Replaced by newer policy
  | 'rejected'            // Approval denied
  | 'expired';            // effective_until has passed
```

**Governance State Machine** (SKP-006 — Flatline BLOCKER, accepted):

Valid transitions (all others are illegal and rejected):

```
proposed → active             (approval, limit increase or limit within budget)
proposed → pending_enforcement (approval, limit decrease below committed+reserved)
proposed → rejected           (explicit rejection)
proposed → superseded         (newer proposal for same type approved while this is pending)

active → superseded           (newer policy for same type activated)
active → expired              (effective_until reached — checked by periodic sweep)

pending_enforcement → active  (usage dropped below new_limit — checked on every finalize/release)
pending_enforcement → superseded (newer policy for same type activated)
pending_enforcement → expired (effective_until reached before activation — policy never took effect)

rejected → (terminal)
superseded → (terminal)
expired → (terminal)
```

**Concurrency rules**:
- Only ONE policy per `(community_id, policy_type)` can be `active` or `pending_enforcement` at a time. Database enforced via partial unique index:
  ```sql
  CREATE UNIQUE INDEX idx_one_active_policy
    ON economic_policies (community_id, policy_type)
    WHERE state IN ('active', 'pending_enforcement');
  ```
- Approving a new policy atomically supersedes the current active/pending policy (IMP-004 concurrent resolution applies).
- `proposed` policies are not unique-constrained — multiple proposals can coexist. Only approval triggers supersession.
- State transitions emit `governance` events in lot_entries (F-3 integration) with `metadata` containing `{from_state, to_state, policy_id}`.
- Background sweep (EventBridge, 5-min interval) checks for `expired` transitions and `pending_enforcement → active` activations.

**Governance Rate Limiting** (IMP-001 — Flatline HIGH_CONSENSUS):
Governance API calls are rate-limited to prevent abuse and governance-as-DoS:
- Per-role quotas: `member` ≤5 proposals/day, `operator` ≤20 approvals/day, `admin` unlimited
- Per-community burst limit: ≤10 governance operations per minute (across all roles)
- Backoff: 429 Too Many Requests with `Retry-After` header; exponential backoff recommended
- Rate limit state stored in Redis with per-community key (`gov:rate:{community_id}:{role}`)
- Rate limits are NOT configurable via governance (prevents self-escalation)

**Conviction Scoring Bridge** (Arrakis integration):
- Community members express preference for economic policies via conviction staking
- Policies that accumulate sufficient conviction score are auto-approved
- Threshold configurable per community (default: 50% of active stake-time)
- Admin override preserved as fallback

**FAANG Parallel**: This is where Ostrom's principles become explicit rather than implicit. The infrastructure for community-governed AI economics is present — credit lots, per-community boundaries, conservation invariants. The governance *mechanism* is what this delivers. As the Web4 manifesto argues: "millions of social monies will coexist, each fiercely competing on memetic appeal, utility, and trustworthiness." Each community's economic boundary becomes a distinct social money with its own embedded governance values.

**Authorization Model**:

The governance API is a privileged control plane. Explicit role-based authorization prevents economic manipulation:

| Role | Can Propose | Can Approve | Can Override | How Determined |
|------|------------|-------------|--------------|----------------|
| `member` | Yes (any policy type) | No | No | Arrakis token-gate (holds community NFT) |
| `operator` | Yes | Yes (non-limit policies) | No | Arrakis role assignment (conviction threshold or admin-granted) |
| `admin` | Yes | Yes (all policy types) | Yes (with audit trail) | Community creator or platform-designated |
| `agent` | No | No | No | Agent identity — agents cannot propose or approve economic policies |

**End-to-end authorization flow**:
1. Request arrives with S2S JWT or session token
2. Community membership verified via Arrakis token-gate (or platform auth)
3. Role resolved: `member` / `operator` / `admin` (from Arrakis or platform role table)
4. Authorization checked: role must have permission for the requested action
5. RLS enforced: `SET LOCAL app.community_id` scopes all queries to the community
6. Audit event emitted: who did what, when, with what role

**Service role safety**: The governance service uses `SET LOCAL app.community_id` inside every transaction (same pattern as credit-lot-service.ts). It does NOT bypass RLS. Cross-tenant access is impossible at the database level.

**Acceptance Criteria**:
- [ ] AC-4.1: `economic_policies` table with RLS enforcement
- [ ] AC-4.2: Governance API: `propose()`, `approve()`, `reject()`, `getActivePolicy()`
- [ ] AC-4.3: `budget_limit` policy changes propagate to conservation guard I-1 limit
- [ ] AC-4.4: Policy changes emit governance events in lot_entries (F-3 integration)
- [ ] AC-4.5: Admin approval method works standalone (no Arrakis dependency for MVP)
- [ ] AC-4.6: Conviction scoring bridge functional when Arrakis is available (graceful degradation when not)
- [ ] AC-4.7: Limit decrease with `new_limit < committed + reserved` enters `pending_enforcement` state (not rejected, not immediately enforced)
- [ ] AC-4.8: Platform minimum limit enforced — governance cannot set limit below `100_000n` micro
- [ ] AC-4.9: **Negative test**: Cross-tenant policy access denied (community A cannot read/write community B's policies)
- [ ] AC-4.10: **Negative test**: `member` role cannot approve policies; `agent` role cannot propose or approve
- [ ] AC-4.11: **Negative test**: Admin override without audit trail entry is rejected
- [ ] AC-4.12: Every governance API call produces an append-only audit event with actor, role, action, and community_id

---

## 5. Technical & Non-Functional Requirements

### NF-1: Backwards Compatibility

All changes must be backwards-compatible with cycle-037 infrastructure:
- Existing lot_entries without `purpose`, `causation_id`, `sequence_number` remain valid
- Conservation invariants I-1 through I-5 continue to function identically
- Feature flags gate new capabilities independently
- Zero-downtime migration path (online DDL only)

### NF-2: Performance

| Operation | Target | Constraint |
|-----------|--------|------------|
| Purpose-annotated debit | ≤5ms overhead vs current debit | Purpose is a write-side annotation only |
| Velocity computation | ≤200ms per community | Windowed query with pre-computed hourly buckets |
| State replay (10k events) | ≤500ms | Sequential scan with in-memory accumulation |
| Policy lookup | ≤10ms | Indexed active policy query |
| Governance proposal | ≤100ms | Single INSERT with event emission |

**Aggregate Scaling Assumptions** (IMP-008 — Flatline HIGH_CONSENSUS):
Performance targets above are per-community. Platform-wide assumptions:
- **Active communities**: Design for ≤1,000 active communities (communities with ≥1 economic operation in the last 24h)
- **Peak concurrency per community**: ≤50 concurrent economic operations (debits/reserves/releases)
- **Velocity computation batching**: EventBridge scheduled task processes communities in batches of 100, with configurable parallelism (default: 10 concurrent)
- **Sequence contention ceiling**: SELECT FOR UPDATE serializes at the community level; at >100 TPS per community, evaluate advisory lock alternative (see F-3 sequencing notes)
- **Event log growth**: Estimated ≤100K events/community/month at current usage; snapshot strategy (IMP-003) ensures replay remains within NF-2 targets as logs grow

### NF-3: Security

- Governance API requires community membership verification (Arrakis token-gate or equivalent)
- Role-based authorization: `member` (propose only), `operator` (propose + approve non-limit), `admin` (full), `agent` (no governance access) — see F-4 Authorization Model
- Policy changes produce audit events (append-only, non-repudiable) with actor, role, action, community_id
- RLS enforcement on `economic_policies` table via `SET LOCAL app.community_id` (community isolation — service role does NOT bypass RLS)
- Admin override of governance requires explicit audit trail entry (AC-4.11 enforces)
- No elevation of privilege through governance (policies can only adjust within platform-defined bounds; platform minimum limit = `100_000n` micro)
- Cross-tenant isolation verified by negative tests (AC-4.9)

**RLS Enforcement Completeness** (SKP-007 — Flatline BLOCKER, accepted):
Every code path that touches `lot_entries`, `economic_policies`, or `community_event_sequences` MUST execute within a transaction that has called `SET LOCAL app.community_id = $community_id`. No exceptions. Enumeration of all code paths:

| Code Path | Runs As | RLS Requirement |
|-----------|---------|-----------------|
| `debitLots()` / `reserveCredits()` / `releaseCredits()` | Application (per-request) | SET LOCAL in existing transaction wrapper — **already implemented in cycle-037** |
| `creditLots()` (NOWPayments webhook, x402 settle) | Application (webhook handler) | SET LOCAL before mint — **already implemented** |
| Reconciliation sweep (EventBridge) | Background job | SET LOCAL per-community iteration — **already implemented** |
| Velocity computation (EventBridge, F-2) | Background job | **NEW**: Must SET LOCAL before querying lot_entries for each community batch |
| Legacy backfill job (F-3) | One-time migration | **NEW**: Must SET LOCAL per-community before assigning sequence numbers |
| Governance API (F-4) | Application (per-request) | **NEW**: Must SET LOCAL before any economic_policies read/write |
| Governance sweep (expiry/activation) | Background job | **NEW**: Must SET LOCAL per-community iteration — same pattern as reconciliation |
| Admin tooling / debugging queries | Superuser | **EXCEPTION**: Admin queries MAY bypass RLS via `SET ROLE` with explicit audit logging. Admin bypass MUST be logged to a separate `admin_audit_log` table with actor, action, community_id, and timestamp. |

**Enforcement mechanism**: A shared database middleware function `withCommunityScope(communityId, fn)` wraps all economic operations:
```typescript
async function withCommunityScope<T>(
  communityId: string,
  tx: Transaction,
  fn: () => Promise<T>
): Promise<T> {
  await tx.query('SET LOCAL app.community_id = $1', [communityId]);
  return fn();
}
```
All new code paths (F-2 velocity, F-3 backfill, F-4 governance) MUST use `withCommunityScope`. This is enforced by:
1. Code review checklist item: "Does this query touch lot_entries/economic_policies? → Must use withCommunityScope"
2. Integration test: Attempt query without SET LOCAL → verify RLS denies access
3. AC-4.9 cross-tenant negative test covers the governance path specifically

### NF-4: Observability

| Metric | Dimension | Source |
|--------|-----------|--------|
| `purpose_spend_micro` | community_id, purpose | F-1 debit path |
| `velocity_micro_per_hour` | community_id | F-2 velocity service |
| `estimated_exhaustion_hours` | community_id | F-2 velocity service |
| `event_replay_duration_ms` | community_id | F-3 replay service |
| `replay_consistency_drift_micro` | community_id | F-3 verify service |
| `governance_proposal_count` | community_id, policy_type | F-4 governance API |
| `governance_approval_count` | community_id, approval_method | F-4 governance API |
| `policy_enforcement_count` | community_id, policy_type | F-4 conservation guard integration |

---

## 6. Scope & Prioritization

### Sprint Structure

| Sprint | Focus | Features | Dependencies |
|--------|-------|----------|-------------|
| Sprint 1: Economic Memory | Purpose tracking on all economic operations | F-1 | None — purely additive |
| Sprint 2: Temporal Dimension | Velocity computation and predictive alerts | F-2 | F-1 (purpose enables per-purpose velocity) |
| Sprint 3: Event Formalization | Event sourcing columns, replay capability, consistency verification | F-3 | F-1 (purpose in events), F-2 (velocity events) |
| Sprint 4: Governance | Policy table, governance API, conservation guard integration, conviction bridge | F-4 | F-3 (governance events), F-1 (purpose allocation policy) |

### Feature Flags

| Flag | Default | Gates |
|------|---------|-------|
| `FEATURE_PURPOSE_TRACKING` | `true` | F-1: Purpose field population |
| `FEATURE_VELOCITY_ALERTS` | `false` | F-2: Velocity computation and alerts |
| `FEATURE_EVENT_SOURCING` | `false` | F-3: Event correlation/sequence/replay |
| `FEATURE_GOVERNANCE` | `false` | F-4: Governance API and policy enforcement |

### What's Explicitly Out of Scope

- Frontend/UI for economic dashboard (data layer only)
- On-chain governance voting (off-chain conviction scoring only)
- Cross-community economic modeling (infrastructure is laid, analysis is future)
- Real-time event streaming (WebSocket/SSE for economic events — future cycle)
- What-if branching on replayed history (replay infrastructure only this cycle)

---

## 7. Risks & Dependencies

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Purpose classification is incorrect for edge cases | Medium | Low | Default to 'unclassified'; retrospective reclassification via event replay |
| Velocity prediction inaccurate for bursty workloads | Medium | Medium | Confidence scoring; only alert at 'high' confidence by default |
| Event sequence numbering contention under high concurrency | Low | Medium | Per-community sequence via advisory locks; benchmark at expected load |
| Governance layer used to set limit to zero (DoS) | Low | High | Platform-enforced minimum limit (e.g., 100 micro); governance can only adjust within bounds |
| Arrakis conviction scoring not available at integration time | Medium | Low | Admin-only approval method as complete fallback; conviction is additive |

### External Dependencies

| Dependency | Required For | Fallback |
|-----------|-------------|----------|
| Arrakis conviction scoring | F-4 conviction-based approval | Admin approval method |
| CloudWatch EMF | F-2 velocity metrics | Log-based metrics (existing pattern) |
| EventBridge | F-2 velocity scheduled computation | Cron-equivalent on ECS |

---

## 8. The Ostrom Framing

This PRD is informed by Elinor Ostrom's research on commons governance, as surfaced by the Bridgebuilder review of PR #90. The four features map to Ostrom's principles:

| Feature | Ostrom Principle | Manifestation |
|---------|-----------------|---------------|
| Economic Memory (F-1) | Proportional equivalence between benefits and costs | Communities see what their contributions funded — proportionality becomes visible |
| Economic Velocity (F-2) | Monitoring | Surveillance of resource consumption becomes predictive, not just detective |
| Event Sourcing (F-3) | Nested enterprises | Cross-community economic modeling becomes possible through replayable history |
| Governance Layer (F-4) | Collective-choice arrangements + minimal recognition of rights to organize | Communities govern their own economic policies through conviction-weighted proposals |

The Web4 manifesto's vision of monetary pluralism — "millions of social monies will coexist" — is the philosophical north star. Each community's economic boundary, governed by its own policies, with full economic memory and replayable history, becomes a distinct social money with its own embedded values. The credit lot `source` field already implements monetary provenance. The `purpose` field adds monetary intentionality. The governance layer adds monetary sovereignty.

This is not a billing platform with community features. This is an economic protocol for community-governed AI agent access. The code already knows this. Now the architecture will too.

> *"When you build an economic system for communities rather than individuals, you inevitably rediscover Ostrom. The question is whether you discover her consciously."* — Bridgebuilder, PR #90

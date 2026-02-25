# Sprint Plan: The Governance Substrate Phase II — Bridge Excellence

**Cycle:** cycle-043 (continuation)
**Sprints:** 4 (global IDs: 362–365)
**Source:** Bridgebuilder post-convergence review (bridge-20260226-6bb222, 3 iterations)
**PR:** #99 — feat(cycle-043): The Governance Substrate

---

## Provenance

This sprint plan addresses ALL observations from the Bridgebuilder review of PR #99:

| Source | Findings | Status |
|--------|----------|--------|
| Bridge iter 1 — HIGH/MEDIUM | 3 (high-1, medium-1, medium-2) | Fixed in `29d850a1` |
| Bridge iter 1 — LOW | 3 (low-1, low-2, low-3) | low-1 fixed; **low-2, low-3 open** |
| Bridge iter 2-3 — LOW | 1 (PartitionManager type) | **Open** |
| Bridge iter 1 — SPECULATION | 1 (DynamicContract as feature flag) | **Planned: Sprint 2** |
| Post-convergence Comment 1 | Architectural meditations | **Planned: Sprint 1 docs, Sprint 2** |
| Post-convergence Comment 2 | Permission landscape, Ostrom mapping | **Planned: Sprint 2, Sprint 4** |
| Post-convergence Comment 3 | 3 speculations + REFRAME | **Planned: Sprints 2, 3, 4** |

---

## Sprint Overview

| Sprint | Global ID | Focus | Key Deliverables |
|--------|-----------|-------|-----------------|
| 1 | 362 | Bridge Convergence Polish | Fix remaining LOWs, verify() safety, documentation |
| 2 | 363 | DynamicContract Evolution | Capability mesh prototype, feature flag generalization |
| 3 | 364 | Audit Intelligence Pipeline | Training signal extraction, model performance queries |
| 4 | 365 | Meta-Governance | Constitutional amendment protocol, Ostrom documentation |

---

## Sprint 1: Bridge Convergence Polish (Global ID: 362)

**Goal**: Address all remaining LOW findings from bridge iterations and harden the governance substrate with safety improvements identified during review.

### Task 1.1: PartitionManager Type Annotation Fix
**Source**: Bridge iter 2-3, low-1 (carried forward)
**File**: `packages/adapters/storage/partition-manager.ts:81-84`
**Effort**: Small

**Description**: The TypeScript generic type for the `checkPartitionHealth()` query result declares `range_start` and `range_end` columns, but the actual SQL returns `partition_name` and `bound_expr`. The runtime code accesses the correct column names (`row.bound_expr`, `row.partition_name`), so this is type-annotation-only — but misleading types are a maintainability hazard.

**Changes**:
- Update the `client.query<>` type parameter from `{ partition_name: string; range_start: string; range_end: string }` to `{ partition_name: string; bound_expr: string }`
- Remove `range_start` and `range_end` from the intermediate type since the SQL returns `bound_expr` which is parsed into those values downstream
- Add inline comment explaining the `bound_expr` → range parse step

**Acceptance Criteria**:
- [ ] Query result type matches actual SQL columns: `{ partition_name: string; bound_expr: string }`
- [ ] No runtime behavior change (existing parse logic unchanged)
- [ ] TypeScript compiles with zero errors
- [ ] Existing partition manager tests pass

---

### Task 1.2: DynamicContract Path Resolution Hardening
**Source**: Bridge iter 1, low-2
**File**: `themes/sietch/src/packages/core/protocol/arrakis-dynamic-contract.ts:56-60`
**Effort**: Medium

**Description**: `DEFAULT_CONTRACT_PATH` uses `process.cwd()` which varies by execution context (test runner, worker threads, serverless functions like Vercel/Lambda). In deployment, `cwd` may not point to the application root.

Replace `process.cwd()` with `import.meta.url`-relative resolution using Node's `fileURLToPath()` for cross-platform safety, and accept an explicit config override as first priority.

**Changes**:
- Replace `resolve(process.cwd(), 'config', 'dynamic-contract.json')` with `fileURLToPath(new URL('../../../../../config/dynamic-contract.json', import.meta.url))` (uses Node's `url` module for correct cross-platform path handling — Windows drive letters, URL encoding)
- Accept `contractPath` parameter override as first priority (already exists — document clearly)
- Add `DYNAMIC_CONTRACT_PATH` env var as second priority (new)
- Fallback to `import.meta.url`-relative resolution as third priority
- Add `assertNotProdOverride(envVarName: string)` shared guard function (reusable for both `DYNAMIC_CONTRACT_OVERRIDE` and `DYNAMIC_CONTRACT_PATH`)
- Add test: validate path resolution in different `cwd` contexts
- Add test: env var rejected when `NODE_ENV=production` without explicit allow flag

**Acceptance Criteria**:
- [ ] `DEFAULT_CONTRACT_PATH` no longer uses `process.cwd()`
- [ ] Uses `fileURLToPath(new URL(..., import.meta.url))` for cross-platform correctness
- [ ] Resolution priority: explicit param > `DYNAMIC_CONTRACT_PATH` env > `import.meta.url`-relative
- [ ] Existing `loadDynamicContract()` tests pass without changes
- [ ] New test: path resolves correctly regardless of `cwd`
- [ ] `DYNAMIC_CONTRACT_PATH` env var blocked in production via `assertNotProdOverride()` guard
- [ ] New test: `NODE_ENV=production` + `DYNAMIC_CONTRACT_PATH` set → throws unless `ALLOW_DYNAMIC_CONTRACT_OVERRIDE=true`

---

### Task 1.3: Audit Trail verify() Safety Bound
**Source**: Bridge iter 1, low-3
**File**: `packages/adapters/storage/audit-trail-service.ts:237-261`
**Effort**: Medium

**Description**: `verify()` with no options performs an unbounded `SELECT` on `audit_trail` ordered by id. On a table with millions of entries, this could exhaust memory and timeout. The method is likely only called with `domainTag` in practice, but the API doesn't enforce it.

Add a safety limit when neither `domainTag` nor the existing `limit` option is provided.

**Note on existing API**: The `verify()` method already accepts an optional `limit` parameter in its options. The issue is that calling `verify()` with no options at all results in an unbounded scan. This task adds a safety default — it does NOT introduce a new option name.

**Changes**:
- Add `DEFAULT_VERIFY_LIMIT = 10_000` constant
- When `verify()` is called without `domainTag` AND without `limit`, apply `DEFAULT_VERIFY_LIMIT` to the SQL LIMIT clause and log a warning: `"verify() called without domainTag or limit — applying safety limit of 10000 entries. Consider passing domainTag for targeted verification."`
- The existing `limit` option continues to work as before — if caller provides `limit`, it is used as-is (no override)
- Add test: verify without domain_tag and without limit → applies DEFAULT_VERIFY_LIMIT
- Add test: verify without domain_tag but with explicit limit → respects caller's limit
- Add test: verify with domain_tag and no limit → no safety limit applied (domain-scoped is already bounded)

**Acceptance Criteria**:
- [ ] `verify()` without domainTag AND without limit applies 10,000 entry safety limit via SQL LIMIT
- [ ] `verify()` without domainTag but WITH explicit `limit` respects the caller's value
- [ ] `verify()` WITH domainTag and no limit → no safety limit (domain-scoped queries are bounded)
- [ ] Warning logged when safety limit kicks in (not when caller provides explicit limit)
- [ ] Existing verify tests pass unchanged (they use domainTag so no behavior change)
- [ ] 3 new tests covering the safety limit scenarios above

---

### Task 1.4: Governance Substrate Architecture Documentation
**Source**: Post-convergence Comments 1-3 (architectural observations)
**Files new**: `docs/architecture/governance-substrate.md`
**Effort**: Medium

**Description**: The post-convergence review surfaced architectural insights that should be captured as documentation for future engineers. These are not code changes but institutional knowledge.

**Sections**:
1. **Constitutional Architecture**: Conservation laws as constitutional primitives, delegation-over-reimplementation pattern, connection to Ostrom's 8 design principles
2. **Defense-in-Depth**: Three independent enforcement layers (advisory lock, chain_links constraint, hash chain) — why each exists and what fails if one is removed
3. **Fail-Closed Philosophy**: Why the system chooses unavailability over unaccountability, with code references
4. **Capability Algebra**: How DynamicContract maps trust to capability, monotonic expansion invariant, connection to multi-model routing
5. **Evolutionary Pressure**: How the exhaustive switch + `never` type check forces consumers to acknowledge new variants
6. **Version Negotiation**: Dual-accept strategy, Phase A/B/C transition, why this matters for ecosystem evolution

**Acceptance Criteria**:
- [ ] `docs/architecture/governance-substrate.md` created with all 6 sections
- [ ] Each section includes code references (file:line)
- [ ] Ostrom's 8 principles mapped to specific code patterns
- [ ] FAANG parallels cited with specific systems (Stripe, Google, Netflix)
- [ ] Document reviewed for accuracy against actual code

---

## Sprint 2: DynamicContract Evolution (Global ID: 363)

**Goal**: Evolve the DynamicContract from a simple reputation→surface mapping into a generalized capability resolution system. This sprint implements the bridge speculation (DynamicContract as feature flag) and the post-convergence speculation (capability mesh).

### Task 2.1: DynamicContract Capability Catalog
**Source**: Bridge iter 1 speculation-1 + Post-convergence Comment 1 §II
**Files new**: `themes/sietch/src/packages/core/protocol/capability-catalog.ts`, `tests/unit/capability-catalog.test.ts`
**Effort**: Large

**Description**: Extract the capability resolution logic from `resolveProtocolSurface()` into a standalone `CapabilityCatalog` that can resolve capabilities from multiple sources — not just reputation state.

The DynamicContract already maps reputation states to capability sets. By abstracting the resolution into a catalog with pluggable resolvers, the same mechanism can serve as a unified feature flag system, eliminating the need for a separate feature flag service.

**Design**:
```typescript
interface CapabilityResolver {
  name: string;
  resolve(context: ResolutionContext): CapabilitySet;
  priority: number;
}

class CapabilityCatalog {
  addResolver(resolver: CapabilityResolver): void;
  resolve(context: ResolutionContext): ResolvedCapabilities;
  isGranted(capability: string, context: ResolutionContext): boolean;
}
```

**Resolvers** (this sprint implements 2):
1. `ReputationResolver` — wraps existing `resolveProtocolSurface()` logic
2. `FeatureFlagResolver` — evaluates feature flags from environment/config

**Changes**:
- New `capability-catalog.ts` with `CapabilityCatalog`, `CapabilityResolver` interface, `ResolutionContext`
- `ReputationResolver` delegates to existing DynamicContract resolution
- `FeatureFlagResolver` reads from `FEATURE_FLAGS` env var or config file
- Maintain monotonic expansion guarantee: resolved capabilities from ALL resolvers combine via **set union** (never subtract). There are no "conflicts" — capabilities are boolean (granted or not), so union is always safe. The `priority` field is used only for **provenance attribution** (which resolver "caused" a capability to be granted), NOT for override/subtraction semantics.
- `resolveProtocolSurface()` unchanged — it becomes an internal detail of `ReputationResolver`

**Merge semantics (explicit)**:
- Boolean capabilities (e.g., `can_use_ensemble`): union across all resolvers. If ANY resolver grants it, it's granted.
- Parameterized capabilities (e.g., `rate_limit_tier`): choose the MOST permissive value (highest tier). Ordering defined by the capability schema.
- Schema access (e.g., `schemas[]`): union of all granted schemas.
- `priority` field: used ONLY for provenance — `ResolvedCapabilities` records which resolver provided each capability, with highest-priority resolver listed first.

**Acceptance Criteria**:
- [ ] `CapabilityCatalog` resolves capabilities from multiple resolvers
- [ ] `ReputationResolver` produces identical results to current `resolveProtocolSurface()`
- [ ] `FeatureFlagResolver` reads feature flags from environment
- [ ] Union semantics: boolean capabilities are additive (monotonic expansion preserved)
- [ ] Parameterized capabilities: most permissive value wins (not arbitrary priority)
- [ ] `priority` field used for provenance attribution only (not override)
- [ ] Tests: catalog with 0 resolvers returns empty, with 1 returns resolver output, with 2 combines via union
- [ ] Test: two resolvers granting different capabilities → both granted (no subtraction)
- [ ] Test: two resolvers granting same parameterized capability → most permissive wins
- [ ] Existing DynamicContract tests pass unchanged

---

### Task 2.2: Relationship-Based Capability Surfaces
**Source**: Post-convergence Comment 3, Speculation 1
**Files new**: `themes/sietch/src/packages/core/protocol/capability-mesh.ts`, `tests/unit/capability-mesh.test.ts`
**Effort**: Large

**Description**: Extend the capability catalog to support relationship-based surfaces — where *combinations* of agents can earn access to capabilities that neither could access alone.

This connects to `request_context.delegation_id` already present in `ModelPerformanceEvent`. When delegation chains are tracked, reputation can be computed for model *combinations*, not just individual models.

**Design**:
```typescript
interface MeshResolver extends CapabilityResolver {
  name: 'mesh';
  resolve(context: MeshResolutionContext): CapabilitySet;
}

interface MeshResolutionContext extends ResolutionContext {
  delegation_chain?: string[];  // ordered list of model_ids in the delegation
  interaction_history?: {
    model_pair: [string, string];
    quality_score: number;
    observation_count: number;
  }[];
}
```

**Ensemble capability unlocking rule**: When two models have `observation_count >= threshold` and `quality_score >= min_score` in their interaction history, the mesh resolver grants the ensemble strategy capabilities from the DynamicContract.

**Interaction history provider architecture**: The `MeshResolver` depends on interaction history data, but the persistent `AuditQueryService` is built in Sprint 3. To avoid a cross-sprint dependency, this task defines an `InteractionHistoryProvider` interface and ships TWO implementations:

1. `InMemoryInteractionHistoryProvider` — this sprint. Populated from test fixtures or configuration. Sufficient for unit/integration tests and initial deployment with manually-seeded data.
2. `AuditBackedInteractionHistoryProvider` — Sprint 3 (Task 3.1). Wires the `AuditQueryService.getModelPairInteractions()` into the provider interface. This is a **follow-up integration**, marked as TODO in the code with a reference to Task 3.1.

```typescript
interface InteractionHistoryProvider {
  getInteractions(modelA: string, modelB: string): Promise<InteractionRecord[]>;
}
```

The `MeshResolver` constructor accepts an `InteractionHistoryProvider`, making it testable and deployable without the audit query layer.

**Changes**:
- New `capability-mesh.ts` with `MeshResolver`, `MeshResolutionContext`, `InteractionHistoryProvider` interface
- `InMemoryInteractionHistoryProvider` for test and initial deployment
- Ensemble capability threshold configuration
- Integration with `CapabilityCatalog` as a resolver
- TODO comment: `AuditBackedInteractionHistoryProvider` in Task 3.1

**Acceptance Criteria**:
- [ ] `InteractionHistoryProvider` interface defined with `getInteractions(modelA, modelB)`
- [ ] `InMemoryInteractionHistoryProvider` implements the interface (seeded from config/fixtures)
- [ ] `MeshResolver` accepts `InteractionHistoryProvider` via constructor injection
- [ ] `MeshResolver` evaluates delegation chains for ensemble capabilities
- [ ] Interaction history threshold configurable (`min_observations`, `min_quality_score`)
- [ ] Below threshold: no ensemble capabilities (individual only)
- [ ] Above threshold: ensemble strategies unlocked for the model pair
- [ ] Tests: single model gets individual caps, pair above threshold gets ensemble caps
- [ ] Tests: pair below threshold gets only individual caps (fail-closed)
- [ ] Monotonic expansion preserved: mesh capabilities are additive to individual
- [ ] TODO in code: reference Task 3.1 for `AuditBackedInteractionHistoryProvider`

---

### Task 2.3: Property-Based Testing for Monotonic Expansion
**Source**: Post-convergence Comment 1 §II (capability algebra)
**Files new**: `tests/property/monotonic-expansion.property.test.ts`
**Effort**: Medium

**Description**: The monotonic expansion invariant — moving from lower reputation to higher reputation NEVER removes capabilities — is a formal property that should be verified with property-based testing, not just example-based tests.

Use fast-check to generate arbitrary DynamicContract configurations and verify the invariant holds under all configurations.

**Changes**:
- Add `fast-check` dev dependency
- Generate arbitrary DynamicContract structures (random surfaces, capabilities, schemas)
- Property 1: For all reputation state pairs (a, b) where a < b, surface(b) ⊇ surface(a).capabilities
- Property 2: For all reputation state pairs (a, b) where a < b, surface(b) ⊇ surface(a).schemas
- Property 3: `resolveProtocolSurface(contract, 'unknown')` always returns `cold` surface
- Property 4: `CapabilityCatalog.resolve()` is idempotent (same context → same result)

**Acceptance Criteria**:
- [ ] fast-check installed as dev dependency
- [ ] 4 properties verified with 100 iterations each
- [ ] Property 1 (capability monotonicity) passes
- [ ] Property 2 (schema monotonicity) passes
- [ ] Property 3 (fail-closed to cold) passes
- [ ] Property 4 (idempotency) passes
- [ ] All generated counterexamples (if any) produce actionable failure messages

---

## Sprint 3: Audit Intelligence Pipeline (Global ID: 364)

**Goal**: Transform the audit trail from a governance mechanism into an intelligence platform. The hash-chained, immutable record of agent behavior is a structured dataset suitable for model performance analysis and routing optimization.

### Task 3.1: Audit Trail Query Interface
**Source**: Post-convergence Comment 3, Speculation 2
**Files new**: `packages/adapters/storage/audit-query-service.ts`, `tests/unit/audit-query-service.test.ts`
**Effort**: Large

**Description**: Create a read-only query interface for the audit trail that supports model performance analysis without compromising chain integrity.

The audit trail is currently write-optimized (append + verify). This task adds a read-optimized query layer for analytical workloads.

**Design**:
```typescript
interface AuditQueryService {
  // Time-bounded queries (always bounded to prevent full-table scans)
  queryByDomainTag(tag: string, timeRange: TimeRange): Promise<AuditEntry[]>;
  queryByEventType(eventType: string, timeRange: TimeRange): Promise<AuditEntry[]>;
  queryByActorId(actorId: string, timeRange: TimeRange): Promise<AuditEntry[]>;

  // Model performance specific
  getModelPerformanceHistory(modelId: string, timeRange: TimeRange): Promise<ModelPerformanceRecord[]>;
  getModelPairInteractions(modelA: string, modelB: string, timeRange: TimeRange): Promise<InteractionRecord[]>;

  // Aggregate queries
  getQualityDistribution(modelId: string, timeRange: TimeRange): Promise<QualityDistribution>;
  getDomainTagActivity(timeRange: TimeRange): Promise<DomainActivitySummary[]>;
}
```

**Key constraints**:
- All queries MUST have a time range (no unbounded scans)
- Read-only — cannot modify audit trail
- Uses partition-aware queries (Postgres partition pruning)
- No raw SQL exposed — parameterized queries only

**Changes**:
- New `audit-query-service.ts` with time-bounded query methods
- Partition-aware WHERE clauses (include `created_at` range for pruning)
- `ModelPerformanceRecord` type extracts structured data from audit payloads
- Index recommendations for common query patterns (added as migration comments)
- New `AuditBackedInteractionHistoryProvider` — implements `InteractionHistoryProvider` (from Task 2.2) by wiring `getModelPairInteractions()` to the provider interface. This completes the follow-up integration for the MeshResolver.

**Acceptance Criteria**:
- [ ] All query methods require `TimeRange` parameter (no unbounded)
- [ ] `getModelPerformanceHistory()` returns structured model performance records
- [ ] `getModelPairInteractions()` joins delegation chains with quality outcomes
- [ ] `getQualityDistribution()` returns score histogram for a model
- [ ] All queries include `created_at` bounds in WHERE clause (enables PostgreSQL partition pruning)
- [ ] Integration test (testcontainer with partitioned table): verify `EXPLAIN (ANALYZE)` shows partition pruning for a time-bounded query (separate from unit tests — may run in nightly only)
- [ ] Unit tests with mock data covering all query methods
- [ ] Read-only: no INSERT/UPDATE/DELETE in any query
- [ ] `AuditBackedInteractionHistoryProvider` implements `InteractionHistoryProvider` (from Task 2.2)
- [ ] `AuditBackedInteractionHistoryProvider` test: wires `getModelPairInteractions()` to provider interface

---

### Task 3.2: Causal Dataset Export
**Source**: Post-convergence Comment 3, Speculation 2 (offline RL connection)
**Files new**: `packages/adapters/storage/audit-export-service.ts`, `tests/unit/audit-export-service.test.ts`
**Effort**: Medium

**Description**: Create an export pipeline that produces training-ready datasets from the audit trail. The output format is JSON Lines (one JSON object per line), suitable for consumption by offline reinforcement learning pipelines.

Each record is a state-action-reward tuple:
- **State**: Agent reputation, available capabilities, context (pool_id, task_type)
- **Action**: Which model was selected, delegation chain, ensemble strategy
- **Reward**: `quality_observation.score`, dimensions, latency_ms
- **Provenance**: `entry_hash` (cryptographic proof of data integrity)

**Design**:
```typescript
interface ExportConfig {
  timeRange: TimeRange;
  domainTags?: string[];
  eventTypes?: string[];
  format: 'jsonl' | 'parquet';
  includeProvenance: boolean;
}

interface AuditExportService {
  exportToStream(config: ExportConfig): ReadableStream<Uint8Array>;
  exportStats(config: ExportConfig): Promise<ExportStats>;
}
```

**Changes**:
- New `audit-export-service.ts` with streaming export
- JSON Lines format with one `{state, action, reward, provenance}` tuple per line
- Provenance includes `entry_hash` for cryptographic data integrity verification
- Streaming (not buffered) to handle large time ranges
- `exportStats()` returns row count, time range, unique models without loading data

**Acceptance Criteria**:
- [ ] `exportToStream()` produces valid JSON Lines output
- [ ] Each record contains state/action/reward/provenance fields
- [ ] Provenance includes `entry_hash` for integrity verification
- [ ] Streaming: memory usage bounded regardless of time range size
- [ ] `exportStats()` returns metadata without full data load
- [ ] Tests: export 100 mock records, verify format and completeness
- [ ] Time range required (no unbounded export)

---

### Task 3.3: Model Performance Dashboard Queries
**Source**: Post-convergence Comment 2 §IV (Bayesian routing signal)
**Files new**: `packages/adapters/storage/model-analytics.ts`, `tests/unit/model-analytics.test.ts`
**Effort**: Medium

**Description**: Create high-level analytical functions for model performance visualization. These power the operational dashboard for understanding model behavior over time.

**Functions**:
```typescript
// Score trend over time (for time-series chart)
getScoreTrend(modelId: string, granularity: 'hour' | 'day' | 'week', timeRange: TimeRange): Promise<ScoreTrendPoint[]>;

// Comparative model performance (for bar chart / heatmap)
compareModels(modelIds: string[], timeRange: TimeRange): Promise<ModelComparison[]>;

// Task-type breakdown for a model (for pie chart)
getTaskTypeBreakdown(modelId: string, timeRange: TimeRange): Promise<TaskTypeBreakdown[]>;

// Aggregate-only vs task-specific observation ratio
getAggregateRatio(modelId: string, timeRange: TimeRange): Promise<{ aggregate: number; taskSpecific: number }>;
```

**Acceptance Criteria**:
- [ ] `getScoreTrend()` returns time-bucketed average scores
- [ ] `compareModels()` returns side-by-side metrics for multiple models
- [ ] `getTaskTypeBreakdown()` shows observation distribution by task type
- [ ] `getAggregateRatio()` shows the ratio of unspecified vs typed observations
- [ ] All functions require TimeRange (no unbounded)
- [ ] SQL uses `date_trunc()` for time bucketing (PostgreSQL native)
- [ ] Tests with mock data for each function

---

## Sprint 4: Meta-Governance — Constitutional Amendment Protocol (Global ID: 365)

**Goal**: Implement the infrastructure for governed evolution of governance rules themselves. Conservation laws are currently defined at deploy time. This sprint adds the ability to amend them through a multi-stakeholder approval process, with amendments recorded in the audit trail.

### Task 4.1: Amendment Schema Design
**Source**: Post-convergence Comment 3, Speculation 3
**Files new**: `packages/adapters/storage/amendment-service.ts`, `tests/unit/amendment-service.test.ts`
**Effort**: Large

**Description**: Define the schema for governance amendments — changes to conservation laws, capability surfaces, or threshold parameters that require multi-stakeholder approval.

**Design**:
```typescript
interface GovernanceAmendment {
  amendment_id: string;
  amendment_type: 'conservation_law' | 'capability_surface' | 'threshold';
  proposed_by: string;        // actor_id
  proposed_at: string;        // ISO 8601
  effective_at: string;       // When the amendment takes effect (future-dated)
  description: string;
  current_value: unknown;     // Snapshot of current state
  proposed_value: unknown;    // Proposed new state
  approval_threshold: number; // Conviction weight threshold (not simple count)
  votes: AmendmentVote[];     // Supports both approve and reject
  status: 'proposed' | 'approved' | 'enacted' | 'rejected' | 'expired';
}

interface AmendmentVote {
  voter_id: string;
  voted_at: string;
  decision: 'approve' | 'reject';  // Explicit approve/reject (supports veto)
  rationale: string;
  governance_tier?: string;         // For conviction-weighted voting (Task 4.2)
  conviction_weight?: number;       // Computed from tier (Task 4.2)
}
```

**Status transition rules**:
- `proposed → approved`: when total conviction weight of `approve` votes meets `approval_threshold`
- `proposed → rejected`: when ANY sovereign-tier voter casts `reject` (veto), OR when total `reject` weight exceeds a blocking threshold
- `approved → enacted`: when `effective_at` time is reached AND `current_value` still matches live state
- `proposed → expired`: when 30 days pass without reaching `approved` or `rejected`
- No transitions OUT of `enacted`, `rejected`, or `expired` (terminal states)

**Key constraints**:
- Amendments are themselves recorded in the audit trail (meta-governance)
- `effective_at` must be in the future (no retroactive amendments)
- `current_value` is snapshotted at proposal time (prevents stale amendments)
- Each voter may vote only once per amendment (idempotency via `voter_id` + `amendment_id` unique constraint)
- Expiry: amendments not approved/rejected within 30 days are expired automatically

**Enactment integration point — amendable parameter storage**:
- Amendable parameters are stored in a `governance_parameters` DB table: `{ parameter_key: string, parameter_type: amendment_type, current_value: jsonb, version: number, updated_at: timestamp }`
- `enactAmendment()` reads `governance_parameters` for the target key, verifies `current_value` matches the amendment's snapshot (optimistic concurrency via `version` field), then updates the row in the SAME transaction as the audit append
- A runtime `GovernanceParameterCache` reads from `governance_parameters` and feeds into the relevant services (conservation law config, DynamicContract surfaces, threshold values) with a configurable TTL (default 60s)
- On startup, services read parameters from `governance_parameters`; code-defined defaults serve as fallback if no DB row exists
- End-to-end test: propose amendment → approve → enact → verify the amended parameter is read by the consuming service

**Changes**:
- New `amendment-service.ts` with `proposeAmendment()`, `voteOnAmendment()`, `enactAmendment()`, `expireStaleAmendments()`
- New `governance-parameter-store.ts` with `GovernanceParameterCache` for runtime resolution
- Each operation appends to audit trail via GovernedMutationService
- `enactAmendment()` validates `current_value` still matches live state via version check (optimistic concurrency)
- Migration: `0005_governance_amendments.sql` — `governance_amendments` table, `governance_amendment_votes` table, `governance_parameters` table, all with RLS

**Acceptance Criteria**:
- [ ] `proposeAmendment()` creates amendment with status `proposed` and audit entry
- [ ] `voteOnAmendment()` accepts `approve` or `reject` decisions
- [ ] `voteOnAmendment()` rejects duplicate votes from same voter (idempotent)
- [ ] Status transitions to `approved` when conviction weight threshold met
- [ ] Status transitions to `rejected` when sovereign veto cast
- [ ] `enactAmendment()` validates `governance_parameters.version` matches snapshot, updates row
- [ ] `enactAmendment()` fails if current state has drifted (optimistic concurrency via version)
- [ ] `GovernanceParameterCache` reads amended values and feeds into services
- [ ] `effective_at` must be future-dated (rejects past timestamps)
- [ ] `expireStaleAmendments()` transitions stale proposals to `expired`
- [ ] All operations recorded in audit trail (amendments are audited)
- [ ] Unit tests for each status transition (proposed→approved, proposed→rejected, approved→enacted, proposed→expired)
- [ ] Unit test: concurrent amendment on same parameter → second fails (optimistic lock)
- [ ] End-to-end test: propose → vote → enact → consuming service reads amended value

---

### Task 4.2: Conviction-Weighted Approval Integration
**Source**: Post-convergence Comment 2 §VI (Ostrom Principle 3), loa-dixie PR #5
**Files new**: `packages/adapters/storage/amendment-voting.ts`, `tests/unit/amendment-voting.test.ts`
**Effort**: Medium

**Description**: Integrate conviction-weighted voting into the amendment approval process. Stakeholders with higher governance tier have proportionally more weight, following Ostrom Principle 3 (proportional equivalence).

The conviction voting model from loa-dixie (KnowledgePriorityStore with tier weights: `observer:0 → sovereign:25`) provides the mechanism. Amendments are approved when total conviction weight meets the threshold, not when a fixed count of approvals is reached.

**Design**:
```typescript
interface ConvictionApproval extends AmendmentApproval {
  governance_tier: 'observer' | 'participant' | 'member' | 'steward' | 'sovereign';
  conviction_weight: number;
}

function computeConvictionTotal(approvals: ConvictionApproval[]): number;
function isAmendmentApproved(amendment: GovernanceAmendment, threshold: number): boolean;
```

**Tier weights** (from loa-dixie pattern):
| Tier | Weight | Access |
|------|--------|--------|
| observer | 0 | View amendments only |
| participant | 1 | Propose amendments |
| member | 5 | Vote on amendments |
| steward | 15 | Vote + elevated weight |
| sovereign | 25 | Vote + veto power |

**Changes**:
- New `amendment-voting.ts` with conviction weight calculation
- Integrate with `AmendmentService.approveAmendment()` — uses weighted threshold
- Sovereign veto: a single sovereign rejection blocks the amendment
- Tie-breaking: if conviction exactly meets threshold and a sovereign has not voted, wait
- Weight configuration via `governance_tiers` config (not hardcoded)

**Acceptance Criteria**:
- [ ] `computeConvictionTotal()` sums tier-weighted approvals correctly
- [ ] `isAmendmentApproved()` compares conviction total against threshold
- [ ] Sovereign veto: single sovereign rejection → `rejected` status
- [ ] Observer cannot vote (weight 0, treated as abstention)
- [ ] Tier weights configurable via governance_tiers config
- [ ] Tests: approval at exact threshold, below threshold, sovereign veto
- [ ] Integration test: propose → vote → approve → enact lifecycle

---

### Task 4.3: Ostrom Governance Compliance Verification
**Source**: Post-convergence Comment 2 §VI (full Ostrom mapping)
**Files new**: `tests/integration/ostrom-governance.test.ts`
**Effort**: Medium

**Description**: Create a governance compliance test suite that explicitly verifies each of Ostrom's 8 design principles against the codebase. This serves as both documentation and ongoing verification that governance properties are maintained.

**Ostrom Principle Tests**:

| # | Principle | Verification |
|---|-----------|-------------|
| 1 | Clear boundaries | `domain_tag` scoping: every audit entry is jurisdictionally bounded |
| 2 | Proportional equivalence | model_performance scoring: quality → reputation → capability |
| 3 | Collective-choice | `evaluateGovernanceMutation()` delegation: rules in protocol, not consumer |
| 4 | Monitoring | Audit trail: every mutation observed, hashed, immutable |
| 5 | Graduated sanctions | Circuit breaker: retry → quarantine → manual reset |
| 6 | Conflict resolution | Dual-accept version negotiation: coexistence of protocol versions |
| 7 | Minimal recognition of rights | `resolveActorId()`: identity established before any mutation |
| 8 | Nested enterprises | Multi-layer: hounfour (constitutional) → Arrakis (institutional) → communities (operational) |

**Changes**:
- New `ostrom-governance.test.ts` with 8 test groups (one per principle)
- Each test verifies the principle against actual code behavior (not just comments)
- Tests import real modules and verify properties end-to-end
- Principle 5 (graduated sanctions): verify circuit breaker state transitions
- Principle 7 (identity): verify no mutation path exists without actor_id

**Acceptance Criteria**:
- [ ] 8 test groups, one per Ostrom principle
- [ ] Each test verifies against real code (not mock-only)
- [ ] Principle 1: audit entries scoped by domain_tag (no cross-domain leakage)
- [ ] Principle 4: all governed mutations produce audit entries
- [ ] Principle 5: circuit breaker transitions: closed → open → half-open → closed
- [ ] Principle 7: `resolveActorId()` throws on empty identity
- [ ] Tests pass in CI
- [ ] Comments reference Ostrom's original 8 principles by name

---

## Appendix A: Dependency Graph

```
Sprint 1 (362): Polish (independent)
      ↓
Sprint 2 (363): DynamicContract Evolution (depends on 1.2 for path fix)
      ↓                                    ┐
Sprint 3 (364): Audit Intelligence          │ Task 3.1 delivers AuditBackedInteractionHistoryProvider
      ↓         (depends on audit trail)    │ wiring MeshResolver to persistent queries (follow-up to 2.2)
Sprint 4 (365): Meta-Governance (depends on 3.1 for query interface, 2.1 for catalog)
```

**Note**: Sprint 2 Task 2.2 (MeshResolver) uses an `InMemoryInteractionHistoryProvider` — no dependency on Sprint 3. The persistent `AuditBackedInteractionHistoryProvider` is delivered as part of Sprint 3 Task 3.1 as a follow-up integration.

## Appendix B: New Files Summary

| # | File | Sprint | Source |
|---|------|--------|--------|
| 1 | `docs/architecture/governance-substrate.md` | 1 | Post-convergence observations |
| 2 | `themes/sietch/src/packages/core/protocol/capability-catalog.ts` | 2 | Speculation-1 |
| 3 | `themes/sietch/src/packages/core/protocol/capability-mesh.ts` | 2 | Post-convergence Spec 1 |
| 4 | `tests/property/monotonic-expansion.property.test.ts` | 2 | Post-convergence §II |
| 5 | `tests/unit/capability-catalog.test.ts` | 2 | Speculation-1 |
| 6 | `tests/unit/capability-mesh.test.ts` | 2 | Post-convergence Spec 1 |
| 7 | `packages/adapters/storage/audit-query-service.ts` | 3 | Post-convergence Spec 2 |
| 8 | `packages/adapters/storage/audit-export-service.ts` | 3 | Post-convergence Spec 2 |
| 9 | `packages/adapters/storage/model-analytics.ts` | 3 | Post-convergence §IV |
| 10 | `tests/unit/audit-query-service.test.ts` | 3 | Post-convergence Spec 2 |
| 11 | `tests/unit/audit-export-service.test.ts` | 3 | Post-convergence Spec 2 |
| 12 | `tests/unit/model-analytics.test.ts` | 3 | Post-convergence §IV |
| 13 | `packages/adapters/storage/amendment-service.ts` | 4 | Post-convergence Spec 3 |
| 14 | `packages/adapters/storage/amendment-voting.ts` | 4 | Ostrom Principle 3 |
| 15 | `packages/adapters/storage/migrations/0005_governance_amendments.sql` | 4 | Post-convergence Spec 3 |
| 16 | `tests/unit/amendment-service.test.ts` | 4 | Post-convergence Spec 3 |
| 17 | `tests/unit/amendment-voting.test.ts` | 4 | Ostrom Principle 3 |
| 18 | `tests/integration/ostrom-governance.test.ts` | 4 | Post-convergence §VI |

## Appendix C: Finding Traceability Matrix

| Finding ID | Source | Severity | Sprint | Task |
|-----------|--------|----------|--------|------|
| low-1 (iter2-3) | Bridge review | LOW | 1 | 1.1 |
| low-2 (iter1) | Bridge review | LOW | 1 | 1.2 |
| low-3 (iter1) | Bridge review | LOW | 1 | 1.3 |
| speculation-1 | Bridge iter 1 | SPECULATION | 2 | 2.1 |
| §II cap algebra | Post-convergence 1 | OBSERVATION | 2 | 2.3 |
| Spec 1: cap mesh | Post-convergence 3 | SPECULATION | 2 | 2.2 |
| Spec 2: training signal | Post-convergence 3 | SPECULATION | 3 | 3.1, 3.2 |
| §IV Bayesian routing | Post-convergence 2 | OBSERVATION | 3 | 3.3 |
| Spec 3: amendments | Post-convergence 3 | SPECULATION | 4 | 4.1 |
| §VI Ostrom mapping | Post-convergence 2 | OBSERVATION | 4 | 4.2, 4.3 |
| Arch observations | Post-convergence 1-3 | DOCUMENTATION | 1 | 1.4 |

## Appendix D: Risk Register

| Risk | Impact | Mitigation |
|------|--------|------------|
| Capability catalog adds complexity without immediate consumer | Over-engineering | Feature-flag resolver validates pattern with concrete use case |
| Mesh resolver query performance at scale | Slow capability resolution | Cache interaction history; bounded lookups only |
| Amendment protocol complexity vs team size | Unused infrastructure | Start with simple threshold; conviction voting as opt-in |
| Property-based tests slow in CI | CI time increase | Run fast-check with 100 iterations (not 10000); extend in nightly |
| Audit export memory usage for large ranges | OOM | Streaming mandatory; max chunk size enforced |
| Constitutional amendment attacks (spam proposals) | Governance DoS | Rate limit proposals per actor; minimum tier for proposals |

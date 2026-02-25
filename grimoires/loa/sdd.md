# SDD: The Governance Substrate — loa-hounfour v8.2.0 Full Adoption

**Version:** 1.2.0
**Cycle:** cycle-043
**Date:** 2026-02-25
**Status:** Draft

> Sources: grimoires/loa/prd.md v1.1.0 (GPT-APPROVED),
> themes/sietch/src/packages/core/protocol/index.ts (barrel, 549 lines),
> packages/adapters/agent/ (gateway adapters),
> /tmp/loa-hounfour-v8.2.0/ (v8.2.0 source),
> spec/contracts/contract.json (consumer contract)
>
> GPT-5.2 cross-model review: grimoires/loa/a2a/gpt-review/sdd-findings-1.json (8 findings addressed in v1.1.0)
> GPT-5.2 re-review: grimoires/loa/a2a/gpt-review/sdd-findings-2.json (APPROVED)
> Flatline Protocol: grimoires/loa/a2a/flatline/sdd-review.json (5 HIGH auto-integrated, 2 DISPUTED + 6 BLOCKERS accepted in v1.2.0)

---

## 1. Executive Summary

This SDD designs the full adoption of loa-hounfour v8.2.0 into loa-freeside. The upgrade transforms the protocol layer from a schema library consumer into a governance enforcement consumer — adding conservation law factories, mutation authorization, hash-chained audit trails, dynamic contract validation, and the autopoietic model performance pipeline.

**Architecture principle**: Every governance primitive that hounfour provides canonically, freeside adopts rather than reimplements. Zero local governance reimplementations after this cycle.

**Data integrity principle**: The audit trail hash chain is designed as life-critical infrastructure. PostgreSQL persistence with domain-separated hashing, two-phase verification, and halt-and-reconcile quarantine. No data loss tolerance. Append-only enforcement via triggers, RLS, and least-privilege DB roles. Pruning via partition detachment — triggers are NEVER disabled.

---

## 2. System Architecture

### 2.1 Layered Integration Model

```
┌─────────────────────────────────────────────────────────────┐
│                     App Code (themes/sietch/)                │
│  Imports ONLY from @arrakis/core/protocol barrel             │
├─────────────────────────────────────────────────────────────┤
│              Protocol Barrel (index.ts)                       │
│  Re-exports: root + /economy + /governance + /integrity      │
│              + /commons (NEW v8.0.0)                          │
│              + /constraints + /model                          │
├─────────────────────────────────────────────────────────────┤
│           Arrakis Extension Modules                           │
│  arrakis-compat.ts    — version negotiation (dual-accept)    │
│  arrakis-conservation.ts — conservation adapter              │
│  arrakis-governance.ts   — NEW: mutation eval + audit trail  │
│  arrakis-dynamic-contract.ts — NEW: contract validation      │
├─────────────────────────────────────────────────────────────┤
│        @0xhoneyjar/loa-hounfour v8.2.0                       │
│  root | /economy | /governance | /integrity | /commons       │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Import Guard Enforcement (G-5)

**Single rule**: Only the protocol barrel (`themes/sietch/src/packages/core/protocol/index.ts`) and its extension modules (`arrakis-*.ts`) may import from `@0xhoneyjar/loa-hounfour/*`. All other code imports from `@arrakis/core/protocol`.

**ESLint enforcement** (`themes/sietch/.eslintrc.cjs:36-59`): The existing `arrakis-*.ts` glob already covers the new extension modules. No ESLint config change needed.

### 2.3 Version Negotiation — Dual-Accept Rollout (G-6)

**Source of truth**: Hounfour's `validateCompatibility()` function is the SOLE authority for version compatibility. Arrakis-compat.ts delegates to it entirely and does NOT maintain separate range logic.

**Phase A** (this cycle):

```
arrakis-compat.ts:
  CONTRACT_VERSION = '8.2.0'               // From hounfour re-export (automatic)
  negotiateVersion():
    preferred: '8.2.0'
    supported: ['7.11.0', '8.2.0']         // Dual-accept window
  validateCompatibility(peerVersion):
    delegates to hounfour validateCompatibility()
    // hounfour internally accepts >= MIN_SUPPORTED_VERSION (7.5.0)
```

**Phase C** (after loa-finn upgrade): Remove `7.11.0` from supported list, tighten `contract.json`.

**Phase C transition criteria (IMP-010)**:
1. **Telemetry readiness**: 100% of loa-finn peers reporting `CONTRACT_VERSION >= 8.2.0` for ≥7 consecutive days (measured via version negotiation telemetry)
2. **Deprecation notice**: loa-finn team acknowledged upgrade timeline (GitHub issue cross-reference)
3. **Grace period**: 14-day deprecation window after criteria 1+2 met; `7.11.0` peers receive `Deprecation: version` response header during this window
4. **Cutover**: Remove `7.11.0` from `supported` array, tighten `contract.json` `provider_version_range` to `>=8.2.0`
5. **Stragglers**: Any peer still on `7.11.0` after cutover receives a structured `VERSION_UNSUPPORTED` error with upgrade instructions (not a silent failure)

**Integration test requirement**: Add mixed-version peer simulation test that validates:
- arrakis (8.2.0) ↔ finn (7.11.0): PASS during Phase A
- arrakis (8.2.0) ↔ finn (8.2.0): PASS always
- arrakis (8.2.0) ↔ finn (6.0.0): FAIL (below MIN_SUPPORTED)

**contract.json consumption**: CI-only validation (compile-time contract coverage). Not consumed at runtime — version negotiation happens via `validateCompatibility()` and JWT `x-contract-version` header.

> Source: arrakis-compat.ts:51-55, PRD §3 rollout sequence

---

## 3. Component Design

### 3.1 Protocol Barrel Extension (FR-2, FR-3 → G-2, G-5)

**File**: `themes/sietch/src/packages/core/protocol/index.ts`

Add three new sections after the existing v7.10–v7.11 block (line 426):

#### 3.1.1 Commons Module (v8.0.0)

```typescript
// ============================================================================
// Canonical hounfour types — v8.0.0 Commons Module (cycle-043)
// Governance substrate: conservation laws, audit trails, dynamic contracts,
// governed resources, enforcement SDK, error taxonomy.
// ============================================================================

// ─── Foundation Schemas ─────────────────────────────────────────────────────
export {
  InvariantSchema,
  ConservationLawSchema,
  type Invariant,
  type ConservationLaw,
} from '@0xhoneyjar/loa-hounfour/commons';

export {
  AuditEntrySchema,
  AuditTrailSchema,
  AUDIT_TRAIL_GENESIS_HASH,
  type AuditEntry,
  type AuditTrail,
} from '@0xhoneyjar/loa-hounfour/commons';

export {
  StateSchema,
  TransitionSchema,
  StateMachineConfigSchema,
  type State as CommonsState,
  type Transition as CommonsTransition,
  type StateMachineConfig as CommonsStateMachineConfig,
} from '@0xhoneyjar/loa-hounfour/commons';

export {
  GovernanceClassSchema,
  GOVERNED_RESOURCE_FIELDS,
  GovernanceMutationSchema,
  type GovernanceClass,
  type GovernanceMutation,
} from '@0xhoneyjar/loa-hounfour/commons';

// ─── Governed Resources ─────────────────────────────────────────────────────
export {
  GovernedCreditsSchema,
  GovernedReputationSchema,
  GovernedFreshnessSchema,
  type GovernedCredits,
  type GovernedReputation,
  type GovernedFreshness,
} from '@0xhoneyjar/loa-hounfour/commons';

// ─── Hash Chain Operations (ADR-006) ────────────────────────────────────────
export {
  HashChainDiscontinuitySchema,
  type HashChainDiscontinuity,
} from '@0xhoneyjar/loa-hounfour/commons';

export {
  QuarantineStatusSchema,
  QuarantineRecordSchema,
  type QuarantineStatus,
  type QuarantineRecord,
} from '@0xhoneyjar/loa-hounfour/commons';

export {
  buildDomainTag,
  computeAuditEntryHash,
  verifyAuditTrailIntegrity,
  type AuditEntryHashInput,
  type AuditTrailVerificationResult,
} from '@0xhoneyjar/loa-hounfour/commons';

export {
  createCheckpoint,
  verifyCheckpointContinuity,
  pruneBeforeCheckpoint,
  type CheckpointResult,
} from '@0xhoneyjar/loa-hounfour/commons';

// ─── Dynamic Contracts (ADR-009) ────────────────────────────────────────────
export {
  ProtocolCapabilitySchema,
  RateLimitTierSchema,
  ProtocolSurfaceSchema,
  DynamicContractSchema,
  type ProtocolCapability,
  type RateLimitTier,
  type ProtocolSurface,
  type DynamicContract,
} from '@0xhoneyjar/loa-hounfour/commons';

export {
  AssertionMethodSchema,
  ContractNegotiationSchema,
  type AssertionMethod,
  type ContractNegotiation,
} from '@0xhoneyjar/loa-hounfour/commons';

export {
  isNegotiationValid,
  computeNegotiationExpiry,
  type NegotiationValidityResult,
} from '@0xhoneyjar/loa-hounfour/commons';

export {
  verifyMonotonicExpansion,
  type MonotonicViolation,
  type MonotonicExpansionResult,
} from '@0xhoneyjar/loa-hounfour/commons';

// ─── Enforcement SDK (ADR-008) ──────────────────────────────────────────────
export {
  evaluateGovernanceMutation,
  type GovernanceMutationEvalResult,
} from '@0xhoneyjar/loa-hounfour/commons';

export {
  buildSumInvariant,
  buildNonNegativeInvariant,
  buildBoundedInvariant,
  createBalanceConservation,
  createNonNegativeConservation,
  createBoundedConservation,
  createMonotonicConservation,
} from '@0xhoneyjar/loa-hounfour/commons';

// ─── Error Taxonomy ─────────────────────────────────────────────────────────
export {
  GovernanceErrorSchema,
  type GovernanceError,
  type InvariantViolation,
  type InvalidTransition,
  type GuardFailure,
  type EvaluationError,
  type HashDiscontinuityError,
  type PartialApplication,
} from '@0xhoneyjar/loa-hounfour/commons';
```

**Naming collision handling**: `State`, `Transition`, `StateMachineConfig` from commons conflict with freeside-local `state-machines.ts` exports. Aliased with `Commons` prefix.

#### 3.1.2 Governance v8.2.0

```typescript
// ============================================================================
// Canonical hounfour types — v8.2.0 Autopoietic Loop (cycle-043)
// ModelPerformanceEvent, QualityObservation, 'unspecified' TaskType.
// ============================================================================

export {
  ModelPerformanceEventSchema,
  type ModelPerformanceEvent,
} from '@0xhoneyjar/loa-hounfour/governance';

export {
  QualityObservationSchema,
  type QualityObservation,
} from '@0xhoneyjar/loa-hounfour/governance';
```

**ADR-001 note**: No naming collisions — exported as-is.

### 3.2 DynamicContract Validation at Gateway (FR-4 → G-2, G-3)

#### 3.2.1 Configuration

**New file**: `config/dynamic-contract.json`

```json
{
  "$schema": "dynamic-contract-config",
  "contract_id": "arrakis-gateway-v1",
  "contract_version": "8.2.0",
  "surfaces": {
    "cold": {
      "schemas": ["CompletionRequest", "CompletionResult"],
      "capabilities": ["inference"],
      "rate_limit_tier": "restricted"
    },
    "warming": {
      "schemas": ["CompletionRequest", "CompletionResult", "DomainEvent"],
      "capabilities": ["inference", "tools"],
      "rate_limit_tier": "standard"
    },
    "established": {
      "schemas": ["CompletionRequest", "CompletionResult", "DomainEvent", "EscrowEntry"],
      "capabilities": ["inference", "tools", "ensemble"],
      "rate_limit_tier": "extended"
    },
    "authoritative": {
      "schemas": ["CompletionRequest", "CompletionResult", "DomainEvent", "EscrowEntry", "GovernedCredits"],
      "capabilities": ["inference", "tools", "ensemble", "governance", "byok"],
      "rate_limit_tier": "unlimited"
    }
  }
}
```

#### 3.2.2 Startup Failure Semantics

| Condition | Behavior |
|-----------|----------|
| Config file missing, no override | FATAL — gateway refuses to start. Log: "dynamic-contract.json not found and DYNAMIC_CONTRACT_OVERRIDE not set" |
| Config file malformed JSON | FATAL — log parse error, exit |
| Schema validation failure | FATAL — log validation errors against DynamicContractSchema |
| Monotonic expansion violation | FATAL — log each violation (lower_state, higher_state, type), exit |
| Override present, invalid | FATAL — same validation pipeline, no fallback to file |
| Override present, valid | Use override, log: "Using DYNAMIC_CONTRACT_OVERRIDE (bypassing config file)" |

**Override security**: `DYNAMIC_CONTRACT_OVERRIDE` is restricted to non-production environments via `NODE_ENV !== 'production'` check. In production, the config file is the sole source. Max JSON size: 64KB (truncated with error if exceeded).

**Fail-closed with operational safeguards (SKP-003)**:

1. **CI/CD config validation gate**: Pre-deploy step validates `dynamic-contract.json` against `DynamicContractSchema` + `verifyMonotonicExpansion()`. Bad configs never reach production.
2. **Config checksum in deploy manifest**: Build step computes SHA-256 of config, deploy step verifies checksum matches. Detects config drift between build and deploy.
3. **Canary deploy**: New config rolls to canary instance first; startup success gates full rollout.
4. **No last-known-good fallback** — this is a fail-closed design. A bad config means the gateway does not start, which is safer than serving requests with wrong capability boundaries. The CI/CD gates above prevent this from causing production outages.
5. **Quarantine degraded mode**: When audit quarantine triggers, the gateway enters degraded mode — read-only operations (queries, capability lookups) continue; all governance-critical mutations are rejected with 503. This prevents total outage while maintaining the integrity boundary.

#### 3.2.3 Gateway Integration

**File**: `packages/adapters/agent/request-lifecycle.ts`

Integration at the VALIDATED → RESERVED transition:

```
RECEIVED → VALIDATED → [DynamicContract check] → RESERVED → EXECUTING → FINALIZED
                              ↓
                          FAILED (surface denied)
```

The DynamicContract is loaded once at gateway startup (singleton). On each request:
1. Resolve agent's `ReputationStateName` (see 3.2.3a below)
2. Call `resolveProtocolSurface(contract, state)`
3. If surface undefined → FAILED (unknown reputation state)
4. Call `isCapabilityGranted(surface, requestedCapability)`
5. If not granted → FAILED (capability denied for reputation state)
6. Proceed to RESERVED

#### 3.2.3a Reputation State Resolution (SKP-006)

**Source of truth**: The reputation service is authoritative. JWT `x-reputation-state` claim is used as a cached hint only.

| Resolution Step | Source | Behavior |
|-----------------|--------|----------|
| 1. Check reputation service | gRPC call (cached) | Authoritative answer |
| 2. Service unavailable | — | Fall back to JWT claim if fresh (see below) |
| 3. JWT claim stale or missing | — | Fail-closed → lowest surface (`cold`) |

**Cache policy**:
- Cache TTL: 60 seconds (configurable via `REPUTATION_CACHE_TTL_MS`)
- Cache key: `agent_id` (from JWT sub)
- Stale-while-revalidate: serve cached value for up to 120s while refreshing in background
- Cache miss + service down: fail-closed to `cold` surface

**JWT freshness**: JWT `x-reputation-state` is trusted only if `iat` (issued-at) is within `REPUTATION_JWT_MAX_AGE` (default: 300 seconds) of server time. Older JWTs are treated as stale — the reputation service must be consulted.

**Transition handling**: When an agent's reputation state changes (upgrade or downgrade):
- Upgrade: takes effect on next request after cache TTL expiry
- Downgrade: reputation service push-invalidates cache entry; takes effect immediately
- This prevents privilege escalation from stale JWT claims

**Required tests**:
- Service outage → all requests get `cold` surface
- Stale JWT (iat > 300s old) + service up → service value used
- Stale JWT + service down → `cold` surface (not stale JWT value)
- Downgrade mid-session → cache invalidated, next request gets lower surface

### 3.3 GovernedCredits & Conservation Laws (FR-5 → G-2, G-3)

#### 3.3.1 New Extension Module

**New file**: `themes/sietch/src/packages/core/protocol/arrakis-governance.ts`

```typescript
import {
  evaluateGovernanceMutation,
  createBalanceConservation,
  createNonNegativeConservation,
} from '@0xhoneyjar/loa-hounfour/commons';
import type {
  GovernanceMutation,
  GovernanceMutationEvalResult,
  ConservationLaw,
  AccessPolicy,
} from '@0xhoneyjar/loa-hounfour/commons';

// --- Conservation Law Definitions ---

export const LOT_CONSERVATION: ConservationLaw =
  createBalanceConservation(
    ['balance', 'reserved', 'consumed'],
    'original_allocation',
    'strict',
  );

export const ACCOUNT_NON_NEGATIVE: ConservationLaw =
  createNonNegativeConservation(
    ['balance', 'reserved'],
    'strict',
  );

// --- Mutation Authorization ---

export interface CreditMutationContext {
  actorId: string;          // From resolveActorId() — guaranteed non-empty
  mutationId: string;       // UUID, generated once per logical event
  timestamp: string;        // ISO 8601, generated once per logical event (stable across retries)
  expectedVersion: number;
  accessPolicy?: AccessPolicy;
  reputationState?: string;
  reputationScore?: number;
}

export function authorizeCreditMutation(
  ctx: CreditMutationContext,
): GovernanceMutationEvalResult;
  // 1. Construct GovernanceMutation:
  //    { mutation_id: ctx.mutationId,
  //      actor_id: ctx.actorId,
  //      expected_version: ctx.expectedVersion,
  //      mutated_at: ctx.timestamp }        // Caller-provided, stable
  // 2. Call evaluateGovernanceMutation(mutation, ctx.accessPolicy, {
  //      role: 'billing',
  //      reputation_state: ctx.reputationState,
  //      reputation_score: ctx.reputationScore,
  //    })
  // 3. Return result

// --- actor_id Sourcing ---

export function resolveActorId(
  jwtSub?: string,
  serviceIdentity?: string,
): string;
  // 1. If jwtSub is non-empty string: return jwtSub
  //    (JWT MUST be verified: iss/aud/sig/expiry checked upstream by JWTService)
  //    (sub format validated: UUID pattern for agents, not arbitrary string)
  // 2. If serviceIdentity is non-empty string: return `service:${serviceIdentity}`
  //    (serviceIdentity sourced from mTLS SPIFFE/SVID or service mesh, NOT headers)
  // 3. Throw GovernanceMutationError('actor_id resolution failed: no authenticated identity')
  // NEVER return empty string (v8.1.0 requires minLength: 1)
```

#### 3.3.2 Integration with Existing Conservation

The existing `arrakis-conservation.ts` defines the ERROR TAXONOMY. The new `arrakis-governance.ts` defines the ENFORCEMENT MECHANISM. A conservation law violation produces an `InvariantViolation` error (GovernanceErrorSchema), which maps to a `ConservationErrorCode` (arrakis-conservation.ts). No changes to arrakis-conservation.ts needed.

### 3.4 Audit Trail Hash Chain (FR-6 → G-2, G-3)

**Data integrity design principle**: This system is designed as if millions of lives depend on it. PostgreSQL persistence with domain-separated hashing, two-phase verification, halt-and-reconcile quarantine, and defense-in-depth immutability. Triggers are NEVER disabled. Pruning uses partition detachment.

#### 3.4.1 Database Schema

**New migration**: `packages/adapters/storage/migrations/XXXX_audit_trail.sql`

```sql
-- ==========================================================================
-- Audit Trail — Hash-chained governance log (ADR-006)
-- PostgreSQL >= 14 required (partition trigger inheritance, improved DDL).
-- IMMUTABLE by design. Triggers, RLS, and role privileges enforce this.
-- ==========================================================================

-- Partitioned by month for archival/pruning without trigger bypass
CREATE TABLE audit_trail (
  id              BIGSERIAL,
  entry_id        UUID NOT NULL,
  domain_tag      TEXT NOT NULL,
  event_type      TEXT NOT NULL,
  actor_id        TEXT NOT NULL,       -- NOT NULL: every audit entry has an actor
  payload         JSONB NOT NULL DEFAULT '{}',
  entry_hash      TEXT NOT NULL,
  previous_hash   TEXT NOT NULL,
  event_time      TIMESTAMPTZ NOT NULL,  -- Caller-provided, stable across retries (used in hash)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- Server-generated (partitioning + ordering)

  PRIMARY KEY (id, created_at),        -- Partition key included

  -- Integrity constraints
  CONSTRAINT entry_id_unique UNIQUE (entry_id, created_at),
  -- Algorithm-agile hash format: <algorithm>:<hex>
  -- Currently SHA-256 only; constraint permits future migration (IMP-001)
  CONSTRAINT entry_hash_format CHECK (entry_hash ~ '^[a-z0-9-]+:[a-f0-9]+$'),
  CONSTRAINT previous_hash_format CHECK (previous_hash ~ '^[a-z0-9-]+:[a-f0-9]+$'),
  CONSTRAINT actor_id_nonempty CHECK (char_length(actor_id) >= 1),
  -- Reject grossly skewed event_time (±5 min of server time) (SKP-002)
  CONSTRAINT event_time_skew CHECK (event_time BETWEEN NOW() - INTERVAL '5 minutes' AND NOW() + INTERVAL '5 minutes')
) PARTITION BY RANGE (created_at);

-- Global chain link uniqueness (non-partitioned) — prevents forks across
-- partition boundaries. PG partitioned UNIQUE only enforces per-partition;
-- this table provides global defense-in-depth. (IMP-006/SKP-001)
CREATE TABLE audit_trail_chain_links (
  domain_tag      TEXT NOT NULL,
  previous_hash   TEXT NOT NULL,
  entry_hash      TEXT NOT NULL,
  entry_id        UUID NOT NULL,
  CONSTRAINT unique_chain_link UNIQUE (domain_tag, previous_hash)
);

-- Create initial partition (current month + next month)
CREATE TABLE audit_trail_2026_02 PARTITION OF audit_trail
  FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
CREATE TABLE audit_trail_2026_03 PARTITION OF audit_trail
  FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');

-- Append-only enforcement: triggers prevent UPDATE and DELETE
CREATE OR REPLACE FUNCTION prevent_audit_mutation() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_trail is append-only: % not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_trail_no_update
  BEFORE UPDATE ON audit_trail
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();

CREATE TRIGGER audit_trail_no_delete
  BEFORE DELETE ON audit_trail
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();

-- Indexes
CREATE INDEX idx_audit_trail_entry_hash ON audit_trail (entry_hash);
CREATE INDEX idx_audit_trail_event_type ON audit_trail (event_type);
CREATE INDEX idx_audit_trail_domain_tag ON audit_trail (domain_tag);

-- Checkpoint metadata (separate table, also append-only)
CREATE TABLE audit_trail_checkpoints (
  id               BIGSERIAL PRIMARY KEY,
  domain_tag       TEXT NOT NULL,
  checkpoint_hash  TEXT NOT NULL,
  checkpoint_entry_id UUID NOT NULL,   -- References the checkpointed entry
  entries_before   BIGINT NOT NULL,    -- Count of entries at checkpoint time
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by       TEXT NOT NULL       -- Service identity
);

-- Chain head table for linearization under concurrency
CREATE TABLE audit_trail_head (
  domain_tag      TEXT PRIMARY KEY,
  current_hash    TEXT NOT NULL,
  current_id      BIGINT NOT NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS: app role can only INSERT into audit_trail, SELECT from all
ALTER TABLE audit_trail ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_trail_insert ON audit_trail
  FOR INSERT TO arrakis_app WITH CHECK (true);
CREATE POLICY audit_trail_select ON audit_trail
  FOR SELECT TO arrakis_app USING (true);
-- No UPDATE or DELETE policies — RLS blocks by default

COMMENT ON TABLE audit_trail IS
  'Hash-chained audit log (ADR-006). Append-only. Triggers + RLS + role privileges enforce immutability.';
```

#### 3.4.2 Database Privilege Model

| Role | Permissions | Purpose |
|------|------------|---------|
| `arrakis_app` | INSERT + SELECT on `audit_trail`, `audit_trail_checkpoints`; SELECT + UPDATE on `audit_trail_head` | Application runtime |
| `arrakis_migrator` | DDL (CREATE/ALTER TABLE) | Schema migrations only |
| `arrakis_dba` | Superuser (break-glass) | Emergency only — any use triggers quarantine review |

The application role `arrakis_app`:
- Cannot ALTER tables (cannot disable triggers)
- Cannot DROP tables
- Cannot GRANT privileges
- Is NOT the table owner (owner is `arrakis_migrator`)

Any break-glass superuser access is itself a quarantining event — the audit trail must be re-verified after any superuser session.

#### 3.4.3 Audit Trail Service

**New file**: `packages/adapters/storage/audit-trail-service.ts`

```typescript
export class AuditTrailService {
  constructor(
    private db: DrizzleDB,
    private logger: Logger,
    private contractVersion: string = '8.2.0',
  ) {}

  /**
   * Append a new entry to the audit trail.
   * Uses advisory lock for linearization under concurrency.
   * Hash chain linkage via hounfour library helpers ONLY.
   */
  async append(params: {
    entryId: string;        // UUID, generated once per logical event
    eventTime: string;      // ISO 8601, caller-provided, stable across retries (used in hash)
    eventType: string;
    actorId: string;        // NOT NULL, validated by resolveActorId()
    payload: unknown;
    schemaId: string;
    domainTag?: string;     // Optional override, defaults to buildDomainTag()
  }): Promise<AuditEntry>;
    // 1. Build domain tag: params.domainTag ?? buildDomainTag(params.schemaId, this.contractVersion)
    // 2. Begin SERIALIZABLE transaction
    // 3. Acquire advisory lock: pg_advisory_xact_lock(hashCode(domainTag))
    // 4. Read chain head: SELECT current_hash FROM audit_trail_head WHERE domain_tag = ?
    //    - If no head row: previous_hash = AUDIT_TRAIL_GENESIS_HASH
    //    - If head exists: previous_hash = head.current_hash
    // 5. Compute entry hash: computeAuditEntryHash(
    //      { entry_id: params.entryId, event_time: params.eventTime,
    //        event_type: params.eventType, actor_id: params.actorId,
    //        payload: params.payload },
    //      domainTag)
    //    NOTE: event_time is caller-provided and stable — same hash on retry
    //    NOTE: created_at is server-generated (DEFAULT NOW()) — NOT in hash input
    // 6. INSERT into audit_trail (created_at defaults to NOW(); event_time = params.eventTime)
    // 7. INSERT into audit_trail_chain_links (global uniqueness — SKP-001)
    //    On conflict (domain_tag, previous_hash): idempotency check —
    //    if existing entry_id matches, return existing; else RAISE (fork detected)
    // 8. UPSERT audit_trail_head (set current_hash, current_id)
    // 9. COMMIT
    // 10. On serialization failure: retry up to 3 times with backoff
    //     (entryId + eventTime stable → same hash on retry)
    // 11. On 3rd failure: emit metric 'audit_trail.append.serialization_exhausted', throw

  /**
   * Verify the integrity of the audit trail.
   */
  async verify(options?: {
    domainTag?: string;
    fromId?: number;
    limit?: number;
  }): Promise<AuditTrailVerificationResult>;
    // Uses verifyAuditTrailIntegrity() from hounfour

  /**
   * Create a checkpoint for a domain tag chain.
   */
  async checkpoint(domainTag: string): Promise<CheckpointResult>;
    // 1. Load trail for domainTag
    // 2. Call createCheckpoint(trail)
    // 3. INSERT into audit_trail_checkpoints (append-only)
    // 4. Return result
}
```

**Idempotency**: The `entry_id` (UUID) + `UNIQUE` constraint ensures at-most-once semantics. If a retry inserts a duplicate `entry_id`, the constraint violation is caught and the existing entry is returned. The `event_time` is caller-provided (generated once per logical event) ensuring the hash is deterministic across retries. The `created_at` is server-generated (`DEFAULT NOW()`) and used ONLY for partitioning and ordering — it is NOT part of the hash input (SKP-002).

**Timestamp trust model (SKP-002)**: `event_time` (caller-provided) is validated against server time via a DB CHECK constraint (±5 minute skew tolerance). This prevents backdating/forward-dating while preserving hash determinism. `created_at` (server-generated) handles partition routing and ordering, eliminating clock-skew partition misrouting.

**Linearization**: `pg_advisory_xact_lock` on the domain tag hash serializes concurrent appends within the same chain. Different domain tags can append concurrently without contention.

#### 3.4.3a Append Path SLOs (IMP-003)

The append path is on the critical path for governance mutations (SERIALIZABLE + advisory locks). Target performance budgets:

| Metric | Target | Alert Threshold | Measurement |
|--------|--------|-----------------|-------------|
| `audit_trail.append.latency_p99` | <50ms | >100ms | Transaction open → commit |
| `audit_trail.append.lock_wait_p99` | <10ms | >25ms | Advisory lock acquisition time |
| `audit_trail.append.serialization_retries` | <1% of appends | >5% | Retry count / total appends |
| `audit_trail.append.serialization_exhausted` | 0 | >0 | 3rd retry failure (triggers quarantine investigation) |

**Escalation**: If `lock_wait_p99` exceeds alert threshold for >5 minutes, investigate domain_tag hotspots. If `serialization_retries` exceeds threshold, consider domain_tag sharding or queue-based serialization.

#### 3.4.4 Pruning via Partition Detachment

**Triggers are NEVER disabled.** Pruning uses PostgreSQL partition management:

1. **Archive**: Export old partition data to S3/cold storage (JSON + checksum)
2. **Verify**: Run `verifyAuditTrailIntegrity()` on the partition being archived
3. **Checkpoint**: Create checkpoint at partition boundary in `audit_trail_checkpoints`
4. **Detach**: `ALTER TABLE audit_trail DETACH PARTITION audit_trail_2026_02`
5. **Drop**: `DROP TABLE audit_trail_2026_02` (only after archive verification)
6. **Update verification anchor**: The checkpoint record defines the new verification start point

Post-prune verification starts from the checkpoint anchor, not from genesis. The `verifyCheckpointContinuity()` function validates that the first post-checkpoint entry links to the checkpoint hash.

**Operational procedure**: Pruning is a DBA operation (break-glass), logged in `audit_trail_checkpoints`, and triggers a post-operation integrity re-verification.

#### 3.4.4a Partition Automation (IMP-004)

Missing partitions hard-fail inserts and cascade into system-wide outages (audit writes gate mutations). Automated partition management is required:

1. **Scheduler**: A cron job (or pg_cron) creates partitions with a 2-month look-ahead window
2. **Idempotent creation**: `CREATE TABLE IF NOT EXISTS` — safe to re-run
3. **Alarm**: CloudWatch alert if partition creation fails or look-ahead drops below 1 month
4. **Failure behavior**: If no partition exists for a timestamp, INSERT fails → triggers quarantine for that domain tag
5. **CI gate**: Pre-deploy check validates partitions exist for current + next 2 months

#### 3.4.5 Quarantine Protocol — Fail-Closed

When `verifyAuditTrailIntegrity()` returns `valid: false`:

1. **HALT**: Circuit breaker — stop all audit trail writes for the affected domain tag
2. **FAIL-CLOSED**: Any operation that requires audit append (credit mutations, governance events) is REJECTED with a structured error: `{ code: 'AUDIT_QUARANTINE', domain_tag, failure_index }`
3. **LOG**: CRITICAL alert with `failure_phase`, `failure_index`, `expected_hash`, `actual_hash`
4. **QUARANTINE**: Create `QuarantineRecord` with discontinuity details
5. **NOTIFY**: CloudWatch alarm + PagerDuty escalation
6. **RECONCILE**: Manual investigation required — no automated recovery

**In-flight request handling**: Operations that require audit are fail-closed. The client receives a 503 with `Retry-After` header. Idempotency keys (mutation_id) ensure clients can safely retry after quarantine is resolved.

**Non-critical telemetry** (capability audit events that don't gate mutations): May continue via the existing structured logging path (CloudWatch), but are NOT written to the hash chain during quarantine.

#### 3.4.5a Quarantine Recovery Runbook (IMP-002)

Quarantine without a defined recovery procedure is an availability risk. The following operational runbook is required:

| Step | Action | Role | Evidence Required |
|------|--------|------|-------------------|
| 1 | Alert fires (CloudWatch → PagerDuty) | On-call SRE | Automated |
| 2 | Triage: identify affected domain_tag(s) and failure_index | On-call SRE | `failure_phase`, `expected_hash`, `actual_hash` from alert |
| 3 | Determine root cause (data corruption, bug, clock skew, unauthorized access) | SRE + Engineering | DB query of entries around failure_index |
| 4 | If unauthorized access: escalate to security incident response | Security | pgaudit logs, access logs |
| 5 | Re-verify chain from last known-good checkpoint | Engineering (2-person approval) | `verifyCheckpointContinuity()` output |
| 6 | If chain is recoverable: insert corrective checkpoint, re-verify head | Engineering + DBA | New checkpoint record with justification |
| 7 | Resume writes: reset circuit breaker for affected domain_tag | Engineering (2-person approval) | Full chain verification PASS |
| 8 | Post-incident review within 48 hours | Engineering + SRE | Written incident report |

**Flap prevention**: If quarantine triggers >2 times in 24 hours for the same domain_tag, escalate to P0 and do NOT auto-resume — require manual investigation completion before resuming writes.

#### 3.4.6 Transactional Coupling

For governance-critical operations, the audit append MUST succeed in the same logical transaction as the state mutation:

```
BEGIN SERIALIZABLE;
  -- 1. Authorize mutation (evaluateGovernanceMutation)
  -- 2. Execute state change (UPDATE credits)
  -- 3. Append audit entry (INSERT audit_trail + UPSERT head)
COMMIT;
```

If any step fails, the entire transaction rolls back. No un-audited state transitions are possible.

#### 3.4.6a Authoritative Mutation API — Single Entry Point (SKP-004)

All governed state mutations MUST go through a single authoritative service layer:

**New file**: `packages/adapters/storage/governed-mutation-service.ts`

```typescript
export class GovernedMutationService {
  constructor(
    private db: DrizzleDB,
    private auditTrail: AuditTrailService,
    private logger: Logger,
  ) {}

  /**
   * Execute a governed state mutation with transactional audit coupling.
   * This is the ONLY code path that may mutate governed state.
   */
  async executeMutation<T>(params: {
    mutationId: string;         // UUID, idempotency key
    eventTime: string;          // Caller-provided, stable
    actorId: string;            // From resolveActorId()
    eventType: string;
    schemaId: string;
    mutate: (tx: Transaction) => Promise<T>;  // State mutation within tx
    auditPayload: unknown;      // Metadata for audit entry (no PII)
  }): Promise<{ result: T; auditEntry: AuditEntry }>;
    // 1. Begin SERIALIZABLE transaction
    // 2. Execute params.mutate(tx) — the state change
    // 3. Call this.auditTrail.append() within the SAME transaction
    // 4. COMMIT (both state change + audit, or neither)
    // 5. Return result + audit entry
}
```

**Enforcement**:
- DB privileges: `arrakis_app` role has INSERT/UPDATE on governed tables ONLY via stored procedures or the GovernedMutationService connection
- Integration test: Attempt direct UPDATE on `credits` table outside GovernedMutationService → must fail (privilege denied or trigger rejection)
- Async jobs: Must call GovernedMutationService, never write governed tables directly
- Code review: PR checks for no direct governed table mutations outside the service

### 3.5 ModelPerformanceEvent Handler (FR-7 → G-4)

#### 3.5.1 Reputation Event Router

**New file**: `packages/adapters/agent/reputation-event-router.ts`

```typescript
import type {
  ReputationEvent,
  ModelPerformanceEvent,
  QualityObservation,
  TaskType,
} from '@arrakis/core/protocol';

export function routeReputationEvent(
  event: ReputationEvent,
  ctx: EventRoutingContext,
): Promise<void> {
  switch (event.type) {
    case 'quality_signal':
      return handleQualitySignal(event, ctx);
    case 'task_completed':
      return handleTaskCompleted(event, ctx);
    case 'credential_update':
      return handleCredentialUpdate(event, ctx);
    case 'model_performance':
      return handleModelPerformance(event, ctx);
    default: {
      const _exhaustive: never = event;
      throw new Error(`Unknown ReputationEvent variant: ${(event as any).type}`);
    }
  }
}

async function handleModelPerformance(
  event: ModelPerformanceEvent,
  ctx: EventRoutingContext,
): Promise<void> {
  // 1. Validate QualityObservation (score in [0,1], dimensions pattern)
  // 2. If task_type === 'unspecified': route to aggregate-only scoring
  // 3. Log structured event: model_id, provider, pool_id, score
  // 4. Forward to reputation scoring pipeline (existing BullMQ queue)
  // 5. Emit audit trail entry (FR-6 integration, fail-closed)
}

interface EventRoutingContext {
  logger: Logger;
  auditTrail: AuditTrailService;
  scoringQueue: Queue;
  traceId: string;
}
```

#### 3.5.2 Aggregate-Only Scoring for `'unspecified'` TaskType

When `task_type === 'unspecified'`:
- Score contributes to agent's AGGREGATE reputation only
- No task-type cohort entry is created
- Hash chain continuity preserved via `computeScoringPathHash`
- Logged distinctly: `scoring_path: 'aggregate-only'`

### 3.6 Contract Spec Update (FR-8 → G-6)

**File**: `spec/contracts/contract.json`

- `provider_version_range`: stays `>=7.11.0` in Phase A (dual-accept)
- Add `@0xhoneyjar/loa-hounfour/commons` entrypoint with all 39 consumed symbols
- Add `ModelPerformanceEventSchema`, `QualityObservationSchema` to `/governance` entrypoint
- Update `conformance_vectors.vector_count` and `bundle_hash` after implementation

**arrakis-compat.ts**: `CONTRACT_VERSION` auto-updates via re-export from hounfour. `negotiateVersion()` updated to `preferred: '8.2.0'`, `supported: ['7.11.0', '8.2.0']`.

### 3.7 Conformance Tests (FR-9 → G-7)

#### 3.7.1 Test Tier Strategy

| Tier | Scope | Run When | Budget | Fail Policy |
|------|-------|----------|--------|-------------|
| P0 | Consumed symbols: audit hash, governed resources, reputation events, dynamic contract | Every CI run | <30s | Hard fail, no retry |
| Nightly | All 219 hounfour vectors | Nightly job | <120s | Hard fail, alert |

**Clock injection**: All TTL/expiry vectors receive explicit `clockTime` parameter. No `Date.now()`.

#### 3.7.2 Protocol Conformance Test Updates

**File**: `tests/unit/protocol-conformance.test.ts`

| Test | Change |
|------|--------|
| CONTRACT_VERSION (line 59) | `7.11.0` → `8.2.0` |
| validateCompatibility (lines 63-71) | Add dual-accept tests; mixed-version peer simulation |
| v8.2.0 canonical re-exports | New suite: all barrel exports from `/commons` accessible |
| ADR-001 identity (lines 387-421) | Add Layer 3: `/commons` types go through barrel |
| ModelPerformanceEvent | New test: construct valid/invalid 4th variant |
| QualityObservation | New test: score bounds, dimension patterns |
| Vector count gate (lines 318-340) | Increase threshold to P0 count |

### 3.8 ADR-001 Import Guard Extension (FR-10 → G-5)

No ESLint config changes needed. Import guard enforced by:
1. **ESLint** (`themes/sietch/.eslintrc.cjs:36-59`): Existing `arrakis-*.ts` glob covers new modules
2. **Conformance test** (new Layer 3): Verify `/commons` accessible from barrel, not directly
3. **Code review**: PR checks for no new direct imports

---

## 4. Data Architecture

### 4.1 New Tables

| Table | Purpose | Write Pattern | Integrity | Partitioning |
|-------|---------|---------------|-----------|--------------|
| `audit_trail` | Hash-chained audit log | Append-only (trigger + RLS) | SHA-256 chain | Monthly range |
| `audit_trail_chain_links` | Global chain uniqueness | Append-only (via GovernedMutationService) | UNIQUE(domain_tag, previous_hash) | None |
| `audit_trail_head` | Chain linearization | Single-row per domain_tag | Advisory lock | None |
| `audit_trail_checkpoints` | Checkpoint metadata | Append-only | FK-like + archive_hash | None |

### 4.2 Existing Table Impact

No changes to existing tables. Additive only.

---

## 5. Security Architecture

### 5.1 actor_id Provenance

| Source | Format | Trust Basis | Validation |
|--------|--------|-------------|------------|
| JWT `sub` claim | UUID (agents/users) | S2S JWT verified (iss, aud, sig, expiry) by JWTService | UUID pattern regex |
| Service identity | `service:<name>` | mTLS SPIFFE/SVID from service mesh | Allowlisted service names |
| Empty/missing | REJECTED | — | Throws GovernanceMutationError |

The `resolveActorId()` function NEVER returns an empty string. JWT `sub` is validated as UUID format. Service identity comes from mTLS, never from request headers.

### 5.2 Audit Trail Tamper Detection — Defense in Depth

| Layer | Mechanism | Scope | Bypass Risk |
|-------|-----------|-------|-------------|
| Application | `verifyAuditTrailIntegrity()` | Content + chain | App compromise |
| DB Triggers | BEFORE UPDATE/DELETE → EXCEPTION | Row mutation | ALTER TABLE (DBA only) |
| DB RLS | INSERT + SELECT only for app role | Role-level | Table owner / superuser |
| DB Privileges | App role cannot ALTER, DROP, GRANT | DDL | Superuser (break-glass) |
| Linearization | Advisory lock + head table + chain_links UNIQUE | Concurrent forks | — |
| Privileged audit | pgaudit → CloudWatch WORM | Superuser activity | External log compromise |
| Timestamp trust | event_time ±5min CHECK + server created_at | Clock skew/backdating | — |
| Canonicalization | RFC 8785 JCS (via hounfour) | JSON ordering | — |
| Domain separation | `buildDomainTag()` | Cross-schema collision | — |

Any superuser break-glass access is itself a quarantining event requiring post-session re-verification.

### 5.2a Partition Trigger Enforcement & Privileged Session Auditing (SKP-005)

**PostgreSQL version requirement**: >= 14. PG 14+ automatically clones triggers from the parent partitioned table to each partition. This ensures `audit_trail_no_update` and `audit_trail_no_delete` are enforced on all partitions (including newly created ones) without manual trigger replication.

**Validation**: Migration includes a post-creation check that verifies triggers exist on each partition:
```sql
SELECT tgname FROM pg_trigger
  JOIN pg_class ON pg_trigger.tgrelid = pg_class.oid
  WHERE pg_class.relname LIKE 'audit_trail_20%'
    AND tgname IN ('audit_trail_no_update', 'audit_trail_no_delete');
```
If any partition is missing triggers, the migration fails.

**Privileged session auditing (pgaudit)**:
- `pgaudit` extension enabled for all DB roles
- All DDL and superuser operations logged to an external, immutable destination (CloudWatch Logs with WORM retention policy)
- Superuser session detection: pgaudit log entries with `role = arrakis_dba` trigger a CloudWatch alarm → PagerDuty escalation → mandatory quarantine review
- Archive integrity: Pruned partition archives are cryptographically signed (SHA-256 checksum stored in `audit_trail_checkpoints.archive_hash`) and verified before drop

### 5.3 DynamicContract Surface Isolation

Each reputation state maps to an explicit `ProtocolSurface`. `verifyMonotonicExpansion()` at startup ensures no capability regression. Override restricted to non-production.

### 5.4 No PII in Audit Events

Extends existing invariant (`capability-audit.ts:94`). Payload is metadata-only: no message content, user text, PII.

### 5.5 Observability & Alerting (IMP-005)

Multiple fail-closed subsystems require explicit observability to be operable:

| Signal | Source | Dashboard | Alert Condition |
|--------|--------|-----------|-----------------|
| `audit_trail.append.latency_p99` | AuditTrailService | Governance Health | >100ms for 5min |
| `audit_trail.append.lock_wait_p99` | AuditTrailService | Governance Health | >25ms for 5min |
| `audit_trail.quarantine.triggered` | Quarantine protocol | Governance Health | >0 (P0 alert) |
| `audit_trail.quarantine.flap_count` | Quarantine protocol | Governance Health | >2 in 24h (P0 escalation) |
| `audit_trail.partition.months_ahead` | Partition scheduler | Operations | <1 month ahead |
| `dynamic_contract.startup.failure` | Gateway startup | Deploy Health | >0 (blocks deploy) |
| `dynamic_contract.surface.denied` | Request lifecycle | Access Patterns | Spike detection |
| `governance.mutation.rejected` | authorizeCreditMutation | Governance Health | Rate anomaly |
| `governance.actor_id.resolution_failed` | resolveActorId | Security | >0 (investigate) |
| `reputation.event.unknown_variant` | routeReputationEvent | Protocol Health | >0 (schema drift) |

**Required dashboards**: Governance Health (audit trail + quarantine + mutations), Deploy Health (startup + config), Access Patterns (DynamicContract surface usage by reputation state).

---

## 6. Testing Strategy

### 6.1 Unit Tests

| Component | Test Focus | Files |
|-----------|-----------|-------|
| Protocol barrel | New exports accessible, types correct | `tests/unit/protocol-conformance.test.ts` |
| arrakis-governance.ts | authorizeCreditMutation accept/reject, resolveActorId | `tests/unit/governance-mutation.test.ts` (new) |
| arrakis-dynamic-contract.ts | loadDynamicContract, all failure modes, resolveProtocolSurface | `tests/unit/dynamic-contract.test.ts` (new) |
| reputation-event-router.ts | All 4 variants, exhaustive switch, unspecified TaskType | `tests/unit/reputation-event-router.test.ts` (new) |
| audit-trail-service.ts | append chain linkage, verify integrity, linearization, quarantine | `tests/unit/audit-trail.test.ts` (new) |

### 6.2 Conformance Tests

| Suite | Vector Count | Location |
|-------|-------------|----------|
| P0 (CI) | ~40 vectors | `spec/conformance/test-commons-p0.ts` |
| Full (nightly) | 219 vectors | `spec/conformance/test-full-vectors.ts` |

### 6.3 Integration Tests

| Scenario | Components | Verifies |
|----------|-----------|----------|
| DynamicContract + request lifecycle | Gateway → surface check | Capability gating by reputation |
| Credit mutation + audit trail | Mutation → audit in same tx | Transactional coupling, fail-closed |
| Version negotiation dual-accept | arrakis (8.2.0) ↔ finn (7.11.0) | Mixed-version peer communication |
| Audit linearization | Concurrent appends | Advisory lock prevents forks |
| Quarantine fail-closed | Broken chain → mutation rejected | No un-audited state transitions |

---

## 7. Deployment

### 7.1 Migration Sequence

1. **Create DB roles**: `arrakis_app` (INSERT/SELECT), `arrakis_migrator` (DDL)
2. **Database migration**: Run `XXXX_audit_trail.sql` (new tables, partitions, triggers, RLS)
3. **Dependency update**: `pnpm install` (v8.2.0 pin)
4. **Config deployment**: `config/dynamic-contract.json` added
5. **Application deploy**: Normal deployment — all changes additive

### 7.2 Rollback Plan

- **Pin rollback**: Revert `package.json` to v7.11.0 commit hash
- **Database**: New tables can remain (no existing table changes)
- **Config**: Ignored without gateway code
- **Version negotiation**: Dual-accept means loa-finn still works

---

## 8. Technical Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Conservation law factory counter shared state | Test flakiness | `resetFactoryCounter()` in `beforeEach` |
| Audit trail advisory lock contention | Append latency under burst | Per-domain-tag locking limits contention; monitor lock wait time |
| DynamicContract override in wrong env | Capability bypass | `NODE_ENV !== 'production'` guard |
| Barrel file growing (~700 lines) | Developer friction | Documented sections with clear headers |
| Partition management operational burden | Missing partitions | Automated partition creation job (create next 2 months ahead) |

---

## 9. New Files Summary

| File | Purpose | FR |
|------|---------|-----|
| `themes/sietch/src/packages/core/protocol/arrakis-dynamic-contract.ts` | DynamicContract loading + validation | FR-4 |
| `themes/sietch/src/packages/core/protocol/arrakis-governance.ts` | Conservation laws + mutation authorization | FR-5 |
| `packages/adapters/storage/audit-trail-service.ts` | Hash chain audit trail persistence | FR-6 |
| `packages/adapters/storage/governed-mutation-service.ts` | Authoritative mutation API with transactional audit coupling | FR-5, FR-6 |
| `packages/adapters/storage/migrations/XXXX_audit_trail.sql` | Tables, partitions, triggers, RLS, roles, chain_links | FR-6 |
| `packages/adapters/agent/reputation-event-router.ts` | Exhaustive ReputationEvent handler | FR-7 |
| `config/dynamic-contract.json` | Initial DynamicContract mapping | FR-4 |
| `spec/conformance/test-commons-p0.ts` | P0 conformance vector runner | FR-9 |
| `spec/conformance/test-full-vectors.ts` | Full nightly vector runner | FR-9 |
| `tests/unit/governance-mutation.test.ts` | Mutation authorization tests | FR-5 |
| `tests/unit/dynamic-contract.test.ts` | DynamicContract tests | FR-4 |
| `tests/unit/reputation-event-router.test.ts` | Event routing tests | FR-7 |
| `tests/unit/audit-trail.test.ts` | Audit trail integrity tests | FR-6 |

## 10. Modified Files Summary

| File | Change | FR |
|------|--------|-----|
| `package.json` | Pin v8.2.0 | FR-1 |
| `packages/adapters/package.json` | Pin v8.2.0 | FR-1 |
| `themes/sietch/src/packages/core/protocol/index.ts` | Add commons + governance v8.2.0 exports | FR-2, FR-3 |
| `themes/sietch/src/packages/core/protocol/arrakis-compat.ts` | Dual-accept window, negotiateVersion | FR-8 |
| `spec/contracts/contract.json` | Add `/commons` entrypoint, update metadata | FR-8 |
| `tests/unit/protocol-conformance.test.ts` | Version assertion, new suites | FR-9 |
| `packages/adapters/agent/request-lifecycle.ts` | DynamicContract check at VALIDATED | FR-4 |

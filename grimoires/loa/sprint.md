# Sprint Plan: Hounfour v7.0.0 Protocol Alignment — Cycle 036

**Version:** 3.3.0
**Date:** 2026-02-21
**Cycle:** cycle-036
**Source:** Bridgebuilder Deep Review of PR #86 + remaining LOW findings
**Global Sprint IDs:** 322–325
**Duration:** 4 sprints
**Team:** 1 engineer (AI-assisted)
**Flatline Review:** 4 HIGH_CONSENSUS integrated (IMP-001–IMP-004), 4 BLOCKERs resolved (SKP-001, SKP-002/006, SKP-004, SKP-009), 2 GPT findings integrated (S2S gate, SSE replay)

---

## Context

The Bridgebuilder deep review identified a critical protocol gap: Freeside pins loa-hounfour to commit `d091a3c0` (CONTRACT_VERSION `1.1.0`) while the canonical protocol has progressed to **v7.0.0** — "The Composition-Aware Economic Protocol". Three vendored files duplicate code that should be canonical imports. The v4.6.0 compatibility layer remains active behind a feature flag when v7.0.0 should be the default. Four LOW findings from bridge iteration 3 remain unaddressed.

### Gap Summary

| Category | Current State | Target State |
|----------|--------------|--------------|
| Dependency | Pinned commit `d091a3c0` | v7.0.0 immutable commit SHA |
| CONTRACT_VERSION | `1.1.0` | `7.0.0` |
| Vendored files | 3 files (state-machines, billing-types, guard-types) | Canonical imports from `@0xhoneyjar/loa-hounfour` |
| Compat layer | v4.6.0 backward compat active (feature flag) | v7.0.0 default, v4.6.0 compat removed |
| Type adoption | Partial (arithmetic, conservation, pools) | Full (identity, lifecycle, events, discovery) |
| LOW findings | 4 remaining | 0 |

---

## Sprint Overview

| Sprint | Global ID | Focus | Gate |
|--------|-----------|-------|------|
| Sprint 1 | 322 | Protocol Foundation — v7.0.0 Dep Bump & De-vendoring | Builds clean, CONTRACT_VERSION = 7.0.0, no vendored copies |
| Sprint 2 | 323 | Canonical Type Adoption — Identity, Lifecycle & Events | All canonical types imported, dual-accept active with telemetry, NftId dual-read layer |
| Sprint 3 | 324 | Platform Surface — Discovery, Routing & Conversations | Discovery endpoint live, personality routing via canonical types |
| Sprint 4 | 325 | Hardening — LOW Fixes, S2S Verification & Docs | 0 remaining findings, CORS blocked in prod, S2S gate verified, SSE replay tests pass, BUTTERFREEZONE updated |

---

## Sprint 1: Protocol Foundation — v7.0.0 Dependency & De-vendoring (Global ID: 322)

### Task 1.1: Bump loa-hounfour dependency to v7.0.0

**Files:**
- `package.json` (root devDependency)
- `packages/adapters/package.json` (dependency)

**Description:** Replace the pinned commit reference with the v7.0.0 release. The current pin `github:0xHoneyJar/loa-hounfour#d091a3c0d4802402825fc7765bcc888f2477742f` must be updated to the immutable commit SHA of the v7.0.0 release (resolve the tag to its commit hash before pinning).

**Implementation:**
1. Resolve v7.0.0 tag to its immutable commit SHA: `git ls-remote https://github.com/0xHoneyJar/loa-hounfour refs/tags/v7.0.0` → record the SHA
2. In both `package.json` files, update `@0xhoneyjar/loa-hounfour` to `github:0xHoneyJar/loa-hounfour#<resolved-SHA>` (never a tag or branch ref)
3. Run `pnpm install` to update lockfile
4. Verify lockfile contains the same resolved commit SHA (CI gate: regex check that dep spec is a full SHA)
5. Verify all existing imports resolve correctly with the new version

**Acceptance Criteria:**
- [ ] Both package.json files reference v7.0.0 via **immutable commit SHA** (not tag — Flatline IMP-001/SKP-001)
- [ ] `pnpm install` succeeds without errors
- [ ] All existing imports from `@0xhoneyjar/loa-hounfour` resolve
- [ ] All existing imports from `@0xhoneyjar/loa-hounfour/economy` resolve
- [ ] All existing imports from `@0xhoneyjar/loa-hounfour/integrity` resolve
- [ ] Lockfile pinned to exact commit hash for reproducibility

---

### Task 1.2: Pre-flight compile check before de-vendoring (Flatline IMP-002)

**Description:** Before replacing vendored files (Tasks 1.3–1.5 — state-machines, billing-types, guard-types), run a compile-time compatibility check to verify that v7.0.0 canonical exports match the vendored export surface. This prevents predictable failures during de-vendoring.

**Implementation:**
1. Create a temporary test file that imports all types from both vendored files AND canonical package
2. Use TypeScript `Exact<>` or assignment compatibility checks to verify type-shape match
3. Run `tsc --noEmit` on the test file — if it fails, the canonical types have drifted from vendored
4. Document any mismatches before proceeding with replacement

**Acceptance Criteria:**
- [ ] Compile-time compatibility test created and run before de-vendoring
- [ ] All vendored type exports verified to have canonical equivalents
- [ ] Any shape mismatches documented with adaptation strategy
- [ ] Test removed after de-vendoring complete (one-time gate)

---

### Task 1.3: Replace vendored state-machines.ts with canonical import

**Files:**
- `themes/sietch/src/packages/core/protocol/state-machines.ts` (vendored from commit `d297b019`)
- `themes/sietch/src/packages/core/protocol/index.ts` (barrel re-exports)

**Description:** The vendored state-machines.ts (238 lines) duplicates `StateMachineDefinition`, `isValidTransition()`, `isTerminal()`, and 4 state machine definitions (`RESERVATION_MACHINE`, `REVENUE_RULE_MACHINE`, `PAYMENT_MACHINE`, `SYSTEM_CONFIG_MACHINE`) that are canonical in `@0xhoneyjar/loa-hounfour`. Replace with direct imports.

**Implementation:**
1. Replace the entire vendored file body with re-exports from canonical source:
   ```typescript
   // Canonical imports — de-vendored from commit d297b019
   export {
     StateMachineDefinition,
     isValidTransition,
     isTerminal,
     RESERVATION_MACHINE,
     REVENUE_RULE_MACHINE,
     PAYMENT_MACHINE,
     SYSTEM_CONFIG_MACHINE,
     STATE_MACHINES,
     ReservationState,
     RevenueRuleState,
     PaymentState,
     SystemConfigState,
   } from '@0xhoneyjar/loa-hounfour';
   ```
2. Verify all downstream imports compile — grep for `from.*state-machines` across the codebase
3. Remove the `VENDORED_FROM` provenance constant (no longer needed)

**Acceptance Criteria:**
- [ ] No vendored type/function definitions remain in state-machines.ts
- [ ] All exports are re-exports from `@0xhoneyjar/loa-hounfour`
- [ ] All downstream consumers compile without changes (same export surface)
- [ ] TypeScript strict mode passes (no type widening or narrowing issues)

---

### Task 1.4: Replace vendored billing-types.ts with canonical imports

**Files:**
- `themes/sietch/src/packages/core/protocol/billing-types.ts` (vendored)
- `themes/sietch/src/packages/core/protocol/index.ts` (barrel)

**Description:** billing-types.ts vendors ~15 types (`AgentBillingConfig`, `CreditBalance`, `UsageRecord`, `BillingMode`, `EntryType`, `SystemConfig`, `ResolvedParam<T>`, etc.) and 2 SQL helper functions. Replace type definitions with canonical imports from `@0xhoneyjar/loa-hounfour/economy`. Keep SQL helpers local if they have no canonical equivalent.

**Implementation:**
1. Import canonical types from `@0xhoneyjar/loa-hounfour/economy` and `@0xhoneyjar/loa-hounfour`
2. Re-export all types that have canonical equivalents
3. Keep `buildEntryTypeCheck()` and `buildSourceTypeCheck()` local if they are SQL-specific (not in canonical protocol)
4. Verify that type shapes are compatible — if v7.0.0 has additional fields, extend locally where needed

**Acceptance Criteria:**
- [ ] All type definitions that exist in v7.0.0 are imported, not locally defined
- [ ] SQL helpers remain local only if no canonical equivalent exists
- [ ] `EntryType` union matches v7.0.0 canonical (16 variants)
- [ ] `BillingMode` type matches v7.0.0 canonical (`'shadow' | 'soft' | 'live'`)
- [ ] All downstream consumers compile without changes

---

### Task 1.5: Replace vendored guard-types.ts with canonical imports

**Files:**
- `themes/sietch/src/packages/core/protocol/guard-types.ts` (vendored)
- `themes/sietch/src/packages/core/protocol/index.ts` (barrel)

**Description:** guard-types.ts vendors 2 interfaces (`GuardResult`, `BillingGuardResponse`). Replace with canonical imports.

**Implementation:**
1. Replace with re-exports:
   ```typescript
   export type { GuardResult, BillingGuardResponse } from '@0xhoneyjar/loa-hounfour';
   ```
2. Verify type shape compatibility with v7.0.0

**Acceptance Criteria:**
- [ ] No local type definitions remain in guard-types.ts
- [ ] All exports are re-exports from canonical source
- [ ] Downstream consumers compile without changes

---

### Task 1.6: Update CONTRACT_VERSION and version negotiation

**Files:**
- `packages/adapters/agent/loa-finn-client.ts` — uses `CONTRACT_VERSION` for S2S validation
- `packages/adapters/agent/jwt-service.ts` — embeds `contract_version` claim in JWT
- `themes/sietch/src/packages/core/protocol/arrakis-compat.ts` — re-exports `CONTRACT_VERSION`
- `tests/unit/protocol-conformance.test.ts` — expects specific version

**Description:** After bumping to v7.0.0, `CONTRACT_VERSION` will automatically update to `'7.0.0'` from the package. Update all test expectations and verify that version negotiation with loa-finn still works. The `validateCompatibility()` function enforces `MIN_SUPPORTED_VERSION = '6.0.0'`, so loa-finn must also support v7.0.0.

**Implementation:**
1. Update test expectation in `protocol-conformance.test.ts` from `'1.1.0'` to `'7.0.0'`
2. Update any hardcoded version strings in E2E stubs (`tests/e2e/loa-finn-e2e-stub.ts`)
3. Verify `validateCompatibility()` accepts v7.0.0 peer version
4. Confirm JWT `contract_version` claim is now `'7.0.0'`

**S2S Rollback/Canary Plan (Flatline IMP-001):**
- Before deploying, verify loa-finn peer supports v7.0.0 (`validateCompatibility()` check)
- If peer is still on v6.x, maintain dual-accept window (accept both 6.x and 7.0.0 responses)
- Canary: deploy to staging first, validate S2S handshake, then production
- Rollback: revert dependency pin to previous commit SHA if S2S negotiation fails
- Add integration test: mock loa-finn returning `x-contract-version: 6.0.0` → verify graceful handling

**Acceptance Criteria:**
- [ ] `CONTRACT_VERSION` reports `'7.0.0'` at runtime
- [ ] Protocol conformance tests pass with v7.0.0
- [ ] JWT `contract_version` claim = `'7.0.0'`
- [ ] `validateCompatibility('7.0.0', '7.0.0')` returns compatible
- [ ] E2E stub uses v7.0.0 for both local and peer versions
- [ ] Integration test: graceful handling when peer returns v6.x (Flatline IMP-001)
- [ ] Rollback path documented: revert to previous commit SHA

---

### Task 1.7: Update BILLING_PROTOCOL_VERSION references

**Files:** Search for `BILLING_PROTOCOL_VERSION` or `4.6.0` across the codebase

**Description:** Any remaining references to billing protocol version `4.6.0` must be updated to `7.0.0`. The v7.0.0 protocol unifies billing and core versions into a single `CONTRACT_VERSION`.

**Implementation:**
1. Search for all occurrences of `4.6.0` and `BILLING_PROTOCOL_VERSION`
2. Replace with `CONTRACT_VERSION` from the canonical package where appropriate
3. Remove any separate billing version tracking — v7.0.0 unifies this

**Acceptance Criteria:**
- [ ] No references to `4.6.0` as a protocol version remain
- [ ] Single version source of truth: `CONTRACT_VERSION = '7.0.0'`
- [ ] All S2S headers use unified version

---

### Task 1.8: Verify build and existing test suite

**Files:** All modified files from tasks 1.1–1.7

**Description:** Full build verification after dependency bump and de-vendoring.

**Implementation:**
1. `pnpm build` — all packages compile
2. `pnpm test` — existing test suite passes
3. `pnpm typecheck` (if available) — no type errors
4. Fix any type incompatibilities discovered during compilation

**Type-Shape Contract Tests (Flatline IMP-003):**
Add permanent contract tests that verify canonical imports maintain the expected type shapes. These survive beyond de-vendoring as regression guards:
1. Create `tests/unit/type-shape-contracts.test.ts`
2. For each de-vendored type, add assignment compatibility assertions (e.g., `const _: CanonicalStateMachine = localValue`)
3. Test key runtime invariants: state machine terminal states, billing entry type unions, guard result shape
4. Run as part of CI — prevents silent upstream type drift

**Acceptance Criteria:**
- [ ] `pnpm build` succeeds with 0 errors
- [ ] Existing test suite passes (no regressions)
- [ ] No TypeScript strict mode violations
- [ ] No type widening/narrowing from de-vendoring
- [ ] Type-shape contract tests added and passing (Flatline IMP-003)
- [ ] Contract tests verify: state machines, billing types, guard types, branded arithmetic

---

## Sprint 2: Canonical Type Adoption — Identity, Lifecycle & Events (Global ID: 323)

### Task 2.1: Adopt AgentIdentity with capability-scoped trust_scopes

**Files:**
- `themes/sietch/src/packages/core/protocol/arrakis-compat.ts` — local `TrustScope`, `TrustLevel`, `TRUST_LEVEL_TO_SCOPES`
- `packages/adapters/agent/jwt-service.ts` — JWT claims include trust-related fields

**Description:** v7.0.0 provides canonical `AgentIdentity` with `trust_scopes` as capability-scoped permissions (billing, governance, inference, delegation, audit, composition). The local `TrustScope` union in arrakis-compat.ts (11 values) should be replaced with the canonical type. During the migration window, `normalizeInboundClaims()` must dual-accept both v4.6.0 (integer trust_level) and v7.0.0 (trust_scopes array) formats. The v4.6.0 branch will be removed only after telemetry confirms 0 usage (see Task 2.7).

**Implementation:**
1. Import `AgentIdentity`, `TrustScope` from `@0xhoneyjar/loa-hounfour`
2. Replace local `TrustScope` union with canonical import
3. Keep `TrustLevel` type and `TRUST_LEVEL_TO_SCOPES` mapping **temporarily** for dual-accept window
4. Update `normalizeInboundClaims()` to:
   - Accept v7.0.0 format (trust_scopes array) as primary path
   - Accept v4.6.0 format (integer trust_level) as fallback, converting to trust_scopes via mapping
   - **Log a metric** (`claim_version_seen: 'v4.6.0' | 'v7.0.0'`) on every invocation for telemetry
5. Change `isV7NormalizationEnabled()` to always return true (v7.0.0 is default) but keep the function as a kill-switch
6. Add integration tests covering both claim shapes during the dual-accept window

**Acceptance Criteria:**
- [ ] `TrustScope` imported from canonical, not locally defined
- [ ] `normalizeInboundClaims()` accepts BOTH v4.6.0 and v7.0.0 formats (dual-accept window)
- [ ] v4.6.0 claims are converted to trust_scopes via mapping (not rejected)
- [ ] Claim version metric logged on every invocation (`claim_version_seen`)
- [ ] JWT claims emitted in canonical trust_scopes format (v7.0.0 only on write)
- [ ] Integration tests cover: v7.0.0 claims (pass), v4.6.0 claims (convert + pass), malformed claims (reject)
- [ ] Kill-switch: `PROTOCOL_V7_NORMALIZATION=false` can revert to v4.6.0-only if needed

---

### Task 2.2: Adopt AgentLifecycleState

**Files:**
- New or existing agent state management code
- `themes/sietch/src/packages/core/protocol/index.ts` (barrel)

**Description:** v7.0.0 provides canonical `AgentLifecycleState`: `DORMANT | PROVISIONING | ACTIVE | SUSPENDED | TRANSFERRED | ARCHIVED`. Import and re-export for use in agent thread management and identity tracking.

**Implementation:**
1. Import `AgentLifecycleState` from `@0xhoneyjar/loa-hounfour`
2. Re-export from protocol barrel
3. Add lifecycle state to agent thread model if not already present (or document for future sprint)

**Acceptance Criteria:**
- [ ] `AgentLifecycleState` imported from canonical source
- [ ] Re-exported from protocol barrel for downstream use
- [ ] Type available for agent thread state management

---

### Task 2.3: Adopt canonical NftId format

**Files:**
- `apps/worker/src/handlers/commands/my-agent.ts` — nftId construction
- `apps/worker/src/handlers/commands/my-agent-data.ts` — nftId queries
- `packages/adapters/agent/jwt-service.ts` — nft_id JWT claim

**Description:** v7.0.0 defines canonical NftId format: `eip155:{chainId}/{collectionAddress}/{tokenId}`. Current code uses ad-hoc `wallet:communityId` or similar patterns. Adopt the canonical format with a dual-read compatibility layer and backfill plan for existing records.

**Implementation:**
1. **Inventory storage locations:** Identify all tables/columns/caches where nftId is persisted and indexed (agent_threads, JWT claims, Redis keys, etc.)
2. Import `NftId` type and `parseNftId()` / `formatNftId()` if available from v7.0.0; otherwise create local utilities
3. **Dual-read layer:** Create `resolveNftId(raw: string): NftId` that accepts both old format (`wallet:communityId`) and canonical (`eip155:...`), normalizing to canonical on read
4. **Single-write:** All new records and JWT claims write canonical format only
5. Update nftId construction in `my-agent.ts` to use canonical format via `formatNftId()`
6. Update queries in `my-agent-data.ts` to use `resolveNftId()` for lookups (accept both formats)
7. Use `normalizeWallet()` (from Sprint 321, Task 1.4) on the collection address component
8. **Backfill script:** Create `scripts/backfill-nft-ids.ts` — idempotent script that:
   - Scans agent_threads table for old-format nftId values
   - Converts to canonical format using `formatNftId()`
   - Updates in batches with progress logging
   - Handles collision/ambiguity (old formats that cannot be deterministically mapped → log and skip)
9. Add integration tests proving old-format records remain accessible after deploy

**Acceptance Criteria:**
- [ ] NftId format follows `eip155:{chainId}/{collectionAddress}/{tokenId}` pattern
- [ ] New records use canonical format (single-write)
- [ ] `resolveNftId()` accepts both old and canonical formats (dual-read)
- [ ] JWT `nft_id` claim uses canonical format
- [ ] Backfill script created with idempotency + progress logging
- [ ] Integration tests: old-format nftId lookups still return correct results
- [ ] All storage locations inventoried and documented
- [ ] Collision/ambiguity handling defined (log + skip for unmappable formats)

---

### Task 2.4: Adopt DomainEvent<T> for event sourcing

**Files:**
- `themes/sietch/src/packages/core/protocol/index.ts` (barrel)
- `packages/adapters/agent/capability-audit.ts` — audit event emitter

**Description:** v7.0.0 provides `DomainEvent<T>` with 35+ registered event types across 10 aggregate types. Import the canonical event type and adapt the capability audit emitter to produce canonical domain events.

**Implementation:**
1. Import `DomainEvent`, `DomainEventBatch` from `@0xhoneyjar/loa-hounfour`
2. Re-export from protocol barrel
3. Update `capability-audit.ts` to wrap audit events in `DomainEvent<T>` format:
   - `aggregate_type`: derive from event context (e.g., `'budget'`, `'agent'`)
   - `aggregate_id`: derive from entity ID
   - `event_type`: map to canonical event type string
   - `occurred_at`: ISO timestamp
   - `payload`: the existing audit event data

**Acceptance Criteria:**
- [ ] `DomainEvent<T>` imported from canonical source
- [ ] Audit events wrapped in canonical DomainEvent format
- [ ] `aggregate_type` and `event_type` use v7.0.0 canonical strings
- [ ] Backward-compatible: existing audit log consumers still work

---

### Task 2.5: Adopt StreamEvent discriminated union

**Files:**
- `packages/adapters/agent/loa-finn-client.ts` — SSE stream parsing
- `themes/sietch/src/packages/core/protocol/index.ts` (barrel)

**Description:** v7.0.0 provides canonical `StreamEvent` discriminated union: `stream_start | chunk | tool_call | usage | stream_end | error`. The loa-finn-client currently parses SSE events with ad-hoc type handling. Adopt canonical types.

**Implementation:**
1. Import `StreamEvent` and its constituent types from `@0xhoneyjar/loa-hounfour`
2. Re-export from protocol barrel
3. Update SSE parser in loa-finn-client to type parsed events as `StreamEvent`
4. Verify discriminated union narrowing works in switch/case handlers

**Acceptance Criteria:**
- [ ] `StreamEvent` imported from canonical source
- [ ] SSE parser produces typed `StreamEvent` objects
- [ ] Type narrowing works: `event.type === 'chunk'` narrows to `ChunkEvent`
- [ ] All 6 event types handled (stream_start, chunk, tool_call, usage, stream_end, error)

---

### Task 2.6: Adopt CompletionRequest and CompletionResult

**Files:**
- `packages/adapters/agent/loa-finn-client.ts` — request/response types
- `themes/sietch/src/packages/core/protocol/index.ts` (barrel)

**Description:** v7.0.0 provides canonical `CompletionRequest` (with `execution_mode`, `thinking`, `budget_limit_micro`) and `CompletionResult` (with `usage`, `pricing_applied`). Adopt these as the wire format for loa-finn S2S communication.

**Implementation:**
1. Import `CompletionRequest`, `CompletionResult` from `@0xhoneyjar/loa-hounfour`
2. Re-export from protocol barrel
3. Update loa-finn-client request building to use `CompletionRequest` type
4. Update response parsing to use `CompletionResult` type
5. Map existing fields to canonical field names

**Acceptance Criteria:**
- [ ] `CompletionRequest` and `CompletionResult` imported from canonical source
- [ ] Request builder produces canonical format
- [ ] Response parser expects canonical format
- [ ] `execution_mode`, `thinking`, `budget_limit_micro` fields available
- [ ] `usage` and `pricing_applied` fields parsed from response

---

### Task 2.7: Add JWT claim version telemetry and define v4.6.0 cutoff policy

**Files:**
- `themes/sietch/src/packages/core/protocol/arrakis-compat.ts` — compat layer
- `packages/adapters/agent/jwt-service.ts` — JWT claims

**Description:** Rather than immediately removing v4.6.0 backward compatibility, add telemetry to track claim versions observed in production. Define a bounded cutoff policy: v4.6.0 dual-accept will be removed only after telemetry confirms 0 v4.6.0 claims for N consecutive days (where N >= max JWT TTL in days + session TTL buffer). The actual removal is deferred to a follow-up task after the cutoff condition is met.

**Implementation:**
1. Add structured metric logging in `normalizeInboundClaims()`:
   ```typescript
   logger.info({ claim_version: hasV7Scopes ? 'v7.0.0' : 'v4.6.0', nft_id, source }, 'jwt_claim_version_observed');
   ```
2. Define cutoff policy in code comments and NOTES.md:
   - Cutoff condition: 0 v4.6.0 claims observed for 7 consecutive days (max JWT TTL = 24h + 6d buffer)
   - Monitoring: query structured logs for `jwt_claim_version_observed` where `claim_version = 'v4.6.0'`
   - Removal: once cutoff is confirmed, create a follow-up task to remove `TrustLevel`, `TRUST_LEVEL_TO_SCOPES`, and v4.6.0 branch
3. Keep `validateCompatibility()` and `CONTRACT_VERSION` re-exports (still needed)
4. Simplify `normalizeCoordinationMessage()` — version field is now always required
5. Keep `isV7NormalizationEnabled()` as a kill-switch but default to true

**Acceptance Criteria:**
- [ ] Claim version metric logged on every JWT normalization
- [ ] Cutoff policy documented: 0 v4.6.0 claims for 7 consecutive days → safe to remove
- [ ] `normalizeInboundClaims()` still dual-accepts v4.6.0 and v7.0.0 (NOT removed yet)
- [ ] Kill-switch `PROTOCOL_V7_NORMALIZATION` retained for emergency revert
- [ ] Follow-up task template documented in NOTES.md for eventual removal
- [ ] All tests cover both v4.6.0 and v7.0.0 claim paths

---

## Sprint 3: Platform Surface — Discovery, Routing & Conversations (Global ID: 324)

### Task 3.1: Implement /.well-known/loa-hounfour discovery endpoint

**Files:**
- `themes/sietch/src/api/routes/` — new route file or add to existing
- `themes/sietch/src/api/server.ts` — route registration

**Description:** v7.0.0 defines a `ProtocolDiscovery` schema for `/.well-known/loa-hounfour`. Implement this endpoint to advertise Freeside's protocol capabilities, supported versions, and available features. This enables cross-system protocol negotiation.

**Implementation:**
1. Import `ProtocolDiscovery` type from `@0xhoneyjar/loa-hounfour`
2. Create GET `/.well-known/loa-hounfour` route
3. Return discovery document:
   ```json
   {
     "protocol_version": "7.0.0",
     "min_supported_version": "6.0.0",
     "capabilities": ["billing", "agent_threads", "streaming", "ensemble"],
     "endpoints": { "inference": "/api/inference", "jwks": "/.well-known/jwks.json" }
   }
   ```
4. Cache response (static content, changes only on deploy)
5. No authentication required (public endpoint)

**Schema Validation Tests (Flatline IMP-004):**
Add tests that validate the discovery endpoint response against the canonical `ProtocolDiscovery` JSON schema from v7.0.0. This prevents silent drift in the contract surface:
1. Import or derive JSON Schema from the `ProtocolDiscovery` TypeScript type
2. Use `ajv` (already a project dependency) to validate response body
3. Test: missing required fields → validation error
4. Test: extra fields → allowed (forward-compatible)

**Acceptance Criteria:**
- [ ] GET `/.well-known/loa-hounfour` returns 200 with discovery document
- [ ] Response conforms to `ProtocolDiscovery` schema
- [ ] `protocol_version` matches `CONTRACT_VERSION`
- [ ] No authentication required
- [ ] Response is cacheable (Cache-Control header)
- [ ] Schema validation test using ajv against canonical type (Flatline IMP-004)
- [ ] Test: invalid response shape detected at CI time

---

### Task 3.2: Adopt RoutingPolicy with personality routing

**Files:**
- `packages/adapters/agent/pool-mapping.ts` — current pool resolution
- `themes/sietch/src/packages/core/protocol/index.ts` (barrel)

**Description:** v7.0.0 provides canonical `RoutingPolicy` with personality routing per `TaskType`. Import and integrate with the existing pool resolution system.

**Implementation:**
1. Import `RoutingPolicy`, `TaskType` from `@0xhoneyjar/loa-hounfour`
2. Re-export from protocol barrel
3. Update `resolvePoolId()` to optionally accept a `RoutingPolicy` override
4. When a routing policy is provided, use its task-type-to-pool mapping instead of the default tier-based resolution

**Acceptance Criteria:**
- [ ] `RoutingPolicy` and `TaskType` imported from canonical source
- [ ] `resolvePoolId()` accepts optional `RoutingPolicy` parameter
- [ ] Routing policy overrides default tier-based resolution when provided
- [ ] Backward-compatible: existing callers without routing policy work unchanged

---

### Task 3.3: Adopt BudgetScope with PreferenceSignal

**Files:**
- `packages/adapters/agent/` — budget management
- `themes/sietch/src/packages/core/protocol/index.ts` (barrel)

**Description:** v7.0.0 provides canonical `BudgetScope` with `PreferenceSignal` for expressing user preferences in budget allocation. Import and make available for the budget manager.

**Implementation:**
1. Import `BudgetScope`, `PreferenceSignal` from `@0xhoneyjar/loa-hounfour`
2. Re-export from protocol barrel
3. Add `BudgetScope` as an optional parameter to budget reservation requests
4. When preference signals are present, pass them through to the budget manager

**Acceptance Criteria:**
- [ ] `BudgetScope` and `PreferenceSignal` imported from canonical source
- [ ] Available for budget reservation requests
- [ ] Preference signals forwarded to budget allocation logic

---

### Task 3.4: Adopt Conversation type with sealing policy

**Files:**
- `themes/sietch/src/packages/core/protocol/index.ts` (barrel)

**Description:** v7.0.0 provides canonical `Conversation` type with `ConversationSealingPolicy` and `AccessPolicy`. Import and re-export for use in agent thread management. This lays groundwork for conversation history and audit trail.

**Implementation:**
1. Import `Conversation`, `ConversationSealingPolicy`, `AccessPolicy` from `@0xhoneyjar/loa-hounfour`
2. Re-export from protocol barrel
3. Document mapping between existing agent threads and the Conversation type

**Acceptance Criteria:**
- [ ] Canonical Conversation types imported and re-exported
- [ ] Documentation added mapping agent_threads columns to Conversation fields
- [ ] Types available for downstream adoption

---

### Task 3.5: Adopt EscrowEntry and MonetaryPolicy types

**Files:**
- `themes/sietch/src/packages/core/protocol/index.ts` (barrel)

**Description:** v7.0.0 provides `EscrowEntry` and `MonetaryPolicy` types that formalize the economic guardrails. Import and make available for the billing subsystem.

**Implementation:**
1. Import `EscrowEntry`, `MonetaryPolicy`, `MintingPolicy` from `@0xhoneyjar/loa-hounfour`
2. Re-export from protocol barrel
3. Verify type compatibility with existing reservation/escrow handling

**Acceptance Criteria:**
- [ ] Economic types imported from canonical source
- [ ] Re-exported from protocol barrel
- [ ] No conflicts with existing local types

---

### Task 3.6: Update protocol barrel with all new canonical exports

**Files:**
- `themes/sietch/src/packages/core/protocol/index.ts`

**Description:** Ensure the protocol barrel file cleanly re-exports all canonical types adopted in Sprints 1-3. Organize into logical sections.

**Implementation:**
1. Group exports by domain: core, economy, model, governance, constraints, integrity
2. Remove any remaining local type definitions that have canonical equivalents
3. Add JSDoc comments indicating v7.0.0 source for each group
4. Verify no circular dependencies

**Acceptance Criteria:**
- [ ] All canonical types re-exported through barrel
- [ ] Organized by v7.0.0 sub-package domain
- [ ] No duplicate definitions (canonical only)
- [ ] No circular dependency warnings

---

### Task 3.7: Update ensemble-accounting for canonical cost types

**Files:**
- `packages/adapters/agent/ensemble-accounting.ts`

**Description:** Update the ensemble accounting module to use canonical cost types from v7.0.0 where applicable. Ensure `model_breakdown` array uses canonical `MicroUSD` branded type throughout.

**Implementation:**
1. Verify all cost fields use `MicroUSD` branded type (from already-adopted arrakis-arithmetic)
2. If v7.0.0 provides canonical ensemble types, import them
3. Ensure `platform_cost_micro`, `byok_cost_micro`, `savings_micro` are properly branded

**Acceptance Criteria:**
- [ ] All monetary values use branded `MicroUSD` type
- [ ] Ensemble accounting produces canonical cost structures
- [ ] Per-model breakdown compatible with v7.0.0 billing schema

---

## Sprint 4: Hardening — LOW Fixes, Conformance Tests & Docs (Global ID: 325)

### Task 4.1: Fix insertAgentThread catch branch (LOW — iter3-1)

**File:** `apps/worker/src/handlers/commands/my-agent-data.ts:117-140`

**Description:** The catch block in `insertAgentThread()` uses string matching (`message.includes('unique')`) which is fragile. Since Sprint 321 Task 1.3 added the UNIQUE constraint, the catch should now properly detect constraint violations using the database error code.

**Implementation:**
1. Check if the error has a `code` property (pg uses `'23505'` for unique violation)
2. Replace string matching with: `if ((err as any).code === '23505' || (err as any).code === 'SQLITE_CONSTRAINT_UNIQUE')`
3. Log the original error at `debug` level for observability
4. If error doesn't match unique violation codes, re-throw immediately

**Acceptance Criteria:**
- [ ] Error detection uses DB error codes, not string matching
- [ ] Supports both PostgreSQL (`23505`) and SQLite (`SQLITE_CONSTRAINT_UNIQUE`)
- [ ] Original error logged at debug level
- [ ] Non-unique errors re-thrown without swallowing

---

### Task 4.2: Log fallback handler Discord errors (LOW — iter3-2)

**File:** `apps/worker/src/handlers/events/thread-message-handler.ts:328`

**Description:** The `.catch(() => {})` on the Discord error notification silently swallows send failures. Add logging.

**Implementation:**
1. Replace `.catch(() => {})` with:
   ```typescript
   .catch((discordErr) => {
     msgLog.warn({ discordErr, channel_id }, 'Failed to send error notification to Discord');
   });
   ```

**Acceptance Criteria:**
- [ ] Discord send failures logged at `warn` level
- [ ] Log includes `channel_id` for debugging
- [ ] Error message still sent on success (no behavioral change)

---

### Task 4.3: Add ipNonceRequests cleanup interval (LOW — iter2-4)

**File:** `themes/sietch/src/api/routes/siwe.routes.ts:153-166`

**Description:** The `ipNonceRequests` Map grows without bound. Entries are only overwritten when the same IP returns after window expiry, but IPs that never return accumulate forever.

**Implementation:**
1. Add a cleanup interval after the Map declaration:
   ```typescript
   setInterval(() => {
     const now = Date.now();
     for (const [ip, entry] of ipNonceRequests) {
       if (now > entry.resetAt) {
         ipNonceRequests.delete(ip);
       }
     }
   }, 60_000).unref();
   ```
2. The `.unref()` ensures the interval doesn't prevent process exit

**Acceptance Criteria:**
- [ ] Cleanup interval runs every 60 seconds
- [ ] Expired entries (past `resetAt`) are deleted
- [ ] `.unref()` prevents process hang on shutdown
- [ ] Pattern matches existing `nonceStore` cleanup (lines 88-94)

---

### Task 4.4: Block SIWE wildcard CORS in production (MEDIUM — escalated from iter2-5, Flatline SKP-009)

**File:** `themes/sietch/src/api/routes/siwe.routes.ts:253-261`

**Description:** When `config.cors.allowedOrigins` includes `'*'`, any origin can initiate wallet-signing sessions — this is an auth vulnerability, not just a logging concern. In production, wildcard CORS for SIWE must be blocked. In development/staging, log a warning but allow.

**Implementation:**
1. After the origin validation block (line 261), add environment-aware handling:
   ```typescript
   if (config.cors.allowedOrigins.includes('*')) {
     if (process.env.NODE_ENV === 'production') {
       logger.error(
         { origin: req.headers.origin, address: parsed.address },
         'SIWE session BLOCKED: wildcard CORS not allowed in production'
       );
       return res.status(403).json({
         error: 'CORS configuration error: wildcard not permitted in production'
       });
     }
     logger.warn(
       { origin: req.headers.origin, address: parsed.address },
       'SIWE session issued with wildcard CORS — restrict allowedOrigins before production'
     );
   }
   ```

**Acceptance Criteria:**
- [ ] Production (`NODE_ENV=production`): wildcard CORS **blocks** SIWE with 403
- [ ] Non-production: warning logged but session still issued
- [ ] Log includes origin and wallet address in both cases
- [ ] Error message explains required fix (set explicit allowedOrigins)
- [ ] Tests updated: production wildcard → 403, dev wildcard → 200 + warning

---

### Task 4.5: Update protocol conformance tests for v7.0.0

**Files:**
- `tests/unit/protocol-conformance.test.ts`
- `tests/conformance/jwt-vectors.test.ts`
- `tests/e2e/vectors/index.ts`
- `tests/e2e/loa-finn-e2e-stub.ts`

**Description:** Update all test files to work with v7.0.0 contract version and canonical types. **Important:** v4.6.0 dual-accept test vectors must be KEPT during the migration window (see Tasks 2.1, 2.7) — only remove them in the follow-up task after telemetry cutoff is satisfied.

**Implementation:**
1. Update `CONTRACT_VERSION` expectations from `'1.1.0'` to `'7.0.0'`
2. Update golden test vectors that reference specific version strings
3. **Keep** v4.6.0 JWT claim test vectors (trust_level integer → trust_scopes conversion) — these guard the dual-accept window
4. Add new v7.0.0 test cases for canonical type imports (verify re-exports work)
5. Add test cases verifying dual-accept: v4.6.0 claims normalize to v7.0.0 trust_scopes
6. Update E2E stub to use v7.0.0 version in response headers
7. Mark v4.6.0 test vectors with `// DUAL-ACCEPT: remove after telemetry cutoff (Task 2.7)` comment

**Acceptance Criteria:**
- [ ] All tests pass with v7.0.0 version strings
- [ ] v4.6.0 dual-accept test vectors RETAINED (trust_level → trust_scopes normalization)
- [ ] New v7.0.0 canonical test cases added
- [ ] Golden vectors updated for v7.0.0
- [ ] E2E stub returns v7.0.0 in `x-contract-version` header
- [ ] v4.6.0 vectors annotated with removal gate (telemetry cutoff from Task 2.7)
- [ ] No test regressions

---

### Task 4.6: Update conservation adapter for any new v7.0.0 invariants

**File:** `themes/sietch/src/packages/core/protocol/arrakis-conservation.ts`

**Description:** Check if v7.0.0 added any conservation invariants beyond I-1 through I-14. Update mapping tables (`UNIVERSE_MAP`, `ENFORCEMENT_MAP`, `ERROR_CODE_MAP`, `RECON_CODE_MAP`) if new invariants exist.

**Implementation:**
1. Import fresh `CANONICAL_CONSERVATION_PROPERTIES` from v7.0.0
2. Compare count against current 14 — if new properties exist, add mappings
3. If no new properties, verify existing mappings are still correct
4. Update `fromCanonical()` adapter if canonical schema changed

**Acceptance Criteria:**
- [ ] All v7.0.0 conservation invariants have arrakis mappings
- [ ] No unmapped invariants (count verified)
- [ ] `fromCanonical()` produces correct output for all invariants
- [ ] `getCanonicalProperties()` returns complete set

---

### Task 4.7: Regenerate BUTTERFREEZONE and Ground Truth

**Description:** After all protocol alignment changes, regenerate project documentation.

**Implementation:**
1. Run `.claude/scripts/ground-truth-gen.sh --mode checksums --reality-dir grimoires/loa/reality --output-dir grimoires/loa/ground-truth`
2. Run `.claude/scripts/butterfreezone-gen.sh`
3. Run `.claude/scripts/butterfreezone-validate.sh`
4. Verify all checks pass

**Acceptance Criteria:**
- [ ] Ground Truth checksums updated for all changed reality files
- [ ] BUTTERFREEZONE regenerated with v7.0.0 references
- [ ] Validation passes (all checks green)
- [ ] No stale version references in generated docs

---

### Task 4.8: Update NOTES.md with protocol alignment summary

**File:** `grimoires/loa/NOTES.md`

**Description:** Document the v7.0.0 protocol alignment for cross-session memory.

**Implementation:**
1. Add entry summarizing:
   - Dependency bumped from commit `d091a3c0` to v7.0.0
   - 3 vendored files de-vendored (state-machines, billing-types, guard-types)
   - v4.6.0 compat layer: dual-accept active with telemetry, removal deferred to post-cutoff follow-up
   - Canonical types adopted: AgentIdentity, AgentLifecycleState, DomainEvent, StreamEvent, CompletionRequest/Result, RoutingPolicy, BudgetScope, Conversation, EscrowEntry
   - Discovery endpoint implemented
   - 4 LOW findings resolved
2. Note any remaining gaps for future cycles

**Acceptance Criteria:**
- [ ] NOTES.md updated with protocol alignment summary
- [ ] All adopted types listed
- [ ] Remaining gaps documented (if any)

---

### Task 4.9: Pre-deploy loa-finn version verification gate (GPT BLOCKER-7)

**Description:** Before deploying v7.0.0 changes to staging/production, verify that loa-finn actually supports the protocol version. This is a pre-deploy gate, not a runtime check.

**Implementation:**
1. Create a pre-deploy verification script (`scripts/verify-peer-version.sh`):
   ```bash
   # Hit loa-finn staging discovery endpoint
   curl -s https://loa-finn-staging/.well-known/loa-hounfour | jq '.protocol_version'
   # Verify MIN_SUPPORTED_VERSION accepts 7.0.0
   ```
2. If loa-finn doesn't have a discovery endpoint yet, use the S2S handshake:
   - Send a `validateCompatibility()` probe with `local_version: '7.0.0'`
   - Parse the `x-contract-version` response header
3. Add as a CI/CD gate: deployment to staging blocked until peer version verified
4. Define bounded dual-accept policy for version negotiation:
   - Accept responses with `x-contract-version: 6.x` or `7.0.0`
   - Parse both v6 and v7 response body shapes (field name mapping if needed)
   - Log warning for v6.x responses: "peer on older version, dual-accept active"

**Acceptance Criteria:**
- [ ] Verification script created and documented
- [ ] Script validates loa-finn supports v7.0.0 (or at minimum v6.0.0+)
- [ ] Integration test: mock loa-finn returning v6.0.0 → verify graceful dual-accept
- [ ] Integration test: mock loa-finn returning v7.0.0 → verify normal path
- [ ] Deployment gate documented in deployment runbook
- [ ] Dual-accept policy: which versions accepted, which fields dual-parsed

---

### Task 4.10: SSE transcript replay integration tests (GPT BLOCKER-7)

**Description:** Add integration tests that validate StreamEvent and CompletionRequest/Result parsing against real SSE event streams, not just the updated E2E stub. This catches runtime-only failures from ordering, optional fields, unknown event types, and JSON framing.

**Implementation:**
1. Capture or create representative SSE transcripts:
   - `tests/fixtures/sse-transcript-v7.txt` — canonical v7.0.0 stream with all 6 event types
   - `tests/fixtures/sse-transcript-v6.txt` — v6.x stream (if dual-accept active)
2. Create `tests/integration/sse-replay.test.ts`:
   - Replay each transcript through the SSE parser from `loa-finn-client.ts`
   - Assert each event is correctly typed as `StreamEvent` discriminated union
   - Verify type narrowing: `event.type === 'chunk'` → `event.content` exists
3. Add forward-compatibility test:
   - Inject an unknown event type (`{type: 'future_event', ...}`) into transcript
   - Assert parser does not crash — unknown events are skipped or logged
4. Validate CompletionRequest serialization against JSON schema:
   - Import or derive JSON Schema from `CompletionRequest` type
   - Use `ajv` to validate serialized request body
5. Validate CompletionResult parsing against JSON schema:
   - Use `ajv` to validate response fixtures

**Acceptance Criteria:**
- [ ] SSE transcript fixtures created (v7.0.0, optionally v6.x)
- [ ] Replay test parses all events into correct `StreamEvent` variants
- [ ] Forward-compat test: unknown event type does not crash parser
- [ ] CompletionRequest serialization validated against JSON schema (ajv)
- [ ] CompletionResult parsing validated against JSON schema (ajv)
- [ ] Tests run in CI alongside existing test suite

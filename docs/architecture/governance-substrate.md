# Governance Substrate Architecture

> Architectural reference for the governance substrate introduced in cycle-043.
> Each section is grounded in production code with `file:line` references.

---

## 1. Constitutional Architecture

Conservation laws in Arrakis are **constitutional primitives** — they cannot be
violated by any code path, regardless of the caller's privilege level. This is
the delegation-over-reimplementation pattern: the laws live in loa-hounfour, and
Arrakis delegates enforcement rather than reimplementing invariant checks locally.

Two canonical laws are instantiated at module scope:

- **LOT_CONSERVATION** (`arrakis-governance.ts:27-31`): The sum of all credit lot
  partitions (balance, reserved, consumed) must equal the original allocation at
  all times. This is the financial double-entry bookkeeping invariant — the same
  principle that Stripe uses in their ledger system to ensure money is never
  created or destroyed.

- **ACCOUNT_NON_NEGATIVE** (`arrakis-governance.ts:38-41`): Balance and reserved
  fields can never go negative. This prevents overdraft conditions and is the
  governance equivalent of a bank's "insufficient funds" check.

Both use `strict` enforcement mode, meaning violations throw immediately rather
than logging a warning. This is a deliberate design choice: **the system prefers
unavailability over inconsistency**.

### Connection to Ostrom's Design Principles

Elinor Ostrom's 8 principles for governing the commons map directly to the
governance substrate implementation:

| # | Principle | Implementation |
|---|-----------|---------------|
| 1 | Clear boundaries | `domain_tag` scoping: every audit entry is jurisdictionally bounded to a specific governance domain |
| 2 | Proportional equivalence | `model_performance` scoring: quality observations map to reputation, which maps to capabilities |
| 3 | Collective-choice arrangements | `evaluateGovernanceMutation()` delegation: governance rules live in the protocol library, not in consumer code |
| 4 | Monitoring | Audit trail: every mutation is observed, hashed, and immutable |
| 5 | Graduated sanctions | Circuit breaker: retry (closed) -> quarantine (open) -> half-open probe -> recovery (closed) |
| 6 | Conflict resolution | Dual-accept version negotiation: protocol versions coexist during transitions |
| 7 | Minimal recognition of rights | `resolveActorId()`: identity is established before any mutation is permitted |
| 8 | Nested enterprises | Multi-layer governance: hounfour (constitutional) -> Arrakis (institutional) -> communities (operational) |

---

## 2. Defense-in-Depth

The audit trail uses three independent enforcement layers. Each layer catches a
different class of failure. Removing any single layer leaves the other two intact,
but all three together provide defense against bugs, race conditions, and
malicious actors.

### Layer 1: Advisory Lock (Domain-Scoped Serialization)

**Files**: `audit-helpers.ts:17-25`, `audit-trail-service.ts:145-146`

Before any audit entry is appended, a PostgreSQL advisory lock is acquired using
an FNV-1a hash of the domain tag. This serializes all writes within a governance
domain, preventing concurrent transactions from creating duplicate or conflicting
hash chain entries.

```
SELECT pg_advisory_xact_lock($1)  -- FNV-1a hash of domain_tag
```

The advisory lock is transaction-scoped (`_xact_`), so it is automatically
released on COMMIT or ROLLBACK. This is the same pattern Google Spanner uses for
its external consistency guarantee, adapted for PostgreSQL's advisory lock
primitive.

**What fails without it**: Two concurrent appends to the same domain could both
read the same `previous_hash`, producing a forked chain.

### Layer 2: Chain Links Constraint (Global Fork Prevention)

**File**: `audit-trail-service.ts:178-183`

After computing the entry hash, a row is inserted into `audit_trail_chain_links`
with a UNIQUE constraint on `(domain_tag, previous_hash)`. Even if the advisory
lock fails (e.g., due to a PostgreSQL bug or a misconfigured connection pool),
this constraint prevents two entries from claiming the same predecessor.

**What fails without it**: A hash chain fork across partition boundaries would go
undetected until the next `verify()` call.

### Layer 3: Hash Chain Verification

**File**: `audit-trail-service.ts:156-166, verify() at 234-317`

Each entry's hash is computed by loa-hounfour's `computeAuditEntryHash()`, which
includes the domain tag, entry ID, timestamp, event type, actor ID, and payload.
The `verify()` method reconstructs the chain and validates each link by calling
`verifyAuditTrailIntegrity()`.

**What fails without it**: A corrupted or tampered entry would go undetected. The
hash chain provides the same guarantee as Certificate Transparency logs — any
modification is cryptographically detectable.

### Transaction Isolation

All three layers execute within a `SERIALIZABLE` transaction
(`audit-trail-service.ts:142`, `governed-mutation-service.ts:83`). This ensures
that the state mutation and its audit record are atomic — either both succeed or
neither does.

---

## 3. Fail-Closed Philosophy

The governance substrate consistently chooses **unavailability over
unaccountability**. When in doubt, the system refuses to proceed rather than
silently dropping governance guarantees.

### Circuit Breaker with Quarantine

**File**: `audit-trail-service.ts:70-75, 126-132`

The circuit breaker tracks consecutive verification failures per domain tag. When
the failure threshold is exceeded, the domain is quarantined:

```
closed (normal) -> open (quarantined) -> half-open (probe) -> closed (recovered)
```

A quarantined domain cannot append new audit entries. This means the governed
mutation that triggered the append will also fail, which means the state change
is rejected. The system sacrifices availability for that domain to prevent
unaudited mutations.

This is the Netflix Hystrix pattern, adapted for governance: rather than
protecting a downstream service, it protects the integrity of the audit chain.

### Fail-Closed Audit Stub

**File**: `reputation-event-router.ts:47-51`

The `failClosedAuditStub` is a stub implementation of `AuditTrailPort` that
throws `AuditTrailNotReady` on any append attempt. This is wired during bootstrap
before the real audit trail is available. Any attempt to record a reputation event
before the infrastructure is ready results in an immediate, visible error rather
than a silent drop.

### DynamicContract Cold Fallback

**File**: `arrakis-dynamic-contract.ts:214-225`

When `resolveProtocolSurface()` encounters an unknown reputation state, it falls
back to the `cold` surface — the most restrictive capability set. An unknown
agent gets minimal access, not maximal access.

---

## 4. Capability Algebra

The DynamicContract defines a mapping from **trust** (reputation state) to
**capability** (protocol surface). This is a monotonic algebra: moving from lower
reputation to higher reputation never removes capabilities.

### Structure

**File**: `arrakis-dynamic-contract.ts:27-32`

A `ProtocolSurface` defines what an agent can do:
- `schemas[]` — which API schemas the agent can access
- `capabilities[]` — boolean capability flags (e.g., `can_use_ensemble`)
- `rate_limit_tier` — throughput allocation
- `ensemble_strategies[]` — which multi-model strategies are available

### Monotonic Expansion Invariant

**File**: `arrakis-dynamic-contract.ts:182-192`

At startup, `verifyMonotonicExpansion()` validates that for every pair of
reputation states (a, b) where a < b:

```
surface(b).capabilities >= surface(a).capabilities
surface(b).schemas >= surface(a).schemas
```

If this invariant is violated, the process refuses to start. This prevents
configuration errors that would create "capability cliffs" — situations where
gaining reputation actually reduces access.

### Connection to Multi-Model Routing

The capability algebra connects directly to the agent gateway's routing logic.
When a model's reputation improves, its `ProtocolSurface` expands, granting
access to more schemas, higher rate limits, and ensemble strategies. This creates
a positive feedback loop: good performance -> higher reputation -> more
capabilities -> more opportunity to demonstrate good performance.

---

## 5. Evolutionary Pressure

### Exhaustive Switch + Never Type

**File**: `reputation-event-router.ts:167-289`

The reputation event router handles 4 event variants via an exhaustive switch.
The `default` branch assigns the event to `never`, which causes a compile-time
error if a new variant is added to the `ReputationEvent` union without adding a
corresponding case.

```typescript
default: {
  const _exhaustive: never = event;
  // compile-time error if variants are unhandled
}
```

This is a deliberate evolutionary pressure mechanism: adding a new reputation
event type to loa-hounfour forces every consumer to acknowledge it. The type
system becomes an enforcement tool — you cannot add a new variant without
updating all handlers.

This is the same pattern TypeScript uses in Redux reducers and the same principle
behind Protocol Buffers' unknown field handling in gRPC.

---

## 6. Version Negotiation

### Dual-Accept Strategy

**File**: `loa-finn-client.ts:453-469`

The version negotiation strategy uses a dual-accept approach during protocol
evolution:

1. **Missing header**: Tolerated (backward compatibility with older loa-finn
   versions that don't send `x-contract-version`)
2. **Present header**: Validated against `validateCompatibility()` — throws
   `ContractVersionMismatchError` if incompatible

This enables a three-phase transition:

| Phase | State | Behavior |
|-------|-------|----------|
| A | Old version only | No header sent, no validation |
| B | Mixed versions | New sends header, old doesn't; new validates when present |
| C | New version only | All send header, all validate |

The dual-accept strategy is how the governance substrate can evolve its protocol
surface without requiring a coordinated big-bang deployment. This is the same
approach Google uses for Protobuf wire compatibility and Stripe uses for API
versioning.

---

## References

| Component | File | Key Lines |
|-----------|------|-----------|
| Conservation Laws | `themes/sietch/src/packages/core/protocol/arrakis-governance.ts` | 27-41 |
| Advisory Lock | `packages/adapters/storage/audit-helpers.ts` | 17-25 |
| Audit Trail | `packages/adapters/storage/audit-trail-service.ts` | 70-75, 126-132, 142-183, 234-317 |
| Governed Mutation | `packages/adapters/storage/governed-mutation-service.ts` | 83 |
| DynamicContract | `themes/sietch/src/packages/core/protocol/arrakis-dynamic-contract.ts` | 27-32, 182-225 |
| Event Router | `packages/adapters/agent/reputation-event-router.ts` | 47-51, 102-106, 167-289 |
| Version Negotiation | `packages/adapters/agent/loa-finn-client.ts` | 453-469 |

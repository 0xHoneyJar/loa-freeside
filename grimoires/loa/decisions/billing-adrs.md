# Billing System Architectural Decision Records

Sprint 238, Task 9.1 — Bridgebuilder-requested documentation.

---

## ADR-001: SQLite over PostgreSQL for the Credit Ledger

**Status:** Accepted
**Date:** 2026-02-15
**SDD ref:** &sect;1.4 CreditLedgerService

### Context

The credit ledger requires ACID transactions for monetary operations (reserve, finalize, consume). The platform already runs SQLite for other data stores.

### Decision

Use SQLite with WAL mode as the credit ledger database engine.

### Consequences

- **Positive:** Zero-dependency deployment; single-process write model prevents data races; `BEGIN IMMEDIATE` provides serializable isolation; WAL mode allows concurrent reads during writes; no connection pooling or network latency.
- **Negative:** Single-writer bottleneck limits throughput to ~1000 writes/sec; horizontal scaling requires sharding or migration to PostgreSQL.

### Alternatives Considered

- **PostgreSQL:** Higher throughput, but adds operational complexity (connection pooling, separate process, backup strategy). Premature for current traffic.
- **DynamoDB:** Serverless scaling, but eventual consistency model conflicts with monetary invariants.

---

## ADR-002: FIFO over LIFO for Lot Consumption

**Status:** Accepted
**Date:** 2026-02-15
**SDD ref:** &sect;1.4 CreditLedgerService, CreditLedgerAdapter.consumeLots()

### Context

When a reservation is finalized, credits must be consumed from credit lots. The consumption order determines which lots expire first.

### Decision

Consume lots in FIFO order (`ORDER BY created_at ASC`), consuming oldest lots first.

### Consequences

- **Positive:** Campaign credits with expiry dates are consumed before they expire; aligns with financial policy for perishable assets (parallels AWS Credits); predictable for users who can see "oldest credits used first."
- **Negative:** Slightly more complex than LIFO for lot query ordering.

### Alternatives Considered

- **LIFO:** Simpler mentally ("use newest first"), but causes oldest credits to expire unused — customer-hostile for time-limited promotions.
- **Priority-based:** Custom ordering per lot type. Over-engineered for current needs; FIFO covers the campaign expiry case.

---

## ADR-003: Separate JWT Secrets for Admin vs S2S

**Status:** Accepted
**Date:** 2026-02-15
**SDD ref:** &sect;5.7 Auth Model

### Context

The billing system has two internal auth contexts: admin dashboard (human operators) and S2S finalize (loa-finn service). Both use HS256 JWTs.

### Decision

Use separate JWT secrets: `BILLING_ADMIN_JWT_SECRET` for admin routes and `BILLING_INTERNAL_JWT_SECRET` for S2S routes.

### Consequences

- **Positive:** Defense in depth — compromised admin secret cannot forge S2S tokens and vice versa; different `aud` claims (`arrakis-admin` vs `arrakis-internal`) provide additional verification; blast radius of a single secret leak is contained.
- **Negative:** Two secrets to manage and rotate instead of one.

### Alternatives Considered

- **Single shared secret:** Simpler rotation, but a compromise exposes both admin and S2S contexts.
- **Asymmetric (RS256):** See ADR-004 for why this was deferred.

---

## ADR-004: HS256 over RS256 for Internal JWTs

**Status:** Accepted
**Date:** 2026-02-15
**SDD ref:** &sect;5.7 Auth Model

### Context

Internal JWTs are verified only by arrakis services. There is no need for third-party token verification.

### Decision

Use HS256 (symmetric HMAC) for all internal JWT signing.

### Consequences

- **Positive:** Symmetric simplicity — single secret shared between issuer and verifier; no public key distribution infrastructure; faster verification than RSA; single secret rotation mechanism.
- **Negative:** Cannot distribute verification without sharing the signing secret; if a third-party service needs to verify tokens, RS256 would be required.

### Alternatives Considered

- **RS256 (asymmetric):** Enables public key distribution for third-party verification. Not needed today — all verification is internal. Migration path: add RS256 when/if external consumers appear.
- **Ed25519 (EdDSA):** Modern and fast, but not natively supported by the JWT library in use. Future consideration.

---

## ADR-005: Foundation Absorbs Truncation Remainder in Revenue Distribution

**Status:** Accepted
**Date:** 2026-02-15
**SDD ref:** &sect;1.4 RevenueDistributionService

### Context

Revenue distribution splits charges into three pools using basis points (bps). Integer division of micro-USD values causes truncation remainders (e.g., 1,000,001 &micro;USD &times; 500/10000 = 50,000.05 truncated to 50,000).

### Decision

Calculate commons and community shares via integer division, then assign `foundation_share = charge - commons_share - community_share`. Foundation absorbs all truncation remainder.

### Consequences

- **Positive:** Zero-sum invariant guaranteed — `commons + community + foundation = charge` always holds exactly; no rounding drift accumulates over time; simplest implementation with strongest correctness guarantee.
- **Negative:** Foundation share may be 1-2 micro-USD higher than the "true" fractional value per transaction. At scale this is negligible.

### Alternatives Considered

- **Round-robin remainder:** Distribute remainder across pools in rotation. More "fair" but breaks zero-sum simplicity and requires tracking rotation state.
- **Largest-remainder method:** Assign remainder to pool with largest fractional part. Correct but adds branching logic with minimal practical benefit at micro-USD scale.

---

## ADR-008: Identity Anchor Trust Model

**Status:** Accepted
**Date:** 2026-02-15
**SDD ref:** &sect;2.4 Identity Anchors
**Sprint ref:** 247 (Cycle 027, Task 3.3)

### Context

Agent wallets interact with the billing system for credit management. High-value operations require stronger identity verification than basic JWT authentication. A sybil-resistant mechanism is needed to tie agent wallets to on-chain NFT ownership.

### Decision

#### Derivation

Identity anchors are derived deterministically from on-chain data:

```
anchor = SHA-256(chainId + contractAddress + tokenId + ownerAddress)
```

- **Deterministic:** Same inputs always produce the same anchor
- **On-chain-verifiable:** All inputs are publicly available on-chain
- **Collision-resistant:** SHA-256 provides 128-bit collision resistance

#### Sybil Resistance

One NFT = one anchor = one agent wallet.

Enforced via:
- `UNIQUE` constraint on `identity_anchor` in `agent_identity_anchors` table
- `INSERT OR IGNORE` for idempotent creation (same account can re-register)
- On-chain ownership can be re-verified at any time

#### Four-Eyes Model

Anchor rotation requires a different actor (JWT `sub`) than the original creator:
- `rotated_by !== created_by` enforced at `POST /admin/billing/agents/:id/rotate-anchor`
- Trust assumption: distinct JWT subjects correspond to distinct authorized entities
- Rotation audit logs previous anchor hash (truncated to first 8 chars) for traceability

#### Graduated Trust

Operations below `high_value_threshold_micro` (default: 100,000,000 = $100 USD) proceed with basic auth only. Above threshold, identity anchor is required.

Feature flag `enabled: false` by default for backward compatibility. Purchase endpoints (`/api/billing/credit-packs/*`) are exempt from anchor checks to prevent a deadlock where credits are needed to establish identity.

### Attack Surface

| Attack | Mitigation |
|--------|-----------|
| Anchor collision | SHA-256 pre-image resistance (2^128) |
| Ownership transfer | Re-verification needed; rotation audit trail |
| Key compromise | Rotation path with four-eyes enforcement |
| Sybil via multiple NFTs | One NFT = one anchor; UNIQUE DB constraint |
| Self-rotation bypass | `rotated_by !== created_by` check |

### Consequences

- **Positive:** Sybil-resistant identity binding for high-value operations; graduated trust allows low-value operations without friction; feature flag allows incremental rollout.
- **Negative:** Requires NFT ownership as identity prerequisite; four-eyes model assumes JWT subject uniqueness.

### Alternatives Considered

- **Flat trust (no graduation):** Simpler, but anchor requirement on all operations creates friction for low-value usage. Graduated model matches risk profile.
- **DID-based identity:** W3C Decentralized Identifiers provide richer identity. Over-engineered for current NFT-bound agent model. Migration path exists if needed.

---

## ADR-009: SQLite→PostgreSQL Migration Path

**Status:** Accepted
**Date:** 2026-02-15
**SDD ref:** &sect;3.1 Data Architecture
**Sprint ref:** 250 (Task 6.3)

### Context

The credit ledger uses SQLite with WAL mode. SQLite's single-writer model provides serializable isolation with ~1K-5K writes/sec throughput. This is adequate for current traffic but has a known scaling ceiling.

### Current State

- SQLite WAL mode: single-writer, concurrent reads
- Throughput: ~1,000-5,000 writes/sec (depending on transaction complexity)
- Single-process deployment: no write contention from multiple servers
- Adequate for < 500 concurrent inference requests/sec (~1,000 writes/sec with reserve+finalize pairs)

### Trigger Threshold

Migrate when sustained traffic exceeds **500 concurrent inference requests/sec**. At this level, reserve+finalize pairs produce ~1,000 writes/sec, approaching SQLite's practical ceiling with transaction overhead.

Leading indicators to monitor:
- Reserve latency P99 > 50ms (currently ~5ms)
- WAL file size sustained > 100MB
- Transaction retry rate > 1%

### Migration Strategy

1. **Implement `PostgresCreditLedgerAdapter`** behind the existing `ICreditLedgerService` port. The port interface is database-agnostic — no consumer code changes required.

2. **Dual-write phase** (2 weeks minimum):
   - SQLite remains primary for reads and writes
   - Postgres receives shadow writes (same transactions, fire-and-forget)
   - Compare read results periodically (shadow reconciliation)
   - Monitor Postgres latency and error rates

3. **Cutover**:
   - Switch primary from SQLite to Postgres
   - SQLite becomes read-only fallback
   - 7-day validation window before decommissioning SQLite

### Data Migration

```bash
# 1. Export from SQLite
sqlite3 billing.db ".mode csv" ".output credit_lots.csv" "SELECT * FROM credit_lots;"
# Repeat for all tables in dependency order

# 2. Import to Postgres
psql billing_db -c "\\COPY credit_lots FROM 'credit_lots.csv' WITH CSV HEADER"

# 3. Verify lot invariants post-migration
npx tsx scripts/verify-lot-invariants.ts --postgres postgres://localhost/billing_db
```

### Lot Invariant Verification

Post-migration verification is critical. Run `scripts/verify-lot-invariants.ts` against Postgres to confirm:
- `available_micro + reserved_micro + consumed_micro = original_micro` for every lot
- Total available across all lots matches `credit_balances` cache
- No orphaned reservation_lots referencing non-existent reservations

### Rollback

- Keep SQLite database file intact during 7-day validation window
- Rollback: point `ICreditLedgerService` back to `CreditLedgerAdapter` (SQLite)
- No data loss: SQLite was the primary during dual-write phase

### Consequences

- **Positive:** Postgres supports horizontal read scaling (replicas), higher write throughput (10K+ writes/sec), richer query capabilities (JSONB, window functions), native connection pooling.
- **Negative:** Operational complexity (connection pooling, backup strategy, separate process), network latency on queries, requires DevOps capability for Postgres management.

### Alternatives Considered

- **CockroachDB:** Distributed SQL with strong consistency. Over-engineered for single-region deployment. Consider if multi-region becomes necessary.
- **TiKV + TiDB:** Distributed KV with SQL layer. Same over-engineering concern as CockroachDB.
- **Sharded SQLite:** Multiple SQLite files partitioned by account. Increases complexity without solving single-writer bottleneck per shard.

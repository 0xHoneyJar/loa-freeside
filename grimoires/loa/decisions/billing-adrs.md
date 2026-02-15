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

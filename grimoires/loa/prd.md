# PRD: The Forward Path — Strategic Excellence & Cross-System Hardening

**Version:** 1.0.0
**Status:** Active
**Cycle:** 028
**Created:** 2026-02-15
**Author:** Claude Opus 4.6 + Human (Merlin)

**References:**
- PR #63 (arrakis): Billing & Credit Ledger System — Bridgebuilder Deep Review (3 parts)
- PR #63 Bridge Review: FLATLINE at iteration 2 (severity 6.0 -> 0.0)
- RFC #66 (loa-finn): Launch Readiness Gap Analysis
- RFC #62 (arrakis): Billing & Payments Path to Revenue
- RFC #31 (loa-finn): The Hounfour Multi-Model Provider Abstraction
- PR #2 (loa-hounfour): The Agent Economy v4.6.0
- Issue #247 (loa): Meeting Geometries — Multi-Model Collaboration Protocols

---

## 1. Problem Statement

Cycle 027 ("Shai-Hulud") delivered the full billing and credit ledger system: property-based lot invariant testing, atomic counter (3 backends), graduated identity trust, credit pack pricing, x402 payment middleware, rate limiting, revenue governance versioning, and full-loop E2E integration. The bridge achieved FLATLINE in 2 iterations with 3 PRAISE, 2 MEDIUM (resolved), 2 LOW (resolved), 0 BLOCKERS.

The Bridgebuilder Deep Review (3 parts, posted on PR #63) identified concrete next steps:

1. **Code scanning debt**: 12 GitHub code-scanning alerts for missing rate limiting on billing/admin routes. These are existing routes that weren't wired to the Sprint 250 rate limiter.

2. **Identity anchor S2S protocol**: The graduated trust model documents two verification approaches (JWT-embedded for low-value, synchronous S2S for high-value) but neither is implemented as a callable endpoint. The S2S endpoint is the arrakis-side prerequisite for cross-system identity verification.

3. **Atomic counter extraction**: The `ICounterBackend` interface and 3 backend implementations are domain-agnostic with zero billing-specific dependencies. Extracting to `packages/shared/atomic-counter/` enables reuse by loa-finn, gateway, and future services.

4. **loa-hounfour schema mapping**: The billing system's internal credit ledger entries need a translation layer to speak loa-hounfour's `BillingEntry` schema at S2S boundaries. This is protocol adoption at the boundary, not a rewrite.

5. **Cross-system E2E scaffold**: PR #63's E2E infrastructure (Docker Compose, billing-full-loop tests) provides the arrakis side. The next step is extending the scaffold to include a loa-hounfour contract validator service for cross-system smoke tests.

### Constraint: Excellence Without Perfectionism

Each task earns its place by making the system more correct (rate limiting), more interoperable (schema mapping, S2S endpoint), or more reusable (counter extraction). No premature abstractions. No features without consumers.

---

## 2. Goals

| ID | Priority | Goal | Success Metric |
|----|----------|------|----------------|
| G-1 | P0 | Resolve all 12 code-scanning rate limiting alerts | 0 open code-scanning alerts on PR #63 |
| G-2 | P0 | Identity anchor S2S verification endpoint | POST /api/internal/verify-anchor returns 200/403 |
| G-3 | P1 | Atomic counter extraction to shared package | `packages/shared/atomic-counter/` with existing tests passing |
| G-4 | P1 | loa-hounfour BillingEntry schema mapping at S2S boundary | Mapper converts internal ledger entries to BillingEntry format |
| G-5 | P2 | Cross-system E2E test scaffold with contract validator | Docker Compose service validates loa-hounfour schemas |

---

## 3. Stakeholders

| Role | Interaction with This Cycle |
|------|---------------------------|
| **Security** | Rate limiting coverage on all exposed routes (G-1) |
| **loa-finn Service** | S2S anchor verification (G-2), shared counter (G-3), schema interop (G-4) |
| **Developer** | Clean shared package boundary (G-3), cross-system test scaffold (G-5) |
| **Operator** | Security posture improvement (G-1), operational endpoints (G-2) |

---

## 4. What Already Exists (Cycle 027 Deliverables)

| Component | Status | Key Files |
|-----------|--------|-----------|
| Rate limiter middleware | Production | `adapters/middleware/rate-limiter.ts` |
| Identity trust evaluator | Production | `core/protocol/identity-trust.ts` |
| Atomic counter (3 backends) | Production | `core/protocol/atomic-counter.ts` |
| Credit ledger with lot invariant | Production | `core/billing/credit-ledger.ts` |
| x402 payment middleware | Production | `core/billing/x402-config.ts` |
| Revenue governance versioning | Production | migration 041 |
| E2E full-loop tests | Production | `tests/e2e/billing-full-loop.e2e.test.ts` |
| Docker Compose E2E | Production | `tests/e2e/docker-compose.e2e.yml` |

---

## 5. Non-Goals

| Item | Reason |
|------|--------|
| Horizontal scaling (Redis for all state) | No scaling pressure yet. In-memory is correct for single-instance. |
| Full Hounfour routing integration | Hounfour not deployed. Build contract layer first. |
| Formal TLA+ specification | Property-based testing sufficient at this scale. |
| Credit pack marketplace | Revenue model not validated. Keep fixed tiers. |
| Multi-currency support | USDC-only is correct simplification for launch. |

---

## 6. Technical Approach

### 6.1 Rate Limiting Coverage (G-1)

Wire the existing `rateLimiter` middleware to all exposed billing and admin routes. Internal S2S routes authenticated with `BILLING_INTERNAL_JWT_SECRET` may be exempted with documented rationale. Health/readiness endpoints exempted unconditionally.

### 6.2 Identity Anchor S2S Endpoint (G-2)

Create `POST /api/internal/verify-anchor` that accepts `{ accountId, anchor }` and returns:
- 200 with `{ verified: true, anchor_hash: "sha256:..." }` if anchor matches
- 403 with `{ verified: false, reason: "anchor_mismatch" }` if not
- Authenticated via `BILLING_INTERNAL_JWT_SECRET` (same S2S auth as finalize endpoint)

### 6.3 Atomic Counter Extraction (G-3)

Move `ICounterBackend`, `IAtomicCounter`, `AtomicCounterConfig`, `createAtomicCounter`, and the 3 backend implementations to `packages/shared/atomic-counter/`. Update arrakis imports. Preserve all existing tests.

### 6.4 Schema Mapping Layer (G-4)

Create a mapper module that translates internal credit ledger entries to loa-hounfour `BillingEntry` format at the S2S boundary. The mapper handles field mapping (micro-USD to `total_micro`, lot IDs to `reference_id`, etc.) without changing internal representations.

### 6.5 Cross-System E2E Scaffold (G-5)

Add a lightweight contract validator service to Docker Compose that validates JSON payloads against loa-hounfour JSON schemas. Extend the existing E2E tests to verify that S2S responses conform to the protocol schema.

# PRD: The Golden Path — E2E Vector Migration & Launch Validation

**Version:** 1.1.0
**Cycle:** 024
**Date:** 2026-02-13
**Status:** Draft
**References:** [RFC #31](https://github.com/0xHoneyJar/loa-finn/issues/31) · [loa-hounfour v1.1.0](https://github.com/0xHoneyJar/loa-hounfour) · [Command Deck Round 8](https://github.com/0xHoneyJar/loa-finn/issues/31#issuecomment-3896482790)

---

## 1. Problem Statement

RFC #31 is at 97% completion. 36 agent modules (9,600 lines), 28 test files (11,000 lines), a Rust gateway with structured error taxonomy, and the shared protocol package (`@0xhoneyjar/loa-hounfour` v1.1.0) are all merged to main across 4 repos with zero open PRs.

The remaining 3% is a validation gap: the E2E test suite cannot run.

**Root cause:** The E2E tests (`tests/e2e/agent-gateway-e2e.test.ts`) reference `getVector()` from a `packages/contracts/` directory that **does not exist**. The import is commented out, `VECTORS_AVAILABLE` is hardcoded to `false`, and `TEST_VECTORS` / `CONTRACT_SCHEMA` in the stub are empty placeholders. Meanwhile, loa-hounfour v1.1.0 ships **56+ golden test vectors** (`vectors/budget/`, `vectors/jwt/`) and pre-compiled validators — they just aren't connected.

The code is written. The tests pass (unit + integration). The contracts are shared. What's missing: wire the vectors, validate the round-trip, then ship.

> Sources: First-principles codebase audit (`git log main`, file system traversal, GitHub API), E2E test file analysis, loa-hounfour `node_modules` inspection.

---

## 2. Goals & Success Metrics

| ID | Goal | Metric | Priority |
|----|------|--------|----------|
| G-1 | Wire loa-hounfour test vectors into E2E suite | `VECTORS_AVAILABLE = true`; all 9 E2E scenarios use real vectors | P0 |
| G-2 | E2E test suite passes end-to-end | `SKIP_E2E=false npx vitest run tests/e2e/` exits 0 | P0 |
| G-3 | Cross-system smoke test validates JWT round-trip | Docker Compose E2E (`scripts/run-e2e.sh`) passes with loa-hounfour v1.1.0 schemas | P0 |
| G-4 | Budget calculation conformance | All 56 loa-hounfour budget vectors pass against Arrakis budget manager | P1 |
| G-5 | JWT conformance | All 6 loa-hounfour JWT vectors pass against Arrakis JWT service | P1 |

---

## 3. Users & Stakeholders

| Persona | Needs |
|---------|-------|
| **Platform team (us)** | Confidence that the full arrakis ↔ loa-finn round-trip works before production deployment |
| **loa-finn** | Proof that Arrakis produces identical hashes, validates identical schemas, and speaks the same protocol version |
| **RFC #31 reviewers** | Evidence that the 97% → 100% gap is closed with real test coverage, not just code existence |

---

## 4. Functional Requirements

### 4.1 Test Vector Adapter Module

Create `tests/e2e/vectors/` — a thin adapter that loads loa-hounfour golden vectors and maps them into the E2E test harness format.

#### 4.1.1 Vector Loader

Create `tests/e2e/vectors/index.ts`.

**Loading mechanism:** loa-hounfour's `package.json` exports only `.` and `./schemas/*` — the `vectors/` directory is included in `files` but has **no subpath export**. Therefore, vectors MUST be loaded via filesystem read from the resolved package path, NOT via ESM import:

```typescript
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

const require = createRequire(import.meta.url);
const hounfourRoot = dirname(require.resolve('@0xhoneyjar/loa-hounfour/package.json'));

function loadVectorFile<T>(relativePath: string): T {
  const raw = readFileSync(join(hounfourRoot, relativePath), 'utf-8');
  return JSON.parse(raw) as T;
}

const budgetBasic = loadVectorFile('vectors/budget/basic-pricing.json');
const budgetExtreme = loadVectorFile('vectors/budget/extreme-tokens.json');
const budgetStreaming = loadVectorFile('vectors/budget/streaming-cancel.json');
const budgetPriceChange = loadVectorFile('vectors/budget/price-change-boundary.json');
const jwtConformance = loadVectorFile('vectors/jwt/conformance.json');
```

**Requirement:** Vector loading MUST work in CI and locally on Node >= 22 with Vitest without custom flags. The `createRequire` + `readFileSync` approach is universally supported and avoids ESM JSON module resolution issues.

Provide `getVector(name: string): TestVector` function that the E2E suite already expects.

**Vector-to-scenario mapping with exact vector IDs:**

The 9 E2E scenarios split into two categories:

**Category A — Golden vector coverage** (scenarios that map directly to loa-hounfour vectors):

| E2E Scenario | Vector IDs | What's Tested |
|-------------|-----------|---------------|
| `invoke_free_tier` | `jwt-valid-invoke` + `bp-08` (qwen local, cheapest tier) | JWT claims validation + free tier cost calculation |
| `invoke_pro_pool_routing` | `jwt-valid-invoke` (tier=pro) + `bp-12` (full gpt-4o) | Pool routing via `TIER_POOL_ACCESS` + pro tier cost |
| `invoke_stream_sse` | `sc-01` (normal stream completion) | SSE event format + streaming cost attribution |
| `invoke_rate_limited` | `jwt-valid-invoke` + `ERROR_CODES.RATE_LIMITED` | Error code conformance |
| `invoke_budget_exceeded` | `bp-15` (o3 reasoning-heavy) + `ERROR_CODES.BUDGET_EXCEEDED` | Budget threshold enforcement |
| `stream_abort_reconciliation` | `sc-03` through `sc-06` (abort scenarios) | Partial billing + `billing_method` attribution |

**Category B — Locally constructed fixtures** (scenarios requiring Arrakis-specific behavior not covered by golden vectors):

| E2E Scenario | Construction | What's Tested |
|-------------|-------------|---------------|
| `invoke_byok` | Constructed using `InvokeResponseSchema` + BYOK envelope fields from Arrakis adapter | BYOK envelope encryption round-trip — Arrakis-specific, not protocol-level |
| `invoke_ensemble_best_of_n` | Constructed using `bp-12` cost × N multiplier | Ensemble budget multiplication — Arrakis orchestration logic |
| `invoke_ensemble_partial_failure` | Constructed using `bp-12` + `ERROR_CODES` | Ensemble partial failure handling — Arrakis orchestration logic |

Category B fixtures are constructed from loa-hounfour schemas and vocabulary (ensuring protocol conformance) but represent Arrakis-specific orchestration behavior that has no corresponding golden vector. Each fixture MUST validate against the relevant loa-hounfour schema before use in tests.

#### 4.1.2 Contract Schema Adapter

Replace the empty `CONTRACT_SCHEMA` placeholder in `loa-finn-e2e-stub.ts` with real loa-hounfour exports:

```typescript
import {
  JwtClaimsSchema,       // TypeBox schema for JWT claims validation
  InvokeResponseSchema,  // TypeBox schema for invoke response validation
  UsageReportSchema,     // TypeBox schema for usage report validation
  StreamEventSchema,     // TypeBox schema for SSE event validation
  POOL_IDS,              // Record<string, string> — canonical pool identifiers
  TIER_POOL_ACCESS,      // Record<Tier, string[]> — tier → allowed pools
  TIER_DEFAULT_POOL,     // Record<Tier, string> — tier → default pool
  ERROR_CODES,           // Readonly object with error code constants
  CONTRACT_VERSION,      // string — e.g. "1.1.0"
  validators,            // Pre-compiled TypeBox validators
  computeReqHash,        // (body: Buffer, contentEncoding?: string, options?: ReqHashOptions) => string
  verifyReqHash,         // (body: Buffer, expectedHash: string, contentEncoding?: string, options?: ReqHashOptions) => boolean
  deriveIdempotencyKey,  // (tenant: string, reqHash: string, provider: string, model: string) => string
  validateCompatibility, // (remoteVersion: string) => { compatible: boolean; ... }
} from '@0xhoneyjar/loa-hounfour';
```

**Validator API:** loa-hounfour uses `@sinclair/typebox` (v0.34+). The `validators` object provides pre-compiled check functions: `validators.jwtClaims(payload)` returns `{ success: boolean, errors?: [...] }`. The stub's request body validation MUST use these validators instead of the empty placeholder schemas.

**Version negotiation:** On every E2E request, the stub MUST call `validateCompatibility(CONTRACT_VERSION)` and assert `compatible === true`. If loa-hounfour's `CONTRACT_VERSION` does not match the version Arrakis sends in its headers, the test MUST fail — this catches silent version drift.

**Hash agreement:** On every E2E invoke request, the stub MUST:
1. Receive the request body as a Buffer
2. Call `computeReqHash(body)` to produce the canonical hash
3. Compare against the `req_hash` claim in the JWT (which Arrakis computed independently)
4. Assert they match — this proves both sides canonicalize and hash identically

This is the core interoperability contract: if hashes diverge, Arrakis and loa-finn will disagree on idempotency keys, causing duplicate or lost requests in production.

#### 4.1.3 Activate E2E Tests

In `agent-gateway-e2e.test.ts`:
- Set `VECTORS_AVAILABLE = true`
- Replace the commented-out `getVector` import with the new adapter module
- Verify all 9 test scenarios resolve to real vector data

### 4.2 Budget Conformance Test Suite

Create `tests/conformance/budget-vectors.test.ts` — a parametrized test that runs all 56 loa-hounfour budget vectors against Arrakis's budget calculation logic.

**Numeric precision rules (CRITICAL):**

All monetary fields (`cost_micro`, `remainder_micro`, `total_cost_micro`, `price_micro_per_million`) MUST be handled as **integers**. The canonical formula from loa-hounfour is:

```
cost_micro = floor(tokens * price_micro_per_million / 1_000_000)
remainder_micro = (tokens * price_micro_per_million) % 1_000_000
```

- For values within `Number.MAX_SAFE_INTEGER` (2^53 - 1): JS `number` with `Math.floor()` is acceptable
- For values exceeding `MAX_SAFE_INTEGER` (the `extreme-tokens.json` vectors): `BigInt` arithmetic is REQUIRED
- The extreme-tokens vectors include fields like `"expected_cost_micro_string": "..."` for BigInt-required values — assert against the string representation
- The test harness MUST include a guard that rejects any monetary value that is a non-integer JS float (e.g., `if (!Number.isInteger(value) && typeof value !== 'bigint') throw`)

**Structure:**
- Load each vector set (basic-pricing, extreme-tokens, streaming-cancel, price-change-boundary) using the `loadVectorFile()` approach from §4.1.1
- For single_cost_vectors: call Arrakis budget function with `(tokens, price_micro_per_million)`, assert `cost_micro` and `remainder_micro` match exactly
- For total_cost_vectors: call with full pricing input, assert all cost fields match
- For remainder_accumulator_sequences: process vectors in order, carrying `remainder_micro` between calls
- Follow the existing `fixture-conformance.test.ts` pattern from `packages/shared/nats-schemas/`

### 4.3 JWT Conformance Test Suite

Create `tests/conformance/jwt-vectors.test.ts` — parametrized tests for the 6 loa-hounfour JWT conformance vectors.

**Static claim validation vectors** (deterministic, no JWKS interaction):

| Vector ID | Scenario | Expected | Error Code |
|-----------|----------|----------|------------|
| jwt-valid-invoke | Valid JWT with all required claims (iss, aud, sub, tenant_id, tier, req_hash, jti) | PASS | — |
| jwt-expired | `exp` in the past | REJECT | `JWT_EXPIRED` |
| jwt-wrong-aud | `aud: "arrakis"` instead of `"loa-finn"` | REJECT | `JWT_INVALID_AUDIENCE` |
| jwt-disallowed-iss | Issuer not in configured allowlist | REJECT | `JWT_INVALID_ISSUER` |

For static vectors: sign the claims from the vector JSON with a test ES256 key, then validate. The `req_hash` field in each vector (`sha256:e3b0c44...`) is the canonical empty-body hash — assert that `computeReqHash(Buffer.alloc(0))` produces the same value.

**JWKS behavioral vectors** (require deterministic choreography):

| Vector ID | Choreography | Expected |
|-----------|-------------|----------|
| jwt-rotated-key | 1. Start local JWKS server with key K1 (kid=k1). 2. Validate token signed by K1 — PASS (cache populated). 3. Rotate JWKS to key K2 (kid=k2), remove K1. 4. Validate token signed by K2 — PASS (forces JWKS refresh). 5. Validate token signed by K1 — REJECT (K1 no longer in JWKS). | Steps 2,4: PASS. Step 5: REJECT. |
| jwt-jwks-timeout | 1. Start local JWKS server with key K1 (kid=k1). 2. Validate token signed by K1 — PASS (cache populated, TTL=5s). 3. Block JWKS endpoint (return 503 or delay >timeout). 4. Validate token signed by K1 (kid=k1, cached) — ACCEPT (DEGRADED mode). 5. Validate token signed by unknown K3 (kid=k3) — REJECT (cannot refresh, unknown kid). | Step 4: ACCEPT. Step 5: REJECT. |

**Test infrastructure for JWKS vectors:**
- Spin up a local HTTP server (port 0 = random) serving `/.well-known/jwks.json`
- Configure Arrakis JWT service with `jwksUri` pointing to `http://127.0.0.1:{port}`
- Set cache TTL to 5 seconds and refresh timeout to 2 seconds for deterministic behavior
- Key rotation is simulated by updating the JWKS response served by the local server
- Timeout is simulated by making the JWKS endpoint return 503 or delay for 10 seconds

### 4.4 Docker Compose E2E Validation

Verify `scripts/run-e2e.sh` passes with the wired-up vectors:

1. Build Docker images for arrakis-e2e and loa-finn-e2e-stub
2. Start services via `docker-compose.e2e.yml` (Redis on 6399, arrakis on 3099, loa-finn stub on 8099)
3. Run E2E test suite with `SKIP_E2E=false`
4. All 9 E2E scenarios pass (6 golden + 3 locally constructed)

**JWKS flow alignment with production:**

The shared Docker volume is used ONLY for initial keypair generation — it seeds the ES256 key material that the stub then **serves over HTTP** via its `/.well-known/jwks.json` endpoint. Arrakis MUST fetch the JWKS via HTTP (not read from volume), matching the real production flow:

```
┌──────────┐    ES256 keypair    ┌─────────────┐
│ Arrakis  │ ──── generates ───→ │ shared vol  │
│ (3099)   │                     └──────┬──────┘
│          │                            │ stub reads at startup
│          │    HTTP GET /.well-known   │
│          │ ←──── JWKS.json ────────── │ ┌─────────────┐
│          │                              │ loa-finn    │
│          │ ──── POST /invoke ────────→ │ stub (8099) │
│          │    (JWT with req_hash)       │             │
│          │                              │ validates:  │
│          │ ←──── 200 + usage report ── │ - JWT sig   │
└──────────┘                              │ - req_hash  │
                                          │ - schema    │
                                          └─────────────┘
```

The stub validates every inbound JWT against the JWKS HTTP endpoint (with caching) and verifies `req_hash` agreement via `computeReqHash()`. This proves the real HTTP-based JWKS discovery + hash agreement flow, not just shared-secret key material.

---

## 5. Non-Functional Requirements

| Requirement | Target |
|-------------|--------|
| Vector loading | < 100ms (JSON imports, no network) |
| E2E suite runtime | < 60s (all 9 scenarios) |
| Conformance suite runtime | < 10s (56 budget + 6 JWT vectors) |
| Zero new dependencies | Only imports from already-installed `@0xhoneyjar/loa-hounfour` |

---

## 6. Out of Scope

| Item | Reason |
|------|--------|
| Production deployment (Terraform apply) | Deferred — requires E2E validation first |
| Monitoring dashboards | Deferred — follows deployment |
| CI pipeline for E2E | Deferred — focus on making tests pass locally first |
| New agent modules | All 36 modules are complete and verified on main |
| Rust gateway changes | Gateway is merged and tested (27 Rust tests passing) |

---

## 7. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| loa-hounfour vector format doesn't match E2E harness expectations | Medium | The adapter module (§4.1) provides the mapping layer — vectors are loaded and transformed, not consumed raw |
| Budget calculation logic has drifted from loa-hounfour expectations | High | Conformance tests (§4.2) will catch this immediately — fix any drift before E2E |
| Docker Compose E2E requires services not available in all dev environments | Low | Tests remain skippable via `SKIP_E2E` env var; conformance tests run without Docker |

---

## 8. Success Definition

RFC #31 is complete when ALL of the following are verified:

**Vector activation:**
- `VECTORS_AVAILABLE = true` in `agent-gateway-e2e.test.ts`
- All 9 E2E scenarios resolve to real vector data (6 golden + 3 locally constructed)

**Conformance:**
- All 56 budget vectors pass (basic-pricing, extreme-tokens, streaming-cancel, price-change-boundary)
- All 6 JWT vectors pass (4 static claim validation + 2 JWKS behavioral)
- Budget tests enforce integer-only arithmetic (no floating-point values accepted)

**Protocol interoperability (the core contract):**
- `validateCompatibility(CONTRACT_VERSION)` returns `compatible: true` in every E2E request
- `computeReqHash(body)` on the stub matches the `req_hash` JWT claim from Arrakis for every invoke — proving both sides canonicalize and hash identically
- `deriveIdempotencyKey()` produces the same key on both sides for the same request

**Integration:**
- Docker Compose E2E round-trip passes with HTTP-based JWKS discovery (not just shared volume)
- Stub validates inbound JWTs via JWKS HTTP endpoint with caching
- All E2E requests validate against loa-hounfour schemas via pre-compiled validators

**Tracking:**
- Command Deck Round 9 posted to loa-finn#31 confirming 100%

---

*This PRD is grounded in the first-principles codebase audit (Command Deck Round 8) which verified all 36 agent modules, 28 test files, and the full loa-hounfour integration on Arrakis main. The remaining work is validation, not implementation.*

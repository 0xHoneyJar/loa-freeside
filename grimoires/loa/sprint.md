# Sprint Plan: The Golden Path — E2E Vector Migration & Launch Validation

**Cycle:** 024
**PRD:** [The Golden Path PRD](prd.md) (v1.1.0, GPT-approved)
**SDD:** [The Golden Path SDD](sdd.md) (v1.1.0, GPT-approved)
**Date:** 2026-02-13
**Global Sprint Range:** 227–229

---

## Overview

3 sprints completing the final 3% of RFC #31. No new application modules — all work is test infrastructure connecting existing code to existing vectors.

| Sprint | Focus | New Files | Modified Files | Est. Lines |
|--------|-------|-----------|----------------|------------|
| 1 | Vector Adapter + E2E Activation | 1 | 2 | ~250 |
| 2 | Conformance Test Suites | 3 | 0 | ~570 |
| 3 | Docker Compose E2E + Final Integration | 0 | 0–2 (scripts if needed) | ~50 |

**Dependency chain:** Sprint 1 → Sprint 2 (conformance suites import from vector loader) → Sprint 3 (Docker Compose runs the full activated suite).

---

## Sprint 1: Vector Adapter + E2E Activation

**Global ID:** 227
**Goal:** Wire loa-hounfour golden vectors into the E2E test suite and set `VECTORS_AVAILABLE = true`.
**PRD refs:** §4.1 (Vector Adapter Module), §4.1.3 (Activate E2E Tests)
**SDD refs:** §3.1 (Vector Loader), §3.2 (E2E Test Modifications), §3.3 (E2E Stub Modifications)

### Tasks

#### Task 1.1: Create Vector Loader Module

**File:** `tests/e2e/vectors/index.ts` (~180 lines)
**Description:** Create the vector adapter that loads loa-hounfour golden vectors via `createRequire` + `readFileSync` and exposes both the E2E-focused `getVector(name)` API and the raw `loadVectorFile()` utility for conformance suites.

**Acceptance Criteria:**
- [ ] Uses `createRequire(import.meta.url)` to resolve `@0xhoneyjar/loa-hounfour/package.json` path
- [ ] `loadVectorFile<T>(relativePath: string): T` exported — reads JSON from loa-hounfour package root via `readFileSync`, used by conformance suites in Sprint 2
- [ ] Loads all 5 budget vector files (`vectors/budget/basic-pricing.json`, `extreme-tokens.json`, `streaming-cancel.json`, `price-change-boundary.json`, `multi-model-batch.json`) containing 56 total vectors (bp-01..bp-15, extreme, streaming, price-change, batch sequences)
- [ ] Loads JWT conformance file (`vectors/jwt/conformance.json`) containing 6 vectors (jwt-valid-invoke, jwt-expired, jwt-wrong-aud, jwt-rotated-key, jwt-disallowed-iss, jwt-jwks-timeout)
- [ ] Defines `TestVector` interface matching SDD §3.1
- [ ] Maps 6 Category A E2E scenarios to golden vectors: `invoke_free_tier` → jwt-valid-invoke + bp-08, `invoke_pro_pool_routing` → jwt-valid-invoke + bp-12, `invoke_stream_sse` → sc-01, `invoke_rate_limited` → jwt-valid-invoke + ERROR_CODES.RATE_LIMITED, `invoke_budget_exceeded` → bp-15, `stream_abort_reconciliation` → sc-03..sc-06
- [ ] Constructs 3 Category B scenarios (BYOK, ensemble best-of-N, ensemble partial failure) from loa-hounfour schemas
- [ ] Each Category B vector validated against loa-hounfour `validators` before registration
- [ ] Category B vectors include `_constructed: true` metadata flag
- [ ] `getVector(name)` throws with descriptive error if name not found
- [ ] `VECTORS_AVAILABLE` exported as `true`
- [ ] Module loads without errors in Vitest with Node >= 22

**Exports:** `getVector`, `getTestVectors`, `VECTORS_AVAILABLE`, `loadVectorFile`

#### Task 1.2: Activate E2E Test Suite

**File:** `tests/e2e/agent-gateway-e2e.test.ts` (~4 lines changed)
**Description:** Replace the disabled vector import and hardcoded `VECTORS_AVAILABLE = false` with the new vector adapter module.

**Acceptance Criteria:**
- [ ] Line 16-17: Replace commented import with `import { getVector, getTestVectors, VECTORS_AVAILABLE } from './vectors/index.js';`
- [ ] Line 26: Remove `const VECTORS_AVAILABLE = false;` (now imported)
- [ ] Line 27: Simplify `SHOULD_SKIP` to depend only on `SKIP_E2E` (VECTORS_AVAILABLE always true)
- [ ] Remove local `getTestVectors()` function (lines 316, 436) — now imported
- [ ] No changes to existing test logic or assertions
- [ ] `npx vitest run tests/e2e/agent-gateway-e2e.test.ts` compiles without import errors

#### Task 1.3: Wire Stub to loa-hounfour

**File:** `tests/e2e/loa-finn-e2e-stub.ts` (~20 lines changed)
**Description:** Replace placeholder `TEST_VECTORS` / `CONTRACT_SCHEMA` with real loa-hounfour imports, add raw-body hash agreement check, and version compatibility validation.

**Acceptance Criteria:**
- [ ] Lines 33-38: Replace empty placeholders with real imports (`CONTRACT_VERSION`, `validators`, `computeReqHash`, `verifyReqHash`, `validateCompatibility`, `POOL_IDS`, `TIER_POOL_ACCESS`, `ERROR_CODES`)
- [ ] Import `getVector`, `getTestVectors` from `./vectors/index.js`
- [ ] `readBody()` returns `{ raw: Buffer; text: string }` — raw Buffer preserved for hashing
- [ ] `handleInvoke()` calls `computeReqHash(rawBody)` and compares against JWT `req_hash` claim
- [ ] Returns 409 HASH_MISMATCH on divergence (fail-loud)
- [ ] `handleInvoke()` calls `validateCompatibility(CONTRACT_VERSION)` on every request; returns 400 with `{ error: 'VERSION_INCOMPATIBLE', details: result.reason }` if `compatible === false`
- [ ] `matchVector()` and `matchStreamVector()` use `getTestVectors()` instead of empty `TEST_VECTORS.vectors`
- [ ] `CONTRACT_SCHEMA.version` references replaced with `CONTRACT_VERSION` import
- [ ] Existing stub behavior (JWKS, invoke, stream, usage report, health) unchanged

### Sprint 1 Definition of Done

- `VECTORS_AVAILABLE = true` in the E2E test file
- All 9 E2E scenarios resolve to real vector data (verified by test compilation)
- Hash agreement check active in stub (`computeReqHash(rawBody) === jwt.req_hash`)
- Version compatibility check active in stub (`validateCompatibility(CONTRACT_VERSION)`)
- `npx vitest typecheck tests/e2e/` passes (no type errors)

---

## Sprint 2: Conformance Test Suites

**Global ID:** 228
**Goal:** Create parametrized conformance test suites for all 56 budget vectors and 6 JWT vectors.
**PRD refs:** §4.2 (Budget Conformance), §4.3 (JWT Conformance)
**SDD refs:** §3.4 (Budget Conformance Suite), §3.5 (JWT Conformance Suite), §3.6 (JWKS Test Server)

### Tasks

#### Task 2.1: Create Budget Conformance Suite

**File:** `tests/conformance/budget-vectors.test.ts` (~200 lines)
**Description:** Parametrized test suite running all 56 loa-hounfour budget vectors against a pure-arithmetic `calculateSingleCost` / `calculateTotalCost` function extracted from Arrakis budget logic.

**Acceptance Criteria:**
- [ ] Loads all 5 budget vector files via `loadVectorFile()` imported from `tests/e2e/vectors/index.js` (exported in Task 1.1)
- [ ] `toBigInt(value: number | string)` parser with `Number.isSafeInteger` guard
- [ ] `calculateSingleCost(tokens, priceMicroPerMillion)` uses BigInt arithmetic: `cost_micro = (t * p) / 1_000_000n`, `remainder_micro = (t * p) % 1_000_000n`
- [ ] `single_cost_vectors` (bp-01 through bp-11): asserts `cost_micro` and `remainder_micro` match exactly
- [ ] `total_cost_vectors` (bp-12 through bp-15): asserts `input_cost_micro`, `output_cost_micro`, `total_cost_micro`
- [ ] Extreme-tokens vectors: uses `expected_cost_micro_string` (string) for BigInt comparison when present
- [ ] Integer guard: `typeof result.cost_micro === 'bigint'` assertion on every test
- [ ] `remainder_accumulator_sequences`: processes vectors in order carrying `remainder_micro`
- [ ] All 56 vectors pass: `npx vitest run tests/conformance/budget-vectors.test.ts` exits 0

#### Task 2.2: Create JWKS Test Server

**File:** `tests/conformance/jwks-test-server.ts` (~120 lines)
**Description:** Local HTTP server for deterministic JWKS rotation and timeout simulation.

**Acceptance Criteria:**
- [ ] `JwksTestServer` class with `start()`, `stop()`, `getJwksUri()` API
- [ ] `getJwksUri()` returns `http://127.0.0.1:{port}/.well-known/jwks.json` (full path)
- [ ] `addKey(kid)` generates ES256 keypair, returns `{ privateKey, publicJwk }`
- [ ] `removeKey(kid)` removes key from JWKS response
- [ ] `getKeys()` returns current JWK array
- [ ] `setBlocked(true)` makes endpoint return 503
- [ ] `setDelay(ms)` adds artificial latency before response
- [ ] `resetFaults()` clears all fault injection
- [ ] Serves `{ keys: [...] }` at `/.well-known/jwks.json`
- [ ] Listens on random port (port 0) — no port conflicts
- [ ] No external dependencies beyond Node built-ins + `jose` (already installed)

#### Task 2.3: Create JWT Conformance Suite

**File:** `tests/conformance/jwt-vectors.test.ts` (~250 lines)
**Description:** Parametrized tests for 4 static JWT claim vectors + 2 JWKS behavioral vectors.

**Acceptance Criteria:**
- [ ] Loads `vectors/jwt/conformance.json` via `loadVectorFile()` imported from `tests/e2e/vectors/index.js` (exported in Task 1.1)
- [ ] **Static claim tests** (jwt-valid-invoke, jwt-expired, jwt-wrong-aud, jwt-disallowed-iss):
  - Signs vector claims with test ES256 key via `jose` `SignJWT`
  - Validates using Arrakis JWT validation logic (`createJwtValidator` from `packages/adapters/agent/jwt-service.ts`)
  - Asserts pass/reject + error code matches vector expectation
- [ ] **req_hash consistency**: body-less vectors assert `computeReqHash(Buffer.alloc(0))` matches `claims.req_hash`
  - Vectors with `req_body_bytes_base64` compute hash from decoded body bytes
  - Vectors with body but no base64 bytes: hash assertion skipped (deferred to E2E)
- [ ] **JWT validator configuration for behavioral tests:** `createJwtValidator()` accepts constructor params `{ jwksUri: string, cacheTtl: number, refreshTimeout: number }`. Tests pass `jwksUri: server.getJwksUri()` to point at the local `JwksTestServer`. No env vars or global state — all configuration via constructor injection.
- [ ] **jwt-rotated-key** behavioral test:
  - `createJwtValidator({ jwksUri: server.getJwksUri(), cacheTtl: 0, refreshTimeout: 2000 })`
  - `cacheTtl: 0` guarantees fresh JWKS fetch on every validation (no stale cache)
  - Step 2: K1 token PASS
  - Step 4: K2 token PASS (kid-miss triggers refetch, finds K2)
  - Step 5: K1 token REJECT (K1 removed from JWKS)
  - Does not rely on real-time waits — deterministic via `cacheTtl: 0`
- [ ] **jwt-jwks-timeout** behavioral test:
  - `createJwtValidator({ jwksUri: server.getJwksUri(), cacheTtl: 5000, refreshTimeout: 2000 })`
  - Step 2: K1 validation populates cache (TTL=5s)
  - Step 3: `server.setBlocked(true)` blocks JWKS endpoint
  - Step 4: cached K1 ACCEPT (DEGRADED mode — serves from cache within TTL)
  - Step 5: unknown K3 REJECT (kid-miss triggers refetch, blocked → timeout → reject)
  - Timing: test runs within 5s TTL window; `setDelay`/`setBlocked` on server controls timing, not `setTimeout`
- [ ] All 6 vectors pass: `npx vitest run tests/conformance/jwt-vectors.test.ts` exits 0

### Sprint 2 Definition of Done

- All 56 budget conformance vectors pass with BigInt arithmetic
- All 6 JWT conformance vectors pass (4 static + 2 behavioral)
- JWKS test server handles rotation and timeout deterministically
- `npx vitest run tests/conformance/` exits 0

---

## Sprint 3: Docker Compose E2E + Final Integration

**Global ID:** 229
**Goal:** Validate the full Docker Compose round-trip and close RFC #31 at 100%.
**PRD refs:** §4.4 (Docker Compose E2E), §8 (Success Definition)
**SDD refs:** §8 (Development Workflow), §5 (Security Architecture)

### Tasks

#### Task 3.1: Docker Compose Round-Trip Validation

**Description:** Run the full E2E test suite via Docker Compose and verify all 9 scenarios pass end-to-end.

**Existing infrastructure (SDD §2.2 — already on main, no new files needed):**
- `scripts/run-e2e.sh` — E2E runner script (clones loa-finn, generates ES256 keypair, builds Docker images)
- `tests/e2e/docker-compose.e2e.yml` — Compose config (Redis:6399, arrakis:3099, loa-finn stub:8099, shared volume for keypair)
- Dockerfiles for arrakis-e2e and loa-finn-e2e-stub images (referenced in compose config)

If `run-e2e.sh` or compose config require edits (e.g., env vars for `SKIP_E2E=false`, exit code propagation), those edits are scoped to this task.

**Acceptance Criteria:**
- [ ] `scripts/run-e2e.sh` builds Docker images successfully (arrakis-e2e, loa-finn-e2e-stub)
- [ ] Docker Compose starts all services (Redis on 6399, arrakis on 3099, loa-finn stub on 8099)
- [ ] Shared Docker volume seeds ES256 keypair only — stub serves JWKS over HTTP
- [ ] Arrakis fetches JWKS via HTTP `GET /.well-known/jwks.json` (not from shared volume)
- [ ] All 9 E2E scenarios pass with `SKIP_E2E=false`
- [ ] Hash agreement verified on every invoke request (stub logs `computeReqHash` match)
- [ ] Version compatibility asserted on every request (`validateCompatibility` returns compatible)
- [ ] No 409 HASH_MISMATCH responses in test output

#### Task 3.2: Conformance + E2E Integration Smoke Test

**Description:** Run the full test execution sequence from SDD §8.

**Acceptance Criteria:**
- [ ] Step 1: `npx vitest run tests/conformance/` exits 0 (56 budget + 6 JWT)
- [ ] Step 2: `SKIP_E2E=false npx vitest run tests/e2e/agent-gateway-e2e.test.ts` exits 0 (9 scenarios)
- [ ] Step 3: `./scripts/run-e2e.sh` exits 0 (Docker Compose round-trip)
- [ ] All PRD §8 success criteria verified

#### Task 3.3: Post Command Deck Round 9 to loa-finn#31

**Description:** Post final status update confirming RFC #31 at 100%.

**Acceptance Criteria:**
- [ ] Command Deck Round 9 posted to `0xHoneyJar/loa-finn#31`
- [ ] Includes: conformance results, E2E results, Docker Compose results
- [ ] Declares RFC #31 at 100% with evidence
- [ ] Links to Arrakis PR with all changes

### Sprint 3 Definition of Done

- Docker Compose E2E passes all 9 scenarios end-to-end
- Full test execution sequence passes (conformance → E2E → Docker Compose)
- Command Deck Round 9 posted confirming RFC #31 at 100%
- All PRD §8 success criteria met

---

## Risk Register

| Risk | Sprint | Mitigation |
|------|--------|------------|
| Budget manager uses cents, vectors use micro-USD | 2 | Extract pure arithmetic function; no unit conversion needed for conformance |
| Extreme-tokens overflow JS number | 2 | `toBigInt()` parser with `isSafeInteger` guard; string comparison for large values |
| JWKS cache timing makes rotation tests flaky | 2 | `cacheTtl: 0` for rotation, `cacheTtl: 5000` for timeout; deterministic choreography |
| Docker Compose not available in all environments | 3 | Sprint 3 is independently skippable; conformance + E2E pass without Docker |
| Category B fixtures drift from loa-hounfour schemas | 1 | Each fixture validated against loa-hounfour `validators` at module load |

---

*This sprint plan covers ~750 lines of new test code across 4 new files and 2 modified files. The work connects existing infrastructure — no new application modules, no new dependencies.*

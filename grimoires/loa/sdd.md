# SDD: The Golden Path — E2E Vector Migration & Launch Validation

**Version:** 1.1.0
**Cycle:** 024
**Date:** 2026-02-13
**PRD:** [The Golden Path PRD](grimoires/loa/prd.md)

---

## 1. Executive Summary

Wire loa-hounfour v1.1.0 golden test vectors into Arrakis's disabled E2E test suite, add conformance test suites for budget calculation and JWT validation, and validate the full Docker Compose round-trip. No new modules, no new dependencies — only connecting existing infrastructure.

---

## 2. System Architecture

### 2.1 High-Level Component Map

```
┌─────────────────────────────────────────────────────────────────────┐
│                        TEST INFRASTRUCTURE                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────┐     ┌──────────────────────────────────┐  │
│  │ tests/e2e/vectors/  │     │ tests/conformance/               │  │
│  │                     │     │                                  │  │
│  │  index.ts           │     │  budget-vectors.test.ts          │  │
│  │  (vector loader +   │     │  jwt-vectors.test.ts             │  │
│  │   getVector() API)  │     │  jwks-test-server.ts             │  │
│  └────────┬────────────┘     └──────────┬───────────────────────┘  │
│           │                              │                          │
│           │  loads vectors via fs        │  imports functions from  │
│           ▼                              ▼                          │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  node_modules/@0xhoneyjar/loa-hounfour/                     │   │
│  │                                                             │   │
│  │  dist/index.js          ← validators, computeReqHash,      │   │
│  │                           CONTRACT_VERSION, POOL_IDS, etc.  │   │
│  │  vectors/budget/*.json  ← 56 golden budget vectors          │   │
│  │  vectors/jwt/*.json     ← 6 golden JWT vectors              │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                        E2E TEST HARNESS                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────────────────┐    ┌──────────────────────────────┐  │
│  │ agent-gateway-e2e.test.ts│    │ loa-finn-e2e-stub.ts         │  │
│  │                          │    │                              │  │
│  │ 9 scenarios:             │    │ HTTP server (port 0):        │  │
│  │  - invoke_free_tier      │───→│  /.well-known/jwks.json      │  │
│  │  - invoke_pro_pool_routing    │  /v1/agents/invoke           │  │
│  │  - invoke_stream_sse     │    │  /v1/agents/stream           │  │
│  │  - invoke_rate_limited   │    │  /v1/usage/report            │  │
│  │  - invoke_budget_exceeded│    │  /v1/health                  │  │
│  │  - stream_abort_recon    │    │                              │  │
│  │  - invoke_byok           │    │ Validates:                   │  │
│  │  - invoke_ensemble_bon   │    │  - JWT sig (optional)        │  │
│  │  - invoke_ensemble_pf    │    │  - req_hash agreement        │  │
│  │                          │    │  - schema conformance        │  │
│  │ VECTORS_AVAILABLE = true │    │  - version compatibility     │  │
│  └──────────────────────────┘    └──────────────────────────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 Existing Infrastructure (No Changes)

| Component | Path | Role |
|-----------|------|------|
| JWT Service | `packages/adapters/agent/jwt-service.ts` | Signs JWTs with `computeReqHash()` from loa-hounfour |
| Budget Manager | `packages/adapters/agent/budget-manager.ts` | Two-counter reserve/finalize via Lua scripts |
| Budget Lua | `packages/adapters/agent/lua/*.lua` | 4 Redis Lua scripts (reserve, finalize, reaper, rate-limit) |
| NATS Schemas | `packages/shared/nats-schemas/` | 6 fixtures + 18 tests + fixture-conformance pattern |
| Docker Compose | `tests/e2e/docker-compose.e2e.yml` | Redis(6399), arrakis(3099), loa-finn stub(8099) |
| E2E Runner | `scripts/run-e2e.sh` | Clones loa-finn, generates ES256 keypair, builds Docker images |

---

## 3. Component Design

### 3.1 Vector Loader (`tests/e2e/vectors/index.ts`)

**Purpose:** Load loa-hounfour golden vectors from filesystem and expose `getVector(name)` API.

**Design:**

```typescript
// Module: tests/e2e/vectors/index.ts

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

const require = createRequire(import.meta.url);
const HOUNFOUR_ROOT = dirname(
  require.resolve('@0xhoneyjar/loa-hounfour/package.json')
);

function loadVectorFile<T>(relativePath: string): T {
  return JSON.parse(
    readFileSync(join(HOUNFOUR_ROOT, relativePath), 'utf-8')
  ) as T;
}
```

**Vector registry:** A `Map<string, TestVector>` built at module load time, mapping E2E scenario names to their vector data.

**Category A vectors** (6 golden): Loaded directly from loa-hounfour JSON files, transformed into the `TestVector` shape the E2E harness expects:

```typescript
interface TestVector {
  name: string;
  description: string;
  request: {
    jwt_claims: Record<string, unknown>;
    body: Record<string, unknown>;
  };
  response: {
    status: number;
    headers?: Record<string, string>;
    body?: Record<string, unknown>;
    stream_events?: Array<{ type: string; data: unknown }>;
    abort_after_events?: number;
    expect_reconciliation?: boolean;
  };
  usage_report_payload: Record<string, unknown> | null;
}
```

**Category B vectors** (3 locally constructed): Built from loa-hounfour schemas and vocabulary, validated against `validators` before registration. Each Category B vector includes a `_constructed: true` metadata flag.

**Exports:**

| Export | Signature | Description |
|--------|-----------|-------------|
| `getVector` | `(name: string) => TestVector` | Returns named vector; throws if not found |
| `getTestVectors` | `() => TestVector[]` | Returns all 9 vectors |
| `VECTORS_AVAILABLE` | `boolean` | Always `true` — hardcoded |

### 3.2 E2E Test Modifications (`tests/e2e/agent-gateway-e2e.test.ts`)

**Changes (minimal — surgical edits to existing file):**

1. **Line 16-17:** Replace commented import with:
   ```typescript
   import { getVector, getTestVectors, VECTORS_AVAILABLE } from './vectors/index.js';
   ```

2. **Line 26:** Change `const VECTORS_AVAILABLE = false;` to remove (now imported).

3. **Line 27:** Simplify to `const SHOULD_SKIP = SKIP_E2E;` (VECTORS_AVAILABLE is always true from import).

4. **Lines 316, 436:** `getTestVectors()` function at bottom of file can be removed — imported from vectors module.

**No changes to test logic.** The 9 test scenarios, helpers (`createMockJwt`, `parseSSEEvents`), and assertion logic remain identical. Only the vector source changes.

### 3.3 E2E Stub Modifications (`tests/e2e/loa-finn-e2e-stub.ts`)

**Changes:**

1. **Lines 33-38:** Replace placeholder imports with real loa-hounfour imports:
   ```typescript
   import {
     CONTRACT_VERSION,
     validators,
     computeReqHash,
     verifyReqHash,
     POOL_IDS,
     TIER_POOL_ACCESS,
     ERROR_CODES,
   } from '@0xhoneyjar/loa-hounfour';
   import { getVector, getTestVectors } from './vectors/index.js';
   ```

2. **Line 305, 343, 400:** Replace `CONTRACT_SCHEMA.version` with `CONTRACT_VERSION` (direct import).

3. **Vector matching (lines 511-552):** Update `matchVector()` and `matchStreamVector()` to use `getTestVectors()` instead of `TEST_VECTORS.vectors`.

4. **Raw body preservation:** The existing `readBody()` method (line 558) already accumulates `Buffer` chunks and calls `Buffer.concat(chunks)`. Add a `rawBody: Buffer` field alongside the string body to preserve exact wire bytes for hashing:
   ```typescript
   // In readBody(), return both raw Buffer and string:
   private readBody(req: IncomingMessage): Promise<{ raw: Buffer; text: string }> {
     return new Promise((resolve, reject) => {
       const chunks: Buffer[] = [];
       req.on('data', (chunk: Buffer) => chunks.push(chunk));
       req.on('end', () => {
         const raw = Buffer.concat(chunks);
         resolve({ raw, text: raw.toString('utf-8') });
       });
       req.on('error', reject);
     });
   }
   ```

5. **Request validation (handleInvoke, line 267):** Add `computeReqHash()` agreement check using **raw bytes** (not re-encoded string):
   ```typescript
   // CRITICAL: Hash the raw wire bytes, not the re-encoded string.
   // This matches how Arrakis computes the hash before sending.
   const computedHash = computeReqHash(rawBody);  // rawBody is the Buffer from readBody()
   const jwtHash = claims?.req_hash as string;
   if (jwtHash && computedHash !== jwtHash) {
     res.writeHead(409, { 'Content-Type': 'application/json' });
     res.end(JSON.stringify({
       error: 'HASH_MISMATCH',
       computed: computedHash,
       jwt: jwtHash
     }));
     return;
   }
   ```
   **Why raw bytes:** `computeReqHash()` canonicalizes and hashes the HTTP request body. If we converted to string and back to Buffer, whitespace or encoding differences could cause hash divergence even when the request is correct. The raw Buffer from `req.on('data')` is the exact byte sequence Arrakis sent.

### 3.4 Budget Conformance Suite (`tests/conformance/budget-vectors.test.ts`)

**Purpose:** Parametrized tests running 56 loa-hounfour budget vectors against Arrakis budget calculation logic.

**Design:**

```
tests/conformance/
├── budget-vectors.test.ts    ← Parametrized budget tests
├── jwt-vectors.test.ts       ← Parametrized JWT tests
└── jwks-test-server.ts       ← Local JWKS server for behavioral tests
```

**Budget test structure:**

```typescript
describe('Budget Conformance — basic-pricing', () => {
  const vectors = loadVectorFile<BasicPricingVectors>(
    'vectors/budget/basic-pricing.json'
  );

  describe('single_cost_vectors', () => {
    for (const v of vectors.single_cost_vectors) {
      it(`${v.id}: ${v.note}`, () => {
        const result = calculateSingleCost(v.tokens, v.price_micro_per_million);
        expect(result.cost_micro).toBe(v.expected_cost_micro);
        expect(result.remainder_micro).toBe(v.expected_remainder_micro);
      });
    }
  });

  describe('total_cost_vectors', () => {
    for (const v of vectors.total_cost_vectors) {
      it(`${v.id}: ${v.note}`, () => {
        const result = calculateTotalCost(v.input);
        expect(result.input_cost_micro).toBe(v.expected.input_cost_micro);
        expect(result.output_cost_micro).toBe(v.expected.output_cost_micro);
        expect(result.total_cost_micro).toBe(v.expected.total_cost_micro);
      });
    }
  });
});
```

**`calculateSingleCost` implementation:**

The budget vectors define a pure arithmetic function:
```
cost_micro = floor(tokens * price_micro_per_million / 1_000_000)
remainder_micro = (tokens * price_micro_per_million) % 1_000_000
```

This function is extracted from the budget manager's `estimateCost()` path.

**JSON numeric parsing (CRITICAL):** JSON cannot represent `bigint`. The extreme-tokens vectors encode large values in two ways:
- `"tokens": 9007199254740992` — exceeds `MAX_SAFE_INTEGER`, lossy as JS `number`
- `"expected_cost_micro_string": "900719925474099200"` — string representation for BigInt-required values

**Parsing layer:** All vector numeric fields MUST be parsed through a safe conversion function:

```typescript
/** Parse a vector numeric field to BigInt, handling both number and string inputs */
function toBigInt(value: number | string): bigint {
  if (typeof value === 'string') return BigInt(value);
  // Guard: reject numbers that exceed MAX_SAFE_INTEGER (lossy from JSON)
  if (!Number.isSafeInteger(value)) {
    throw new Error(`Unsafe integer ${value} — use string representation`);
  }
  return BigInt(value);
}

function calculateSingleCost(tokens: number | string, priceMicroPerMillion: number | string) {
  const t = toBigInt(tokens);
  const p = toBigInt(priceMicroPerMillion);
  const product = t * p;
  const MILLION = 1_000_000n;
  return {
    cost_micro: product / MILLION,
    remainder_micro: product % MILLION,
  };
}
```

**Assertion strategy:** Compare BigInt to BigInt. For vectors with `expected_cost_micro_string`, parse expected as `BigInt(string)`. For vectors with `expected_cost_micro` as a safe integer, compare with `BigInt(expected)`:

```typescript
const expected = v.expected_cost_micro_string
  ? BigInt(v.expected_cost_micro_string)
  : BigInt(v.expected_cost_micro);
expect(result.cost_micro).toBe(expected);
```

**Integer guard:** Every test includes:
```typescript
// Result is always BigInt from our calculation
expect(typeof result.cost_micro).toBe('bigint');
```

### 3.5 JWT Conformance Suite (`tests/conformance/jwt-vectors.test.ts`)

**Purpose:** Parametrized tests for 6 JWT conformance vectors — 4 static claim validation + 2 JWKS behavioral.

**Static claim tests:**

```typescript
describe('JWT Conformance — static claims', () => {
  let testKey: { privateKey: KeyLike; publicJwk: JWK };

  beforeAll(async () => {
    testKey = await generateTestES256Key();
  });

  for (const vector of staticVectors) {
    it(`${vector.id}: ${vector.description}`, async () => {
      // Sign the claims from the vector with test key
      const token = await signClaims(vector.claims, testKey.privateKey);

      // Validate using Arrakis JWT validation logic
      const result = await validateJwt(token, testKey.publicJwk);

      if (vector.expected === 'valid') {
        expect(result.valid).toBe(true);
      } else {
        expect(result.valid).toBe(false);
        expect(result.error).toBe(vector.error);
      }
    });
  }

  // Hash agreement: validate req_hash is well-formed and consistent
  // NOTE: Only assert empty-body hash for vectors that don't include a body field.
  // Vectors with explicit body material should have their hash computed from that body.
  it('req_hash in body-less vectors matches computeReqHash(empty)', () => {
    const emptyHash = computeReqHash(Buffer.alloc(0));
    for (const v of staticVectors) {
      if (!v.body && !v.req_body_bytes_base64) {
        // Vector has no explicit body → req_hash must be the empty-body canonical hash
        expect(v.claims.req_hash).toBe(emptyHash);
      } else if (v.req_body_bytes_base64) {
        // Vector includes explicit body bytes → compute hash from those bytes
        const bodyBuf = Buffer.from(v.req_body_bytes_base64, 'base64');
        const expectedHash = computeReqHash(bodyBuf);
        expect(v.claims.req_hash).toBe(expectedHash);
      }
      // If vector has body but no base64 bytes, skip hash assertion —
      // rely on E2E stub hash agreement for end-to-end validation
    }
  });
});
```

### 3.6 JWKS Test Server (`tests/conformance/jwks-test-server.ts`)

**Purpose:** Local HTTP server for deterministic JWKS rotation and timeout simulation.

**API:**

```typescript
class JwksTestServer {
  constructor();

  // Lifecycle
  async start(): Promise<void>;        // Listen on random port
  async stop(): Promise<void>;
  getJwksUri(): string;                 // http://127.0.0.1:{port}/.well-known/jwks.json

  // Key management
  async addKey(kid: string): Promise<{ privateKey: KeyLike; publicJwk: JWK }>;
  removeKey(kid: string): void;
  getKeys(): JWK[];

  // Fault injection
  setBlocked(blocked: boolean): void;   // 503 responses
  setDelay(ms: number): void;           // Artificial latency
  resetFaults(): void;
}
```

**JWKS endpoint behavior:**
- Normal: Returns `{ keys: [...] }` with all registered keys
- Blocked (`setBlocked(true)`): Returns 503 Service Unavailable
- Delayed (`setDelay(10000)`): Responds after delay (triggers client timeout)

**Test choreography for jwt-rotated-key:**

**JWKS refresh semantics:** The test MUST configure the validator to refetch JWKS on unknown `kid` (kid-miss refresh), not just on TTL expiry. This is the production behavior — `jose`'s `createRemoteJWKSet()` does this by default. The `cacheTtl` parameter only controls how often the full keyset is refreshed proactively; kid-miss triggers an immediate refetch regardless of TTL.

For the **rotation test**, set `cacheTtl: 0` to guarantee no stale cache interference:

```typescript
it('jwt-rotated-key: accepts after rotation, rejects old key', async () => {
  const server = new JwksTestServer();
  await server.start();

  // Step 1: Register K1
  const k1 = await server.addKey('k1');
  // cacheTtl=0 ensures JWKS is always fetched fresh — removes TTL flakiness
  const jwtService = createJwtValidator({
    jwksUri: server.getJwksUri(),
    cacheTtl: 0,
    refreshTimeout: 2000,
  });

  // Step 2: Validate K1 token — PASS (fetches JWKS, finds K1)
  const t1 = await signToken(validClaims, k1.privateKey, 'k1');
  expect(await jwtService.validate(t1)).toHaveProperty('valid', true);

  // Step 3: Rotate to K2
  server.removeKey('k1');
  const k2 = await server.addKey('k2');

  // Step 4: Validate K2 token — PASS (kid-miss triggers refetch, finds K2)
  const t2 = await signToken(validClaims, k2.privateKey, 'k2');
  expect(await jwtService.validate(t2)).toHaveProperty('valid', true);

  // Step 5: Validate K1 token — REJECT (refetch returns only K2)
  const t3 = await signToken(validClaims, k1.privateKey, 'k1');
  expect(await jwtService.validate(t3)).toHaveProperty('valid', false);

  await server.stop();
});
```

For the **timeout test**, set `cacheTtl: 5000` so cache is populated before blocking:

```typescript
it('jwt-jwks-timeout: DEGRADED mode with cached vs unknown kid', async () => {
  const server = new JwksTestServer();
  await server.start();

  // Step 1: Register K1, populate cache
  const k1 = await server.addKey('k1');
  const jwtService = createJwtValidator({
    jwksUri: server.getJwksUri(),
    cacheTtl: 5000,
    refreshTimeout: 2000,
  });
  const t1 = await signToken(validClaims, k1.privateKey, 'k1');
  expect(await jwtService.validate(t1)).toHaveProperty('valid', true);

  // Step 2: Block JWKS endpoint
  server.setBlocked(true);

  // Step 3: Cached kid=k1 — ACCEPT (DEGRADED, serves from cache)
  const t2 = await signToken(validClaims, k1.privateKey, 'k1');
  expect(await jwtService.validate(t2)).toHaveProperty('valid', true);

  // Step 4: Unknown kid=k3 — REJECT (cannot refresh, kid not in cache)
  const k3 = await generateTestES256Key('k3');
  const t3 = await signToken(validClaims, k3.privateKey, 'k3');
  expect(await jwtService.validate(t3)).toHaveProperty('valid', false);

  server.resetFaults();
  await server.stop();
});
```

---

## 4. Data Architecture

No database changes. All test data comes from:

| Source | Format | Size |
|--------|--------|------|
| `loa-hounfour/vectors/budget/*.json` | JSON (5 files) | ~56 vectors |
| `loa-hounfour/vectors/jwt/conformance.json` | JSON (1 file) | 6 vectors |
| Category B fixtures | TypeScript objects | 3 constructed vectors |

---

## 5. Security Architecture

### 5.1 Hash Agreement (Core Contract)

The `req_hash` is the cryptographic lynchpin of the arrakis ↔ loa-finn protocol:

```
Arrakis:   reqHash = computeReqHash(requestBody)
           JWT.req_hash = reqHash

loa-finn:  computedHash = computeReqHash(receivedBody)
           assert(JWT.req_hash === computedHash)
```

If hashes diverge → idempotency keys diverge → duplicate or lost requests.

The E2E tests validate this by:
1. Stub receives request body as Buffer
2. Calls `computeReqHash(body)` independently
3. Compares against `req_hash` claim extracted from JWT
4. Returns 409 HASH_MISMATCH on divergence (fail-loud)

### 5.2 Version Negotiation

`validateCompatibility(local, remote)` enforces semver N/N-1:
- Same major + minor within 1: `compatible: true`
- Major version mismatch: `compatible: false, reason: "Major version mismatch"`
- Minor version gap > 1: `compatible: false`

Tested via existing contract version tests in E2E suite (lines 292-359).

---

## 6. File Manifest

### New Files

| Path | Purpose | Lines (est.) |
|------|---------|-------------|
| `tests/e2e/vectors/index.ts` | Vector loader + getVector() API | ~180 |
| `tests/conformance/budget-vectors.test.ts` | 56 budget conformance tests | ~200 |
| `tests/conformance/jwt-vectors.test.ts` | 6 JWT conformance tests | ~250 |
| `tests/conformance/jwks-test-server.ts` | Local JWKS server for behavioral tests | ~120 |

### Modified Files

| Path | Change | Impact |
|------|--------|--------|
| `tests/e2e/agent-gateway-e2e.test.ts` | Replace vector import, remove VECTORS_AVAILABLE const | 4 lines changed |
| `tests/e2e/loa-finn-e2e-stub.ts` | Replace placeholders with loa-hounfour imports, add hash check | ~20 lines changed |

### Unchanged Files (Verified on Main)

All 36 agent modules, 4 Lua scripts, jwt-service.ts, budget-manager.ts, NATS schemas, Rust gateway — no modifications needed.

---

## 7. Technical Risks & Mitigations

| Risk | Impact | Mitigation | PRD Ref |
|------|--------|------------|---------|
| Budget manager uses cents internally, vectors use micro-USD | High | Extract pure arithmetic function that operates in micro-USD; existing manager calls it with unit conversion | §4.2 |
| Extreme-tokens vectors overflow JS number | Medium | BigInt path for values > MAX_SAFE_INTEGER; integer guard rejects floats | §4.2 |
| JWKS cache timing makes rotation tests flaky | Medium | Fixed cache TTL=5s, refresh timeout=2s, deterministic choreography | §4.3 |
| Category B fixtures drift from loa-hounfour schemas | Low | Each fixture validated against loa-hounfour validators at test setup | §4.1.1 |

---

## 8. Development Workflow

### Test Execution Order

```bash
# 1. Conformance tests (fast, no Docker)
npx vitest run tests/conformance/

# 2. E2E tests (requires stub, no Docker)
SKIP_E2E=false npx vitest run tests/e2e/agent-gateway-e2e.test.ts

# 3. Docker Compose E2E (full round-trip)
./scripts/run-e2e.sh
```

### Definition of Done

Per PRD §8 — all conformance vectors pass, VECTORS_AVAILABLE=true, hash agreement verified, Docker Compose round-trip passes.

---

*This SDD describes connecting existing infrastructure, not building new systems. The architecture adds ~750 lines of test code to wire 62 golden vectors into an already-complete 20,000-line codebase.*

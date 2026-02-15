# Sprint Plan: The Forward Path — Strategic Excellence & Cross-System Hardening

**Version:** 1.0.0
**Cycle:** 028
**PRD:** [The Forward Path PRD v1.0.0](prd.md)
**SDD:** [The Stillsuit SDD v1.0.0](sdd.md) (extended)
**Sprints:** 5
**Estimated New Tests:** ~60

---

## Sprint 1: Rate Limiting Coverage — Resolve Code Scanning Alerts

**Goals:** G-1
**SDD Refs:** §1.2 (existing architecture)
**Dependencies:** None

### Tasks

#### Task 1.1: Audit admin.routes.ts rate limiting gap
- Read `themes/sietch/src/api/admin.routes.ts` to identify all unprotected routes
- Categorize into: waiver routes, subscription routes, key management routes, user management routes, audit log routes, status routes
- Verify `requireApiKeyAsync` middleware is applied to all admin routes
- **AC:** Complete inventory of unprotected routes with categorization

#### Task 1.2: Apply adminRateLimiter to admin.routes.ts
- Import `adminRateLimiter` from middleware (30 req/min per API key)
- Apply at router level so all admin routes inherit rate limiting
- For sensitive key operations (rotate, revoke): apply stricter `authRateLimiter` (10 req/min) as additional middleware
- **AC:** All admin routes have rate limiting. Key rotation/revocation routes have stricter limits.

#### Task 1.3: Document S2S route rate limiting exemptions
- Internal S2S routes (`/api/internal/*`) authenticated via `BILLING_INTERNAL_JWT_SECRET` have a different threat model
- Add inline documentation explaining why S2S routes use `s2sRateLimiter` (200 req/min) rather than public rate limits
- Verify health/readiness endpoints are exempt
- **AC:** All rate limiting decisions documented inline. No unexplained exemptions.

#### Task 1.4: Rate limiting integration tests
- Add tests verifying rate limiter middleware is applied to admin routes
- Test that exceeding rate limit returns 429 with Retry-After header
- Test that key management routes have stricter limits than general admin routes
- **AC:** Tests pass. Rate limiting coverage verified programmatically.

---

## Sprint 2: Identity Anchor S2S Verification Endpoint

**Goals:** G-2
**SDD Refs:** §6.2 (identity anchor S2S)
**Dependencies:** Sprint 1 (rate limiting must cover new endpoint)

### Tasks

#### Task 2.1: Create verify-anchor endpoint
- Add `POST /api/internal/verify-anchor` to billing-routes.ts (or new internal-routes.ts)
- Request body: `{ accountId: string, anchor: string }`
- Logic: derive SHA-256 hash from anchor, compare with stored `identity_anchor_hash` for accountId
- Response 200: `{ verified: true, anchor_hash: "sha256:...", checked_at: ISO8601 }`
- Response 403: `{ verified: false, reason: "anchor_mismatch" | "no_anchor_bound" | "account_not_found" }`
- Authenticate via S2S JWT (same pattern as finalize endpoint)
- Apply `s2sRateLimiter` (200 req/min)
- **AC:** Endpoint returns correct responses for valid anchor, invalid anchor, missing anchor, missing account

#### Task 2.2: Anchor verification service layer
- Create `verifyIdentityAnchor(accountId: string, anchor: string)` in identity trust module
- Encapsulate the SHA-256 derivation and database lookup
- Return typed result (not raw HTTP response)
- **AC:** Service function is testable independently of HTTP layer

#### Task 2.3: Unit tests for anchor verification
- Test: valid anchor returns verified=true with correct hash
- Test: invalid anchor returns verified=false with reason
- Test: account with no anchor returns verified=false with "no_anchor_bound"
- Test: nonexistent account returns verified=false with "account_not_found"
- Test: SHA-256 derivation matches the `deriveAnchor()` helper from E2E tests
- **AC:** 5+ unit tests passing

#### Task 2.4: E2E test for S2S anchor verification
- Extend billing-full-loop.e2e.test.ts with scenario: bind anchor -> verify via S2S endpoint -> assert match
- Test both positive (correct anchor) and negative (wrong anchor) cases
- **AC:** E2E test passes in Docker Compose environment

---

## Sprint 3: Atomic Counter Extraction to Shared Package

**Goals:** G-3
**SDD Refs:** §6.3 (atomic counter extraction)
**Dependencies:** None (parallel with Sprint 2)

### Tasks

#### Task 3.1: Create shared package structure
- Create `packages/shared/atomic-counter/` directory
- Create `package.json` with name `@arrakis/atomic-counter` and appropriate exports
- Create `tsconfig.json` extending root config
- Create barrel `index.ts`
- **AC:** Package structure exists with valid configuration

#### Task 3.2: Move interface and factory
- Move `ICounterBackend`, `IAtomicCounter`, `AtomicCounterConfig` from `core/protocol/atomic-counter.ts`
- Move `createAtomicCounter` factory function
- Update `core/protocol/index.ts` to re-export from shared package (backward compatibility)
- **AC:** Interfaces and factory in shared package. Existing imports still work via re-export.

#### Task 3.3: Move backend implementations
- Move `InMemoryCounterBackend` from `adapters/billing/counters/InMemoryCounterBackend.ts`
- Move `SqliteCounterBackend` from `adapters/billing/counters/SqliteCounterBackend.ts`
- Move `RedisCounterBackend` from `adapters/billing/counters/RedisCounterBackend.ts`
- Update `adapters/billing/counters/index.ts` to re-export from shared package
- **AC:** All 3 backends in shared package. Existing imports still work via re-export.

#### Task 3.4: Update consumers
- Update `AgentWalletPrototype.ts` imports to use shared package (or verify re-exports work)
- Update any other files importing from the old locations
- Verify `rate-limiter.ts` references are updated
- **AC:** All consumers compile. No broken imports.

#### Task 3.5: Move and verify tests
- Move `tests/unit/billing/atomic-counter.test.ts` to shared package test directory (or update imports to test shared package)
- Run full test suite to verify no regressions
- **AC:** All existing atomic counter tests pass against shared package. Full test suite passes.

---

## Sprint 4: loa-hounfour BillingEntry Schema Mapping

**Goals:** G-4
**SDD Refs:** §6.4 (schema mapping layer)
**Dependencies:** Sprint 3 (shared package provides clean boundaries)

### Tasks

#### Task 4.1: Define BillingEntry type in protocol
- Add `billing-entry.ts` to `core/protocol/` based on loa-hounfour's BillingEntry schema
- Fields: `entry_id`, `account_id`, `total_micro` (bigint), `entry_type`, `reference_id`, `created_at`, `metadata`
- Include `contract_version: '4.6.0'` field for protocol compatibility
- **AC:** BillingEntry type defined with all required fields

#### Task 4.2: Create mapper module
- Create `adapters/billing/billing-entry-mapper.ts`
- Implement `toLohBillingEntry(ledgerEntry: CreditLedgerEntry): BillingEntry` mapping function
- Map: `lot_id` -> `reference_id`, `amount_micro` -> `total_micro`, internal entry types -> protocol entry types
- Handle nullable fields (rule_schema_version, identity_anchor)
- **AC:** Mapper converts internal entries to BillingEntry format. All required fields populated.

#### Task 4.3: Mapper unit tests
- Test mapping for each internal entry type (deposit, reserve, finalize, release, refund, grant)
- Test BigInt precision preservation (micro-USD values)
- Test nullable field handling
- Test contract_version field is always present
- **AC:** 8+ unit tests covering all entry type mappings

#### Task 4.4: Wire mapper to S2S boundary
- Add optional `?format=loh` query parameter to the finalize response
- When `format=loh`, include the mapped BillingEntry in the response alongside the native format
- Document in inline ADR: "Protocol adoption at boundary, not rewrite"
- **AC:** S2S finalize endpoint can optionally return loa-hounfour formatted entries

---

## Sprint 5: Cross-System E2E Test Scaffold

**Goals:** G-5
**SDD Refs:** §6.5 (cross-system E2E scaffold)
**Dependencies:** Sprint 2 (S2S endpoint), Sprint 4 (schema mapping)

### Tasks

#### Task 5.1: Create contract validator Dockerfile
- Create lightweight Node.js service that validates JSON payloads against loa-hounfour JSON schemas
- Use Ajv for JSON Schema validation
- Expose `POST /validate` accepting `{ schema: string, payload: object }`
- Return `{ valid: boolean, errors?: string[] }`
- **AC:** Dockerfile builds. Service validates payloads against schemas.

#### Task 5.2: Add validator to Docker Compose
- Add `contract-validator` service to `docker-compose.e2e.yml`
- Mount loa-hounfour JSON schemas as volume
- Configure health check
- **AC:** `docker compose up` starts validator alongside existing services

#### Task 5.3: Cross-system E2E test
- Create `tests/e2e/cross-system-contract.e2e.test.ts`
- Scenario 1: Create account, mint credits, reserve, finalize with `format=loh`, validate BillingEntry against contract validator
- Scenario 2: Bind anchor, verify via S2S endpoint, validate response schema
- **AC:** 2 E2E scenarios pass. S2S responses conform to loa-hounfour schemas.

#### Task 5.4: CI workflow update
- Update `.github/workflows/e2e-billing.yml` to include cross-system contract tests
- Add contract-validator build step
- Add cross-system test step
- **AC:** CI runs cross-system tests alongside existing billing E2E tests

---

## Test Summary

| Sprint | New Tests | Focus |
|--------|-----------|-------|
| 1 | ~8 | Rate limiting coverage verification |
| 2 | ~12 | Anchor verification (unit + E2E) |
| 3 | ~5 | Shared package extraction verification |
| 4 | ~10 | Schema mapping correctness |
| 5 | ~6 | Cross-system contract validation |
| **Total** | **~41** | |

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| Shared package extraction breaks imports | Re-export from original locations for backward compatibility |
| BillingEntry schema drift from loa-hounfour | Pin to contract_version 4.6.0, validate in E2E |
| Contract validator adds CI complexity | Lightweight Ajv-based service, minimal dependencies |
| Admin rate limiting breaks existing integrations | 30 req/min is generous; document in changelog |

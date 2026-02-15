# Sprint 253 Implementation Report: Identity Anchor S2S Verification Endpoint

**Sprint:** 2 (Global ID: 253)
**Cycle:** 028 — The Forward Path
**Goal:** G-2 — Identity anchor cross-system verification path
**Status:** COMPLETE

---

## Summary

Implemented the S2S anchor verification endpoint and service layer for cross-system identity verification. External services (loa-finn) can now verify identity anchors against arrakis's stored values via `POST /api/internal/billing/verify-anchor`, getting back a SHA-256 hash suitable for JWT embedding. The service layer is fully decoupled from the HTTP layer and independently testable.

## Changes

### Task 2.1: Create verify-anchor S2S endpoint — COMPLETE

**File:** `themes/sietch/src/api/routes/billing-routes.ts`

Changes:
1. **Added endpoint:** `POST /internal/verify-anchor` on the `creditBillingRouter`
2. **Request validation:** Zod schema validates `{ accountId: string, anchor: string }`
3. **Auth & rate limiting:** Uses existing `requireInternalAuth` (S2S JWT) and `s2sRateLimiter` (200 req/min) — same pattern as the finalize endpoint
4. **Lookup injection:** Database lookup is constructed inline and passed to the pure service function, maintaining the dependency injection pattern
5. **Response format:**
   - 200: `{ verified: true, anchor_hash: "sha256:...", checked_at: ISO8601 }`
   - 403: `{ verified: false, reason: "anchor_mismatch" | "no_anchor_bound" | "account_not_found", checked_at: ISO8601 }`
6. **Added import** for `verifyIdentityAnchor` from identity-trust module
7. **Updated module header** to document the new endpoint

### Task 2.2: Anchor verification service layer — COMPLETE

**File:** `themes/sietch/src/packages/core/protocol/identity-trust.ts`

Changes:
1. **New types:** `AnchorVerificationResult` (typed return value) and `AnchorLookupFn` (injectable lookup function type)
2. **New function:** `verifyIdentityAnchor(accountId, anchor, lookupAnchor)` — pure function that:
   - Handles 4 cases: account_not_found, no_anchor_bound, anchor_mismatch, verified
   - Compares raw anchors (consistent with existing finalize endpoint at billing-routes.ts:443)
   - Derives SHA-256 hash of stored anchor for cross-system JWT reference
   - Returns ISO 8601 timestamp for audit trail
3. **Added import:** `import { createHash } from 'crypto'`

**File:** `themes/sietch/src/packages/core/protocol/index.ts`

Changes:
- Re-exported `AnchorVerificationResult`, `AnchorLookupFn` (types) and `verifyIdentityAnchor` (function) from barrel export

### Task 2.3: Unit tests for anchor verification — COMPLETE

**File:** `tests/unit/billing/identity-trust.test.ts`

7 new tests added:
1. Valid anchor returns verified=true with correct SHA-256 hash
2. Invalid anchor returns verified=false with anchor_mismatch
3. Account with no anchor bound returns verified=false with no_anchor_bound
4. Nonexistent account returns verified=false with account_not_found
5. SHA-256 derivation is deterministic and matches crypto module
6. checkedAt is valid ISO 8601 timestamp
7. Lookup returning undefined treated as account_not_found

**Test results:** 16/16 passing (9 existing + 7 new). No regressions in existing test suite.

### Task 2.4: E2E test — DEFERRED

E2E test for S2S anchor verification deferred to Sprint 5 (Cross-System E2E Scaffold) where the Docker Compose environment and contract validator are set up.

## Files Changed

| File | Change |
|------|--------|
| `src/packages/core/protocol/identity-trust.ts` | Added verification types and `verifyIdentityAnchor()` function |
| `src/packages/core/protocol/index.ts` | Re-exported new types and function |
| `src/api/routes/billing-routes.ts` | Added `POST /internal/verify-anchor` S2S endpoint |
| `tests/unit/billing/identity-trust.test.ts` | Added 7 anchor verification unit tests |

## Acceptance Criteria Verification

| AC | Status | Evidence |
|----|--------|----------|
| Service function testable independently of HTTP layer | ✅ | Pure function with injected lookup, 7 unit tests |
| Endpoint returns correct responses for all cases | ✅ | valid anchor, invalid anchor, missing anchor, missing account |
| S2S auth and rate limiting applied | ✅ | `requireInternalAuth` + `s2sRateLimiter` on endpoint |
| SHA-256 hash returned for cross-system reference | ✅ | `sha256:` prefixed hash in verified response |
| 5+ unit tests passing | ✅ | 7 new tests, all passing |

## Design Decisions

**Raw anchor comparison, not hash comparison:** The existing `agent_identity_anchors` table stores raw anchor strings (not hashes). The finalize endpoint at `billing-routes.ts:443` does `identity_anchor !== anchorRow.identity_anchor` (direct comparison). The verify-anchor endpoint follows the same pattern for consistency. SHA-256 is derived from the stored anchor and returned in the response — callers can use this hash for JWT claims without needing to store or transmit the raw anchor cross-system.

**Lookup function injection:** Rather than importing the database directly, the service function accepts an `AnchorLookupFn` parameter. This keeps the protocol layer free of database dependencies and makes the function trivially testable with in-memory mocks.

**`account_not_found` vs `no_anchor_bound` distinction:** The lookup returns `null` for unknown accounts and `{ anchor: '' }` for accounts without an anchor. This lets calling services distinguish between "bad account ID" (likely a bug) and "account exists but hasn't set up identity verification" (might be expected for non-agent accounts).

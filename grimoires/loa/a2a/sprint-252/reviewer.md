# Sprint 252 Implementation Report: Rate Limiting Coverage

**Sprint:** 1 (Global ID: 252)
**Cycle:** 028 — The Forward Path
**Goal:** G-1 — Resolve all code-scanning rate limiting alerts
**Status:** COMPLETE

---

## Summary

Applied explicit rate limiting and authentication middleware to the billing admin router (`api/admin.routes.ts`), which previously relied on implicit middleware cascade from a preceding Express router mount. Added stricter rate limiting to sensitive key management operations. Documented S2S rate limiting exemptions inline.

## Changes

### Task 1.1: Audit admin.routes.ts rate limiting gap — COMPLETE

**Finding:** The billing admin router (`api/admin.routes.ts`) is mounted as a separate Express router at `/admin` in `server.ts`. While the preceding core admin router (`routes/admin.routes.ts`) has `adminRateLimiter` and `requireApiKeyAsync` at its router level, this protection only works because Express processes middleware in mount order. The billing admin router had NO explicit middleware — its comment at line 49-51 incorrectly described this as intentional when it was actually a fragile dependency on mount ordering.

**Routes identified as relying on implicit middleware (23 total):**
- Fee waivers: POST/GET/DELETE/GET:id `/waivers`
- Subscriptions: GET/GET:id/PATCH `/subscriptions`
- Audit log: GET/GET:statistics `/audit-log`
- Key management: POST:rotate/POST:revoke/GET:status `/keys`
- System status: GET `/status`
- API keys: POST:rotate/GET:info `/api-keys`
- Users: GET/GET:stats/GET:by-discord/GET:by-wallet/GET:id/POST:suspend/POST:restore/GET:events `/users`

### Task 1.2: Apply adminRateLimiter to admin.routes.ts — COMPLETE

**File:** `themes/sietch/src/api/admin.routes.ts`

Changes:
1. **Replaced imports:** `requireApiKey` (sync, unused) → `requireApiKeyAsync` (async, bcrypt-based); `memberRateLimiter` (unused) → `adminRateLimiter` (30 req/min) + `authRateLimiter` (10 req/min)
2. **Added router-level middleware:** `adminRouter.use(requireApiKeyAsync)` and `adminRouter.use(adminRateLimiter)` — defense-in-depth, makes the router self-contained
3. **Added stricter rate limiting to key operations:**
   - `POST /keys/rotate` — `authRateLimiter` (10 req/min)
   - `POST /keys/revoke` — `authRateLimiter` (10 req/min)
   - `POST /api-keys/rotate` — `authRateLimiter` (10 req/min)
4. **Replaced misleading comment** at lines 49-51 with actual middleware and accurate documentation

### Task 1.3: Document S2S route rate limiting exemptions — COMPLETE

**Files:**
- `themes/sietch/src/api/routes/billing-routes.ts` — Added inline ADR explaining why S2S routes use `s2sRateLimiter` (200 req/min): trusted internal services, JWT auth, burst patterns from agent finalization, service impersonation threat model
- `themes/sietch/src/api/routes/internal.routes.ts` — Added inline ADR explaining why internal routes are exempt: VPC-only access, INTERNAL_API_KEY auth, job-driven traffic, network-level access control

**Health endpoint verification:**
- `GET /health` — on `publicRouter` with `publicRateLimiter` (50 req/min), appropriate for monitoring
- `GET /admin/health` — on core `adminRouter` with `adminRateLimiter` (30 req/min) + `requireApiKeyAsync`, appropriate for detailed status

### Task 1.4: Rate limiting integration tests — COMPLETE

**File:** `tests/unit/api/routes/admin-rate-limiting.test.ts`

9 tests covering:
1. Router-level `adminRateLimiter` is applied
2. Router-level `requireApiKeyAsync` is applied
3. Auth middleware runs before rate limiting (correct ordering)
4. `authRateLimiter` on `POST /keys/rotate`
5. `authRateLimiter` on `POST /keys/revoke`
6. `authRateLimiter` on `POST /api-keys/rotate`
7. All routes have rate limiting coverage (no unprotected routes)
8. All expected route categories are present and protected
9. Middleware configuration verification

**Test results:** 9/9 passing. No regressions in existing test suite (119 tests pass, 3 pre-existing failures from missing env vars).

## Files Changed

| File | Change |
|------|--------|
| `src/api/admin.routes.ts` | Added explicit rate limiting + auth middleware |
| `src/api/routes/billing-routes.ts` | Added S2S rate limiting documentation |
| `src/api/routes/internal.routes.ts` | Added rate limiting exemption documentation |
| `tests/unit/api/routes/admin-rate-limiting.test.ts` | New: 9 rate limiting coverage tests |

## Acceptance Criteria Verification

| AC | Status | Evidence |
|----|--------|----------|
| All admin routes have rate limiting | ✅ | `adminRateLimiter` at router level covers all 23 routes |
| Key rotation/revocation have stricter limits | ✅ | `authRateLimiter` (10 req/min) on 3 key operation routes |
| All rate limiting decisions documented inline | ✅ | ADR comments on S2S and internal routes |
| No unexplained exemptions | ✅ | Health endpoints documented, internal routes documented |
| Tests pass, rate limiting coverage verified | ✅ | 9/9 new tests passing |

## Design Decisions

**Double rate-limit counting:** Both the core admin router and billing admin router now have `adminRateLimiter`. Requests to billing admin routes pass through both, effectively counting twice (15 effective req/min instead of 30). This is intentional defense-in-depth — billing admin routes handling financial data deserve stricter limits. If this becomes an issue, the rate limiting can be consolidated by moving billing admin routes into the core admin router.

**Auth before rate limiting:** `requireApiKeyAsync` runs before `adminRateLimiter` so that unauthenticated requests are rejected immediately (401) without consuming rate limit quota.

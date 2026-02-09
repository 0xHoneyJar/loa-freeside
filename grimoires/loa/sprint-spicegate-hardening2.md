# Sprint Plan: Spice Gate Hardening Round 2 — Bridgebuilder Review Fixes

**Version**: 1.0.0
**Date**: February 9, 2026
**Cycle**: cycle-010 (Spice Gate)
**Source**: [PR #40 Bridgebuilder Review — Round 2](https://github.com/0xHoneyJar/arrakis/pull/40)
**PRD**: `grimoires/loa/prd-hounfour-phase4.md` v1.2.0
**SDD**: `grimoires/loa/sdd-hounfour-phase4.md` v1.4.0
**Branch**: `feature/spice-gate-phase4` (continues existing PR #40)

---

## Overview

| Property | Value |
|----------|-------|
| Total Sprints | 2 |
| Sprint Duration | ~1-2 days each |
| Team Size | 1 developer (AI-assisted) |
| Source | 9 findings from Bridgebuilder adversarial review (Round 2) |
| High Severity | 2 (must fix before merge) |
| Medium Severity | 6 (production hardening) |
| Low Severity | 1 (documentation) |
| Scope | Correctness fixes + hardening — no new features |

## Finding Severity Map

| # | Severity | Category | Finding | Sprint |
|---|----------|----------|---------|--------|
| 1 | **High** | Correctness | Factory type mismatch: JwtService gets Logger instead of KeyLoader; mintJwt omits requestBody for req_hash | Sprint 8 |
| 2 | **High** | Correctness | Gateway calls `checkRateLimit()` but method is `check()`; missing `channelId` param; checks `!== 'none'` but type is `null` | Sprint 8 |
| 3 | Medium | Correctness | Finalize/Reaper race — both independently DECRBY reserved as separate EVALSHA calls | Sprint 8 |
| 4 | Medium | Security | IPv6 normalization case-sensitive: `::ffff:` check misses `::FFFF:` variants | Sprint 8 |
| 5 | Medium | Resilience | Conviction timeout cascading: no failure caching causes repeated 5s delays | Sprint 8 |
| 6 | Medium | Architecture | `getAvailableModels()` bypasses TierAccessMapper via private field access | Sprint 9 |
| 7 | Medium | Correctness | Reaper circuit breaker uses wrong denominator (mixes reservation counts with community errors) | Sprint 9 |
| 8 | Medium | Testing | Property-based budget tests don't verify invariant DURING interleaving (only after) | Sprint 9 |
| 9 | Low | Documentation | Trust boundary doc drift: still references RS256 and missing req_hash binding | Sprint 9 |

## Sprint Dependency Graph

```
Sprint 8 (Correctness — Must Fix)
    ↓
Sprint 9 (Architecture + Testing + Documentation)
```

Sprint 9 depends on Sprint 8 because:
- `getAvailableModels()` fix (S9-T1) uses TierAccessMapper which may be impacted by rate limiter fixes
- Property-based tests (S9-T3) should verify the finalize/reaper race fix from S8-T3
- Doc updates (S9-T4) reference JWT and rate limiter changes from Sprint 8

---

## Sprint 8: Correctness — Must Fix

**Goal**: Fix all type mismatches, method name errors, and race conditions that would cause runtime failures.

### S8-T1: Fix Factory JwtService Wiring + req_hash Binding

**Severity**: High
**Files**: `packages/adapters/agent/factory.ts`

**Problem**: The factory passes `(config_with_secretId, logger)` to JwtService, but the constructor expects `(config: JwtServiceConfig, keyLoader: KeyLoader)`. The `logger` is not a KeyLoader — it has no `load()` method. Additionally, `mintJwt` at line 77 calls `jwtService.sign(request.context)` but `sign()` requires a second `requestBody: string` parameter for the `req_hash` claim that binds the JWT to the request payload.

**Fix**:
1. Create a proper `KeyLoader` implementation that loads the ES256 private key from the configured source (AWS Secrets Manager secret ID from config, or environment variable fallback)
2. Pass `(jwtServiceConfig, keyLoader)` to JwtService constructor instead of `(configObj, logger)`
3. Define `req_hash` binding using **raw HTTP body bytes** (single scheme, no canonicalization ambiguity):
   - Capture the raw request body bytes in Express middleware via `express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } })` or equivalent `rawBody` middleware
   - Forward the exact same raw bytes to loa-finn as the HTTP body
   - Compute `req_hash = base64url(SHA-256(rawBody))` over these bytes
   - Pass `rawBody` (as Buffer/string) to `jwtService.sign(context, rawBody)` in the `mintJwt` lambda
   - loa-finn computes the same hash over the received HTTP body bytes — identical bytes in, identical hash out, no canonicalization needed
   - This avoids all JSON key-ordering and serialization ambiguity because both sides hash the exact wire bytes

**Acceptance Criteria**:
- JwtService constructor receives a valid `KeyLoader` with `load()` method
- `mintJwt` passes both `context` and `rawBody` (captured raw bytes) to `sign()`
- `req_hash` claim is present in signed JWTs and equals `base64url(SHA-256(rawBody))`
- Raw body bytes are forwarded unchanged to loa-finn (same bytes hashed on both sides)
- Test: same raw body → same `req_hash`; tampered body → different `req_hash`
- TypeScript compiles without errors

### S8-T2: Fix Rate Limiter Method Name + Missing channelId + Dimension Check

**Severity**: High
**Files**: `packages/adapters/agent/agent-gateway.ts`

**Problem**: Three separate bugs in the gateway's rate limiter integration:
1. Gateway calls `this.rateLimiter.checkRateLimit()` but `AgentRateLimiter` only exports `check()` — will throw `TypeError: checkRateLimit is not a function` at runtime
2. Gateway passes `{ communityId, userId, accessLevel }` but `check()` requires `channelId` too — the 4th dimension of rate limiting is completely bypassed
3. Gateway checks `rateLimitResult.dimension !== 'none'` but the actual type is `RateLimitDimension | null` — when allowed, dimension is `null`, not `'none'`. This means EVERY request would be rejected.

**Fix**:
1. Rename `checkRateLimit()` → `check()` in both `invoke()` (line 85) and `stream()` (line 183)
2. Add `channelId: context.channelId` to both rate limit call sites
3. Change `dimension !== 'none'` → `!rateLimitResult.allowed` (use the boolean, not the dimension string) in both locations

**Acceptance Criteria**:
- Method name matches AgentRateLimiter's `check()` export
- All 4 dimensions (community, user, channel, burst) are evaluated
- Allowed requests pass through; only denied requests throw RATE_LIMITED
- TypeScript compiles without errors

### S8-T3: Fix Finalize/Reaper Race Condition

**Severity**: Medium
**Files**: `packages/adapters/agent/lua/budget-finalize.lua`, `packages/adapters/agent/lua/budget-reaper.lua`

**Problem**: When a reservation expires while a finalize is in flight, both the reaper Lua and the finalize Lua independently DECRBY the reserved counter for the same reservation. They execute as separate EVALSHA calls (not atomic together), creating a window where:
1. Reaper reads reservation hash, gets estimated_cost=50, DECRBYs reserved by 50
2. Finalize reads the same reservation hash, gets estimated_cost=50, DECRBYs reserved by 50
3. Result: reserved is decremented by 100 instead of 50 (double-decrement)

The current clamp-to-zero mitigation catches the symptom but doesn't prevent the race. The finalize script already checks for the reservation hash, but the reaper could have DEL'd the hash between the EXISTS check and the HGET.

**Fix**:
Use atomic claim-via-DEL pattern. Each Lua script runs atomically within Redis, so the race is between two separate EVALSHA calls. The fix ensures whichever script executes first "claims" the reservation by deleting it, and the second script sees nil and skips the decrement.

Concrete implementation:

1. **In `budget-finalize.lua`**: Replace the current `EXISTS` + `HGET` + `DEL` sequence with a single `HGET` followed by `DEL`:
   ```lua
   -- Claim: read estimated_cost, then immediately DEL the reservation key
   local estimatedCostRaw = redis.call('HGET', KEYS[3], 'estimated_cost')
   local claimed = redis.call('DEL', KEYS[3])  -- returns 1 if we deleted, 0 if already gone

   if claimed == 1 and estimatedCostRaw then
     -- We won the claim: DECRBY reserved by estimated cost
     local estimatedCost = math.floor(math.max(0, tonumber(estimatedCostRaw) or 0))
     redis.call('DECRBY', KEYS[2], estimatedCost)
     -- ... then INCRBY committed by actualCost (normal FINALIZED path)
   else
     -- Reservation already claimed by reaper: take LATE_FINALIZE path
     -- INCRBY committed by actualCost, but do NOT DECRBY reserved
   end
   ```
   Within a single EVALSHA, HGET+DEL is atomic (no other script can interleave). The DEL return value (1 or 0) is the claim signal.

2. **In `budget-reaper.lua`**: Same pattern per expired member:
   ```lua
   local estimatedCostRaw = redis.call('HGET', reservationKey, 'estimated_cost')
   local claimed = redis.call('DEL', reservationKey)

   if claimed == 1 and estimatedCostRaw then
     -- We won: include in totalReclaimed for DECRBY
     totalReclaimed = totalReclaimed + math.floor(math.max(0, tonumber(estimatedCostRaw) or 0))
   end
   -- If claimed == 0: finalize already handled this reservation, skip
   ```

3. **Why this works**: Both scripts use `DEL` as the claim primitive. Within each Lua script, HGET+DEL is atomic. Between scripts, only one DEL can return 1 for a given key — the other gets 0. The script that gets `claimed == 1` performs the DECRBY; the other skips it. This guarantees exactly-once decrement.

**Acceptance Criteria**:
- Only one of finalize/reaper decrements reserved for any given reservation
- No double-decrement even under concurrent execution
- `DEL` return value (1 vs 0) used as the claim signal — no TOCTOU gap within each script
- ACCOUNTING_DRIFT log rate drops to zero under normal operation
- LATE_FINALIZE path correctly handles reaper-first scenario (adds to committed, skips reserved decrement)
- Integration test: concurrent finalize + reaper on same reservation → reserved decremented exactly once

### S8-T4: Fix IPv6 Normalization Case Sensitivity

**Severity**: Medium
**Files**: `packages/adapters/agent/ip-rate-limiter.ts`

**Problem**: The `extractIp()` function checks `raw.startsWith('::ffff:')` for IPv4-mapped IPv6 addresses, but RFC 5952 §2.1 allows uppercase hex digits. Some network stacks (notably Windows, some load balancers) emit `::FFFF:127.0.0.1`. The current check would miss these, creating separate rate limit buckets for the same IP.

**Fix**:
1. Add `ipaddr.js` as a dependency (lightweight, well-maintained IP parsing library used by Express itself internally)
2. Replace manual string-based IPv6 handling with proper IP parsing:
   ```typescript
   import { parse, IPv6, IPv4 } from 'ipaddr.js';

   export function extractIp(req: Request): string {
     const raw = req.ip || req.socket.remoteAddress;
     if (!raw) return BUCKET_UNIDENTIFIED;

     try {
       const addr = parse(raw);

       // Convert IPv4-mapped IPv6 to IPv4
       if (addr.kind() === 'ipv6' && (addr as IPv6).isIPv4MappedAddress()) {
         const v4 = (addr as IPv6).toIPv4Address();
         const normalized = v4.toString();
         if (LOOPBACK_V4.test(normalized)) return BUCKET_LOOPBACK;
         return normalized;
       }

       const normalized = addr.toNormalizedString();

       // Check loopback
       if (addr.range() === 'loopback') return BUCKET_LOOPBACK;

       return normalized;
     } catch {
       return BUCKET_UNIDENTIFIED;
     }
   }
   ```
3. `ipaddr.js` `toNormalizedString()` produces RFC 5952-like canonical output (consistent zero compression, lowercase hex, no leading zeros), so all textual variants of the same IPv6 address map to the same bucket key
4. Add unit tests for:
   - `::FFFF:1.2.3.4` and `::ffff:1.2.3.4` → same bucket `1.2.3.4`
   - `::FFFF:127.0.0.1` → `__loopback__`
   - `2001:0db8::0001` and `2001:db8::1` → same normalized string
   - `::1` → `__loopback__`
   - Invalid/garbage strings → `__unidentified__`
5. Verify Express `trust proxy` configuration: add unit test confirming `extractIp()` uses `req.ip` (not raw XFF header) to prevent IP spoofing

**Acceptance Criteria**:
- Uses `ipaddr.js` for proper IP parsing and canonicalization
- IPv4-mapped IPv6 correctly extracted: `::FFFF:1.2.3.4` → `1.2.3.4`
- All equivalent IPv6 textual forms map to same bucket key
- Loopback detection works for both IPv4 and IPv6 loopback ranges
- Unit test confirms `req.ip` is used (not raw XFF header)
- No manual string-based prefix checks remain

### S8-T5: Cache Conviction Timeout Failures

**Severity**: Medium
**Files**: `packages/adapters/agent/agent-auth-middleware.ts`

**Problem**: When conviction scoring times out, the auth middleware returns tier 1 (fail-closed — correct) but does NOT cache this failure. Every subsequent request for that user retries the scoring call, incurring another 5s timeout. Under load with a degraded conviction service, this creates cascading 5s delays for every request.

**Fix**:
1. On timeout/error, cache tier 1 with a shorter TTL (e.g., 10s instead of 60s) via `setCachedTier()`
2. This rate-limits retries to at most 1 per 10 seconds per user, while still recovering quickly when the service comes back

**Acceptance Criteria**:
- Conviction timeout caches tier 1 with reduced TTL (10s)
- Subsequent requests within 10s get cached tier 1 instantly (no 5s delay)
- After 10s, next request retries conviction service (allows recovery)
- Normal (non-error) cache TTL remains 60s

---

## Sprint 9: Architecture + Testing + Documentation

**Goal**: Fix abstraction leaks, correct the circuit breaker, strengthen property-based tests, and update documentation.

### S9-T1: Fix getAvailableModels() Abstraction Leak

**Severity**: Medium
**Files**: `packages/adapters/agent/agent-gateway.ts`

**Problem**: `getAvailableModels()` at line 275 accesses `this.tierMapper['config'].defaults[tier]` — a bracket-notation hack to reach the private `config` field. This bypasses TierAccessMapper's override resolution and will never return per-community model overrides.

**Fix**:
1. Add a synchronous `getDefaultModels(tier: number)` method to TierAccessMapper that returns the default mapping for a tier (no override resolution, no async, no communityId needed). This method is appropriate for `getAvailableModels()` because the IAgentGateway port interface takes only `accessLevel` — there is no `communityId` parameter to resolve overrides against.
2. Update `getAvailableModels()` to call `this.tierMapper.getDefaultModels(tier)` instead of accessing private fields via bracket notation
3. Document explicitly that this endpoint returns *default* models per tier, not per-community overrides. Per-community model availability is already resolved per-request in the auth middleware via `resolveAccess(tier, communityId)` and passed in `context.allowedModelAliases`.

**Design Note**: The `getAvailableModels(accessLevel)` method answers "what models CAN a user at this access level use?" (catalog query). Per-community overrides are applied per-request in `invoke()`/`stream()` via `context.allowedModelAliases`. These are separate concerns — the catalog endpoint doesn't need community context.

**Acceptance Criteria**:
- No bracket-notation private field access
- `getAvailableModels()` uses TierAccessMapper's public `getDefaultModels()` method
- Returns correct model aliases per access level (defaults)
- Method documented as returning defaults (per-community overrides handled per-request)

### S9-T2: Fix Reaper Circuit Breaker Denominator

**Severity**: Medium
**Files**: `packages/adapters/agent/budget-reaper-job.ts`

**Problem**: The circuit breaker at line 69-70 computes:
```typescript
const processed = totalReaped + totalReclaimed + errors;
if (processed > 0 && errors / (processed + errors) >= CIRCUIT_BREAKER_THRESHOLD)
```
This mixes reservation counts (`totalReaped` = individual reservation count, `totalReclaimed` = cents reclaimed) with community error counts. A single community that reclaims 1000 cents would have `processed = 1000+` which massively dilutes the error ratio. The denominator should be community attempts, not reservation metrics.

**Fix**:
1. Add a `communitiesAttempted` counter that increments once per community loop iteration
2. Change circuit breaker check to `errors / communitiesAttempted >= CIRCUIT_BREAKER_THRESHOLD`
3. This correctly measures "what fraction of communities failed" rather than "what fraction of reservations had errors"

**Acceptance Criteria**:
- Circuit breaker denominator is community attempt count, not reservation metrics
- 3 errors out of 5 communities (60%) triggers breaker at 50% threshold
- 1 error out of 100 communities (1%) does NOT trigger breaker

### S9-T3: Strengthen Property-Based Budget Tests

**Severity**: Medium
**Files**: `tests/integration/agent-gateway.test.ts`

**Problem**: The property-based budget test only verifies `committed + reserved <= limit` AFTER all operations complete. It doesn't verify the invariant holds DURING interleaving. A bug that temporarily violates the invariant but self-corrects by test end would pass.

**Fix**:
1. Add mid-flight invariant checks to the existing property-based test: after each batch of N operations completes, query `committed + reserved` and assert `<= limit`. Use `Promise.allSettled()` to execute batches of 5-10 operations, then check the invariant between batches.
2. Add a dedicated finalize/reaper race test that forces the exact concurrent scenario:
   - Reserve a budget for community X with known estimated_cost
   - Record the `reserved` counter value
   - Execute `budgetManager.finalize()` and `budgetManager.reap()` concurrently via `Promise.all()`
   - Assert: `reserved` decreased by exactly `estimated_cost` (not 2x)
   - Assert: `committed` increased by exactly `actualCost` (once, not duplicated)
   - This directly validates the S8-T3 claim-via-DEL fix
3. Use `fast-check`'s `fc.scheduler()` to control promise interleaving at the Node layer for the property-based test, ensuring different orderings are explored across runs. Document the `seed: 42` choice for CI reproducibility.

**Acceptance Criteria**:
- Invariant `committed + reserved <= limit` verified between operation batches, not just at end
- Dedicated test: concurrent finalize + reaper on same reservation → `reserved` decremented exactly once
- `fast-check` scheduler used for controlled interleaving in property test
- All tests pass with `seed: 42` for reproducibility
- Tests validate S8-T3 fix (claim-via-DEL prevents double-decrement)

### S9-T4: Update Trust Boundary Documentation

**Severity**: Low
**Files**: SDD trust boundary section or inline doc comments

**Problem**: Trust boundary documentation still references RS256 (should be ES256 per actual implementation) and doesn't document the `req_hash` claim that binds JWTs to request payloads.

**Fix**:
1. Update any RS256 references to ES256 in SDD trust boundary section
2. Document `req_hash` claim: `base64url(SHA-256(canonical_request_body))` — binds JWT to specific request
3. Update JWT claims table to include `req_hash` field
4. Verify all doc-code alignment for JWT service

**Acceptance Criteria**:
- No RS256 references in trust boundary docs
- `req_hash` claim documented with computation method
- JWT claims table complete and accurate

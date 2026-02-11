# Sprint Plan: Bridgebuilder Round 3 — PR #52 Review Findings

**Cycle**: cycle-016
**Source**: [PR #52 Bridgebuilder Review](https://github.com/0xHoneyJar/arrakis/pull/52#issuecomment-3882544662)
**Findings**: 2 Critical/High, 3 Medium, 2 Low (7 total)
**PRD**: `grimoires/loa/prd-hounfour-endgame.md` v1.2.0
**SDD**: `grimoires/loa/sdd-hounfour-endgame.md` v1.2.0
**Branch**: `feature/spice-gate-phase4` (continues PR #52)
**Sprints**: 2 (global IDs: 203-204)

---

## Finding Traceability

| Finding | Severity | Title | Sprint | Tasks |
|---------|----------|-------|--------|-------|
| BB3-1 | Critical | BYOK provider inference — all keys route to OpenAI | 1 | 1.1, 1.5 |
| BB3-2 | High | BYOK quota race condition — GET-then-INCR | 1 | 1.2, 1.5 |
| BB3-3 | Medium | Network Firewall alarm monitors only AZ[0] | 2 | 2.1 |
| BB3-4 | Medium | Google provider in contract schema but not in code | 2 | 2.2 |
| BB3-5 | Medium | BYOK admin routes have no feature gate | 2 | 2.3 |
| BB3-6 | Low | Ensemble budget invariant not verified at runtime | 2 | 2.4 |
| BB3-7 | Low | String API key survives V8 heap — document in threat model | 2 | 2.5 |

---

## Sprint 1: Critical Correctness Fixes

**Goal**: Fix the two correctness bugs that would cause incorrect behavior in production — BYOK provider inference (all traffic routes to OpenAI) and BYOK quota race condition (concurrent requests bypass daily limits).

**Finding coverage**: BB3-1 (Critical), BB3-2 (High)

### Task 1.1: Fix BYOK Provider Inference

**Description**: The BYOK provider inference at `agent-gateway.ts:164,341` uses `poolId.startsWith('anthropic')` to determine the provider. Since pool IDs are `cheap`, `fast-code`, `reviewer`, `reasoning`, and `architect` (from the tier_pool_mapping in the contract schema), this condition is always false. All BYOK requests route to OpenAI regardless of which provider the community uploaded keys for.

**Root Cause**: Provider was inferred from pool ID string matching, but pool IDs encode capability tiers, not provider identity.

**Fix Strategy**: Instead of inferring provider from poolId, query the BYOKManager for which providers have active keys for this community. The BYOKManager already stores keys per `(communityId, provider)` tuple and has `hasBYOKKey(communityId, provider)` — iterate over known providers and use the first match, or use the pool→provider mapping from the contract.

**Files**: `packages/adapters/agent/agent-gateway.ts`

**Changes**:
- Replace `poolId.startsWith('anthropic') ? 'anthropic' : 'openai'` at lines 164 and 341
- Add a `resolveByokProvider()` private method that checks `hasBYOKKey()` for each known provider
- Known providers list sourced from `byok-provider-endpoints.ts` (`getAllowedHostnames()` or static list)
- If community has keys for multiple providers, prefer the one matching the pool's intended provider (add a `POOL_PROVIDER_HINTS` mapping: `{ reasoning: 'anthropic', architect: 'anthropic', cheap: 'openai', 'fast-code': 'openai', reviewer: 'openai' }`)

**Acceptance Criteria**:
- [ ] Community with Anthropic-only BYOK key has requests routed to `api.anthropic.com`
- [ ] Community with OpenAI-only BYOK key has requests routed to `api.openai.com`
- [ ] Community with both providers: pool hint determines provider (reasoning→anthropic, cheap→openai)
- [ ] Community with no BYOK keys: `isByok` remains false (existing behavior preserved)
- [ ] Pool→provider hint mapping is centralized and documented
- [ ] Existing unit tests updated to cover both providers
- [ ] New unit test: Anthropic BYOK key + reasoning pool → anthropic provider inferred
- [ ] New unit test: OpenAI BYOK key + cheap pool → openai provider inferred

**FAANG Parallel**: Cloudflare's 2019 WAF routing bug — regex matched wrong category because IDs weren't designed for string-prefix matching. Fix: use a lookup table, not string inference.

---

### Task 1.2: Fix BYOK Quota Atomicity

**Description**: The BYOK daily quota check at `agent-gateway.ts:590-609` uses a non-atomic GET-then-compare pattern, while the actual increment happens separately at lines 175 and 348. Under concurrent load, multiple requests can read the same count, all pass the quota check, then all increment — exceeding the quota.

**Root Cause**: Quota check (GET) and counter increment (INCR) are separate Redis operations with no atomicity guarantee.

**Fix Strategy**: Replace the two-step GET+compare+separate-INCR with a single atomic INCR-then-compare. Redis `INCR` returns the new count atomically. If the count exceeds quota, the request is rejected (the counter is already incremented, but the overshoot is bounded to 1 and self-corrects on next legitimate request or daily key expiry).

**Files**: `packages/adapters/agent/agent-gateway.ts`

**Changes**:
- Replace `checkByokQuota()` method (lines 590-609) with atomic INCR pattern:
  ```typescript
  private async checkByokQuota(communityId: string, log: Logger): Promise<void> {
    try {
      const key = `agent:byok:count:${communityId}:${this.currentDay()}`;
      const newCount = await this.redis.incr(key);
      // Set TTL on first increment (24h expiry for daily counter)
      if (newCount === 1) {
        await this.redis.expire(key, 86400);
      }
      if (newCount > this.byokDailyQuota) {
        throw new AgentGatewayError('BYOK_QUOTA_EXCEEDED', 'Daily BYOK request quota exceeded', 429);
      }
    } catch (err) {
      if (err instanceof AgentGatewayError) throw err;
      log.error({ err }, 'Redis unavailable for BYOK quota check — fail-closed');
      throw new AgentGatewayError('BYOK_SERVICE_UNAVAILABLE', 'BYOK quota check unavailable', 503);
    }
  }
  ```
- Remove the separate `redis.incr()` calls at lines 175 and 348 (the increment now happens inside `checkByokQuota`)
- Update the `catch(() => {})` removal — errors are now handled inside the method

**Acceptance Criteria**:
- [ ] Quota check uses atomic INCR — single Redis round-trip for check+increment
- [ ] Daily counter has 86400s (24h) TTL, set on first increment only
- [ ] Quota exceeded returns 429 `BYOK_QUOTA_EXCEEDED`
- [ ] Redis unavailable returns 503 (fail-closed, IMP-010 preserved)
- [ ] Separate `redis.incr()` calls removed from `invoke()` and `stream()` methods
- [ ] New unit test: concurrent quota checks don't exceed limit (simulate with sequential calls at boundary)
- [ ] Existing quota test updated to verify atomic pattern

**FAANG Parallel**: Amazon S3 2017 billing outage — read-then-write without atomicity in counter. Industry standard: atomic INCR-then-compare per Redis INCR documentation.

---

### Task 1.3: Update BYOK Test Vectors

**Description**: Update E2E test vectors and unit tests to cover the corrected provider inference and atomic quota patterns.

**Files**:
- `tests/unit/agent-gateway-byok.test.ts`
- `tests/e2e/agent-gateway-e2e.test.ts` (if vectors need updates)

**Changes**:
- Add test: community with Anthropic key + `reasoning` pool → `byok_provider: 'anthropic'` in JWT
- Add test: community with OpenAI key + `cheap` pool → `byok_provider: 'openai'` in JWT
- Add test: community with both providers → pool hint determines winner
- Add test: quota boundary — 10000th request succeeds, 10001st returns 429
- Add test: quota increment is atomic (no separate INCR call in invoke/stream)
- Verify: existing `invoke_byok` E2E vector still passes

**Acceptance Criteria**:
- [ ] All existing agent tests pass (25 lifecycle + 15 metrics + 28 BYOK proxy)
- [ ] New provider inference tests pass for both providers
- [ ] Quota atomicity verified at boundary conditions
- [ ] No regressions in E2E test vectors

---

## Sprint 2: Infrastructure, Contract & Observability Hardening

**Goal**: Address the 3 medium and 2 low findings — infrastructure alarm coverage, contract schema accuracy, feature gating, runtime assertions, and threat model documentation.

**Finding coverage**: BB3-3 (Medium), BB3-4 (Medium), BB3-5 (Medium), BB3-6 (Low), BB3-7 (Low)

### Task 2.1: Fix Network Firewall Alarm to Monitor All AZs

**Description**: The BYOK Network Firewall alarm at `byok-security.tf:302-305` only monitors `availability_zones[0]` for the `DroppedPackets` metric. AWS Network Firewall emits metrics per-AZ (unlike ALB which aggregates). An SSRF attempt egressing from AZ-b or AZ-c would not trigger the alarm.

**Files**: `infrastructure/terraform/byok-security.tf`

**Changes**:
- Replace the single alarm with metric math that SUMs DroppedPackets across all AZs:
  ```hcl
  metric_query {
    id          = "total_drops"
    expression  = "SUM(METRICS('m1'))"
    label       = "Total Dropped Packets Across AZs"
    return_data = true
  }
  ```
- Or use `for_each` over `var.availability_zones` to create one alarm per AZ
- Preferred: metric math SUM approach (single alarm, aggregated view)

**Acceptance Criteria**:
- [ ] Alarm monitors DroppedPackets across ALL configured AZs
- [ ] `terraform plan` shows valid configuration (no syntax errors)
- [ ] Alarm description updated to note multi-AZ coverage
- [ ] Single alarm (not N alarms per AZ) for operational simplicity

---

### Task 2.2: Remove Google from Contract Schema

**Description**: The contract schema at `loa-finn-contract.json:54` declares `"byok_provider": { "enum": ["openai", "anthropic", "google"] }` and `"byok_operation": { "enum": ["chat_completions", "messages", "generate"] }` — but the code only supports OpenAI and Anthropic. Google has no entry in `byok-provider-endpoints.ts`, no entry in the admin routes `ALLOWED_PROVIDERS`, and no Network Firewall rule. The contract promises a capability the implementation can't deliver.

**Files**: `tests/e2e/contracts/schema/loa-finn-contract.json`

**Changes**:
- Remove `"google"` from `byok_provider` enum: `["openai", "anthropic"]`
- Remove `"generate"` from `byok_operation` enum: `["chat_completions", "messages"]`
- Add a `"planned_providers"` field (informational): `["google"]` — signals intent without making a contract promise

**Acceptance Criteria**:
- [ ] `byok_provider` enum matches code reality: `["openai", "anthropic"]`
- [ ] `byok_operation` enum matches code reality: `["chat_completions", "messages"]`
- [ ] E2E contract tests pass with updated schema
- [ ] Comment in schema notes Google planned for future phase

---

### Task 2.3: Add BYOK Feature Gate to Admin Routes

**Description**: The BYOK admin CRUD routes at `admin/byok.routes.ts` are always mounted regardless of the `BYOK_ENABLED` feature flag. An admin could store keys when BYOK is disabled, creating state inconsistency.

**Files**: `themes/sietch/src/api/routes/admin/byok.routes.ts`

**Changes**:
- Accept `byokEnabled` config in the route factory function
- Add middleware at the router level that returns `404 Not Found` (or `503 Service Unavailable` with message "BYOK feature is disabled") when `byokEnabled` is false
- This allows the routes to be mounted but inactive, avoiding route registration complexity

**Acceptance Criteria**:
- [ ] When `BYOK_ENABLED=false`: all BYOK admin routes return appropriate error
- [ ] When `BYOK_ENABLED=true`: routes work as before (existing tests pass)
- [ ] Error response includes clear message about BYOK being disabled
- [ ] New unit test: BYOK disabled → admin route returns error

---

### Task 2.4: Add Ensemble Budget Runtime Assertion

**Description**: The invariant `committed ≤ reserved` for ensemble accounting is tested in E2E vectors but not asserted at runtime in the finalization path. If a model returns unexpected cost data, the invariant could break silently.

**Files**: `packages/adapters/agent/agent-gateway.ts`

**Changes**:
- In the finalization path (after `response.usage.costUsd` is computed), add:
  ```typescript
  if (committedCents > reservedCents) {
    this.metrics.emitBudgetFinalize({
      delta: committedCents - reservedCents,
      mode: 'INVARIANT_VIOLATION'
    });
    log.error({ committed: committedCents, reserved: reservedCents },
      'Budget invariant violation: committed > reserved');
  }
  ```
- This is a detect-and-alert pattern — the request still completes, but operations is notified
- Add the same check in the stream finalization path

**Acceptance Criteria**:
- [ ] Runtime assertion logs error + emits metric when `committed > reserved`
- [ ] Normal requests (committed ≤ reserved) produce no additional log
- [ ] Metric uses existing `emitBudgetFinalize` with distinguishing mode
- [ ] Unit test: simulated invariant violation triggers error log and metric

---

### Task 2.5: Document V8 Heap String Limitation in Threat Model

**Description**: Document the known limitation that string API keys arriving via Express JSON body parsing survive in V8's managed heap until garbage collection. This is a known Node.js/V8 limitation, not a bug. The current code correctly converts to Buffer immediately, but the original string is still in V8 heap memory.

**Files**: `grimoires/loa/deployment/byok-threat-model.md` (new file)

**Changes**:
- Create a brief threat model addendum documenting:
  - The limitation: JSON-parsed strings live in V8 heap until GC
  - Current mitigation: immediate Buffer conversion + Buffer.fill(0) on lifecycle
  - Future hardening option: dedicated key ingestion endpoint bypassing JSON parsing
  - Risk level: Low (requires heap dump access, which already implies host compromise)

**Acceptance Criteria**:
- [ ] Threat model document exists at stated path
- [ ] Limitation clearly described with risk assessment
- [ ] Current mitigations documented
- [ ] Future hardening path identified (for next security sprint)

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Provider inference fix changes BYOK routing behavior | High (intended) | Medium | Comprehensive test coverage for both providers |
| Atomic INCR slightly over-counts on rejection | Low | Low | Counter self-corrects daily; 1-request overshoot is acceptable |
| Terraform metric math syntax incorrect | Medium | Low | `terraform plan` validation before apply |
| Google removal from schema breaks loa-finn | Low | Low | loa-finn doesn't validate this enum currently |

## Dependencies

| Dependency | Type | Status |
|------------|------|--------|
| PR #52 branch (`feature/spice-gate-phase4`) | Prerequisite | Active |
| Redis (local for tests) | Infrastructure | Pre-existing test limitation (ECONNREFUSED) |
| `byok-provider-endpoints.ts` provider list | Code dependency | Exists, read-only |

## Success Criteria

- All 7 Bridgebuilder findings addressed
- All existing tests continue to pass (25 lifecycle + 15 metrics + 28 BYOK proxy)
- New tests for provider inference and quota atomicity
- `terraform plan` validates cleanly
- Contract schema reflects code reality

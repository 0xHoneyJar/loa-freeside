# Sprint Plan: Bridge Findings — Cycle 036 Hardening

**Version:** 2.1.0
**Date:** 2026-02-21
**Cycle:** cycle-036 (bridge iteration 2)
**Source:** Bridgebuilder review of PR #86
**Global Sprint IDs:** 321
**Duration:** 1 sprint (bridge fix sprint)
**Team:** 1 engineer (AI-assisted)

---

## Sprint Overview

| Sprint | Global ID | Focus | Gate |
|--------|-----------|-------|------|
| Sprint 1 | 321 | Bridge Findings Fix — 5 HIGH + 3 MEDIUM | All HIGH findings resolved, `terraform plan` clean, tests pass |

---

## Sprint 1: Bridge Findings Fix (Global ID: 321)

### Task 1.1: Fix SIWE origin validation (HIGH — high-1)

**File:** `themes/sietch/src/api/routes/siwe.routes.ts`
**Origin source of truth:** `themes/sietch/src/config.ts` → `config.cors.allowedOrigins` (same list used by Express CORS middleware in `server.ts`)

**Description:** Enforce strict origin header validation using the canonical CORS allowed origins from config.ts. Remove the fallback `const origin = req.headers.origin || parsed.domain` at line 255 that allows attacker-controlled SIWE message domain to substitute for transport-layer origin.

**Implementation:**
1. Import `getConfig` from `../../config.js`
2. At line 255, replace `const origin = req.headers.origin || parsed.domain` with strict validation:
   - If `!req.headers.origin`, return 400 `{ error: 'Missing Origin header' }`
   - If `!getConfig().cors.allowedOrigins.includes(req.headers.origin)`, return 400 `{ error: 'Invalid origin' }`
   - Otherwise, use `req.headers.origin` as the verified origin

**Acceptance Criteria:**
- [ ] Origin MUST come from `req.headers.origin`, never from `parsed.domain`
- [ ] Requests without `Origin` header → 400
- [ ] Origin validated against `getConfig().cors.allowedOrigins` (single source of truth)
- [ ] Fallback path at line 255 removed
- [ ] Test: missing Origin header → 400
- [ ] Test: disallowed Origin → 400
- [ ] Test: allowed Origin → proceeds normally

---

### Task 1.2: Fix rate bucket cleanup logic (HIGH — high-2)

**File:** `themes/sietch/src/api/middleware/developer-key-auth.ts`
**Structures capped:** `rateBuckets: Map<string, RateBucket>` (line ~100)

**Description:** Fix the AND→OR logic error in bucket cleanup (line 119). Add size-based eviction to the rateBuckets Map to prevent unbounded growth.

**Implementation:**
1. Line 119: Change `if (rpmWindowExpired && tpdWindowExpired)` → `if (rpmWindowExpired || tpdWindowExpired)`
2. Add `MAX_RATE_BUCKETS = 50_000` constant
3. After cleanup loop, if `rateBuckets.size > MAX_RATE_BUCKETS`, evict oldest 10% by `rpmWindowStart` (LRU approximation)
4. Log warning when eviction triggers (indicates sustained high cardinality)

**Acceptance Criteria:**
- [ ] Cleanup uses OR: `rpmWindowStart > 1hr || tpdWindowStart > 24hr`
- [ ] `rateBuckets.size` never exceeds `MAX_RATE_BUCKETS` (50,000)
- [ ] Eviction strategy: remove oldest 10% when cap exceeded
- [ ] Warning logged on eviction (metric for monitoring bucket cardinality)
- [ ] Unit test: after creating 60,000 buckets with stale timestamps, cleanup reduces to ≤50,000

---

### Task 1.3: Fix thread creation race condition (HIGH — high-3)

**Files:**
- `apps/worker/src/handlers/commands/my-agent.ts` (handler logic)
- `apps/worker/src/handlers/commands/my-agent-data.ts` (data layer)
- `apps/worker/src/data/schema.ts` (schema — verify index exists)

**Description:** Prevent duplicate thread creation by adding a database UNIQUE constraint on `(community_id, nft_id, is_active)` and using INSERT...ON CONFLICT in the data layer. The handler wraps insertion in try-catch for UNIQUE violation, returning the existing thread on conflict.

**Implementation:**
1. Verify/add UNIQUE index on `agent_threads(community_id, nft_id)` WHERE `is_active = 1` in `schema.ts` (partial unique index)
2. If index doesn't exist, add Drizzle migration to create it
3. In `my-agent-data.ts` `insertAgentThread()`: wrap INSERT in try-catch, on UNIQUE constraint error → call `findActiveThread()` and return existing
4. In `my-agent.ts`: remove the check-then-act pattern (lines 96-108), replace with direct insert-or-find

**Acceptance Criteria:**
- [ ] Partial UNIQUE index exists: `(community_id, nft_id) WHERE is_active = 1`
- [ ] Migration created if index doesn't already exist (deploy migration before code)
- [ ] `insertAgentThread()` handles UNIQUE violation → returns existing thread
- [ ] Handler uses insert-or-find pattern (no check-then-act)
- [ ] Test: two concurrent inserts with same (community_id, nft_id) → exactly one row

---

### Task 1.4: Normalize wallet addresses consistently (HIGH — high-4)

**Files:**
- `apps/worker/src/handlers/commands/my-agent.ts` (insert path)
- `apps/worker/src/handlers/commands/my-agent-data.ts` (query/insert)
- `apps/worker/src/handlers/events/thread-message-handler.ts` (cache keys)
- `apps/worker/src/handlers/events/ownership-reverification.ts` (verification)

**Policy:** Accept any valid Ethereum address input, normalize to lowercase for all storage and lookup. No EIP-55 checksum validation required (addresses are identifiers, not user-facing display).

**Description:** Create `normalizeWallet(address: string): string` in a shared utility and apply at every storage and lookup boundary. Backfill existing mixed-case records with a one-time SQL update.

**Implementation:**
1. Create `apps/worker/src/utils/normalize-wallet.ts`: `export const normalizeWallet = (addr: string) => addr.toLowerCase();`
2. Apply in `my-agent.ts` line 94 (before thread insert)
3. Apply in `my-agent-data.ts` — all query parameters using `ownerWallet`
4. Apply in `thread-message-handler.ts` — cache key construction (line 77)
5. Apply in `ownership-reverification.ts` — wallet comparison (line 143)
6. Backfill: `UPDATE agent_threads SET owner_wallet = LOWER(owner_wallet) WHERE owner_wallet != LOWER(owner_wallet);`

**Acceptance Criteria:**
- [ ] Shared `normalizeWallet()` utility created and imported in all 4 files
- [ ] All wallet storage paths use lowercase
- [ ] All wallet lookup paths use lowercase
- [ ] Backfill SQL executed (or migration created) for existing records
- [ ] Test: mixed-case wallet input → stored lowercase → retrieved by lowercase lookup

---

### Task 1.5: Handle agent gateway init failure gracefully (HIGH — high-5)

**File:** `apps/worker/src/main-nats.ts`

**Failure mode:** When `createAgentGateway()` fails, the NATS connection and Discord client are still available. Messages arrive via NATS `message.create` events. The Discord REST client can still post to threads.

**Description:** When gateway init fails, register a fallback NATS message handler that uses the Discord REST client directly to post an error message to the thread. This ensures users see a response instead of silence.

**Implementation:**
1. In the catch block (line 134), instead of just logging:
   - Register `message.create` handler on the NATS event map
   - Fallback handler: extract `channel_id` from event, use `DiscordRest.sendMessage(channel_id, "Agent is temporarily unavailable. Please try again later.")`
2. Log the gateway failure as `error` (not `warn`) with full error context
3. Set a health check flag so `/ready` returns 503 when gateway is degraded

**Acceptance Criteria:**
- [ ] Fallback handler registered on `message.create` when gateway fails
- [ ] Fallback uses Discord REST client (still available) to post error to thread
- [ ] User sees "Agent is temporarily unavailable" instead of silence
- [ ] Error logged at `error` level (not `warn`) with full stack trace
- [ ] Health check: `/ready` returns 503 when in degraded mode
- [ ] Manual verification: stop agent gateway dependency, send message, confirm error response

---

### Task 1.6: Add Terraform variable validation (MEDIUM — medium-6)

**File:** `infrastructure/terraform/variables.tf`
**Variables:** `var.feature_crypto_payments_enabled` (line 244), `var.feature_api_keys_enabled` (line 249), `var.feature_web_chat_enabled` (line 255), `var.slack_workspace_id` (line 232), `var.slack_channel_id` (line 238)

**Description:** Add Terraform `validation` blocks to catch invalid values at plan time.

**Implementation:**
1. Each `feature_*` variable: `validation { condition = contains(["true", "false"], var.feature_X) error_message = "Must be 'true' or 'false'" }`
2. `slack_workspace_id`: `validation { condition = var.slack_workspace_id == "" || can(regex("^T[A-Z0-9]+$", var.slack_workspace_id)) error_message = "Must be empty or valid Slack workspace ID (starts with T)" }`
3. `slack_channel_id`: `validation { condition = var.slack_channel_id == "" || can(regex("^C[A-Z0-9]+$", var.slack_channel_id)) error_message = "Must be empty or valid Slack channel ID (starts with C)" }`

**Acceptance Criteria:**
- [ ] All 3 feature flag vars have validation blocks accepting only "true"/"false"
- [ ] Both Slack ID vars accept empty string or valid format
- [ ] `terraform plan` with `feature_crypto_payments_enabled="yes"` → validation error
- [ ] `terraform plan` with valid values → no error

---

### Task 1.7: Fix HTML entity encoding (MEDIUM — medium-5)

**File:** `themes/sietch/src/api/routes/chat-page.routes.ts`
**Line:** 46 — `const safeTokenId = tokenId.replace(/[&<>"']/g, '');`

**Description:** Replace character-stripping regex with proper HTML entity encoding that preserves the original value.

**Implementation:**
Replace line 46 with:
```typescript
const safeTokenId = tokenId
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#x27;');
```
Note: `&` must be replaced first to avoid double-encoding.

**Acceptance Criteria:**
- [ ] Characters encoded (not removed): `<` → `&lt;`, `>` → `&gt;`, `&` → `&amp;`, `"` → `&quot;`, `'` → `&#x27;`
- [ ] `&` replaced first (before other entities)
- [ ] Token `test<name>` → `test&lt;name&gt;` (preserved, not `testname`)

---

### Task 1.8: Add SNS topic encryption (MEDIUM — medium-1)

**File:** `infrastructure/terraform/alerting.tf`
**Resource:** `aws_sns_topic.alerts` (line ~245)

**Description:** Add KMS encryption to the CloudWatch alerts SNS topic. Use the AWS-managed SNS key (`alias/aws/sns`) which requires no additional IAM policy changes for CloudWatch alarm publishing.

**Implementation:**
1. Add `kms_master_key_id = "alias/aws/sns"` to `aws_sns_topic.alerts`
2. The AWS-managed key automatically grants CloudWatch Alarms permission to publish

**Acceptance Criteria:**
- [ ] `kms_master_key_id = "alias/aws/sns"` set on `aws_sns_topic.alerts`
- [ ] `terraform plan` shows the encryption change with no permission errors
- [ ] `terraform apply` succeeds (in staging)
- [ ] CloudWatch alarm can still publish to the encrypted topic (verify by triggering a test alarm)

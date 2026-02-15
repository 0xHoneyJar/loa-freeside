# SDD: The Stillsuit — Cross-System Integration & Revenue Rules

**Version:** 1.0.0
**Cycle:** 026
**Date:** 2026-02-15
**PRD:** [The Stillsuit PRD v1.0.0](grimoires/loa/prd.md)

---

## 1. System Architecture

### 1.1 Overview

This cycle extends the billing system (Cycle 025) with cross-system integration, production hardening, and operational governance. No new services or deployments — all changes are within the existing Sietch API monolith and its test infrastructure.

**Architectural changes this cycle:**
- New vendored protocol types (`packages/core/protocol/`)
- New SQLite table (`daily_agent_spending`)
- New SQLite triggers (audit log immutability)
- New admin API endpoints (revenue rules lifecycle)
- New Docker Compose E2E test infrastructure
- Extended S2S contract with identity anchor verification

### 1.2 Existing Architecture (Preserved)

**Pattern:** Modular Monolith with Ports & Adapters (Hexagonal)

```
┌─────────────────────────────────────────────────────────────────────┐
│                      SIETCH API (Express)                           │
├─────────────────────────────────────────────────────────────────────┤
│  Routes: billing-routes.ts | billing-admin-routes.ts                │
│       ↓                           ↓                                 │
│  ┌──────────────────────────────────────────────────┐               │
│  │              CORE SERVICES (Ports)                │               │
│  │  ICreditLedgerService | IRevenueRulesService      │               │
│  │  IPaymentService      | ICampaignService          │               │
│  └──────────────────┬───────────────────────────────┘               │
│                     ↓                                                │
│  ┌──────────────────────────────────────────────────┐               │
│  │              ADAPTERS (Implementations)           │               │
│  │  CreditLedgerAdapter  | RevenueRulesAdapter       │               │
│  │  AgentWalletPrototype | RevenueDistributionSvc    │               │
│  └──────────────────┬───────────────────────────────┘               │
│                     ↓                                                │
│  ┌─────────┐  ┌─────────┐  ┌──────────────────────┐                │
│  │ SQLite  │  │  Redis   │  │ Vendored Protocol    │                │
│  │ (truth) │  │ (accel)  │  │ (loa-hounfour types) │                │
│  └─────────┘  └─────────┘  └──────────────────────┘                │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.3 New: Cross-System E2E Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Docker Compose Network                            │
│                                                                     │
│  ┌──────────────────────┐      ┌──────────────────────┐            │
│  │   arrakis container   │      │  loa-finn container   │            │
│  │                       │      │                       │            │
│  │  Sietch API (Express) │      │  Hounfour (FastAPI)   │            │
│  │  SQLite (internal)    │◄────►│  (no local DB)        │            │
│  │                       │ S2S  │                       │            │
│  │  ES256 private key    │ JWT  │  ES256 private key    │            │
│  │  loa-finn public key  │      │  arrakis public key   │            │
│  └───────────┬───────────┘      └───────────┬───────────┘            │
│              │                               │                       │
│              └───────────┬───────────────────┘                       │
│                          ▼                                           │
│                   ┌─────────────┐                                    │
│                   │    Redis    │                                    │
│                   │  (shared)   │                                    │
│                   └─────────────┘                                    │
└─────────────────────────────────────────────────────────────────────┘

JWT Trust Flows:
  1. Tenant JWT:  arrakis signs → loa-finn verifies (authorizes inference)
  2. S2S JWT:     loa-finn signs → arrakis verifies (authorizes finalize)

Key Provisioning:
  - scripts/e2e-keygen.sh generates ES256 keypairs at compose build
  - Public keys mounted read-only into verifying container
  - Private keys mounted only into signing container
```

---

## 2. Component Design

### 2.1 Vendored Protocol Types (`packages/core/protocol/`)

**Purpose:** Provide loa-hounfour shared types without depending on unpublished npm package.

**Structure:**
```
packages/core/protocol/
├── index.ts                 # Re-exports all protocol types
├── billing-types.ts         # AgentBillingConfig, CreditBalance, UsageRecord
├── guard-types.ts           # GuardResult, BillingGuardResponse
├── state-machines.ts        # STATE_MACHINES (escrow, stake, credit)
├── arithmetic.ts            # BigInt micro-USD helpers
├── compatibility.ts         # validateCompatibility()
└── VENDORED.md              # Pinned commit hash, upgrade instructions
```

**Integration pattern:**
```typescript
// Local port extends protocol type
import { CreditBalance } from '../../protocol/billing-types.js';

export interface ICreditLedgerService {
  getBalance(accountId: string): Promise<CreditBalance>;
  // ... existing methods
}
```

**Compatibility check (cross-service, not dependency-present):**
```typescript
// At startup, exchange version with loa-finn
const compat = validateCompatibility(
  ARRAKIS_PROTOCOL_VERSION,  // local vendored version
  finnProtocolVersion,        // received from loa-finn /health
);
if (!compat.compatible) {
  logger.error({ compat }, 'Protocol version mismatch with loa-finn');
  process.exit(1);
}
```

### 2.2 Revenue Rules Admin API

**New endpoints on `billing-admin-routes.ts`:**

| Method | Path | Scope | Action |
|--------|------|-------|--------|
| POST | `/admin/billing/revenue-rules` | `admin:rules:write` | Create draft rule |
| POST | `/admin/billing/revenue-rules/:id/submit` | `admin:rules:write` | Submit for approval |
| POST | `/admin/billing/revenue-rules/:id/approve` | `admin:rules:approve` | Approve (start cooldown) |
| POST | `/admin/billing/revenue-rules/:id/activate` | `admin:rules:approve` | Activate (after cooldown) |
| POST | `/admin/billing/revenue-rules/:id/reject` | `admin:rules:approve` | Reject with reason |
| POST | `/admin/billing/revenue-rules/:id/emergency-activate` | `admin:rules:emergency` | Override cooldown |
| GET | `/admin/billing/revenue-rules` | `admin:rules:read` | List rules (filterable) |
| GET | `/admin/billing/revenue-rules/:id/audit` | `admin:rules:read` | Audit trail |
| GET | `/admin/billing/notifications` | `admin:rules:read` | Notification history |

**Four-eyes enforcement:**
```typescript
// In approve handler
const actorId = req.auth.sub; // From authenticated JWT
const rule = await revenueRules.getRule(req.params.id);

if (actorId === rule.created_by) {
  return res.status(403).json({
    error: 'four_eyes_violation',
    message: 'Creator cannot approve their own rule',
  });
}
```

**State machine validation:** All transitions validated against `ALLOWED_TRANSITIONS` map in `RevenueRulesAdapter`. Invalid transitions return 409 Conflict.

### 2.3 Atomic Daily Spending (SQLite-Authoritative)

**New migration: `036_daily_agent_spending.ts`**

```sql
CREATE TABLE IF NOT EXISTS daily_agent_spending (
  agent_account_id TEXT NOT NULL,
  spending_date    TEXT NOT NULL,  -- YYYY-MM-DD
  total_spent_micro INTEGER NOT NULL DEFAULT 0,
  updated_at       TEXT NOT NULL,
  PRIMARY KEY (agent_account_id, spending_date),
  FOREIGN KEY (agent_account_id) REFERENCES credit_accounts(id)
);
```

**Write path (finalize) — atomic UPSERT:**
```
AgentWalletPrototype.finalizeInference()
  → BEGIN IMMEDIATE (same transaction as ledger entries)
  → INSERT INTO daily_agent_spending(agent_account_id, spending_date, total_spent_micro, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(agent_account_id, spending_date)
      DO UPDATE SET
        total_spent_micro = daily_agent_spending.total_spent_micro + excluded.total_spent_micro,
        updated_at = excluded.updated_at
  → COMMIT
  → Redis: Lua script for atomic INCRBY + EXPIREAT:
      EVAL "local v = redis.call('INCRBY', KEYS[1], ARGV[1])
            if v == tonumber(ARGV[1]) then
              redis.call('EXPIREAT', KEYS[1], ARGV[2])
            end
            return v"
      1 billing:agent:daily:{key} {amount} {midnightUnixTimestamp}
```

**Cap enforcement model: Finalized-spend cap (explicit design choice)**

The daily cap applies to *finalized spend*, not reservations. This means concurrent reservations can temporarily oversubscribe the cap, but each finalize checks cumulative finalized spend and rejects/caps if the limit is exceeded. This is acceptable because:
- SQLite single-writer serializes all finalizations
- Reserve amounts are typically small relative to daily cap
- A finalize that would exceed the cap is capped at `MIN(actualCost, remainingBudget)`

If stricter reserve-time enforcement is needed (V2), add a separate `daily_reserved_micro` counter.

**Read path (cap check at finalize):**
```
AgentWalletPrototype.finalizeInference()
  → Within BEGIN IMMEDIATE transaction:
    → SELECT total_spent_micro FROM daily_agent_spending WHERE ...
    → If total_spent + actualCost > dailyCap:
        actualCost = dailyCap - total_spent  (cap to remaining)
        If actualCost <= 0: reject finalize ('daily cap exceeded')
    → UPSERT daily_agent_spending (as above)
```

**Reserve-time soft check (advisory, not authoritative):**
```
AgentWalletPrototype.reserveForInference()
  → Try Redis GET billing:agent:daily:{key}
  → On Redis failure: SELECT total_spent_micro FROM daily_agent_spending
  → If spent + estimatedCost > dailyCap: throw 'daily cap exceeded'
  → (Advisory: may allow slight oversubscription under concurrency)
```

**Numeric precision bounds:**

Daily spending values are bounded by daily caps (max practical: $10,000/day = 10,000,000,000 micro-USD). This fits safely within:
- SQLite INTEGER: signed 64-bit (max 9.2 × 10^18)
- Redis INCRBY: signed 64-bit
- JavaScript: Values up to $9.007 trillion fit in Number.MAX_SAFE_INTEGER (2^53-1)

The Redis adapter uses `string` for all BigInt values to avoid JS Number precision loss:

**Redis interface extension:**
```typescript
interface AgentRedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<string>;
  setex?(key: string, seconds: number, value: string): Promise<string>;
  expire?(key: string, seconds: number): Promise<number>;
  incrby?(key: string, increment: string | number): Promise<string>;  // NEW: returns string
  eval?(script: string, numkeys: number, ...args: string[]): Promise<unknown>;  // NEW: Lua scripts
}
```

### 2.4 Identity Anchor Verification

**Database: Add UNIQUE constraint to agent wallets**

If agent_wallets table doesn't exist yet (currently in-memory in prototype), create migration `037_agent_identity.ts`:

```sql
CREATE TABLE IF NOT EXISTS agent_identity_anchors (
  agent_account_id  TEXT NOT NULL PRIMARY KEY,
  identity_anchor   TEXT NOT NULL UNIQUE,
  created_at        TEXT NOT NULL,
  rotated_at        TEXT,
  rotated_by        TEXT,
  FOREIGN KEY (agent_account_id) REFERENCES credit_accounts(id)
);
```

**S2S finalize verification (in billing-routes.ts):**

The `accountId` is **derived from the reservation**, not accepted from the request body. This prevents confused-deputy where a caller claims a different account:

```typescript
// 1. Validate S2S JWT (loa-finn service identity)
// 2. Look up reservation → derive accountId
const reservation = db.prepare(
  'SELECT account_id FROM credit_reservations WHERE id = ?'
).get(body.reservationId);
if (!reservation) return res.status(404).json({ error: 'reservation_not_found' });

const accountId = reservation.account_id;

// 3. If account has an identity anchor, request MUST include it and it MUST match
const anchor = db.prepare(
  'SELECT identity_anchor FROM agent_identity_anchors WHERE agent_account_id = ?'
).get(accountId);

if (anchor) {
  if (!body.identity_anchor) {
    return res.status(403).json({
      error: 'identity_anchor_required',
      message: 'This account requires identity anchor verification',
    });
  }
  if (anchor.identity_anchor !== body.identity_anchor) {
    return res.status(403).json({
      error: 'identity_anchor_mismatch',
      // Do NOT return the stored anchor (information leak)
    });
  }
}
```

### 2.5 Admin Contract Extraction

**New file: `packages/core/contracts/admin-billing.ts`**

Extract all Zod schemas from `billing-admin-routes.ts`:

```typescript
import { z } from 'zod';

// Revenue Rules
export const createRuleSchema = z.object({
  commons_bps: z.number().int().min(0).max(10000),
  community_bps: z.number().int().min(0).max(10000),
  foundation_bps: z.number().int().min(0).max(10000),
  description: z.string().min(1).max(500),
}).refine(d => d.commons_bps + d.community_bps + d.foundation_bps === 10000, {
  message: 'Basis points must sum to 10000',
});

export const rejectRuleSchema = z.object({
  reason: z.string().min(10).max(1000),
});

export const emergencyActivateSchema = z.object({
  justification: z.string().min(20).max(2000),
});

// Batch grants, mint, etc. — extracted from existing inline schemas
export const batchGrantSchema = z.object({ /* ... */ });
export const adminMintSchema = z.object({ /* ... */ });

// Type exports
export type CreateRuleRequest = z.infer<typeof createRuleSchema>;
export type RejectRuleRequest = z.infer<typeof rejectRuleSchema>;
export type EmergencyActivateRequest = z.infer<typeof emergencyActivateSchema>;
```

### 2.6 Audit Log Immutability (SQLite Triggers)

**Added to migration `035_revenue_rules.ts` (or new migration `038_audit_immutability.ts`):**

```sql
CREATE TRIGGER IF NOT EXISTS audit_log_no_update
  BEFORE UPDATE ON revenue_rule_audit_log
  BEGIN
    SELECT RAISE(ABORT, 'audit log is immutable: updates are prohibited');
  END;

CREATE TRIGGER IF NOT EXISTS audit_log_no_delete
  BEFORE DELETE ON revenue_rule_audit_log
  BEGIN
    SELECT RAISE(ABORT, 'audit log is immutable: deletes are prohibited');
  END;
```

### 2.7 Notification System

**New table in `038_audit_immutability.ts` migration:**

```sql
CREATE TABLE IF NOT EXISTS billing_notifications (
  id          TEXT PRIMARY KEY,
  rule_id     TEXT NOT NULL,
  transition  TEXT NOT NULL,
  old_splits  TEXT,  -- JSON: {commons_bps, community_bps, foundation_bps}
  new_splits  TEXT,  -- JSON: {commons_bps, community_bps, foundation_bps}
  actor_id    TEXT NOT NULL,
  urgency     TEXT NOT NULL DEFAULT 'normal' CHECK(urgency IN ('normal', 'urgent')),
  created_at  TEXT NOT NULL,
  FOREIGN KEY (rule_id) REFERENCES revenue_rules(id)
);
```

Notifications are created as part of the `activate` and `emergency-activate` transitions. Emergency activations create `urgency = 'urgent'` notifications.

---

## 3. Data Architecture

### 3.1 New Tables Summary

| Table | Migration | Purpose |
|-------|-----------|---------|
| `daily_agent_spending` | 036 | SQLite-authoritative daily spending counter |
| `agent_identity_anchors` | 037 | Identity anchor storage with UNIQUE constraint |
| `billing_notifications` | 038 | Revenue rule change notifications |

### 3.2 New SQLite Triggers

| Trigger | Table | Action |
|---------|-------|--------|
| `audit_log_no_update` | `revenue_rule_audit_log` | ABORT on UPDATE |
| `audit_log_no_delete` | `revenue_rule_audit_log` | ABORT on DELETE |

### 3.3 Redis Keys (Unchanged Pattern)

| Key Pattern | Type | TTL | Purpose |
|-------------|------|-----|---------|
| `billing:agent:daily:{accountId}:{date}` | String (integer) | Midnight UTC | Daily spending acceleration |

Redis operations change from `SET` to `INCRBY` for atomic increments.

---

## 4. API Design

### 4.1 Revenue Rules Lifecycle API

**Create Draft:**
```
POST /admin/billing/revenue-rules
Authorization: Bearer <admin JWT with admin:rules:write>
Content-Type: application/json

{
  "commons_bps": 500,
  "community_bps": 7000,
  "foundation_bps": 2500,
  "description": "Increase community share for Q2 growth"
}

Response 201:
{
  "id": "rule-uuid",
  "status": "draft",
  "created_by": "<JWT sub>",
  "created_at": "2026-02-15T12:00:00Z"
}
```

**Submit for Approval:**
```
POST /admin/billing/revenue-rules/:id/submit
Authorization: Bearer <admin JWT with admin:rules:write>

Response 200:
{
  "id": "rule-uuid",
  "status": "pending_approval",
  "submitted_at": "2026-02-15T12:05:00Z"
}
```

**Approve (Start Cooldown):**
```
POST /admin/billing/revenue-rules/:id/approve
Authorization: Bearer <admin JWT with admin:rules:approve>

Response 200:
{
  "id": "rule-uuid",
  "status": "cooling_down",
  "cooldown_expires_at": "2026-02-17T12:10:00Z",
  "approved_by": "<JWT sub>"
}

Response 403 (four-eyes violation):
{
  "error": "four_eyes_violation",
  "message": "Creator cannot approve their own rule"
}
```

**Activate (After Cooldown):**
```
POST /admin/billing/revenue-rules/:id/activate
Authorization: Bearer <admin JWT with admin:rules:approve>

Response 200:
{
  "id": "rule-uuid",
  "status": "active",
  "superseded_rule_id": "old-rule-uuid",
  "activated_at": "2026-02-17T12:15:00Z"
}

Response 409 (cooldown not expired):
{
  "error": "cooldown_active",
  "cooldown_expires_at": "2026-02-17T12:10:00Z"
}
```

**Emergency Activate:**
```
POST /admin/billing/revenue-rules/:id/emergency-activate
Authorization: Bearer <admin JWT with admin:rules:emergency>
Content-Type: application/json

{
  "justification": "Critical revenue split error discovered in production"
}

Response 200:
{
  "id": "rule-uuid",
  "status": "active",
  "emergency": true,
  "activated_at": "2026-02-15T12:20:00Z"
}
```

### 4.2 S2S Finalize Contract (Extended)

**Updated request body (from `s2s-billing.ts`):**

`accountId` is removed from the request schema — it is derived from the reservation server-side (prevents confused-deputy). `identity_anchor` is optional in the schema but required at runtime if the derived account has a stored anchor.

```typescript
export const s2sFinalizeRequestSchema = z.object({
  reservationId: z.string().min(1),
  actualCostMicro: z.string().regex(/^\d+$/),
  identity_anchor: z.string().optional(),  // Required if account has stored anchor
});
```

---

## 5. Security Architecture

### 5.1 JWT Trust Boundaries

| JWT Type | Issuer (`iss`) | Audience (`aud`) | Signing | Key Management |
|----------|----------------|-------------------|---------|----------------|
| Admin JWT | `arrakis-admin` | `arrakis-billing-admin` | HS256 (ADR-004) | `BILLING_ADMIN_JWT_SECRET` — dedicated secret, not shared with any other service |
| Tenant JWT | `arrakis` | `loa-finn` | ES256 | Keypair per environment, public key distributed to loa-finn |
| S2S JWT | `loa-finn` | `arrakis-s2s` | ES256 | Keypair per environment, public key distributed to arrakis |

**Admin JWT validation requirements (mandatory checks):**
- `iss` MUST equal `arrakis-admin` (reject others)
- `aud` MUST equal `arrakis-billing-admin` (reject others)
- `exp` MUST be present and not expired
- `sub` MUST be present (used as `actor_id` in audit logs)
- `scope` MUST contain the required scope for the endpoint
- Secret MUST NOT be shared with S2S or tenant JWT systems
- **Key rotation**: Document rotation procedure in runbook; rotate on personnel change or suspected compromise

### 5.2 Four-Eyes Principle

Revenue rules governance enforces separation of duties:
- Creator: `admin:rules:write` scope, cannot approve own rules
- Approver: `admin:rules:approve` scope, different `sub` than creator
- Emergency: `admin:rules:emergency` scope, creates urgent audit entry

### 5.3 Audit Immutability

- SQLite triggers prevent UPDATE/DELETE on `revenue_rule_audit_log`
- Application code only INSERTs audit entries
- Tests verify trigger behavior (attempt UPDATE → expect error)

### 5.4 Identity Anchor Security

- Anchor stored with UNIQUE constraint (one anchor = one agent)
- Anchor verified on S2S finalize (mismatch → 403)
- Stored anchor never returned in error responses (information leak prevention)
- Rotation requires admin four-eyes approval

---

## 6. Testing Strategy

### 6.1 Unit Tests

| Component | Test Focus | Est. Count |
|-----------|-----------|------------|
| Vendored protocol types | Type compatibility, arithmetic helpers | 8 |
| Revenue rules admin | State machine transitions, four-eyes, cooldown | 15 |
| Atomic daily spending | SQLite transactional update, Redis INCRBY | 8 |
| Admin contract schemas | Zod validation, type exports | 6 |
| Identity anchor | UNIQUE constraint, verification, rotation | 8 |
| Audit immutability | Trigger prevents UPDATE/DELETE | 4 |
| Notifications | Created on transitions, urgency levels | 5 |

### 6.2 Integration Tests

| Test Suite | Focus | Est. Count |
|-----------|-------|------------|
| Revenue rules lifecycle | Full create→submit→approve→activate flow | 6 |
| Concurrent daily spending | 10 parallel finalizations, sum correctness | 3 |
| Identity anchor E2E | Create wallet → deposit → finalize with anchor | 4 |
| Redis fallback | Daily spending enforcement with Redis down | 3 |

### 6.3 E2E Smoke Tests (Docker Compose)

| Test | Flow | Verification |
|------|------|-------------|
| Happy path | Create account → deposit → reserve → inference → finalize | Revenue distribution entries correct |
| Overrun (shadow) | Reserve 1M → finalize 1.5M in shadow mode | Logged as shadow_finalize |
| Overrun (live) | Reserve 1M → finalize 1.5M in live mode | Capped at reserved amount |
| Identity anchor | Agent finalize with correct/incorrect anchor | 200 vs 403 |
| JWT validation | Invalid/expired JWT | 401 response |

**Estimated new tests:** 70

---

## 7. Migration Plan

### 7.1 Database Migrations

| Migration | Tables/Triggers | Dependencies |
|-----------|----------------|-------------|
| 036_daily_agent_spending | `daily_agent_spending` | 030_credit_ledger |
| 037_agent_identity | `agent_identity_anchors` | 030_credit_ledger |
| 038_audit_immutability | Triggers + `billing_notifications` | 035_revenue_rules |

### 7.2 File Changes Summary

| Area | Files Modified | Files Created |
|------|---------------|--------------|
| Protocol types | 0 | 6 (`packages/core/protocol/*`) |
| Migrations | 0 | 3 (036, 037, 038) |
| Adapters | 2 (AgentWallet, RevenueRules) | 0 |
| Routes | 1 (billing-admin-routes) | 0 |
| Contracts | 1 (s2s-billing) | 1 (admin-billing) |
| Tests | 2 (existing extended) | 5 (new test files) |
| E2E infra | 0 | 4 (Dockerfile, compose, keygen, test script) |
| **Total** | **6** | **19** |

---

## 8. Sprint Mapping

| Sprint | SDD Sections | Key Deliverables |
|--------|-------------|-----------------|
| 1 | §2.1 | Vendored protocol types, type alignment, compatibility check |
| 2 | §2.2, §2.6, §4.1 | Revenue rules admin API, four-eyes, audit triggers |
| 3 | §2.3, §3.1 | SQLite daily spending table, Redis INCRBY, fallback chain |
| 4 | §2.5, §2.7 | Admin contract extraction, notification system |
| 5 | §2.4, §4.2 | Identity anchor table, S2S verification, rotation |
| 6 | §1.3, §6.3 | Docker Compose, E2E keygen, smoke tests |

---

## 9. ADR Additions

### ADR-006: SQLite-Authoritative Daily Spending with Redis Acceleration

**Context:** Bridgebuilder low-2 identified get-then-set race condition. Redis alone is insufficient because it's a cache layer — single-instance Redis failure would bypass spending limits.

**Decision:** Persist daily spending in SQLite (`daily_agent_spending` table) transactionally during finalize. Use Redis INCRBY as acceleration for hot-path reads. Fallback chain: Redis → SQLite (not in-memory).

**Consequences:** Slightly more complex write path (SQLite + Redis), but correctness guaranteed under all failure modes.

### ADR-007: Vendored Protocol Types over npm Dependency

**Context:** loa-hounfour PRs #1 and #2 are still OPEN. Can't depend on unpublished npm package.

**Decision:** Vendor a pinned snapshot of protocol types into `packages/core/protocol/`. Replace with npm package when published.

**Consequences:** Temporary code duplication until loa-hounfour publishes. Pinned commit hash ensures deterministic builds. `VENDORED.md` documents upgrade path.

### ADR-008: Identity Anchor in Request Body, Not JWT Claims

**Context:** GPT review identified risk of dual-source (JWT claims + request body) for identity anchor.

**Decision:** Identity anchor travels in the S2S finalize request body only. JWT authenticates the service; body carries agent-specific payload. Single canonical source prevents precedence ambiguity.

**Consequences:** Simpler verification logic. Anchor is implicitly authenticated by the JWT signature over the request.

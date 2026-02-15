# SDD: Creator Economy — Referrals, Leaderboards & Score-Weighted Rewards

**Version:** 1.2.0
**Date:** 2026-02-16
**Status:** Draft
**PRD:** `grimoires/loa/prd.md` v1.2.0
**Cycle:** cycle-029

---

## 1. Executive Summary

This SDD designs the technical architecture for transforming Arrakis into a creator economy. It extends the existing billing infrastructure (credit ledger, revenue distribution, campaign system, NOWPayments adapter, agent gateway) with six new subsystems:

1. **Referral Tracking** — codes, registrations, attribution
2. **Signup Bonus** — delayed-grant campaign with fraud checks
3. **Revenue Share** — 4th party extension to 3-way split
4. **Leaderboard** — cached aggregate queries with timeframes
5. **Score Rewards** — periodic non-withdrawable credit distribution
6. **Creator Payouts** — async NOWPayments payout with treasury reserve

All monetary operations use BigInt micro-USD (existing `CreditLedgerAdapter` precision). No new databases — extends SQLite (authoritative) + Redis (cache/acceleration).

> Grounded in: `ICreditLedgerService.ts`, `RevenueDistributionService.ts`, `CampaignAdapter.ts`, `NOWPaymentsAdapter.ts`, `agent-gateway.ts`, migrations 030-041.

---

## 2. System Architecture

### 2.1 Component Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        API Layer (Express)                       │
│  /api/referrals/*  /api/payouts/*  /api/creator/*  /api/score/*  │
└──────┬──────────────────┬──────────────────┬────────────────────┘
       │                  │                  │
┌──────▼──────┐  ┌────────▼────────┐  ┌──────▼──────┐
│  Referral   │  │  CreatorPayout  │  │   Score     │
│  Service    │  │  Service        │  │   Rewards   │
│             │  │                 │  │   Service   │
└──────┬──────┘  └────────┬────────┘  └──────┬──────┘
       │                  │                  │
┌──────▼──────────────────▼──────────────────▼──────┐
│              Existing Billing Layer                 │
│  CreditLedgerAdapter  │  RevenueDistributionSvc    │
│  CampaignAdapter      │  RevenueRulesAdapter       │
│  NOWPaymentsAdapter   │  BudgetManager             │
└──────┬──────────────────┬──────────────────┬──────┘
       │                  │                  │
┌──────▼──────┐  ┌────────▼────────┐  ┌──────▼──────┐
│   SQLite    │  │     Redis       │  │   BullMQ    │
│ (authority) │  │   (cache)       │  │  (queues)   │
└─────────────┘  └─────────────────┘  └─────────────┘
```

### 2.2 Extension Strategy

**No existing interfaces are modified.** New services compose existing ports:

| Existing Port | How Extended |
|---------------|-------------|
| `ICreditLedgerService` | New source types + pool tags. No interface change. |
| `ICampaignService` | New campaign types `referral`, `score_weighted`. Already defined in type union. |
| `IRevenueRulesService` | Add `referrer_bps` column to `revenue_rules` table. Schema version bump. |
| `ICryptoPaymentProvider` | Add `createPayout()` method to `NOWPaymentsAdapter`. New interface `IPayoutProvider`. |
| `BudgetManager` | Post-finalization hook for referrer share. No interface change. |

---

## 3. Data Architecture

### 3.1 New Tables

#### `referral_codes`

```sql
CREATE TABLE referral_codes (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  account_id TEXT NOT NULL REFERENCES credit_accounts(id),
  code TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'revoked')),
  max_uses INTEGER,                    -- NULL = unlimited
  use_count INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,                     -- ISO 8601, NULL = never
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  revoked_at TEXT,
  revoked_by TEXT
);
CREATE UNIQUE INDEX idx_referral_codes_account_active
  ON referral_codes(account_id) WHERE status = 'active';
```

#### `referral_registrations`

```sql
CREATE TABLE referral_registrations (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  referee_account_id TEXT NOT NULL UNIQUE REFERENCES credit_accounts(id),
  referrer_account_id TEXT NOT NULL REFERENCES credit_accounts(id),
  referral_code_id TEXT NOT NULL REFERENCES referral_codes(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  attribution_expires_at TEXT NOT NULL,  -- created_at + 12 months
  CHECK (referee_account_id != referrer_account_id)
);
CREATE INDEX idx_referral_reg_referrer ON referral_registrations(referrer_account_id);
```

#### `referral_attribution_log`

```sql
CREATE TABLE referral_attribution_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  referee_account_id TEXT NOT NULL,
  referral_code TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('bound', 'rebound_grace', 'admin_rebind', 'dispute_resolved', 'rejected_existing', 'rejected_self', 'rejected_expired', 'rejected_max_uses')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
```

#### `referral_bonuses`

```sql
CREATE TABLE referral_bonuses (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  referee_account_id TEXT NOT NULL REFERENCES credit_accounts(id),
  referrer_account_id TEXT NOT NULL REFERENCES credit_accounts(id),
  registration_id TEXT NOT NULL REFERENCES referral_registrations(id),
  qualifying_action TEXT NOT NULL CHECK (qualifying_action IN ('dnft_creation', 'credit_purchase')),
  qualifying_action_id TEXT NOT NULL,
  amount_micro BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'cleared', 'granted', 'withheld', 'expired')),
  risk_score REAL,
  fraud_check_at TEXT,
  granted_at TEXT,
  grant_id TEXT REFERENCES credit_grants(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(referee_account_id, qualifying_action, qualifying_action_id)  -- Idempotency: one bonus per action per referee
);
```

#### `referrer_earnings`

```sql
CREATE TABLE referrer_earnings (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  referrer_account_id TEXT NOT NULL REFERENCES credit_accounts(id),
  referee_account_id TEXT NOT NULL REFERENCES credit_accounts(id),
  inference_charge_id TEXT NOT NULL,
  rule_version INTEGER NOT NULL,
  amount_micro BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'settled', 'clawed_back')),
  settlement_at TEXT,                  -- When status transitions to 'settled'
  earning_lot_id TEXT REFERENCES credit_lots(id),    -- Explicit linkage: the referrer's earned lot
  reserve_entry_id TEXT,               -- Explicit linkage: the treasury reserve backing entry
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(inference_charge_id, rule_version)  -- Idempotency
);
CREATE INDEX idx_referrer_earnings_referrer ON referrer_earnings(referrer_account_id);
CREATE INDEX idx_referrer_earnings_status ON referrer_earnings(status) WHERE status = 'pending';
```

#### `payout_requests`

```sql
CREATE TABLE payout_requests (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  account_id TEXT NOT NULL REFERENCES credit_accounts(id),
  amount_micro BIGINT NOT NULL,        -- Gross amount requested
  fee_micro BIGINT,                    -- Provider/network fee (set after quote)
  net_amount_micro BIGINT,             -- Net amount received by creator
  currency TEXT NOT NULL,              -- 'usdt', 'usdc', 'eth', etc.
  destination_address TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'stalled', 'cancelled')),
  idempotency_key TEXT NOT NULL UNIQUE,
  provider_reference TEXT,             -- NOWPayments payout ID
  provider_status TEXT,                -- Raw provider status
  withdrawal_ledger_entry_id TEXT,     -- credit_ledger entry for the burn
  reserve_debit_entry_id TEXT,         -- treasury debit entry
  error_message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  processing_at TEXT,
  completed_at TEXT,
  failed_at TEXT
);
CREATE INDEX idx_payout_account ON payout_requests(account_id);
CREATE INDEX idx_payout_status ON payout_requests(status) WHERE status IN ('pending', 'processing', 'stalled');
```

#### `wallet_link_nonces`

```sql
CREATE TABLE wallet_link_nonces (
  nonce TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES credit_accounts(id),
  wallet_address TEXT NOT NULL,
  chain_id INTEGER NOT NULL,
  issued_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT NOT NULL,              -- issued_at + 5 minutes
  used_at TEXT                           -- Set on successful verification, NULL = unused
);
CREATE INDEX idx_nonces_cleanup ON wallet_link_nonces(expires_at) WHERE used_at IS NULL;
```

#### `wallet_links`

```sql
CREATE TABLE wallet_links (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  account_id TEXT NOT NULL REFERENCES credit_accounts(id),
  wallet_address TEXT NOT NULL,
  chain_id INTEGER NOT NULL,
  verified_at TEXT NOT NULL,
  unlinked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(wallet_address, chain_id) -- One account per wallet per chain
);
CREATE INDEX idx_wallet_links_account ON wallet_links(account_id) WHERE unlinked_at IS NULL;
```

#### `referral_events`

```sql
CREATE TABLE referral_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL REFERENCES credit_accounts(id),
  event_type TEXT NOT NULL CHECK (event_type IN ('registration', 'bonus_claim', 'qualifying_action')),
  ip_hash TEXT,                          -- SHA-256 of IP address (privacy-preserving)
  ip_prefix TEXT,                        -- /24 prefix for cluster detection (e.g. '192.168.1')
  user_agent_hash TEXT,                  -- SHA-256 of User-Agent string
  fingerprint_hash TEXT,                 -- SHA-256 of client fingerprint (if available)
  referral_code_id TEXT REFERENCES referral_codes(id),
  metadata TEXT,                         -- JSON: additional context (action_id, etc.)
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_referral_events_account ON referral_events(account_id);
CREATE INDEX idx_referral_events_ip_prefix ON referral_events(ip_prefix, created_at);
CREATE INDEX idx_referral_events_fingerprint ON referral_events(fingerprint_hash, created_at)
  WHERE fingerprint_hash IS NOT NULL;
CREATE INDEX idx_referral_events_type_time ON referral_events(event_type, created_at);
```

**Privacy constraints:** All PII is hashed at write time (SHA-256). Raw IPs and user-agents are never stored. Retention policy: 90-day rolling window enforced by a weekly cleanup cron. The API layer writes these events on every referral registration and bonus claim request.

#### `score_snapshots`

```sql
CREATE TABLE score_snapshots (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  wallet_address TEXT NOT NULL,
  chain_id INTEGER NOT NULL DEFAULT 1,
  score_value BIGINT NOT NULL,         -- Score in integer units
  snapshot_period TEXT NOT NULL,        -- '2026-02' (monthly) or '2026-W07' (weekly)
  imported_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(wallet_address, chain_id, snapshot_period)
);
```

#### `score_distributions`

```sql
CREATE TABLE score_distributions (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  period TEXT NOT NULL,                -- Matches snapshot_period
  pool_size_micro BIGINT NOT NULL,
  total_score BIGINT NOT NULL,
  participant_count INTEGER NOT NULL,
  campaign_id TEXT REFERENCES credit_campaigns(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'distributed', 'failed', 'aborted')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at TEXT,
  UNIQUE(period)                       -- One distribution per period
);
```

### 3.2 Schema Extensions to Existing Tables

#### `revenue_rules` — add `referrer_bps`

```sql
ALTER TABLE revenue_rules ADD COLUMN referrer_bps INTEGER NOT NULL DEFAULT 0;
-- Constraint: referrer_bps + commons_bps + community_bps + foundation_bps = 10000
-- when referrer_bps > 0, the 3-way split applies to (10000 - referrer_bps) proportionally
```

#### `credit_ledger` — new entry types

Add to `entry_type` CHECK constraint:
- `referral_revenue_share` — referrer earnings from inference
- `referral_bonus` — signup bonus grant
- `score_reward` — Score pool distribution
- `withdrawal` — payout credit burn
- `reserve_debit` — treasury payout reserve debit
- `clawback` — refund/reversal of pending earnings
- `settlement` — pending → settled finality record (authoritative ledger entry with `earning_id` + `lot_id` metadata)

#### `credit_lots` — new pool IDs

New pool patterns:
- `referral:revenue_share` — withdrawable earned credits
- `referral:signup` — non-withdrawable bonus credits
- `score:rewards` — non-withdrawable Score rewards

### 3.3 Treasury Account

A special `credit_account` with `entity_type: 'foundation'` and `entity_id: 'treasury:payout_reserve'`. Created during migration. **Not funded by minting** — funded as a direct slice of charge proceeds within the conserved distribution split.

When distributing a finalized charge, the single `totalMicro` is split into up to 5 recipients whose credits sum to exactly `totalMicro`:

| Recipient | Amount | Source |
|-----------|--------|--------|
| Referrer | `bpsShare(totalMicro, referrerBps)` (0 if no attribution) | Charge proceeds |
| Commons | `bpsShare(remainder, commonsBps)` | Charge proceeds |
| Community | `bpsShare(remainder, communityBps)` | Charge proceeds |
| Foundation (net) | `foundationGross - treasuryReserve` | Charge proceeds |
| Treasury reserve | `referrerShareMicro` (1:1 backing) | Charge proceeds (out of foundation's gross) |

**Conservation:** `referrer + commons + community + foundationNet + treasuryReserve === totalMicro`. The treasury reserve comes out of the foundation's gross allocation — not additive supply. All credits use `creditFromCharge()` which draws from the charge's proceeds lot (balanced debit+credit).

**OCC state:** The `treasury_state` table tracks aggregate reserve balance with a `version` column for optimistic concurrency control during payout operations.

**Reserve linkage enforcement:** Every `referrer_earnings` row MUST have `earning_lot_id` set at creation time (NOT NULL after the distribution transaction completes). The `reserve_entry_id` references the `creditFromCharge()` ledger entry that backed the treasury reserve. Both are set within the same `BEGIN IMMEDIATE` transaction in `postDistribution()`. A periodic invariant check cron (hourly) verifies:
- `SUM(treasury_state.balance_micro + treasury_state.held_micro) >= SUM(referrer_earnings.amount_micro WHERE status = 'settled' AND earning_lot_id NOT IN (consumed lots))`
- Any drift >0 triggers a `treasury.invariant.violation` alert (critical severity)

On payout, the referrer's earned lot is moved to escrow (`withdrawal:pending`) and treasury reserve to held state (`reserve:held`), then finalized or released based on provider outcome.

---

## 4. Service Architecture

### 4.1 ReferralService

**Location:** `themes/sietch/src/packages/adapters/billing/ReferralService.ts`
**Port:** `themes/sietch/src/packages/core/ports/IReferralService.ts`

```typescript
interface IReferralService {
  // Code management
  createCode(accountId: string): Promise<ReferralCode>;
  getCode(accountId: string): Promise<ReferralCode | null>;
  revokeCode(codeId: string, revokedBy: string): Promise<void>;

  // Registration
  register(refereeAccountId: string, code: string): Promise<ReferralRegistration>;

  // Attribution lookup
  getReferrer(refereeAccountId: string): Promise<ReferralRegistration | null>;
  isAttributionActive(registration: ReferralRegistration, at: Date): boolean;

  // Bonus triggering
  onQualifyingAction(refereeAccountId: string, action: QualifyingAction): Promise<void>;

  // Stats
  getReferralStats(referrerAccountId: string): Promise<ReferralStats>;
}
```

**Code generation:** `nanoid(10)` with custom alphabet `0123456789abcdefghjkmnpqrstuvwxyz` (no i/l/o to avoid confusion). Collision checked against DB.

**Registration flow:**
1. Validate code exists and is active (not expired, not max uses)
2. Check referee doesn't already have a binding (UNIQUE constraint)
3. Check referee ≠ referrer (self-referral prevention)
4. Insert `referral_registrations` with `attribution_expires_at = created_at + 12 months`
5. Increment `referral_codes.use_count`
6. Log to `referral_attribution_log` with outcome
7. All within single SQLite transaction

**Attribution correction policy:**
- **Grace period**: Within 24 hours of registration, a referee can re-register with a different code (existing binding is replaced). After 24h, binding is locked.
- **Admin rebind**: Admin can reassign attribution via internal tool. Requires audit log entry with `outcome: 'admin_rebind'`, old referrer, new referrer, and reason. Only allowed if no earnings have been generated for the original referrer from this referee.
- **Account merge**: If accounts are merged (future feature), attribution follows the primary account. Logged as `outcome: 'account_merge'`.
- **Disputes**: Referrer can flag an attribution dispute via support. Resolution logged to `referral_attribution_log` with outcome `'dispute_resolved'`.

### 4.2 RevenueDistributionService Extension

**Modification:** `themes/sietch/src/packages/adapters/billing/RevenueDistributionService.ts`

Extend `postDistribution()` to check for referrer attribution. **Entire distribution runs within a single SQLite `BEGIN IMMEDIATE` transaction** for atomicity. The distribution is a **conserved split of a single charge source** — `totalMicro` is debited exactly once from the charge-proceeds source and credited to up to **5 recipients** (referrer + commons + community + foundation net + treasury reserve) whose amounts sum to exactly `totalMicro`:

```typescript
async postDistribution(chargeId: string, totalMicro: bigint, opts: DistributionOpts): Promise<void> {
  const config = await this.getActiveConfig();

  // NEW: Check for referrer attribution
  const referral = await this.referralService.getReferrer(opts.userId);

  await this.db.transaction('IMMEDIATE', async (tx) => {
    // ── Step 1: Compute the 4-way split ──
    let referrerShareMicro = 0n;
    if (referral && this.isAttributionActive(referral, opts.finalizedAt)) {
      referrerShareMicro = bpsShare(totalMicro, config.referrerBps);
    }

    const remainder = totalMicro - referrerShareMicro;
    const commonsShare = bpsShare(remainder, config.commonsBps);
    const communityShare = bpsShare(remainder, config.communityBps);
    const foundationGross = remainder - commonsShare - communityShare; // Absorbs rounding
    // Treasury reserve comes OUT OF foundation's gross — not additive
    const treasuryReserve = referrerShareMicro; // 1:1 backing for referrer earning
    const foundationNet = foundationGross - treasuryReserve;

    // Conservation check: referrer + commons + community + foundationNet + treasuryReserve === totalMicro
    assert(referrerShareMicro + commonsShare + communityShare + foundationNet + treasuryReserve === totalMicro);

    // ── Step 2: Distribute from charge source to all recipients ──
    // All credits come from the single charge source (chargeId). The existing
    // ledger.creditFromCharge() debits the charge source and credits the recipient
    // in a single balanced entry. No supply-increasing mints.

    // 3-way split (existing recipients)
    await this.ledger.creditFromCharge(chargeId, config.commonsAccountId, commonsShare, 'commons_contribution', {
      idempotencyKey: `dist:commons:${chargeId}:${config.version}`,
    });
    await this.ledger.creditFromCharge(chargeId, config.communityAccountId, communityShare, 'revenue_share', {
      idempotencyKey: `dist:community:${chargeId}:${config.version}`,
    });
    await this.ledger.creditFromCharge(chargeId, config.foundationAccountId, foundationNet, 'revenue_share', {
      idempotencyKey: `dist:foundation:${chargeId}:${config.version}`,
    });

    // Treasury reserve backing (from charge source, counted against foundation's gross)
    if (treasuryReserve > 0n) {
      await this.ledger.creditFromCharge(chargeId, this.treasuryAccountId, treasuryReserve, 'reserve_backing', {
        idempotencyKey: `dist:reserve:${chargeId}:${config.version}`,
      });
    }

    // ── Step 3: Referrer earning (if attributed) ──
    if (referrerShareMicro > 0n) {
      // Idempotency: INSERT ... ON CONFLICT DO NOTHING as the FIRST write
      const result = await tx.run(
        `INSERT INTO referrer_earnings (referrer_account_id, referee_account_id, inference_charge_id,
         rule_version, amount_micro, status)
         VALUES (?, ?, ?, ?, ?, 'pending')
         ON CONFLICT(inference_charge_id, rule_version) DO NOTHING`,
        [referral.referrerAccountId, referral.refereeAccountId, chargeId,
         config.version, referrerShareMicro]
      );

      if (result.changes > 0) {
        // Credit referrer from charge source (conserved — part of the split)
        const earningLot = await this.ledger.creditFromCharge(
          chargeId, referral.referrerAccountId, referrerShareMicro, 'referral_revenue_share', {
            poolId: 'referral:revenue_share',
            idempotencyKey: `dist:referrer:${chargeId}:${config.version}`,
          }
        );

        // Link earning to lot and reserve entry for clawback traceability
        await tx.run(
          `UPDATE referrer_earnings SET earning_lot_id = ?
           WHERE inference_charge_id = ? AND rule_version = ?`,
          [earningLot.id, chargeId, config.version]
        );
      }
    }
  });
}
```

**Conservation invariant:** `referrerShare + commonsShare + communityShare + foundationNet + treasuryReserve === totalMicro`. The treasury reserve is funded from the foundation's gross share (not additive supply). All credits use `creditFromCharge()` which debits the charge source and credits the recipient — a balanced transfer, not a supply-creating mint.

**`creditFromCharge()` — formal contract:**

```typescript
/**
 * Transfer credits from a finalized charge's proceeds lot to a recipient.
 * Balanced operation: debits charge source lot, credits recipient lot.
 * NOT a supply-creating mint — total drawn across all calls for a given chargeId
 * must not exceed the original charge amount.
 *
 * @param chargeId - The finalized inference charge ID (source of funds)
 * @param recipientAccountId - The account to credit
 * @param amountMicro - Amount in micro-USD (BigInt, must be > 0)
 * @param entryType - Ledger entry type for audit trail
 * @param opts.poolId - Optional pool tag for the recipient lot (e.g., 'referral:revenue_share')
 * @param opts.idempotencyKey - REQUIRED. Unique key for retry safety. Format: `dist:{recipient}:{chargeId}:{version}`
 *
 * @returns CreditLot - The created/updated lot on the recipient account
 *
 * @throws InsufficientFundsError - If charge proceeds lot has insufficient available_micro
 *         (total drawn > original charge amount — indicates conservation violation)
 * @throws IdempotencyConflictError - If idempotencyKey already exists (safe to ignore — operation already applied)
 * @throws AccountNotFoundError - If recipientAccountId does not exist
 *
 * Invariants enforced:
 * - SUM(all creditFromCharge calls for chargeId) ≤ charge.totalMicro
 * - Each call is idempotent (same key = no-op, returns existing lot)
 * - Operates within the caller's SQLite transaction context
 */
async creditFromCharge(
  chargeId: string,
  recipientAccountId: string,
  amountMicro: bigint,
  entryType: string,
  opts: { poolId?: string; idempotencyKey: string }
): Promise<CreditLot>;
```

### 4.3 CreatorPayoutService

**Location:** `themes/sietch/src/packages/adapters/billing/CreatorPayoutService.ts`
**Port:** `themes/sietch/src/packages/core/ports/ICreatorPayoutService.ts`

```typescript
interface ICreatorPayoutService {
  requestPayout(accountId: string, request: PayoutRequest): Promise<PayoutRequestResult>;
  getPayoutStatus(payoutId: string): Promise<PayoutStatus>;
  getPayoutHistory(accountId: string, opts?: PaginationOpts): Promise<PayoutRequest[]>;
  processPayoutWebhook(payload: unknown, signature: string): Promise<void>;
  getWithdrawableBalance(accountId: string): Promise<bigint>;
}
```

**Payout flow (two-phase escrow model):**

```
User requests payout
  → Validate: earned balance ≥ amount, amount ≥ minimum, rate limit check, KYC threshold
  → Phase 1: HOLD — Within SQLite BEGIN IMMEDIATE transaction:
    1. Read treasury balance with OCC version check:
       SELECT balance_micro, version FROM treasury_state WHERE id = 'payout_reserve'
    2. Verify treasury balance ≥ amount
    3. Move creator earned credits to escrow pool:
       Transfer from pool 'referral:revenue_share' → 'withdrawal:pending'
    4. Move treasury reserve to held state:
       Transfer from 'treasury:payout_reserve' → 'reserve:held'
       with OCC: UPDATE treasury_state SET ... WHERE version = ? (fails if stale)
    5. Insert payout_request (status: 'pending')
  → Enqueue BullMQ job: 'payout-execution'
  → Return payout_request_id (API response < 200ms)

BullMQ payout-execution worker (concurrency: 1):
  → Call NOWPayments payout API with idempotency_key = payout_request_id
  → Phase 2a: ACCEPT — Update status: 'pending' → 'processing'
  → NOWPayments webhook (HMAC verified):
    → 'completed': Phase 2b: FINALIZE
      - Burn escrowed credits (pool: 'withdrawal:pending' → consumed)
      - Burn held reserve (pool: 'reserve:held' → consumed)
      - Update status → 'completed', record net_amount, fee
    → 'failed' (terminal): Phase 2c: RELEASE
      - Transfer credits back: 'withdrawal:pending' → 'referral:revenue_share'
      - Transfer reserve back: 'reserve:held' → 'treasury:payout_reserve'
      - Update status → 'failed'
    → 'failed' (retryable): increment retry_count
      - If retry_count < max_retries: re-enqueue with exponential backoff
      - If retry_count >= max_retries: treat as terminal failure → RELEASE
  → Stall detection: BullMQ cron polls processing payouts > 24h → mark 'stalled'
    → Stalled payouts: reconcile via NOWPayments status API, then FINALIZE or RELEASE
```

**Concurrency safety:** BullMQ payout-execution concurrency set to **1** (serialized). The `treasury_state` table provides OCC as defense-in-depth:

```sql
CREATE TABLE treasury_state (
  id TEXT PRIMARY KEY DEFAULT 'payout_reserve',
  balance_micro BIGINT NOT NULL DEFAULT 0,
  held_micro BIGINT NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 0
);
```

All payout state transitions are idempotent, keyed by `payout_requests.id`.

**Payout state machine — formal transitions:**

```
pending → processing → completed
                    → failed
                    → stalled → completed (via reconciliation)
                              → failed (via reconciliation)
pending → cancelled (user cancellation before processing starts)
failed → (terminal — no retry from failed; RELEASE already executed)
completed → (terminal — FINALIZE already executed)
```

**Transition guards (SQL WHERE clauses):**

| Transition | Actor | SQL Guard |
|-----------|-------|-----------|
| pending → processing | payout worker | `WHERE id = ? AND status = 'pending'` |
| processing → completed | webhook handler | `WHERE id = ? AND status = 'processing'` |
| processing → failed | webhook handler | `WHERE id = ? AND status = 'processing'` |
| processing → stalled | reconciliation cron | `WHERE id = ? AND status = 'processing' AND processing_at < ?` |
| stalled → completed | reconciliation cron | `WHERE id = ? AND status = 'stalled'` |
| stalled → failed | reconciliation cron | `WHERE id = ? AND status = 'stalled'` |
| pending → cancelled | API (user) | `WHERE id = ? AND status = 'pending'` |

Each transition uses `UPDATE ... WHERE status = ? RETURNING id` — if 0 rows affected, the transition was already applied (idempotent skip) or the payout is in an incompatible state (log warning). Ledger operations for each phase use deterministic idempotency keys: `hold:{payoutId}`, `finalize:{payoutId}`, `release:{payoutId}`.

**Payout operational requirements:**

| Parameter | Value | Notes |
|-----------|-------|-------|
| Minimum payout | $10.00 (10,000,000 micro) | Configurable via `revenue_rules` |
| Maximum payout | $10,000.00 per request | Anti-fraud ceiling |
| KYC threshold | $100.00 cumulative | Admin approval required above this |
| Supported currencies | `usdt`, `usdc` | Add chains via config, not code change |
| Supported chains | Ethereum (1), Polygon (137), Arbitrum (42161) | Validated against NOWPayments availability |
| Rate limit | 1 per 24h per account | Enforced at API layer |

**Address validation:** Before accepting a payout request, validate `destination_address` format per chain:
- EVM chains: EIP-55 checksum validation via `ethers.getAddress()`
- Reject known burn addresses (`0x0000...`, `0xdead...`)
- If address was previously used for a failed payout, warn user

**Fee handling and quoting:**
1. **Quote step**: Before HOLD, call `NOWPayments.getEstimate()` to get current fee for the currency/chain pair. Store `quote_id` and `estimated_fee_micro` on `payout_requests`.
2. **Quote TTL**: 5 minutes. If payout execution starts after TTL, re-quote before calling provider. If new fee > original estimate + 10%, pause and notify user.
3. **Fee deduction**: Creator receives `net_amount_micro = amount_micro - fee_micro`. Fee is deducted from the gross payout amount (not from the creator's balance separately).
4. **Fee cap**: If fee exceeds 20% of gross, reject with `400 fee_too_high` error and suggest lower amount or different currency.
5. **Fee reconciliation**: On webhook completion, compare `actual_fee` from provider with `estimated_fee`. Log discrepancy >5% as `payout.fee.drift` metric. Actual fee used for accounting.
6. **Partial/underpaid payouts**: If provider sends less than expected (network fee spike), record the actual `net_amount_micro` from webhook and log the discrepancy. Do not auto-retry — mark as completed with a `fee_discrepancy_micro` field for manual review if material.

**Withdrawable balance calculation (settled lots with available balance):**
```sql
SELECT COALESCE(SUM(cl.available_micro), 0) as withdrawable
FROM credit_lots cl
INNER JOIN referrer_earnings re ON re.earning_lot_id = cl.id
INNER JOIN credit_ledger le ON le.lot_id = cl.id AND le.entry_type = 'settlement'
WHERE cl.account_id = ? AND cl.pool_id = 'referral:revenue_share'
  AND re.status = 'settled'
  AND cl.available_micro > 0
```

Only lots with a corresponding `settlement` ledger entry and `available_micro > 0` are withdrawable. The `settlement` ledger entry is the authoritative finality record. Pending lots exist but cannot be withdrawn. Lots partially consumed by prior payouts have reduced `available_micro`.

### 4.4 SettlementService

**Location:** `themes/sietch/src/packages/adapters/billing/SettlementService.ts`

BullMQ cron job runs every hour. Transitions `referrer_earnings` from `pending` → `settled` after the configurable settlement delay (default: 48 hours). **Each settlement writes a ledger entry** to make the ledger the authoritative audit trail for settlement state:

```typescript
async settleEarnings(): Promise<number> {
  const cutoff = new Date(Date.now() - this.settlementDelayMs).toISOString();
  const now = new Date().toISOString();
  const pending = await this.db.all(
    `SELECT * FROM referrer_earnings WHERE status = 'pending' AND created_at < ?`,
    [cutoff]
  );

  let settled = 0;
  for (const earning of pending) {
    await this.db.transaction('IMMEDIATE', async (tx) => {
      // Write settlement ledger entry referencing the earning lot
      // This makes the ledger the authoritative record of finality
      await this.ledger.postEntry({
        accountId: earning.referrer_account_id,
        entryType: 'settlement',
        amountMicro: earning.amount_micro,
        lotId: earning.earning_lot_id,
        idempotencyKey: `settlement:${earning.id}`,
        metadata: { earning_id: earning.id, reserve_entry_id: earning.reserve_entry_id },
      });

      // Update earning status
      await tx.run(
        `UPDATE referrer_earnings SET status = 'settled', settlement_at = ? WHERE id = ? AND status = 'pending'`,
        [now, earning.id]
      );
    });
    settled++;
  }
  return settled;
}
```

**Clawback on refund (compensating ledger entries):**
```typescript
async clawbackEarning(earningId: string, reason: string): Promise<void> {
  await this.db.transaction('IMMEDIATE', async (tx) => {
    // Only pending earnings can be clawed back (settled = finalized, cannot reverse)
    const earning = await tx.get(
      'SELECT * FROM referrer_earnings WHERE id = ? AND status = ?',
      [earningId, 'pending']
    );
    if (!earning) throw new Error('Earning not found or already settled');

    // 1. Post compensating ledger entry reversing the earning lot
    //    References the original earning_lot_id for full audit trail
    await this.ledger.postCompensatingEntry({
      originalLotId: earning.earning_lot_id,
      accountId: earning.referrer_account_id,
      amountMicro: earning.amount_micro,
      entryType: 'clawback',
      poolId: 'referral:revenue_share',
      idempotencyKey: `clawback:earning:${earningId}`,
      metadata: { reason, earning_id: earningId },
    });

    // 2. Post compensating ledger entry reversing the treasury reserve backing
    //    References the original reserve_entry_id for full audit trail
    await this.ledger.postCompensatingEntry({
      originalEntryId: earning.reserve_entry_id,
      accountId: this.treasuryAccountId,
      amountMicro: earning.amount_micro,
      entryType: 'clawback',
      poolId: 'treasury:payout_reserve',
      idempotencyKey: `clawback:reserve:${earningId}`,
      metadata: { reason, earning_id: earningId },
    });

    // 3. Mark earning as clawed back
    await tx.run(
      'UPDATE referrer_earnings SET status = ? WHERE id = ?',
      ['clawed_back', earningId]
    );
  });
}
```

**`postCompensatingEntry`** reduces `available_micro` on the original lot by the specified amount and creates a new `clawback` ledger entry referencing the original entry. This maintains the append-only audit trail while correctly reversing the financial impact. The `idempotencyKey` ensures clawback is safe to retry.

**Clawback edge cases and ordering rules:**

| Scenario | Behavior |
|----------|----------|
| Clawback arrives **before** settlement (normal) | Earning reversed, lot + reserve compensated, earning status → `clawed_back` |
| Clawback arrives **after** settlement | Rejected — settled earnings are final. Refund must be handled via separate dispute process. |
| Clawback arrives during **active payout** (lot in escrow `withdrawal:pending`) | Rejected — lot is locked in escrow. Payout must complete (FINALIZE or RELEASE) before clawback can be evaluated. If payout fails and releases, a subsequent clawback attempt can succeed if still within pending window. |
| Partial clawback (refund < earning amount) | Not supported in v1 — clawback is all-or-nothing per earning. Partial refunds create a new pending earning for the un-refunded portion if needed. |
| Concurrent clawback + settlement race | The `BEGIN IMMEDIATE` transaction + `WHERE status = 'pending'` guard ensures exactly one wins. If settlement runs first, clawback is rejected. If clawback runs first, settlement skips that earning. |
| Duplicate clawback (retry) | Idempotent via `idempotencyKey: clawback:earning:{earningId}`. Second attempt is a no-op. |

### 4.5 ScoreRewardsService

**Location:** `themes/sietch/src/packages/adapters/billing/ScoreRewardsService.ts`
**Port:** `themes/sietch/src/packages/core/ports/IScoreRewardsService.ts`

```typescript
interface IScoreRewardsService {
  importScores(scores: ScoreEntry[]): Promise<ImportResult>;
  distributeRewards(period: string): Promise<DistributionResult>;
  getAccountScore(accountId: string, period: string): Promise<bigint>;
  linkWallet(accountId: string, proof: WalletLinkProof): Promise<WalletLink>;
  unlinkWallet(accountId: string, walletAddress: string): Promise<void>;
}
```

**Distribution flow (BullMQ cron — weekly/monthly):**

1. Query `foundation:score_rewards` pool balance
2. Calculate pool size = `min(configured_amount, available_balance)`
3. If pool size < minimum threshold → abort (log warning)
4. Aggregate scores per account (via `wallet_links` → `score_snapshots`)
5. Filter: per-wallet min score + per-account min score
6. Calculate proportional shares: `account_reward = (account_score / total_score) × pool_size`
7. Create campaign with `type: 'score_weighted'`, `budget_micro: pool_size`
8. Batch grant via `CampaignAdapter.batchGrant()` with `pool: 'score:rewards'`
9. Record in `score_distributions`

**Nonce issuance (API: `POST /api/score/wallets/nonce`):**
```typescript
async issueNonce(accountId: string, walletAddress: string, chainId: number): Promise<string> {
  const nonce = crypto.randomBytes(16).toString('hex');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 5 * 60 * 1000); // 5 minutes

  await this.db.run(
    `INSERT INTO wallet_link_nonces (nonce, account_id, wallet_address, chain_id, issued_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [nonce, accountId, walletAddress, chainId, now.toISOString(), expiresAt.toISOString()]
  );
  return nonce;
}
```

**Wallet link verification (EIP-191 with SIWE-style deterministic message):**
```typescript
async linkWallet(accountId: string, proof: WalletLinkProof): Promise<WalletLink> {
  // Verify linked wallet count
  const count = await this.db.get(
    'SELECT COUNT(*) as n FROM wallet_links WHERE account_id = ? AND unlinked_at IS NULL',
    [accountId]
  );
  if (count.n >= 10) throw new Error('Maximum 10 linked wallets');

  // Consume nonce — atomic single-use enforcement
  const nonceRow = await this.db.get(
    `UPDATE wallet_link_nonces SET used_at = ? WHERE nonce = ? AND used_at IS NULL AND expires_at > ?
     RETURNING *`,
    [new Date().toISOString(), proof.nonce, new Date().toISOString()]
  );
  if (!nonceRow) throw new Error('Invalid, expired, or already-used nonce');

  // Verify nonce was issued for this account + wallet + chain
  if (nonceRow.account_id !== accountId ||
      nonceRow.wallet_address.toLowerCase() !== proof.walletAddress.toLowerCase() ||
      nonceRow.chain_id !== proof.chainId) {
    throw new Error('Nonce does not match request parameters');
  }

  // Deterministic message format (SIWE-style fixed template, NOT JSON.stringify)
  const message = [
    `Arrakis Wallet Link`,
    ``,
    `Action: link_wallet`,
    `Account: ${accountId}`,
    `Wallet: ${proof.walletAddress}`,
    `Chain ID: ${proof.chainId}`,
    `Nonce: ${proof.nonce}`,
  ].join('\n');

  const recoveredAddress = ethers.verifyMessage(message, proof.signature);
  if (recoveredAddress.toLowerCase() !== proof.walletAddress.toLowerCase())
    throw new Error('Signature verification failed');

  // Insert wallet_links
  return await this.db.run(
    `INSERT INTO wallet_links (account_id, wallet_address, chain_id, verified_at)
     VALUES (?, ?, ?, ?)`,
    [accountId, proof.walletAddress, proof.chainId, new Date().toISOString()]
  );
}
```

### 4.6 LeaderboardService

**Location:** `themes/sietch/src/packages/adapters/billing/LeaderboardService.ts`

```typescript
interface ILeaderboardService {
  getLeaderboard(timeframe: Timeframe, opts: LeaderboardOpts): Promise<LeaderboardEntry[]>;
  getCreatorRank(accountId: string, timeframe: Timeframe): Promise<number>;
}
```

**Implementation:** Redis-cached aggregate queries with 1-minute TTL.

```typescript
async getLeaderboard(timeframe: Timeframe, opts: LeaderboardOpts): Promise<LeaderboardEntry[]> {
  const cacheKey = `leaderboard:${timeframe}:${opts.limit}`;
  const cached = await this.redis.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const since = this.getTimeframeSince(timeframe); // daily/weekly/monthly/all_time
  const rows = await this.db.all(`
    SELECT
      r.referrer_account_id,
      COUNT(DISTINCT r.referee_account_id) as referral_count,
      COALESCE(SUM(e.amount_micro), 0) as total_earnings_micro
    FROM referral_registrations r
    LEFT JOIN referrer_earnings e ON e.referrer_account_id = r.referrer_account_id
      AND e.created_at >= ?
    WHERE r.created_at >= ?
    GROUP BY r.referrer_account_id
    ORDER BY total_earnings_micro DESC
    LIMIT ?
  `, [since, since, opts.limit]);

  await this.redis.setex(cacheKey, 60, JSON.stringify(rows));
  return rows;
}
```

### 4.7 FraudCheckService

**Location:** `themes/sietch/src/packages/adapters/billing/FraudCheckService.ts`

Evaluates referral registrations and bonus claims for abuse signals:

```typescript
interface IFraudCheckService {
  scoreRegistration(registration: ReferralRegistration, context: RequestContext): Promise<FraudScore>;
  scoreBonusClaim(bonus: ReferralBonus): Promise<FraudScore>;
  processDelayedBonuses(): Promise<number>; // BullMQ cron
}
```

**Risk signals (queried from `referral_events` table):**
- Same IP cluster: `SELECT COUNT(*) FROM referral_events WHERE ip_prefix = ? AND created_at > ? AND event_type = 'registration'` (>3 from same /24 in 1 hour)
- Similar user-agent fingerprint: cluster by `user_agent_hash` (>5 same hash in 24h)
- Rapid sequential registration: `SELECT COUNT(*) FROM referral_events WHERE referral_code_id = ? AND created_at > ?` (>5 per code per hour)
- Referee has no paid activity after 7 days (queried from `credit_ledger`)
- Referrer has >50% flagged registrations (queried from `referral_bonuses.status`)

**Event capture:** API middleware writes to `referral_events` on every `/api/referrals/register` and bonus-triggering action. `RequestContext` contains `ip`, `userAgent`, and optional `fingerprint` from the request. All values are SHA-256 hashed before insert.

**Scoring:** Weighted sum (0.0-1.0). Threshold: >0.7 = withheld, 0.4-0.7 = flagged for review, <0.4 = cleared.

---

## 5. API Design

### 5.1 Referral Endpoints

```
POST   /api/referrals/code                Create referral code
GET    /api/referrals/code                Get my referral code
POST   /api/referrals/register            Register as referee
DELETE /api/referrals/code/:id            Revoke code (admin)
GET    /api/referrals/leaderboard         Get leaderboard
```

#### `POST /api/referrals/code`

**Auth:** Bearer token (authenticated user)
**Response:** `201 Created`
```json
{
  "code": "a7bx3mwp2k",
  "status": "active",
  "created_at": "2026-02-16T01:00:00Z"
}
```
**Errors:** `409 Conflict` if active code exists.

#### `POST /api/referrals/register`

**Body:** `{ "code": "a7bx3mwp2k" }`
**Response:** `201 Created`
```json
{
  "registration_id": "...",
  "referrer_display": "0xab...cd",
  "attribution_expires_at": "2027-02-16T01:00:00Z"
}
```
**Errors:** `400` (self-referral), `404` (invalid code), `409` (already bound), `429` (rate limited)

#### `GET /api/referrals/leaderboard`

**Query:** `?timeframe=weekly&limit=50`
**Response:** `200 OK`
```json
{
  "timeframe": "weekly",
  "entries": [
    {
      "rank": 1,
      "display_name": "0xab...cd",
      "referral_count": 12,
      "total_earnings_micro": 5000000
    }
  ]
}
```

### 5.2 Creator Dashboard Endpoints

```
GET    /api/creator/earnings              Earnings summary
GET    /api/creator/referrals             Referral stats
GET    /api/creator/payouts               Payout history
```

#### `GET /api/creator/earnings`

**Query:** `?timeframe=monthly`
**Response:**
```json
{
  "total_earned_micro": 15000000,
  "pending_settlement_micro": 2000000,
  "settled_withdrawable_micro": 10000000,
  "withdrawn_micro": 3000000,
  "referral_count": 25,
  "active_referees": 18
}
```

### 5.3 Payout Endpoints

```
POST   /api/payouts/request              Request payout
GET    /api/payouts/:id                  Get payout status
POST   /api/payouts/webhook              NOWPayments callback (internal)
```

#### `POST /api/payouts/request`

**Body:**
```json
{
  "amount_micro": 10000000,
  "destination_address": "0x...",
  "currency": "usdt"
}
```
**Response:** `202 Accepted`
```json
{
  "payout_id": "...",
  "status": "pending",
  "amount_micro": 10000000,
  "estimated_fee_micro": 500000
}
```
**Errors:** `400` (below minimum, insufficient balance), `429` (rate limited), `403` (KYC required)

### 5.4 Score Endpoints

```
POST   /api/score/import                 Import scores (admin)
POST   /api/score/wallets/nonce          Issue verification nonce
POST   /api/score/wallets/link           Link wallet (requires nonce + signature)
DELETE /api/score/wallets/:address        Unlink wallet
GET    /api/score/wallets                 Get linked wallets
GET    /api/score/rewards                 Get reward history
```

### 5.5 Rate Limiting

| Endpoint | Limit |
|----------|-------|
| `POST /api/referrals/register` | 10/minute per IP |
| `POST /api/payouts/request` | 1/24h per account |
| `POST /api/referrals/code` | 1/hour per account |
| `POST /api/score/wallets/link` | 5/hour per account |

---

## 6. Security Architecture

### 6.1 Anti-Fraud Pipeline

```
Registration → Risk Score → Route
  ├── score < 0.4 → CLEAR (immediate bonus eligibility after hold)
  ├── 0.4 ≤ score < 0.7 → FLAGGED (manual review queue)
  └── score ≥ 0.7 → WITHHELD (bonus blocked, admin notification)
```

### 6.2 Settlement Finality

Earnings go through a **single 48-hour settlement delay** (not a separate cooling-off period). The 48h window allows refund/clawback processing. After settlement, earnings are immediately withdrawable.

```
Inference finalized → Referrer earning created (status: 'pending', earning_lot_id set)
  → 48h settlement delay (configurable: SETTLEMENT_DELAY_MS, default 172800000)
    → No refund/reversal received → status: 'settled', settlement ledger entry written
      → Lots now withdrawable (appears in getWithdrawableBalance)
    → Refund received during pending window → status: 'clawed_back'
      → Compensating ledger entries reverse earning + reserve
  → Settlement is irreversible — settled earnings cannot be clawed back
```

**State timeline for a single earning:**
| Time | Status | Withdrawable? | Clawback allowed? |
|------|--------|---------------|-------------------|
| T+0h | `pending` | No | Yes |
| T+48h | `settled` | Yes | No |
| After payout | `settled` (lot consumed) | No (consumed) | No |

### 6.3 Payout Security

- **Wallet verification**: First payout requires address re-confirmation
- **HMAC webhook verification**:
  - Header: `x-nowpayments-sig` contains HMAC-SHA-512 of the raw request body
  - Secret: `NOWPAYMENTS_IPN_SECRET` environment variable (set in NOWPayments dashboard)
  - Canonicalization: Sort JSON keys alphabetically, then HMAC the canonical string
  - Timestamp window: Accept webhooks within 5-minute clock skew (`x-nowpayments-ts` header if available)
  - Dedupe: `payout_requests.provider_reference` + status combination as idempotency — reject duplicate `(provider_reference, provider_status)` pairs
  - Failure behavior: Return `200 OK` even if processing fails (to prevent NOWPayments retry storms); log error and enqueue for manual reconciliation
  - Replay protection: Store processed webhook IDs in Redis with 24h TTL; reject seen IDs
- **Idempotency**: `payout_request_id` as idempotency key to NOWPayments
- **KYC threshold**: Cumulative payouts > $100 require admin approval
- **Rate limit**: 1 payout per 24 hours per account

### 6.4 Wallet Link Security

- **EIP-191 personal_sign**: SIWE-style deterministic message with action, account_id, wallet_address, chain_id, nonce
- **Nonce lifecycle**: Issued via `wallet_link_nonces` table → consumed atomically on verification → expired after 5 minutes
- **Single-use**: `UPDATE ... WHERE used_at IS NULL` prevents nonce reuse
- **Max links**: 10 per account (enforced before nonce consumption)
- **Unlink**: Immediate, does not affect already-distributed rewards

---

## 7. Queue Architecture

### 7.1 BullMQ Queues

| Queue | Purpose | Concurrency | Retry |
|-------|---------|-------------|-------|
| `payout-execution` | Process NOWPayments payouts | 1 | 3× exponential backoff |
| `settlement-check` | Settle pending earnings | 1 | 1× (cron hourly) |
| `score-distribution` | Distribute Score rewards | 1 | 1× (cron weekly/monthly) |
| `fraud-check` | Evaluate delayed bonuses | 3 | 2× |
| `payout-reconciliation` | Poll NOWPayments for stalled payouts | 1 | 1× (cron hourly) |
| `bonus-granting` | Grant cleared bonuses | 3 | 2× |

### 7.2 Cron Jobs

| Job | Schedule | Description |
|-----|----------|-------------|
| `settle-earnings` | Every hour | Transition pending → settled after 48h |
| `process-delayed-bonuses` | Every hour | Evaluate and grant cleared bonuses |
| `score-distribution` | Monthly (1st) | Distribute Score rewards pool |
| `reconcile-payouts` | Every hour | Poll processing payouts, mark stalled if >24h |
| `leaderboard-refresh` | Every minute | Invalidate leaderboard cache |
| `cleanup-expired-nonces` | Every hour | Delete expired/used `wallet_link_nonces` older than 1 hour |
| `cleanup-referral-events` | Weekly | Delete `referral_events` older than 90 days (privacy retention) |

---

## 8. Migration Plan

### 8.1 New Migrations

| Migration | Tables/Changes |
|-----------|---------------|
| `042_referral_system` | `referral_codes`, `referral_registrations`, `referral_attribution_log`, `referral_bonuses`, `referral_events` |
| `043_referrer_earnings` | `referrer_earnings` (with `earning_lot_id`, `reserve_entry_id` linkage), extend `credit_ledger` entry types |
| `044_payout_system` | `payout_requests`, `treasury_state` (OCC table), treasury account creation |
| `045_wallet_links` | `wallet_link_nonces`, `wallet_links`, `score_snapshots`, `score_distributions` |
| `046_revenue_rules_referrer` | Add `referrer_bps` to `revenue_rules`, schema version bump |

### 8.2 Seed Data

- Treasury account: `entity_type: 'foundation'`, `entity_id: 'treasury:payout_reserve'`
- Default revenue rule with `referrer_bps: 1000` (10%)
- Referral signup bonus campaign: `type: 'referral'`, `budget_micro: 50000000000` ($50,000)
- Foundation Score rewards pool account

---

## 9. Observability

### 9.1 Metrics

| Metric | Type | Alert |
|--------|------|-------|
| `referral.registrations` | Counter | >100/hour = spike alert |
| `referral.bonuses.granted` | Counter | Budget >80% = warning |
| `referral.bonuses.withheld` | Counter | >20% withheld = review |
| `referrer.earnings.total_micro` | Gauge | Monitoring only |
| `payout.requests.created` | Counter | Monitoring only |
| `payout.requests.failed` | Counter | Any in 5min = alert |
| `payout.requests.stalled` | Gauge | Any >0 = alert |
| `treasury.reserve.balance_micro` | Gauge | <10% of withdrawable = critical |
| `settlement.earnings.settled` | Counter | Monitoring only |
| `score.distributions.completed` | Counter | Monitoring only |
| `fraud.registrations.flagged` | Counter | >50% = alert |

### 9.2 Audit Trail

All financial operations append to `credit_ledger` (immutable, append-only). Additional audit:
- `referral_attribution_log` — all attribution attempts
- `revenue_rule_audit_log` — governance changes (existing)
- `payout_requests` — full payout lifecycle with provider references

---

## 10. Performance Targets

| Operation | Target | Strategy |
|-----------|--------|----------|
| Referral registration | <200ms p99 | Single SQLite transaction |
| Revenue share computation | <50ms overhead | In-memory BPS arithmetic, single DB insert |
| Leaderboard query | <500ms p99 | Redis cache (1-min TTL) |
| Payout request (API) | <200ms p99 | Async (enqueue only) |
| Score distribution | <60s for 10K participants | Batch campaign grants |
| Withdrawable balance | <100ms p99 | Indexed query on settled lots |

---

## 11. Technical Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| SQLite contention under concurrent financial writes | Medium | High | WAL mode (already enabled) + `busy_timeout: 5000ms` + application-level retry (3× with jitter). Isolate high-frequency event writes (`referral_events`) from ledger writes using separate write batching (insert events via buffered queue, not inline with financial transactions). BullMQ payout execution serialized (concurrency: 1). Settlement cron processes in small batches (50/iteration) to limit lock duration. Load-test target: 100 concurrent finalizations/min + 10 payout requests/min without p99 >500ms. If exceeded, escalation path: migrate authoritative ledger to Postgres (schema is portable, no SQLite-specific features used beyond `BEGIN IMMEDIATE`). |
| NOWPayments API downtime | Low | High | Retry queue, stall detection, manual fallback runbook |
| Score import data quality | Medium | Medium | Validation on import, minimum score thresholds filter noise |
| Settlement delay creates UX friction | Low | Low | Dashboard clearly shows pending vs settled vs withdrawable |
| Referral fraud at scale | High | Medium | Multi-signal fraud scoring, delayed granting, per-referrer caps |

---

## 12. Dependencies

| Dependency | Version | Purpose |
|-----------|---------|---------|
| `ethers` | ^6.x | EIP-191 signature verification for wallet linking |
| `nanoid` | ^5.x | Referral code generation |
| `bullmq` | existing | Queue management (already in codebase) |
| `NOWPayments API` | v1 | Payout execution (extend existing adapter) |

No new infrastructure dependencies. All runs on existing SQLite + Redis + BullMQ stack.

---

## 13. Phase Mapping

### Phase 1A: Non-Withdrawable Earnings (Sprints 1-7)

| Sprint | Components |
|--------|-----------|
| 1-2 | Migration 042-043, ReferralService, registration API |
| 3 | Revenue share extension (RevenueDistributionService), migration 046 |
| 4 | Signup bonus with delayed granting, FraudCheckService |
| 5 | LeaderboardService, leaderboard API |
| 6 | Creator dashboard API, SettlementService |
| 7 | Integration testing, fraud pipeline validation |

### Phase 1B: Payouts + Score (Sprints 8-13)

| Sprint | Components |
|--------|-----------|
| 8-9 | Migration 044, CreatorPayoutService, NOWPayments payout API, treasury |
| 10 | Payout reconciliation, stall detection, webhook processing |
| 11 | Migration 045, ScoreRewardsService, wallet linking, Score import |
| 12 | Score distribution, campaign integration |
| 13 | E2E testing, closed beta readiness, launch checklists |

---

*Generated with Loa Framework `/architect`*
*Grounded in: existing billing infrastructure (migrations 030-041), `ICreditLedgerService`, `RevenueDistributionService`, `CampaignAdapter`, `NOWPaymentsAdapter`, `agent-gateway.ts`*

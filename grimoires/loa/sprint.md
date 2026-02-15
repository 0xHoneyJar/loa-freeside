# Sprint Plan: Creator Economy — Referrals, Leaderboards & Score-Weighted Rewards

**Version:** 1.2.0
**Date:** 2026-02-16
**Cycle:** cycle-029
**PRD:** `grimoires/loa/prd.md` v1.2.0
**SDD:** `grimoires/loa/sdd.md` v1.2.0

---

## Overview

| Parameter | Value |
|-----------|-------|
| Total sprints | 13 |
| Phase 1A (Non-Withdrawable Earnings) | Sprints 1-7 |
| Phase 1B (Payouts + Score) | Sprints 8-13 |
| Sprint size | 1 agent session each |
| Global sprint IDs | 257-269 |

---

## Phase 1A: Non-Withdrawable Earnings

### Sprint 1 — Referral Schema & Core Service (Global: 257)

**Goal:** Database foundation + ReferralService core

**Tasks:**

1.1 **Create migration 042_referral_system**
- `referral_codes` table with all constraints and indexes
- `referral_registrations` table with UNIQUE referee, FK to credit_accounts, self-referral CHECK
- `referral_attribution_log` table with outcome enum including `rebound_grace`, `admin_rebind`, `dispute_resolved`
- `referral_bonuses` table with FK to credit_accounts, UNIQUE(referee_account_id, qualifying_action, qualifying_action_id)
- `referral_events` table with hashed IP/UA/fingerprint columns, all indexes
- **AC:** Migration runs cleanly, rollback works, all FKs enforced

1.2 **Create IReferralService port**
- Interface at `themes/sietch/src/packages/core/ports/IReferralService.ts`
- Types: `ReferralCode`, `ReferralRegistration`, `QualifyingAction`, `ReferralStats`
- Method signatures per SDD §4.1 including `isAttributionActive(registration: ReferralRegistration, at: Date): boolean`
- **AC:** Port compiles, types exported

1.3 **Implement ReferralService adapter**
- Code generation: `nanoid(10)` with custom alphabet (no i/l/o)
- `createCode()` with collision check, one active per account
- `getCode()`, `revokeCode()` with status transitions
- **AC:** Unit tests for code generation, uniqueness, revocation

1.4 **Implement registration flow**
- 7-step transaction per SDD §4.1 within `BEGIN IMMEDIATE` for atomicity
- Validation: code active, not expired, not max uses, not self-referral, not already bound
- Attribution log with outcome
- 24h grace period rebind logic with strict rules:
  - First-touch attribution is immutable after any qualifying action occurs
  - Rebind only allowed if no qualifying actions exist for the current attribution
  - `SELECT ... WHERE referee_account_id = ? AND qualifying_action IS NOT NULL` guard before rebind
  - Concurrent rebind + qualifying action race resolved by `BEGIN IMMEDIATE` serialization
  - Explicit `effective_at` timestamp on attribution_log for boundary precision (UTC, no DST ambiguity)
- **AC:** Unit tests for all rejection cases + happy path + grace period rebind + rebind-after-qualifying-action rejected + concurrent rebind/action serialization test

---

### Sprint 2 — Referral API & Revenue Rules Extension (Global: 258)

**Goal:** Referral HTTP endpoints + revenue_rules schema extension

**Tasks:**

2.1 **Create referral API routes**
- `POST /api/referrals/code` — create code (auth required)
- `GET /api/referrals/code` — get my code
- `POST /api/referrals/register` — register as referee
- `DELETE /api/referrals/code/:id` — revoke code (admin)
- Rate limiting: 10/min per IP for register, 1/hr per account for code creation
- **AC:** All endpoints return correct status codes, validation errors documented

2.2 **Create migration 043_revenue_rules_referrer**
- Add `referrer_bps INTEGER NOT NULL DEFAULT 0` to `revenue_rules`
- Schema version bump
- Seed: default rule with `referrer_bps: 1000` (10%)
- **AC:** Migration runs, existing rules get default 0, new rule has 1000

2.3 **Implement referral stats endpoint**
- `getReferralStats()` — count referees, total earnings, active attribution
- Wire to `GET /api/creator/referrals`
- **AC:** Returns correct counts, handles empty state

2.4 **Integration test: referral registration E2E**
- Create code → register → verify attribution → verify log
- Test self-referral rejection, expired code, max uses
- **AC:** E2E test passes with full lifecycle

---

### Sprint 3 — Revenue Share Extension (Global: 259)

**Goal:** Extend RevenueDistributionService with 4th party referrer split

**Tasks:**

3.1 **Create migration 044_referrer_earnings**
- `referrer_earnings` table with `earning_lot_id`, `reserve_entry_id` linkage columns
- Extend `credit_ledger` entry_type CHECK with new types
- New pool IDs: `referral:revenue_share`, `referral:signup`, `score:rewards`
- **AC:** Migration runs, new entry types accepted by ledger

3.2 **Implement `creditFromCharge()` ledger method**
- Thin wrapper around `transferInternal` using charge proceeds lot as source
- Formal contract per SDD §4.2: idempotency via key, InsufficientFundsError on overdraw
- Enforces: total drawn ≤ original charge amount
- **AC:** Unit tests for balanced transfer, idempotency, overdraw rejection

3.3 **Extend postDistribution() with referrer split**
- 5-way conserved split within single `BEGIN IMMEDIATE` transaction
- **Rounding policy:** All BPS splits use `floor()` with largest-remainder method for residual micro-units. Remainder assigned to foundation (stable ordering: referrer → commons → community → treasury → foundation gets remainder). Deterministic: same input always produces same allocation.
- Conservation assert: `referrer + commons + community + foundationNet + treasuryReserve === totalMicro`
- Treasury reserve from foundation gross (not additive)
- `INSERT ... ON CONFLICT DO NOTHING` idempotency guard (unique key stored in DB, not only Redis)
- Link earning_lot_id on referrer_earnings
- **AC:** Unit tests: with/without attribution, idempotency on retry, conservation invariant, expired attribution skipped, property-based test with random charge amounts proving conservation holds across 1000 inputs, remainder never exceeds 4 micro-units

3.4 **Register pool IDs and enforce non-withdrawable semantics**
- Register pool IDs in pool configuration: `referral:revenue_share`, `referral:signup`, `score:rewards`
- Configure `referral:signup` and `score:rewards` as non-withdrawable pools
- Verify CampaignAdapter recognizes new pool IDs and grants into them correctly
- Add query filter: `getWithdrawableBalance()` excludes non-withdrawable pools
- **AC:** CampaignAdapter grants into `referral:signup` succeed, grants are excluded from withdrawable balance queries, automated test proves non-withdrawable enforcement

3.5 **SQLite contention baseline test**
- Configure WAL mode + `busy_timeout: 5000ms` explicitly in test setup
- Run 10 concurrent `postDistribution()` calls with different charge IDs
- Measure p50/p95/p99 write latency, count SQLITE_BUSY errors
- Establish baseline metrics for Sprint 13 stress test comparison
- All distribution writes use short transactions (< 50ms target)
- **AC:** All 10 distributions complete without SQLITE_BUSY, p99 < 200ms, WAL mode confirmed active

3.6 **Integration test: revenue distribution with referrer**
- Finalize charge → verify 5-way split → verify ledger entries → verify referrer_earnings row
- Verify conservation: sum of all credits === totalMicro
- **AC:** E2E test with attribution active and expired

---

### Sprint 4 — Signup Bonus & Fraud Check Service (Global: 260)

**Goal:** Delayed bonus granting with fraud scoring

**Tasks:**

4.1 **Implement FraudCheckService**
- `scoreRegistration()` — query `referral_events` for IP cluster, UA fingerprint, velocity
- `scoreBonusClaim()` — evaluate 7-day activity check
- Risk signal queries per SDD §4.7
- Weighted scoring (0.0-1.0) with configurable thresholds
- **AC:** Unit tests for each risk signal, threshold routing (clear/flagged/withheld)

4.2 **Implement referral event capture middleware**
- API middleware writes to `referral_events` on registration and qualifying action
- HMAC-SHA-256 (keyed hash) of IP, User-Agent, fingerprint before insert — key from `FRAUD_HASH_SECRET` env var, prevents rainbow/dictionary reversal of IP ranges
- Data classification: hashed event data is pseudonymized PII, subject to 90-day retention (Sprint 7.5 cleanup)
- **AC:** Events written on register, HMAC values verified, raw IP/UA never stored

4.3 **Implement bonus triggering flow**
- `onQualifyingAction()` — validate minimum economic value (dNFT ≥ $1, credit ≥ $5)
- Create `referral_bonuses` row with status `pending`
- Per-referrer bonus cap (configurable, default: 50 per referrer)
- Delayed granting: 7-day hold before evaluation
- **AC:** Bonus created on qualifying action, rejected below minimum, capped per referrer

4.4 **Implement delayed bonus processing cron**
- BullMQ cron job: `process-delayed-bonuses` (hourly)
- Evaluate pending bonuses older than 7 days via FraudCheckService
- Grant cleared bonuses via CampaignAdapter (pool: `referral:signup`, non-withdrawable)
- Flagged bonuses set to `status: 'flagged'` with `flag_reason` column
- **AC:** Cleared bonuses granted, withheld bonuses blocked, flagged bonuses persisted with reason

4.5 **Implement flagged bonus review queue with admin authz**
- Add `flag_reason TEXT` and `reviewed_by TEXT` columns to `referral_bonuses`
- Admin endpoints behind `requireRole('admin')` middleware with immutable audit logging:
  - `GET /api/admin/bonuses/flagged` — list flagged bonuses with reason and referrer info
  - `POST /api/admin/bonuses/:id/approve` — grant the bonus via CampaignAdapter, set `status: 'granted'`
  - `POST /api/admin/bonuses/:id/deny` — set `status: 'denied'`, no grant, no ledger entry
- All admin actions logged to `admin_audit_log` (actor, action, target_id, timestamp, ip) — append-only, no deletes
- Admin auth uses existing Discord role-based auth (admin role check on JWT claims)
- **AC:** Flagged bonuses visible in admin queue, approve grants correctly, deny cancels cleanly, unauthorized users get 403, audit log written for every action, integration test covers one approve + one deny flow

---

### Sprint 5 — Leaderboard Service (Global: 261)

**Goal:** Cached leaderboard with timeframes

**Tasks:**

5.1 **Implement LeaderboardService**
- `getLeaderboard(timeframe, opts)` — aggregate query with Redis cache (1-min TTL)
- `getCreatorRank(accountId, timeframe)` — individual rank lookup
- Timeframes: daily, weekly, monthly, all_time
- **AC:** Returns correct rankings, cache hit on second call within TTL

5.2 **Create leaderboard API endpoint**
- `GET /api/referrals/leaderboard?timeframe=weekly&limit=50`
- Response includes rank, display_name (anonymized address), referral_count, total_earnings_micro
- **AC:** Returns paginated results, respects limit, validates timeframe enum

5.3 **Implement leaderboard cache refresh cron**
- BullMQ cron: `leaderboard-refresh` (every minute)
- Invalidates all timeframe caches
- **AC:** Cache invalidated on schedule, stale data served max 1 minute

5.4 **Integration test: leaderboard E2E**
- Create referrals → generate earnings → query leaderboard → verify ordering
- Test empty state, single participant, tie-breaking
- **AC:** E2E test passes with correct ranking

---

### Sprint 6 — Creator Dashboard & Settlement Service (Global: 262)

**Goal:** Earnings dashboard API + settlement finality engine

**Tasks:**

6.1 **Implement SettlementService**
- `settleEarnings()` cron: batch process pending earnings older than 48h
- Write `settlement` ledger entry per earning (authoritative finality record)
- Batch size: 50 per iteration to limit lock duration
- Idempotency: `settlement:{earning.id}` key
- **AC:** Pending → settled after 48h, ledger entry written, idempotent on retry

6.2 **Implement clawback flow**
- `clawbackEarning()` — only pending earnings, `BEGIN IMMEDIATE` transaction
- Compensating ledger entries referencing `earning_lot_id` and `reserve_entry_id`
- Edge case handling per SDD: reject if settled, reject if in escrow, all-or-nothing
- Concurrent clawback+settlement race resolved by `WHERE status = 'pending'`
- **AC:** Clawback reverses lot + reserve, rejected after settlement, idempotent

6.3 **Create creator dashboard API**
- `GET /api/creator/earnings` — total earned, pending settlement, settled (non-withdrawable), withdrawn
- `GET /api/creator/referrals` — referral stats, active referees
- `GET /api/creator/payouts` — payout history (empty for now, ready for Phase 1B)
- **Note:** In Phase 1A, settled earnings are tracked as `settled_available_micro` (non-withdrawable). The `withdrawable` concept is introduced in Phase 1B (Sprint 9) when payout infrastructure is ready. Dashboard shows "Settled" not "Withdrawable" in Phase 1A.
- **AC:** Returns correct aggregates, settled amount shown as non-withdrawable, handles zero-state

6.4 **Settled balance query (non-withdrawable in Phase 1A)**
- Join `credit_lots` + `referrer_earnings` + `credit_ledger` (settlement entry)
- Only settled lots with `available_micro > 0`
- Returns `settled_available_micro` — becomes `withdrawable` only when Phase 1B payout service enables it
- **AC:** Returns correct settled amount, excludes pending/clawed-back, labeled as non-withdrawable

---

### Sprint 7 — Phase 1A Integration Testing & Fraud Pipeline Validation (Global: 263)

**Goal:** End-to-end validation of non-withdrawable earnings pipeline

**Tasks:**

7.1 **Full lifecycle integration test**
- Referral code creation → registration → qualifying action → bonus claim → fraud check → bonus grant
- Revenue share: inference finalization → referrer earning → 48h settlement → settled (non-withdrawable in Phase 1A)
- Clawback: refund before settlement → earning reversed → lot reversed
- **AC:** Complete lifecycle passes in single test suite

7.2 **Fraud pipeline validation**
- Simulate: same IP cluster (>3/24), rapid registration (>5/hr), flagged referrer
- Verify scoring produces correct thresholds
- Verify withheld bonuses are blocked, cleared bonuses granted after 7d
- **AC:** All fraud scenarios produce expected outcomes

7.3 **Conservation invariant validation**
- Run N distributions with mixed attribution (some with referrer, some without)
- Verify: for every charge, sum of all ledger credits === totalMicro
- Verify: no referrer_earnings row has NULL earning_lot_id
- **AC:** Invariant holds across all test distributions

7.4 **Treasury invariant check implementation**
- Hourly cron: verify `sum(reserve) >= sum(unpaid settled earnings)`
- `treasury.invariant.violation` metric + critical alert
- **AC:** Check passes on healthy state, alerts on simulated drift

7.5 **Phase 1A observability baseline**
- Emit structured metrics for each subsystem built in Sprints 1-6:
  - `referral.registrations.total`, `referral.registrations.rejected` (counter)
  - `referral.bonuses.granted`, `referral.bonuses.flagged`, `referral.bonuses.withheld` (counter)
  - `revenue.distribution.total_micro`, `revenue.distribution.count` (counter)
  - `settlement.settled.count`, `settlement.clawback.count` (counter)
  - `fraud.score.histogram` (histogram, 0.0-1.0)
  - `sqlite.write_latency_ms` (histogram)
- Critical alerts: treasury invariant violation, conservation assert failure, SQLite busy_timeout exceeded
- **AC:** All metrics emit in test, alert fires on simulated invariant violation

7.6 **Implement referral_events retention cleanup cron**
- BullMQ cron: `cleanup-referral-events` (daily at 03:00 UTC)
- Delete `referral_events` rows older than 90 days
- Use index on `created_at` for efficient batch deletion (1000 rows per iteration)
- **AC:** Events older than 90 days deleted, recent events retained, idempotent on re-run

---

## Phase 1B: Payouts + Score

### Sprint 8 — Treasury & Payout Schema (Global: 264)

**Goal:** Payout database foundation + treasury state

**Tasks:**

8.1 **Create migration 045_payout_system**
- `payout_requests` table with all constraints and indexes
- `treasury_state` table with OCC version column, initialized with `version: 0`
- Treasury account creation via SQL seed: `INSERT INTO credit_accounts (entity_type, entity_id) VALUES ('foundation', 'treasury:payout_reserve') ON CONFLICT (entity_type, entity_id) DO NOTHING` — deterministic, idempotent across environments
- New pool IDs: `withdrawal:pending`, `reserve:held`
- **AC:** Migration runs, treasury account created idempotently (running migration twice yields exactly one treasury account with expected entity_id), OCC table initialized

8.2 **Implement IPayoutProvider port**
- Interface for NOWPayments payout API: `createPayout()`, `getPayoutStatus()`, `getEstimate()`
- Types: `PayoutRequest`, `PayoutResult`, `PayoutQuote`
- **AC:** Port compiles, types exported

8.3 **Extend NOWPaymentsAdapter with payout methods**
- `createPayout()` — call NOWPayments payout API with idempotency key
- `getPayoutStatus()` — poll status for reconciliation
- `getEstimate()` — fee quote with TTL
- Address validation: EIP-55 checksum via `ethers.getAddress()`
- **AC:** Adapter compiles, mocked API tests pass

8.4 **Implement payout state machine**
- Formal transitions with SQL `WHERE status = ?` guards per SDD
- Each transition uses `UPDATE ... WHERE status = ? RETURNING id`
- Idempotent ledger ops with deterministic keys per phase
- **AC:** State machine rejects invalid transitions, idempotent on replay

8.5 **NOWPayments webhook fixture validation**
- Capture real NOWPayments webhook payloads (or use sandbox) and store as test fixtures
- Validate HMAC-SHA-512 signing/canonicalization against real payloads (not assumed format)
- Test key-sort canonicalization with actual provider field ordering
- Map all provider payout status enums to internal states, quarantine unknown statuses
- Store raw webhook payloads in `webhook_events` table for audit trail
- Persist webhook event IDs in DB with UNIQUE constraint (not only Redis TTL for replay protection)
- **AC:** Real/sandbox webhook payload verifies correctly, unknown status quarantined not crashed, raw payload stored, DB-backed replay protection passes

---

### Sprint 9 — Creator Payout Service (Global: 265)

**Goal:** Two-phase escrow payout flow

**Tasks:**

9.1 **Implement CreatorPayoutService with KYC enforcement**
- `requestPayout()` — validate balance, minimums, KYC threshold, rate limit
- **KYC threshold enforcement:**
  - Below $100 cumulative: no KYC required (wallet address only)
  - $100-$600 cumulative: basic KYC (email + wallet verification via linked wallet)
  - Above $600 cumulative: enhanced KYC (manual admin approval flag, `kyc_status` on account)
  - KYC state model: `none` → `basic` → `enhanced` → `verified` (stored on `credit_accounts` or separate `kyc_status` table)
  - Payout blocked if required KYC level not met — return 403 with required level
- Phase 1 HOLD: `BEGIN IMMEDIATE`, OCC on treasury_state, escrow pool transfers
- Enqueue BullMQ job: `payout-execution`
- **AC:** Payout request created, funds in escrow, job enqueued, payout rejected when KYC level insufficient with clear error message

9.2 **Implement payout execution worker**
- BullMQ worker (concurrency: 1)
- Call NOWPayments with quote → create payout → update status pending → processing
- Fee cap: reject if fee > 20% of gross
- **AC:** Worker processes payout, updates status, handles fee cap

9.3 **Implement getWithdrawableBalance()**
- Settled lots query per SDD §4.3
- Exclude lots in escrow (`withdrawal:pending`)
- **AC:** Correct balance, excludes pending/escrow/clawed-back

9.4 **Create payout API endpoints**
- `POST /api/payouts/request` — 202 Accepted with payout_id
- `GET /api/payouts/:id` — payout status
- Rate limit: 1/24h per account
- **AC:** API returns correct responses, rate limit enforced

---

### Sprint 10 — Payout Reconciliation & Webhook Processing (Global: 266)

**Goal:** Complete payout lifecycle with webhooks and reconciliation

**Tasks:**

10.1 **Implement webhook handler**
- `POST /api/payouts/webhook` — HMAC-SHA-512 verification
- Key sort canonicalization, 5-min timestamp window
- Replay protection: Redis dedupe with 24h TTL
- On completed: FINALIZE (burn escrow + reserve)
- On failed (terminal): RELEASE (return escrow + reserve)
- On failed (retryable): increment retry_count, re-enqueue if < max
- Always return 200 OK
- **AC:** Webhook verified, state transitions correct, replay rejected

10.2 **Implement reconciliation cron**
- `reconcile-payouts` (hourly): poll processing payouts > 24h
- Call `NOWPayments.getPayoutStatus()` for each
- Mark stalled, then FINALIZE or RELEASE based on provider state
- **AC:** Stalled payouts detected and resolved

10.3 **Implement payout cancellation**
- User can cancel pending payouts (before worker picks up)
- `pending → cancelled` with RELEASE of escrow
- **AC:** Cancellation releases funds, rejected if already processing

10.4 **Idempotency matrix validation**
- Document and test idempotency for every money-moving operation:
  - `postDistribution()`: DB unique key on `distribution:{chargeId}` — INSERT ON CONFLICT DO NOTHING
  - `settleEarnings()`: DB unique key on `settlement:{earningId}` — INSERT ON CONFLICT DO NOTHING
  - `clawbackEarning()`: Status guard `WHERE status = 'pending'` — no-op if already clawed back
  - `requestPayout() HOLD`: OCC version check — retry on version mismatch
  - `payout-execution worker`: Provider idempotency key — same key re-submitted
  - `webhook handler`: DB-persisted event ID with UNIQUE constraint + Redis TTL backup
- Test partial-completion scenarios: ledger entry written but status not updated → verify retry is safe
- **AC:** Every operation is safe on retry, no double-credits/debits, partial-completion test passes

10.5 **Integration test: payout lifecycle E2E**
- Request payout → HOLD → execute → webhook completed → FINALIZE
- Request payout → HOLD → execute → webhook failed → RELEASE
- Request payout → cancel before processing → RELEASE
- **AC:** All three flows pass, balances reconcile

---

### Sprint 11 — Wallet Linking & Score Import (Global: 267)

**Goal:** EIP-191 wallet verification + Score snapshot import

**Tasks:**

11.1 **Create migration 046_wallet_links**
- `wallet_link_nonces` table with expiry and used_at
- `wallet_links` table with UNIQUE(wallet_address, chain_id)
- `score_snapshots` table with UNIQUE(wallet_address, chain_id, snapshot_period)
- `score_distributions` table with UNIQUE(period)
- **AC:** Migration runs, all constraints enforced

11.2 **Implement nonce issuance and wallet link verification**
- `issueNonce()` — 16-byte random, 5-min expiry
- `linkWallet()` — atomic nonce consumption, SIWE-style message, EIP-191 verify
- Max 10 wallets per account
- **Wallet collision handling:** If wallet already linked to another account, reject with `WALLET_ALREADY_LINKED` error (wallet must be unlinked from previous account first). No silent transfer — explicit unlink → relink flow required.
- `unlinkWallet()` — set `unlinked_at`, idempotent. Unlinked wallets retain score history but stop contributing to future distributions.
- **AC:** Nonce consumed atomically, replay rejected, signature verified, collision returns clear error, unlinked wallet excluded from future score aggregation

11.3 **Create score/wallet API endpoints**
- `POST /api/score/wallets/nonce` — issue nonce
- `POST /api/score/wallets/link` — link wallet
- `DELETE /api/score/wallets/:address` — unlink
- `GET /api/score/wallets` — list linked wallets
- Rate limit: 5/hr per account for link
- **AC:** Endpoints return correct responses, rate limits enforced

11.4 **Implement wallet nonce cleanup cron**
- BullMQ cron: `cleanup-expired-nonces` (every 15 minutes)
- Delete `wallet_link_nonces` rows where `expires_at < NOW()` and `used_at IS NULL`
- Delete used nonces older than 24h (already consumed, kept for audit trail)
- Use index on `expires_at` for efficient deletion
- **AC:** Expired unused nonces cleaned up, used nonces retained 24h then purged, unit test for expiry behavior

11.5 **Implement Score import**
- `POST /api/score/import` (admin only) — bulk import score snapshots
- Validation: positive scores, valid wallet addresses, valid period format
- Upsert via `INSERT ... ON CONFLICT ... DO UPDATE`
- **AC:** Import succeeds, duplicates handled, validation rejects bad data

---

### Sprint 12 — Score Distribution & Campaign Integration (Global: 268)

**Goal:** Periodic Score-weighted reward distribution

**Tasks:**

12.1 **Implement ScoreRewardsService**
- `distributeRewards(period)` — aggregate scores via wallet_links → score_snapshots
- Pool size = `min(configured_amount, available_balance)`
- Abort if below minimum threshold
- Proportional shares: `account_reward = floor((account_score / total_score) × pool_size)` — same largest-remainder rounding policy as revenue distribution (Sprint 3.3). Remainder assigned to last participant by stable sort order.
- **AC:** Distribution proportional, pool cap enforced, minimum threshold works, property-based test: sum of all rewards === pool_size for random score sets

12.2 **Integrate with CampaignAdapter**
- Create campaign: `type: 'score_weighted'`, `budget_micro: pool_size`
- Batch grant via `CampaignAdapter.batchGrant()` with pool `score:rewards` (non-withdrawable)
- Record in `score_distributions`
- **AC:** Campaign created, grants non-withdrawable, distribution recorded

12.3 **Implement score distribution cron**
- BullMQ cron: `score-distribution` (monthly, 1st)
- Foundation score rewards pool account as source
- **AC:** Cron triggers monthly, distribution completes

12.4 **Create score rewards API**
- `GET /api/score/rewards` — reward history per account
- Shows period, amount, total pool, participant count
- **AC:** Returns correct history, handles no-rewards state

---

### Sprint 13 — E2E Testing & Launch Readiness (Global: 269)

**Goal:** Full system validation + launch checklists

**Tasks:**

13.1 **Full system E2E test suite**
- Referral → earnings → settlement → payout → completion
- Score import → wallet link → distribution → rewards visible
- Fraud pipeline: sybil attack simulation → bonuses withheld
- **AC:** All three E2E scenarios pass

13.2 **Treasury invariant stress test**
- Simulate 100 concurrent distributions + 10 payouts + 5 clawbacks
- Verify conservation invariant holds throughout
- Verify treasury balance never goes negative
- Measure SQLite lock contention under load
- **AC:** Invariants hold, no negative balances, p99 < 500ms

13.3 **Nonce and event cleanup validation**
- Verify expired nonce cleanup cron (implemented in Sprint 11.4) runs correctly under load
- Verify referral_events 90-day retention cleanup (implemented in Sprint 7.6) deletes expected rows
- Run both crons with seeded test data spanning >90 days
- **AC:** Stale nonces and events cleaned up on schedule, recent data retained

13.4 **Launch readiness checklist**
- [ ] All migrations (042-046) run cleanly on fresh DB in monotonic order
- [ ] Treasury account seeded correctly (idempotent on re-run)
- [ ] Default revenue rule has referrer_bps: 1000
- [ ] Referral campaign budget set ($50,000)
- [ ] NOWPayments payout API key configured
- [ ] HMAC webhook secret configured + validated against real payload fixture
- [ ] `FRAUD_HASH_SECRET` env var set for HMAC event hashing
- [ ] Rate limits configured (registration, code creation, payout, wallet link)
- [ ] Observability metrics emitting (Phase 1A baseline from Sprint 7.5)
- [ ] Treasury invariant alert configured and tested
- [ ] Fraud thresholds reviewed and tuned
- [ ] Admin RBAC roles configured, audit log table created
- [ ] KYC thresholds configured ($100/$600)
- [ ] WAL mode + busy_timeout confirmed in production SQLite config
- [ ] Idempotency matrix (Sprint 10.4) all green
- **AC:** All checklist items verified

---

## Dependencies

```
Sprint 1 ──→ Sprint 2 ──→ Sprint 3 ──→ Sprint 4 ──→ Sprint 5 ──→ Sprint 6 ──→ Sprint 7
(migration 042) (migration 043) (migration 044) (fraud)     (leaderboard)  (settlement)  (integration)
                                │
                                └─────────────────────────────────→ Sprint 8 ──→ Sprint 9 ──→ Sprint 10
                                                                   (treasury)    (payout)     (webhook)
                                                                                    │
                           Sprint 11 ──→ Sprint 12                                  │
                           (wallets)     (score dist)                                │
                                │              │                                    │
                                └──────────────┴────────────────────────────────────→ Sprint 13
                                                                                    (E2E + launch)
```

**Migration ordering:** 042 (Sprint 1) → 043 (Sprint 2) → 044 (Sprint 3) → 045 (Sprint 8) → 046 (Sprint 11) — strictly monotonic.

Key dependency: Sprint 3 (revenue share + creditFromCharge + pool registration) must complete before Sprint 8 (treasury).
Sprint 11-12 (Score) can run in parallel with Sprint 8-10 (payouts) if desired.

---

## Risk Mitigation

| Risk | Sprint | Mitigation |
|------|--------|------------|
| SQLite contention | 3 (baseline), 13 (stress) | WAL + busy_timeout + short transactions + early baseline test + batch settlement |
| NOWPayments API issues | 8 (fixtures), 10 | Real webhook fixture validation in Sprint 8.5, sandbox integration in Sprint 10 |
| Fraud false positives | 4, 7 | HMAC hashing, configurable thresholds, admin review queue with approve/deny |
| Conservation violation | 3, 7, 12, 13 | Largest-remainder rounding, property-based tests, invariant check cron, stress test |
| Idempotency gaps | 3, 6, 9, 10 | DB-backed unique keys (not Redis-only), idempotency matrix validation in Sprint 10.4 |
| KYC compliance | 9 | Tiered thresholds ($100/$600), state model, payout blocked if insufficient |
| Attribution gaming | 1 | First-touch immutability after qualifying action, serialized rebind, explicit timestamps |
| Wallet collision | 11 | Explicit unlink→relink flow, no silent transfer, WALLET_ALREADY_LINKED error |
| Admin access control | 4 | Role-based auth, immutable audit log, 403 on unauthorized |

---

*Generated with Loa Framework `/sprint-plan`*
*Based on PRD v1.2.0, SDD v1.2.0*

# PRD: Creator Economy — Referrals, Leaderboards & Score-Weighted Rewards

**Version:** 1.2.0
**Date:** 2026-02-15
**Status:** Draft
**Author:** arrakis-ai
**Issue:** [arrakis #64](https://github.com/0xHoneyJar/arrakis/issues/64)
**Cross-refs:** [RFC #66](https://github.com/0xHoneyJar/loa-finn/issues/66) · [RFC #31](https://github.com/0xHoneyJar/loa-finn/issues/31) · [arrakis PR #63](https://github.com/0xHoneyJar/arrakis/pull/63) · [arrakis #62](https://github.com/0xHoneyJar/arrakis/issues/62) · [loa-hounfour PR #2](https://github.com/0xHoneyJar/loa-hounfour/pull/2) · [loa #247](https://github.com/0xHoneyJar/loa/issues/247) · [Bridgebuilder Analysis](https://github.com/0xHoneyJar/arrakis/issues/64#issuecomment-3904364688)

---

## 1. Problem Statement

Arrakis has 27+ sprints of billing infrastructure (credit ledger, revenue distribution, budget enforcement, agent gateway) but no user-driven growth engine. The platform depends on direct BD for adoption. There is no mechanism for:

- Users to earn from referring others to the platform
- Creators/communities to earn ongoing revenue from the users they bring
- Long-term ecosystem participants (high-Score holders) to be rewarded for their commitment
- Projects to compete for and earn rewards based on ecosystem contribution

The billing rails are 90% built but generate zero inbound demand. A creator economy creates a **growth flywheel** where creators refer users → users generate inference revenue → creators earn a share → creators refer more users. This is simultaneously a **moat** (network effects from creator relationships) and a **BD tool** (projects want inclusion in Score to access the rewards pool).

> Sources: [arrakis #64](https://github.com/0xHoneyJar/arrakis/issues/64) (issue description + comments), [arrakis #62](https://github.com/0xHoneyJar/arrakis/issues/62) (payment collection status), [Bridgebuilder Rails Assessment](https://github.com/0xHoneyJar/arrakis/issues/64#issuecomment-3904364688)

---

## 2. Vision

Transform Arrakis from a platform that sells AI agent access into a **creator economy** where participants earn from ecosystem growth. Referrers, high-Score holders, and active communities share in inference revenue through transparent, governance-controlled rules.

**The Vercel insight applied:** Vercel charges 5× markup on infrastructure. Developers pay gladly because the DX justifies it. We do the same: 2× markup on inference, with 10% of revenue flowing back to the creators who drive adoption. The creator doesn't just use the platform — they *own a piece of its growth*.

---

## 3. Goals

| ID | Goal | Metric | Timeline |
|----|------|--------|----------|
| G-1 | Enable referral-driven user acquisition | First 50 referral registrations tracked | Sprint completion |
| G-2 | Create demand for Score product via rewards integration | At least 3 project inquiries about Score inclusion | 30 days post-launch |
| G-3 | Establish transparent creator revenue sharing | Revenue share visible in creator dashboard with per-transaction audit trail | Sprint completion |
| G-4 | Enable creator payouts to external wallets | First successful crypto payout via NOWPayments | Sprint completion |
| G-5 | Drive early demand through BD-ready referral program | Referral program materials ready for BD conversations | Sprint completion |
| G-6 | Create competitive leaderboard dynamics | Weekly active leaderboard with 10+ participants | 30 days post-launch |

---

## 4. User & Stakeholder Context

### 4.1 Primary Personas

**Creator/Referrer** — A community leader, content creator, or ecosystem participant who refers users to Arrakis agents. Motivated by: revenue share, leaderboard status, recognition.

**High-Score Holder** — A long-term participant measured by the external Score analytics system. Holds collections tracked by Score. Motivated by: passive rewards, ecosystem participation, being resourced for their commitment.

**Community Project** — A project that wants inclusion in Score and access to the rewards pool. Motivated by: BD relationship with THJ, visibility in the ecosystem, access to referral incentives.

**Referred User** — A new user arriving via referral code. Interacts with AI agents, purchases credits, creates dNFTs. May not know or care about the referral system.

### 4.2 User Journey

```
Creator gets referral code
  → Shares code via Discord/Telegram/social
    → New user registers with code (referee binding created)
      → Referee's first qualifying action (dNFT creation OR credit purchase)
        → Creator earns one-time signup bonus ($5 in credits)
      → Referee uses agents → Creator earns 10% of inference revenue (ongoing, 12-month window)
        → Creator checks leaderboard → Sees rank, earnings, referral count
          → Creator withdraws earnings → NOWPayments crypto payout to wallet
```

### 4.3 Score Holder Journey

```
Score measures collection holdings externally
  → Score data imported/synced to Arrakis
    → Score-weighted rewards pool calculated (e.g., monthly)
      → Higher Score = higher share of rewards pool
        → Rewards distributed as credits to high-Score accounts
          → Creates demand: projects want Score inclusion for their holders
            → BD opportunity: "Get your collection into Score"
```

---

## 5. Functional Requirements

### FR-1: Referral Code System

| ID | Requirement | Acceptance Criteria |
|----|-------------|-------------------|
| FR-1.1 | Generate unique referral codes per account | Alphanumeric, 8-12 chars, collision-resistant. One active code per account. |
| FR-1.2 | Track referral registrations | `referral_registrations` table binding referee → referrer. One referrer per user (UNIQUE constraint). |
| FR-1.3 | Referral code lifecycle | States: `active → expired → revoked`. Admin can revoke. Optional expiry and max-use limits. |
| FR-1.4 | API endpoints for referral management | `POST /api/referrals/code` (create), `GET /api/referrals/code` (get mine), `POST /api/referrals/register` (register as referee). |
| FR-1.5 | Referral attribution persistence | Binding is permanent. Revenue share has 12-month attribution window. |
| FR-1.6 | Attribution model: first-touch, lock-in at registration | **First-touch attribution**: the first referral code used at registration is the permanent binding. A user who registers without a code and later encounters a referral code CANNOT retroactively bind (lock-in is at registration). If a user attempts to register with a code but already has a binding, the request succeeds (idempotent) but does not change the existing referrer. Conflict resolution: earliest `referral_registrations.created_at` wins. Audit trail: all attribution attempts (successful and rejected) logged to `referral_attribution_log` with timestamp, code used, and outcome. |

### FR-2: Referral Rewards — Signup Bonus

| ID | Requirement | Acceptance Criteria |
|----|-------------|-------------------|
| FR-2.1 | Fixed credit bonus on referee's first qualifying action | $5 in credits (5,000,000 micro-USD) when referee completes their **first** qualifying action: dNFT creation OR first credit purchase, whichever occurs first. Only one bonus per referee (not one per action type). |
| FR-2.2 | One bonus per referee — idempotent | Enforced by `UNIQUE(referee_account_id)` on `referral_bonuses` table. Second qualifying action (e.g., credit purchase after dNFT) does NOT trigger another bonus. |
| FR-2.3 | Bonus via campaign system | Uses existing `CampaignAdapter.batchGrant()` with `campaign_type: 'referral'`. |
| FR-2.4 | Pool isolation for referral credits | Referral bonus credits deposited to `pool: 'referral:signup'`. May be spent on any inference. |
| FR-2.5 | Campaign budget cap | Global budget for signup bonuses. Configurable. Stops granting when exhausted. |
| FR-2.6 | Qualifying action minimum economic value | dNFT creation qualifies ONLY if it involves a paid mint (minimum cost configurable, e.g., ≥ $1). Free/zero-cost dNFT creation does NOT trigger the signup bonus. Credit purchase qualifies only if net payment ≥ configurable minimum (e.g., $5). This prevents farming bonuses via cheap qualifying actions. Per-referrer bonus cap: max N bonuses per referrer per 30-day window (configurable, default: 20) to limit individual farming velocity. |
| FR-2.7 | Delayed bonus granting | Signup bonus is not granted immediately. It enters a **pending** state for a configurable hold period (default: 7 days). During the hold, fraud checks run (risk score evaluation, velocity checks). If the referral registration is flagged as suspicious, the bonus is withheld pending manual review. Only cleared bonuses are granted to the referrer. |

### FR-3: Referral Rewards — Ongoing Revenue Share

| ID | Requirement | Acceptance Criteria |
|----|-------------|-------------------|
| FR-3.1 | Referrer earns 10% of referee's inference revenue | Computed as `referrer_share = inference_cost × referrer_bps / 10000` where `referrer_bps = 1000` (10%). |
| FR-3.2 | Revenue share is "off the top" — 4th party slice | Referrer share deducted before the 3-way split. The 3-way split (commons/community/foundation) applies to the **remainder** (total revenue − referrer share). Governance parameters `commons_bps`, `community_bps`, `foundation_bps` are redefined as "percentage of remainder" when a referrer is present. When no referrer is attributed, 100% flows to the 3-way split as before. Invariant: `referrer_share + commons_share + community_share + foundation_share == inference_revenue` (after deterministic rounding; foundation absorbs remainder). |
| FR-3.3 | 12-month attribution window with precise anchor | Revenue share expires 12 months after `referral_registrations.created_at` (the moment the referee registered with the referral code). Eligibility check at finalization: `inference_event.finalized_at < referral_registration.created_at + 12 months`. After expiry, 100% flows to standard 3-way split. |
| FR-3.4 | Idempotent revenue distribution | Distribution keyed by `(inference_charge_id, rule_version)`. Re-finalizing the same inference event (e.g., during backfill or replay) MUST NOT create additional referrer allocations. Existing allocation for the same key is a no-op. |
| FR-3.5 | Revenue share via `RevenueDistributionService` extension | Extend existing service to support 4th party (referrer). New entry type or reuse `revenue_share`. |
| FR-3.6 | Revenue share governed by `revenue_rules` | `referrer_bps` added to revenue rules schema. Changes follow existing governance (draft → cooling_down → active). |
| FR-3.7 | Rate change applicability — grandfathered | When `referrer_bps` changes via governance, the new rate applies **prospectively only**: inference events finalized after the new rule's `active` timestamp use the new rate; existing referral bindings are NOT retroactively recalculated. This is "grandfathered" behavior. The `rule_version` recorded with each distribution entry enables audit of which rate was applied. A minimum 7-day cooling period provides notice before rate changes take effect. |

### FR-4: Leaderboard

| ID | Requirement | Acceptance Criteria |
|----|-------------|-------------------|
| FR-4.1 | Referral leaderboard with timeframes | `daily`, `weekly`, `monthly`, `all_time` views. |
| FR-4.2 | Leaderboard fields | Rank, display name, referral count, total earnings (micro-USD), current streak (consecutive days with referrals). |
| FR-4.3 | API endpoint | `GET /api/referrals/leaderboard?timeframe=weekly&limit=50`. |
| FR-4.4 | Privacy controls | Opt-in display name. Default: anonymized (truncated wallet). |

### FR-5: Score-Weighted Rewards Pool

| ID | Requirement | Acceptance Criteria |
|----|-------------|-------------------|
| FR-5.1 | Score data import with identity resolution | Endpoint or scheduled job to import Score data. Canonical identifier: **EVM address**. Each Arrakis account may link N wallet addresses. Score rewards accrue per-account (sum of linked wallet scores). **Wallet linking protocol**: user signs EIP-191 personal_sign message containing `{ action: "link_wallet", account_id, wallet_address, chain_id, nonce, timestamp }`. Server verifies: (1) signature recovers to claimed address, (2) nonce is unique and unused (prevents replay), (3) timestamp within 5-minute window (prevents stale signatures), (4) chain_id matches expected network. Linked wallets can be unlinked by account owner (removes from Score accrual; does not affect already-distributed rewards). Max 10 linked wallets per account. |
| FR-5.2 | Score-weighted reward calculation | `account_reward = (account_score / total_score_sum) × pool_size`. Pool size is the **lesser of** the configured amount and the available balance in the `foundation:score_rewards` funding account. |
| FR-5.3 | Periodic distribution via campaign with hard budget | BullMQ cron job (weekly or monthly). Implemented as a campaign with `type: 'score_weighted'` and an **explicit budget cap** funded from a dedicated `foundation:score_rewards` pool. Budget is replenished by a configurable percentage of foundation revenue each period (e.g., 10% of foundation share). Invariant: `distributed_amount ≤ foundation:score_rewards.available_balance` enforced at distribution time. Distribution aborts (not partial) if budget insufficient. |
| FR-5.4 | Score rewards are non-withdrawable credits | Score reward credits are deposited to `pool: 'score:rewards'` (non-withdrawable). They may be spent on inference but cannot be paid out. This prevents open-ended treasury liability from Score distributions. |
| FR-5.5 | Score threshold and anti-Sybil | Minimum score per linked wallet to participate (prevents dust/Sybil). Minimum score per account to be eligible. Wallet-splitting attack mitigated: if a user splits holdings across N wallets, each wallet must independently meet the per-wallet minimum score threshold to contribute to the account total. |

### FR-6: Creator Payouts

| ID | Requirement | Acceptance Criteria |
|----|-------------|-------------------|
| FR-6.1 | Payout request API | `POST /api/payouts/request` with `{ amount_micro, destination_address, currency }`. |
| FR-6.2 | Payout state machine | `pending → processing → completed → failed`. Failed → `retry` allowed. |
| FR-6.3 | Minimum payout threshold | Configurable minimum (e.g., $10 = 10,000,000 micro-USD). |
| FR-6.4 | Credit classes — withdrawable vs non-withdrawable | Credits are classified by source: **earned credits** (referral revenue share) are withdrawable; **promotional credits** (signup bonuses, Score rewards, campaign grants) are non-withdrawable. Only earned credits may be used for payouts. Credit class tracked via `pool` tag on ledger lots (e.g., `pool: 'referral:revenue_share'` = withdrawable, `pool: 'referral:signup'` = non-withdrawable). |
| FR-6.5 | Treasury backing for payouts with settlement finality | A `treasury:payout_reserve` account holds real funds collected from inference payments. Referrer revenue share is accrued as **pending earned credits** at finalization. Credits transition from pending → **settled** (withdrawable) only after the underlying payment is confirmed settled/cleared (configurable settlement delay, default: 48 hours for crypto payments via NOWPayments/x402). If a payment is refunded or reversed before settlement, the pending earned credits are clawed back via a `clawback` ledger entry (negative credit) and the reserve is debited accordingly. Invariant: `SUM(all_settled_withdrawable_balances) ≤ treasury:payout_reserve.balance` at all times. Negative earned balances are not permitted; clawback is capped at pending amount. |
| FR-6.6 | Credit burn on payout | Atomic: deduct earned credits from creator account, create `withdrawal` ledger entry, debit `treasury:payout_reserve`. |
| FR-6.7 | Asynchronous NOWPayments payout execution | Payout API creates `payout_request` (status: `pending`) and enqueues a BullMQ job. Job calls NOWPayments with an **idempotency key** (`payout_request_id`). Response updates status to `processing`. |
| FR-6.8 | Payout webhook reconciliation | NOWPayments callback verified via **HMAC signature** (shared secret). Verified callback updates status to `completed` or `failed`. Unverified callbacks rejected (logged + alerted). |
| FR-6.9 | Payout fee handling | Network/provider fees deducted from payout amount (creator receives net). `amount_micro` on payout request is gross; `net_amount_micro` and `fee_micro` recorded after provider quote. |
| FR-6.10 | Payout audit trail | Immutable `payout_requests` table with full history including idempotency key, provider reference, fee breakdown. |
| FR-6.11 | Payout rate limiting | Max 1 payout request per 24 hours per account. Admin override available. |

### FR-7: Creator Dashboard API

| ID | Requirement | Acceptance Criteria |
|----|-------------|-------------------|
| FR-7.1 | Earnings summary | `GET /api/creator/earnings` — total earned, pending, paid out, by timeframe. |
| FR-7.2 | Referral stats | `GET /api/creator/referrals` — referral count, active referees, attribution window status. |
| FR-7.3 | Revenue breakdown | Per-referee earnings with per-model attribution (leveraging ensemble accounting `model_breakdown`). |
| FR-7.4 | Payout history | `GET /api/creator/payouts` — all payout requests with status. |

---

## 6. Technical & Non-Functional Requirements

### NFR-1: Financial Precision

All monetary values in BigInt micro-USD. No floating-point arithmetic. Matches existing credit ledger precision (ADR-001, ADR-002).

### NFR-2: Invariants

| Invariant | Description |
|-----------|-------------|
| **Conservation** | `referrer_share + commons_share + community_share + foundation_share == inference_revenue` for every finalization (foundation absorbs deterministic rounding remainder). |
| **Revenue share cap** | `SUM(referrer_rewards) ≤ SUM(inference_revenue × referrer_bps / 10000)` — creators cannot earn more than their share. |
| **No double attribution** | `∀ referee: COUNT(referral_registrations WHERE referee_account_id = referee) ≤ 1`. |
| **No phantom rewards** | `∀ reward: ∃ registration AND ∃ qualifying_action`. |
| **Idempotent distribution** | `∀ (inference_charge_id, rule_version): COUNT(referrer_allocations) ≤ 1` — replay/backfill cannot double-pay. |
| **Bounded signup liability** | `SUM(signup_bonuses) ≤ campaign.budget`. |
| **Bounded Score liability** | `SUM(score_rewards_distributed) ≤ foundation:score_rewards.available_balance` at distribution time. |
| **Treasury solvency** | `SUM(all_withdrawable_balances) ≤ treasury:payout_reserve.balance` at all times. Enforced via serializable transaction isolation (or row-level locking with SELECT FOR UPDATE) on `treasury:payout_reserve` during concurrent payout execution. Payout job must: (1) acquire lock on reserve row, (2) verify balance ≥ amount, (3) debit reserve + debit creator earned balance atomically, (4) release lock. Optimistic concurrency control (OCC) with version column as fallback for read-heavy paths. |
| **Payout solvency** | `∀ payout: account.earned_balance ≥ payout.amount` at execution time (only earned/withdrawable credits eligible). |

### NFR-3: Security

| Concern | Mitigation |
|---------|------------|
| Self-referral | Same-wallet detection. Same-IP heuristic (advisory, not blocking). |
| Wash trading | Rate limit on referral registrations per code per time window. |
| Referral code brute-force | Rate limit on `/api/referrals/register`. |
| Payout to wrong address | Require address confirmation on first payout. |
| Revenue share manipulation | Revenue share computed from actual inference cost in finalization path, not user-submitted values. |
| Score Sybil (wallet splitting) | Per-wallet minimum score threshold; wallet ownership verified via EVM signature before linking. |
| Payout webhook spoofing | NOWPayments callbacks verified via HMAC signature (shared secret). Unverified callbacks rejected. |
| Referral privacy | Referrers see **aggregate** stats only (referral count, total earnings). Referrers CANNOT see individual referee identities, usage patterns, or transaction details. Referee activity is never exposed to referrer via API or dashboard. Referral bindings are retained for audit but subject to data retention policy (configurable, default: 24 months after attribution window expiry). Account deletion removes referee binding and anonymizes historical distribution records. |
| Referral fraud — distributed attacks | **Velocity rules**: max N registrations per referral code per hour (configurable, default: 10). **Risk scoring**: referral registrations scored by signals (same IP cluster, similar user-agent, rapid sequential registration, referee has no subsequent paid activity). High-risk registrations flagged for manual review; bonus grant delayed until cleared. **Cooling-off period**: earned credits from revenue share become withdrawable only after 14-day hold from accrual date. This prevents hit-and-run fraud. **Sanctions**: accounts with >50% flagged referrals auto-suspended from referral program pending review. |
| Payout KYC threshold | Payouts exceeding configurable threshold (e.g., $100 cumulative or $50 single) require additional verification (wallet ownership re-confirmation + admin approval queue). Below threshold: auto-processed. |

### NFR-4: Performance

| Metric | Target |
|--------|--------|
| Referral registration | < 200ms p99 |
| Leaderboard query | < 500ms p99 (cached, 1-minute TTL) |
| Revenue share calculation | < 50ms overhead per finalization |
| Payout request (API acceptance) | < 200ms p99 (creates pending record + enqueues job; excludes NOWPayments call) |

### NFR-5: Observability

| Metric | Alert |
|--------|-------|
| `referral.registrations.count` | Spike detection (10× normal rate = potential abuse) |
| `referral.rewards.distributed.total` | Budget utilization > 80% |
| `payout.requests.failed.count` | Any failure in 5-minute window |
| `revenue_share.referrer.total` | Monitoring only (no alert) |

---

## 7. Scope & Prioritization

### Phase 1A: MVP Core — Non-Withdrawable Earnings (This Cycle, First Half)

| Priority | Feature | Sprints |
|----------|---------|---------|
| P0 | Referral tracking tables + code system (FR-1) | 1-2 |
| P0 | Signup bonus rewards with delayed granting (FR-2) | 1-2 |
| P0 | Revenue share extension — 4th party referrer (FR-3) | 1-2 |
| P0 | Leaderboard (FR-4) | 1 |
| P0 | Creator dashboard API — earnings view (FR-7) | 1 |

**Phase 1A estimated: 5-7 sprints**

Revenue share accrues as earned credits but payouts are not yet enabled. Creators can see their earnings and track referrals. This validates the referral flywheel with zero treasury risk.

**Launch readiness checklist for Phase 1A:**
- [ ] Fraud detection pipeline (velocity rules, risk scoring) operational
- [ ] Settlement finality delay configured and tested
- [ ] Revenue share conservation invariant property-tested
- [ ] Admin tools for referral program management (revoke, suspend, review queue)

### Phase 1B: Payouts + Score (This Cycle, Second Half)

| Priority | Feature | Sprints |
|----------|---------|---------|
| P0 | Creator payouts via NOWPayments (FR-6) | 2-3 |
| P0 | Payout reconciliation + provider risk tooling | 1 |
| P1 | Score rewards pool — basic import + distribution (FR-5) | 1-2 |

**Phase 1B estimated: 4-6 sprints** (closed beta with manual payout approval before general availability)

**Launch readiness checklist for Phase 1B:**
- [ ] Reconciliation job tested (provider ledger vs internal ledger match)
- [ ] KYC threshold + admin approval queue operational
- [ ] Manual payout fallback documented and tested
- [ ] Treasury solvency invariant property-tested under concurrent load

**Total estimated: 9-13 sprints (Phase 1A + 1B)**

### Phase 2: Enhancement (Future Cycle)

| Feature | Description |
|---------|-------------|
| Competition framework | Community-level metrics + competitive rewards |
| On-chain payouts | x402 reverse flow (credits → USDC on Base) |
| ERC-6551 TBA | Token-bound agent wallets with referral earnings |
| Score API integration | Real-time Score sync instead of batch import |
| Referral tiers | Bronze/Silver/Gold referrer status with increasing rates |
| Multi-level referral | Second-degree referrals (referrer of referrer) |

### Out of Scope

- Direct ad revenue model (not pursuing YouTube-style ads)
- Fiat payout rails (crypto-first for launch, fiat later)
- Community governance voting on referral rates (use existing revenue_rules governance)
- On-chain referral tracking (off-chain for speed, on-chain receipts deferred)

---

## 8. Risks & Dependencies

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Referral abuse (self-referral, bots) | High | Medium | Rate limiting, same-wallet detection, graduated sanctions |
| Low referral demand (no one uses codes) | Medium | High | BD push, leaderboard incentives, Score integration creates pull |
| Payout failures (NOWPayments API) | Low | High | Retry queue with exponential backoff (max 3 retries), manual fallback ops runbook, audit trail. **Provider risk plan**: periodic reconciliation job (hourly) polls NOWPayments API to verify payout status matches internal ledger. Webhook retry/backoff + polling fallback for missed callbacks. Secondary payout path: manual admin payout for edge cases. Geo/compliance restrictions documented per NOWPayments ToS. Provider SLA timeout: if no webhook within 24 hours, payout marked `stalled` and escalated to admin queue. |
| Revenue share creates unsustainable liability | Low | High | 12-month attribution window caps liability; `referrer_bps` governable via revenue_rules |
| Score data quality/availability | Medium | Medium | Graceful degradation if Score data unavailable; rewards pool paused |

### Dependencies

| Dependency | Status | Impact |
|-----------|--------|--------|
| Credit ledger (PR #63) | Merged | Foundation for all credit operations |
| Revenue distribution service | Merged | Needs extension for 4th party |
| Campaign system | Merged | Used for signup bonuses |
| NOWPayments integration | Built (adapter exists) | Needs payout API integration |
| Score external system | Exists | Needs data import mechanism |
| `FEATURE_BILLING_ENABLED=true` | Not yet | Must be enabled for any revenue flow |

---

## 9. Revenue Model

### Revenue Flow with Referrals (referred user)

```
User pays for inference: $0.10 (100,000 micro-USD)
  Step 1 — Referrer slice (10% of total):
    referrer_share = 100,000 × 1000 / 10000 = 10,000 micro-USD ($0.01)
    → credited to referrer as EARNED (withdrawable) credits
    → simultaneously reserved in treasury:payout_reserve
  Step 2 — Remainder to 3-way split:
    remainder = 100,000 - 10,000 = 90,000 micro-USD ($0.09)
    ├── Commons (5% of remainder):     90,000 × 500 / 10000 = 4,500 ($0.0045)
    ├── Community (70% of remainder):  90,000 × 7000 / 10000 = 63,000 ($0.0630)
    └── Foundation (25% of remainder): 90,000 - 4,500 - 63,000 = 22,500 ($0.0225)
  Invariant check: 10,000 + 4,500 + 63,000 + 22,500 = 100,000 ✓
```

### Revenue Flow without Referrals (organic user)

```
User pays for inference: $0.10 (100,000 micro-USD)
  No referrer → 100% to 3-way split:
    ├── Commons (5%):     5,000 micro-USD
    ├── Community (70%):  70,000 micro-USD
    └── Foundation (25%): 25,000 micro-USD
```

### Score Rewards Pool

```
Monthly rewards pool: min(configured_amount, foundation:score_rewards.balance)
  Funded by: configurable % of foundation revenue each period
  Credit class: NON-WITHDRAWABLE (spendable on inference only)
  Distribution:
      ├── Account A (Score: 500 / Total: 5000) → 10% of pool
      ├── Account B (Score: 1500 / Total: 5000) → 30% of pool
      └── Account C (Score: 3000 / Total: 5000) → 60% of pool
  Anti-Sybil: per-wallet minimum score threshold; wallet ownership verified via signature
```

### Unit Economics Guardrails (SKP-001)

The 10% referral share + Score pool funding operates within a 2× inference markup. Guardrails:

- **Dynamic `referrer_bps`**: Governable via `revenue_rules`. Can be reduced if margins compress (e.g., provider cost increases). Kill-switch: set `referrer_bps = 0` to halt all referrer payouts immediately.
- **Margin floor**: If `(inference_price - provider_cost) / inference_price < 30%`, referrer share is automatically suspended for that model tier. Prevents negative-margin referral payouts.
- **Launch pricing experiment**: First 30 days track CAC-per-referral (bonus cost / converted referrals), conversion rate (referrals → paying users), and gross margin after referrer share. Dashboard metric: `net_margin_after_referrals`.
- **Score pool cap**: Foundation share funds Score pool; if foundation revenue < Score pool target, pool is reduced proportionally (never draws from other parties).

### BD Value Proposition

- **To creators:** "Earn 10% of every AI inference your referrals generate. Transparent rules. Crypto payouts."
- **To projects:** "Get your collection into Score. Your holders earn passive rewards. Creates demand for your token."
- **To communities:** "70% of inference revenue stays in your community. Add a referral program to grow usage."

---

## 10. Protocol Integration

### loa-hounfour Types

The referral system should use loa-hounfour protocol types where applicable:

| Schema | Usage |
|--------|-------|
| `billing-entry` | Referral reward entries use existing wire format |
| `credit-note` | Payout records as credit notes |
| Escrow state machine | Payout holds (pending → confirmed → released) |
| Economy flow verification | `verifyEconomyFlow()` validates referral revenue never exceeds total revenue |

### Temporal Safety Properties

From [loa-hounfour PR #2](https://github.com/0xHoneyJar/loa-hounfour/pull/2):

1. **Safety:** No payout processed without matching credit burn
2. **Safety:** No referral reward without qualifying referee action
3. **Liveness:** Every approved payout completes within 72 hours
4. **Conservation:** `referrer_rewards_total ≤ inference_revenue_total × referrer_bps / 10000`

---

## 11. Success Criteria

| Criteria | Measurement |
|----------|-------------|
| System can track referral registrations end-to-end | Integration test: create code → register → verify binding |
| Signup bonus distributes correctly | Test: referee creates dNFT → referrer receives $5 credit |
| Revenue share computes correctly on finalization | Test: inference finalization → referrer receives 10% → remaining splits 3-way |
| Leaderboard queries return in < 500ms | Load test with 1000+ referral records |
| Payout executes successfully | Smoke test: request payout → NOWPayments API → confirmation |
| Score rewards distribute proportionally | Test: import scores → trigger distribution → verify proportional grants |
| Conservation invariant holds under concurrent load | Property-based test: 100 random scenarios, invariant checked after each |

---

*Generated with Loa Framework `/plan-and-analyze`*
*Grounded in: [Bridgebuilder Rails Assessment](https://github.com/0xHoneyJar/arrakis/issues/64#issuecomment-3904364688), [Architectural Meditation](https://github.com/0xHoneyJar/arrakis/issues/64#issuecomment-3904367015), 27+ sprints of billing infrastructure*

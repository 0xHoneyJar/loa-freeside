# Sprint 260 (sprint-4) Implementation Report

## Signup Bonus & Fraud Check Service

**Cycle**: cycle-029 — Creator Economy
**Sprint**: sprint-4 (Global: 260)
**Status**: COMPLETE
**Branch**: feature/creator-economy-release

---

## Task Summary

| Task | Title | Status | Files |
|------|-------|--------|-------|
| 4.1 | FraudCheckService | DONE | `src/packages/adapters/billing/FraudCheckService.ts` |
| 4.2 | Referral event capture middleware | DONE | `src/packages/adapters/billing/ReferralEventCapture.ts` |
| 4.3 | Bonus triggering flow | DONE | Already in `ReferralService.ts` (Sprint 1) |
| 4.4 | Delayed bonus processing | DONE | `src/packages/adapters/billing/BonusProcessor.ts` |
| 4.5 | Flagged bonus admin review | DONE | `src/api/routes/admin-bonus-routes.ts` |

## Implementation Details

### Task 4.1: FraudCheckService

**File**: `themes/sietch/src/packages/adapters/billing/FraudCheckService.ts`

Weighted risk scoring (0.0-1.0) with 4 signals:

| Signal | Weight | Query |
|--------|--------|-------|
| IP cluster | 0.30 | Distinct accounts sharing IP hash (threshold: 3) |
| UA/fingerprint | 0.25 | Distinct accounts sharing fingerprint hash (threshold: 2) |
| Velocity | 0.25 | Registrations from same IP prefix in 1h (threshold: 5) |
| Activity check | 0.20 | 7-day qualifying action presence |

Threshold routing:
- score < 0.3 → `clear`
- 0.3 ≤ score < 0.7 → `flagged` (manual review)
- score ≥ 0.7 → `withheld` (auto-block)

Configurable thresholds via constructor parameter.

### Task 4.2: ReferralEventCapture

**File**: `themes/sietch/src/packages/adapters/billing/ReferralEventCapture.ts`

- HMAC-SHA-256 hashing of IP, User-Agent, fingerprint using `FRAUD_HASH_SECRET` env var
- Raw PII never stored — only hashed values
- IPv4 prefix extraction: first 3 octets (e.g., "192.168.1")
- IPv6 prefix extraction: first 4 groups (e.g., "2001:db8:85a3:0000")
- Non-fatal error handling (doesn't block main flow)
- Data classification: pseudonymized PII, subject to 90-day retention

### Task 4.3: Bonus Triggering Flow

Already implemented in `ReferralService.onQualifyingAction()` (Sprint 1 Task 1.4):
- Minimum economic value validation (dNFT ≥ $1, credit ≥ $5)
- Per-referrer bonus cap (default: 50)
- Idempotent via UNIQUE constraint on (referee, action, actionId)

### Task 4.4: BonusProcessor

**File**: `themes/sietch/src/packages/adapters/billing/BonusProcessor.ts`

- Processes pending bonuses older than 7 days
- Batch size limit: 100 per invocation
- Evaluates each bonus via FraudCheckService
- Clear → grant via ledger (pool: `referral:signup`, non-withdrawable)
- Flagged → set `status = 'flagged'` with `flag_reason`
- Withheld → set `status = 'withheld'` with `flag_reason`
- Records `risk_score` and `fraud_check_at` on all evaluated bonuses
- Auto-increments `entry_seq` per account+pool for UNIQUE constraint

### Task 4.5: Admin Bonus Review Routes

**File**: `themes/sietch/src/api/routes/admin-bonus-routes.ts`

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/admin/bonuses/flagged` | GET | Admin JWT | List flagged/withheld bonuses |
| `/api/admin/bonuses/:id/approve` | POST | Admin JWT | Grant flagged bonus |
| `/api/admin/bonuses/:id/deny` | POST | Admin JWT | Deny flagged bonus |

- JWT auth with HS256 verification (same pattern as billing-admin-routes)
- Rate limiting: 30 requests/min per admin
- All actions logged to `admin_audit_log` (append-only)
- Approve creates ledger entry + updates bonus status
- Deny sets status without ledger entry
- Validates bonus is `flagged` or `withheld` before action

## Test Results

**File**: `tests/integration/billing-fraud-bonus.test.ts`

**27 tests**, all passing:

| Suite | Tests | Coverage |
|-------|-------|----------|
| FraudCheckService | 9 | All signals, threshold routing, custom thresholds |
| ReferralEventCapture | 6 | HMAC hashing, IP prefix, null handling, metadata |
| BonusProcessor | 6 | Hold period, grant, flag, batch, empty, scoring |
| admin-bonus-review | 4 | Approve, deny, audit log, non-flagged guard |
| e2e-lifecycle | 2 | Full registration → grant lifecycle |

## Cumulative Test Results

- Sprint 1: 46 passed
- Sprint 2: 13 passed
- Sprint 3: 16 passed
- Sprint 4: 27 passed
- **Total**: 102 passed, 0 failed

## Bug Fixes During Implementation

1. **UNIQUE(account_id, pool_id, entry_seq)**: BonusProcessor used hardcoded `entry_seq = 0` for all grants. Fixed by computing next available seq via `MAX(entry_seq) + 1`.
2. **FK violation on `referral_code_id`**: Event capture test passed non-existent FK reference. Fixed by creating real referral code in test.
3. **Activity check window**: `scoreBonusClaim` checks activity relative to `bonusCreatedAt`, not `now`. Fixed test to set event within the correct window.

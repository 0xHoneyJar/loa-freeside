# Billing System Operational Runbook

**System:** Arrakis Billing & Payments
**Version:** Sprint 5 (Cycle 025)
**Last Updated:** 2026-02-14

---

## 1. Migration Procedure

### Pre-Migration Checklist

1. **Backup SQLite database**
   ```bash
   cp data/sietch.db data/sietch.db.bak-$(date +%Y%m%d%H%M%S)
   ```

2. **Verify current migration state**
   ```sql
   SELECT * FROM migrations ORDER BY applied_at DESC LIMIT 5;
   ```

3. **Stop all background jobs** (sweeper, reconciler, DLQ processor)

### Apply Migrations

Migrations are applied in order:
- `030_credit_ledger.ts` — Core ledger tables (accounts, lots, reservations, ledger)
- `031_crypto_payments_v2.ts` — Payment table extension (x402, NOWPayments columns)
- `032_billing_ops.ts` — Operations tables (DLQ, audit log, config)
- `033_campaigns.ts` — Campaign engine tables (campaigns, grants)

```bash
# Apply via application startup (auto-migration)
FEATURE_BILLING_ENABLED=false npm start

# Verify tables created
sqlite3 data/sietch.db ".tables" | grep credit_
```

### Post-Migration Verification

```sql
-- Verify lot_invariant CHECK constraint
SELECT COUNT(*) FROM credit_lots
WHERE available_micro + reserved_micro + consumed_micro != original_micro;
-- Expected: 0

-- Verify config seeded
SELECT key, value FROM billing_config WHERE key = 'billing_mode';
-- Expected: shadow

-- Verify system accounts
SELECT id, entity_type FROM credit_accounts WHERE id LIKE 'sys-%';
-- Expected: 3 rows (sys-foundation, sys-commons, sys-community-pool)
```

### Rollback Procedure

1. Stop the application
2. Restore from backup: `cp data/sietch.db.bak-TIMESTAMP data/sietch.db`
3. Restart with `FEATURE_BILLING_ENABLED=false`

---

## 2. Feature Flag Progression

### Shadow Mode (Default — Current)

```bash
FEATURE_BILLING_ENABLED=true
# billing_config.billing_mode = 'shadow'
```

- All billing operations logged but no real charges
- Shadow entries created in `credit_ledger` with `shadow_*` entry types
- Balance unaffected — users see no impact
- **Monitor:** Shadow charge volume, cost estimation accuracy

### Soft Mode (Staging Validation)

```sql
UPDATE billing_config SET value = 'soft' WHERE key = 'billing_mode';
```

- Real reserves and charges applied
- Overruns allowed (negative balance permitted)
- **Monitor:** Overrun rate, negative balance count, DLQ depth

### Live Mode (Production)

```sql
UPDATE billing_config SET value = 'live' WHERE key = 'billing_mode';
```

- Full enforcement — insufficient balance returns HTTP 402
- Overruns capped at reserved amount
- **Monitor:** 402 rate, payment success rate, balance reconciliation drift

### Progression Checklist

- [ ] Shadow mode: 7 days with < 1% error rate
- [ ] Soft mode: 3 days with < 0.1% overrun rate
- [ ] Live mode: Verify 402 handling works end-to-end
- [ ] Verify refund/clawback flow works in each mode
- [ ] Verify DLQ processes failures correctly

---

## 3. Monitoring Alerts

### Critical Alerts

| Alert | Threshold | Action |
|-------|-----------|--------|
| DLQ depth > 50 | 50 items pending | Check DLQ processor, review errors |
| Reconciliation drift > 1% | 1% of accounts | Run manual reconciliation |
| Overrun rate > 5% | 5% of finalizations | Check cost estimation accuracy |
| Payment failure rate > 10% | 10% of top-ups | Check x402/NOWPayments integration |
| Lot invariant violation | Any violation | CRITICAL — Stop billing, investigate |

### Warning Alerts

| Alert | Threshold | Action |
|-------|-----------|--------|
| DLQ manual_review items | > 0 | Human review required |
| Redis balance cache miss rate | > 50% | Check Redis connectivity |
| Reservation expiry rate | > 20% | Increase TTL or check timeouts |
| Campaign budget > 90% spent | 90% | Notify campaign owner |

### Monitoring Queries

```sql
-- DLQ depth
SELECT status, COUNT(*) FROM billing_dlq GROUP BY status;

-- Reconciliation status
SELECT value FROM billing_config WHERE key = 'last_reconciliation_result';

-- Active reservations (pending)
SELECT COUNT(*) FROM credit_reservations WHERE status = 'pending';

-- Revenue distribution totals (last 24h)
SELECT entry_type, SUM(CAST(amount_micro AS INTEGER))
FROM credit_ledger
WHERE entry_type IN ('commons_contribution', 'revenue_share')
AND created_at > datetime('now', '-1 day')
GROUP BY entry_type;
```

---

## 4. Incident Response

### Billing Failure (402 Errors Spike)

1. Check billing mode: `SELECT value FROM billing_config WHERE key = 'billing_mode';`
2. If live mode, consider temporary fallback to soft mode
3. Check for lot invariant violations
4. Review DLQ for patterns

### Lot Invariant Violation

**Severity: CRITICAL**

1. Immediately set billing mode to shadow
2. Identify affected lots:
   ```sql
   SELECT * FROM credit_lots
   WHERE available_micro + reserved_micro + consumed_micro != original_micro;
   ```
3. Review recent ledger entries for the affected account
4. Restore from backup if data integrity compromised

### Double-Credit (Duplicate Deposit)

1. Check idempotency table:
   ```sql
   SELECT * FROM billing_idempotency_keys WHERE scope = 'deposit';
   ```
2. Identify duplicate lots by source_id
3. Mark duplicate lot as consumed (set available_micro = 0, consumed_micro = original_micro)

### Campaign Overspend

1. Pause the campaign: `UPDATE credit_campaigns SET status = 'paused' WHERE id = ?;`
2. Review grants: `SELECT SUM(amount_micro) FROM credit_grants WHERE campaign_id = ?;`
3. Compare with budget_micro in credit_campaigns

---

## 5. Redis Cache Reset

### Full Cache Reset

```bash
redis-cli KEYS "billing:balance:*" | xargs redis-cli DEL
```

### Per-Account Reset

```bash
redis-cli DEL "billing:balance:ACCOUNT_ID:general"
```

### After Reset

The next `getBalance()` call will fall back to SQLite and repopulate the cache. No data loss — SQLite is the source of truth.

---

## 6. NOWPayments Webhook Handling

### Webhook Retry Flow

1. NOWPayments sends webhook to `/api/billing/webhooks/nowpayments`
2. HMAC signature verified
3. Payment state updated via state machine
4. On `finished` status: credit lot minted
5. On failure: added to DLQ with exponential backoff

### Manual Webhook Replay

If a webhook was missed:

1. Query NOWPayments API for payment status
2. If `finished`, manually trigger deposit:
   ```sql
   -- Check if deposit already exists
   SELECT * FROM crypto_payments WHERE provider_payment_id = 'NP_PAYMENT_ID';
   ```
3. If not processed, use admin mint endpoint:
   ```bash
   curl -X POST /admin/billing/accounts/ACCOUNT_ID/mint \
     -H "Authorization: Bearer ADMIN_JWT" \
     -d '{"amountMicro": "5000000", "sourceType": "deposit", "description": "Manual NOWPayments recovery"}'
   ```

### DLQ Processing

```sql
-- View pending DLQ items
SELECT id, operation_type, error_message, retry_count, next_retry_at
FROM billing_dlq
WHERE status = 'pending'
ORDER BY next_retry_at;

-- Escalated items requiring human review
SELECT * FROM billing_dlq WHERE status = 'manual_review';
```

---

## 7. S2S Finalize Endpoint

### Authentication

loa-finn authenticates via internal JWT:
- **Secret:** `BILLING_INTERNAL_JWT_SECRET` env var
- **Issuer:** `loa-finn`
- **Audience:** `arrakis-internal`
- **TTL:** 5 minutes max
- **Rate limit:** 200 requests/minute per service

### Troubleshooting

| Issue | Check |
|-------|-------|
| 401 Unauthorized | Verify `BILLING_INTERNAL_JWT_SECRET` matches between services |
| 404 Reservation not found | Check reservation exists and hasn't expired |
| 409 Conflict | Duplicate finalize with different amount — idempotency violation |
| 429 Too Many Requests | S2S rate limit hit — check for retry loops |

---

## 8. Key Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `FEATURE_BILLING_ENABLED` | Yes | Master billing feature flag |
| `BILLING_INTERNAL_JWT_SECRET` | Yes (S2S) | Internal service JWT secret |
| `BILLING_ADMIN_JWT_SECRET` | Yes (admin) | Admin JWT secret |
| `BILLING_ADMIN_JWT_SECRET_PREV` | No | Previous admin secret for rotation |
| `BILLING_CEILING_MICRO` | No | Max single transaction (default: 1T micro) |
| `NOWPAYMENTS_API_KEY` | Conditional | NOWPayments API key |
| `NOWPAYMENTS_IPN_SECRET` | Conditional | NOWPayments webhook HMAC secret |

# PostgreSQL Migration Runbook

> Cycle 037: Proof of Economic Life — Sprint 0A
> Flatline IMP-001: Rollback runbook for database migrations

## Overview

This runbook covers the PostgreSQL migration pipeline for the economic ledger tables
introduced in Cycle 037. Migrations 0008-0011 create the double-entry append-only
ledger, webhook dedup, and tenant context guard infrastructure.

## Migration Inventory

| Migration | Tables | Risk Level | Rollback Strategy |
|-----------|--------|------------|-------------------|
| 0008 | `app` schema, guard functions | Low | DROP SCHEMA app CASCADE |
| 0009 | `credit_lots`, `lot_entries`, `lot_balances` view | Medium | DROP TABLE + DROP VIEW |
| 0010 | `webhook_events`, `crypto_payments` | Medium | DROP TABLE |
| 0011 | `usage_events`, `s2s_jwks_public_keys`, `reconciliation_cursor` | Medium | DROP TABLE |

## Pre-Migration Checklist

- [ ] PostgreSQL 15 running and accessible
- [ ] `arrakis_app` role exists with LOGIN privilege
- [ ] Backup taken: `pg_dump -Fc -f pre-migration-$(date +%Y%m%d).dump $DATABASE_URL`
- [ ] Connection count below threshold (check PgBouncer stats)
- [ ] No active long-running transactions: `SELECT * FROM pg_stat_activity WHERE state = 'active' AND query_start < now() - interval '5 minutes'`
- [ ] Maintenance window communicated to team

## Execution Procedure

### Step 1: Backup

```bash
# Full database backup before any migration
pg_dump -Fc -f /tmp/pre-0008-$(date +%Y%m%d%H%M).dump "$DATABASE_URL"

# Verify backup is valid
pg_restore --list /tmp/pre-0008-*.dump | head -20
```

### Step 2: Run Migrations in Order

```bash
# Migration 0008: Tenant Context Guard (prerequisite for all others)
psql "$DATABASE_URL" -f themes/sietch/drizzle/migrations/0008_tenant_context_guard.sql

# Verify: guard function exists and raises on missing context
psql "$DATABASE_URL" -c "SELECT app.current_community_id();"
# Expected: ERROR: app.community_id is not set (P0001)

# Migration 0009: Credit Lots + Lot Entries
psql "$DATABASE_URL" -f themes/sietch/drizzle/migrations/0009_credit_lots_lot_entries.sql

# Verify: tables exist and RLS is active
psql "$DATABASE_URL" -c "\d credit_lots"
psql "$DATABASE_URL" -c "SELECT relrowsecurity FROM pg_class WHERE relname = 'credit_lots';"
# Expected: relrowsecurity = t

# Migration 0010: Webhook Events + Crypto Payments
psql "$DATABASE_URL" -f themes/sietch/drizzle/migrations/0010_webhook_events_crypto_payments.sql

# Verify: status monotonicity trigger
psql "$DATABASE_URL" -c "SELECT tgname FROM pg_trigger WHERE tgrelid = 'crypto_payments'::regclass;"

# Migration 0011: Usage Events + JWKS + Reconciliation
psql "$DATABASE_URL" -f themes/sietch/drizzle/migrations/0011_usage_events_pg.sql

# Verify: append-only triggers
psql "$DATABASE_URL" -c "SELECT tgname FROM pg_trigger WHERE tgrelid = 'usage_events'::regclass;"
```

### Step 3: Post-Migration Verification

```bash
# Invariant test: RLS blocks queries without tenant context
psql "$DATABASE_URL" -c "SET ROLE arrakis_app; SELECT * FROM credit_lots;"
# Expected: 0 rows (RLS filters without context)

# Invariant test: append-only enforcement
psql "$DATABASE_URL" -c "INSERT INTO credit_lots (community_id, source, amount_micro) VALUES (gen_random_uuid(), 'seed', 1000000);"
# Expected: ERROR (RLS blocks without SET LOCAL)

# Invariant test: lot_balances view works
psql "$DATABASE_URL" -c "SELECT * FROM lot_balances LIMIT 1;"
# Expected: 0 rows (no data yet), but no errors
```

## Rollback Procedure

### Rollback All (0011 → 0008)

```bash
# Restore from backup (safest)
pg_restore -Fc -d "$DATABASE_URL" --clean /tmp/pre-0008-*.dump
```

### Rollback Individual Migrations

```bash
# Rollback 0011
DROP TABLE IF EXISTS reconciliation_cursor CASCADE;
DROP TABLE IF EXISTS s2s_jwks_public_keys CASCADE;
DROP TABLE IF EXISTS usage_events CASCADE;

# Rollback 0010
DROP TABLE IF EXISTS crypto_payments CASCADE;
DROP TABLE IF EXISTS webhook_events CASCADE;
DROP FUNCTION IF EXISTS enforce_payment_status_monotonicity() CASCADE;

# Rollback 0009
DROP VIEW IF EXISTS lot_balances CASCADE;
DROP TABLE IF EXISTS lot_entries CASCADE;
DROP TABLE IF EXISTS credit_lots CASCADE;
DROP FUNCTION IF EXISTS prevent_mutation() CASCADE;
DROP FUNCTION IF EXISTS app.update_lot_status(UUID, TEXT) CASCADE;

# Rollback 0008
DROP FUNCTION IF EXISTS app.set_community_context(UUID) CASCADE;
DROP FUNCTION IF EXISTS app.current_community_id() CASCADE;
DROP SCHEMA IF EXISTS app CASCADE;
```

## Failure Handling

### Mid-Migration Failure

If a migration fails partway through:

1. **Do NOT run the next migration** — dependencies will fail
2. Check the error: `psql` will show the exact line and error code
3. If the error is "already exists" (`42P07`): migration was partially applied
   - Option A: Rollback this migration, fix the issue, re-run
   - Option B: Skip the failing statement if the object already exists correctly
4. If the error is a constraint violation: check data integrity
5. Restore from backup if unsure: `pg_restore -Fc -d "$DATABASE_URL" /tmp/pre-*.dump`

### Connection Issues During Migration

```bash
# Check active connections
psql "$DATABASE_URL" -c "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database();"

# Terminate idle connections if needed (admin only)
psql "$DATABASE_URL" -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state = 'idle' AND query_start < now() - interval '10 minutes';"
```

## Staging Validation Checklist

Before running in production:

- [ ] All 4 migrations run cleanly on staging
- [ ] RLS policies verified: cross-tenant query returns 0 rows
- [ ] Append-only triggers verified: UPDATE/DELETE on immutable tables raises error
- [ ] lot_balances view returns correct computed values
- [ ] JWKS endpoint returns valid keys from s2s_jwks_public_keys
- [ ] Reconciliation cursor can be created and updated
- [ ] PgBouncer transaction mode compatible (SET LOCAL, not SET)
- [ ] Application starts and passes health check after migrations

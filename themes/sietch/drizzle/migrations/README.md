# Postgres migrations — how these actually get applied

**`npm run db:migrate` does NOT apply most of the files in this directory.**

`db:migrate` is `drizzle-kit migrate`, and drizzle applies only what is listed
in `meta/_journal.json`. That journal has **one** entry — `0000_swift_sleeper` —
while this directory contains **23** SQL files (`0000`–`0021`). Everything from
`0001` onward is outside the automated migrator and has been applied
out-of-band; the commented example at `.github/workflows/deploy-staging.yml:67`
shows the shape of that path:

```
psql $DATABASE_URL -f drizzle/migrations/0005_eligibility_tables.sql
```

This is a pre-existing condition — the journal has been stale since `0001`, long
before the reconciliation work in `0019`–`0021`. It is recorded here because the
consequence is no longer cosmetic.

## Why it matters now

`0020` creates `pending_redis_credit_adjustments`, and the credit-lot mint writes
to it **inside the mint transaction** (`packages/services/nowpayments-handler.ts`,
`processPaymentForLedger`). If that table is missing, the insert fails and takes
the whole mint down with it — every purchase rolls back. `0020` also creates
`crypto_payment_checks`, which the reconciliation sweep joins on every arm.

So for these three migrations, "the journal is stale" degrades from a tidiness
problem to: **purchases fail closed until the SQL is applied.**

## What an operator must do

Apply `0019`, `0020` and `0021` before or with the deploy that carries them:

```
psql "$DATABASE_URL" -f drizzle/migrations/0019_reconciliation_index_all_nonterminal.sql
psql "$DATABASE_URL" -f drizzle/migrations/0020_reconciliation_fairness_and_redis_outbox.sql
psql "$DATABASE_URL" -f drizzle/migrations/0021_finished_webhook_recovery_index.sql
```

Then verify:

```sql
SELECT to_regclass('public.crypto_payment_checks'),
       to_regclass('public.pending_redis_credit_adjustments');
-- both must be non-NULL before the new mint path is serving traffic
```

All three are **idempotent** and safe to re-run: tables and indexes use
`IF NOT EXISTS`, replaced indexes are `DROP INDEX IF EXISTS` first, and every
`CREATE POLICY` in `0020` is preceded by `DROP POLICY IF EXISTS`. Re-applying
them cannot fail on "already exists" and cannot weaken RLS — the policies are
recreated identically.

## What was deliberately NOT done

The journal was **not** backfilled. Adding entries for `0019`–`0021` alone would
make `drizzle-kit migrate` run them against a database whose
`__drizzle_migrations` table claims it is still at `0000`, and backfilling
`0001`–`0018` as well would replay eighteen migrations against a database that
already has them. Neither is safe to decide without knowing what a given
environment has actually applied, and getting it wrong breaks a deploy rather
than a test.

Reconciling the journal with reality is an operator/infra task that should be
done deliberately, per environment, with the `__drizzle_migrations` table in
hand — not as a side effect of a payment-correctness PR.

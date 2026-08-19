#!/usr/bin/env bash
#
# verify-migration-path.sh — does the documented migration path actually build
# the schema the billing/reconciliation code queries?
#
# `drizzle-kit migrate` applies exactly the entries in
# drizzle/migrations/meta/_journal.json. It does NOT glob the migrations
# directory. When a hand-authored .sql file is added without a journal entry it
# is silently skipped — and `drizzle-kit migrate` still prints
# "migrations applied successfully!" and exits 0. That combination makes a
# missing table a runtime discovery instead of a deploy-time one.
#
# This script is the reproduction. Point it at a THROWAWAY database, run it, and
# it reports which of the relations the code requires the documented path
# actually creates.
#
#   DATABASE_URL=postgresql://user@localhost:5432/scratch \
#     scripts/verify-migration-path.sh
#
# Exit 0 = every required relation exists after `drizzle-kit migrate`.
# Exit 1 = at least one is missing (the path is incomplete).
#
# SAFETY: read-write against $DATABASE_URL. Never point this at production.

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

: "${DATABASE_URL:?ERROR: DATABASE_URL is required (use a throwaway database)}"

# Relations the changed billing/reconciliation code queries by name. Keep in
# sync with packages/services/{nowpayments-handler,reconciliation-sweep}.ts.
REQUIRED_RELATIONS=(
  credit_lots
  crypto_payments
  crypto_payment_checks
  pending_redis_credit_adjustments
)

echo "[verify-migration-path] journal entries vs migration files"
journal_tags="$(python3 -c '
import json
print("\n".join(e["tag"] for e in json.load(open("drizzle/migrations/meta/_journal.json"))["entries"]))
')"
file_tags="$(cd drizzle/migrations && ls *.sql 2>/dev/null | sed 's/\.sql$//' | sort)"

journal_count="$(printf '%s\n' "$journal_tags" | grep -c . || true)"
file_count="$(printf '%s\n' "$file_tags" | grep -c . || true)"
echo "  journal: ${journal_count}   files: ${file_count}"

unregistered="$(comm -13 <(printf '%s\n' "$journal_tags" | sort) <(printf '%s\n' "$file_tags"))"
if [ -n "$unregistered" ]; then
  echo "  UNREGISTERED (present on disk, absent from the journal — never applied):"
  printf '    %s\n' $unregistered
fi

echo "[verify-migration-path] running the documented path: drizzle-kit migrate"
# Do not let a migrate failure abort before the relation report — the report is
# the diagnostic, and a hard failure is itself a result worth showing.
migrate_status=0
npx drizzle-kit migrate 2>&1 | tail -20 || migrate_status=$?
echo "  drizzle-kit migrate exit: ${migrate_status}"

echo "[verify-migration-path] required relations after migrate"
missing=0
for rel in "${REQUIRED_RELATIONS[@]}"; do
  if psql "$DATABASE_URL" -tAc "SELECT to_regclass('public.${rel}') IS NOT NULL;" | grep -qx t; then
    echo "  present  ${rel}"
  else
    echo "  MISSING  ${rel}"
    missing=$((missing + 1))
  fi
done

if [ "$missing" -gt 0 ]; then
  echo "[verify-migration-path] FAIL: ${missing} required relation(s) missing."
  echo "  The documented path does not build the schema the code queries."
  exit 1
fi

echo "[verify-migration-path] OK: all ${#REQUIRED_RELATIONS[@]} required relations present."

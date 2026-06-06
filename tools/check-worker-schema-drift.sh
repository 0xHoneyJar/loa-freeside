#!/usr/bin/env bash
# check-worker-schema-drift.sh — make worker↔sietch Drizzle-schema drift LOUD.
#
# apps/worker/src/data/schema.ts holds verbatim COPIES of three Drizzle tables
# (communities, profiles, badges) that are canonically defined in
# themes/sietch/src/packages/adapters/storage/schema.ts. The worker needs its own
# table objects (its own drizzle instance), so the copy is intentional — but a column
# change in sietch silently NOT propagating to the worker copy was an unguarded drift
# risk (coherence finding F5 / arrakis-pcpc). This check fails CI when the shared table
# definitions diverge, so the drift can never again be silent.
#
# Scope: the 3 SHARED tables only. agentThreads is worker's own (no sietch Drizzle
# equivalent — only raw migrations 063/066), so it is NOT a drift target.
#
# This is a TEXT comparison, NOT an import — a worker test importing sietch's schema
# would be a platform->theme membrane reach-in. Comparing source text avoids that.
#
# The durable fix (extract a shared schema package consumed by both) is deferred to the
# worlds-api extraction cycle: the 3 tables are deeply FK-coupled into sietch's 21-table
# schema, so extraction belongs with that larger refactor. Until then, this guard holds.
#
# Exit 0 = in sync · Exit 1 = drift detected.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKER="$REPO_ROOT/apps/worker/src/data/schema.ts"
SIETCH="$REPO_ROOT/themes/sietch/src/packages/adapters/storage/schema.ts"
TABLES=(communities profiles badges)

for f in "$WORKER" "$SIETCH"; do
  [ -f "$f" ] || { echo "::error::check-worker-schema-drift: missing schema file: $f"; exit 1; }
done

# extract the `export const <name> = pgTable( ... );` block, then normalize:
# strip // line-comments, trim leading/trailing whitespace, drop blank lines.
extract_normalized() {
  local file="$1" name="$2"
  awk -v t="export const ${name} = pgTable(" '
    index($0, t) == 1 { inblk = 1 }
    inblk { print }
    inblk && /^\);/ { exit }
  ' "$file" \
    | sed -E 's://.*$::' \
    | sed -E 's/[[:space:]]+$//; s/^[[:space:]]+//' \
    | grep -v '^$'
}

drift=0
for t in "${TABLES[@]}"; do
  w="$(extract_normalized "$WORKER" "$t")"
  s="$(extract_normalized "$SIETCH" "$t")"
  if [ -z "$w" ]; then echo "::error::table '$t' not found in worker schema ($WORKER)"; drift=1; continue; fi
  if [ -z "$s" ]; then echo "::error::table '$t' not found in sietch schema ($SIETCH)"; drift=1; continue; fi
  if [ "$w" != "$s" ]; then
    echo "::error::SCHEMA DRIFT — table '$t' differs between worker copy and sietch canonical:"
    diff <(printf '%s\n' "$s") <(printf '%s\n' "$w") | sed 's/^/    /' || true
    echo "    → reconcile apps/worker/src/data/schema.ts ($t) with themes/sietch/.../storage/schema.ts, or extract the shared schema package (arrakis-pcpc)."
    drift=1
  else
    echo "  ✓ $t in sync (worker copy matches sietch canonical)"
  fi
done

if [ "$drift" -ne 0 ]; then
  echo "::error::worker↔sietch Drizzle schema has drifted. The worker copy must mirror the sietch canonical."
  exit 1
fi
echo "✓ worker↔sietch schema in sync across: ${TABLES[*]}"

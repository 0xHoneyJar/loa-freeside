#!/usr/bin/env bash
# =============================================================================
# packages/events/scripts/new-schema.test.sh
#
# BB F3: prove the events:new-schema generator is idempotent across MULTIPLE
# invocations — a generator's correctness is measured on run N, not run 1. The
# old literal topics-import replace stopped matching after the first generation
# (the import line gained a second name) → silent no-op → broken registry.ts.
#
# Generates two throwaway families, asserts the package still COMPILES, then
# reverts every generator edit. MUST run on a clean tree (it restores the three
# wired files to HEAD); CI runs it after checkout.
# =============================================================================
set -uo pipefail

PKG="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PKG" || exit 2
GEN="scripts/new-schema.mjs"

cleanup() {
  git restore --source=HEAD src/registry.ts src/index.ts src/topics.ts 2>/dev/null || true
  rm -f src/schemas/bb-f3-one.ts src/schemas/bb-f3-two.ts
}
trap cleanup EXIT

node "$GEN" bb-f3-one --aggregate bb --noun fthree --verb one --version 1 >/dev/null 2>&1 \
  || { echo "FAIL: first generation errored"; exit 1; }
node "$GEN" bb-f3-two --aggregate bb --noun fthree --verb two --version 1 >/dev/null 2>&1 \
  || { echo "FAIL: SECOND generation errored (the F3 regression)"; exit 1; }

if npx tsc -b >/tmp/new-schema-f3-tsc.out 2>&1; then
  echo "PASS: generator twice → package compiles (F3 idempotent across runs)"
  exit 0
fi
echo "FAIL: package does not compile after two generations"
grep -vE 'ExperimentalWarning|trace-warnings|loading ES Module|experimental' /tmp/new-schema-f3-tsc.out | tail -12
exit 1

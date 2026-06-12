#!/usr/bin/env bats
# Asson cycle-1 acceptance fixtures (sprint Task 1.6). Each names its PRD goal.

ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
PKG="$ROOT/packages/asson"
HANDOFF="$ROOT/grimoires/loa/handoffs"

# (a) G-1 — the demo runs the full lifecycle clean
@test "G-1 (a): asson demo exits 0 (lifecycle + 3 attacks + liveness + fork window)" {
  run node "$PKG/src/demo.mjs"
  [ "$status" -eq 0 ]
}

# (b) all node:test suites green (conformance, schema, attacks)
@test "G-1/G-2/G-3 (b): node:test suites green (43 tests)" {
  run bash -c "cd '$PKG' && node --test test/*.test.mjs"
  [ "$status" -eq 0 ]
}

# (b2) package identity + vendored-from integrity stamp present
@test "G-1 (b2): package is @freeside/asson with a .vendored-from integrity stamp" {
  run jq -r '.name' "$PKG/package.json"
  [ "$output" = "@freeside/asson" ]
  [ -f "$PKG/.vendored-from" ]
}

# (b3) canon is vendored with a Legba SHA pin (B3 propagation tripwire)
@test "AS-10 (b3): vendored canon pins the legba-core source SHA" {
  run grep -c "legba-core.mjs" "$PKG/src/vendor/canon.mjs"
  [ "$status" -eq 0 ]
  grep -qE "959c782|re-vendor when legba-core" "$PKG/src/vendor/canon.mjs"
}

# (c) the hounfour handoff exists + validates via the L6 lib (content-addressed)
@test "G-2 (c): hounfour veve-schema handoff authored + TypeBox + constraints + vectors present" {
  [ -f "$HANDOFF/2026-06-11-asson-veve-schema.md" ]
  [ -f "$HANDOFF/asson-hounfour-src/veve.ts" ]
  [ -f "$HANDOFF/asson-hounfour-src/constraints/Veve.constraints.json" ]
  run bash -c "ls $HANDOFF/asson-hounfour-src/vectors/Veve/valid/*.json $HANDOFF/asson-hounfour-src/vectors/Veve/invalid/*.json | wc -l | tr -d ' '"
  [ "$output" -ge 6 ]
}

# (d) SCOPE GUARD — concrete denylist (B4): NO cycle-3-5 artifacts exist
@test "scope guard (d): cycle-3 fence advanced — the key ceremony now exists (was: absent)" {
  # RETIRED: cycle-3 legitimately created scripts/ci-key-ceremony.mjs; the fence moved
  # forward to tests/asson/cycle3-fixtures.bats (which denylists cycles 4-5).
  [ -f "$PKG/scripts/ci-key-ceremony.mjs" ]
}
@test "scope guard (d): no cycle-4 watchdog wired into a live settings.json" {
  run bash -c "grep -rl 'livenessVerdict' $ROOT/.claude/settings.json $ROOT/.claude/hooks 2>/dev/null | wc -l | tr -d ' '"
  [ "$output" = "0" ]
}
@test "scope guard (d): no cycle-5 lexicon-lint comms-gate hook registration" {
  run bash -c "grep -rl 'lexicon-lint' $ROOT/.claude/settings.json $ROOT/.claude/hooks 2>/dev/null | wc -l | tr -d ' '"
  [ "$output" = "0" ]
}

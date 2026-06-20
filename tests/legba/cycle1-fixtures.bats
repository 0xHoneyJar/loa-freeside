#!/usr/bin/env bats
# Legba cycle-1 acceptance fixtures (sprint Task 1.5).
# Each test names the PRD goal it gates (G-1 schemas / G-2 maps). Hermetic:
# fixture (c) reads the CHECKED-IN corpus, never the live registry (B6).

ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
HANDOFF="$ROOT/grimoires/loa/handoffs"

# (a) G-2 — rung-0 gradient baseline captured fresh, valid_run, not the playtest run
@test "G-2 (a): rung-0 baseline json is fresh, valid_run, run_id != ptt-20260611" {
  run jq -e '.run_verdict == "valid_run" and .steps >= 1 and (.run_id_used != "ptt-20260611")' \
    "$ROOT/grimoires/loa/context/legba-rung0-baseline.json"
  [ "$status" -eq 0 ]
}

# (b) G-1 — hounfour handoff present + per-class vector floors (one fixture per defect class)
@test "G-1 (b): hounfour schema handoff + 3 schemas + 3 constraint files present" {
  [ -f "$HANDOFF/2026-06-11-legba-cycle1-hounfour-schemas.md" ]
  for s in legba-span-move legba-gate-token legba-run-receipt; do
    [ -f "$HANDOFF/hounfour-src/$s.ts" ]
  done
  for c in SpanMove GateToken RunReceipt; do
    [ -f "$HANDOFF/hounfour-src/constraints/$c.constraints.json" ]
  done
}

@test "G-1 (b): every named defect class has an invalid vector fixture" {
  local v="$HANDOFF/hounfour-src/vectors"
  [ -f "$v/SpanMove/invalid/record-hash-mismatch-post-edit.json" ]   # post-emit edit
  [ -f "$v/SpanMove/invalid/seq-gap.json" ]                          # seq gap
  [ -f "$v/SpanMove/invalid/re-executable-missing-env-fingerprint.json" ]
  [ -f "$v/GateToken/invalid/forged-signature-shape.json" ]          # forged envelope
  [ -f "$v/GateToken/invalid/replayed-wrong-run-id.json" ]           # replayed token
  [ -f "$v/GateToken/invalid/predictable-replay-seed.json" ]         # B2
  [ -f "$v/GateToken/invalid/serial-turnstile-regression.json" ]     # IMP-002
  [ -f "$v/RunReceipt/invalid/mutated-key-set.json" ]                # IMP-003
  [ -f "$v/RunReceipt/invalid/wrong-genesis-anchor.json" ]           # IMP-012
}

@test "G-1 (b): vector fixtures are valid JSON with real (recomputable) hashes" {
  # the valid SpanMove genesis fixture's record_hash must match its own JCS body
  run python3 - "$HANDOFF/hounfour-src/vectors/SpanMove/valid/attestable-emission-genesis.json" <<'PY'
import json, hashlib, sys
v = json.load(open(sys.argv[1]))["vector"]
body = {k: val for k, val in v.items() if k != "record_hash"}
canon = json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
assert hashlib.sha256(canon).hexdigest() == v["record_hash"], "record_hash mismatch"
print("ok")
PY
  [ "$status" -eq 0 ]
}

# (c) G-2 — ghost-door census reproduced from the HERMETIC checked-in corpus
@test "G-2 (c): ghost-door lint reproduces census from checked-in corpus (hermetic)" {
  [ -d "$ROOT/tests/legba/fixtures/ghost-corpus" ]
  run python3 "$HANDOFF/check-ghost-refs-adapters.py" \
    --compositions-dir "$ROOT/tests/legba/fixtures/ghost-corpus" \
    --adapters-dir "$HOME/.claude/agents" --json
  # exit 1 = unmarked ghosts found (expected for this corpus)
  [ "$status" -eq 1 ]
  echo "$output" | jq -e '.unrunnable >= 9' >/dev/null
}

# (d) G-2 — both named-defect patches apply clean against the source repo
@test "G-2 (d): verify-run + SKILL patches apply clean to construct-rooms-substrate" {
  local crs="$HOME/Documents/GitHub/construct-rooms-substrate"
  [ -d "$crs/.git" ] || skip "construct-rooms-substrate not cloned at expected path"
  for p in crs-verify-run-line58-exit-code-doc crs-skill-registry-count; do
    run git -C "$crs" apply --check "$HANDOFF/patches/$p.patch"
    [ "$status" -eq 0 ]
  done
}

# (e) Review records present in PRD/SDD/sprint
@test "G-1/G-2 (e): PRD, SDD, sprint each carry a Flatline review record" {
  grep -q "Review Record" "$ROOT/grimoires/loa/prd.md"
  grep -q "Review Record" "$ROOT/grimoires/loa/sdd.md"
  grep -q "Review Record" "$ROOT/grimoires/loa/sprint.md"
}

# (f) SCOPE GUARD (IMP-002) — no rung-2..5 implementation leaked into cycle 1
@test "G-1/G-2 (f): no recorder/gatekeeper/turnstile implementation files exist (rung-creep guard)" {
  # cycle 1 is schemas + maps ONLY. These would be later-rung code.
  run bash -c "ls $ROOT/scripts/legba-record.sh $ROOT/scripts/legba-gate.sh $ROOT/scripts/legba-turnstile.sh 2>/dev/null | wc -l | tr -d ' '"
  [ "$output" = "0" ]
  # the only legba script this cycle is the baseline measurer
  [ -f "$ROOT/scripts/legba-baseline.sh" ]
}

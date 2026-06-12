#!/usr/bin/env bats
# Asson cycle-4 acceptance: the liveness watchdog over Legba span logs.
# 4 verdicts reproduce (stall→reap, spin→compact, budget→checkpoint, pace→alert),
# each citing the liveness property. The SubagentStop hook wiring is System Zone
# (operator-gated handoff), NOT wired here — so the cycle-4 scope-guard stays green.

ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
CLI="$ROOT/packages/freeside-cli"
FIX="$ROOT/tests/asson/fixtures/watchdog"
NOW="$(cat "$FIX/NOW_MS")"

wd() { (cd "$CLI" && npx tsx bin/freeside-cli.ts asson watchdog "$@" 2>/dev/null); }

@test "(a) watchdog STALL → action reap, exit 1 (intervention)" {
  run wd "$FIX/stall.jsonl" --now "$NOW"
  [ "$status" -eq 1 ]
  echo "$output" | grep -q "action: reap"
}

@test "(b) watchdog SPIN → action compact_then_present, exit 1" {
  run wd "$FIX/spin.jsonl" --now "$NOW"
  [ "$status" -eq 1 ]
  echo "$output" | grep -q "action: compact_then_present"
}

@test "(c) watchdog BUDGET exhausted → action checkpoint_and_present, exit 1" {
  run wd "$FIX/exhausted.jsonl" --now "$NOW"
  [ "$status" -eq 1 ]
  echo "$output" | grep -q "action: checkpoint_and_present"
}

@test "(d) watchdog PACE → action pace_alert, exit 3 (warn-tier)" {
  run wd "$FIX/pace.jsonl" --now "$NOW" --p95 5
  [ "$status" -eq 3 ]
  echo "$output" | grep -q "action: pace_alert"
}

@test "(e) watchdog healthy log → action continue, exit 0" {
  tmp="$(mktemp -d)/log.jsonl"
  # one recent move, low budget → no intervention
  node --input-type=module -e "
    import { writeFileSync } from 'node:fs';
    const NOW = $NOW;
    const m = { record: { ts: new Date(NOW - 1000).toISOString(), kind: 'tool_call', tool: 'a', input_hash: 'z' }, record_hash: 'sha256:0001' };
    writeFileSync('$tmp', JSON.stringify(m) + '\n');
  "
  run wd "$tmp" --now "$NOW"
  [ "$status" -eq 0 ]
  echo "$output" | grep -q "action: continue"
}

@test "(f) watchdog malformed JSONL → clean Error, exit 1 (no stack trace)" {
  tmp="$(mktemp -d)/bad.jsonl"; printf '%s' '{ not json' > "$tmp"
  # capture stderr (the error goes there) — the wd() helper drops it
  run bash -c "cd '$CLI' && npx tsx bin/freeside-cli.ts asson watchdog '$tmp' --now '$NOW' 2>&1"
  [ "$status" -eq 1 ]
  echo "$output" | grep -q "not valid JSONL"
  ! echo "$output" | grep -q "node:internal/"
}

# scope guard — NONE of cycle-5 exists (lexicon comms-gate hook); watchdog NOT in .claude/
@test "scope guard (g): no cycle-5 lexicon-lint comms-gate hook" {
  run bash -c "grep -rl 'lexicon-lint' $ROOT/.claude/settings.json $ROOT/.claude/hooks 2>/dev/null | wc -l | tr -d ' '"
  [ "$output" = "0" ]
}
@test "scope guard (g): watchdog is a verb, NOT wired into System Zone (.claude/)" {
  run bash -c "grep -rl 'asson watchdog\|livenessVerdict' $ROOT/.claude/settings.json $ROOT/.claude/hooks 2>/dev/null | wc -l | tr -d ' '"
  [ "$output" = "0" ]
}

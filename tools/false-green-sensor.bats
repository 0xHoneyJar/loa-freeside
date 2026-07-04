#!/usr/bin/env bats
# tools/false-green-sensor.bats — S3-T2 (SDD §4.4/§6.1, NFR-3/IMP-009).
# Hermetic: FALSEGREEN_* seams supply the state files + commit count. No live git/.run.
# Every degraded input must resolve to `insufficient` (exit 1) — NEVER a false pass.

setup() {
  ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
  SENSOR="$ROOT/tools/false-green-sensor.sh"
  B="$BATS_TEST_TMPDIR/bridge.json"; S="$BATS_TEST_TMPDIR/sprint.json"
}

@test "replay 2026-07-03 no-op (well-formed JACKED_OUT + 0/0/0) -> suspect (exit 2)" {
  printf '%s' '{"bridge_id":"b1","state":"JACKED_OUT","iterations":[{"bridgebuilder":{"total_findings":0}}]}' > "$B"
  printf '%s' '{"sprints":{"completed":0}}' > "$S"
  run env FALSEGREEN_BRIDGE_STATE="$B" FALSEGREEN_SPRINT_STATE="$S" FALSEGREEN_COMMIT_COUNT_CMD='echo 0' "$SENSOR" --json
  [ "$status" -eq 2 ]
  echo "$output" | jq -e '.verdict == "suspect" and .exit_code == 2'
}

@test "genuine completion: >=1 commit -> pass (exit 0)" {
  printf '%s' '{"bridge_id":"b1","state":"JACKED_OUT","iterations":[{"bridgebuilder":{"total_findings":0}}]}' > "$B"
  printf '%s' '{"sprints":{"completed":0}}' > "$S"
  run env FALSEGREEN_BRIDGE_STATE="$B" FALSEGREEN_SPRINT_STATE="$S" FALSEGREEN_COMMIT_COUNT_CMD='echo 5' "$SENSOR" --json
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.verdict == "pass"'
}

@test "genuine completion: >=1 sprint -> pass (exit 0)" {
  printf '%s' '{"bridge_id":"b1","state":"JACKED_OUT","iterations":[{"bridgebuilder":{"total_findings":0}}]}' > "$B"
  printf '%s' '{"sprints":{"completed":2}}' > "$S"
  run env FALSEGREEN_BRIDGE_STATE="$B" FALSEGREEN_SPRINT_STATE="$S" FALSEGREEN_COMMIT_COUNT_CMD='echo 0' "$SENSOR" --json
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.verdict == "pass"'
}

@test "ABSENT bridge-state -> insufficient (exit 1), never a false pass" {
  printf '%s' '{"sprints":{"completed":0}}' > "$S"
  run env FALSEGREEN_BRIDGE_STATE="$BATS_TEST_TMPDIR/nope.json" FALSEGREEN_SPRINT_STATE="$S" "$SENSOR" --json
  [ "$status" -eq 1 ]
  echo "$output" | jq -e '.verdict == "insufficient"'
}

@test "PARTIAL bridge-state (missing .state key) -> insufficient (exit 1)" {
  printf '%s' '{"bridge_id":"b4"}' > "$B"
  printf '%s' '{"sprints":{"completed":0}}' > "$S"
  run env FALSEGREEN_BRIDGE_STATE="$B" FALSEGREEN_SPRINT_STATE="$S" FALSEGREEN_COMMIT_COUNT_CMD='echo 0' "$SENSOR" --json
  [ "$status" -eq 1 ]
  echo "$output" | jq -e '.verdict == "insufficient"'
}

@test "PARTIAL bridge-state (missing findings counter) -> insufficient (missing != 0)" {
  printf '%s' '{"bridge_id":"b5","state":"JACKED_OUT","iterations":[{"bridgebuilder":{}}]}' > "$B"
  printf '%s' '{"sprints":{"completed":0}}' > "$S"
  run env FALSEGREEN_BRIDGE_STATE="$B" FALSEGREEN_SPRINT_STATE="$S" FALSEGREEN_COMMIT_COUNT_CMD='echo 0' "$SENSOR" --json
  [ "$status" -eq 1 ]
  echo "$output" | jq -e '.verdict == "insufficient"'
}

@test "PARTIAL sprint-state (missing .sprints.completed) -> insufficient (exit 1)" {
  printf '%s' '{"bridge_id":"b6","state":"JACKED_OUT","iterations":[{"bridgebuilder":{"total_findings":0}}]}' > "$B"
  printf '%s' '{"sprints":{}}' > "$S"
  run env FALSEGREEN_BRIDGE_STATE="$B" FALSEGREEN_SPRINT_STATE="$S" FALSEGREEN_COMMIT_COUNT_CMD='echo 0' "$SENSOR" --json
  [ "$status" -eq 1 ]
  echo "$output" | jq -e '.verdict == "insufficient"'
}

@test "MALFORMED bridge-state (invalid JSON) -> insufficient (exit 1), never executed" {
  printf '%s' '{not json' > "$B"
  printf '%s' '{"sprints":{"completed":0}}' > "$S"
  run env FALSEGREEN_BRIDGE_STATE="$B" FALSEGREEN_SPRINT_STATE="$S" "$SENSOR" --json
  [ "$status" -eq 1 ]
  echo "$output" | jq -e '.verdict == "insufficient"'
}

@test "non-terminal (RUNNING) -> nothing to assert (exit 0)" {
  printf '%s' '{"bridge_id":"b3","state":"RUNNING"}' > "$B"
  printf '%s' '{"sprints":{"completed":0}}' > "$S"
  run env FALSEGREEN_BRIDGE_STATE="$B" FALSEGREEN_SPRINT_STATE="$S" "$SENSOR" --json
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.verdict == "pass"'
}

@test "--json record conforms to immune-verdict.schema.json (NFR-7)" {
  printf '%s' '{"bridge_id":"b1","state":"JACKED_OUT","iterations":[{"bridgebuilder":{"total_findings":0}}]}' > "$B"
  printf '%s' '{"sprints":{"completed":0}}' > "$S"
  run env FALSEGREEN_BRIDGE_STATE="$B" FALSEGREEN_SPRINT_STATE="$S" FALSEGREEN_COMMIT_COUNT_CMD='echo 0' "$SENSOR" --json
  [ "$status" -eq 2 ]
  echo "$output" | node "$ROOT/tools/validate-immune-verdict.mjs"
}

# immune-lint:allow — bats test fixture for false-green-sensor.sh, not an instrument itself.

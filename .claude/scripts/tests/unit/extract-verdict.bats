#!/usr/bin/env bats
# extract-verdict.bats — Unit tests for extract_verdict() (FR-1)
# Run: bats .claude/scripts/tests/unit/extract-verdict.bats
#
# Covers:
#   T2.4: .verdict present, .overall_verdict present, both present (.verdict wins),
#          neither (exit 1), null verdict (exit 1)

SCRIPT_DIR="$(cd "$(dirname "$BATS_TEST_DIRNAME")/.." && pwd)"

setup() {
  source "$SCRIPT_DIR/lib/normalize-json.sh"
}

# =============================================================================
# Core extraction tests
# =============================================================================

@test "extract_verdict: returns .verdict when present" {
  local json='{"verdict":"APPROVED","summary":"all good"}'
  run extract_verdict "$json"
  [ "$status" -eq 0 ]
  [ "$output" = "APPROVED" ]
}

@test "extract_verdict: returns .overall_verdict when .verdict absent" {
  local json='{"overall_verdict":"CHANGES_REQUIRED","summary":"needs work"}'
  run extract_verdict "$json"
  [ "$status" -eq 0 ]
  [ "$output" = "CHANGES_REQUIRED" ]
}

@test "extract_verdict: .verdict takes priority over .overall_verdict" {
  local json='{"verdict":"APPROVED","overall_verdict":"CHANGES_REQUIRED"}'
  run extract_verdict "$json"
  [ "$status" -eq 0 ]
  [ "$output" = "APPROVED" ]
}

@test "extract_verdict: exits 1 when neither field present" {
  local json='{"summary":"no verdict here","findings":[]}'
  run extract_verdict "$json"
  [ "$status" -eq 1 ]
  [ -z "$output" ]
}

@test "extract_verdict: exits 1 when verdict is null" {
  local json='{"verdict":null,"summary":"null verdict"}'
  run extract_verdict "$json"
  [ "$status" -eq 1 ]
  [ -z "$output" ]
}

# =============================================================================
# Edge cases
# =============================================================================

@test "extract_verdict: exits 1 when overall_verdict is null" {
  local json='{"overall_verdict":null}'
  run extract_verdict "$json"
  [ "$status" -eq 1 ]
  [ -z "$output" ]
}

@test "extract_verdict: exits 1 for invalid JSON" {
  run extract_verdict "not json at all"
  [ "$status" -eq 1 ]
  [ -z "$output" ]
}

@test "extract_verdict: exits 1 for empty string" {
  run extract_verdict ""
  [ "$status" -eq 1 ]
}

@test "extract_verdict: handles DECISION_NEEDED verdict" {
  local json='{"verdict":"DECISION_NEEDED","summary":"unclear"}'
  run extract_verdict "$json"
  [ "$status" -eq 0 ]
  [ "$output" = "DECISION_NEEDED" ]
}

@test "extract_verdict: handles SKIPPED verdict" {
  local json='{"verdict":"SKIPPED","reason":"disabled"}'
  run extract_verdict "$json"
  [ "$status" -eq 0 ]
  [ "$output" = "SKIPPED" ]
}

@test "extract_verdict: reads from stdin when no argument" {
  run bash -c 'source "'"$SCRIPT_DIR"'/lib/normalize-json.sh" && echo '\''{"verdict":"APPROVED"}'\'' | extract_verdict'
  [ "$status" -eq 0 ]
  [ "$output" = "APPROVED" ]
}

@test "extract_verdict: .verdict empty string treated as absent" {
  local json='{"verdict":"","overall_verdict":"APPROVED"}'
  run extract_verdict "$json"
  [ "$status" -eq 0 ]
  [ "$output" = "APPROVED" ]
}

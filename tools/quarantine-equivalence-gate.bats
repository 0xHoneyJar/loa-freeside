#!/usr/bin/env bats
# =============================================================================
# tools/quarantine-equivalence-gate.bats — hermetic acceptance for S1-T7.
#
# Proves the objective quarantine gate (SDD §3.4, FR-1b, SKP-003, IMP-007):
#   (a) scoped set fully covers the suite's attributable files → ALLOWED  (exit 0)
#   (b) an uncovered_file NOT in accepted_risk               → BLOCKED  (exit 2)
#   (c) that same uncovered_file listed in accepted_risk      → ALLOWED  (exit 0)
#
# No live CI: temp fixture repo-root (with real files the globs expand against),
# a temp coverage map, and a temp scoped-file list. yq is the only external dep.
# =============================================================================

setup() {
  GATE="${BATS_TEST_DIRNAME}/quarantine-equivalence-gate.sh"
  TMP="$(mktemp -d)"
  REPO="$TMP/repo"
  # The two attributable test files the old suite would run for @freeside/adapters.
  mkdir -p "$REPO/packages/adapters/sub"
  : > "$REPO/packages/adapters/a.integration.test.ts"
  : > "$REPO/packages/adapters/sub/b.integration.test.ts"
}

teardown() {
  rm -rf "$TMP"
}

# Write a coverage map. $1 = accepted_risk YAML block (inline flow or []).
_write_map() {
  local accepted="$1"
  cat > "$TMP/map.yaml" <<YAML
suites:
  integration-tests:
    workflow: .github/workflows/ci.yml
    job: integration-tests
    status: candidate
    files_attributable_to:
      "@freeside/adapters":
        - packages/adapters/**/*.integration.test.ts
    accepted_risk: ${accepted}
    rollback_log: []
YAML
}

@test "(a) scoped set fully covers the suite's attributable files → quarantine ALLOWED (exit 0)" {
  _write_map "[]"
  cat > "$TMP/scoped.txt" <<'LIST'
packages/adapters/a.integration.test.ts
packages/adapters/sub/b.integration.test.ts
LIST

  run "$GATE" --suite integration-tests --package "@freeside/adapters" \
    --map "$TMP/map.yaml" --repo-root "$REPO" --scoped-files "$TMP/scoped.txt"

  [ "$status" -eq 0 ]
  [[ "$output" == *"quarantine ALLOWED"* ]]
  [[ "$output" == *"2 covered"* ]]
}

@test "(b) an uncovered_file not in accepted_risk → quarantine BLOCKED (exit 2)" {
  _write_map "[]"
  # scoped set is MISSING b.integration.test.ts → it is an un-waived uncovered_file
  cat > "$TMP/scoped.txt" <<'LIST'
packages/adapters/a.integration.test.ts
LIST

  run "$GATE" --suite integration-tests --package "@freeside/adapters" \
    --map "$TMP/map.yaml" --repo-root "$REPO" --scoped-files "$TMP/scoped.txt"

  [ "$status" -eq 2 ]
  [[ "$output" == *"quarantine BLOCKED"* ]]
  [[ "$output" == *"packages/adapters/sub/b.integration.test.ts"* ]]
}

@test "(c) the same uncovered_file listed in accepted_risk (with rationale) → quarantine ALLOWED (exit 0)" {
  _write_map '[{ file: "packages/adapters/sub/b.integration.test.ts", rationale: "flaky redis-dependent case; tracked separately" }]'
  # scoped set STILL missing b — but it is now an explicit accepted-risk waiver
  cat > "$TMP/scoped.txt" <<'LIST'
packages/adapters/a.integration.test.ts
LIST

  run "$GATE" --suite integration-tests --package "@freeside/adapters" \
    --map "$TMP/map.yaml" --repo-root "$REPO" --scoped-files "$TMP/scoped.txt"

  [ "$status" -eq 0 ]
  [[ "$output" == *"quarantine ALLOWED"* ]]
  [[ "$output" == *"1 waived"* ]]
}

@test "--json emits a structured verdict object with uncovered_file[] (BLOCKED)" {
  _write_map "[]"
  cat > "$TMP/scoped.txt" <<'LIST'
packages/adapters/a.integration.test.ts
LIST

  run "$GATE" --suite integration-tests --package "@freeside/adapters" \
    --map "$TMP/map.yaml" --repo-root "$REPO" --scoped-files "$TMP/scoped.txt" --json

  [ "$status" -eq 2 ]
  [ "$(echo "$output" | jq -r '.verdict')" = "BLOCKED" ]
  [ "$(echo "$output" | jq -r '.exit')" = "2" ]
  [ "$(echo "$output" | jq -r '.uncovered_file[0]')" = "packages/adapters/sub/b.integration.test.ts" ]
}

@test "unknown suite cannot be proven → INSUFFICIENT (exit 1), never a false ALLOWED" {
  _write_map "[]"
  : > "$TMP/scoped.txt"

  run "$GATE" --suite does-not-exist --package "@freeside/adapters" \
    --map "$TMP/map.yaml" --repo-root "$REPO" --scoped-files "$TMP/scoped.txt"

  [ "$status" -eq 1 ]
  [[ "$output" == *"INSUFFICIENT"* ]]
}

@test "--record-rollback appends an escape and un-quarantines the suite" {
  _write_map "[]"
  # start it quarantined so the rollback flip is observable
  SUITE=integration-tests yq e -i '.suites[strenv(SUITE)].status = "quarantined"' "$TMP/map.yaml"

  run "$GATE" --record-rollback --suite integration-tests \
    --escape "escaped bug in adapters redis path" --map "$TMP/map.yaml"

  [ "$status" -eq 0 ]
  [[ "$output" == *"un-quarantined"* ]]
  [ "$(yq e '.suites.integration-tests.status' "$TMP/map.yaml")" = "candidate" ]
  [ "$(yq e '.suites.integration-tests.rollback_log[0].old_suite_would_have_caught' "$TMP/map.yaml")" = "true" ]
}

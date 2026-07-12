#!/usr/bin/env bats
# tools/flip-promote.bats — operator-run required-list migration (SDD §3.7/§5.4, FR-1d/FR-4/IMP-008).
# Hermetic: a fixture flip-ready ledger + a `gh` stub via FLIP_GH_PROBE_CMD. NO live gh, NO network.
# The stub emulates `gh api GET protection` (echo a fixture) and `gh api -X PUT protection`
# (capture the body). Branch protection is NEVER touched for real.

setup() {
  TOOLS_DIR="$BATS_TEST_DIRNAME"
  PROMOTE="$TOOLS_DIR/flip-promote.sh"
  LED="$BATS_TEST_TMPDIR/ledger.jsonl"
  GETF="$BATS_TEST_TMPDIR/get.json"
  PUTF="$BATS_TEST_TMPDIR/put.json"
  STUB="$BATS_TEST_TMPDIR/gh-stub.sh"

  # A flip-ready ledger for scope-checks: 9 clean + 1 seeded true-catch = full clean window.
  : > "$LED"
  local i; for ((i=0;i<9;i++)); do
    printf '{"ts":"t%s","sensor":"scope-checks","seeded":false,"outcome":"clean","adjudicated_by":"soju","pr":1}\n' "$i" >> "$LED"
  done
  printf '{"ts":"t9","sensor":"scope-checks","seeded":true,"outcome":"true-catch","adjudicated_by":"soju","pr":9}\n' >> "$LED"

  # GET fixture: main already requires ONE OTHER check + real review rules (the read-modify-write must
  # preserve them).
  cat > "$GETF" <<'GET'
{
  "required_status_checks": {"strict": true, "checks": [{"context": "Other Check", "app_id": null}]},
  "enforce_admins": {"enabled": true},
  "required_pull_request_reviews": {"dismiss_stale_reviews": false, "require_code_owner_reviews": true, "required_approving_review_count": 2},
  "restrictions": null,
  "required_linear_history": {"enabled": false}
}
GET

  # The gh stub.
  cat > "$STUB" <<'STUB'
#!/usr/bin/env bash
method="GET"; input=""
args=("$@")
for ((i=0;i<${#args[@]};i++)); do
  [[ "${args[$i]}" == "-X" ]] && method="${args[$((i+1))]}"
  [[ "${args[$i]}" == "--input" ]] && input="${args[$((i+1))]}"
done
if [[ "$method" == "GET" ]]; then
  cat "$FLIP_STUB_GET_FILE"
else
  if [[ -n "$input" && "$input" != "-" ]]; then cat "$input" > "$FLIP_STUB_PUT_FILE"; else cat > "$FLIP_STUB_PUT_FILE"; fi
  echo '{}'
fi
STUB
  chmod +x "$STUB"

  export FLIP_LEDGER="$LED"
  export FLIP_REPO="acme/widget"
  export FLIP_GH_PROBE_CMD="bash $STUB"
  export FLIP_STUB_GET_FILE="$GETF"
  export FLIP_STUB_PUT_FILE="$PUTF"
}

# ===== THE KEY ACCEPTANCE (IMP-001/IMP-008): PAT absent → exact command + missing scope + exit 1 =====
@test "PAT absent: prints the exact operator command + missing scope, exits 1, never succeeds" {
  run env -u LOA_ADMIN_PAT -u FLIP_PROMOTE_GH_TOKEN bash "$PROMOTE" scope-checks
  [ "$status" -eq 1 ]
  [[ "$output" == *"Administration: write"* ]]                                   # the missing scope
  [[ "$output" == *"LOA_ADMIN_PAT=<your-admin-write-pat> tools/flip-promote.sh scope-checks"* ]]  # exact command
  [[ "$output" == *"REFUSED"* ]]
  [[ "$output" != *"PROMOTED"* ]]   # never reports success
  [ ! -f "$PUTF" ]                  # never touched branch protection
}

# ===== PAT present + flip-ready → migration via read-modify-write =====
@test "PAT present + flip-ready: performs the migration (stubbed) and exits 0" {
  run env LOA_ADMIN_PAT=fake-admin-pat bash "$PROMOTE" scope-checks
  [ "$status" -eq 0 ]
  [[ "$output" == *"PROMOTED to blocking"* ]]
  [ -f "$PUTF" ]
  # read-modify-write: our check ADDED, the pre-existing check PRESERVED (not clobbered)
  run jq -e '.required_status_checks.checks | map(.context) | index("scope-checks")' "$PUTF"
  [ "$status" -eq 0 ]
  run jq -e '.required_status_checks.checks | map(.context) | index("Other Check")' "$PUTF"
  [ "$status" -eq 0 ]
  # other protection settings survive the full-replace PUT
  run jq -e '.enforce_admins == true and .required_pull_request_reviews.required_approving_review_count == 2' "$PUTF"
  [ "$status" -eq 0 ]
  # audit: a promote event was appended to the ledger
  run bash -c "tail -1 '$LED' | jq -e '.event==\"promote\" and .blocking==true'"
  [ "$status" -eq 0 ]
}

# ===== --remove rollback: blocking → flip-ready =====
@test "--remove: rolls a blocking check out of the required-list (exit 0)" {
  # promote first so the sensor is 'blocking'
  printf '{"ts":"tp","sensor":"scope-checks","event":"promote","blocking":true,"adjudicated_by":"soju","pr":null}\n' >> "$LED"
  # GET fixture where our check is already required, so removal is observable
  jq '.required_status_checks.checks += [{"context":"scope-checks","app_id":null}]' "$GETF" > "$GETF.2"
  export FLIP_STUB_GET_FILE="$GETF.2"
  run env LOA_ADMIN_PAT=fake-admin-pat bash "$PROMOTE" scope-checks --remove
  [ "$status" -eq 0 ]
  [[ "$output" == *"ROLLED BACK"* ]]
  # our check removed, the other check preserved
  run jq -e '.required_status_checks.checks | map(.context) | index("scope-checks") == null' "$PUTF"
  [ "$status" -eq 0 ]
  run jq -e '.required_status_checks.checks | map(.context) | index("Other Check")' "$PUTF"
  [ "$status" -eq 0 ]
  run bash -c "tail -1 '$LED' | jq -e '.event==\"remove\" and .blocking==false'"
  [ "$status" -eq 0 ]
}

# ===== refuse to promote a sensor that has not earned it =====
@test "REFUSED: promoting a calibrating sensor (no seeded qualifier) never calls the API" {
  : > "$LED"   # empty ledger -> calibrating
  run env LOA_ADMIN_PAT=fake-admin-pat bash "$PROMOTE" scope-checks
  [ "$status" -eq 1 ]
  [[ "$output" == *"REFUSED"* ]]
  [[ "$output" == *"not 'flip-ready'"* ]]
  [ ! -f "$PUTF" ]   # precondition failed before any API call
}

# ===== --remove refuses when the sensor is not currently blocking =====
@test "REFUSED: --remove on a non-blocking sensor" {
  run env LOA_ADMIN_PAT=fake-admin-pat bash "$PROMOTE" scope-checks --remove
  [ "$status" -eq 1 ]
  [[ "$output" == *"REFUSED"* ]]
  [[ "$output" == *"not 'blocking'"* ]]
}

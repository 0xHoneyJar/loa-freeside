#!/usr/bin/env bats
# tools/s1-acceptance.bats — S1 "Trustworthy Green" settle-gate acceptance (S1-T9).
#
# SDD §6.1 FR-1 rows are each covered by a per-sensor suite (verified green):
#   FR-1a scoped-run / peer+dev-dep in-scope / fallback-to-full / caught-in-X-not-Y
#         → tools/scope-classify.bats (11) + tools/scope-checks-sensor.bats (6)
#   FR-1b coverage-diff equivalence (uncovered_file==[] or accepted-risk)
#         → tools/quarantine-equivalence-gate.bats (6)
#   FR-1c cluster-compliance no jq crash on in-monolith events-api
#         → .github/scripts/audit-cluster-cells.test.sh (9)
#   FR-1d flip-promote PAT-absent → exact command + exit 1
#         → tools/flip-promote.bats (5)
#   FR-4  flip state machine (calibrating/flip-ready/blocking, rolling last-10)
#         → tools/flip-report.bats (10)
#
# This suite adds the two things no single per-sensor suite proves:
#   (1) the G-4 END-TO-END flip chain on ONE seeded ledger:
#       seeded true-catch qualifier → flip-report=flip-ready → flip-promote migrates → blocking;
#   (2) the settle-gate roll-up: the ground-truth lint passes (every S1 instrument grounded).

setup() {
  ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
  TOOLS="$ROOT/tools"
}

# ── G-4 end-to-end: the seeded qualifier drives a real flip-ready → blocking ──────────────
@test "G-4 e2e: seeded true-catch → flip-report=flip-ready → flip-promote migrates → blocking" {
  LED="$BATS_TEST_TMPDIR/ledger.jsonl"; : > "$LED"
  # A clean rolling last-10 window with exactly one SEEDED true-catch (the qualifier).
  for i in 0 1 2 3 4 5 6 7 8; do
    printf '{"ts":"t%s","sensor":"scope-checks","seeded":false,"outcome":"clean","adjudicated_by":"soju","pr":1}\n' "$i" >> "$LED"
  done
  printf '{"ts":"t9","sensor":"scope-checks","seeded":true,"outcome":"true-catch","adjudicated_by":"soju","pr":9}\n' >> "$LED"

  # 1. flip-report re-derives flip-ready from the ledger (exit 0).
  run env FLIP_LEDGER="$LED" bash "$TOOLS/flip-report.sh" --sensor scope-checks --json
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.sensors[0].state == "flip-ready"'

  # 2. flip-promote (stubbed gh, PAT present) performs the required-list migration.
  GETF="$BATS_TEST_TMPDIR/get.json"; PUTF="$BATS_TEST_TMPDIR/put.json"; STUB="$BATS_TEST_TMPDIR/gh.sh"
  cat > "$GETF" <<'GET'
{"required_status_checks":{"strict":true,"checks":[{"context":"Other Check","app_id":null}]},
 "enforce_admins":{"enabled":true},
 "required_pull_request_reviews":{"dismiss_stale_reviews":false,"require_code_owner_reviews":true,"required_approving_review_count":2},
 "restrictions":null,"required_linear_history":{"enabled":false}}
GET
  cat > "$STUB" <<'STUB'
#!/usr/bin/env bash
method="GET"; input=""; args=("$@")
for ((i=0;i<${#args[@]};i++)); do
  [[ "${args[$i]}" == "-X" ]] && method="${args[$((i+1))]}"
  [[ "${args[$i]}" == "--input" ]] && input="${args[$((i+1))]}"
done
if [[ "$method" == "GET" ]]; then cat "$FLIP_STUB_GET_FILE";
else { [[ -n "$input" && "$input" != "-" ]] && cat "$input" || cat; } > "$FLIP_STUB_PUT_FILE"; echo '{}'; fi
STUB
  chmod +x "$STUB"
  run env FLIP_LEDGER="$LED" FLIP_REPO="acme/widget" \
      FLIP_GH_PROBE_CMD="bash $STUB" FLIP_STUB_GET_FILE="$GETF" FLIP_STUB_PUT_FILE="$PUTF" \
      LOA_ADMIN_PAT="stub-pat" bash "$TOOLS/flip-promote.sh" scope-checks
  [ "$status" -eq 0 ]
  [[ "$output" == *"PROMOTED"* ]]
  # 3. the migration PUT preserved the pre-existing check AND added scope-checks (read-modify-write).
  [ -f "$PUTF" ]
  run jq -e '.required_status_checks.checks | map(.context) | (index("Other Check") != null) and (index("scope-checks") != null)' "$PUTF"
  [ "$status" -eq 0 ]
}

# ── settle-gate roll-up: every S1 instrument is registered + ground-bound ─────────────────
@test "settle-gate: ground-truth lint passes (all S1 instruments grounded)" {
  run bash "$TOOLS/check-instrument-ground-truth.sh" --quiet
  [ "$status" -eq 0 ]
}

# ── cross-sensor: scope-checks emits a schema-valid record in both pass and full modes ────
@test "scope-checks emits schema-valid records for pass AND full" {
  run bash -c "SCOPE_DIFF_CMD='printf \"packages/services/ordering/src/x.ts\n\"' '$TOOLS/scope-checks-sensor.sh' --json | node '$TOOLS/validate-immune-verdict.mjs'"
  [ "$status" -eq 0 ]
  run bash -c "SCOPE_DIFF_CMD='printf \"pnpm-lock.yaml\n\"' '$TOOLS/scope-checks-sensor.sh' --json | node '$TOOLS/validate-immune-verdict.mjs'"
  [ "$status" -eq 0 ]
}

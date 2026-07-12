#!/usr/bin/env bats
# tools/flip-report.bats — the flip state-machine over a rolling last-N window (SDD §3.2/§3.3, FR-4a-d).
# Hermetic: every case builds a temp fixture ledger and points flip-report at it via FLIP_LEDGER.
# No live gh, no network, no dependence on the git-tracked ledger's contents.

setup() {
  TOOLS_DIR="$BATS_TEST_DIRNAME"
  REPORT="$TOOLS_DIR/flip-report.sh"
  LED="$BATS_TEST_TMPDIR/ledger.jsonl"
  : > "$LED"
}

# --- fixture helpers -------------------------------------------------------
eval_entry() { # sensor seeded outcome
  printf '{"ts":"t%s","sensor":"%s","seeded":%s,"outcome":"%s","adjudicated_by":"soju","pr":1}\n' \
    "$RANDOM" "$1" "$2" "$3" >> "$LED"
}
n_clean() { # sensor N — append N clean evals
  local i; for ((i=0;i<$2;i++)); do eval_entry "$1" false clean; done
}
report_json() { FLIP_LEDGER="$LED" bash "$REPORT" --sensor "$1" --json; }
state_of()  { report_json "$1" | jq -r '.sensors[0].state'; }

# --- calibrating: window not yet full ------------------------------------
@test "calibrating: fewer than N=10 evals is a legitimate reported state (exit 1)" {
  n_clean scope-checks 4
  run bash -c "FLIP_LEDGER='$LED' bash '$REPORT' --sensor scope-checks"
  [ "$status" -eq 1 ]
  [[ "$output" == *"CALIBRATING"* ]]
  [[ "$output" == *"win 4/10"* ]]
}

# --- calibrating: full window but NO seeded qualifier --------------------
@test "calibrating: a full clean window with no seeded true-catch cannot flip" {
  n_clean scope-checks 10
  [ "$(state_of scope-checks)" = "calibrating" ]
  run bash -c "FLIP_LEDGER='$LED' bash '$REPORT' --sensor scope-checks --json"
  [ "$status" -eq 1 ]
}

# --- flip-ready: seeded true-catch + clean last-10 window ----------------
@test "flip-ready: >=1 seeded true-catch + clean last-10 window (exit 0)" {
  n_clean scope-checks 9
  eval_entry scope-checks true true-catch     # the seeded qualifier
  [ "$(state_of scope-checks)" = "flip-ready" ]
  run report_json scope-checks
  [ "$status" -eq 0 ]
  [ "$(echo "$output" | jq -r '.sensors[0].seeded_true_catch')" -ge 1 ]
  [ "$(echo "$output" | jq -r '.sensors[0].false_positive')" -eq 0 ]
  [ "$(echo "$output" | jq -r '.sensors[0].unadjudicated')" -eq 0 ]
}

# --- a false-positive in the window blocks promotion --------------------
@test "false-positive in window => NOT flip-ready (calibrating, not exit 0)" {
  n_clean scope-checks 8
  eval_entry scope-checks true true-catch      # even WITH a seeded true-catch...
  eval_entry scope-checks false false-positive # ...a false-positive keeps it out of flip-ready
  [ "$(state_of scope-checks)" != "flip-ready" ]
  [ "$(state_of scope-checks)" = "calibrating" ]
  run report_json scope-checks
  [ "$status" -ne 0 ]
}

# --- an unadjudicated entry blocks promotion ----------------------------
@test "unadjudicated entry in window => NOT flip-ready (exit 1)" {
  n_clean scope-checks 8
  eval_entry scope-checks true true-catch
  eval_entry scope-checks false unadjudicated  # a flag awaiting operator adjudication
  [ "$(state_of scope-checks)" = "calibrating" ]
  run report_json scope-checks
  [ "$status" -eq 1 ]
  [ "$(echo "$output" | jq -r '.sensors[0].unadjudicated')" -eq 1 ]
}

# --- false-positive-ridden window is a PROBLEM (exit 2) ------------------
@test "false-positive-ridden window (>=50%) => PROBLEM (exit 2)" {
  local i; for ((i=0;i<6;i++)); do eval_entry scope-checks false false-positive; done
  n_clean scope-checks 4
  run report_json scope-checks
  [ "$status" -eq 2 ]
  [ "$(echo "$output" | jq -r '.sensors[0].state')" = "calibrating" ]
}

# --- blocking: a promotion event flips the state ------------------------
@test "blocking: a promote event marks the sensor already-promoted (exit 0)" {
  n_clean scope-checks 9
  eval_entry scope-checks true true-catch
  printf '{"ts":"tX","sensor":"scope-checks","event":"promote","blocking":true,"adjudicated_by":"soju","pr":null}\n' >> "$LED"
  [ "$(state_of scope-checks)" = "blocking" ]
  run report_json scope-checks
  [ "$status" -eq 0 ]
}

# --- a --remove event returns to flip-ready -----------------------------
@test "a remove event rolls a blocking sensor back to flip-ready" {
  n_clean scope-checks 9
  eval_entry scope-checks true true-catch
  printf '{"ts":"tX","sensor":"scope-checks","event":"promote","blocking":true,"adjudicated_by":"soju","pr":null}\n' >> "$LED"
  printf '{"ts":"tY","sensor":"scope-checks","event":"remove","blocking":false,"adjudicated_by":"soju","pr":null}\n' >> "$LED"
  [ "$(state_of scope-checks)" = "flip-ready" ]
}

# --- comment lines in the ledger are skipped, empty ledger => insufficient
@test "empty / comment-only ledger => INSUFFICIENT (never a false HEALTHY)" {
  printf '# a comment line\n\n' > "$LED"
  run bash -c "FLIP_LEDGER='$LED' bash '$REPORT'"
  [ "$status" -eq 1 ]
  [[ "$output" == *"no sensor tracked"* ]]
}

# --- the git-tracked ledger ships empty (calibrating), never false-green -
@test "the shipped tools/flip-ledger.jsonl parses and is INSUFFICIENT (empty, honest)" {
  run bash -c "bash '$REPORT'"
  [ "$status" -eq 1 ]   # comments only -> no sensor tracked -> insufficient
}

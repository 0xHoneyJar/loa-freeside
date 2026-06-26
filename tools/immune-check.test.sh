#!/usr/bin/env bash
# =============================================================================
# tools/immune-check.test.sh — proves immune-check.sh aggregates the two doctors'
# verdicts + exit codes correctly. Fixture-driven: the doctor probes are stubbed
# via the IMMUNE_*_PROBE_CMD seam, so the test runs with NO live `gh` and NO audit
# log. The contract under test is the severity aggregation matrix:
#
#       gate \ instr   0(ok)        1(insuff)    2(problem)
#       0(ok)          0 HEALTHY    1 INSUFF     2 PROBLEM
#       1(insuff)      1 INSUFF     1 INSUFF     2 PROBLEM
#       2(problem)     2 PROBLEM    2 PROBLEM    2 PROBLEM
#
#   (problem dominates; else insufficient; else healthy.)
#
# Run: bash tools/immune-check.test.sh   (exit 0 = pass, 1 = fail; the verdict gates.)
# =============================================================================
set -uo pipefail

CHECK="$(cd "$(dirname "$0")" && pwd)/immune-check.sh"
fail=0

# run the script with stubbed probes that emit a tile and exit a chosen code.
# $1 = gate exit code, $2 = instrument exit code, $3 = lint exit code (default 0=clean).
# NOTE: the lint's exit convention is 0=clean / 1=violation / 2=arg-error — distinct from the
# doctors' 0/1/2 severity. immune-check.sh remaps it (1->PROBLEM, 2->INSUFFICIENT). The 3x3
# matrix below pins the two DOCTORS with the lint held clean (l=0), so the matrix is unchanged.
# echoes the script's combined exit code; captures the banner to /tmp/immune-check-smoke.out.
run() {
  local lrc="${3:-0}"
  IMMUNE_GATE_PROBE_CMD="printf 'STUB gate-tile g=%s\\n' '$1'; exit $1" \
  IMMUNE_INSTRUMENT_PROBE_CMD="printf 'STUB instr-tile i=%s\\n' '$2'; exit $2" \
  IMMUNE_LINT_PROBE_CMD="printf 'STUB lint-tile l=%s\\n' '$lrc'; exit $lrc" \
    bash "$CHECK" >/tmp/immune-check-smoke.out 2>&1
  echo $?
}

check() { # name expected-exit actual-exit
  if [[ "$2" == "$3" ]]; then
    echo "  ✓ $1 (exit $3)"
  else
    echo "  ✗ $1 — expected exit $2, got $3"; sed 's/^/      /' /tmp/immune-check-smoke.out; fail=1
  fi
}

# ── the 3x3 aggregation matrix (problem > insufficient > healthy) ────────────
check "(0,0) both clean        -> HEALTHY/0"     0 "$(run 0 0)"
check "(2,0) gate FROZEN        -> PROBLEM/2"     2 "$(run 2 0)"
check "(0,2) instrument LYING   -> PROBLEM/2"     2 "$(run 0 2)"
check "(2,2) both problem       -> PROBLEM/2"     2 "$(run 2 2)"
check "(1,0) gate insufficient  -> INSUFFICIENT/1" 1 "$(run 1 0)"
check "(0,1) instr insufficient -> INSUFFICIENT/1" 1 "$(run 0 1)"
check "(1,1) both insufficient  -> INSUFFICIENT/1" 1 "$(run 1 1)"
check "(2,1) problem beats insuf-> PROBLEM/2"     2 "$(run 2 1)"
check "(1,2) problem beats insuf-> PROBLEM/2"     2 "$(run 1 2)"

# ── an uncontracted exit code (crash / 127) must NOT read HEALTHY ─────────────
# the doctors contract 0/1/2; anything else is INSUFFICIENT, never a false green.
check "(127,0) crash code -> INSUFFICIENT/1 (not HEALTHY)" 1 "$(run 127 0)"
check "(0,3) uncontracted -> INSUFFICIENT/1 (not HEALTHY)"  1 "$(run 0 3)"
check "(2,127) problem still dominates a crash -> PROBLEM/2" 2 "$(run 2 127)"

# ── the ground-truth lint's INVERTED exit contract is remapped correctly ─────
# lint 1 = VIOLATION must drive PROBLEM (2); lint 2 = arg-error is INSUFFICIENT (1);
# lint 0 = clean is harmless. This is the remap that sev() must NOT be used for.
check "(0,0,lint=1) lint VIOLATION  -> PROBLEM/2"      2 "$(run 0 0 1)"
check "(0,0,lint=2) lint arg-error  -> INSUFFICIENT/1" 1 "$(run 0 0 2)"
check "(0,0,lint=0) lint clean       -> HEALTHY/0"     0 "$(run 0 0 0)"
check "(2,0,lint=0) lint clean doesn't mask a frozen gate -> PROBLEM/2" 2 "$(run 2 0 0)"

# ── banner surfaces ALL THREE tiles (not just the aggregate) ─────────────────
run 2 0 1 >/dev/null
if grep -q "STUB gate-tile g=2" /tmp/immune-check-smoke.out && \
   grep -q "STUB instr-tile i=0" /tmp/immune-check-smoke.out && \
   grep -q "STUB lint-tile l=1" /tmp/immune-check-smoke.out; then
  echo "  ✓ banner shows all three check tiles"
else
  echo "  ✗ banner is missing a check tile"; sed 's/^/      /' /tmp/immune-check-smoke.out; fail=1
fi
if grep -q "PROBLEM (exit 2)" /tmp/immune-check-smoke.out; then
  echo "  ✓ banner footer names the combined verdict"
else
  echo "  ✗ banner footer missing combined verdict"; fail=1
fi

# ── --json emits a single PARSEABLE object carrying both exits + the verdict ──
# A multiline tile (the error-path shape) must still encode to valid JSON — proving the jq
# encoder, not a hand-rolled escaper. We grep the PARSED values via jq -e, never the raw text.
JSON_OUT="$(IMMUNE_GATE_PROBE_CMD="printf 'line-one\\nline-two\\n'; exit 0" \
           IMMUNE_INSTRUMENT_PROBE_CMD="printf 'i\\n'; exit 2" \
           IMMUNE_LINT_PROBE_CMD="printf 'l\\n'; exit 0" \
           bash "$CHECK" --json 2>/dev/null)"; json_rc=$?
if echo "$JSON_OUT" | jq -e \
     '.verdict=="PROBLEM" and .exit==2
      and (.doctors[0].tile | contains("line-one") and contains("line-two"))
      and (.doctors[1].exit==2)
      and (.doctors[2].doctor=="ground-truth-lint" and .doctors[2].exit==0)' >/dev/null 2>&1 && [[ "$json_rc" == 2 ]]; then
  echo "  ✓ --json is parseable, carries all three exits+verdict, survives a multiline tile (rc=$json_rc)"
else
  echo "  ✗ --json contract failed (rc=$json_rc): $JSON_OUT"; fail=1
fi

echo ""
if [[ "$fail" -eq 0 ]]; then echo "PASS: all immune-check.sh aggregation assertions green"; else echo "FAIL: immune-check.sh aggregation"; fi
exit "$fail"

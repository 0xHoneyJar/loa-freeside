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

# run the script with stubbed doctor probes that emit a tile and exit a chosen code.
# $1 = gate exit code, $2 = instrument exit code -> echoes the script's combined exit code;
# captures the banner to /tmp/immune-check-smoke.out for tile assertions.
run() {
  IMMUNE_GATE_PROBE_CMD="printf 'STUB gate-tile g=%s\\n' '$1'; exit $1" \
  IMMUNE_INSTRUMENT_PROBE_CMD="printf 'STUB instr-tile i=%s\\n' '$2'; exit $2" \
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

# ── banner surfaces BOTH doctors' tiles (not just the aggregate) ─────────────
run 2 0 >/dev/null
if grep -q "STUB gate-tile g=2" /tmp/immune-check-smoke.out && \
   grep -q "STUB instr-tile i=0" /tmp/immune-check-smoke.out; then
  echo "  ✓ banner shows both doctor tiles"
else
  echo "  ✗ banner is missing a doctor tile"; sed 's/^/      /' /tmp/immune-check-smoke.out; fail=1
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
           bash "$CHECK" --json 2>/dev/null)"; json_rc=$?
if echo "$JSON_OUT" | jq -e \
     '.verdict=="PROBLEM" and .exit==2
      and (.doctors[0].tile | contains("line-one") and contains("line-two"))
      and (.doctors[1].exit==2)' >/dev/null 2>&1 && [[ "$json_rc" == 2 ]]; then
  echo "  ✓ --json is parseable, carries both exits+verdict, survives a multiline tile (rc=$json_rc)"
else
  echo "  ✗ --json contract failed (rc=$json_rc): $JSON_OUT"; fail=1
fi

echo ""
if [[ "$fail" -eq 0 ]]; then echo "PASS: all immune-check.sh aggregation assertions green"; else echo "FAIL: immune-check.sh aggregation"; fi
exit "$fail"

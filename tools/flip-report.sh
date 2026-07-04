#!/usr/bin/env bash
# =============================================================================
# tools/flip-report.sh — the anti-rot flip state machine (SDD §3.2/§3.3, FR-4a-d).
#
# Reads tools/flip-ledger.jsonl and computes, per sensor, a rolling-window state over the LAST
# N=10 evaluation entries, then prints a STATUS tile + emits a verdict whose EXIT CODE is the
# verdict (the estate-immune 0/1/2 convention, inherited verbatim from tools/immune-check.sh):
#
#   exit 0 = HEALTHY      — every tracked sensor is `flip-ready` or already `blocking`
#   exit 2 = PROBLEM      — >=1 sensor is false-positive-ridden (cries wolf more than it catches)
#   exit 1 = INSUFFICIENT — >=1 sensor is still `calibrating` (not enough evidence / unadjudicated
#                           flags / a recoverable false-positive) — never claimed HEALTHY.
#
# STATE MACHINE (SDD §3.3), per sensor over its last-N=10 evaluation window:
#   calibrating  — window < 10 (K/10), OR no seeded-qualifier true-catch yet, OR the window has a
#                  false-positive / an unadjudicated flag. A LEGITIMATE reported state, never silent
#                  limbo — it says exactly how far the sensor is from earning authority.
#   flip-ready   — window is full (>=10) AND has >=1 seeded:true + true-catch (the seeded qualifier,
#                  FR-4c) AND 0 false-positives AND 0 unadjudicated entries. Ready for the OPERATOR
#                  to promote (tools/flip-promote.sh) — promotion is NEVER automatic from CI.
#   blocking     — already promoted: the last promotion EVENT for the sensor has blocking:true
#                  (written by flip-promote.sh; --remove flips it back to flip-ready).
#
# WRITE MODEL: the ledger is appended only on main (single writer, R-9); adjudication provenance is
# git authorship (never self-adjudicated). This tool is READ-ONLY over the ledger.
#
# Exit code IS the verdict, per [[gate-output-never-piped]] — capture $? before any pipe; never
# `| tail`, never `|| true`, never `2>/dev/null` on the verdict path (NFR-4).
#
# Usage:
#   tools/flip-report.sh                 # banner: one tile per tracked sensor + combined verdict
#   tools/flip-report.sh --probe         # compact one-line STATUS tiles (banner row)
#   tools/flip-report.sh --json          # machine: {sensors:[...], verdict, exit} (needs jq)
#   tools/flip-report.sh --sensor <name> # restrict to one sensor (used by flip-promote preconditions)
#   tools/flip-report.sh --ledger <path> # override ledger path (fixture-driven tests)
#
# Test seam: FLIP_LEDGER overrides the ledger path; FLIP_WINDOW overrides N (default 10, test-only).
# =============================================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LEDGER="${FLIP_LEDGER:-$ROOT/tools/flip-ledger.jsonl}"
WINDOW="${FLIP_WINDOW:-10}"
JSON=0
PROBE=0
ONLY_SENSOR=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --json)     JSON=1; shift ;;
    --probe)    PROBE=1; shift ;;
    --sensor)   [[ $# -ge 2 ]] || { echo "flip-report: --sensor requires a name" >&2; exit 1; }; ONLY_SENSOR="$2"; shift 2 ;;
    --sensor=*) ONLY_SENSOR="${1#--sensor=}"; shift ;;
    --ledger)   [[ $# -ge 2 ]] || { echo "flip-report: --ledger requires a path" >&2; exit 1; }; LEDGER="$2"; shift 2 ;;
    --ledger=*) LEDGER="${1#--ledger=}"; shift ;;
    -h|--help)  sed -n '2,45p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    --*)        echo "flip-report: unknown flag '$1'" >&2; exit 1 ;;
    *)          echo "flip-report: unexpected argument '$1'" >&2; exit 1 ;;
  esac
done

command -v jq >/dev/null 2>&1 || { echo "flip-report: requires jq" >&2; exit 1; }

# Load ledger entries as a JSON array, skipping comment/blank/non-JSON lines. `fromjson?` swallows
# the parse error for a `#` comment line internally (no 2>/dev/null needed on the verdict path).
if [[ ! -f "$LEDGER" ]]; then
  echo "flip-report: ledger not found: $LEDGER" >&2
  exit 1
fi
ENTRIES="$(jq -R 'fromjson? // empty' "$LEDGER" | jq -s '.')"

# Determine the sensor set: the explicit --sensor, else every sensor that appears in an eval or
# promotion entry (sorted, stable).
if [[ -n "$ONLY_SENSOR" ]]; then
  SENSORS="$ONLY_SENSOR"
else
  SENSORS="$(printf '%s' "$ENTRIES" | jq -r '.[] | select(has("outcome") or has("event")) | .sensor' | sort -u)"
fi

# Compute one sensor's state object (pure jq over the loaded entries).
compute() { # $1=sensor -> compact JSON state object on stdout
  printf '%s' "$ENTRIES" | jq -c --arg s "$1" --argjson win "$WINDOW" '
    ([ .[] | select(.sensor==$s and has("outcome")) ]) as $evals
    | ($evals[(-$win):]) as $w
    | ([ .[] | select(.sensor==$s and has("event")) ] | last) as $lastEvent
    | {
        sensor: $s,
        window_n: ($w | length),
        total_evals: ($evals | length),
        window: $win,
        seeded_true_catch: ([ $w[] | select(.seeded==true and .outcome=="true-catch") ] | length),
        true_catch:        ([ $w[] | select(.outcome=="true-catch") ] | length),
        false_positive:    ([ $w[] | select(.outcome=="false-positive") ] | length),
        unadjudicated:     ([ $w[] | select(.outcome=="unadjudicated") ] | length),
        blocking:          ($lastEvent != null and ($lastEvent.blocking == true))
      }
    | . + { state: (
        if .blocking then "blocking"
        elif (.window_n >= $win and .seeded_true_catch >= 1 and .false_positive == 0 and .unadjudicated == 0)
          then "flip-ready"
        else "calibrating" end) }
    | . + { exit: (
        if (.state == "blocking" or .state == "flip-ready") then 0
        elif (.false_positive >= 2 and (2 * .false_positive) >= .window_n) then 2   # false-positive-ridden
        else 1 end) }   # calibrating: accumulating / unadjudicated / recoverable FP
  '
}

# A one-line tile for a sensor state object (read on stdin).
tile() { # reads state JSON on stdin -> tile line
  jq -r '
    ({blocking:"◆", "flip-ready":"⚑", calibrating:"·"}[.state]) as $sym
    | "  " + ($sym // "·") + " flip · " + .sensor + " · " + (.state|ascii_upcase)
      + " · win " + (.window_n|tostring) + "/" + (.window|tostring)
      + " · seededTC " + (.seeded_true_catch|tostring)
      + " · fp " + (.false_positive|tostring)
      + " · unadj " + (.unadjudicated|tostring)'
}

# Aggregate across sensors: collect state objects, track worst severity.
declare -a STATES=()
overall=0
have_any=0
while IFS= read -r s; do
  [[ -z "$s" ]] && continue
  have_any=1
  st="$(compute "$s")"
  STATES+=("$st")
  ex="$(printf '%s' "$st" | jq -r '.exit')"
  [[ "$ex" -gt "$overall" ]] && overall="$ex"
done <<< "$SENSORS"

# No sensor tracked yet (empty ledger, or --sensor names one with no entries) → INSUFFICIENT.
# "Green has two causes — clean, and never-ran; only an honest sensor distinguishes them."
if [[ "$have_any" -eq 0 ]]; then
  overall=1
fi

verdict() { case "$1" in 0) echo HEALTHY ;; 2) echo PROBLEM ;; *) echo INSUFFICIENT ;; esac; }
VERDICT="$(verdict "$overall")"

if [[ "$JSON" -eq 1 ]]; then
  # Build the sensors[] array; if a --sensor had no entries, still emit a calibrating stub so
  # callers (flip-promote) get a well-formed state, never an empty array they'd misread as ready.
  if [[ ${#STATES[@]} -eq 0 && -n "$ONLY_SENSOR" ]]; then
    STATES+=("$(jq -cn --arg s "$ONLY_SENSOR" --argjson win "$WINDOW" '{sensor:$s,window_n:0,total_evals:0,window:$win,seeded_true_catch:0,true_catch:0,false_positive:0,unadjudicated:0,blocking:false,state:"calibrating",exit:1}')")
  fi
  printf '%s\n' ${STATES[@]+"${STATES[@]}"} | jq -s \
    --arg verdict "$VERDICT" --argjson exit "$overall" \
    '{sensors: ., verdict:$verdict, exit:$exit}'
  exit "$overall"
fi

# Banner (default) or compact --probe tiles.
if [[ "$PROBE" -eq 0 ]]; then
  printf '  ╓─ flip-report · advisory-sensor promotion ledger · %s\n' "$(date -u +%Y-%m-%dT%H:%MZ)"
fi
if [[ "$have_any" -eq 0 ]]; then
  printf '  · flip · (no sensor tracked yet — ledger empty; every sensor is calibrating at 0/%s)\n' "$WINDOW"
else
  for st in ${STATES[@]+"${STATES[@]}"}; do
    printf '%s' "$st" | tile
  done
fi
if [[ "$PROBE" -eq 0 ]]; then
  sym=$([[ "$overall" -eq 0 ]] && echo "✓" || { [[ "$overall" -eq 1 ]] && echo "·" || echo "⚠"; })
  printf '  ╙─ %s VERDICT: %s (exit %d)\n' "$sym" "$VERDICT" "$overall"
fi

exit "$overall"

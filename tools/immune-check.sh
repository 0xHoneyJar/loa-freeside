#!/usr/bin/env bash
# =============================================================================
# tools/immune-check.sh — the LOCAL/BANNER teeth for the estate immune doctors.
#
# Runs the read-only immune doctors + the M0 ground-truth lint back-to-back and
# emits a one-line STATUS tile per check (banner-style, their own --probe tiles),
# then a single combined verdict + exit code so it can gate a local sweep or a banner row:
#
#   exit 0 = HEALTHY      — all checks clean (no frozen gate, no lying instrument, no ungrounded one)
#   exit 2 = PROBLEM      — >=1 check reports a real problem (door FROZEN / instrument LYING / lint VIOLATION)
#   exit 1 = INSUFFICIENT — >=1 check could not ground (no gh auth / no audit log / lint misconfig) AND none
#                           reported a problem. Never claims HEALTHY without evidence.
#
# The ground-truth lint is NOT on the doctors' 0/1/2 severity convention — its own exit contract is
# 0=clean / 1=violation / 2=arg-error, remapped below (violation→PROBLEM, arg-error→INSUFFICIENT).
#
# The checks split by where their ground-truth lives:
#   - gate-freeze-sensor.mjs   reads the live merge gate via `gh` (G-DOOR). CI-runnable —
#                              also wired as the informational .github/workflows/immune-doctors.yml.
#   - instrument-truth-sensor.mjs  reads LOCAL .run/model-invoke.jsonl (M0/G-IMMUNE). NOT
#                              CI-runnable (no audit log in CI) — this script is its only teeth.
#   - check-instrument-ground-truth.sh  the M0/G-IMMUNE enforcing lint: every immune instrument
#                              must register its ground source (tools/immune-instruments.yaml).
#                              CI-runnable (also wired informationally into immune-doctors.yml).
# This single entry is therefore the union: the one place that runs every check the banner
# should surface, including the local-only one CI can never see.
#
# Read-only: no check mutates anything (gh reads + file reads only). Exit code IS the verdict,
# per [[gate-output-never-piped]] — capture $? before any pipe; never `| tail`.
# Campaign: estate-immune (bead arrakis-estate-immune-epic-4xw6.1, M0/G-DOOR teeth).
#
# Usage:
#   tools/immune-check.sh                       # infer repo from cwd via gh; default audit log
#   tools/immune-check.sh <owner/repo>          # name the repo for the gate doctor
#   tools/immune-check.sh --log <path>          # point the instrument doctor at a specific log
#   tools/immune-check.sh --json                # machine: one JSON object {verdict, exit, doctors[]} (needs jq)
#
# Test seam (fixture-driven, no live deps): IMMUNE_GATE_PROBE_CMD / IMMUNE_INSTRUMENT_PROBE_CMD
# override each doctor's probe invocation with an arbitrary shell command (run via `bash -c`), so
# the aggregation contract is testable without live `gh` or a real audit log. See immune-check.test.sh.
# =============================================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOOLS="$ROOT/tools"

REPO=""
LOG=""
JSON=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --json)  JSON=1; shift ;;
    --log)   [[ $# -ge 2 ]] || { echo "immune-check: --log requires a path" >&2; exit 1; }; LOG="$2"; shift 2 ;;
    --log=*) LOG="${1#--log=}"; shift ;;
    -h|--help)
      sed -n '2,40p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    --*) echo "immune-check: unknown flag '$1'" >&2; exit 1 ;;
    *)   REPO="$1"; shift ;;
  esac
done

# Build each doctor's probe command (override seam wins; else the real node tool). printf %q keeps
# paths/args quote-safe through the `bash -c` boundary.
if [[ -z "${IMMUNE_GATE_PROBE_CMD:-}" ]]; then
  IMMUNE_GATE_PROBE_CMD="node $(printf %q "$TOOLS/gate-freeze-sensor.mjs")"
  [[ -n "$REPO" ]] && IMMUNE_GATE_PROBE_CMD+=" $(printf %q "$REPO")"
  IMMUNE_GATE_PROBE_CMD+=" --probe"
fi
if [[ -z "${IMMUNE_INSTRUMENT_PROBE_CMD:-}" ]]; then
  IMMUNE_INSTRUMENT_PROBE_CMD="node $(printf %q "$TOOLS/instrument-truth-sensor.mjs") --probe"
  [[ -n "$LOG" ]] && IMMUNE_INSTRUMENT_PROBE_CMD+=" $(printf %q "--log=$LOG")"
fi
if [[ -z "${IMMUNE_LINT_PROBE_CMD:-}" ]]; then
  IMMUNE_LINT_PROBE_CMD="bash $(printf %q "$TOOLS/check-instrument-ground-truth.sh") --probe"
fi

# Run a doctor's probe; capture its tile (stdout+stderr — a doctor's `die` writes its
# diagnostic to stderr) and its exit code (the verdict). Never pipe; capture $? directly.
run_doctor() { # cmd -> prints tile to stdout; returns the doctor's exit code
  local tile rc
  tile="$(bash -c "$1" 2>&1)"; rc=$?
  [[ -z "$tile" ]] && tile="(no output — exit $rc)"
  printf '%s\n' "$tile"
  return "$rc"
}

gate_tile="$(run_doctor "$IMMUNE_GATE_PROBE_CMD")";       gate_rc=$?
instr_tile="$(run_doctor "$IMMUNE_INSTRUMENT_PROBE_CMD")"; instr_rc=$?
lint_tile="$(run_doctor "$IMMUNE_LINT_PROBE_CMD")";       lint_rc=$?

# Normalize the severity of each exit. The doctors contract 0/1/2; ANY other code (crash,
# 127 command-not-found, an uncontracted return) is treated as INSUFFICIENT — never HEALTHY.
# "Green has two causes — clean, and never-ran; only an honest sensor distinguishes them."
# ([[ci-sensors-must-not-be-numb]]). The original codes are kept for display/--json.
sev() { case "$1" in 0|1|2) echo "$1" ;; *) echo 1 ;; esac; }
gate_sev="$(sev "$gate_rc")"; instr_sev="$(sev "$instr_rc")"

# The lint is NOT on the doctors' 0/1/2 severity convention. Its exit contract is
# 0=clean / 1=violation / 2=arg-error: a violation is a real PROBLEM (sev 2) and an
# arg-error is INSUFFICIENT (sev 1). Remap explicitly — never feed it through sev().
case "$lint_rc" in 0) lint_sev=0 ;; 1) lint_sev=2 ;; 2) lint_sev=1 ;; *) lint_sev=1 ;; esac

# Aggregate: a real problem (2) dominates; else insufficient (1); else healthy (0).
if [[ "$gate_sev" -eq 2 || "$instr_sev" -eq 2 || "$lint_sev" -eq 2 ]]; then
  overall=2; verdict=PROBLEM
elif [[ "$gate_sev" -eq 1 || "$instr_sev" -eq 1 || "$lint_sev" -eq 1 ]]; then
  overall=1; verdict=INSUFFICIENT
else
  overall=0; verdict=HEALTHY
fi

if [[ "$JSON" -eq 1 ]]; then
  # Preflight the implicit dependency: --json needs jq. Without -e, a missing jq would print
  # "command not found" (127) and then exit with the aggregate code but NO JSON — a confusing
  # silent-ish failure for a documented mode. Fail with a sentence the operator can act on.
  command -v jq >/dev/null 2>&1 || { echo "immune-check: --json requires jq" >&2; exit 1; }
  # Build with jq so ANY tile content (newlines/control chars in an error path) encodes to
  # valid JSON — a hand-rolled printf+sed escaper handles only \ and " (council finding).
  jq -n \
    --arg verdict "$verdict" --argjson exit "$overall" \
    --argjson grc "$gate_rc"  --arg gtile "$gate_tile" \
    --argjson irc "$instr_rc" --arg itile "$instr_tile" \
    --argjson lrc "$lint_rc"  --arg ltile "$lint_tile" \
    '{verdict:$verdict, exit:$exit, doctors:[
       {doctor:"gate-freeze",       exit:$grc, tile:$gtile},
       {doctor:"instrument-truth",  exit:$irc, tile:$itile},
       {doctor:"ground-truth-lint", exit:$lrc, tile:$ltile}]}'
  exit "$overall"
fi

# Banner — header, one tile per doctor, combined verdict footer.
sym=$([[ "$overall" -eq 0 ]] && echo "✓" || { [[ "$overall" -eq 1 ]] && echo "·" || echo "⚠"; })
printf '  ╓─ immune-check · estate immune doctors · %s\n' "$(date -u +%Y-%m-%dT%H:%MZ)"
printf '     %s\n' "$gate_tile"
printf '     %s\n' "$instr_tile"
printf '     %s\n' "$lint_tile"
printf '  ╙─ %s VERDICT: %s (exit %d)\n' "$sym" "$verdict" "$overall"

exit "$overall"

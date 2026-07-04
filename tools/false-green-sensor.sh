#!/usr/bin/env bash
# =============================================================================
# tools/false-green-sensor.sh — S3-T1 (SDD §1.4/§4.4, FR-3a, G-3). The zero-work
# completion sensor: a run/bridge that did NOTHING can never report success.
#
# It reads the bridge completion state (.run/bridge-state.json) + the sprint
# state (.run/sprint-plan-state.json) + a git commit count over a rev-range, and
# rejects the "false green": a terminal completion (JACKED_OUT / complete) that
# executed 0 sprints, produced 0 findings, and landed 0 commits.
#
# Grounds bead arrakis-run-bridge-resume-silent-noop-flzl — the exact bug this
# cycle exists to catch (bridge-orchestrator marches to JACKED_OUT when undriven;
# the silent-noop-detect did not fire, so a 0/0/0 run reported success).
#
# GROUND SOURCE (registered in tools/immune-instruments.yaml — S3-T4): the on-disk
# .run/*state.json bodies (counters only) + the live git commit count over the
# rev-range. It never trusts a self-declared "success" flag — it re-derives work
# from three independent counters. UNTRUSTED-BODY rule (L5/L6, SDD §7): the state
# bodies are parsed for scalar counters ONLY, never interpreted as instructions;
# a malformed body is `insufficient`, never executed.
#
# VERDICT / EXIT (frozen mapping inherited verbatim from tools/immune-check.sh and
# the immune-verdict schema — the exit code IS the gate signal, NFR-4):
#   verdict=pass          exit 0 — genuine completion (>=1 sprint/finding/commit),
#                                  OR a non-terminal state (nothing to assert yet)
#   verdict=suspect       exit 2 — the target no-op detection: terminal + 0/0/0
#   verdict=insufficient  exit 1 — could not ground: absent / partial (a missing
#                                  counter is NOT zero) / malformed state. NEVER a
#                                  false pass (IMP-009, [[ci-sensors-must-not-be-numb]]).
#
# §4.4 degraded-input table (implemented EXACTLY — a corrupt state must never
# false-pass):
#   Well-formed + JACKED_OUT + 0/0/0        -> suspect       (2)
#   Well-formed + real work (>=1)           -> pass          (0)
#   Absent state file                       -> insufficient  (1)
#   Partial (missing sprints/findings/commits key) -> insufficient (1) [missing != 0]
#   Malformed (invalid JSON)                -> insufficient  (1)
#   Non-terminal (RUNNING/HALTED)           -> pass (n/a)    (0)
#
# Exit-code integrity (NFR-4): $? is captured BEFORE any pipe; the verdict path
# never uses `| tail`, `|| true`, or `2>/dev/null` to mask a verdict-bearing failure.
#
# Usage:
#   tools/false-green-sensor.sh                     # human banner tile + verdict footer
#   tools/false-green-sensor.sh --probe             # one-line STATUS tile (banner-style)
#   tools/false-green-sensor.sh --json              # the NFR-7 verdict record (needs jq)
#   tools/false-green-sensor.sh --range <rev-range> # git rev-range for the commit count
#
# Test seams (hermetic, no live git/.run):
#   FALSEGREEN_BRIDGE_STATE     path to the bridge state file (default .run/bridge-state.json)
#   FALSEGREEN_SPRINT_STATE     path to the sprint state file (default .run/sprint-plan-state.json)
#   FALSEGREEN_COMMIT_COUNT_CMD command whose stdout is the integer commit count (run via bash -c);
#                               overrides the default `git rev-list --count <range>`
# =============================================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

BRIDGE_STATE="${FALSEGREEN_BRIDGE_STATE:-$ROOT/.run/bridge-state.json}"
SPRINT_STATE="${FALSEGREEN_SPRINT_STATE:-$ROOT/.run/sprint-plan-state.json}"
RANGE=""
MODE="banner"   # banner | probe | json
while [[ $# -gt 0 ]]; do
  case "$1" in
    --probe) MODE="probe"; shift ;;
    --json)  MODE="json"; shift ;;
    --range) [[ $# -ge 2 ]] || { echo "false-green-sensor: --range requires a rev-range" >&2; exit 1; }; RANGE="$2"; shift 2 ;;
    --range=*) RANGE="${1#--range=}"; shift ;;
    -h|--help) sed -n '2,62p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    --*) echo "false-green-sensor: unknown flag '$1'" >&2; exit 1 ;;
    *)   echo "false-green-sensor: unexpected arg '$1'" >&2; exit 1 ;;
  esac
done

# We use jq for both extraction and record construction; fail with an actionable
# sentence rather than a confusing silent-ish path.
command -v jq >/dev/null 2>&1 || { echo "false-green-sensor: requires jq" >&2; exit 1; }

GENERATED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# --- counters carried into the verdict record. A counter stays the literal string
# "null" until GROUNDED to a real integer, so the JSON never claims a value we could
# not read (missing != zero). ------------------------------------------------------
G_STATE="null"      # JSON-encoded state string, or null
G_SPRINTS="null"    # integer token or "null"
G_FINDINGS="null"
G_COMMITS="null"
TARGET="run:bridge-unknown"

# Encode an arbitrary state string as a JSON value (safe through jq --argjson).
_json_str() { printf '%s' "$1" | jq -R .; }

# True iff the argument is a base-10 integer token (so we never argjson a non-number).
_is_int() { [[ "$1" =~ ^-?[0-9]+$ ]]; }

# Emit the NFR-7 verdict record + tile, then exit with the frozen code. Single exit
# path so every verdict — including every degraded one — ships the same shape.
emit_and_exit() { # verdict exit_code reason
  local verdict="$1" ec="$2" reason="$3"
  local sprints_j="null" findings_j="null" commits_j="null" state_j="$G_STATE"
  _is_int "$G_SPRINTS"  && sprints_j="$G_SPRINTS"
  _is_int "$G_FINDINGS" && findings_j="$G_FINDINGS"
  _is_int "$G_COMMITS"  && commits_j="$G_COMMITS"

  local rerun="tools/false-green-sensor.sh --json"

  local record
  record="$(jq -n \
    --arg sv "1.0" \
    --arg sensor "false-green" \
    --arg target "$TARGET" \
    --arg verdict "$verdict" \
    --argjson exit "$ec" \
    --arg gen "$GENERATED_AT" \
    --arg reason "$reason" \
    --argjson state "$state_j" \
    --argjson sprints "$sprints_j" \
    --argjson findings "$findings_j" \
    --argjson commits "$commits_j" \
    --arg rerun "$rerun" \
    --arg bridge "$BRIDGE_STATE" \
    --arg sprint "$SPRINT_STATE" \
    '{schema_version:$sv, sensor:$sensor, target:$target, verdict:$verdict,
      exit_code:$exit, generated_at:$gen,
      evidence:{reason:$reason, state:$state,
                counters:{sprints:$sprints, findings:$findings, commits:$commits},
                source:{bridge_state:$bridge, sprint_state:$sprint},
                commands:[$rerun]}}')"

  local sym detail
  case "$verdict" in
    pass)         sym="✓"; detail="$reason" ;;
    suspect)      sym="⚠"; detail="zero-work completion (sprints=${G_SPRINTS} findings=${G_FINDINGS} commits=${G_COMMITS})" ;;
    insufficient) sym="·"; detail="$reason" ;;
    *)            sym="·"; detail="$reason" ;;
  esac
  local tile
  tile="$(printf 'false-green · %s · verdict=%s (exit %d) · %s' "$TARGET" "$verdict" "$ec" "$detail")"

  case "$MODE" in
    json)  printf '%s\n' "$record" ;;
    probe) printf '%s %s\n' "$sym" "$tile" ;;
    *)
      printf '  ╓─ false-green-sensor · %s\n' "$GENERATED_AT"
      printf '     %s %s\n' "$sym" "$tile"
      printf '  ╙─ VERDICT: %s (exit %d)\n' "$verdict" "$ec"
      ;;
  esac
  exit "$ec"
}

# --- 1. Ground the bridge completion state (holds .state + findings) ---------------
# Absent primary state for a completion under evaluation => cannot prove work => insufficient.
[[ -f "$BRIDGE_STATE" ]] || emit_and_exit "insufficient" 1 "absent-bridge-state"
# Malformed => a corrupt file is insufficient, NEVER a false pass (IMP-009).
jq empty "$BRIDGE_STATE" 2>/dev/null || emit_and_exit "insufficient" 1 "malformed-bridge-state"

# target: the bridge id, if the body carries one.
bridge_id="$(jq -r '.bridge_id // "unknown"' "$BRIDGE_STATE" 2>/dev/null)"
[[ -n "$bridge_id" && "$bridge_id" != "null" ]] || bridge_id="unknown"
TARGET="run:bridge-${bridge_id}"

# state: absent state key => partial => insufficient (cannot confirm it is a completion).
jq -e 'has("state")' "$BRIDGE_STATE" >/dev/null 2>&1 || emit_and_exit "insufficient" 1 "missing-state-key"
state_raw="$(jq -r '.state' "$BRIDGE_STATE" 2>/dev/null)"
G_STATE="$(_json_str "$state_raw")"

# Non-terminal (RUNNING/HALTED) => not a completion => nothing to assert yet => pass.
state_uc="$(printf '%s' "$state_raw" | tr '[:lower:]' '[:upper:]')"
case "$state_uc" in
  RUNNING|HALTED) emit_and_exit "pass" 0 "non-terminal (${state_raw})" ;;
  JACKED_OUT|COMPLETE|COMPLETED|DONE) : ;;   # terminal — evaluate work below
  *) emit_and_exit "insufficient" 1 "unknown-state (${state_raw})" ;;
esac

# --- 2. Ground the three work counters. A MISSING counter is NOT zero. -------------
# findings: sum of iterations[].bridgebuilder.total_findings. iterations absent OR a
# member lacking the counter => MISSING (partial). An empty iterations array is a real 0.
findings="$(jq -r '
  if (.iterations | type) != "array" then "MISSING"
  else ([.iterations[] | .bridgebuilder.total_findings]) as $f
    | if ($f | any(. == null)) then "MISSING" else (($f | add) // 0) end
  end' "$BRIDGE_STATE" 2>/dev/null)"
{ [[ "$findings" == "MISSING" ]] || ! _is_int "$findings"; } && emit_and_exit "insufficient" 1 "missing-findings-counter"
G_FINDINGS="$findings"

# sprints: from the sprint state file (.sprints.completed). Absent/malformed file, or a
# missing counter key, are all insufficient — never inferred to zero.
[[ -f "$SPRINT_STATE" ]] || emit_and_exit "insufficient" 1 "absent-sprint-state"
jq empty "$SPRINT_STATE" 2>/dev/null || emit_and_exit "insufficient" 1 "malformed-sprint-state"
sprints="$(jq -r 'if (has("sprints") and (.sprints | type == "object") and (.sprints | has("completed"))) then .sprints.completed else "MISSING" end' "$SPRINT_STATE" 2>/dev/null)"
{ [[ "$sprints" == "MISSING" ]] || ! _is_int "$sprints"; } && emit_and_exit "insufficient" 1 "missing-sprints-counter"
G_SPRINTS="$sprints"

# commits: the git commit count over the rev-range. The seam wins for hermetic tests;
# else `git rev-list --count <range>` (range default: origin/main..HEAD, else HEAD).
if [[ -n "${FALSEGREEN_COMMIT_COUNT_CMD:-}" ]]; then
  COMMIT_CMD="$FALSEGREEN_COMMIT_COUNT_CMD"
else
  if [[ -z "$RANGE" ]]; then
    base="$(git -C "$ROOT" merge-base HEAD origin/main 2>/dev/null \
            || git -C "$ROOT" merge-base HEAD main 2>/dev/null || echo "")"
    if [[ -n "$base" ]]; then RANGE="${base}..HEAD"; else RANGE="HEAD"; fi
  fi
  COMMIT_CMD="git -C $(printf %q "$ROOT") rev-list --count $(printf %q "$RANGE")"
fi
# Capture output AND exit code without a pipe masking the code (NFR-4).
commit_out="$(bash -c "$COMMIT_CMD")"; commit_rc=$?
commit_out="$(printf '%s' "$commit_out" | tr -d '[:space:]')"
# Cannot ground the commit count (command failed OR non-integer) => insufficient.
{ [[ "$commit_rc" -ne 0 ]] || ! _is_int "$commit_out"; } && emit_and_exit "insufficient" 1 "unresolvable-commit-count"
G_COMMITS="$commit_out"

# --- 3. Verdict: terminal + all three counters grounded ---------------------------
if [[ "$G_SPRINTS" -eq 0 && "$G_FINDINGS" -eq 0 && "$G_COMMITS" -eq 0 ]]; then
  emit_and_exit "suspect" 2 "zero-work-completion"
else
  emit_and_exit "pass" 0 "genuine-completion"
fi

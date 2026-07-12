#!/usr/bin/env bash
# =============================================================================
# tools/quarantine-equivalence-gate.sh — the OBJECTIVE quarantine gate.
#
# Cycle: datastore-legibility / consumption-truth · S1-T7 (SDD §3.4, FR-1b,
# SKP-003, IMP-007). Grounds sprint AC: "Quarantine of integration-tests/agent-ci
# from the required-list happens ONLY after a per-package coverage-diff proves
# uncovered_file == [] (or explicit accepted-risk) — else quarantine is blocked."
#
# WHAT IT PROVES (per package, mechanically — not a subjective judgement):
#
#     set(scoped test files for pkg)  ⊇  set(suite files attributable to pkg)
#
# The suite's attributable files come from tools/quarantine-coverage-map.yaml
# (globs, expanded against the repo tree so the proof is grounded in files that
# actually exist). The scoped set comes from S1-T1's scope-classify (fed in as a
# newline-delimited file list — this gate is a set-difference PROOF, not a
# coverage-instrumentation engine; it does NOT run tests). Any file the old suite
# ran that the scoped set does NOT run is an `uncovered_file`. Unless that file is
# logged as explicit `accepted_risk` in the map, it BLOCKS quarantine.
#
# This mirrors the immune-doctor contract (tools/immune-check.sh): a one-line
# verdict tile + the exit code IS the verdict; --probe / --json.
#
# Exit codes (the verdict — capture $? BEFORE any pipe, per [[gate-output-never-piped]]):
#   0  ALLOWED       — scoped ⊇ quarantined (every uncovered file waived) → quarantine OK
#   2  BLOCKED       — >=1 uncovered_file not in accepted_risk → PROBLEM, quarantine BLOCKED
#   1  INSUFFICIENT  — could not ground the proof (suite/pkg not in map, scoped list
#                      missing/unreadable, map unparseable). Never claims ALLOWED without evidence.
#
# (0/1/2 severities are inherited VERBATIM from immune-check.sh: 0=HEALTHY,
# 1=INSUFFICIENT, 2=PROBLEM. A BLOCK is a real problem → 2, matching the aggregator.)
#
# Usage:
#   quarantine-equivalence-gate.sh --suite <name> --package <pkg> --scoped-files <path> [opts]
#       Prove the coverage-diff for one suite+package. <path> lists the scoped
#       test files (one per line), repo-root-relative — the scope-classify output.
#   quarantine-equivalence-gate.sh --record-rollback --suite <name> --escape <desc>
#       Un-quarantine a suite: append {date, escape, old_suite_would_have_caught:true}
#       to its rollback_log and flip status back to `candidate` (post-quarantine
#       escape the old suite would have caught).
#
#   Options: --map <path>        the coverage map (default: tools/quarantine-coverage-map.yaml)
#            --repo-root <dir>    root the attributable globs expand against (default: repo)
#            --probe              one-line STATUS tile (banner-style; same as default)
#            --json               machine object {verdict, exit, suite, package, ...} (needs jq)
#
# Test seam: hermetic — --map + --scoped-files + --repo-root take fixtures, so the
# set-difference contract is testable with no live CI. See quarantine-equivalence-gate.bats.
# =============================================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

MAP="$ROOT/tools/quarantine-coverage-map.yaml"
REPO_ROOT="$ROOT"
SUITE=""
PACKAGE=""
SCOPED_FILES=""
ESCAPE=""
MODE="prove"        # prove | rollback
JSON=0

die_arg() { printf 'quarantine-equivalence-gate: %s\n' "$1" >&2; exit 2; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --suite)        [[ $# -ge 2 ]] || die_arg "--suite requires a value";        SUITE="$2"; shift 2 ;;
    --package|--pkg)[[ $# -ge 2 ]] || die_arg "--package requires a value";      PACKAGE="$2"; shift 2 ;;
    --scoped-files) [[ $# -ge 2 ]] || die_arg "--scoped-files requires a path";  SCOPED_FILES="$2"; shift 2 ;;
    --map)          [[ $# -ge 2 ]] || die_arg "--map requires a path";           MAP="$2"; shift 2 ;;
    --repo-root)    [[ $# -ge 2 ]] || die_arg "--repo-root requires a dir";      REPO_ROOT="$2"; shift 2 ;;
    --escape)       [[ $# -ge 2 ]] || die_arg "--escape requires a description"; ESCAPE="$2"; shift 2 ;;
    --record-rollback) MODE="rollback"; shift ;;
    --probe)        shift ;;   # tile is the default form; accepted for banner parity
    --json)         JSON=1; shift ;;
    -h|--help)      sed -n '2,50p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    --*)            die_arg "unknown flag '$1'" ;;
    *)              die_arg "unexpected argument '$1'" ;;
  esac
done

command -v yq >/dev/null 2>&1 || { printf 'quarantine-equivalence-gate: yq is required\n' >&2; exit 2; }

# --- INSUFFICIENT emitter (couldn't ground the proof) ----------------------
insufficient() { # reason
  local reason="$1"
  if [[ "$JSON" -eq 1 ]] && command -v jq >/dev/null 2>&1; then
    jq -n --arg s "$SUITE" --arg p "$PACKAGE" --arg r "$reason" \
      '{verdict:"INSUFFICIENT", exit:1, suite:$s, package:$p, reason:$r}'
  else
    printf '· quarantine-equivalence · %s — cannot ground (INSUFFICIENT)\n' "$reason"
  fi
  exit 1
}

# =========================================================================
# rollback mode — record a post-quarantine escape, un-quarantine the suite.
# =========================================================================
if [[ "$MODE" == "rollback" ]]; then
  [[ -n "$SUITE" ]]  || die_arg "--record-rollback requires --suite"
  [[ -n "$ESCAPE" ]] || die_arg "--record-rollback requires --escape"
  [[ -f "$MAP" ]]    || insufficient "map not found: $MAP"
  yq e '.' "$MAP" >/dev/null 2>&1 || insufficient "map is not parseable YAML: $MAP"
  [[ "$(yq e ".suites | has(\"$SUITE\")" "$MAP" 2>/dev/null)" == "true" ]] \
    || insufficient "suite '$SUITE' not in map"

  today="$(date -u +%Y-%m-%d)"
  # Append the escape record and flip the suite back to candidate (un-quarantine).
  SUITE="$SUITE" ESC="$ESCAPE" DAY="$today" yq e -i '
    .suites[strenv(SUITE)].rollback_log +=
      [{"date": strenv(DAY), "escape": strenv(ESC), "old_suite_would_have_caught": true}]
    | .suites[strenv(SUITE)].status = "candidate"
  ' "$MAP" || insufficient "failed to write rollback_log to map"

  if [[ "$JSON" -eq 1 ]] && command -v jq >/dev/null 2>&1; then
    jq -n --arg s "$SUITE" --arg e "$ESCAPE" --arg d "$today" \
      '{verdict:"ROLLED_BACK", exit:0, suite:$s, escape:$e, date:$d, status:"candidate"}'
  else
    printf '↩ quarantine-equivalence · %s un-quarantined (escape logged) — status=candidate\n' "$SUITE"
  fi
  exit 0
fi

# =========================================================================
# prove mode — the objective coverage-diff.
# =========================================================================
[[ -n "$SUITE" ]]        || die_arg "--suite is required"
[[ -n "$PACKAGE" ]]      || die_arg "--package is required"
[[ -n "$SCOPED_FILES" ]] || die_arg "--scoped-files is required"

[[ -f "$MAP" ]]                     || insufficient "map not found: $MAP"
yq e '.' "$MAP" >/dev/null 2>&1     || insufficient "map is not parseable YAML: $MAP"
[[ -r "$SCOPED_FILES" ]]            || insufficient "scoped-files not readable: $SCOPED_FILES"
[[ -d "$REPO_ROOT" ]]               || insufficient "repo-root not a directory: $REPO_ROOT"

[[ "$(yq e ".suites | has(\"$SUITE\")" "$MAP" 2>/dev/null)" == "true" ]] \
  || insufficient "suite '$SUITE' not in map"
[[ "$(yq e ".suites.\"$SUITE\".files_attributable_to | has(\"$PACKAGE\")" "$MAP" 2>/dev/null)" == "true" ]] \
  || insufficient "package '$PACKAGE' not attributed under suite '$SUITE' in map"

# --- old-suite file set: expand the map's attributable globs against the tree ---
# Grounded in files that actually exist (a glob matching nothing contributes
# nothing — the old suite could only have run files present on disk).
declare -a GLOBS=()
while IFS= read -r g; do [[ -n "$g" ]] && GLOBS+=("$g"); done < <(
  yq e ".suites.\"$SUITE\".files_attributable_to.\"$PACKAGE\"[]" "$MAP" 2>/dev/null
)

expand_under_root() { # repo_root glob... -> newline list of matching repo-relative files
  local root="$1"; shift
  ( cd "$root" 2>/dev/null || exit 0
    shopt -s nullglob globstar 2>/dev/null
    local g m
    for g in "$@"; do
      for m in $g; do
        [[ -f "$m" ]] && printf '%s\n' "$m"
      done
    done
  ) | LC_ALL=C sort -u
}

old_suite_list=""
if [[ ${#GLOBS[@]} -gt 0 ]]; then
  old_suite_list="$(expand_under_root "$REPO_ROOT" "${GLOBS[@]}")"
fi

# --- scoped set: the concrete file list from scope-classify (S1-T1) ---
declare -A SCOPED=()
while IFS= read -r line || [[ -n "$line" ]]; do
  # trim leading/trailing whitespace; skip blanks and comments
  line="${line#"${line%%[![:space:]]*}"}"
  line="${line%"${line##*[![:space:]]}"}"
  [[ -z "$line" || "$line" == \#* ]] && continue
  SCOPED["$line"]=1
done < "$SCOPED_FILES"

# --- accepted_risk waivers: the explicitly-waived file patterns ---
declare -a ACCEPTED=()
while IFS= read -r a; do [[ -n "$a" ]] && ACCEPTED+=("$a"); done < <(
  yq e ".suites.\"$SUITE\".accepted_risk[].file // \"\"" "$MAP" 2>/dev/null | sed '/^$/d'
)

is_waived() { # file -> 0 if matched by an accepted_risk pattern (exact or fnmatch glob)
  local f="$1" pat
  for pat in ${ACCEPTED[@]+"${ACCEPTED[@]}"}; do
    # shellcheck disable=SC2053  — RHS glob is intentional (fnmatch waiver pattern)
    [[ "$f" == $pat ]] && return 0
  done
  return 1
}

# --- the set difference: old_suite \ scoped, partitioned into uncovered vs waived ---
declare -a OLD=() UNCOVERED=() WAIVED=()
covered=0
while IFS= read -r o; do
  [[ -n "$o" ]] || continue
  OLD+=("$o")
  if [[ -n "${SCOPED[$o]+x}" ]]; then
    covered=$((covered + 1))
    continue
  fi
  if is_waived "$o"; then WAIVED+=("$o"); else UNCOVERED+=("$o"); fi
done <<< "$old_suite_list"

# --- verdict: any un-waived uncovered_file blocks quarantine ---
if [[ ${#UNCOVERED[@]} -gt 0 ]]; then
  VERDICT="BLOCKED"; EXITC=2
else
  VERDICT="ALLOWED"; EXITC=0
fi

# --- emit (exit code IS the verdict; captured in EXITC before any pipe) ---
to_json_array() { # elements... -> compact JSON array
  if [[ $# -eq 0 ]]; then printf '[]'; else printf '%s\n' "$@" | jq -R . | jq -sc .; fi
}

if [[ "$JSON" -eq 1 ]]; then
  command -v jq >/dev/null 2>&1 || { printf 'quarantine-equivalence-gate: --json requires jq\n' >&2; exit 2; }
  old_json="$(to_json_array ${OLD[@]+"${OLD[@]}"})"
  scoped_json="$(to_json_array ${!SCOPED[@]+"${!SCOPED[@]}"})"
  uncovered_json="$(to_json_array ${UNCOVERED[@]+"${UNCOVERED[@]}"})"
  waived_json="$(to_json_array ${WAIVED[@]+"${WAIVED[@]}"})"
  jq -n \
    --arg verdict "$VERDICT" --argjson exit "$EXITC" \
    --arg suite "$SUITE" --arg pkg "$PACKAGE" \
    --argjson old "$old_json" --argjson scoped "$scoped_json" \
    --argjson uncovered "$uncovered_json" --argjson waived "$waived_json" \
    '{verdict:$verdict, exit:$exit, suite:$suite, package:$pkg,
      old_suite_files:$old, scoped_files:$scoped,
      uncovered_file:$uncovered, waived:$waived}'
  exit "$EXITC"
fi

if [[ "$EXITC" -eq 0 ]]; then
  printf '✓ quarantine-equivalence · %s/%s · scoped ⊇ quarantined (%d covered, %d waived) — quarantine ALLOWED\n' \
    "$SUITE" "$PACKAGE" "$covered" "${#WAIVED[@]}"
else
  printf '⚠ quarantine-equivalence · %s/%s · %d uncovered_file(s) not in accepted_risk — quarantine BLOCKED\n' \
    "$SUITE" "$PACKAGE" "${#UNCOVERED[@]}"
  for u in "${UNCOVERED[@]}"; do printf '     uncovered: %s\n' "$u"; done
fi
exit "$EXITC"

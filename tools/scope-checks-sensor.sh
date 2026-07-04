#!/usr/bin/env bash
# =============================================================================
# tools/scope-checks-sensor.sh — S1-T2 (SDD §1.4/§4.2, FR-1a). The "Trustworthy
# Green" settle-gate sensor: scope a PR's required checks to the changed packages
# PLUS their transitive dependents, so a per-PR green means a real *this-PR*
# signal again — with fallback-to-full on any cross-cutting change.
#
# It consumes tools/lib/scope-classify.sh (S1-T1, the pnpm reverse-dep walker,
# ground source = git diff + every packages/**/package.json) and maps each
# in-scope package to a CONCRETE runnable command (`pnpm --filter <pkg> test|build`)
# — a package that resolves to no runnable command is REPORTED in the record,
# never silently dropped (SDD §4.2 acceptance row).
#
# GROUND SOURCE (registered in tools/immune-instruments.yaml): the live changed-file
# set from `git diff --name-only` (overridable via SCOPE_DIFF_CMD for hermetic
# tests) + the per-package manifests read by scope-classify.sh. It never trusts a
# self-declared package list.
#
# VERDICT / EXIT (frozen mapping inherited verbatim from tools/immune-check.sh and
# the immune-verdict schema — the exit code IS the gate signal, NFR-4):
#   verdict=pass  exit 0  — scoped set computed; each in-scope pkg mapped to a command
#   verdict=full  exit 0  — fallback-to-full: a cross-cutting change poisoned the
#                           scoped walk, so the ENTIRE required set runs (safe/conservative)
#   verdict=insufficient exit 1 — could not ground the diff (no git / diff cmd failed);
#                           NEVER a false pass ([[ci-sensors-must-not-be-numb]])
# There is no PROBLEM(2) path: this sensor SCOPES work, it does not itself judge a
# build red/green — a scoped command's own failure is surfaced by CI running it.
#
# On a PR run the record is written ONLY to the ephemeral .run/immune/<sensor>-<sha>.json
# (SDD §2 step 1) — it does NOT append to the git-tracked flip-ledger (no PR-parallel
# writers; that is flip-report.sh's main-branch-single-writer job).
#
# Exit-code integrity (NFR-4): $? is captured BEFORE any pipe; the verdict path never
# uses `| tail`, `|| true`, or `2>/dev/null` to mask a failure.
#
# Usage:
#   tools/scope-checks-sensor.sh                     # human banner tile + verdict footer
#   tools/scope-checks-sensor.sh --probe             # one-line STATUS tile (banner-style)
#   tools/scope-checks-sensor.sh --json              # the NFR-7 verdict record (needs jq)
#   tools/scope-checks-sensor.sh --base <ref> --head <ref>
#
# Test seam (hermetic, no live git/CI): SCOPE_DIFF_CMD overrides the changed-file
# probe with an arbitrary command (run via `bash -c`), e.g.
#   SCOPE_DIFF_CMD='printf "packages/services/ordering/src/x.ts\n"' tools/scope-checks-sensor.sh --json
# SCOPE_REPO_ROOT is forwarded to scope-classify.sh (the manifest tree root; default ".").
# =============================================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# shellcheck source=tools/lib/scope-classify.sh
. "$ROOT/tools/lib/scope-classify.sh"

BASE=""
HEAD_REF=""
MODE="banner"   # banner | probe | json
while [[ $# -gt 0 ]]; do
  case "$1" in
    --probe) MODE="probe"; shift ;;
    --json)  MODE="json"; shift ;;
    --base)  [[ $# -ge 2 ]] || { echo "scope-checks-sensor: --base requires a ref" >&2; exit 1; }; BASE="$2"; shift 2 ;;
    --base=*) BASE="${1#--base=}"; shift ;;
    --head)  [[ $# -ge 2 ]] || { echo "scope-checks-sensor: --head requires a ref" >&2; exit 1; }; HEAD_REF="$2"; shift 2 ;;
    --head=*) HEAD_REF="${1#--head=}"; shift ;;
    -h|--help) sed -n '2,55p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    --*) echo "scope-checks-sensor: unknown flag '$1'" >&2; exit 1 ;;
    *)   echo "scope-checks-sensor: unexpected arg '$1'" >&2; exit 1 ;;
  esac
done

# --json needs jq; fail with an actionable sentence rather than a confusing silent-ish path.
command -v jq >/dev/null 2>&1 || { echo "scope-checks-sensor: requires jq" >&2; exit 1; }

# --- Ground the changed-file set ------------------------------------------------
# Default: git diff base...head. base defaults to the merge-base with origin/main
# (fallback main); head defaults to HEAD. The SCOPE_DIFF_CMD seam wins for tests.
if [[ -z "${SCOPE_DIFF_CMD:-}" ]]; then
  if [[ -z "$BASE" ]]; then
    BASE="$(git -C "$ROOT" merge-base HEAD origin/main 2>/dev/null \
            || git -C "$ROOT" merge-base HEAD main 2>/dev/null || echo "")"
  fi
  [[ -z "$HEAD_REF" ]] && HEAD_REF="HEAD"
  if [[ -n "$BASE" ]]; then
    DIFF_CMD="git -C $(printf %q "$ROOT") diff --name-only $(printf %q "$BASE")...$(printf %q "$HEAD_REF")"
  else
    DIFF_CMD="git -C $(printf %q "$ROOT") diff --name-only $(printf %q "$HEAD_REF")"
  fi
else
  DIFF_CMD="$SCOPE_DIFF_CMD"
fi

# Capture output AND exit code without a pipe masking the code (NFR-4).
CHANGED="$(bash -c "$DIFF_CMD" 2>/dev/null)"; diff_rc=$?

TARGET_SHA="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo "unknown")"
TARGET="pr:${TARGET_SHA}"
GENERATED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# JSON-array helper: args -> compact JSON array of strings (empty-safe).
_json_arr() {
  if [[ "$#" -eq 0 ]]; then printf '[]'; else printf '%s\n' "$@" | jq -R . | jq -cs .; fi
}

# Find the manifest path for a package NAME (scope-classify emits names).
_manifest_for_name() {
  local name="$1" root="${SCOPE_REPO_ROOT:-$ROOT}" m
  while IFS= read -r m; do
    [[ -z "$m" ]] && continue
    [[ "$(jq -r '.name // empty' "$m" 2>/dev/null)" == "$name" ]] && { printf '%s\n' "$m"; return 0; }
  done <<< "$(find "$root/packages" -name package.json -not -path '*/node_modules/*' 2>/dev/null)"
  return 1
}

VERDICT=""; EXIT_CODE=0; EVIDENCE_MODE=""
declare -a PKGS=() COMMANDS=() UNRESOLVED=()

if [[ "$diff_rc" -ne 0 ]]; then
  # Could not ground the diff — INSUFFICIENT, never a false pass.
  VERDICT="insufficient"; EXIT_CODE=1; EVIDENCE_MODE="diff-failed"
else
  SCOPE="$(SCOPE_REPO_ROOT="${SCOPE_REPO_ROOT:-$ROOT}" scope_for_diff "$CHANGED")"; scope_rc=$?
  if [[ "$scope_rc" -eq 3 || "$SCOPE" == "__FALLBACK_TO_FULL__" ]]; then
    VERDICT="full"; EXIT_CODE=0; EVIDENCE_MODE="fallback-to-full"
    COMMANDS+=("run-full-required-set")   # the entire required set runs (safe)
  else
    VERDICT="pass"; EXIT_CODE=0; EVIDENCE_MODE="scoped"
    while IFS= read -r name; do
      [[ -z "$name" ]] && continue
      PKGS+=("$name")
      manifest="$(_manifest_for_name "$name")" || manifest=""
      resolved=0
      if [[ -n "$manifest" ]]; then
        for scr in test build; do
          if jq -e --arg s "$scr" '(.scripts // {}) | has($s)' "$manifest" >/dev/null 2>&1; then
            COMMANDS+=("pnpm --filter $name $scr"); resolved=1
          fi
        done
      fi
      # A package that resolves to no runnable command is REPORTED, never dropped.
      [[ "$resolved" -eq 0 ]] && UNRESOLVED+=("$name")
    done <<< "$SCOPE"
  fi
fi

PKGS_JSON="$(_json_arr ${PKGS[@]+"${PKGS[@]}"})"
COMMANDS_JSON="$(_json_arr ${COMMANDS[@]+"${COMMANDS[@]}"})"
UNRESOLVED_JSON="$(_json_arr ${UNRESOLVED[@]+"${UNRESOLVED[@]}"})"

RECORD="$(jq -n \
  --arg sv "1.0" \
  --arg sensor "scope-checks" \
  --arg target "$TARGET" \
  --arg verdict "$VERDICT" \
  --argjson exit "$EXIT_CODE" \
  --arg gen "$GENERATED_AT" \
  --arg mode "$EVIDENCE_MODE" \
  --argjson packages "$PKGS_JSON" \
  --argjson commands "$COMMANDS_JSON" \
  --argjson unresolved "$UNRESOLVED_JSON" \
  '{schema_version:$sv, sensor:$sensor, target:$target, verdict:$verdict,
    exit_code:$exit, generated_at:$gen,
    evidence:{mode:$mode, packages:$packages, commands:$commands, unresolved:$unresolved}}')"

# Ephemeral per-run record (PR path): .run/immune/<sensor>-<sha>.json. Never the ledger.
IMMUNE_DIR="$ROOT/.run/immune"
mkdir -p "$IMMUNE_DIR" 2>/dev/null || true
printf '%s\n' "$RECORD" > "$IMMUNE_DIR/scope-checks-${TARGET_SHA}.json" 2>/dev/null || true

# One-line tile shared by --probe and the banner.
n_pkgs="${#PKGS[@]}"; n_cmds="${#COMMANDS[@]}"; n_unres="${#UNRESOLVED[@]}"
case "$VERDICT" in
  pass) sym="✓"; detail="${n_pkgs} pkg / ${n_cmds} cmd$([[ "$n_unres" -gt 0 ]] && echo " / ${n_unres} UNRESOLVED")" ;;
  full) sym="✓"; detail="fallback-to-full (cross-cutting change)" ;;
  *)    sym="·"; detail="could not ground diff" ;;
esac
TILE="$(printf 'scope-checks · %s · verdict=%s (exit %d) · %s' "$TARGET" "$VERDICT" "$EXIT_CODE" "$detail")"

case "$MODE" in
  json)  printf '%s\n' "$RECORD" ;;
  probe) printf '%s %s\n' "$sym" "$TILE" ;;
  *)
    printf '  ╓─ scope-checks-sensor · %s\n' "$GENERATED_AT"
    printf '     %s %s\n' "$sym" "$TILE"
    [[ "$n_unres" -gt 0 ]] && printf '     ! unresolved (no runnable test/build): %s\n' "$(printf '%s ' ${UNRESOLVED[@]+"${UNRESOLVED[@]}"})"
    printf '  ╙─ VERDICT: %s (exit %d)\n' "$VERDICT" "$EXIT_CODE"
    ;;
esac

exit "$EXIT_CODE"

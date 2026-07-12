#!/usr/bin/env bash
# =============================================================================
# tools/flip-promote.sh — OPERATOR-RUN required-list migration (SDD §3.7/§5.4, FR-1d/FR-4).
#
# The ONE operator act in the flip mechanism: adding (or removing, --remove) an advisory sensor's
# check to the branch-protection required-list. This is DELIBERATELY NOT a PR-time CI action — the
# default `github.token` cannot write branch protection (`administration` is not a grantable
# GITHUB_TOKEN scope, probed SDD §0). Promotion needs an operator-held admin-WRITE PAT.
#
# Preconditions (verified BEFORE any GitHub API call):
#   1. flip-report.sh reports the sensor as `flip-ready` (promote) or `blocking` (--remove).
#   2. An admin-write PAT is present in env (LOA_ADMIN_PAT, else FLIP_PROMOTE_GH_TOKEN).
#
# PAT-ABSENT PATH (IMP-001/IMP-008 — the key acceptance): print the EXACT operator command to run
# + the missing scope, then exit 1. NEVER silently skip. NEVER report success. A silently-skipped
# promotion leaves the operator believing the gate flipped when it did not.
#
# Branch protection PUT is a FULL REPLACE, not a merge (flatline BLOCKER SKP-001). This tool does a
# READ-MODIFY-WRITE: GET the current protection → add/remove ONLY this one check in
# required_status_checks.checks → PUT the merged whole. It never clobbers other required checks or
# review rules.
#
# Audit: appends a promotion/removal EVENT to the flip-ledger (provenance = git author) and instructs
# the operator to commit it on main (single-writer model, SDD §3.2). git history is the trail.
#
# Usage:
#   tools/flip-promote.sh <sensor-check> [--remove]
#
# Env / test seam:
#   LOA_ADMIN_PAT / FLIP_PROMOTE_GH_TOKEN  operator admin-write PAT (required to actually promote)
#   FLIP_REPO=<owner/repo>                 repo to migrate (else `gh repo view`)
#   FLIP_GH_PROBE_CMD                      overrides the `gh` binary (stub the API in tests; no live gh)
#   FLIP_LEDGER / FLIP_WINDOW              passed through to flip-report.sh (fixture-driven tests)
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LEDGER="${FLIP_LEDGER:-$ROOT/tools/flip-ledger.jsonl}"

CHECK=""
MODE="promote"
ORIG_ARGS=("$@")
while [[ $# -gt 0 ]]; do
  case "$1" in
    --remove)  MODE="remove"; shift ;;
    -h|--help) sed -n '2,40p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    --*)       echo "flip-promote: unknown flag '$1'" >&2; exit 1 ;;
    *)         [[ -z "$CHECK" ]] || { echo "flip-promote: only one <sensor-check> allowed" >&2; exit 1; }; CHECK="$1"; shift ;;
  esac
done
[[ -n "$CHECK" ]] || { echo "flip-promote: <sensor-check> required (the required-list check name)" >&2; exit 1; }

command -v jq >/dev/null 2>&1 || { echo "flip-promote: requires jq" >&2; exit 1; }

# --- Precondition 1: the sensor must be in the right state per flip-report.sh -------------------
state="$(FLIP_LEDGER="$LEDGER" bash "$SCRIPT_DIR/flip-report.sh" --sensor "$CHECK" --json 2>/dev/null | jq -r '.sensors[0].state // "unknown"')"
if [[ "$MODE" == "promote" ]]; then
  case "$state" in
    flip-ready) : ;;
    blocking)   echo "flip-promote: '$CHECK' is already blocking (required) — nothing to promote."; exit 0 ;;
    *)          echo "flip-promote: REFUSED — '$CHECK' is '$state', not 'flip-ready'. Earn a seeded true-catch + a clean last-N window first (tools/flip-report.sh --sensor $CHECK)." >&2; exit 1 ;;
  esac
else # remove / rollback
  case "$state" in
    blocking) : ;;
    *)        echo "flip-promote: REFUSED — '$CHECK' is '$state', not 'blocking'. Nothing to roll back." >&2; exit 1 ;;
  esac
fi

# --- Precondition 2: an admin-WRITE PAT must be present ----------------------------------------
# PAT-ABSENT is the key acceptance (IMP-008): print the EXACT command + missing scope, exit 1.
PAT="${LOA_ADMIN_PAT:-${FLIP_PROMOTE_GH_TOKEN:-}}"
if [[ -z "$PAT" ]]; then
  # Reconstruct the exact invocation the operator should re-run, with the PAT prefixed.
  cmd="tools/flip-promote.sh"
  for a in ${ORIG_ARGS[@]+"${ORIG_ARGS[@]}"}; do cmd+=" $a"; done
  {
    echo "flip-promote: REFUSED — no admin-write PAT found in env (checked LOA_ADMIN_PAT, FLIP_PROMOTE_GH_TOKEN)."
    echo ""
    echo "Branch-protection promotion requires a fine-grained PAT with the repository permission:"
    echo "    Administration: write"
    echo "(This is NOT a grantable GITHUB_TOKEN scope — it must be an operator-held PAT; SDD §0.)"
    echo ""
    echo "Run this exact command once the PAT is exported:"
    echo ""
    echo "    LOA_ADMIN_PAT=<your-admin-write-pat> $cmd"
    echo ""
  } >&2
  exit 1
fi

# --- Resolve owner/repo ------------------------------------------------------------------------
GH_CMD=()
read -r -a GH_CMD <<< "${FLIP_GH_PROBE_CMD:-gh}"
if [[ -n "${FLIP_REPO:-}" ]]; then
  NWO="$FLIP_REPO"
else
  NWO="$("${GH_CMD[@]}" repo view --json nameWithOwner -q .nameWithOwner)" || {
    echo "flip-promote: could not resolve repo (set FLIP_REPO=owner/repo or authenticate gh)." >&2; exit 1; }
fi
OWNER="${NWO%%/*}"; REPO="${NWO##*/}"
API_PATH="repos/$OWNER/$REPO/branches/main/protection"

# --- READ (GET current protection) — full replace requires the whole current config ------------
export GH_TOKEN="$PAT"   # the admin-write PAT authorizes both GET and PUT
get_out="$("${GH_CMD[@]}" api "$API_PATH")"; get_rc=$?
if [[ "$get_rc" -ne 0 ]] || ! printf '%s' "$get_out" | jq empty 2>/dev/null; then
  {
    echo "flip-promote: REFUSED — could not READ branch protection for $NWO (gh exit $get_rc)."
    echo "The PAT may lack 'Administration: read/write' on this repo, or main has no protection yet."
    echo "Verify with:  gh api $API_PATH"
  } >&2
  exit 1
fi

# --- MODIFY (add/remove ONLY our check; preserve everything else) -------------------------------
# GitHub's PUT body is a strict subset of the GET shape — map it faithfully so no existing required
# check / review rule is clobbered (flatline BLOCKER SKP-001: PUT is a full replace, not a merge).
put_body="$(printf '%s' "$get_out" | jq --arg check "$CHECK" --arg mode "$MODE" '
  {
    required_status_checks: (
      if .required_status_checks == null then null
      else {
        strict: (.required_status_checks.strict // false),
        checks: (
          ( .required_status_checks.checks
            // ((.required_status_checks.contexts // []) | map({context:., app_id:null})) ) as $existing
          | ( [ $existing[] | select(.context != $check) ] ) as $others   # drop any dup of ours
          | if $mode == "remove" then $others
            else ($others + [ {context:$check, app_id:null} ]) end)
      } end),
    enforce_admins: (.enforce_admins.enabled // false),
    required_pull_request_reviews: (
      if .required_pull_request_reviews == null then null
      else {
        dismiss_stale_reviews:        (.required_pull_request_reviews.dismiss_stale_reviews // false),
        require_code_owner_reviews:   (.required_pull_request_reviews.require_code_owner_reviews // false),
        required_approving_review_count: (.required_pull_request_reviews.required_approving_review_count // 0)
      } end),
    restrictions: (
      if (.restrictions == null) then null
      else { users: [ (.restrictions.users // [])[] | .login ],
             teams: [ (.restrictions.teams // [])[] | .slug ],
             apps:  [ (.restrictions.apps  // [])[] | .slug ] } end)
  }
  + (if .required_linear_history then {required_linear_history: .required_linear_history.enabled} else {} end)
  + (if .allow_force_pushes     then {allow_force_pushes: .allow_force_pushes.enabled} else {} end)
  + (if .allow_deletions        then {allow_deletions: .allow_deletions.enabled} else {} end)
  + (if .required_conversation_resolution then {required_conversation_resolution: .required_conversation_resolution.enabled} else {} end)
')"
if ! printf '%s' "$put_body" | jq empty 2>/dev/null; then
  echo "flip-promote: REFUSED — failed to build a valid PUT body from the current protection." >&2
  exit 1
fi

# --- WRITE (PUT the merged whole) — via a temp file, no verdict-masking pipe --------------------
tmp_body="$(mktemp)"
printf '%s' "$put_body" > "$tmp_body"
put_out="$("${GH_CMD[@]}" api -X PUT "$API_PATH" --input "$tmp_body")"; put_rc=$?
rm -f "$tmp_body"
if [[ "$put_rc" -ne 0 ]]; then
  {
    echo "flip-promote: REFUSED — the branch-protection PUT failed for $NWO (gh exit $put_rc)."
    echo "Nothing was recorded in the ledger. Verify the PAT has 'Administration: write' and retry:"
    echo "    LOA_ADMIN_PAT=<pat> tools/flip-promote.sh $CHECK${MODE:+ }$([[ $MODE == remove ]] && echo --remove)"
  } >&2
  exit 1
fi

# --- AUDIT (append the promotion/removal event to the ledger) ----------------------------------
author="$(git -C "$ROOT" config user.name 2>/dev/null || true)"
[[ -n "$author" ]] || author="$(git -C "$ROOT" config user.email 2>/dev/null || true)"
[[ -n "$author" ]] || author="unknown"
ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
if [[ "$MODE" == "promote" ]]; then blk=true; else blk=false; fi
event="$(jq -cn --arg ts "$ts" --arg s "$CHECK" --arg mode "$MODE" --argjson blk "$blk" --arg by "$author" \
  '{schema_version:"1.0.0", ts:$ts, sensor:$s, event:$mode, blocking:$blk, adjudicated_by:$by, pr:null}')"
printf '%s\n' "$event" >> "$LEDGER"

verb=$([[ "$MODE" == "promote" ]] && echo "PROMOTED to blocking (added to required-list)" || echo "ROLLED BACK to flip-ready (removed from required-list)")
echo "flip-promote: $CHECK $verb on $NWO."
echo "  ledger event appended → $LEDGER"
echo "  COMMIT it on an up-to-date main to complete the single-writer audit trail (SDD §3.2):"
echo "      git add $LEDGER && git commit -m 'chore(shared/immune): flip $MODE $CHECK'"
exit 0

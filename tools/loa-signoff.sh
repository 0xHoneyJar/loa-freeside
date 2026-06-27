#!/usr/bin/env bash
# =============================================================================
# tools/loa-signoff.sh — the LOCAL-GREEN attestation (the gh-signoff bridge)
# =============================================================================
# WHY THIS EXISTS (G1 / G-DOOR — un-freeze the front door)
#   `main`'s merge gate is a broken cut vertex: a REQUIRED `Unit Tests` status
#   check that is RED at the tip of `main` itself froze 27/27 open PRs behind a
#   gate the gate-fix PRs are themselves trapped behind. The fix (decided by the
#   operator) is the DHH / basecamp/gh-signoff / Depot synthesis: make LOCAL-green
#   the truth. Run the repo's real suite on a dev box; on green, post a `loa-signoff`
#   COMMIT STATUS to the PR's head SHA. Branch protection then requires `loa-signoff`
#   instead of the flaky cloud `Unit Tests` check (which keeps running, demoted to
#   informational). The sign-off IS the bridge from local-green to the CI gate.
#
#   This is the SAME idea as basecamp/gh-signoff (`gh signoff` posts a `signoff`
#   commit status), specialized to this repo's suite + a refuse-on-red floor.
#
# THE FLOOR (the whole point): we NEVER sign off a red suite. On RED this refuses,
#   posts nothing, and exits non-zero. A green attestation means a green suite —
#   no other path writes the status. ([[ci-sensors-must-not-be-numb]],
#   [[gate-output-never-piped]]: the EXIT CODE is the verdict.)
#
#   Read-only with respect to the repo. The ONLY mutation is the commit-status
#   POST (the signoff itself) via `gh api` (your auth — no API key, no app-code).
#
# Usage:
#   tools/loa-signoff.sh <pr-number>            # resolve head SHA from the PR, run suite, sign off
#   tools/loa-signoff.sh --sha <SHA>            # sign off a specific commit SHA
#   tools/loa-signoff.sh <pr> --dry-run         # run suite, print the intended POST, mutate nothing
#   tools/loa-signoff.sh <pr> --repo owner/name # explicit repo (else inferred via gh)
#
# Configurable (env):
#   LOA_SIGNOFF_SUITE_CMD   suite command           (default: "npm test")
#   LOA_SIGNOFF_SUITE_DIR   dir to run it in         (default: "themes/sietch" — the canonical Unit Tests cwd)
#   LOA_SIGNOFF_CONTEXT     commit-status context    (default: "loa-signoff")
#   LOA_SIGNOFF_OPERATOR    handle in the description (default: gh login)
#   LOA_SIGNOFF_REPO        owner/name               (default: inferred via `gh repo view`)
#   LOA_GH_BIN              gh binary (test seam)     (default: "gh")
#
# Exit: 0 signed off (or dry-run on green) · 1 suite RED (refused, posted nothing)
#       · 2 usage / infra error
# =============================================================================
set -uo pipefail

err()  { printf '[loa-signoff] %s\n' "$*" >&2; }
note() { printf '[loa-signoff] %s\n' "$*" >&2; }

GH_BIN="${LOA_GH_BIN:-gh}"
gh_cli() { command "$GH_BIN" "$@"; }

PR=""; SHA=""; REPO="${LOA_SIGNOFF_REPO:-}"; DRY_RUN=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --sha)      SHA="${2:-}"; shift 2 ;;
    --repo)     REPO="${2:-}"; shift 2 ;;
    --dry-run)  DRY_RUN=1; shift ;;
    -h|--help)
      sed -n '2,42p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    -*)         err "unknown flag: $1"; exit 2 ;;
    *)          if [[ -z "$PR" ]]; then PR="$1"; else err "unexpected argument: $1"; exit 2; fi; shift ;;
  esac
done

[[ -n "$PR" || -n "$SHA" ]] || { err "usage: loa-signoff.sh <pr-number> | --sha <SHA> [--dry-run] [--repo owner/name]"; exit 2; }

SUITE_CMD="${LOA_SIGNOFF_SUITE_CMD:-npm test}"
SUITE_DIR="${LOA_SIGNOFF_SUITE_DIR:-themes/sietch}"
CONTEXT="${LOA_SIGNOFF_CONTEXT:-loa-signoff}"

# --- Resolve repo (owner/name) -----------------------------------------------
if [[ -z "$REPO" ]]; then
  REPO="$(gh_cli repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || true)"
fi
[[ -n "$REPO" ]] || { err "could not resolve repo — pass --repo owner/name or set LOA_SIGNOFF_REPO"; exit 2; }

# --- Resolve the head SHA to sign off ----------------------------------------
if [[ -z "$SHA" ]]; then
  SHA="$(gh_cli pr view "$PR" --repo "$REPO" --json headRefOid -q .headRefOid 2>/dev/null || true)"
  [[ -n "$SHA" ]] || { err "could not resolve head SHA for PR #$PR in $REPO (auth? wrong PR?)"; exit 2; }
fi
SHORT_SHA="${SHA:0:12}"

# --- Resolve the operator handle for the attestation description -------------
OPERATOR="${LOA_SIGNOFF_OPERATOR:-}"
if [[ -z "$OPERATOR" ]]; then
  OPERATOR="$(gh_cli api user -q .login 2>/dev/null || true)"
  [[ -n "$OPERATOR" ]] || OPERATOR="$(git config user.name 2>/dev/null || echo local)"
fi

note "repo=$REPO · sha=$SHORT_SHA · suite='( cd $SUITE_DIR && $SUITE_CMD )' · operator=$OPERATOR${DRY_RUN:+ · DRY-RUN}"

# --- Run the suite locally ----------------------------------------------------
# eval of the configured command string: the trust boundary is the operator's own
# machine + their own env, which is exactly where a "local-green" attestation runs.
note "running suite locally — this is the attestation; a RED suite signs off NOTHING…"
suite_ec=0
( cd "$SUITE_DIR" && eval "$SUITE_CMD" ) || suite_ec=$?

if [[ "$suite_ec" -ne 0 ]]; then
  err "✗ SUITE RED (exit $suite_ec) — REFUSING to sign off. No status posted. (That is the whole point.)"
  err "  fix the suite, then re-run. The gate stays honest: a green attestation requires a green suite."
  exit 1
fi
note "✓ suite GREEN"

# --- Post the loa-signoff commit status (the ONLY mutation) ------------------
DESC="loa-signoff: '$SUITE_CMD' green @ $SHORT_SHA · by $OPERATOR"
DESC="${DESC:0:140}"  # GitHub status descriptions cap at 140 chars

if [[ "$DRY_RUN" -eq 1 ]]; then
  note "DRY-RUN — would POST commit status (mutating nothing):"
  printf '  gh api repos/%s/statuses/%s -f state=success -f context=%s -f description=%q\n' \
    "$REPO" "$SHA" "$CONTEXT" "$DESC" >&2
  note "✓ dry-run complete (suite was green; no status written)"
  exit 0
fi

if gh_cli api "repos/$REPO/statuses/$SHA" \
     -f state=success \
     -f context="$CONTEXT" \
     -f description="$DESC" >/dev/null; then
  note "✓ SIGNED OFF — '$CONTEXT' = success posted to $REPO @ $SHORT_SHA"
  exit 0
else
  err "✗ suite was green but the status POST failed (gh api error) — see above. Nothing was signed off."
  exit 2
fi

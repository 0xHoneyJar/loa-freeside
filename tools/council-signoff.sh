#!/usr/bin/env bash
# =============================================================================
# tools/council-signoff.sh — the cross-model COUNCIL as a GitHub approving review
# =============================================================================
# WHY THIS EXISTS (G1 / G-DOOR — un-freeze the front door)
#   `main` requires 2 approving reviews, but the LOCAL cheval council (the
#   cross-model FAGAN gate — codex + cursor + claude, subscription CLIs) posts
#   ZERO GitHub reviews. So 2-of-2 was unmeetable solo and the gate-fix PRs
#   stayed trapped. cheval CANNOT run in GitHub Actions (no OAuth subscription
#   sessions on ephemeral runners; ANTHROPIC_API_KEY is stripped) — so the
#   council runs LOCAL and this script is the bridge: it runs the council on a
#   PR's diff and, when the verdict is APPROVED by ≥2 surviving distinct model
#   families, posts an APPROVING GitHub review. That review = 1 of the required
#   approvals (council = 1, operator = 1).
#
# FAIL-CLOSED (the council's load-bearing guarantee, preserved here):
#   - exit 3 (all voices dropped)        → NEVER approve. A degraded council that
#                                          could reach zero models must not pass.
#   - exit 2 (council infra failure)     → NEVER approve.
#   - APPROVED but <2 voices survived    → NEVER approve. `multi_perspective_met`
#     (single-perspective)                 must hold; a halved panel is not a council.
#   - CHANGES_REQUIRED                    → request-changes (or --comment-only).
#   Approving requires: exit 0 AND verdict APPROVED AND multi_perspective_met
#   AND voices_survived ≥ 2. ([[council-convergence-not-proof]]: ≥2 distinct
#   families that actually survived — not convergence alone.)
#
#   The ONLY mutation is the `gh pr review` POST. --dry-run mutates nothing.
#
# Usage:
#   tools/council-signoff.sh <pr-number> [--repo owner/name] [--preflight]
#   tools/council-signoff.sh <pr> --dry-run        # run council, print intent, post nothing
#   tools/council-signoff.sh <pr> --comment-only   # post a COMMENT review (use when GitHub
#                                                  # blocks approving your own PR — the operator
#                                                  # then counts the commented council as approved)
#
# Configurable (env):
#   LOA_COUNCIL_BIN     council command: <pr> [--repo R] → result JSON on stdout, council exit code
#                       (default: construct-fagan's council-review-pr.sh; resolved via
#                        CONSTRUCT_FAGAN_DIR or ~/Documents/GitHub/construct-fagan)
#   CONSTRUCT_FAGAN_DIR construct-fagan checkout root (to locate the default council bin)
#   LOA_GH_BIN          gh binary (test seam)   (default: "gh")
#
# Exit: 0 APPROVED + review posted (or dry-run) · 1 CHANGES_REQUIRED · 2 infra/usage
#       · 3 council fail-closed (all voices dropped / single-perspective) — never approved
# =============================================================================
set -uo pipefail

err()  { printf '[council-signoff] %s\n' "$*" >&2; }
note() { printf '[council-signoff] %s\n' "$*" >&2; }

GH_BIN="${LOA_GH_BIN:-gh}"
gh_cli() { command "$GH_BIN" "$@"; }

PR=""; REPO=""; DRY_RUN=0; COMMENT_ONLY=0; PREFLIGHT=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)         REPO="${2:-}"; shift 2 ;;
    --dry-run)      DRY_RUN=1; shift ;;
    --comment-only) COMMENT_ONLY=1; shift ;;
    --preflight)    PREFLIGHT=1; shift ;;
    -h|--help)
      sed -n '2,45p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    -*)             err "unknown flag: $1"; exit 2 ;;
    *)              if [[ -z "$PR" ]]; then PR="$1"; else err "unexpected argument: $1"; exit 2; fi; shift ;;
  esac
done
[[ -n "$PR" ]] || { err "usage: council-signoff.sh <pr-number> [--repo owner/name] [--dry-run] [--comment-only] [--preflight]"; exit 2; }

# --- Resolve repo (owner/name) -----------------------------------------------
if [[ -z "$REPO" ]]; then
  REPO="$(gh_cli repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || true)"
fi
[[ -n "$REPO" ]] || { err "could not resolve repo — pass --repo owner/name"; exit 2; }

# --- Resolve the council command ---------------------------------------------
COUNCIL_BIN="${LOA_COUNCIL_BIN:-}"
if [[ -z "$COUNCIL_BIN" ]]; then
  for cand in \
    "${CONSTRUCT_FAGAN_DIR:-}/scripts/council-review-pr.sh" \
    "$HOME/Documents/GitHub/construct-fagan/scripts/council-review-pr.sh"; do
    [[ -n "$cand" && -f "$cand" ]] && { COUNCIL_BIN="$cand"; break; }
  done
fi
[[ -n "$COUNCIL_BIN" && -f "$COUNCIL_BIN" ]] || {
  err "council command not found — set LOA_COUNCIL_BIN=<path/to/council-review-pr.sh> (or CONSTRUCT_FAGAN_DIR)"; exit 2; }

# --- Run the council on the PR diff ------------------------------------------
note "running cross-model council on PR #$PR ($REPO) via $(basename "$COUNCIL_BIN")…"
council_args=("$PR" --repo "$REPO")
[[ "$PREFLIGHT" -eq 1 ]] && council_args+=(--preflight)

council_ec=0
json="$(command "$COUNCIL_BIN" "${council_args[@]}")" || council_ec=$?

# --- Honor the council's fail-closed verdicts BEFORE any review --------------
if [[ "$council_ec" -eq 3 ]]; then
  err "✗ COUNCIL FAIL-CLOSED (exit 3 — all voices dropped). NEVER approving a degraded council. Posting nothing."
  exit 3
fi
if [[ "$council_ec" -eq 2 ]]; then
  err "✗ COUNCIL INFRA ERROR (exit 2 — could not run: cheval.py missing / bad input / empty diff). Posting nothing."
  exit 2
fi

# --- Parse the verdict envelope ----------------------------------------------
if ! jq empty <<<"$json" >/dev/null 2>&1; then
  err "✗ council produced no parseable JSON (exit $council_ec). Posting nothing."
  exit 2
fi
verdict="$(jq -r '.verdict // "CHANGES_REQUIRED"' <<<"$json" 2>/dev/null || echo CHANGES_REQUIRED)"
mpm="$(jq -r '.panel.multi_perspective_met // false' <<<"$json" 2>/dev/null || echo false)"
survived="$(jq -r '.panel.voices_survived // 0' <<<"$json" 2>/dev/null | tr -dc '0-9')"; survived="${survived:-0}"
summary="$(jq -r '.summary // "(no summary)"' <<<"$json" 2>/dev/null || echo "(no summary)")"
voices_md="$(jq -r '(.panel.voices // [])[] | "- **\(.voice)** (\(.model_ran // "unknown")): \(.verdict) — \(.finding_count // 0) finding(s)"' <<<"$json" 2>/dev/null || true)"
[[ -n "$voices_md" ]] || voices_md="- (no surviving voice detail in envelope)"

note "council verdict=$verdict · voices_survived=$survived · multi_perspective_met=$mpm"

# --- Decide the GitHub review event ------------------------------------------
# Approving requires a CLEAN council with a real cross-family panel.
review_event=""; verdict_line=""
if [[ "$verdict" == "APPROVED" && "$council_ec" -eq 0 ]]; then
  if [[ "$mpm" == "true" && "$survived" -ge 2 ]]; then
    review_event="approve"
    verdict_line="**Verdict: APPROVED** — $survived distinct model families survived and converged clean."
  else
    err "✗ COUNCIL FAIL-CLOSED — verdict APPROVED but only $survived voice(s) survived (multi_perspective_met=$mpm)."
    err "  A single-perspective panel is NOT a council. NEVER approving on a halved panel. Posting nothing."
    exit 3
  fi
else
  review_event="request-changes"
  verdict_line="**Verdict: CHANGES_REQUIRED** — at least one voice raised a blocking finding."
fi

# --comment-only downgrades the event to a non-blocking COMMENT review (always
# permitted, even on your own PR — GitHub blocks self-approve / self-request-changes).
gh_event="$review_event"
if [[ "$COMMENT_ONLY" -eq 1 ]]; then gh_event="comment"; fi

# --- Build the review body ----------------------------------------------------
BODY="$(mktemp)"; trap 'rm -f "$BODY"' EXIT
# shellcheck disable=SC2016  # backticks below are literal Markdown code spans, not command subs
{
  printf '## 🤖 cheval cross-model FAGAN council — automated review\n\n'
  printf '%s\n\n' "$verdict_line"
  printf '%s\n\n' "$summary"
  printf '### Per-voice verdicts\n%s\n\n' "$voices_md"
  printf '> Routed through the LOCAL cheval council (subscription CLIs — no API key; cheval cannot\n'
  printf '> run in GitHub Actions). Per-voice model attribution + verdict-quality envelopes are\n'
  printf '> recorded in `.run/model-invoke.jsonl` (MODELINV audit). This review is the cross-model\n'
  printf '> gate satisfying one required approval (council = 1).\n'
} >"$BODY"

# --- Map the event to gh flags -----------------------------------------------
case "$gh_event" in
  approve)         gh_flag=(--approve) ;;
  request-changes) gh_flag=(--request-changes) ;;
  comment)         gh_flag=(--comment) ;;
esac

if [[ "$DRY_RUN" -eq 1 ]]; then
  note "DRY-RUN — would post a '$gh_event' review on PR #$PR (mutating nothing). Body:"
  sed 's/^/    /' "$BODY" >&2
  [[ "$review_event" == "approve" ]] && exit 0 || exit 1
fi

if gh_cli pr review "$PR" --repo "$REPO" "${gh_flag[@]}" --body-file "$BODY" >/dev/null; then
  note "✓ posted '$gh_event' review on PR #$PR"
else
  err "✗ 'gh pr review --$gh_event' failed (gh error above). NOTE: GitHub forbids approving / requesting-changes on"
  err "  your OWN PR — re-run with --comment-only to post the council verdict as a COMMENT instead."
  exit 2
fi

[[ "$review_event" == "approve" ]] && exit 0 || exit 1

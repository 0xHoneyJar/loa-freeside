#!/usr/bin/env bash
# Sibling fence for cycle consumption-truth (PRD G-6 / SDD §8).
#
# Fails (exit 1) if this branch touches any file owned by the in-flight sibling
# PR #422 (beacon-consumer cycle). The fence list below was derived from
# `gh pr view 422 --json files` on 2026-07-02 at head 1b2759c94f791bd0af43f1227bd10e607ea73f26
# (package-level paths only; grimoire/beads paths excluded — those are
# worktree-isolated by design). If #422 merges or its file set changes,
# re-derive with:  gh pr view 422 --json files --jq '.files[].path' | grep '^packages/'
#
# Exit code IS the verdict — never pipe this script's output through filters.
set -euo pipefail

FENCE=(
  "packages/beacon-schema/"
  "packages/freeside-cli/bin/freeside-cli.ts"
  "packages/freeside-cli/src/lib/harden-beacon-fetch.ts"
  "packages/freeside-cli/src/verbs/doctor.ts"
  "packages/freeside-cli/src/verbs/inspect.ts"
  "packages/freeside-cli/tests/doctor.test.ts"
  "packages/freeside-cli/tests/harden-beacon-fetch.test.ts"
  "packages/freeside-cli/tests/inspect.test.ts"
)

# Self-retirement: once #422 merges, its paths are no longer contested — the fence is scaffolding
# debris. Skip silently if gh is unavailable (offline/CI without auth): the fence still guards.
if pr_state=$(gh pr view 422 --json state --jq .state 2>/dev/null) && [[ "$pr_state" == "MERGED" ]]; then
  echo "sibling fence: RETIRED — PR #422 merged; remove scripts/check-sibling-fence.sh"
  exit 0
fi

# Fail closed on fetch failure — a stale local origin/main can blind the fence (FAGAN i2).
# Explicit offline escape: FENCE_ALLOW_STALE=1 (dev only, never CI).
if ! git fetch origin main --quiet 2>/dev/null; then
  if [[ "${FENCE_ALLOW_STALE:-0}" == "1" ]]; then
    echo "warn: could not fetch origin/main — FENCE_ALLOW_STALE=1, diffing against local ref" >&2
  else
    echo "FENCE ERROR: could not fetch origin/main (set FENCE_ALLOW_STALE=1 to override offline)" >&2
    exit 1
  fi
fi

# Committed range ∪ staged ∪ unstaged — a dirty working tree on fenced paths must trip too.
changed="$(
  {
    git diff --name-only origin/main...HEAD
    git diff --name-only HEAD
    git diff --name-only --cached
  } | sort -u
)"

violations=()
while IFS= read -r file; do
  [[ -z "$file" ]] && continue
  for fence in "${FENCE[@]}"; do
    if [[ "$file" == "$fence" || "$file" == "$fence"* ]]; then
      violations+=("$file")
      break
    fi
  done
done <<< "$changed"

if (( ${#violations[@]} > 0 )); then
  echo "SIBLING FENCE VIOLATION — branch touches PR #422's file set:" >&2
  printf '  %s\n' "${violations[@]}" | sort -u >&2
  exit 1
fi

count=0
[[ -n "$changed" ]] && count=$(printf '%s\n' "$changed" | wc -l | tr -d ' ')
echo "sibling fence: clean (${count} changed files checked)"

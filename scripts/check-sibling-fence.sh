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

git fetch origin main --quiet 2>/dev/null || echo "warn: could not fetch origin/main — diffing against local ref" >&2

changed="$(git diff --name-only origin/main...HEAD)"

violations=()
while IFS= read -r file; do
  [[ -z "$file" ]] && continue
  for fence in "${FENCE[@]}"; do
    if [[ "$file" == "$fence" || "$file" == "$fence"* ]]; then
      violations+=("$file")
    fi
  done
done <<< "$changed"

if (( ${#violations[@]} > 0 )); then
  echo "SIBLING FENCE VIOLATION — branch touches PR #422's file set:" >&2
  printf '  %s\n' "${violations[@]}" >&2
  exit 1
fi

echo "sibling fence: clean ($(wc -l <<< "$changed" | tr -d ' ') changed files checked)"

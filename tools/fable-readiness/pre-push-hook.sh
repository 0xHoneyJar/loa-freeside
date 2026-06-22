#!/usr/bin/env bash
# pre-push gate: block a push only when the Fable-5 reasoning_extraction audit finds HIGH
# triggers (exit 2). MEDIUM (exit 1) warns but allows. Mirrors the CI gate for fast local
# feedback. Install (matches the repo's pre-commit convention):
#   ln -sf ../../tools/fable-readiness/pre-push-hook.sh .git/hooks/pre-push
set -euo pipefail
repo_root="$(git rev-parse --show-toplevel)"
code=0
"$repo_root/tools/fable-readiness/reasoning-extraction-audit.sh" || code=$?
if [ "$code" -ge 2 ]; then
  echo "pre-push BLOCKED: HIGH reasoning_extraction trigger(s) above would silently fall back to Opus on Fable-5." >&2
  echo "Fix under .claude/ (operator-gated), or allowlist a verified shell-authored field, then push." >&2
  exit 1
fi
exit 0

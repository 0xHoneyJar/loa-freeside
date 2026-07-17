#!/usr/bin/env bash
# tools/check-beacon-domain.sh — local pre-commit hook stub for ADR-007 §D-3
#
# Validates that staged changes don't cross the platform/network domain
# boundary. Mirrors .github/workflows/path-domain-check.yml — both source
# the same classification logic from tools/lib/domain-classify.sh to
# prevent drift.
#
# Install as a pre-commit hook:
#   ln -s ../../tools/check-beacon-domain.sh .git/hooks/pre-commit
#
# Or invoke manually:
#   tools/check-beacon-domain.sh                  # check staged changes
#   tools/check-beacon-domain.sh --since main     # check all changes since main
#
# Reference: decisions/007-loa-freeside-absorption.md §D-3

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/domain-classify.sh
source "${SCRIPT_DIR}/lib/domain-classify.sh"

MODE="staged"
SINCE_REF=""

while [ $# -gt 0 ]; do
  case "$1" in
    --since)
      MODE="since"
      SINCE_REF="${2:-main}"
      shift 2
      ;;
    -h|--help)
      cat <<EOF
Usage: tools/check-beacon-domain.sh [--since <ref>]

  (no args)        Check staged changes (pre-commit mode)
  --since <ref>    Check all changes since <ref> (e.g., main)

Per ADR-007 §D-3, validates that changes don't mix platform and network domains.
EOF
      exit 0
      ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [ "$MODE" = "staged" ]; then
  touched=$(git diff --cached --name-only)
else
  touched=$(git diff --name-only "${SINCE_REF}...HEAD")
fi

if [ -z "$touched" ]; then
  echo "No changes to check"
  exit 0
fi

classify_changes "$touched"

if $platform_touched && $network_touched; then
  echo "ERROR: Cross-domain changes detected (ADR-007 §D-3 violation)" >&2
  echo "" >&2
  echo "Platform paths:" >&2
  printf '  %s\n' "${platform_files[@]}" >&2
  echo "" >&2
  echo "Network paths:" >&2
  printf '  %s\n' "${network_files[@]}" >&2
  echo "" >&2
  echo "Fix: split into separate platform-only and network-only commits/PRs." >&2
  exit 1
fi

if $platform_touched; then
  count=${#platform_files[@]}
  echo "✓ Domain: platform (${count} files)"
elif $network_touched; then
  count=${#network_files[@]}
  echo "✓ Domain: network (${count} files)"
else
  echo "✓ Domain: shared/cross-domain"
fi

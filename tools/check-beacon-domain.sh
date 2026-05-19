#!/usr/bin/env bash
# tools/check-beacon-domain.sh — local pre-commit hook stub for ADR-007 §D-3
#
# Validates that staged changes don't cross the platform/network domain
# boundary. Mirrors .github/workflows/path-domain-check.yml but runs locally
# before push, catching violations earlier in the loop.
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

platform_touched=false
network_touched=false
platform_files=()
network_files=()

while IFS= read -r f; do
  [ -z "$f" ] && continue
  case "$f" in
    # NETWORK domain (per ADR-007 §D-1)
    grimoires/freeside-network/*) network_touched=true; network_files+=("$f") ;;
    apps/mcp-gateway/*)           network_touched=true; network_files+=("$f") ;;
    packages/freeside-cli/*)      network_touched=true; network_files+=("$f") ;;
    packages/freeside-registry/*) network_touched=true; network_files+=("$f") ;;
    packages/beacon-schema/*)     network_touched=true; network_files+=("$f") ;;

    # PLATFORM domain (per ADR-007 §D-1)
    grimoires/freeside-platform/*) platform_touched=true; platform_files+=("$f") ;;
    apps/gateway/*)                platform_touched=true; platform_files+=("$f") ;;
    apps/ingestor/*)               platform_touched=true; platform_files+=("$f") ;;
    apps/worker/*)                 platform_touched=true; platform_files+=("$f") ;;
    packages/cli/*)                platform_touched=true; platform_files+=("$f") ;;
    packages/core/*)               platform_touched=true; platform_files+=("$f") ;;
    packages/adapters/*)           platform_touched=true; platform_files+=("$f") ;;
    packages/sandbox/*)            platform_touched=true; platform_files+=("$f") ;;
    packages/routes/*)             platform_touched=true; platform_files+=("$f") ;;
    packages/services/*)           platform_touched=true; platform_files+=("$f") ;;
    themes/sietch/*)               platform_touched=true; platform_files+=("$f") ;;
    infrastructure/terraform/*)    platform_touched=true; platform_files+=("$f") ;;

    # SHARED / cross-domain by default
    *) ;;
  esac
done <<< "$touched"

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
  echo "✓ Domain: platform ($(printf '%s ' "${platform_files[@]}" | wc -w | tr -d ' ') files)"
elif $network_touched; then
  echo "✓ Domain: network ($(printf '%s ' "${network_files[@]}" | wc -w | tr -d ' ') files)"
else
  echo "✓ Domain: shared/cross-domain"
fi

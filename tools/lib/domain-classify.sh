#!/usr/bin/env bash
# tools/lib/domain-classify.sh — single source of truth for ADR-007 §D-3 path classification
#
# Used by:
#   - .github/workflows/path-domain-check.yml (CI enforcement)
#   - tools/check-beacon-domain.sh (local pre-commit hook)
#
# Reference: decisions/007-loa-freeside-absorption.md §D-1, §D-3
#
# Usage:
#   source tools/lib/domain-classify.sh
#   classify_path "<file>" → echoes "platform", "network", or "shared"

classify_path() {
  local f="$1"
  case "$f" in
    # NETWORK domain (per ADR-007 §D-1)
    grimoires/freeside-network/*) echo "network" ;;
    apps/mcp-gateway/*)           echo "network" ;;
    packages/freeside-cli/*)      echo "network" ;;
    packages/freeside-registry/*) echo "network" ;;
    packages/beacon-schema/*)     echo "network" ;;

    # PLATFORM domain (per ADR-007 §D-1)
    grimoires/freeside-platform/*) echo "platform" ;;
    apps/gateway/*)                echo "platform" ;;
    apps/ingestor/*)               echo "platform" ;;
    apps/worker/*)                 echo "platform" ;;
    packages/cli/*)                echo "platform" ;;
    packages/core/*)               echo "platform" ;;
    packages/adapters/*)           echo "platform" ;;
    packages/sandbox/*)            echo "platform" ;;
    packages/routes/*)             echo "platform" ;;
    packages/services/*)           echo "platform" ;;
    themes/sietch/*)               echo "platform" ;;
    infrastructure/terraform/*)    echo "platform" ;;

    # SHARED / cross-domain by default
    *) echo "shared" ;;
  esac
}

# classify_changes <file_list> → outputs "platform_touched=true|false network_touched=true|false"
# (sets platform_files and network_files arrays as side effect when sourced)
classify_changes() {
  local files="$1"
  platform_touched=false
  network_touched=false
  platform_files=()
  network_files=()

  while IFS= read -r f; do
    [ -z "$f" ] && continue
    case "$(classify_path "$f")" in
      platform) platform_touched=true; platform_files+=("$f") ;;
      network)  network_touched=true; network_files+=("$f") ;;
    esac
  done <<< "$files"
}

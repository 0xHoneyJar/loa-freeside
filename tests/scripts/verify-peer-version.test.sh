#!/usr/bin/env bash
# =============================================================================
# Verify-Peer-Version Test Suite — Task 2.5 (Sprint 344, cycle-039)
# =============================================================================
# Tests the check_version_compatible function from verify-peer-version.sh
# with 5 concrete version pairs covering the dual-accept window edges.
#
# AC-2.5.3: 5 version pairs tested
# AC-2.5.4: All 5 pairs pass
#
# Usage:
#   bash tests/scripts/verify-peer-version.test.sh
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Locate the script under test
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
VERIFY_SCRIPT="$REPO_ROOT/scripts/verify-peer-version.sh"

if [[ ! -f "$VERIFY_SCRIPT" ]]; then
  echo "FAIL: Cannot find $VERIFY_SCRIPT"
  exit 1
fi

# ---------------------------------------------------------------------------
# Extract constants and functions from the production script
# ---------------------------------------------------------------------------
# The script under test runs top-level commands (curl, banner output), so we
# cannot source it directly. Instead we extract the constants and function
# bodies from the file text, then eval only the extracted fragments.
# This ensures the test validates the REAL script logic, not a copy.
# ---------------------------------------------------------------------------

# Extract a variable assignment from the script (handles quoted and unquoted)
get_var() {
  local var="$1"
  local value
  value=$(grep -E "^${var}=" "$VERIFY_SCRIPT" | head -1 | sed "s/^${var}=//; s/^[\"']//; s/[\"']$//")
  echo "$value"
}

CONTRACT_VERSION="$(get_var CONTRACT_VERSION)"
MIN_SUPPORTED_VERSION="$(get_var MIN_SUPPORTED_VERSION)"
ACCEPT_MAJOR_MIN="$(get_var ACCEPT_MAJOR_MIN)"
ACCEPT_MAJOR_MAX="$(get_var ACCEPT_MAJOR_MAX)"

# Validate all constants were extracted
for var_name in CONTRACT_VERSION MIN_SUPPORTED_VERSION ACCEPT_MAJOR_MIN ACCEPT_MAJOR_MAX; do
  if [[ -z "${!var_name:-}" ]]; then
    echo "FAIL: Could not extract $var_name from $VERIFY_SCRIPT"
    exit 1
  fi
done

# Extract a bash function body from the script (handles nested braces)
extract_func() {
  local func="$1"
  awk -v func="$func" '
    $0 ~ "^"func"[[:space:]]*\\(\\)" { in_func=1; depth=0 }
    in_func {
      print
      for (i=1; i<=length($0); i++) {
        c = substr($0, i, 1)
        if (c == "{") depth++
        else if (c == "}") {
          depth--
          if (depth == 0) { in_func=0; break }
        }
      }
    }
  ' "$VERIFY_SCRIPT"
}

# Extract and eval the two functions we need
funcs="$(extract_func parse_semver)

$(extract_func check_version_compatible)"

if [[ -z "$funcs" ]]; then
  echo "FAIL: Could not extract required functions from $VERIFY_SCRIPT"
  exit 1
fi

eval "$funcs"

# Verify functions are now defined
for func_name in parse_semver check_version_compatible; do
  if ! declare -F "$func_name" &>/dev/null; then
    echo "FAIL: Function $func_name not defined after extraction"
    exit 1
  fi
done

# ---------------------------------------------------------------------------
# Test Harness
# ---------------------------------------------------------------------------

PASS_COUNT=0
FAIL_COUNT=0

assert_status() {
  local test_name="$1"
  local peer_version="$2"
  local expected_status="$3"

  local result
  result=$(check_version_compatible "$peer_version")
  local actual_status
  actual_status=$(echo "$result" | head -1)

  if [[ "$actual_status" == "$expected_status" ]]; then
    echo "  PASS  $test_name: v${peer_version} -> $actual_status"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    echo "  FAIL  $test_name: v${peer_version} -> expected $expected_status, got $actual_status"
    echo "        Detail: $(echo "$result" | tail -1)"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
}

# ---------------------------------------------------------------------------
# Test Suite: 5 Version Pairs (AC-2.5.3)
# ---------------------------------------------------------------------------

echo "================================================================"
echo "  Verify-Peer-Version Test Suite"
echo "================================================================"
echo ""
echo "  CONTRACT_VERSION:      $CONTRACT_VERSION"
echo "  MIN_SUPPORTED_VERSION: $MIN_SUPPORTED_VERSION"
echo "  Dual-Accept Window:    v${ACCEPT_MAJOR_MIN}.0.0 – v${ACCEPT_MAJOR_MAX}.x.x"
echo ""
echo "── Version Pair Tests ─────────────────────────────────────────"
echo ""

# Pair 1: v7.9.1 <-> v7.0.0 — same major, older minor → PASS (COMPATIBLE)
assert_status "Pair 1: same major, older minor" "7.0.0" "COMPATIBLE"

# Pair 2: v7.9.1 <-> v7.5.0 — same major, recent minor → PASS (COMPATIBLE)
assert_status "Pair 2: same major, recent minor" "7.5.0" "COMPATIBLE"

# Pair 3: v7.9.1 <-> v6.0.0 — cross-major, dual-accept → PASS (COMPATIBLE_WITH_WARNING)
assert_status "Pair 3: cross-major dual-accept" "6.0.0" "COMPATIBLE_WITH_WARNING"

# Pair 4: v7.9.1 <-> v5.9.0 — below minimum supported → FAIL (INCOMPATIBLE)
assert_status "Pair 4: below minimum supported" "5.9.0" "INCOMPATIBLE"

# Pair 5: v7.9.1 <-> v8.0.0 — future major version → FAIL (INCOMPATIBLE)
assert_status "Pair 5: future major version" "8.0.0" "INCOMPATIBLE"

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

echo ""
echo "================================================================"
TOTAL=$((PASS_COUNT + FAIL_COUNT))
echo "  Results: $PASS_COUNT/$TOTAL passed"
echo "================================================================"

if [[ "$FAIL_COUNT" -gt 0 ]]; then
  echo ""
  echo "  FAIL: $FAIL_COUNT test(s) failed"
  exit 1
fi

echo ""
echo "  All $TOTAL tests passed."
exit 0

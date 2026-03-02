#!/usr/bin/env bash
# =============================================================================
# autopoietic-integration.sh — E2E Integration Test
# =============================================================================
# Part of: Integration & Autopoietic Verification (cycle-047, Sprint 390 Task 5.3)
#
# End-to-end test that validates all cycle-047 infrastructure works together:
#   1. Autopoietic health check — all 6 conditions score > 0
#   2. Capability discovery — 3 manifests found and ordered
#   3. Marginal value computation — signal logic on synthetic data
#   4. Failure lore validation — entries have required fields
#   5. Lore index validation — all referenced files exist
#
# Dependencies: jq 1.6+, yq v4+, bash 4+
# =============================================================================

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

PASS=0
FAIL=0
TOTAL=0

pass() {
  PASS=$((PASS + 1))
  TOTAL=$((TOTAL + 1))
  echo "  PASS: $1"
}

fail() {
  FAIL=$((FAIL + 1))
  TOTAL=$((TOTAL + 1))
  echo "  FAIL: $1"
  [[ -n "${2:-}" ]] && echo "        $2"
}

# =============================================================================
# Test Group 1: Autopoietic Health Check
# =============================================================================

echo "=== Autopoietic Health Check ==="

health_output=$("$REPO_ROOT/.claude/scripts/autopoietic-health.sh" 2>/dev/null)
health_rc=$?

if [[ $health_rc -eq 0 ]]; then
  pass "Health check exits 0"
else
  fail "Health check exits 0" "Got exit code $health_rc"
fi

# Validate JSON
if echo "$health_output" | jq '.' >/dev/null 2>&1; then
  pass "Health check outputs valid JSON"
else
  fail "Health check outputs valid JSON" "Could not parse output as JSON"
fi

# Check all 6 conditions present
condition_count=$(echo "$health_output" | jq '.autopoietic_health.conditions | length' 2>/dev/null) || condition_count=0
if [[ "$condition_count" -eq 6 ]]; then
  pass "Health check reports 6 conditions"
else
  fail "Health check reports 6 conditions" "Got $condition_count"
fi

# Check all conditions score > 0
zero_count=$(echo "$health_output" | jq '[.autopoietic_health.conditions[] | select(.score == 0)] | length' 2>/dev/null) || zero_count=-1
if [[ "$zero_count" -eq 0 ]]; then
  pass "All conditions score > 0"
else
  zero_names=$(echo "$health_output" | jq -r '[.autopoietic_health.conditions[] | select(.score == 0) | .name] | join(", ")' 2>/dev/null)
  fail "All conditions score > 0" "Zero-scored conditions: $zero_names"
fi

# Check overall score exists and is numeric
overall=$(echo "$health_output" | jq '.autopoietic_health.overall_score' 2>/dev/null) || overall="null"
if [[ "$overall" != "null" ]] && echo "$overall" | grep -qE '^[0-9]+\.?[0-9]*$'; then
  pass "Overall score is numeric: $overall"
else
  fail "Overall score is numeric" "Got: $overall"
fi

# Check flourishing_level is set
level=$(echo "$health_output" | jq -r '.autopoietic_health.flourishing_level' 2>/dev/null) || level=""
if [[ -n "$level" && "$level" != "null" ]]; then
  pass "Flourishing level set: $level"
else
  fail "Flourishing level set" "Got: $level"
fi

echo ""

# =============================================================================
# Test Group 2: Capability Discovery
# =============================================================================

echo "=== Capability Discovery ==="

source "$REPO_ROOT/.claude/scripts/lib/capability-lib.sh"

# Discover capabilities
caps=$(discover_capabilities 2>/dev/null)
disc_rc=$?

if [[ $disc_rc -eq 0 ]]; then
  pass "discover_capabilities exits 0"
else
  fail "discover_capabilities exits 0" "Got exit code $disc_rc"
fi

cap_count=$(echo "$caps" | jq 'length' 2>/dev/null) || cap_count=0
if [[ "$cap_count" -ge 3 ]]; then
  pass "Discovered ≥3 capability manifests: $cap_count"
else
  fail "Discovered ≥3 capability manifests" "Got $cap_count"
fi

# Check ordering returns sorted array
cap_ids=$(echo "$caps" | jq -r '.[].id' 2>/dev/null)
if [[ -n "$cap_ids" ]]; then
  # Build args array — resolve_ordering is a sourced function, can't use xargs
  local_ids=()
  while IFS= read -r cid; do
    [[ -n "$cid" ]] && local_ids+=("$cid")
  done <<< "$cap_ids"
  ordered=$(resolve_ordering "${local_ids[@]}" 2>/dev/null)
  order_rc=$?

  if [[ $order_rc -eq 0 ]]; then
    pass "resolve_ordering exits 0"
  else
    fail "resolve_ordering exits 0" "Got exit code $order_rc"
  fi

  ordered_count=$(echo "$ordered" | jq 'length' 2>/dev/null) || ordered_count=0
  if [[ "$ordered_count" -ge 3 ]]; then
    pass "Ordered chain has ≥3 entries: $ordered_count"
  else
    fail "Ordered chain has ≥3 entries" "Got $ordered_count"
  fi
else
  fail "Cap IDs extracted" "No capability IDs found"
fi

echo ""

# =============================================================================
# Test Group 3: Marginal Value Computation
# =============================================================================

echo "=== Marginal Value Computation ==="

source "$REPO_ROOT/.claude/scripts/lib/economic-lib.sh"

fixture="$REPO_ROOT/.claude/evals/fixtures/bridge-state-economic.json"

# Contract verification on good data
verify_bridge_state_contract "$fixture" >/dev/null 2>&1
verify_rc=$?
if [[ $verify_rc -eq 0 ]]; then
  pass "Contract verification passes on good data"
else
  fail "Contract verification passes on good data" "Got exit code $verify_rc"
fi

# Marginal value computation
mv_result=$(compute_marginal_value "$fixture" 2>/dev/null)
mv_rc=$?
if [[ $mv_rc -eq 0 ]]; then
  pass "compute_marginal_value exits 0"
else
  fail "compute_marginal_value exits 0" "Got exit code $mv_rc"
fi

mv_signal=$(echo "$mv_result" | jq -r '.signal' 2>/dev/null) || mv_signal=""
if [[ "$mv_signal" == "DIMINISHING_RETURNS" || "$mv_signal" == "HEALTHY" || "$mv_signal" == "NO_DATA" ]]; then
  pass "Signal is valid: $mv_signal"
else
  fail "Signal is valid" "Got: $mv_signal"
fi

# Test NO_DATA on missing file
nodata_result=$(compute_marginal_value "/nonexistent/file.json" 2>/dev/null)
nodata_signal=$(echo "$nodata_result" | jq -r '.signal' 2>/dev/null) || nodata_signal=""
if [[ "$nodata_signal" == "NO_DATA" ]]; then
  pass "Missing file returns NO_DATA signal"
else
  fail "Missing file returns NO_DATA signal" "Got: $nodata_signal"
fi

echo ""

# =============================================================================
# Test Group 4: Failure Lore Validation
# =============================================================================

echo "=== Failure Lore Validation ==="

failures_file="$REPO_ROOT/grimoires/loa/lore/failures.yaml"

if [[ -f "$failures_file" ]]; then
  pass "failures.yaml exists"
else
  fail "failures.yaml exists" "File not found"
fi

# Check required fields on all entries
if command -v yq &>/dev/null && [[ -f "$failures_file" ]]; then
  entry_count=$(yq '.entries | length' "$failures_file" 2>/dev/null) || entry_count=0

  if [[ "$entry_count" -ge 3 ]]; then
    pass "≥3 failure lore entries: $entry_count"
  else
    fail "≥3 failure lore entries" "Got $entry_count"
  fi

  # Check required fields (entries are under .entries[])
  required_fields=(id title root_cause surface_symptom lesson tags)
  for field in "${required_fields[@]}"; do
    missing=$(yq "[.entries[] | select(.$field == null)] | length" "$failures_file" 2>/dev/null) || missing=-1
    if [[ "$missing" -eq 0 ]]; then
      pass "All entries have .$field"
    else
      fail "All entries have .$field" "$missing entries missing"
    fi
  done
else
  fail "yq available for validation" "yq not found or failures.yaml missing"
fi

echo ""

# =============================================================================
# Test Group 5: Lore Index Validation
# =============================================================================

echo "=== Lore Index Validation ==="

index_file="$REPO_ROOT/grimoires/loa/lore/index.yaml"

if [[ -f "$index_file" ]]; then
  pass "index.yaml exists"
else
  fail "index.yaml exists" "File not found"
fi

if command -v yq &>/dev/null && [[ -f "$index_file" ]]; then
  # Check categories exist
  cat_count=$(yq '.categories | length' "$index_file" 2>/dev/null) || cat_count=0
  if [[ "$cat_count" -ge 2 ]]; then
    pass "≥2 categories in index: $cat_count"
  else
    fail "≥2 categories in index" "Got $cat_count"
  fi

  # Check patterns category has entries
  patterns_count=$(yq '.categories[] | select(.id == "patterns") | .entries | length' "$index_file" 2>/dev/null) || patterns_count=0
  if [[ "$patterns_count" -ge 1 ]]; then
    pass "Patterns category has entries: $patterns_count"
  else
    fail "Patterns category has entries" "Got $patterns_count"
  fi

  # Verify referenced source files exist
  local_failures=0
  source_files=$(yq '.categories[].source // ""' "$index_file" 2>/dev/null | grep -v '^$')
  while IFS= read -r src; do
    if [[ -n "$src" && ! -f "$REPO_ROOT/grimoires/loa/lore/$src" ]]; then
      fail "Source file exists: $src" "Not found at grimoires/loa/lore/$src"
      local_failures=$((local_failures + 1))
    fi
  done <<< "$source_files"
  if [[ "$local_failures" -eq 0 ]]; then
    pass "All referenced source files exist"
  fi
fi

echo ""

# =============================================================================
# Summary
# =============================================================================

echo "═══════════════════════════════════════════════════"
echo "  RESULTS: $PASS passed, $FAIL failed ($TOTAL total)"
echo "═══════════════════════════════════════════════════"

if [[ $FAIL -gt 0 ]]; then
  exit 1
fi
exit 0

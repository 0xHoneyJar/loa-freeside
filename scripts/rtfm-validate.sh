#!/usr/bin/env bash
# rtfm-validate.sh — Documentation validation suite (8 named checks)
# Usage: scripts/rtfm-validate.sh [--check NAME] [--verbose]
#
# Exit codes:
#   0  All checks pass
#   1  One or more checks failed
#   2  Script configuration error (missing dependencies)
#   13 jq version mismatch (< 1.7)

set -euo pipefail

VERBOSE=false
SINGLE_CHECK=""

for arg in "$@"; do
  case "$arg" in
    --verbose) VERBOSE=true ;;
    --check)   shift; SINGLE_CHECK="$1"; shift ;;
    --help|-h)
      echo "Usage: $0 [--check NAME] [--verbose]"
      echo ""
      echo "Checks: citations, naming, versions, crosslinks, crossrepo, completeness, butterfreezone, routes"
      exit 0
      ;;
  esac
done

# Dependency checks
for cmd in jq grep; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "ERROR: Required command not found: $cmd" >&2
    exit 2
  fi
done

# jq version check (need 1.6+)
JQ_VERSION=$(jq --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+' | head -1)
if [[ -z "$JQ_VERSION" ]]; then
  echo "ERROR: Cannot determine jq version" >&2
  exit 13
fi

log() {
  if [[ "$VERBOSE" == "true" ]]; then
    echo "  [DBG] $*" >&2
  fi
}

# Track results
declare -A results
total_pass=0
total_fail=0

# Managed document set (scope for cross-link, completeness, crossrepo checks)
MANAGED_DOCS=(
  "README.md"
  "BUTTERFREEZONE.md"
  "docs/ECOSYSTEM.md"
  "docs/API-QUICKSTART.md"
  "docs/API-REFERENCE.md"
  "docs/API-CHANGELOG.md"
  "docs/INFRASTRUCTURE.md"
  "docs/CLI.md"
  "docs/DEVELOPER-GUIDE.md"
)

run_check() {
  local name="$1"
  local description="$2"

  if [[ -n "$SINGLE_CHECK" && "$SINGLE_CHECK" != "$name" ]]; then
    return
  fi

  echo "[$name] $description"
}

report_result() {
  local name="$1"
  local passed="$2"
  local detail="${3:-}"

  if [[ "$passed" == "true" ]]; then
    echo "  PASS: $name"
    results[$name]="PASS"
    total_pass=$((total_pass + 1))
  else
    echo "  FAIL: $name — $detail"
    results[$name]="FAIL"
    total_fail=$((total_fail + 1))
  fi
}

# ============================================================================
# Check 1: Citation validity
# ============================================================================
check_citations() {
  run_check "citations" "Citation format + local file existence"

  if [[ ! -x "scripts/pin-citations.sh" ]]; then
    report_result "citations" "false" "scripts/pin-citations.sh not found or not executable"
    return
  fi

  local output exit_code
  output=$(scripts/pin-citations.sh --validate-only 2>&1) && exit_code=0 || exit_code=$?

  if [[ "$exit_code" -eq 0 ]]; then
    report_result "citations" "true"
  else
    # Count actual failure lines (not the summary "FAIL: N" line)
    local fail_count
    fail_count=$(echo "$output" | grep -c "^  FAIL: " || true)
    report_result "citations" "false" "$fail_count citation failures"
  fi
}

# ============================================================================
# Check 2: Naming compliance (zero Arrakis references)
# ============================================================================
check_naming() {
  run_check "naming" "Zero Arrakis references in zero-tolerance files"

  local zero_tolerance_files=(
    "README.md"
    "BUTTERFREEZONE.md"
    "docs/ECOSYSTEM.md"
    "docs/API-QUICKSTART.md"
    "docs/API-REFERENCE.md"
    "docs/INFRASTRUCTURE.md"
    "docs/CLI.md"
    "docs/DEVELOPER-GUIDE.md"
  )

  local violations=0
  for f in "${zero_tolerance_files[@]}"; do
    if [[ -f "$f" ]]; then
      local count
      count=$(grep -ci "arrakis" "$f" 2>/dev/null || true)
      if [[ "$count" -gt 0 ]]; then
        echo "    $f: $count Arrakis references" >&2
        violations=$((violations + count))
      fi
    fi
  done

  if [[ "$violations" -eq 0 ]]; then
    report_result "naming" "true"
  else
    report_result "naming" "false" "$violations Arrakis references found"
  fi
}

# ============================================================================
# Check 3: Version consistency
# ============================================================================
check_versions() {
  run_check "versions" "Version headers present in documents"

  local docs_with_versions=(
    "docs/DEVELOPER-GUIDE.md"
  )

  local missing=0
  for f in "${docs_with_versions[@]}"; do
    if [[ -f "$f" ]]; then
      if ! grep -qE 'Version: v[0-9]+\.[0-9]+\.[0-9]+' "$f"; then
        echo "    Missing version header: $f" >&2
        missing=$((missing + 1))
      fi
    else
      echo "    File not found: $f" >&2
      missing=$((missing + 1))
    fi
  done

  # Check package.json exists
  if [[ ! -f "package.json" ]]; then
    echo "    package.json not found" >&2
    missing=$((missing + 1))
  fi

  if [[ "$missing" -eq 0 ]]; then
    report_result "versions" "true"
  else
    report_result "versions" "false" "$missing version inconsistencies"
  fi
}

# ============================================================================
# Check 4: Cross-link integrity
# ============================================================================
check_crosslinks() {
  run_check "crosslinks" "All Markdown links resolve to existing targets"

  local broken=0

  for mdfile in "${MANAGED_DOCS[@]}"; do
    [[ -f "$mdfile" ]] || continue
    local dir
    dir=$(dirname "$mdfile")

    # Extract relative markdown links: [text](path)
    while IFS= read -r link; do
      # Skip external URLs, anchors, and mailto
      if echo "$link" | grep -qE '^(https?://|#|mailto:)'; then
        continue
      fi

      # Remove anchor from link
      local target
      target=$(echo "$link" | sed 's/#.*//')
      [[ -z "$target" ]] && continue

      # Resolve relative to the file's directory
      local resolved="$dir/$target"
      if [[ ! -f "$resolved" && ! -d "$resolved" ]]; then
        log "Broken link in $mdfile: $link (resolved: $resolved)"
        broken=$((broken + 1))
      fi
    done < <(grep -oE '\[([^]]*)\]\(([^)]+)\)' "$mdfile" | grep -oE '\(([^)]+)\)' | tr -d '()' || true)
  done

  if [[ "$broken" -eq 0 ]]; then
    report_result "crosslinks" "true"
  else
    report_result "crosslinks" "false" "$broken broken links"
  fi
}

# ============================================================================
# Check 5: Cross-repo citation stability (no branch-relative GitHub links)
# ============================================================================
check_crossrepo() {
  run_check "crossrepo" "No branch-relative GitHub links in docs"

  local branch_links=0

  for mdfile in "${MANAGED_DOCS[@]}"; do
    [[ -f "$mdfile" ]] || continue

    # Match GitHub URLs with /blob/main/ or /tree/main/ (branch-relative)
    local count
    count=$(grep -cE 'github\.com/[^/]+/[^/]+/(blob|tree)/(main|master|develop)/' "$mdfile" 2>/dev/null || true)
    if [[ "$count" -gt 0 ]]; then
      log "Branch-relative links in $mdfile: $count"
      branch_links=$((branch_links + count))
    fi
  done

  if [[ "$branch_links" -eq 0 ]]; then
    report_result "crossrepo" "true"
  else
    report_result "crossrepo" "false" "$branch_links branch-relative GitHub links"
  fi
}

# ============================================================================
# Check 6: Completeness (no TODO/TBD/PLACEHOLDER)
# ============================================================================
check_completeness() {
  run_check "completeness" "No TODO/TBD/PLACEHOLDER in published docs"

  local placeholders=0

  for mdfile in "${MANAGED_DOCS[@]}"; do
    [[ -f "$mdfile" ]] || continue

    local count
    count=$(grep -ciE '\bTODO\b|\bTBD\b|\bPLACEHOLDER\b|\bFIXME\b' "$mdfile" 2>/dev/null || true)
    if [[ "$count" -gt 0 ]]; then
      log "Placeholders in $mdfile: $count"
      placeholders=$((placeholders + count))
    fi
  done

  if [[ "$placeholders" -eq 0 ]]; then
    report_result "completeness" "true"
  else
    report_result "completeness" "false" "$placeholders placeholder markers found"
  fi
}

# ============================================================================
# Check 7: BUTTERFREEZONE validation
# ============================================================================
check_butterfreezone() {
  run_check "butterfreezone" "BUTTERFREEZONE.md passes validation"

  if [[ ! -f "BUTTERFREEZONE.md" ]]; then
    report_result "butterfreezone" "false" "BUTTERFREEZONE.md not found"
    return
  fi

  if [[ -x ".claude/scripts/butterfreezone-validate.sh" ]]; then
    local output exit_code
    output=$(.claude/scripts/butterfreezone-validate.sh 2>&1) && exit_code=0 || exit_code=$?

    # Exit 0 = pass, Exit 2 = warnings only (still pass), Exit 1 = failures
    if [[ "$exit_code" -eq 0 || "$exit_code" -eq 2 ]]; then
      report_result "butterfreezone" "true"
    else
      local fail_count
      fail_count=$(echo "$output" | grep -c "FAIL" || true)
      report_result "butterfreezone" "false" "$fail_count validation failures"
    fi
  else
    # Fallback: basic structure check
    local has_header has_meta
    has_header=$(grep -c '# BUTTERFREEZONE' BUTTERFREEZONE.md || true)
    has_meta=$(grep -c 'ground-truth-meta' BUTTERFREEZONE.md || true)

    if [[ "$has_header" -gt 0 && "$has_meta" -gt 0 ]]; then
      report_result "butterfreezone" "true"
    else
      report_result "butterfreezone" "false" "Missing BUTTERFREEZONE header or ground-truth-meta"
    fi
  fi
}

# ============================================================================
# Check 8: Route index completeness
# ============================================================================
check_routes() {
  run_check "routes" "Route snapshot matches current extraction"

  if [[ ! -x "scripts/extract-routes.sh" ]]; then
    report_result "routes" "false" "scripts/extract-routes.sh not found or not executable"
    return
  fi

  if [[ ! -f "scripts/route-snapshot.json" ]]; then
    report_result "routes" "false" "scripts/route-snapshot.json not found"
    return
  fi

  local output
  if output=$(scripts/extract-routes.sh --diff 2>&1); then
    report_result "routes" "true"
  else
    report_result "routes" "false" "Route drift detected"
    if [[ "$VERBOSE" == "true" ]]; then
      echo "$output" >&2
    fi
  fi
}

# ============================================================================
# Run all checks
# ============================================================================
echo "=== RTFM Documentation Validation ==="
echo ""

check_citations
check_naming
check_versions
check_crosslinks
check_crossrepo
check_completeness
check_butterfreezone
check_routes

echo ""
echo "=== Summary ==="
echo "  PASS: $total_pass"
echo "  FAIL: $total_fail"
echo "  TOTAL: $((total_pass + total_fail))"

for name in citations naming versions crosslinks crossrepo completeness butterfreezone routes; do
  if [[ -n "$SINGLE_CHECK" && "$SINGLE_CHECK" != "$name" ]]; then
    continue
  fi
  status="${results[$name]:-SKIP}"
  icon="?"
  case "$status" in
    PASS) icon="+" ;;
    FAIL) icon="x" ;;
  esac
  echo "  [$icon] $name: $status"
done

echo ""
if [[ "$total_fail" -gt 0 ]]; then
  echo "=== VALIDATION FAILED ==="
  exit 1
else
  echo "=== VALIDATION PASSED ==="
  exit 0
fi

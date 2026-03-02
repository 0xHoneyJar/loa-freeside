#!/usr/bin/env bash
# =============================================================================
# run-all.sh — Eval suite runner
# =============================================================================
# Iterates all *.sh eval scripts in this directory, runs each, and aggregates
# exit codes. Returns exit 0 if all pass, exit 1 if any fail.
#
# Usage:
#   .claude/evals/run-all.sh [--verbose]
#
# Registered evals:
#   - capability-discovery.sh (Sprint 388, Task 3.4)
#   - autopoietic-integration.sh (Sprint 390, Task 5.3)
#   - flatline-3model.sh (existing)
# =============================================================================

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERBOSE="${1:-}"

total=0
passed=0
failed=0
skipped=0

for eval_script in "$SCRIPT_DIR"/*.sh; do
  # Skip self
  [[ "$(basename "$eval_script")" == "run-all.sh" ]] && continue

  name="$(basename "$eval_script" .sh)"
  total=$((total + 1))

  # Check if script is executable or can be run with bash
  if [[ ! -x "$eval_script" ]]; then
    chmod +x "$eval_script"
  fi

  echo "[$total] Running: $name"

  if [[ "$VERBOSE" == "--verbose" ]]; then
    if bash "$eval_script"; then
      passed=$((passed + 1))
      echo "[$total] $name: PASS"
    else
      failed=$((failed + 1))
      echo "[$total] $name: FAIL"
    fi
  else
    if bash "$eval_script" >/dev/null 2>&1; then
      passed=$((passed + 1))
      echo "[$total] $name: PASS"
    else
      failed=$((failed + 1))
      echo "[$total] $name: FAIL"
    fi
  fi

  echo ""
done

echo "=== Eval Suite Summary ==="
echo "  Total:   $total"
echo "  Passed:  $passed"
echo "  Failed:  $failed"
echo ""

if [[ "$failed" -gt 0 ]]; then
  echo "FAIL: $failed eval(s) failed"
  exit 1
fi

echo "OK: All evals passed"
exit 0

#!/usr/bin/env bash
# =============================================================================
# Dependency-rule lint — Sprint-1 T3 · FR-7 · owns goal G-5
# =============================================================================
# The AUTHORITATIVE CI gate for the building dependency rule (the Contract plane):
#
#   packages/core/** is the platform's contract layer (ports + domain). It MUST
#   NOT import from `adapters`, `services`, or `themes`. Core talks to schemas
#   and ports — never outward to a runtime or a building. The arrow only points
#   inward (decisions/008-freeside-as-factory.md §D-1 / §D-3).
#
# A violation = the dependency DAG has an illegal back-edge (closer-to-meaning
# code reaching back into closer-to-raw infrastructure). That couples the
# contract to a runtime and breaks extraction.
#
# Mirror: packages/core/.eslintrc.cjs carries the same rule as
# `no-restricted-imports` for editor ergonomics. THIS script is what CI enforces.
#
# Usage:
#   tools/lint/dep-rule.sh                 # scan packages/core (default)
#   tools/lint/dep-rule.sh <dir>           # scan an explicit dir
#   tools/lint/dep-rule.sh --self-test     # plant + detect + clean (CI smoke)
#
# Exit: 0 = clean, 1 = forbidden import found, 2 = usage/internal error.
#
# Pre-existing violations may be parked in tools/lint/dep-rule-allowlist.txt
# (one `relative/path.ts` per line) — each MUST carry a removal bead. The
# allowlist is a ratchet: it may only shrink.
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SELF_TEST=false
SCAN_DIR=""

for arg in "$@"; do
  case "$arg" in
    --self-test) SELF_TEST=true ;;
    -*) echo "::error::unknown flag: $arg" >&2; exit 2 ;;
    *) SCAN_DIR="$arg" ;;
  esac
done

SCAN_DIR="${SCAN_DIR:-$ROOT/packages/core}"
ALLOWLIST="$ROOT/tools/lint/dep-rule-allowlist.txt"

if [[ ! -d "$SCAN_DIR" ]]; then
  echo "::error::scan dir not found: $SCAN_DIR" >&2
  exit 2
fi

# A specifier is forbidden when, inside the quoted module path, one of
# adapters|services|themes appears as a *path segment* — i.e. bounded by a
# leading start/`/`/`@freeside/` and a trailing `/` or closing quote. This is
# segment-anchored so `my-services`, `theme-utils`, `services-old` do NOT match.
#   from '../../adapters/x'   → match     from '@freeside/adapters' → match
#   from './my-services'      → no match  from '@freeside/core'     → no match
FORBIDDEN_RE="(from[[:space:]]+|(import|require)[[:space:]]*\()['\"]([^'\"]*/)?(@freeside/)?(adapters|services|themes)(/[^'\"]*)?['\"]"

scan() {
  # Emit `path:line:content` for each forbidden import in $1, after stripping
  # build output, deps, and generated declarations.
  local dir="$1"
  grep -rnE "$FORBIDDEN_RE" "$dir" --include='*.ts' 2>/dev/null \
    | grep -vE '/(dist|node_modules)/' \
    | grep -vE '\.d\.ts:' \
    || true
}

is_allowlisted() {
  # $1 = absolute file path. True if its repo-relative path is allowlisted.
  [[ -f "$ALLOWLIST" ]] || return 1
  local rel="${1#"$ROOT"/}"
  grep -qxF "$rel" "$ALLOWLIST" 2>/dev/null
}

run_check() {
  local dir="$1"
  local violations=0 allowed=0
  local out
  out="$(scan "$dir")"

  if [[ -n "$out" ]]; then
    while IFS= read -r line; do
      [[ -z "$line" ]] && continue
      # line = <path>:<lineno>:<content>
      local file="${line%%:*}"
      if is_allowlisted "$file"; then
        allowed=$((allowed + 1))
        echo "::warning::[allowlisted] $line"
        continue
      fi
      violations=$((violations + 1))
      echo "::error::forbidden import (core → adapters|services|themes): $line"
    done <<< "$out"
  fi

  if [[ "$violations" -gt 0 ]]; then
    echo ""
    echo "::error::dependency-rule lint FAILED — $violations forbidden import(s) in ${dir#"$ROOT"/}"
    echo "  packages/core/** must not import adapters|services|themes (Contract plane, ADR-008 §D-1)."
    echo "  Fix the import, or park it in tools/lint/dep-rule-allowlist.txt with a removal bead."
    return 1
  fi

  if [[ "$allowed" -gt 0 ]]; then
    echo "dependency-rule lint: clean (+ $allowed allowlisted, each owes a removal bead)"
  else
    echo "✓ dependency-rule lint: clean — no core → adapters|services|themes imports in ${dir#"$ROOT"/}"
  fi
  return 0
}

self_test() {
  # Plant a violation in a temp file under core, prove the gate catches it, clean up.
  local probe="$SCAN_DIR/__dep_rule_probe__.ts"
  trap 'rm -f "$probe"' EXIT
  printf "import { x } from '../../adapters/billing';\nexport const x2 = x;\n" > "$probe"

  if scan "$SCAN_DIR" | grep -q "__dep_rule_probe__"; then
    echo "✓ self-test: planted core → adapters import was detected"
  else
    echo "::error::self-test FAILED — planted forbidden import was NOT detected (gate is blind)"
    exit 1
  fi

  rm -f "$probe"
  trap - EXIT

  # And the real tree must still be clean after the probe is gone.
  if run_check "$SCAN_DIR" >/dev/null; then
    echo "✓ self-test: tree clean after probe removed"
  else
    echo "::error::self-test FAILED — tree not clean after probe removed"
    exit 1
  fi
}

if [[ "$SELF_TEST" == true ]]; then
  self_test
  exit 0
fi

run_check "$SCAN_DIR"

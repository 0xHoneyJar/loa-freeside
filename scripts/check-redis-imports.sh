#!/usr/bin/env bash
# Static Import Guard — Cycle 042 (SDD §3.3, Sprint Task 1.5)
#
# Fails if any unit test file (*.test.ts, excluding *.integration.test.ts
# and *.e2e.test.ts) imports redis or ioredis directly.
#
# Catches ESM, CJS, and dynamic import patterns.
# Skips: type-only imports, inline type casts, files with vi.mock('ioredis').
# Transitive imports are caught at runtime by ECONNREFUSED (Flatline IMP-006).

set -euo pipefail

SEARCH_DIRS=(
  "themes/sietch/tests"
  "packages/*/tests"
  "apps/*/tests"
)

# Direct import patterns (ESM, CJS, dynamic)
IMPORT_PATTERN='(from\s+['\''"](?:redis|ioredis)|require\s*\(\s*['\''"](?:redis|ioredis)|import\s*\(\s*['\''"](?:redis|ioredis))'

# Patterns to EXCLUDE (type-only usage, vi.mock lines)
SKIP_LINE_PATTERN='(import\s+type\s|as\s+.*import\(|:\s*import\(|vi\.mock)'

violations=()

for dir in "${SEARCH_DIRS[@]}"; do
  for resolved_dir in $dir; do
    [ -d "$resolved_dir" ] || continue

    while IFS= read -r -d '' file; do
      # Skip integration and e2e test files by suffix
      [[ "$file" == *.integration.test.ts ]] && continue
      [[ "$file" == *.e2e.test.ts ]] && continue

      # Skip entire file if it contains vi.mock('ioredis') — mock is the fix
      if grep -qP "vi\.mock\(['\"]ioredis" "$file" 2>/dev/null; then
        continue
      fi

      # Check for direct redis/ioredis imports, excluding type-only patterns
      if grep -P "$IMPORT_PATTERN" "$file" 2>/dev/null | grep -vP "$SKIP_LINE_PATTERN" | grep -qP "$IMPORT_PATTERN"; then
        violations+=("$file")
      fi
    done < <(find "$resolved_dir" -name '*.test.ts' -print0 2>/dev/null)
  done
done

if [ ${#violations[@]} -gt 0 ]; then
  echo "ERROR: Redis/ioredis imports found in unit test files:"
  echo ""
  for v in "${violations[@]}"; do
    echo "  - $v"
    grep -nP "$IMPORT_PATTERN" "$v" | grep -vP "$SKIP_LINE_PATTERN" | sed 's/^/      /'
  done
  echo ""
  echo "Unit tests must not import redis/ioredis directly."
  echo "Options: (1) Add vi.mock('ioredis') or (2) Rename to *.integration.test.ts"
  exit 1
fi

echo "Static import guard passed: no redis/ioredis imports in unit tests."
exit 0

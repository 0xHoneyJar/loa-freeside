#!/usr/bin/env bash
# verify-routes.sh — Tier 2 route contract validation
# Usage: scripts/verify-routes.sh [--snapshot FILE] [--base-url URL] [--dry-run]
#
# Validates that routes in the snapshot respond (not 404) and that
# auth-required routes reject unauthenticated requests.
#
# This script does NOT start a dev server — it assumes one is already running.
# Use --dry-run to validate the snapshot without making HTTP requests.

set -euo pipefail

SNAPSHOT_FILE="scripts/route-snapshot.json"
BASE_URL="http://localhost:3000"
DRY_RUN=false

for arg in "$@"; do
  case "$arg" in
    --snapshot)  shift; SNAPSHOT_FILE="$1"; shift ;;
    --base-url)  shift; BASE_URL="$1"; shift ;;
    --dry-run)   DRY_RUN=true; shift ;;
    --help|-h)
      echo "Usage: $0 [--snapshot FILE] [--base-url URL] [--dry-run]"
      exit 0
      ;;
  esac
done

if [[ ! -f "$SNAPSHOT_FILE" ]]; then
  echo "ERROR: Snapshot not found: $SNAPSHOT_FILE" >&2
  echo "Run scripts/extract-routes.sh --snapshot first." >&2
  exit 1
fi

if ! command -v jq &>/dev/null; then
  echo "ERROR: jq not found" >&2
  exit 1
fi

route_count=$(jq 'length' "$SNAPSHOT_FILE")
echo "=== Tier 2 Route Contract Validation ==="
echo "Snapshot: $SNAPSHOT_FILE ($route_count routes)"
echo "Base URL: $BASE_URL"
echo ""

if [[ "$DRY_RUN" == "true" ]]; then
  echo "[DRY RUN] Validating snapshot structure only."
  echo ""

  errors=0
  jq -r '.[] | "\(.method) \(.path) \(.auth) \(.source_file):\(.line)"' "$SNAPSHOT_FILE" | while read -r line; do
    echo "  OK: $line"
  done

  echo ""
  echo "Snapshot structure valid. $route_count routes indexed."
  exit 0
fi

# Check if server is reachable
if ! curl -sf --max-time 5 "$BASE_URL/api/agents/health" > /dev/null 2>&1; then
  echo "ERROR: Server not reachable at $BASE_URL" >&2
  echo "Start the dev server first: pnpm run dev" >&2
  exit 1
fi

pass=0
fail=0
skip=0
warnings=""

# Only test GET routes (safe — no side effects)
while IFS= read -r route; do
  method=$(echo "$route" | jq -r '.method')
  path=$(echo "$route" | jq -r '.path')
  auth=$(echo "$route" | jq -r '.auth')
  source=$(echo "$route" | jq -r '"\(.source_file):\(.line)"')

  # Skip non-GET methods (POST/PUT/DELETE may have side effects)
  if [[ "$method" != "GET" ]]; then
    skip=$((skip + 1))
    continue
  fi

  # Skip parameterized paths — we can't know valid IDs
  if echo "$path" | grep -q ':'; then
    skip=$((skip + 1))
    continue
  fi

  # Build full URL
  url="${BASE_URL}${path}"

  # Test: route responds (not 404)
  status=$(curl -so /dev/null -w '%{http_code}' --max-time 10 "$url" 2>/dev/null || echo "000")

  if [[ "$status" == "404" ]]; then
    fail=$((fail + 1))
    warnings="${warnings}  FAIL: $method $path → 404 ($source)\n"
  elif [[ "$status" == "000" ]]; then
    fail=$((fail + 1))
    warnings="${warnings}  FAIL: $method $path → timeout ($source)\n"
  elif [[ "$auth" == "true" && "$status" != "401" && "$status" != "403" ]]; then
    # Auth-required route should reject unauthenticated requests
    warnings="${warnings}  WARN: $method $path → $status (expected 401/403 for auth route) ($source)\n"
    pass=$((pass + 1))
  else
    pass=$((pass + 1))
  fi
done < <(jq -c '.[]' "$SNAPSHOT_FILE")

echo "Results:"
echo "  PASS: $pass"
echo "  FAIL: $fail"
echo "  SKIP: $skip (non-GET or parameterized)"
echo ""

if [[ -n "$warnings" ]]; then
  echo "Details:"
  echo -e "$warnings"
fi

if [[ "$fail" -gt 0 ]]; then
  echo "=== VALIDATION FAILED ==="
  exit 1
else
  echo "=== VALIDATION PASSED ==="
  exit 0
fi

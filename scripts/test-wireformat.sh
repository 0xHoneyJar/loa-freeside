#!/usr/bin/env bash
# Wire format cross-language test runner
#
# Sprint S-7: Runs both Rust and TypeScript fixture conformance tests,
# then checks for stale fixtures.
#
# Usage:
#   scripts/test-wireformat.sh           # Verify fixtures are current
#   scripts/test-wireformat.sh --regen   # Regenerate fixtures from Rust

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FIXTURES_DIR="$REPO_ROOT/packages/shared/nats-schemas/fixtures"

echo "=== Wire Format Cross-Language Tests ==="
echo ""

# Step 1: Rust conformance
echo "[Rust] Running wire format tests..."
if [[ "${1:-}" == "--regen" ]]; then
  (cd "$REPO_ROOT/apps/gateway" && REGENERATE_FIXTURES=1 cargo test --test wire_format 2>&1)
  echo "[Rust] Fixtures regenerated."
else
  (cd "$REPO_ROOT/apps/gateway" && cargo test --test wire_format 2>&1)
fi
echo "[Rust] PASS"
echo ""

# Step 2: TypeScript conformance
echo "[TypeScript] Running wire format tests..."
(cd "$REPO_ROOT/packages/shared/nats-schemas" && npx vitest run src/__tests__/wire-format-roundtrip.test.ts 2>&1)
echo "[TypeScript] PASS"
echo ""

# Step 3: Staleness check
echo "[Staleness] Checking for uncommitted fixture changes..."
if ! git -C "$REPO_ROOT" diff --exit-code "$FIXTURES_DIR" > /dev/null 2>&1; then
  echo "ERROR: Wire format fixtures have changed but are not committed."
  echo "Review the changes and commit the updated fixtures:"
  echo ""
  git -C "$REPO_ROOT" diff --stat "$FIXTURES_DIR"
  echo ""
  exit 1
fi
echo "[Staleness] PASS — fixtures are up to date."
echo ""

echo "=== All wire format checks passed ==="

#!/usr/bin/env bash
# verify-dist-hashes.sh — CI check for hounfour dist supply-chain integrity
#
# Verifies:
#   1. dist/SOURCE_SHA matches the git commit SHA pinned in package.json
#   2. dist/DIST_HASH matches the expected value in scripts/expected-dist-hashes.json
#
# Exit codes:
#   0 — All checks passed
#   1 — Hash mismatch (supply-chain integrity violation)
#   2 — Missing files or configuration error
#
# Usage:
#   ./scripts/verify-dist-hashes.sh          # Auto-detect from package.json
#   ./scripts/verify-dist-hashes.sh --ci     # Same, but exits non-zero on warnings too
#
# @see grimoires/loa/sprint.md Task 1.4
# @see grimoires/loa/sdd.md §3.2

set -euo pipefail

TAG="[verify-dist-hashes]"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CI_MODE=false

if [[ "${1:-}" == "--ci" ]]; then
  CI_MODE=true
fi

# =============================================================================
# Step 1: Extract expected SHA from package.json
# =============================================================================

EXPECTED_SHA=""
if [[ -f "$ROOT_DIR/package.json" ]]; then
  EXPECTED_SHA=$(node -e '
    const fs = require("fs");
    const path = process.argv[1];
    const pkg = JSON.parse(fs.readFileSync(path, "utf8"));
    const dep = (pkg.devDependencies || {})["@0xhoneyjar/loa-hounfour"] ||
                (pkg.dependencies || {})["@0xhoneyjar/loa-hounfour"] || "";
    const match = dep.match(/#([0-9a-f]{7,40})$/);
    if (match) console.log(match[1]);
  ' "$ROOT_DIR/package.json" 2>/dev/null || echo "")
fi

if [[ -z "$EXPECTED_SHA" ]]; then
  echo "$TAG ERROR: Could not extract hounfour commit SHA from package.json"
  exit 2
fi

echo "$TAG Expected SHA: $EXPECTED_SHA"

# =============================================================================
# Step 2: Find the installed hounfour dist directory
# =============================================================================

HOUNFOUR_DIR=""
for candidate in "$ROOT_DIR"/node_modules/.pnpm/@0xhoneyjar+loa-hounfour@*/node_modules/@0xhoneyjar/loa-hounfour; do
  if [[ -d "$candidate" ]]; then
    HOUNFOUR_DIR="$candidate"
  fi
done

if [[ -z "$HOUNFOUR_DIR" && -d "$ROOT_DIR/node_modules/@0xhoneyjar/loa-hounfour" ]]; then
  HOUNFOUR_DIR="$ROOT_DIR/node_modules/@0xhoneyjar/loa-hounfour"
fi

if [[ -z "$HOUNFOUR_DIR" ]]; then
  echo "$TAG ERROR: hounfour package not found in node_modules"
  echo "$TAG Have you run 'pnpm install'?"
  exit 2
fi

echo "$TAG Hounfour dir: $HOUNFOUR_DIR"

# =============================================================================
# Step 3: Verify dist/SOURCE_SHA (AC-1.4.1)
# =============================================================================

SOURCE_SHA_FILE="$HOUNFOUR_DIR/dist/SOURCE_SHA"
if [[ ! -f "$SOURCE_SHA_FILE" ]]; then
  echo "$TAG ERROR: dist/SOURCE_SHA not found at $SOURCE_SHA_FILE"
  echo "$TAG The dist may not have been rebuilt with verify-dist-hashes support."
  echo "$TAG Run: ./scripts/rebuild-hounfour-dist.sh"
  exit 2
fi

ACTUAL_SOURCE_SHA=$(tr -d '[:space:]' < "$SOURCE_SHA_FILE")

if [[ "$ACTUAL_SOURCE_SHA" != "$EXPECTED_SHA" ]]; then
  echo ""
  echo "$TAG ============================================="
  echo "$TAG  SUPPLY-CHAIN INTEGRITY VIOLATION: SOURCE_SHA"
  echo "$TAG ============================================="
  echo "$TAG"
  echo "$TAG  Expected: $EXPECTED_SHA"
  echo "$TAG  Actual:   $ACTUAL_SOURCE_SHA"
  echo "$TAG"
  echo "$TAG  The dist/ was built from a different commit than what"
  echo "$TAG  package.json pins. This may indicate a stale rebuild or"
  echo "$TAG  a supply-chain attack."
  echo "$TAG"
  echo "$TAG  To fix: rm -rf <hounfour-dir>/dist && pnpm install"
  echo "$TAG ============================================="
  echo ""
  exit 1
fi

echo "$TAG [PASS] SOURCE_SHA matches: $ACTUAL_SOURCE_SHA"

# =============================================================================
# Step 4: Verify dist/DIST_HASH (AC-1.4.2)
# =============================================================================

DIST_HASH_FILE="$HOUNFOUR_DIR/dist/DIST_HASH"
if [[ ! -f "$DIST_HASH_FILE" ]]; then
  echo "$TAG WARN: dist/DIST_HASH not found at $DIST_HASH_FILE"
  if [[ "$CI_MODE" == "true" ]]; then
    echo "$TAG In CI mode, missing DIST_HASH is a failure."
    exit 2
  fi
  echo "$TAG Skipping DIST_HASH verification (not available)."
  exit 0
fi

ACTUAL_DIST_HASH=$(tr -d '[:space:]' < "$DIST_HASH_FILE")

if [[ "$ACTUAL_DIST_HASH" == "UNAVAILABLE" ]]; then
  echo "$TAG WARN: DIST_HASH was not computed during build (npm pack may have failed)."
  if [[ "$CI_MODE" == "true" ]]; then
    echo "$TAG In CI mode, UNAVAILABLE DIST_HASH is a failure."
    exit 2
  fi
  echo "$TAG Skipping DIST_HASH verification."
  exit 0
fi

# Load expected hash from expected-dist-hashes.json
EXPECTED_HASHES_FILE="$ROOT_DIR/scripts/expected-dist-hashes.json"
if [[ ! -f "$EXPECTED_HASHES_FILE" ]]; then
  echo "$TAG ERROR: Expected dist hashes file not found at $EXPECTED_HASHES_FILE"
  exit 2
fi

EXPECTED_DIST_HASH=$(node -e '
  const fs = require("fs");
  const path = process.argv[1];
  const sha = process.argv[2];
  const data = JSON.parse(fs.readFileSync(path, "utf8"));
  const entry = (data.hashes || {})[sha];
  if (entry && entry.dist_hash) {
    console.log(entry.dist_hash);
  }
' "$EXPECTED_HASHES_FILE" "$EXPECTED_SHA" 2>/dev/null || echo "")

if [[ -z "$EXPECTED_DIST_HASH" ]]; then
  echo "$TAG WARN: No expected DIST_HASH found for SHA $EXPECTED_SHA in $EXPECTED_HASHES_FILE"
  if [[ "$CI_MODE" == "true" ]]; then
    echo "$TAG In CI mode, missing expected hash is a failure."
    echo "$TAG Add an entry for $EXPECTED_SHA to scripts/expected-dist-hashes.json"
    exit 2
  fi
  echo "$TAG Skipping DIST_HASH verification (no baseline recorded)."
  exit 0
fi

if [[ "$ACTUAL_DIST_HASH" != "$EXPECTED_DIST_HASH" ]]; then
  echo ""
  echo "$TAG ============================================="
  echo "$TAG  SUPPLY-CHAIN INTEGRITY VIOLATION: DIST_HASH"
  echo "$TAG ============================================="
  echo "$TAG"
  echo "$TAG  Expected: $EXPECTED_DIST_HASH"
  echo "$TAG  Actual:   $ACTUAL_DIST_HASH"
  echo "$TAG"
  echo "$TAG  The dist/ tarball hash does not match the expected value."
  echo "$TAG  This may indicate a non-reproducible build, tooling"
  echo "$TAG  version difference, or a supply-chain attack."
  echo "$TAG"
  echo "$TAG  To investigate:"
  echo "$TAG    1. Run: ./scripts/rebuild-hounfour-dist.sh"
  echo "$TAG    2. Compare DIST_HASH output with expected value"
  echo "$TAG    3. If build env changed, update expected-dist-hashes.json"
  echo "$TAG ============================================="
  echo ""
  exit 1
fi

echo "$TAG [PASS] DIST_HASH matches: ${ACTUAL_DIST_HASH:0:16}..."

# =============================================================================
# Summary
# =============================================================================

echo ""
echo "$TAG ================================"
echo "$TAG  All supply-chain checks passed"
echo "$TAG ================================"
echo "$TAG  SOURCE_SHA: $ACTUAL_SOURCE_SHA (verified)"
echo "$TAG  DIST_HASH:  ${ACTUAL_DIST_HASH:0:16}... (verified)"
echo "$TAG  Commit:     $EXPECTED_SHA"
echo "$TAG ================================"

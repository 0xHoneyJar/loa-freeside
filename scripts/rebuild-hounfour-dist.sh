#!/usr/bin/env bash
# rebuild-hounfour-dist.sh — Rebuild loa-hounfour dist from source with supply-chain verification
#
# The hounfour package is pinned to a git commit (not an npm release).
# GitHub tarballs ship the stale dist/ that was committed, so we must
# clone the repo, build from source, and copy the rebuilt dist/ back.
#
# Supply-chain verification (cycle-039, FR-2):
#   - Isolated clone via git init + fetch --depth 1 (deterministic)
#   - SHA verification before build
#   - set -euo pipefail + explicit error messages
#   - npm ci --ignore-scripts (no post-install from transitive deps)
#   - SOURCE_DATE_EPOCH=0 for reproducible timestamps
#   - dist/SOURCE_SHA provenance file
#   - dist/DIST_HASH via npm pack tarball (canonical file ordering)
#   - All 7 export specifiers verified
#   - Stale-detection updated for v7.9.2 fingerprint
#
# Called automatically via "postinstall" in root package.json.

set -euo pipefail

REPO="https://github.com/0xHoneyJar/loa-hounfour.git"
TAG="[rebuild-hounfour-dist]"
ROOT_DIR=$(pwd -P)

# =============================================================================
# Step 0: Extract the commit SHA from root package.json
# =============================================================================

COMMIT_SHA=""
if [[ -f "package.json" ]]; then
  COMMIT_SHA=$(node -e "
    const pkg = require('./package.json');
    const dep = (pkg.devDependencies || {})['@0xhoneyjar/loa-hounfour'] ||
                (pkg.dependencies || {})['@0xhoneyjar/loa-hounfour'] || '';
    const match = dep.match(/#([0-9a-f]{7,40})$/);
    if (match) console.log(match[1]);
  " 2>/dev/null || echo "")
fi

if [[ -z "$COMMIT_SHA" ]]; then
  echo "$TAG No git commit SHA found in package.json — skipping"
  exit 0
fi

# =============================================================================
# Step 1: Find the installed hounfour package directory
# =============================================================================

HOUNFOUR_DIR=""
for candidate in "$ROOT_DIR"/node_modules/.pnpm/@0xhoneyjar+loa-hounfour@*/node_modules/@0xhoneyjar/loa-hounfour; do
  if [[ -d "$candidate" ]]; then
    HOUNFOUR_DIR="$candidate"
  fi
done

# Also check the hoisted location
if [[ -z "$HOUNFOUR_DIR" && -d "$ROOT_DIR/node_modules/@0xhoneyjar/loa-hounfour" ]]; then
  HOUNFOUR_DIR="$ROOT_DIR/node_modules/@0xhoneyjar/loa-hounfour"
fi

if [[ -z "$HOUNFOUR_DIR" ]]; then
  echo "$TAG No hounfour package found in node_modules — skipping"
  exit 0
fi

# =============================================================================
# Step 2: Check if dist is already up-to-date (v7.9.2 fingerprint)
# =============================================================================

DIST_VERSION=$(grep -oP "CONTRACT_VERSION\s*=\s*'[^']+'" "$HOUNFOUR_DIR/dist/version.js" 2>/dev/null | grep -oP "'[^']+'" | tr -d "'" || echo "")

# v7.9.2 stale-detection: check CONTRACT_VERSION AND v7.9.0+ fingerprint
# (EconomicBoundarySchema is the v7.9.0+ fingerprint — re-exported from economy barrel)
HAS_BOUNDARY_ENGINE=false
if grep -q 'EconomicBoundarySchema' "$HOUNFOUR_DIR/dist/economy/index.js" 2>/dev/null || \
   grep -q 'evaluateEconomicBoundary' "$HOUNFOUR_DIR/dist/index.js" 2>/dev/null; then
  HAS_BOUNDARY_ENGINE=true
fi

# Check SOURCE_SHA provenance file matches expected commit
HAS_VALID_SOURCE_SHA=false
if [[ -f "$HOUNFOUR_DIR/dist/SOURCE_SHA" ]]; then
  EXISTING_SOURCE_SHA=$(cat "$HOUNFOUR_DIR/dist/SOURCE_SHA" 2>/dev/null | tr -d '[:space:]')
  if [[ "$EXISTING_SOURCE_SHA" == "$COMMIT_SHA" ]]; then
    HAS_VALID_SOURCE_SHA=true
  fi
fi

if [[ -n "$DIST_VERSION" && "$HAS_BOUNDARY_ENGINE" == "true" && "$HAS_VALID_SOURCE_SHA" == "true" ]]; then
  # Check that all sub-packages exist
  ALL_SUBPKGS=true
  for subpkg in core economy model governance constraints integrity; do
    if [[ ! -d "$HOUNFOUR_DIR/dist/$subpkg" ]]; then
      ALL_SUBPKGS=false
      break
    fi
  done
  if [[ "$ALL_SUBPKGS" == "true" ]]; then
    echo "$TAG dist/ already up-to-date (CONTRACT_VERSION=$DIST_VERSION, SOURCE_SHA=$COMMIT_SHA) — skipping"
    exit 0
  fi
fi

echo "$TAG Rebuilding hounfour dist from commit ${COMMIT_SHA:0:12}..."
echo "$TAG Current dist version: ${DIST_VERSION:-missing/stale}"
echo "$TAG Boundary engine present: $HAS_BOUNDARY_ENGINE"
echo "$TAG Source SHA valid: $HAS_VALID_SOURCE_SHA"

# =============================================================================
# Step 3: Verify git is available
# =============================================================================

if ! command -v git &>/dev/null; then
  echo "$TAG WARNING: git not available — cannot rebuild from source"
  exit 0
fi

# =============================================================================
# Step 4: Isolated clone via git init + fetch --depth 1 (deterministic)
# =============================================================================

BUILD_DIR=$(mktemp -d)
trap 'rm -rf "$BUILD_DIR"' EXIT

echo "$TAG Cloning loa-hounfour at $COMMIT_SHA (isolated fetch)..."

cd "$BUILD_DIR"
git init repo >/dev/null 2>&1
cd repo
git remote add origin "$REPO"
git fetch --depth 1 origin "$COMMIT_SHA" 2>/dev/null || {
  echo "$TAG SECURITY: Failed to fetch expected SHA $COMMIT_SHA"
  echo "$TAG Falling back to full clone + checkout..."
  cd "$BUILD_DIR"
  rm -rf repo
  git clone "$REPO" repo 2>/dev/null || {
    echo "$TAG WARNING: git clone failed — cannot rebuild"
    exit 0
  }
  cd repo
  git checkout "$COMMIT_SHA" 2>/dev/null || {
    echo "$TAG WARNING: Could not checkout $COMMIT_SHA — cannot rebuild"
    exit 0
  }
}

# If fetch succeeded, detach to FETCH_HEAD
if git rev-parse FETCH_HEAD >/dev/null 2>&1; then
  git checkout --detach FETCH_HEAD 2>/dev/null || true
fi

# =============================================================================
# Step 5: Verify commit SHA in the cloned repo
# =============================================================================

ACTUAL_SHA=$(git rev-parse HEAD)
if [[ "$ACTUAL_SHA" != "$COMMIT_SHA" ]]; then
  echo "$TAG SECURITY: SHA mismatch. Expected $COMMIT_SHA, got $ACTUAL_SHA"
  exit 1
fi

echo "$TAG SHA verified: $ACTUAL_SHA"

# =============================================================================
# Step 6: Two-phase install + build (deterministic)
# =============================================================================

# Suppress network variance
npm config set fund false 2>/dev/null || true
npm config set audit false 2>/dev/null || true

# Phase 1: Install dependencies (no post-install scripts from transitive deps)
if [[ -f "package-lock.json" ]]; then
  echo "$TAG Installing dependencies (npm ci --ignore-scripts)..."
  npm ci --ignore-scripts --registry https://registry.npmjs.org 2>/dev/null || {
    echo "$TAG WARNING: npm ci failed, falling back to npm install --ignore-scripts..."
    npm install --ignore-scripts --registry https://registry.npmjs.org 2>/dev/null || {
      echo "$TAG WARNING: npm install failed — cannot rebuild"
      exit 0
    }
  }
else
  echo "$TAG No package-lock.json found — using npm install --ignore-scripts..."
  npm install --ignore-scripts --registry https://registry.npmjs.org 2>/dev/null || {
    echo "$TAG WARNING: npm install failed — cannot rebuild"
    exit 0
  }
fi

# Phase 2: Explicit build with SOURCE_DATE_EPOCH for reproducibility
export SOURCE_DATE_EPOCH=0

# Find TypeScript compiler
TSC=""
if [[ -x "node_modules/.bin/tsc" ]]; then
  TSC="node_modules/.bin/tsc"
elif command -v npx &>/dev/null; then
  TSC="npx tsc"
else
  echo "$TAG WARNING: No TypeScript compiler found — cannot rebuild"
  exit 0
fi

# Use tsconfig.build.json if available, otherwise default tsconfig.json
TSCONFIG=""
if [[ -f "tsconfig.build.json" ]]; then
  TSCONFIG="-p tsconfig.build.json"
elif [[ -f "tsconfig.json" ]]; then
  TSCONFIG="-p tsconfig.json"
fi

echo "$TAG Compiling TypeScript (SOURCE_DATE_EPOCH=0)..."
$TSC $TSCONFIG 2>/dev/null || {
  echo "$TAG WARNING: TypeScript compilation failed — cannot rebuild"
  exit 0
}

# =============================================================================
# Step 7: Verify the build produced correct output
# =============================================================================

if [[ ! -d "dist" ]]; then
  echo "$TAG WARNING: No dist/ produced — cannot rebuild"
  exit 0
fi

NEW_VERSION=$(grep -oP "CONTRACT_VERSION\s*=\s*'[^']+'" "dist/version.js" 2>/dev/null | grep -oP "'[^']+'" | tr -d "'" || echo "unknown")
echo "$TAG Built dist with CONTRACT_VERSION=$NEW_VERSION"

# =============================================================================
# Step 8: Embed source provenance
# =============================================================================

echo "$ACTUAL_SHA" > dist/SOURCE_SHA
echo "$TAG Embedded SOURCE_SHA: $ACTUAL_SHA"

# =============================================================================
# Step 9: Verify all 7 export specifiers resolve from built dist
# =============================================================================

echo "$TAG Verifying export specifiers..."
SPECIFIERS=("" "/core" "/economy" "/model" "/governance" "/constraints" "/integrity" "/commons")
for specifier in "${SPECIFIERS[@]}"; do
  ENTRY_DIR="dist${specifier}"
  if [[ -n "$specifier" ]]; then
    ENTRY_FILE="${ENTRY_DIR}/index.js"
  else
    ENTRY_FILE="dist/index.js"
  fi
  if [[ ! -f "$ENTRY_FILE" ]]; then
    echo "$TAG MANIFEST: Failed to resolve specifier '${specifier:-root}' — $ENTRY_FILE not found"
    exit 1
  fi
  echo "$TAG   [OK] ${specifier:-root} -> $ENTRY_FILE"
done

# =============================================================================
# Step 10: Compute DIST_HASH via npm pack tarball (canonical file ordering)
# =============================================================================

echo "$TAG Computing DIST_HASH via npm pack..."
PACK_DIR=$(mktemp -d)
DIST_HASH=""
npm pack --pack-destination "$PACK_DIR" 2>/dev/null || {
  echo "$TAG WARNING: npm pack failed — DIST_HASH will not be computed"
  DIST_HASH="UNAVAILABLE"
}

if [[ "$DIST_HASH" != "UNAVAILABLE" ]]; then
  # shellcheck disable=SC2012
  TARBALL=$(ls "$PACK_DIR"/*.tgz 2>/dev/null | head -1)
  if [[ -n "$TARBALL" ]]; then
    DIST_HASH=$(sha256sum "$TARBALL" | cut -d' ' -f1)
    echo "$TAG DIST_HASH: $DIST_HASH"
  else
    echo "$TAG WARNING: No tarball produced by npm pack"
    DIST_HASH="UNAVAILABLE"
  fi
fi

echo "$DIST_HASH" > dist/DIST_HASH
rm -rf "$PACK_DIR"

# =============================================================================
# Step 11: Replace stale dist with rebuilt one
# =============================================================================

cd "$ROOT_DIR"
rm -rf "$HOUNFOUR_DIR/dist"
cp -r "$BUILD_DIR/repo/dist" "$HOUNFOUR_DIR/dist"

echo "$TAG Successfully rebuilt dist (CONTRACT_VERSION=$NEW_VERSION, SOURCE_SHA=${ACTUAL_SHA:0:12}, DIST_HASH=${DIST_HASH:0:16}...)"

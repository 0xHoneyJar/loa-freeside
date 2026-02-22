#!/usr/bin/env bash
# rebuild-hounfour-dist.sh — Rebuild loa-hounfour dist from source
#
# The hounfour package is pinned to a git commit (not an npm release).
# GitHub tarballs ship the stale dist/ that was committed, so we must
# clone the repo, build from source, and copy the rebuilt dist/ back.
#
# Called automatically via "postinstall" in root package.json.

set -euo pipefail

REPO="https://github.com/0xHoneyJar/loa-hounfour.git"
TAG="[rebuild-hounfour-dist]"

# Extract the commit SHA from root package.json
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

# Find the installed hounfour package directory
HOUNFOUR_DIR=""
for candidate in node_modules/.pnpm/@0xhoneyjar+loa-hounfour@*/node_modules/@0xhoneyjar/loa-hounfour; do
  if [[ -d "$candidate" ]]; then
    HOUNFOUR_DIR="$candidate"
  fi
done

# Also check the hoisted location
if [[ -z "$HOUNFOUR_DIR" && -d "node_modules/@0xhoneyjar/loa-hounfour" ]]; then
  HOUNFOUR_DIR="node_modules/@0xhoneyjar/loa-hounfour"
fi

if [[ -z "$HOUNFOUR_DIR" ]]; then
  echo "$TAG No hounfour package found in node_modules — skipping"
  exit 0
fi

# Check if dist is already up-to-date
DIST_VERSION=$(grep -oP "CONTRACT_VERSION\s*=\s*'[^']+'" "$HOUNFOUR_DIR/dist/version.js" 2>/dev/null | grep -oP "'[^']+'" | tr -d "'" || echo "")

if [[ -n "$DIST_VERSION" && "$DIST_VERSION" == "7.0.0" ]]; then
  # Check that sub-packages also exist
  if [[ -d "$HOUNFOUR_DIR/dist/core" && -d "$HOUNFOUR_DIR/dist/economy" ]]; then
    echo "$TAG dist/ already up-to-date (v$DIST_VERSION) — skipping"
    exit 0
  fi
fi

echo "$TAG Rebuilding hounfour dist from commit ${COMMIT_SHA:0:12}..."
echo "$TAG Current dist version: ${DIST_VERSION:-missing/stale}"

# Verify git is available
if ! command -v git &>/dev/null; then
  echo "$TAG WARNING: git not available — cannot rebuild from source"
  exit 0
fi

# Clone and build in a temp directory
BUILD_DIR=$(mktemp -d)
trap 'rm -rf "$BUILD_DIR"' EXIT

echo "$TAG Cloning loa-hounfour at $COMMIT_SHA..."
git clone --depth 1 "$REPO" "$BUILD_DIR/repo" 2>/dev/null || {
  # Shallow clone may not work with specific commits — try full clone
  git clone "$REPO" "$BUILD_DIR/repo" 2>/dev/null || {
    echo "$TAG WARNING: git clone failed — cannot rebuild"
    exit 0
  }
}

cd "$BUILD_DIR/repo"
git checkout "$COMMIT_SHA" 2>/dev/null || {
  echo "$TAG WARNING: Could not checkout $COMMIT_SHA — cannot rebuild"
  exit 0
}

# Install dependencies and build
if [[ -f "package.json" ]]; then
  npm install --ignore-scripts 2>/dev/null || true
fi

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

echo "$TAG Compiling TypeScript..."
$TSC 2>/dev/null || {
  echo "$TAG WARNING: TypeScript compilation failed — cannot rebuild"
  exit 0
}

# Verify the build produced correct output
if [[ ! -d "dist" ]]; then
  echo "$TAG WARNING: No dist/ produced — cannot rebuild"
  exit 0
fi

NEW_VERSION=$(grep -oP "CONTRACT_VERSION\s*=\s*'[^']+'" "dist/version.js" 2>/dev/null | grep -oP "'[^']+'" | tr -d "'" || echo "unknown")
echo "$TAG Built dist with CONTRACT_VERSION=$NEW_VERSION"

# Replace stale dist with rebuilt one
cd - >/dev/null
rm -rf "$HOUNFOUR_DIR/dist"
cp -r "$BUILD_DIR/repo/dist" "$HOUNFOUR_DIR/dist"

echo "$TAG Successfully rebuilt dist (v$NEW_VERSION)"

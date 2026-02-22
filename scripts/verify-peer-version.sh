#!/usr/bin/env bash
# =============================================================================
# Pre-Deploy Peer Version Verification — Task 4.9 (Sprint 325)
# =============================================================================
# Verifies that loa-finn supports the loa-hounfour contract version before
# deploying v7.0.0 changes. This is a pre-deploy gate, not a runtime check.
#
# Strategy (ordered by priority):
#   1. Hit loa-finn discovery endpoint (/.well-known/loa-hounfour)
#   2. Fall back to parsing x-contract-version response header from /health
#   3. Validate against dual-accept policy: v6.x and v7.0.0
#
# Usage:
#   ./scripts/verify-peer-version.sh
#   ./scripts/verify-peer-version.sh --url https://loa-finn-staging.fly.dev
#   ./scripts/verify-peer-version.sh --skip   # local dev bypass
#
# Exit codes:
#   0 — Peer version is compatible (v6.x or v7.0.0)
#   1 — Peer version is incompatible or unreachable
#
# Environment:
#   LOA_FINN_URL  — Override default loa-finn endpoint
#
# @see grimoires/loa/sprint.md Task 4.9
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Constants — canonical from @0xhoneyjar/loa-hounfour
# ---------------------------------------------------------------------------

CONTRACT_VERSION="7.0.0"
MIN_SUPPORTED_VERSION="6.0.0"
CURL_TIMEOUT=10

# Dual-accept policy (Task 4.9 §4):
#   Accept v6.x (cross-major, within support window) and v7.0.0 (current).
#   Reject anything below 6.0.0 or above 7.x.
ACCEPT_MAJOR_MIN=6
ACCEPT_MAJOR_MAX=7

# ---------------------------------------------------------------------------
# Parse Arguments
# ---------------------------------------------------------------------------

FINN_URL="${LOA_FINN_URL:-https://loa-finn-staging.fly.dev}"
SKIP=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --url)
      if [[ $# -lt 2 ]]; then
        echo "ERROR: --url requires a value"
        exit 1
      fi
      FINN_URL="$2"; shift 2 ;;
    --skip)
      SKIP=true; shift ;;
    -h|--help)
      echo "Usage: $0 [--url <loa-finn-url>] [--skip]"
      echo ""
      echo "Pre-deploy verification that loa-finn supports the contract version."
      echo ""
      echo "Options:"
      echo "  --url   loa-finn endpoint (default: \$LOA_FINN_URL or https://loa-finn-staging.fly.dev)"
      echo "  --skip  Skip verification (local dev bypass)"
      echo "  -h      Show this help"
      echo ""
      echo "Environment:"
      echo "  LOA_FINN_URL  Override default loa-finn endpoint"
      echo ""
      echo "Dual-Accept Policy:"
      echo "  Accepts: v6.0.0 – v7.x.x (CONTRACT_VERSION=$CONTRACT_VERSION, MIN_SUPPORTED=$MIN_SUPPORTED_VERSION)"
      echo "  Rejects: < v6.0.0, > v7.x.x"
      exit 0
      ;;
    *) echo "ERROR: Unknown option: $1"; exit 1 ;;
  esac
done

# ---------------------------------------------------------------------------
# Skip gate (local dev)
# ---------------------------------------------------------------------------

if $SKIP; then
  echo "[verify-peer-version] --skip flag set — skipping peer version verification"
  echo "[verify-peer-version] WARNING: This bypasses the pre-deploy gate. Do NOT use in CI/CD."
  exit 0
fi

# ---------------------------------------------------------------------------
# Prerequisites
# ---------------------------------------------------------------------------

for cmd in curl jq; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "ERROR: Required command '$cmd' not found. Install it and retry."
    exit 1
  fi
done

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# Parse a semver string into major.minor.patch components.
# Returns space-separated: "major minor patch" or empty on failure.
parse_semver() {
  local ver="$1"
  if [[ "$ver" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+) ]]; then
    echo "${BASH_REMATCH[1]} ${BASH_REMATCH[2]} ${BASH_REMATCH[3]}"
  fi
}

# Check if a version string is within the dual-accept window.
# Accepts: major >= ACCEPT_MAJOR_MIN && major <= ACCEPT_MAJOR_MAX
# and overall >= MIN_SUPPORTED_VERSION.
check_version_compatible() {
  local peer_version="$1"
  local parsed
  parsed=$(parse_semver "$peer_version")

  if [[ -z "$parsed" ]]; then
    echo "INCOMPATIBLE"
    echo "Invalid semver format: '$peer_version'"
    return
  fi

  local major minor patch
  read -r major minor patch <<< "$parsed"

  # Below minimum supported
  local min_parsed min_major min_minor min_patch
  min_parsed=$(parse_semver "$MIN_SUPPORTED_VERSION")
  read -r min_major min_minor min_patch <<< "$min_parsed"

  if (( major < min_major )) || { (( major == min_major )) && (( minor < min_minor )); } || \
     { (( major == min_major )) && (( minor == min_minor )) && (( patch < min_patch )); }; then
    echo "INCOMPATIBLE"
    echo "Version $peer_version is below minimum supported $MIN_SUPPORTED_VERSION"
    return
  fi

  # Above maximum accepted major
  if (( major > ACCEPT_MAJOR_MAX )); then
    echo "INCOMPATIBLE"
    echo "Version $peer_version is a future major version beyond v${ACCEPT_MAJOR_MAX}.x.x (local=$CONTRACT_VERSION)"
    return
  fi

  # Cross-major within support window (v6.x with our v7.0.0)
  local local_parsed local_major
  local_parsed=$(parse_semver "$CONTRACT_VERSION")
  read -r local_major _ _ <<< "$local_parsed"

  if (( major < local_major )); then
    echo "COMPATIBLE_WITH_WARNING"
    echo "Cross-major: peer=$peer_version, local=$CONTRACT_VERSION — dual-accept active"
    return
  fi

  # Same major, any minor/patch difference
  echo "COMPATIBLE"
  echo "Peer version $peer_version is compatible with local $CONTRACT_VERSION"
}

# ---------------------------------------------------------------------------
# Banner
# ---------------------------------------------------------------------------

echo "================================================================"
echo "  Pre-Deploy Peer Version Verification"
echo "================================================================"
echo ""
echo "  Local CONTRACT_VERSION:  $CONTRACT_VERSION"
echo "  MIN_SUPPORTED_VERSION:   $MIN_SUPPORTED_VERSION"
echo "  Dual-Accept Window:      v${ACCEPT_MAJOR_MIN}.0.0 – v${ACCEPT_MAJOR_MAX}.x.x"
echo "  loa-finn URL:            $FINN_URL"
echo ""

# ---------------------------------------------------------------------------
# Step 1: Try discovery endpoint (/.well-known/loa-hounfour)
# ---------------------------------------------------------------------------

echo "── Step 1: Discovery Endpoint ────────────────────────────────"
echo ""
echo "  Checking: ${FINN_URL}/.well-known/loa-hounfour"

PEER_VERSION=""
DISCOVERY_OK=false

discovery_response=$(curl -sf --max-time "$CURL_TIMEOUT" \
  "${FINN_URL}/.well-known/loa-hounfour" 2>/dev/null) && DISCOVERY_OK=true || DISCOVERY_OK=false

if $DISCOVERY_OK && [[ -n "$discovery_response" ]]; then
  # Try to parse protocol_version from JSON
  parsed_version=$(echo "$discovery_response" | jq -r '.protocol_version // .contract_version // empty' 2>/dev/null)

  if [[ -n "$parsed_version" ]]; then
    PEER_VERSION="$parsed_version"
    echo "  FOUND   Discovery endpoint returned protocol_version: $PEER_VERSION"
  else
    echo "  WARN    Discovery endpoint returned JSON but no protocol_version field"
    echo "          Response: $(echo "$discovery_response" | head -c 200)"
  fi
else
  echo "  SKIP    Discovery endpoint not available (404 or unreachable)"
  echo "          This is expected if loa-finn has not implemented the endpoint yet."
fi

echo ""

# ---------------------------------------------------------------------------
# Step 2: Fallback — parse x-contract-version header from /health
# ---------------------------------------------------------------------------

if [[ -z "$PEER_VERSION" ]]; then
  echo "── Step 2: Header Fallback (x-contract-version) ──────────────"
  echo ""
  echo "  Checking: ${FINN_URL}/health (response headers)"

  # Use -D to dump headers, -o to discard body
  header_file=$(mktemp)
  trap 'rm -f "$header_file"' EXIT

  curl -sf --max-time "$CURL_TIMEOUT" \
    -D "$header_file" -o /dev/null \
    "${FINN_URL}/health" 2>/dev/null && HEALTH_OK=true || HEALTH_OK=false

  if $HEALTH_OK && [[ -f "$header_file" ]]; then
    # Case-insensitive header search
    header_version=$(grep -i '^x-contract-version:' "$header_file" 2>/dev/null | head -1 | sed 's/^[^:]*: *//; s/\r$//' || true)

    if [[ -n "$header_version" ]]; then
      PEER_VERSION="$header_version"
      echo "  FOUND   x-contract-version header: $PEER_VERSION"
    else
      echo "  WARN    /health responded but no x-contract-version header found"
      echo "          Available headers:"
      grep -i 'version\|contract' "$header_file" 2>/dev/null | sed 's/^/            /' || echo "            (none matching *version* or *contract*)"
    fi
  else
    echo "  FAIL    /health endpoint unreachable at ${FINN_URL}/health"
    echo ""
    echo "  Cannot determine loa-finn contract version."
    echo "  Ensure the URL is correct and the service is running."
    echo ""
    echo "================================================================"
    echo "  Result: FAIL (peer unreachable)"
    echo "================================================================"
    exit 1
  fi

  echo ""
fi

# ---------------------------------------------------------------------------
# Step 3: Evaluate compatibility
# ---------------------------------------------------------------------------

echo "── Step 3: Version Compatibility Check ────────────────────────"
echo ""

if [[ -z "$PEER_VERSION" ]]; then
  echo "  WARN    Could not determine peer version from any source."
  echo "          Neither discovery endpoint nor x-contract-version header returned a version."
  echo ""
  echo "          This may indicate loa-finn is running a pre-v6.0.0 version"
  echo "          that does not advertise its contract version."
  echo ""
  echo "================================================================"
  echo "  Result: FAIL (peer version unknown)"
  echo "================================================================"
  exit 1
fi

echo "  Peer version:  $PEER_VERSION"
echo "  Local version: $CONTRACT_VERSION"
echo ""

# Run compatibility check
compat_result=$(check_version_compatible "$PEER_VERSION")
compat_status=$(echo "$compat_result" | head -1)
compat_message=$(echo "$compat_result" | tail -1)

case "$compat_status" in
  COMPATIBLE)
    echo "  PASS    $compat_message"
    echo ""
    echo "================================================================"
    echo "  Result: PASS"
    echo "  Peer version $PEER_VERSION is fully compatible."
    echo "================================================================"
    exit 0
    ;;
  COMPATIBLE_WITH_WARNING)
    echo "  PASS    $compat_message"
    echo ""
    echo "  NOTE: loa-finn is on an older major version (v${PEER_VERSION})."
    echo "  Dual-accept is active — both v6.x and v7.0.0 response shapes accepted."
    echo "  Field name mapping may be required for v6.x response bodies."
    echo ""
    echo "================================================================"
    echo "  Result: PASS (dual-accept)"
    echo "  Peer version $PEER_VERSION is within the support window."
    echo "================================================================"
    exit 0
    ;;
  INCOMPATIBLE)
    echo "  FAIL    $compat_message"
    echo ""
    echo "  The peer's contract version is outside the acceptable range."
    echo "  Acceptable: v${ACCEPT_MAJOR_MIN}.0.0 through v${ACCEPT_MAJOR_MAX}.x.x"
    echo "  Received:   v${PEER_VERSION}"
    echo ""
    echo "  ACTION REQUIRED:"
    echo "    - If peer is too old: upgrade loa-finn to >= $MIN_SUPPORTED_VERSION"
    echo "    - If peer is too new: upgrade this repo's @0xhoneyjar/loa-hounfour dependency"
    echo ""
    echo "================================================================"
    echo "  Result: FAIL (incompatible)"
    echo "================================================================"
    exit 1
    ;;
  *)
    echo "  ERROR   Unexpected compatibility result: $compat_status"
    echo ""
    echo "================================================================"
    echo "  Result: FAIL (internal error)"
    echo "================================================================"
    exit 1
    ;;
esac

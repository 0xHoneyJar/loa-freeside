#!/usr/bin/env bash
# =============================================================================
# E2E Runner Script — Containerized Cross-System Tests
# =============================================================================
# Clones loa-finn at a pinned SHA, builds Docker images, runs the full E2E
# test suite against real containers, and tears down the stack.
#
# Usage:
#   LOA_FINN_SHA=abc123 ./scripts/run-e2e.sh
#   LOA_FINN_SHA=abc123 SKIP_BUILD=1 ./scripts/run-e2e.sh
#
# Exit codes:
#   0 — All tests passed
#   1 — Test failures
#   2 — Infrastructure failure (clone, build, startup)
#
# @see SDD §2.1.2 E2E Runner Script
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

LOA_FINN_SHA="${LOA_FINN_SHA:?ERROR: LOA_FINN_SHA is required (pinned commit hash)}"
LOA_FINN_REPO="${LOA_FINN_REPO:-git@github.com:0xHoneyJar/loa-finn.git}"
SKIP_BUILD="${SKIP_BUILD:-}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-120}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CHECKOUT_DIR="$REPO_ROOT/.loa-finn-checkout"
COMPOSE_FILE="$REPO_ROOT/tests/e2e/docker-compose.e2e.yml"

# Single source of truth for LOA_FINN_DIR (absolute path)
export LOA_FINN_DIR="$CHECKOUT_DIR"

# ---------------------------------------------------------------------------
# Timing
# ---------------------------------------------------------------------------

TOTAL_START=$(date +%s)
CLONE_TIME=0
BUILD_TIME=0
TEST_TIME=0

timer_start() { eval "${1}_START=$(date +%s)"; }
timer_end() {
  local start_var="${1}_START"
  local elapsed=$(( $(date +%s) - ${!start_var} ))
  eval "${1}_TIME=$elapsed"
}

# ---------------------------------------------------------------------------
# Cleanup — always tear down the stack
# ---------------------------------------------------------------------------

cleanup() {
  echo ""
  echo "═══════════════════════════════════════════════════════"
  echo "  Tearing down Docker Compose stack..."
  echo "═══════════════════════════════════════════════════════"
  # Shred ephemeral key material before Docker teardown (R9-2)
  if [ -d "$REPO_ROOT/.e2e-keys" ]; then
    rm -rf "$REPO_ROOT/.e2e-keys"
    echo "[run-e2e] Ephemeral keys shredded"
  fi
  docker compose -f "$COMPOSE_FILE" down -v --remove-orphans 2>/dev/null || true
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
# Generate test JWT keypair (ES256)
# ---------------------------------------------------------------------------

generate_test_keypair() {
  # Lifecycle: generate → use → shred (keys removed in cleanup() trap)
  echo "[run-e2e] Generating ES256 test keypair..."
  local key_dir="$REPO_ROOT/.e2e-keys"
  mkdir -p "$key_dir"

  openssl ecparam -genkey -name prime256v1 -noout -out "$key_dir/test-private.pem" 2>/dev/null
  openssl ec -in "$key_dir/test-private.pem" -pubout -out "$key_dir/test-public.pem" 2>/dev/null

  # Read private key as single-line for env var
  AGENT_JWT_PRIVATE_KEY=$(cat "$key_dir/test-private.pem")
  export AGENT_JWT_PRIVATE_KEY
  echo "[run-e2e] Test keypair generated in $key_dir"
}

# ---------------------------------------------------------------------------
# Step 1: Clone loa-finn at pinned SHA
# ---------------------------------------------------------------------------

echo "═══════════════════════════════════════════════════════"
echo "  E2E Runner — Containerized Cross-System Tests"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "  LOA_FINN_SHA:  $LOA_FINN_SHA"
echo "  LOA_FINN_REPO: $LOA_FINN_REPO"
echo "  LOA_FINN_DIR:  $LOA_FINN_DIR"
echo "  SKIP_BUILD:    ${SKIP_BUILD:-no}"
echo ""

timer_start CLONE

if [ -d "$CHECKOUT_DIR/.git" ]; then
  echo "[run-e2e] Existing checkout found, fetching and resetting to $LOA_FINN_SHA..."
  cd "$CHECKOUT_DIR"
  git fetch origin 2>/dev/null || {
    echo "[run-e2e] ERROR: git fetch failed"
    exit 2
  }
  git checkout "$LOA_FINN_SHA" 2>/dev/null || {
    echo "[run-e2e] ERROR: SHA $LOA_FINN_SHA not found"
    exit 2
  }
  # Verify checkout integrity (R9-1: supply chain)
  actual_sha=$(git rev-parse HEAD)
  if [ "$actual_sha" != "$LOA_FINN_SHA" ]; then
    echo "[run-e2e] INTEGRITY VIOLATION: expected $LOA_FINN_SHA, got $actual_sha"
    exit 2
  fi
  echo "[run-e2e] SHA verified: $actual_sha (tree: $(git rev-parse HEAD^{tree}))"
  cd "$REPO_ROOT"
else
  echo "[run-e2e] Cloning loa-finn at $LOA_FINN_SHA..."
  git clone "$LOA_FINN_REPO" "$CHECKOUT_DIR" 2>/dev/null || {
    echo "[run-e2e] ERROR: git clone failed"
    exit 2
  }
  cd "$CHECKOUT_DIR"
  git checkout "$LOA_FINN_SHA" 2>/dev/null || {
    echo "[run-e2e] ERROR: SHA $LOA_FINN_SHA not found after clone"
    exit 2
  }
  # Verify checkout integrity (R9-1: supply chain)
  actual_sha=$(git rev-parse HEAD)
  if [ "$actual_sha" != "$LOA_FINN_SHA" ]; then
    echo "[run-e2e] INTEGRITY VIOLATION: expected $LOA_FINN_SHA, got $actual_sha"
    exit 2
  fi
  echo "[run-e2e] SHA verified: $actual_sha (tree: $(git rev-parse HEAD^{tree}))"
  cd "$REPO_ROOT"
fi

timer_end CLONE
echo "[run-e2e] Clone/checkout completed in ${CLONE_TIME}s"

# ---------------------------------------------------------------------------
# Step 2: Generate test keypair
# ---------------------------------------------------------------------------

generate_test_keypair

# ---------------------------------------------------------------------------
# Step 3: Build Docker images
# ---------------------------------------------------------------------------

timer_start BUILD

if [ -n "$SKIP_BUILD" ]; then
  echo "[run-e2e] SKIP_BUILD set — using cached images"
else
  echo "[run-e2e] Building Docker images..."
  docker compose -f "$COMPOSE_FILE" build 2>&1 || {
    echo "[run-e2e] ERROR: Docker build failed"
    exit 2
  }
fi

timer_end BUILD
echo "[run-e2e] Build completed in ${BUILD_TIME}s"

# ---------------------------------------------------------------------------
# Step 4: Start compose stack and wait for healthchecks
# ---------------------------------------------------------------------------

echo "[run-e2e] Starting Docker Compose stack..."
docker compose -f "$COMPOSE_FILE" up -d 2>&1 || {
  echo "[run-e2e] ERROR: Docker compose up failed"
  exit 2
}

echo "[run-e2e] Waiting for all services to be healthy (timeout: ${HEALTH_TIMEOUT}s)..."
elapsed=0
while [ $elapsed -lt "$HEALTH_TIMEOUT" ]; do
  # Check if all services are healthy
  # NOTE: Docker Compose v2 --format json output varies by version:
  #   v2.20-v2.23: NDJSON (one JSON object per line)
  #   v2.24+: may emit a JSON array
  # slurp + flatten(1) normalizes both: NDJSON → [obj,...] and [[obj,...]] → [obj,...]
  unhealthy=$(docker compose -f "$COMPOSE_FILE" ps --format json 2>/dev/null \
    | jq -s 'flatten(1)[] | select(.Health != "healthy" and .Health != "") | .Name' 2>/dev/null \
    | wc -l)

  all_running=$(docker compose -f "$COMPOSE_FILE" ps --format json 2>/dev/null \
    | jq -s 'flatten(1)[] | select(.State == "running") | .Name' 2>/dev/null \
    | wc -l)

  if [ "$unhealthy" -eq 0 ] && [ "$all_running" -ge 3 ]; then
    echo "[run-e2e] All services healthy after ${elapsed}s"
    break
  fi

  if [ $elapsed -gt 0 ] && [ $((elapsed % 15)) -eq 0 ]; then
    echo "[run-e2e] Still waiting... (${elapsed}s elapsed, ${unhealthy} not yet healthy)"
  fi

  sleep 5
  elapsed=$((elapsed + 5))
done

if [ $elapsed -ge "$HEALTH_TIMEOUT" ]; then
  echo "[run-e2e] ERROR: Health check timeout after ${HEALTH_TIMEOUT}s"
  echo ""
  echo "Service status:"
  docker compose -f "$COMPOSE_FILE" ps 2>/dev/null
  echo ""
  echo "Service logs:"
  docker compose -f "$COMPOSE_FILE" logs --tail=50 2>/dev/null
  exit 2
fi

# Verify arrakis health endpoint directly
echo "[run-e2e] Verifying arrakis health..."
arrakis_health=$(curl -sf http://localhost:3099/health 2>/dev/null) || {
  echo "[run-e2e] WARNING: arrakis /health not responding"
}
echo "[run-e2e] Arrakis health: $arrakis_health"

# ---------------------------------------------------------------------------
# Step 5: Run E2E tests in Docker mode
# ---------------------------------------------------------------------------

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  Running E2E Tests (Docker mode)"
echo "═══════════════════════════════════════════════════════"

timer_start TEST

export E2E_MODE=docker
export E2E_BASE_URL=http://localhost:8099
export SKIP_E2E=false

cd "$REPO_ROOT"
TEST_EXIT=0
npx vitest run tests/e2e/agent-gateway-e2e.test.ts --reporter=verbose 2>&1 || TEST_EXIT=$?

timer_end TEST

# ---------------------------------------------------------------------------
# Step 6: Print timing summary
# ---------------------------------------------------------------------------

TOTAL_TIME=$(( $(date +%s) - TOTAL_START ))

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  E2E Run Summary"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "  Clone:    ${CLONE_TIME}s"
echo "  Build:    ${BUILD_TIME}s"
echo "  Tests:    ${TEST_TIME}s"
echo "  Total:    ${TOTAL_TIME}s"
echo ""

if [ $TEST_EXIT -eq 0 ]; then
  echo "  Result:   PASS ✓"
else
  echo "  Result:   FAIL ✗ (exit code: $TEST_EXIT)"
  echo ""
  echo "  Service logs (last 30 lines each):"
  docker compose -f "$COMPOSE_FILE" logs --tail=30 arrakis-e2e 2>/dev/null
  docker compose -f "$COMPOSE_FILE" logs --tail=30 loa-finn-e2e 2>/dev/null
fi

echo ""
echo "═══════════════════════════════════════════════════════"

# Map vitest exit code: 0=pass, anything else=test failure (exit 1)
if [ $TEST_EXIT -eq 0 ]; then
  exit 0
else
  exit 1
fi

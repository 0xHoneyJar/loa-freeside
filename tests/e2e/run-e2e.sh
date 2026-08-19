#!/usr/bin/env bash
# =============================================================================
# E2E Runner — Host-Side Deterministic Test Runner
# =============================================================================
# Starts the Docker Compose E2E stack, waits for health via `docker compose
# exec -T`, runs ALL E2E tests, captures logs, and tears down unconditionally.
#
# This is the runner invoked by `pnpm test:e2e` from themes/sietch/.
# For the full infrastructure script (clone loa-finn, build images), see
# scripts/run-e2e.sh instead.
#
# Usage:
#   ./tests/e2e/run-e2e.sh
#   E2E_REDIS_PORT=6399 E2E_ARRAKIS_PORT=3099 ./tests/e2e/run-e2e.sh
#
# Exit codes:
#   0 — All tests passed
#   1 — Test failures
#   2 — Build or infrastructure failure
#
# Requires: Docker 24+, Compose v2.20+
# Must be run from the repository root.
#
# @see SDD §3.1 E2E Runner Script
# @see Sprint 356, Task 2.1
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration (parameterized ports, SDD IMP-005)
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.e2e.yml"

# The loa-finn-e2e service builds from a sibling-repo checkout that THIS script
# does not create — scripts/run-e2e.sh clones it, at "$REPO_ROOT/.loa-finn-checkout".
# Export the same absolute path: docker compose resolves the
# `${LOA_FINN_DIR:-.loa-finn-checkout}` default relative to the COMPOSE FILE's
# directory, so leaving it unset silently looks in tests/e2e/ and fails with an
# opaque "unable to prepare context: path ... not found".
export LOA_FINN_DIR="${LOA_FINN_DIR:-$REPO_ROOT/.loa-finn-checkout}"

# Fail with a diagnosis instead of a docker build-context error.
if [ ! -d "$LOA_FINN_DIR" ]; then
  echo "[run-e2e] ERROR: loa-finn checkout missing at $LOA_FINN_DIR" >&2
  echo "[run-e2e] The loa-finn-e2e service builds from that directory. This script" >&2
  echo "[run-e2e] only starts the stack; it does not provision it. Either:" >&2
  echo "[run-e2e]   • run scripts/run-e2e.sh instead (clones loa-finn; needs" >&2
  echo "[run-e2e]     LOA_FINN_SHA and read access to \$LOA_FINN_REPO), or" >&2
  echo "[run-e2e]   • point LOA_FINN_DIR at an existing checkout." >&2
  exit 2
fi

HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-60}"
TEST_TIMEOUT="${TEST_TIMEOUT:-120000}"
E2E_LOG_DIR="${E2E_LOG_DIR:-$REPO_ROOT/.run/e2e-logs}"

# Port defaults (match docker-compose.e2e.yml)
export E2E_REDIS_PORT="${E2E_REDIS_PORT:-6399}"
export E2E_ARRAKIS_PORT="${E2E_ARRAKIS_PORT:-3099}"
export E2E_LOAFINN_PORT="${E2E_LOAFINN_PORT:-8099}"
export E2E_VALIDATOR_PORT="${E2E_VALIDATOR_PORT:-3199}"

# ---------------------------------------------------------------------------
# Cleanup — always tear down (AC-1.7)
# ---------------------------------------------------------------------------

cleanup() {
  local exit_code=$?
  echo ""
  echo "═══════════════════════════════════════════════════════"
  echo "  Capturing logs before teardown..."
  echo "═══════════════════════════════════════════════════════"

  mkdir -p "$E2E_LOG_DIR"
  for svc in redis-e2e arrakis-e2e loa-finn-e2e contract-validator; do
    docker compose -f "$COMPOSE_FILE" logs "$svc" > "$E2E_LOG_DIR/${svc}.log" 2>&1 || true
  done
  echo "[run-e2e] Logs saved to $E2E_LOG_DIR"

  # On failure, ECHO the tails as well as saving them. Saving alone puts the
  # cause in an uploaded artifact, which needs a separate authenticated download
  # to read — so a red run shows only "Docker compose up failed" and the actual
  # reason stays invisible to anyone reading the job log. Bounded to 40 lines a
  # service so a green run's output is unaffected and a red one stays readable.
  if [ "$exit_code" -ne 0 ]; then
    for svc in arrakis-e2e loa-finn-e2e contract-validator; do
      [ -s "$E2E_LOG_DIR/${svc}.log" ] || continue
      echo ""
      echo "─── last 40 lines: ${svc} ──────────────────────────────"
      tail -n 40 "$E2E_LOG_DIR/${svc}.log"
    done
    echo "───────────────────────────────────────────────────────"
  fi

  echo "[run-e2e] Tearing down Docker Compose stack..."
  docker compose -f "$COMPOSE_FILE" down -v --remove-orphans 2>/dev/null || true
  exit "$exit_code"
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
# Step 1: Start compose stack
# ---------------------------------------------------------------------------

echo "═══════════════════════════════════════════════════════"
echo "  E2E Runner — Deterministic Test Execution"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "  Ports: redis=$E2E_REDIS_PORT arrakis=$E2E_ARRAKIS_PORT loa-finn=$E2E_LOAFINN_PORT validator=$E2E_VALIDATOR_PORT"
echo "  Health timeout: ${HEALTH_TIMEOUT}s"
echo "  Test timeout: ${TEST_TIMEOUT}ms"
echo ""

echo "[run-e2e] Starting Docker Compose stack..."
docker compose -f "$COMPOSE_FILE" up -d 2>&1 || {
  echo "[run-e2e] ERROR: Docker compose up failed"
  exit 2
}

# ---------------------------------------------------------------------------
# Step 2: Wait for health via docker compose exec -T (AC-1.2)
# ---------------------------------------------------------------------------

wait_for_health() {
  local service="$1"
  local check_cmd="$2"
  local elapsed=0

  while [ "$elapsed" -lt "$HEALTH_TIMEOUT" ]; do
    if docker compose -f "$COMPOSE_FILE" exec -T "$service" sh -c "$check_cmd" >/dev/null 2>&1; then
      echo "[run-e2e] $service healthy after ${elapsed}s"
      return 0
    fi
    sleep 3
    elapsed=$((elapsed + 3))
  done

  echo "[run-e2e] ERROR: $service health timeout after ${HEALTH_TIMEOUT}s"
  return 1
}

echo "[run-e2e] Waiting for services to be healthy..."

wait_for_health "redis-e2e" "redis-cli ping" || exit 2
wait_for_health "arrakis-e2e" "curl -sf http://localhost:3000/health" || exit 2
wait_for_health "loa-finn-e2e" "curl -sf http://localhost:8080/v1/health" || exit 2
wait_for_health "contract-validator" "wget -qO- http://localhost:3100/health" || exit 2

echo "[run-e2e] All 4 services healthy"

# ---------------------------------------------------------------------------
# Step 3: Discover and run E2E tests (AC-1.8)
# ---------------------------------------------------------------------------

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  Running E2E Tests"
echo "═══════════════════════════════════════════════════════"

export E2E_MODE=docker
export E2E_BASE_URL="http://localhost:$E2E_LOAFINN_PORT"
export ARRAKIS_URL="http://localhost:$E2E_ARRAKIS_PORT"
export VALIDATOR_URL="http://localhost:$E2E_VALIDATOR_PORT"
export SKIP_E2E=false

# Discover E2E test files (fail if zero — prevents false-green)
e2e_files=$(find "$SCRIPT_DIR" -maxdepth 1 \( -name '*.e2e.test.ts' -o -name '*.test.ts' \) | grep -v 'stub' | sort)
e2e_count=$(echo "$e2e_files" | grep -c . || true)

if [ "$e2e_count" -eq 0 ]; then
  echo "[run-e2e] ERROR: Zero E2E test files discovered in $SCRIPT_DIR"
  echo "[run-e2e] This prevents a false-green result."
  exit 1
fi

echo "[run-e2e] Discovered $e2e_count E2E test files:"
echo "$e2e_files" | sed 's/^/  /'
echo ""

# Run from themes/sietch/ for vitest config resolution
cd "$REPO_ROOT/themes/sietch"

TEST_EXIT=0
npx vitest run "$SCRIPT_DIR/"*.test.ts \
  --testTimeout "$TEST_TIMEOUT" \
  --sequence.shuffle false \
  --reporter=verbose 2>&1 || TEST_EXIT=$?

# ---------------------------------------------------------------------------
# Step 4: Static egress assertion (AC-6.6, Task 2.5)
# ---------------------------------------------------------------------------

EGRESS_EXIT=0
if [ $TEST_EXIT -eq 0 ]; then
  echo ""
  bash "$SCRIPT_DIR/check-egress.sh" "$COMPOSE_FILE" || EGRESS_EXIT=$?
fi

# ---------------------------------------------------------------------------
# Step 5: Results
# ---------------------------------------------------------------------------

echo ""
echo "═══════════════════════════════════════════════════════"
if [ $TEST_EXIT -eq 0 ] && [ $EGRESS_EXIT -eq 0 ]; then
  echo "  E2E Result: PASS"
elif [ $TEST_EXIT -ne 0 ]; then
  echo "  E2E Result: FAIL (test exit code: $TEST_EXIT)"
else
  echo "  E2E Result: FAIL (egress assertion failed)"
fi
echo "  Logs: $E2E_LOG_DIR"
echo "═══════════════════════════════════════════════════════"

# Map exit: 0=pass, else=fail
if [ $TEST_EXIT -eq 0 ] && [ $EGRESS_EXIT -eq 0 ]; then
  exit 0
else
  exit 1
fi

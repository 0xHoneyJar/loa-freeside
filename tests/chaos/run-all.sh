#!/bin/bash
# Run all chaos test scenarios

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCENARIOS_DIR="$SCRIPT_DIR/scenarios"
ENV="${ENV:-local}"
SPECIFIC_SCENARIO="${1:-}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_header() { echo -e "${BLUE}$1${NC}"; }

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --scenario)
      SPECIFIC_SCENARIO="$2"
      shift 2
      ;;
    --env)
      ENV="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

echo ""
log_header "╔══════════════════════════════════════════════╗"
log_header "║     Gateway Proxy Chaos Test Suite           ║"
log_header "╚══════════════════════════════════════════════╝"
echo ""
echo "Environment: $ENV"
echo "Date: $(date)"
echo ""

# Results tracking
declare -A RESULTS
PASSED=0
FAILED=0

run_scenario() {
  local scenario=$1
  local script="$SCENARIOS_DIR/${scenario}.sh"

  if [[ ! -f "$script" ]]; then
    log_error "Scenario script not found: $script"
    RESULTS[$scenario]="SKIPPED"
    return
  fi

  echo ""
  log_header "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  log_header "Running: $scenario"
  log_header "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  if bash "$script" "$ENV"; then
    RESULTS[$scenario]="PASSED"
    ((PASSED++))
  else
    RESULTS[$scenario]="FAILED"
    ((FAILED++))
  fi

  # Cool down between scenarios
  echo ""
  log_info "Cooling down for 30 seconds..."
  sleep 30
}

# Determine which scenarios to run
if [[ -n "$SPECIFIC_SCENARIO" ]]; then
  SCENARIOS=("$SPECIFIC_SCENARIO")
else
  SCENARIOS=(
    "kill-worker"
    "kill-ingestor"
    "rabbitmq-disconnect"
  )
fi

# Pre-flight checks
log_header "Pre-flight checks..."
PREFLIGHT_OK=true

if [[ "$ENV" == "local" ]]; then
  # Check Docker is running
  if ! docker info &>/dev/null; then
    log_error "Docker is not running"
    PREFLIGHT_OK=false
  fi

  # Check RabbitMQ is accessible
  if ! curl -s http://localhost:15672/api/overview &>/dev/null; then
    log_warn "RabbitMQ management API not accessible"
  fi
else
  # Check AWS CLI is configured
  if ! aws sts get-caller-identity &>/dev/null; then
    log_error "AWS CLI not configured"
    PREFLIGHT_OK=false
  fi
fi

if [[ "$PREFLIGHT_OK" != "true" ]]; then
  log_error "Pre-flight checks failed. Aborting."
  exit 1
fi

log_info "Pre-flight checks passed"

# Run scenarios
for scenario in "${SCENARIOS[@]}"; do
  run_scenario "$scenario"
done

# Summary
echo ""
log_header "╔══════════════════════════════════════════════╗"
log_header "║            Chaos Test Summary                ║"
log_header "╚══════════════════════════════════════════════╝"
echo ""

for scenario in "${!RESULTS[@]}"; do
  result="${RESULTS[$scenario]}"
  if [[ "$result" == "PASSED" ]]; then
    echo -e "  ${GREEN}✓${NC} $scenario: $result"
  elif [[ "$result" == "FAILED" ]]; then
    echo -e "  ${RED}✗${NC} $scenario: $result"
  else
    echo -e "  ${YELLOW}○${NC} $scenario: $result"
  fi
done

echo ""
echo "Total: $((PASSED + FAILED)) | Passed: $PASSED | Failed: $FAILED"
echo ""

if [[ "$FAILED" -gt 0 ]]; then
  log_error "Some chaos tests failed!"
  exit 1
else
  log_info "All chaos tests passed!"
  exit 0
fi

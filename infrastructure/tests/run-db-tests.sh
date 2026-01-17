#!/bin/bash
# Database Connection Load Testing Script
# Sprint S-1: Foundation Hardening
#
# Runs k6 load tests against PgBouncer to validate connection pooling performance.
#
# Prerequisites:
#   - k6 installed (https://k6.io/docs/getting-started/installation/)
#   - k6 PostgreSQL extension (xk6-sql)
#   - PgBouncer running and accessible
#
# Usage:
#   ./run-db-tests.sh              # Run with defaults
#   ./run-db-tests.sh --local      # Test local development
#   ./run-db-tests.sh --staging    # Test staging environment

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Default configuration
ENVIRONMENT="${1:-local}"
PGBOUNCER_HOST="localhost"
PGBOUNCER_PORT="6432"
DB_NAME="arrakis"
DB_USER="arrakis_admin"
DB_PASSWORD=""

# Environment-specific configuration
case "$ENVIRONMENT" in
  --local|local)
    echo -e "${GREEN}Testing local PgBouncer...${NC}"
    PGBOUNCER_HOST="localhost"
    PGBOUNCER_PORT="6432"
    ;;
  --staging|staging)
    echo -e "${YELLOW}Testing staging PgBouncer...${NC}"
    PGBOUNCER_HOST="${PGBOUNCER_STAGING_HOST:-pgbouncer.arrakis-staging.local}"
    PGBOUNCER_PORT="6432"
    ;;
  --production|production)
    echo -e "${RED}Testing production PgBouncer...${NC}"
    echo -e "${YELLOW}Warning: Running load tests against production!${NC}"
    read -p "Are you sure? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
      echo "Aborted."
      exit 1
    fi
    PGBOUNCER_HOST="${PGBOUNCER_PROD_HOST:-pgbouncer.arrakis-production.local}"
    PGBOUNCER_PORT="6432"
    ;;
  --help|-h)
    echo "Usage: $0 [--local|--staging|--production]"
    echo ""
    echo "Options:"
    echo "  --local       Test local development (default)"
    echo "  --staging     Test staging environment"
    echo "  --production  Test production (with confirmation)"
    echo ""
    echo "Environment variables:"
    echo "  PGBOUNCER_HOST     Override PgBouncer host"
    echo "  PGBOUNCER_PORT     Override PgBouncer port (default: 6432)"
    echo "  DB_USER            Database user (default: arrakis_admin)"
    echo "  DB_PASSWORD        Database password"
    exit 0
    ;;
  *)
    echo -e "${RED}Unknown option: $ENVIRONMENT${NC}"
    echo "Use --help for usage information"
    exit 1
    ;;
esac

# Allow environment variable overrides
PGBOUNCER_HOST="${PGBOUNCER_HOST_OVERRIDE:-$PGBOUNCER_HOST}"
PGBOUNCER_PORT="${PGBOUNCER_PORT_OVERRIDE:-$PGBOUNCER_PORT}"

# Check k6 installation
if ! command -v k6 &> /dev/null; then
  echo -e "${RED}Error: k6 is not installed${NC}"
  echo ""
  echo "Install k6:"
  echo "  macOS:  brew install k6"
  echo "  Linux:  sudo snap install k6"
  echo "  Docker: docker run -v \$(pwd):/scripts grafana/k6 run /scripts/pgbouncer-load.js"
  exit 1
fi

# Check for xk6-sql extension
if ! k6 version 2>&1 | grep -q "sql"; then
  echo -e "${YELLOW}Warning: k6 PostgreSQL extension (xk6-sql) may not be installed${NC}"
  echo ""
  echo "The test requires the xk6-sql extension. Install with:"
  echo "  go install go.k6.io/xk6/cmd/xk6@latest"
  echo "  xk6 build --with github.com/grafana/xk6-sql"
  echo ""
  echo "Or use the pre-built binary from Grafana."
fi

# Run the test
echo ""
echo "=========================================="
echo "PgBouncer Load Test Configuration"
echo "=========================================="
echo "Host: $PGBOUNCER_HOST:$PGBOUNCER_PORT"
echo "Database: $DB_NAME"
echo "User: $DB_USER"
echo "=========================================="
echo ""

# Export environment variables for k6
export PGBOUNCER_HOST
export PGBOUNCER_PORT
export DB_NAME
export DB_USER
export DB_PASSWORD

# Run k6 test
cd "$SCRIPT_DIR"

echo -e "${GREEN}Starting load test...${NC}"
echo ""

k6 run \
  --out json=pgbouncer-load-output.json \
  pgbouncer-load.js

# Check results
if [ -f "pgbouncer-load-results.json" ]; then
  echo ""
  echo -e "${GREEN}Results saved to:${NC}"
  echo "  - pgbouncer-load-results.json (summary)"
  echo "  - pgbouncer-load-output.json (detailed)"

  # Parse and display key metrics
  if command -v jq &> /dev/null; then
    echo ""
    echo "Key Metrics:"
    jq -r '.metrics | "  p99 Latency: \(.p99_latency_ms)ms\n  Success Rate: \(.success_rate * 100)%\n  Errors: \(.connection_errors + .query_errors)"' pgbouncer-load-results.json

    # Check if thresholds passed
    PASSED=$(jq -r '.thresholds_passed' pgbouncer-load-results.json)
    if [ "$PASSED" = "true" ]; then
      echo ""
      echo -e "${GREEN}All thresholds PASSED${NC}"
      exit 0
    else
      echo ""
      echo -e "${RED}Some thresholds FAILED${NC}"
      exit 1
    fi
  fi
fi

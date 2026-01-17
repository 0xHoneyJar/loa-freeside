#!/bin/bash
# ScyllaDB Schema Deployment Script
# Sprint S-3: ScyllaDB & Observability Foundation

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCHEMA_FILE="${SCRIPT_DIR}/schema.cql"

# Configuration (override via environment)
SCYLLA_CONTACT_POINTS="${SCYLLA_CONTACT_POINTS:-localhost}"
SCYLLA_PORT="${SCYLLA_PORT:-9042}"
SCYLLA_USERNAME="${SCYLLA_USERNAME:-cassandra}"
SCYLLA_PASSWORD="${SCYLLA_PASSWORD:-cassandra}"
SCYLLA_KEYSPACE="${SCYLLA_KEYSPACE:-arrakis}"

echo -e "${GREEN}ScyllaDB Schema Deployment${NC}"
echo "================================"
echo "Contact Points: ${SCYLLA_CONTACT_POINTS}"
echo "Port: ${SCYLLA_PORT}"
echo "Keyspace: ${SCYLLA_KEYSPACE}"
echo ""

# Check if cqlsh is available
if ! command -v cqlsh &> /dev/null; then
    echo -e "${YELLOW}cqlsh not found, checking for Docker...${NC}"

    if command -v docker &> /dev/null; then
        echo -e "${GREEN}Using Docker to run cqlsh${NC}"

        # Run cqlsh via Docker
        docker run --rm -i \
            -v "${SCHEMA_FILE}:/schema.cql:ro" \
            scylladb/scylla-cqlsh:latest \
            cqlsh "${SCYLLA_CONTACT_POINTS}" "${SCYLLA_PORT}" \
            -u "${SCYLLA_USERNAME}" \
            -p "${SCYLLA_PASSWORD}" \
            -f /schema.cql

        if [ $? -eq 0 ]; then
            echo -e "${GREEN}Schema deployed successfully!${NC}"
            exit 0
        else
            echo -e "${RED}Schema deployment failed${NC}"
            exit 1
        fi
    else
        echo -e "${RED}Neither cqlsh nor Docker found. Please install one of them.${NC}"
        exit 1
    fi
fi

# Use local cqlsh
echo -e "${GREEN}Using local cqlsh${NC}"
cqlsh "${SCYLLA_CONTACT_POINTS}" "${SCYLLA_PORT}" \
    -u "${SCYLLA_USERNAME}" \
    -p "${SCYLLA_PASSWORD}" \
    -f "${SCHEMA_FILE}"

if [ $? -eq 0 ]; then
    echo -e "${GREEN}Schema deployed successfully!${NC}"
    echo ""
    echo "Deployed tables:"
    echo "  - arrakis.scores"
    echo "  - arrakis.scores_by_profile"
    echo "  - arrakis.score_history"
    echo "  - arrakis.leaderboards"
    echo "  - arrakis.eligibility_snapshots"
else
    echo -e "${RED}Schema deployment failed${NC}"
    exit 1
fi

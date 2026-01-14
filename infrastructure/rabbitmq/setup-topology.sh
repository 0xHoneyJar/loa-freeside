#!/bin/bash
# setup-topology.sh - Configure RabbitMQ queue topology for Gateway Proxy Pattern
#
# This script is idempotent and can be re-run safely.
# It uses the RabbitMQ HTTP API to create exchanges, queues, and bindings.
#
# Usage:
#   ./setup-topology.sh <rabbitmq_management_url> <username> <password>
#
# Example:
#   ./setup-topology.sh https://b-xxx.mq.us-east-1.amazonaws.com:15671 arrakis mypassword
#
# Or with environment variables:
#   export RABBITMQ_URL="https://b-xxx.mq.us-east-1.amazonaws.com:15671"
#   export RABBITMQ_USER="arrakis"
#   export RABBITMQ_PASS="mypassword"
#   ./setup-topology.sh

set -euo pipefail

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Configuration from arguments or environment
RABBITMQ_URL="${1:-${RABBITMQ_URL:-}}"
RABBITMQ_USER="${2:-${RABBITMQ_USER:-}}"
RABBITMQ_PASS="${3:-${RABBITMQ_PASS:-}}"

if [[ -z "$RABBITMQ_URL" || -z "$RABBITMQ_USER" || -z "$RABBITMQ_PASS" ]]; then
    log_error "Missing required parameters"
    echo "Usage: $0 <rabbitmq_management_url> <username> <password>"
    echo "   Or set RABBITMQ_URL, RABBITMQ_USER, RABBITMQ_PASS environment variables"
    exit 1
fi

# Remove trailing slash from URL
RABBITMQ_URL="${RABBITMQ_URL%/}"
API_URL="${RABBITMQ_URL}/api"

# Helper function to make API calls
api_call() {
    local method="$1"
    local endpoint="$2"
    local data="${3:-}"

    local curl_args=(
        -s
        -X "$method"
        -u "${RABBITMQ_USER}:${RABBITMQ_PASS}"
        -H "Content-Type: application/json"
    )

    if [[ -n "$data" ]]; then
        curl_args+=(-d "$data")
    fi

    curl "${curl_args[@]}" "${API_URL}${endpoint}"
}

# Check connectivity
log_info "Checking RabbitMQ connectivity..."
if ! api_call GET "/overview" > /dev/null 2>&1; then
    log_error "Cannot connect to RabbitMQ at ${RABBITMQ_URL}"
    exit 1
fi
log_info "Connected to RabbitMQ successfully"

# Create exchanges
log_info "Creating exchanges..."

# Main topic exchange for all events
api_call PUT "/exchanges/%2F/arrakis.events" '{"type":"topic","durable":true}'
log_info "  Created exchange: arrakis.events (topic)"

# Dead-letter exchange
api_call PUT "/exchanges/%2F/arrakis.dlx" '{"type":"direct","durable":true}'
log_info "  Created exchange: arrakis.dlx (direct)"

# Create queues
log_info "Creating queues..."

# Priority queue for interactions (slash commands, buttons, modals)
api_call PUT "/queues/%2F/arrakis.interactions" '{
    "durable": true,
    "arguments": {
        "x-max-priority": 10,
        "x-dead-letter-exchange": "arrakis.dlx",
        "x-dead-letter-routing-key": "dead"
    }
}'
log_info "  Created queue: arrakis.interactions (priority: 10, DLQ enabled)"

# Normal queue for guild/member events
api_call PUT "/queues/%2F/arrakis.events.guild" '{
    "durable": true,
    "arguments": {
        "x-dead-letter-exchange": "arrakis.dlx",
        "x-dead-letter-routing-key": "dead"
    }
}'
log_info "  Created queue: arrakis.events.guild (DLQ enabled)"

# Dead-letter queue with 7-day TTL
api_call PUT "/queues/%2F/arrakis.dlq" '{
    "durable": true,
    "arguments": {
        "x-message-ttl": 604800000
    }
}'
log_info "  Created queue: arrakis.dlq (TTL: 7 days)"

# Create bindings
log_info "Creating bindings..."

# Bind interactions (interaction.command.*, interaction.button.*, etc.)
api_call POST "/bindings/%2F/e/arrakis.events/q/arrakis.interactions" '{
    "routing_key": "interaction.#"
}'
log_info "  Bound: arrakis.events -> arrakis.interactions (interaction.#)"

# Bind member events (member.join, member.leave, member.update)
api_call POST "/bindings/%2F/e/arrakis.events/q/arrakis.events.guild" '{
    "routing_key": "member.#"
}'
log_info "  Bound: arrakis.events -> arrakis.events.guild (member.#)"

# Bind guild events (guild.create, guild.delete, etc.)
api_call POST "/bindings/%2F/e/arrakis.events/q/arrakis.events.guild" '{
    "routing_key": "guild.#"
}'
log_info "  Bound: arrakis.events -> arrakis.events.guild (guild.#)"

# Bind DLX to DLQ
api_call POST "/bindings/%2F/e/arrakis.dlx/q/arrakis.dlq" '{
    "routing_key": "dead"
}'
log_info "  Bound: arrakis.dlx -> arrakis.dlq (dead)"

# Verify setup
log_info "Verifying topology..."
QUEUES=$(api_call GET "/queues" | grep -o '"name":"arrakis\.[^"]*"' | wc -l)
EXCHANGES=$(api_call GET "/exchanges" | grep -o '"name":"arrakis\.[^"]*"' | wc -l)
BINDINGS=$(api_call GET "/bindings" | grep -o '"destination":"arrakis\.[^"]*"' | wc -l)

log_info "Topology verification:"
log_info "  Exchanges: ${EXCHANGES} (expected: 2)"
log_info "  Queues: ${QUEUES} (expected: 3)"
log_info "  Bindings: ${BINDINGS} (expected: 4)"

if [[ "$EXCHANGES" -ge 2 && "$QUEUES" -ge 3 && "$BINDINGS" -ge 4 ]]; then
    log_info "RabbitMQ topology setup complete!"
else
    log_warn "Topology counts don't match expected values - please verify manually"
fi

echo ""
echo "Queue Topology:"
echo "==============="
echo "Exchange: arrakis.events (topic)"
echo "├── Queue: arrakis.interactions (priority queue, x-max-priority: 10)"
echo "│   └── Binding: interaction.#"
echo "├── Queue: arrakis.events.guild (normal queue)"
echo "│   ├── Binding: member.#"
echo "│   └── Binding: guild.#"
echo "└── Dead-letter: arrakis.dlx -> arrakis.dlq (TTL: 7 days)"
echo ""
echo "Management Console: ${RABBITMQ_URL}/"

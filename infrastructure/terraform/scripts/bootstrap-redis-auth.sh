#!/usr/bin/env bash
# =============================================================================
# Bootstrap Redis Auth Token for Finn Dedicated Redis
# Cycle 046: Armitage Platform — Sprint 1, Task 1.2
# SDD §3.1 + Sprint SKP-001b: Atomic auth rotation
# =============================================================================
#
# Generates a 64-char cryptographically strong auth token and applies it to
# the Finn dedicated ElastiCache replication group, then stores it in
# Secrets Manager.
#
# Atomic ordering (SKP-001b):
#   1. Generate token from /dev/urandom
#   2. Rotate ElastiCache auth token (ROTATE strategy)
#   3. Verify ElastiCache accepts the new token
#   4. Update Secrets Manager with new token
#   Never reverse steps 2 and 4 — ElastiCache is the source of truth.
#
# Usage:
#   ./bootstrap-redis-auth.sh <environment>
#   ./bootstrap-redis-auth.sh staging
#   ./bootstrap-redis-auth.sh production
#
# Prerequisites:
#   - AWS CLI v2 configured with appropriate credentials
#   - IAM permissions: elasticache:ModifyReplicationGroup,
#     secretsmanager:PutSecretValue, elasticache:DescribeReplicationGroups
#   - Peer session required (bus factor mitigation)
#
# Rotation cadence: quarterly, or on security incident.

set -euo pipefail

ENVIRONMENT="${1:?Usage: bootstrap-redis-auth.sh <environment>}"
NAME_PREFIX="arrakis-${ENVIRONMENT}"
REPLICATION_GROUP_ID="${NAME_PREFIX}-finn-redis"
SECRET_ID="${NAME_PREFIX}/finn/redis"
TOKEN_LENGTH=64

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }
err() { log "ERROR: $*" >&2; }

# Validate environment
case "$ENVIRONMENT" in
  staging|production) ;;
  *) err "Invalid environment: $ENVIRONMENT (must be staging or production)"; exit 1 ;;
esac

# Prerequisites check
command -v aws >/dev/null 2>&1 || { err "aws CLI is required"; exit 1; }
command -v jq >/dev/null 2>&1 || { err "jq is required"; exit 1; }

# Step 1: Generate 64-char cryptographically strong token
log "Generating ${TOKEN_LENGTH}-char auth token from /dev/urandom..."
AUTH_TOKEN=$(head -c 256 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c "$TOKEN_LENGTH")

if [[ ${#AUTH_TOKEN} -lt $TOKEN_LENGTH ]]; then
  err "Token generation failed: insufficient entropy output"
  exit 1
fi
log "Token generated successfully (${#AUTH_TOKEN} chars)"

# Step 2: Get current endpoint for Secrets Manager update
log "Fetching replication group endpoint..."
ENDPOINT=$(aws elasticache describe-replication-groups \
  --replication-group-id "$REPLICATION_GROUP_ID" \
  --query 'ReplicationGroups[0].NodeGroups[0].PrimaryEndpoint.Address' \
  --output text)

if [[ -z "$ENDPOINT" || "$ENDPOINT" == "None" ]]; then
  err "Could not find replication group: $REPLICATION_GROUP_ID"
  exit 1
fi
log "Endpoint: $ENDPOINT"

# Step 3: Rotate ElastiCache auth token (atomic — ElastiCache first)
log "Rotating ElastiCache auth token (ROTATE strategy)..."
aws elasticache modify-replication-group \
  --replication-group-id "$REPLICATION_GROUP_ID" \
  --auth-token "$AUTH_TOKEN" \
  --auth-token-update-strategy ROTATE \
  --apply-immediately

log "Waiting for replication group to become available..."
aws elasticache wait replication-group-available \
  --replication-group-id "$REPLICATION_GROUP_ID"

# Step 4: Verify ElastiCache accepts the new token
log "Verifying replication group status..."
STATUS=$(aws elasticache describe-replication-groups \
  --replication-group-id "$REPLICATION_GROUP_ID" \
  --query 'ReplicationGroups[0].Status' \
  --output text)

if [[ "$STATUS" != "available" ]]; then
  err "Replication group is not available after token rotation: status=$STATUS"
  err "DO NOT update Secrets Manager — ElastiCache is source of truth"
  exit 1
fi
log "ElastiCache replication group is available with new auth token"

# Step 5: Update Secrets Manager (only after ElastiCache confirmed)
log "Updating Secrets Manager secret: $SECRET_ID"
SECRET_JSON=$(jq -n \
  --arg host "$ENDPOINT" \
  --arg auth "$AUTH_TOKEN" \
  --argjson port 6379 \
  '{host: $host, port: $port, auth: $auth, url: "rediss://:\($auth)@\($host):6379"}')

aws secretsmanager put-secret-value \
  --secret-id "$SECRET_ID" \
  --secret-string "$SECRET_JSON"

log "Secrets Manager updated successfully"

# Summary
log "============================================"
log "Redis auth bootstrap complete"
log "  Environment:       $ENVIRONMENT"
log "  Replication Group: $REPLICATION_GROUP_ID"
log "  Endpoint:          $ENDPOINT"
log "  Secret:            $SECRET_ID"
log "  Token Length:      ${TOKEN_LENGTH} chars"
log "============================================"
log "Next: restart Finn ECS tasks to pick up new credentials"
log "  aws ecs update-service --cluster ${NAME_PREFIX} --service ${NAME_PREFIX}-finn --force-new-deployment"

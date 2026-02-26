#!/usr/bin/env bash
# =============================================================================
# Staging Test Data Seeder — Idempotent E2E Prerequisites (IMP-006)
# =============================================================================
# Seeds the minimum entities required for E2E smoke tests:
#   1. Test community (with staging budget)
#   2. Test profile (admin for JWT minting)
#   3. Test agent/NFT (linked to community)
#   4. Community-agent config (links community → agent with model alias)
#
# All operations use INSERT ... ON CONFLICT UPDATE for idempotency.
# Safe to re-run — will not duplicate data.
#
# Usage:
#   ./scripts/seed-staging-test-data.sh --db-url "$DATABASE_URL"
#   ./scripts/seed-staging-test-data.sh --ecs-exec --cluster arrakis-staging-cluster
#   ./scripts/seed-staging-test-data.sh --dry-run --db-url "$DATABASE_URL"
#
# Output:
#   Prints seeded entity IDs in KEY=VALUE format for shell consumption:
#     COMMUNITY_ID=test-community-staging-001
#     PROFILE_ID=test-profile-staging-001
#     AGENT_ID=test-agent-staging-001
#     NFT_CONTRACT=0x0000000000000000000000000000000000000001
#
# @see SDD §10.1, Sprint-372 Task 2.4
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Deterministic test entity IDs (stable across re-runs)
# ---------------------------------------------------------------------------

TEST_COMMUNITY_ID="test-community-staging-001"
TEST_PROFILE_ID="test-profile-staging-001"
TEST_AGENT_ID="test-agent-staging-001"
TEST_NFT_CONTRACT="0x0000000000000000000000000000000000000001"
TEST_NFT_TOKEN_ID="1"
TEST_BUDGET_CENTS=10000  # $100 staging budget

# ---------------------------------------------------------------------------
# Arguments
# ---------------------------------------------------------------------------

DB_URL=""
DRY_RUN=false
ECS_EXEC=false
CLUSTER=""
SERVICE=""
CONTAINER="api"

usage() {
  echo "Usage: $0 [options]"
  echo ""
  echo "Connection options (choose one):"
  echo "  --db-url <url>     Direct PostgreSQL connection string"
  echo "  --ecs-exec         Connect via ECS Exec (requires --cluster)"
  echo ""
  echo "ECS Exec options:"
  echo "  --cluster <name>   ECS cluster name (required with --ecs-exec)"
  echo "  --service <name>   ECS service name (default: auto-detect)"
  echo "  --container <name> Container name (default: api)"
  echo ""
  echo "Other options:"
  echo "  --dry-run          Show SQL without executing"
  echo "  -h, --help         Show this help"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --db-url)     DB_URL="$2"; shift 2 ;;
    --ecs-exec)   ECS_EXEC=true; shift ;;
    --cluster)    CLUSTER="$2"; shift 2 ;;
    --service)    SERVICE="$2"; shift 2 ;;
    --container)  CONTAINER="$2"; shift 2 ;;
    --dry-run)    DRY_RUN=true; shift ;;
    -h|--help)    usage; exit 0 ;;
    *)            echo "Unknown: $1"; usage; exit 1 ;;
  esac
done

if ! $ECS_EXEC && [[ -z "$DB_URL" ]]; then
  echo "ERROR: Either --db-url or --ecs-exec is required"
  usage
  exit 1
fi

if $ECS_EXEC && [[ -z "$CLUSTER" ]]; then
  echo "ERROR: --cluster is required with --ecs-exec"
  usage
  exit 1
fi

# ---------------------------------------------------------------------------
# SQL Statements (idempotent upserts)
# ---------------------------------------------------------------------------

SEED_SQL=$(cat << 'SQL'
-- ==========================================================================
-- Staging Test Data Seed (idempotent)
-- ==========================================================================

-- 1. Test Community
INSERT INTO communities (id, name, monthly_budget_cents, created_at, updated_at)
VALUES (
  'test-community-staging-001',
  'Staging Test Community',
  10000,
  NOW(),
  NOW()
)
ON CONFLICT (id) DO UPDATE SET
  monthly_budget_cents = EXCLUDED.monthly_budget_cents,
  updated_at = NOW();

-- 2. Test Profile (admin)
INSERT INTO profiles (id, wallet_address, role, created_at, updated_at)
VALUES (
  'test-profile-staging-001',
  '0x0000000000000000000000000000000000000099',
  'admin',
  NOW(),
  NOW()
)
ON CONFLICT (id) DO UPDATE SET
  role = EXCLUDED.role,
  updated_at = NOW();

-- 3. Test Agent/NFT
INSERT INTO agents (id, name, nft_contract, nft_token_id, community_id, created_at, updated_at)
VALUES (
  'test-agent-staging-001',
  'Staging Test Agent',
  '0x0000000000000000000000000000000000000001',
  '1',
  'test-community-staging-001',
  NOW(),
  NOW()
)
ON CONFLICT (id) DO UPDATE SET
  community_id = EXCLUDED.community_id,
  updated_at = NOW();

-- 4. Community-Agent Config (model alias binding)
INSERT INTO community_agent_configs (community_id, agent_id, model_alias, enabled, created_at, updated_at)
VALUES (
  'test-community-staging-001',
  'test-agent-staging-001',
  'cheap',
  true,
  NOW(),
  NOW()
)
ON CONFLICT (community_id, agent_id) DO UPDATE SET
  model_alias = EXCLUDED.model_alias,
  enabled = EXCLUDED.enabled,
  updated_at = NOW();

-- Output confirmation
SELECT 'SEED_COMPLETE' as status,
       (SELECT COUNT(*) FROM communities WHERE id = 'test-community-staging-001') as communities,
       (SELECT COUNT(*) FROM profiles WHERE id = 'test-profile-staging-001') as profiles,
       (SELECT COUNT(*) FROM agents WHERE id = 'test-agent-staging-001') as agents;
SQL
)

# ---------------------------------------------------------------------------
# Execute
# ---------------------------------------------------------------------------

echo "================================================================"
echo "  Staging Test Data Seeder"
echo "================================================================"
echo ""
echo "  Community ID:  $TEST_COMMUNITY_ID"
echo "  Profile ID:    $TEST_PROFILE_ID"
echo "  Agent ID:      $TEST_AGENT_ID"
echo "  Budget:        $TEST_BUDGET_CENTS cents (\$$(( TEST_BUDGET_CENTS / 100 )))"
echo "  Dry Run:       $DRY_RUN"
echo ""

if $DRY_RUN; then
  echo "[dry-run] SQL that would be executed:"
  echo ""
  echo "$SEED_SQL"
  echo ""
  echo "[dry-run] No changes made"
  echo ""
  echo "# Entity IDs (for smoke test consumption):"
  echo "COMMUNITY_ID=$TEST_COMMUNITY_ID"
  echo "PROFILE_ID=$TEST_PROFILE_ID"
  echo "AGENT_ID=$TEST_AGENT_ID"
  echo "NFT_CONTRACT=$TEST_NFT_CONTRACT"
  exit 0
fi

if $ECS_EXEC; then
  # Find a running task
  if [[ -z "$SERVICE" ]]; then
    SERVICE=$(aws ecs list-services \
      --cluster "$CLUSTER" \
      --query 'serviceArns[0]' \
      --output text 2>/dev/null | xargs -I{} basename {})
  fi

  TASK_ARN=$(aws ecs list-tasks \
    --cluster "$CLUSTER" \
    --service-name "$SERVICE" \
    --desired-status RUNNING \
    --query 'taskArns[0]' \
    --output text 2>/dev/null)

  if [[ -z "$TASK_ARN" ]] || [[ "$TASK_ARN" == "None" ]]; then
    echo "ERROR: No running tasks found in $CLUSTER/$SERVICE"
    exit 1
  fi

  echo "Executing via ECS Exec (task: $(basename "$TASK_ARN"))..."
  echo ""

  # Pipe SQL through ECS exec
  echo "$SEED_SQL" | aws ecs execute-command \
    --cluster "$CLUSTER" \
    --task "$TASK_ARN" \
    --container "$CONTAINER" \
    --interactive \
    --command "psql \$DATABASE_URL -f -"
else
  echo "Executing via direct connection..."
  echo ""

  echo "$SEED_SQL" | psql "$DB_URL"
fi

RESULT=$?

echo ""
if [[ $RESULT -eq 0 ]]; then
  echo "  Test data seeded successfully"
else
  echo "  ERROR: Seeding failed (exit code: $RESULT)"
  exit $RESULT
fi

echo ""
echo "# Entity IDs (for smoke test consumption):"
echo "COMMUNITY_ID=$TEST_COMMUNITY_ID"
echo "PROFILE_ID=$TEST_PROFILE_ID"
echo "AGENT_ID=$TEST_AGENT_ID"
echo "NFT_CONTRACT=$TEST_NFT_CONTRACT"
echo ""
echo "# Usage with staging-smoke.sh:"
echo "#   ./scripts/staging-smoke.sh --test-key staging.pem --community-id $TEST_COMMUNITY_ID"
echo ""
echo "================================================================"

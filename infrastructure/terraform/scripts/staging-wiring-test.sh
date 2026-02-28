#!/usr/bin/env bash
# =============================================================================
# Staging Wiring Test — Service Connectivity Validation
# Cycle 046: Armitage Platform — Sprint 2, Task 2.4
# SDD §6.1: staging-wiring-test.sh
# =============================================================================
#
# Validates all 10 service-to-service connectivity paths.
# W-1 to W-3: External health checks
# W-4 to W-7: Internal Cloud Map connectivity via ECS Exec
# W-8: Finn → Redis (dedicated ElastiCache)
# W-9, W-10: DB connectivity via PgBouncer
#
# Usage:
#   ./staging-wiring-test.sh <ring>
#   ./staging-wiring-test.sh staging

set -euo pipefail

RING="${1:?Usage: staging-wiring-test.sh <ring>}"
CLUSTER="arrakis-${RING}"
PASS=0
FAIL=0
RESULTS=()

# Prerequisites
command -v aws >/dev/null 2>&1 || { echo "ERROR: aws CLI required"; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "ERROR: curl required"; exit 1; }

# External tests (W-1 through W-3)
test_external() {
  local name="$1" url="$2"
  local code
  code=$(curl -sf -o /dev/null -w '%{http_code}' --max-time 15 "$url" 2>/dev/null) || code="000"
  if [[ "$code" == "200" ]]; then
    RESULTS+=("PASS: $name → HTTP $code")
    PASS=$((PASS + 1))
  else
    RESULTS+=("FAIL: $name → HTTP $code")
    FAIL=$((FAIL + 1))
  fi
}

# Internal tests via ECS Exec (W-4 through W-10)
test_internal() {
  local name="$1" task_service="$2" container="$3" cmd="$4"
  local task_arn
  task_arn=$(aws ecs list-tasks --cluster "$CLUSTER" --service-name "$task_service" \
    --query 'taskArns[0]' --output text 2>/dev/null) || task_arn="None"

  if [[ "$task_arn" == "None" || -z "$task_arn" ]]; then
    RESULTS+=("FAIL: $name → No running task for $task_service")
    FAIL=$((FAIL + 1))
    return
  fi

  local output
  if output=$(aws ecs execute-command --cluster "$CLUSTER" --task "$task_arn" \
    --container "$container" --command "/bin/sh -c '$cmd'" \
    --non-interactive 2>&1); then
    RESULTS+=("PASS: $name")
    PASS=$((PASS + 1))
  else
    RESULTS+=("FAIL: $name → ${output:0:200}")
    FAIL=$((FAIL + 1))
  fi
}

# W-1: External → Freeside
test_external "W-1 External→Freeside" "https://${RING}.api.arrakis.community/health"

# W-2: External → Finn (staging only)
test_external "W-2 External→Finn" "https://finn.${RING}.arrakis.community/health"

# W-3: External → Dixie
test_external "W-3 External→Dixie" "https://dixie.${RING}.arrakis.community/api/health"

# W-4: Freeside → Finn (Cloud Map)
test_internal "W-4 Freeside→Finn" "${CLUSTER}-api" "api" \
  "curl -sf http://finn.${CLUSTER}.local:3000/health"

# W-5: Freeside → Dixie (Cloud Map)
test_internal "W-5 Freeside→Dixie" "${CLUSTER}-api" "api" \
  "curl -sf http://dixie.${CLUSTER}.local:3001/api/health"

# W-6: Finn → Dixie (reputation query)
test_internal "W-6 Finn→Dixie" "${CLUSTER}-finn" "finn" \
  "curl -sf http://dixie.${CLUSTER}.local:3001/api/health"

# W-7: Finn → Freeside (JWKS)
test_internal "W-7 Finn→Freeside" "${CLUSTER}-finn" "finn" \
  "curl -sf http://freeside.${CLUSTER}.local:3000/.well-known/jwks.json"

# W-8: Finn → Redis (dedicated ElastiCache)
test_internal "W-8 Finn→Redis" "${CLUSTER}-finn" "finn" \
  "node -e \"const r=require('ioredis');const c=new r(process.env.FINN_REDIS_URL);c.ping().then(p=>{console.log(p);c.quit()}).catch(e=>{console.error(e);process.exit(1)})\""

# W-9: Freeside → PostgreSQL (PgBouncer)
test_internal "W-9 Freeside→PgBouncer" "${CLUSTER}-api" "api" \
  "node -e \"const {Pool}=require('pg');const p=new Pool({connectionString:process.env.DATABASE_URL});p.query('SELECT 1').then(()=>{console.log('OK');p.end()}).catch(e=>{console.error(e);process.exit(1)})\""

# W-10: Dixie → PostgreSQL (PgBouncer)
test_internal "W-10 Dixie→PgBouncer" "${CLUSTER}-dixie" "dixie" \
  "node -e \"const {Pool}=require('pg');const p=new Pool({connectionString:process.env.DATABASE_URL});p.query('SELECT 1').then(()=>{console.log('OK');p.end()}).catch(e=>{console.error(e);process.exit(1)})\""

# Report
echo "════════════════════════════════════════"
echo "Wiring Test Results: ${PASS} passed, ${FAIL} failed"
echo "════════════════════════════════════════"
for r in "${RESULTS[@]}"; do echo "  $r"; done

if (( FAIL > 0 )); then
  echo "WIRING TESTS FAILED"
  exit 1
fi

echo "ALL WIRING TESTS PASSED"

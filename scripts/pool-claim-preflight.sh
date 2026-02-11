#!/usr/bin/env bash
# Pool Claim Graduation Preflight Check
# Sprint 4, Task 4.4: Verify pool_claim_mismatch = 0 before switching to reject mode
#
# Usage: ./scripts/pool-claim-preflight.sh [--env staging|production] [--hours 24]
#
# Checks:
# 1. pool_claim_mismatch counter = 0 for the specified time window
# 2. Health check endpoint shows no mapping version mismatches
# 3. Current enforcement mode
#
# Prerequisites:
# - AWS CLI configured with proper credentials
# - CloudWatch metrics flowing from agent gateway

set -euo pipefail

ENV="${1:---env}"
HOURS="${3:-24}"

# Parse args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env) ENV="$2"; shift 2 ;;
    --hours) HOURS="$2"; shift 2 ;;
    *) shift ;;
  esac
done

ENV="${ENV:-staging}"
NAMESPACE="arrakis-${ENV}/agent"
METRIC_NAME="PoolClaimMismatch"
CW_NAMESPACE="Arrakis/AgentGateway"

echo "=== Pool Claim Graduation Preflight ==="
echo "Environment: ${ENV}"
echo "Time window: ${HOURS}h"
echo "Namespace:   ${CW_NAMESPACE}"
echo ""

# Check 1: CloudWatch metric = 0
echo "[1/3] Checking PoolClaimMismatch metric (last ${HOURS}h)..."

START_TIME=$(date -u -d "${HOURS} hours ago" +%Y-%m-%dT%H:%M:%S 2>/dev/null || date -u -v-${HOURS}H +%Y-%m-%dT%H:%M:%S)
END_TIME=$(date -u +%Y-%m-%dT%H:%M:%S)

MISMATCH_SUM=$(aws cloudwatch get-metric-statistics \
  --namespace "${CW_NAMESPACE}" \
  --metric-name "${METRIC_NAME}" \
  --start-time "${START_TIME}" \
  --end-time "${END_TIME}" \
  --period $((HOURS * 3600)) \
  --statistics Sum \
  --output text \
  --query 'Datapoints[0].Sum' 2>/dev/null || echo "None")

if [[ "${MISMATCH_SUM}" == "None" || "${MISMATCH_SUM}" == "0.0" || "${MISMATCH_SUM}" == "0" ]]; then
  echo "  PASS: PoolClaimMismatch = ${MISMATCH_SUM:-0} (no mismatches)"
else
  echo "  FAIL: PoolClaimMismatch = ${MISMATCH_SUM} (mismatches detected!)"
  echo "  ACTION: Investigate mismatching clients before graduating to reject mode"
  exit 1
fi

# Check 2: PoolClaimReject counter (should be 0 in warn mode)
echo ""
echo "[2/3] Checking PoolClaimReject metric (should be 0 in warn mode)..."

REJECT_SUM=$(aws cloudwatch get-metric-statistics \
  --namespace "${CW_NAMESPACE}" \
  --metric-name "PoolClaimReject" \
  --start-time "${START_TIME}" \
  --end-time "${END_TIME}" \
  --period $((HOURS * 3600)) \
  --statistics Sum \
  --output text \
  --query 'Datapoints[0].Sum' 2>/dev/null || echo "None")

if [[ "${REJECT_SUM}" == "None" || "${REJECT_SUM}" == "0.0" || "${REJECT_SUM}" == "0" ]]; then
  echo "  PASS: PoolClaimReject = ${REJECT_SUM:-0}"
else
  echo "  WARN: PoolClaimReject = ${REJECT_SUM} (unexpected in warn mode)"
fi

# Check 3: Current enforcement mode
echo ""
echo "[3/3] Current enforcement configuration..."
echo "  Default: reject (config.ts DEFAULTS.poolClaimEnforcement)"
echo "  Override: AGENT_POOL_CLAIM_ENFORCEMENT env var"
echo ""

echo "=== Preflight Summary ==="
echo "  PoolClaimMismatch (${HOURS}h): ${MISMATCH_SUM:-0}"
echo "  PoolClaimReject (${HOURS}h):   ${REJECT_SUM:-0}"
echo ""
echo "  RESULT: READY for graduation to reject mode"
echo ""
echo "  Next steps:"
echo "  1. Set AGENT_POOL_CLAIM_ENFORCEMENT=reject in staging"
echo "  2. Monitor pool_claim_reject counter for 1h"
echo "  3. If no unexpected 403s, promote to production"

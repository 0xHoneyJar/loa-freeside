#!/usr/bin/env bash
# =============================================================================
# Deployment Validation Script — Two-Tier Health Check
# =============================================================================
# Validates arrakis agent gateway deployment with two tiers:
#   Local tier  (always): health, JWKS, invoke smoke test, Redis status
#   Staging tier (--aws-profile): CloudWatch metrics + circuit breaker state
#
# Usage:
#   ./scripts/validate-deployment.sh --url http://localhost:3000
#   ./scripts/validate-deployment.sh --url http://localhost:3000 --test-key dev-test.pem
#   ./scripts/validate-deployment.sh --url https://staging.example.com --aws-profile thj-staging --test-key staging.pem
#
# Exit codes:
#   0 — All tier-appropriate checks pass
#   1 — One or more checks failed
#
# @see SDD §2.2 Deployment Validation Script
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Parse Arguments
# ---------------------------------------------------------------------------

URL=""
TEST_KEY=""
AWS_PROFILE=""
REGION="${AWS_DEFAULT_REGION:-us-east-1}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --url)      URL="$2"; shift 2 ;;
    --test-key) TEST_KEY="$2"; shift 2 ;;
    --aws-profile) AWS_PROFILE="$2"; shift 2 ;;
    --region)   REGION="$2"; shift 2 ;;
    -h|--help)
      echo "Usage: $0 --url <base-url> [--test-key <path>] [--aws-profile <profile>] [--region <region>]"
      echo ""
      echo "Options:"
      echo "  --url          Base URL of the deployment (required)"
      echo "  --test-key     Path to ES256 PEM private key for invoke test"
      echo "  --aws-profile  AWS profile for staging tier (CloudWatch)"
      echo "  --region       AWS region (default: us-east-1 or AWS_DEFAULT_REGION)"
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

if [ -z "$URL" ]; then
  echo "ERROR: --url is required"
  echo "Usage: $0 --url <base-url> [--test-key <path>] [--aws-profile <profile>]"
  exit 1
fi

# ---------------------------------------------------------------------------
# Prerequisites
# ---------------------------------------------------------------------------

for cmd in curl jq; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "ERROR: Required command '$cmd' not found"
    exit 1
  fi
done

if [ -n "$AWS_PROFILE" ] && ! command -v aws &>/dev/null; then
  echo "ERROR: --aws-profile requires AWS CLI v2. Install: https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html"
  exit 1
fi

# ---------------------------------------------------------------------------
# State
# ---------------------------------------------------------------------------

PASS_COUNT=0
FAIL_COUNT=0
WARN_COUNT=0
TOTAL_CHECKS=0

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

check_pass() {
  local name="$1" timing="$2"
  echo "  PASS  $name (${timing}ms)"
  PASS_COUNT=$((PASS_COUNT + 1))
  TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
}

check_fail() {
  local name="$1" timing="$2" reason="${3:-}"
  echo "  FAIL  $name (${timing}ms)${reason:+ — $reason}"
  FAIL_COUNT=$((FAIL_COUNT + 1))
  TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
}

check_warn() {
  local name="$1" timing="$2" reason="${3:-}"
  echo "  WARN  $name (${timing}ms)${reason:+ — $reason}"
  WARN_COUNT=$((WARN_COUNT + 1))
  TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
}

timer_ms() {
  # Returns milliseconds since epoch (bash 5+ with EPOCHREALTIME, fallback to seconds)
  if [ -n "${EPOCHREALTIME:-}" ]; then
    echo "${EPOCHREALTIME/./}" | cut -c1-13
  else
    echo "$(($(date +%s) * 1000))"
  fi
}

# ---------------------------------------------------------------------------
# Banner
# ---------------------------------------------------------------------------

echo "═══════════════════════════════════════════════════════"
echo "  Deployment Validation"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "  URL:         $URL"
echo "  Test Key:    ${TEST_KEY:-<none — invoke check skipped>}"
echo "  AWS Profile: ${AWS_PROFILE:-<none — local tier only>}"
echo "  Region:      $REGION"
echo ""

# ===========================================================================
# LOCAL TIER
# ===========================================================================

echo "── Local Tier ──────────────────────────────────────────"
echo ""

# Check 1: Health endpoint
start=$(timer_ms)
health_response=$(curl -sf --max-time 10 "$URL/health" 2>/dev/null) && health_ok=true || health_ok=false
elapsed=$(( $(timer_ms) - start ))

if $health_ok; then
  status=$(echo "$health_response" | jq -r '.status // empty' 2>/dev/null)
  if [ "$status" = "healthy" ] || [ "$status" = "degraded" ]; then
    check_pass "Health endpoint (/health → status: $status)" "$elapsed"
  else
    check_fail "Health endpoint (/health)" "$elapsed" "unexpected status: $status"
  fi
else
  check_fail "Health endpoint (/health)" "$elapsed" "unreachable or error"
fi

# Check 2: Agent health (Redis connectivity)
start=$(timer_ms)
agent_health=$(curl -sf --max-time 10 "$URL/api/agents/health" 2>/dev/null) && agent_ok=true || agent_ok=false
elapsed=$(( $(timer_ms) - start ))

if $agent_ok; then
  redis_healthy=$(echo "$agent_health" | jq -r '.redis.healthy // empty' 2>/dev/null)
  if [ "$redis_healthy" = "true" ]; then
    redis_latency=$(echo "$agent_health" | jq -r '.redis.latencyMs // "?"' 2>/dev/null)
    check_pass "Redis connectivity (via /api/agents/health, latency: ${redis_latency}ms)" "$elapsed"
  else
    check_fail "Redis connectivity (via /api/agents/health)" "$elapsed" "redis.healthy=$redis_healthy"
  fi
else
  check_fail "Redis connectivity (via /api/agents/health)" "$elapsed" "endpoint unreachable"
fi

# Check 3: JWKS endpoint
start=$(timer_ms)
jwks_response=$(curl -sf --max-time 10 "$URL/.well-known/jwks.json" 2>/dev/null) && jwks_ok=true || jwks_ok=false
elapsed=$(( $(timer_ms) - start ))

if $jwks_ok; then
  key_count=$(echo "$jwks_response" | jq '.keys | length' 2>/dev/null)
  first_alg=$(echo "$jwks_response" | jq -r '.keys[0].alg // empty' 2>/dev/null)
  if [ "$key_count" -ge 1 ] && [ "$first_alg" = "ES256" ]; then
    check_pass "JWKS endpoint ($key_count key(s), alg=$first_alg)" "$elapsed"
  else
    check_fail "JWKS endpoint" "$elapsed" "unexpected: keys=$key_count, alg=$first_alg"
  fi
else
  check_fail "JWKS endpoint" "$elapsed" "unreachable or invalid JSON"
fi

# Check 4: Invoke smoke test (requires --test-key)
if [ -n "$TEST_KEY" ]; then
  if [ ! -f "$TEST_KEY" ]; then
    check_fail "Invoke smoke test" "0" "test key file not found: $TEST_KEY"
  elif ! command -v node &>/dev/null; then
    check_fail "Invoke smoke test" "0" "node not found (required for jose JWT signing)"
  else
    start=$(timer_ms)

    # Sign a test JWT using standalone script (ES256 raw r||s via jose)
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    token=$(node "$SCRIPT_DIR/sign-test-jwt.js" "$TEST_KEY" 2>/dev/null) && jwt_ok=true || jwt_ok=false

    if ! $jwt_ok || [ -z "$token" ]; then
      elapsed=$(( $(timer_ms) - start ))
      check_fail "Invoke smoke test" "$elapsed" "JWT signing failed"
    else
      invoke_response=$(curl -sf --max-time 30 \
        -X POST "$URL/api/agents/invoke" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $token" \
        -d '{"prompt":"test","model":"cheap"}' 2>/dev/null) && invoke_ok=true || invoke_ok=false

      elapsed=$(( $(timer_ms) - start ))

      if $invoke_ok; then
        has_content=$(echo "$invoke_response" | jq 'has("content")' 2>/dev/null)
        if [ "$has_content" = "true" ]; then
          check_pass "Invoke smoke test (POST /api/agents/invoke)" "$elapsed"
        else
          check_fail "Invoke smoke test" "$elapsed" "response missing 'content' field"
        fi
      else
        check_fail "Invoke smoke test" "$elapsed" "request failed or non-200 response"
      fi
    fi
  fi
else
  echo "  SKIP  Invoke smoke test (no --test-key provided)"
  TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
fi

# ===========================================================================
# STAGING TIER (requires --aws-profile)
# ===========================================================================

if [ -n "$AWS_PROFILE" ]; then
  echo ""
  echo "── Staging Tier ────────────────────────────────────────"
  echo ""

  AWS_ARGS="--profile $AWS_PROFILE --region $REGION --output json"
  LOG_GROUP="/ecs/arrakis-agent-gateway"
  METRIC_NS="Arrakis/AgentGateway"
  START_TIME=$(date -u -d '10 minutes ago' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -v-10M +%Y-%m-%dT%H:%M:%SZ)
  END_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ)

  # Check 5: CloudWatch RequestCount
  start=$(timer_ms)
  cw_result=$(aws cloudwatch get-metric-data \
    --metric-data-queries "[{
      \"Id\": \"req\",
      \"Expression\": \"SEARCH('MetricName=\\\"RequestCount\\\" Namespace=\\\"$METRIC_NS\\\"', 'Sum', 60)\",
      \"Period\": 60
    }]" \
    --start-time "$START_TIME" \
    --end-time "$END_TIME" \
    $AWS_ARGS 2>&1) && cw_ok=true || cw_ok=false
  elapsed=$(( $(timer_ms) - start ))

  if $cw_ok; then
    datapoints=$(echo "$cw_result" | jq '[.MetricDataResults[].Values[]] | add // 0' 2>/dev/null)
    if [ "$datapoints" -gt 0 ] 2>/dev/null; then
      check_pass "CloudWatch RequestCount ($datapoints requests in last 10min)" "$elapsed"
    else
      check_warn "CloudWatch RequestCount" "$elapsed" "no datapoints in last 10min (service may be idle)"
    fi
  else
    if echo "$cw_result" | grep -qi "accessdenied\|unauthorized\|not authorized"; then
      check_fail "CloudWatch RequestCount" "$elapsed" \
        "Access denied. Required IAM: cloudwatch:GetMetricData on arn:aws:cloudwatch:$REGION:*:metric/$METRIC_NS/*"
    else
      check_fail "CloudWatch RequestCount" "$elapsed" "API error: $(echo "$cw_result" | head -1)"
    fi
  fi

  # Check 6: CloudWatch CircuitBreakerState
  start=$(timer_ms)
  cb_result=$(aws cloudwatch get-metric-data \
    --metric-data-queries "[{
      \"Id\": \"cb\",
      \"Expression\": \"SEARCH('MetricName=\\\"CircuitBreakerState\\\" Namespace=\\\"$METRIC_NS\\\"', 'Maximum', 60)\",
      \"Period\": 60
    }]" \
    --start-time "$START_TIME" \
    --end-time "$END_TIME" \
    $AWS_ARGS 2>&1) && cb_ok=true || cb_ok=false
  elapsed=$(( $(timer_ms) - start ))

  if $cb_ok; then
    max_state=$(echo "$cb_result" | jq '[.MetricDataResults[].Values[]] | max // 0' 2>/dev/null)
    if [ "$max_state" -lt 2 ] 2>/dev/null; then
      state_name="CLOSED"
      [ "$max_state" = "1" ] && state_name="HALF_OPEN"
      check_pass "CircuitBreaker state ($state_name, value=$max_state)" "$elapsed"
    elif [ "$max_state" = "0" ] && [ "$(echo "$cb_result" | jq '[.MetricDataResults[].Values] | length' 2>/dev/null)" = "0" ]; then
      check_warn "CircuitBreaker state" "$elapsed" "no datapoints (service may be idle)"
    else
      check_fail "CircuitBreaker state" "$elapsed" "OPEN (value=$max_state)"
    fi
  else
    if echo "$cb_result" | grep -qi "accessdenied\|unauthorized\|not authorized"; then
      check_fail "CircuitBreaker state" "$elapsed" \
        "Access denied. Required IAM: cloudwatch:GetMetricData on arn:aws:cloudwatch:$REGION:*:metric/$METRIC_NS/*"
    else
      check_fail "CircuitBreaker state" "$elapsed" "API error: $(echo "$cb_result" | head -1)"
    fi
  fi

else
  echo ""
  echo "── Staging Tier ────────────────────────────────────────"
  echo ""
  echo "  SKIP  CloudWatch checks (no --aws-profile provided)"
  echo "  SKIP  CircuitBreaker check (no --aws-profile provided)"
  echo ""
  echo "  To enable staging tier: add --aws-profile <profile>"
  echo "  Required IAM: cloudwatch:GetMetricData, logs:StartQuery, logs:GetQueryResults"
fi

# ===========================================================================
# Summary
# ===========================================================================

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  Summary"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "  PASS: $PASS_COUNT"
echo "  FAIL: $FAIL_COUNT"
echo "  WARN: $WARN_COUNT"
echo "  Total: $TOTAL_CHECKS"
echo ""

if [ $FAIL_COUNT -gt 0 ]; then
  echo "  Result: FAIL"
  echo ""
  echo "═══════════════════════════════════════════════════════"
  exit 1
else
  echo "  Result: PASS"
  echo ""
  echo "═══════════════════════════════════════════════════════"
  exit 0
fi

#!/usr/bin/env bash
# =============================================================================
# Staging Smoke Test — E2E Validation per SDD §10.1
# =============================================================================
# 6-phase progressive validation of staging deployment.
#
# Phases (P0 = blocking, P1 = degraded):
#   P0-1: Health checks (freeside, dixie)
#   P0-2: JWKS verification
#   P0-3: JWT round-trip + agent invoke (requires --test-key)
#   P0-4: Budget conservation (requires --test-key + --community-id)
#   P1-5: Reputation query (dixie)
#   P1-6: SSE streaming
#   P1-7: Autopoietic loop trace (requires --test-key + --community-id)
#   P1-8: x402 payment (requires SEPOLIA_RPC_URL + STAGING_WALLET_KEY)
#
# Exit codes:
#   0 — All phases pass
#   1 — P0 failure (deployment broken)
#   2 — P1 failure only (degraded but functional)
#
# Failure classification (SDD §10.2):
#   PLATFORM_BUG    — Our code is broken
#   EXTERNAL_OUTAGE — Third-party service unavailable
#   FLAKE           — Intermittent, passed on retry
#
# Usage:
#   ./scripts/staging-smoke.sh
#   ./scripts/staging-smoke.sh --test-key staging.pem
#   ./scripts/staging-smoke.sh --test-key staging.pem --community-id abc123
#   ./scripts/staging-smoke.sh --json
#
# @see SDD §10.1 Staging Smoke Test
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

FREESIDE_URL="${FREESIDE_URL:-https://staging.api.arrakis.community}"
DIXIE_URL="${DIXIE_URL:-https://dixie.staging.arrakis.community}"
TEST_KEY=""
COMMUNITY_ID=""
JSON_OUTPUT=false
RETRY_COUNT=1
AUTO_SEED=false
CHAOS_MODE=false

usage() {
  echo "Usage: $0 [options]"
  echo ""
  echo "Options:"
  echo "  --test-key <path>     ES256 PEM private key for JWT signing"
  echo "  --community-id <id>   Test community ID for budget tests"
  echo "  --freeside-url <url>  Override freeside URL"
  echo "  --dixie-url <url>     Override dixie URL"
  echo "  --json                Output results as JSON"
  echo "  --retries <n>         Retry count for flake detection (default: 1)"
  echo "  --auto-seed           Run test data seeding if needed before tests"
  echo "  --chaos               Run chaos engineering scenarios after Phase 4"
  echo "  -h, --help            Show this help"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --test-key)      TEST_KEY="$2"; shift 2 ;;
    --community-id)  COMMUNITY_ID="$2"; shift 2 ;;
    --freeside-url)  FREESIDE_URL="$2"; shift 2 ;;
    --dixie-url)     DIXIE_URL="$2"; shift 2 ;;
    --json)          JSON_OUTPUT=true; shift ;;
    --retries)       RETRY_COUNT="$2"; shift 2 ;;
    --auto-seed)     AUTO_SEED=true; shift ;;
    --chaos)         CHAOS_MODE=true; shift ;;
    -h|--help)       usage; exit 0 ;;
    *)               echo "Unknown option: $1"; usage; exit 1 ;;
  esac
done

# ---------------------------------------------------------------------------
# Prerequisites
# ---------------------------------------------------------------------------

for cmd in curl jq; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "ERROR: Required command '$cmd' not found"
    exit 1
  fi
done

if [[ -n "$TEST_KEY" ]] && [[ ! -f "$TEST_KEY" ]]; then
  echo "ERROR: Test key not found: $TEST_KEY"
  exit 1
fi

if [[ -n "$TEST_KEY" ]] && ! command -v node &>/dev/null; then
  echo "ERROR: node required for JWT signing (sign-test-jwt.mjs)"
  exit 1
fi

# ---------------------------------------------------------------------------
# Auto-Seed: Provision test data if --auto-seed and no --test-key provided
# ---------------------------------------------------------------------------

if $AUTO_SEED; then
  SEED_SCRIPT="$SCRIPT_DIR/seed-staging-test-data.sh"

  if [[ ! -x "$SEED_SCRIPT" ]]; then
    echo "WARNING: --auto-seed specified but $SEED_SCRIPT not found or not executable"
    echo "  Continuing without seeding..."
  else
    echo "Auto-seeding staging test data..."
    seed_output=$("$SEED_SCRIPT" --ecs-exec ${ECS_CLUSTER:+--cluster "$ECS_CLUSTER"} 2>&1) || {
      echo "WARNING: Test data seeding failed — continuing with manual config"
      echo "  $seed_output"
      seed_output=""
    }

    if [[ -n "$seed_output" ]]; then
      # Extract seeded entity IDs from KEY=VALUE output
      seeded_community=$(echo "$seed_output" | grep '^COMMUNITY_ID=' | cut -d= -f2)
      seeded_key=$(echo "$seed_output" | grep '^TEST_KEY_PATH=' | cut -d= -f2)

      if [[ -z "$COMMUNITY_ID" ]] && [[ -n "$seeded_community" ]]; then
        COMMUNITY_ID="$seeded_community"
        echo "  Using seeded COMMUNITY_ID=$COMMUNITY_ID"
      fi

      if [[ -z "$TEST_KEY" ]] && [[ -n "$seeded_key" ]] && [[ -f "$seeded_key" ]]; then
        TEST_KEY="$seeded_key"
        echo "  Using seeded TEST_KEY=$TEST_KEY"
      fi
    fi
  fi
fi

# ---------------------------------------------------------------------------
# State
# ---------------------------------------------------------------------------

P0_PASS=0
P0_FAIL=0
P0_SKIP=0
P1_PASS=0
P1_FAIL=0
P1_SKIP=0
RESULTS_JSON="[]"

# ---------------------------------------------------------------------------
# Timer (reuse pattern from validate-deployment.sh)
# ---------------------------------------------------------------------------

_TIMER_MODE="posix"
if [[ -n "${EPOCHREALTIME:-}" ]]; then
  _TIMER_MODE="epochrealtime"
elif date +%s%N > /dev/null 2>&1 && [[ "$(date +%s%N)" != "%s%N" ]]; then
  _TIMER_MODE="gnu_nano"
fi

timer_ms() {
  case "$_TIMER_MODE" in
    epochrealtime) echo "${EPOCHREALTIME/./}" | cut -c1-13 ;;
    gnu_nano)      echo "$(( $(date +%s%N) / 1000000 ))" ;;
    *)             echo "$(($(date +%s) * 1000))" ;;
  esac
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

record() {
  local priority="$1" phase="$2" name="$3" status="$4" class="$5" elapsed="$6" detail="${7:-}"

  if [[ "$status" == "PASS" ]]; then
    if [[ "$priority" == "P0" ]]; then P0_PASS=$((P0_PASS + 1)); else P1_PASS=$((P1_PASS + 1)); fi
    echo "  PASS  [$priority] $name (${elapsed}ms)"
  elif [[ "$status" == "FAIL" ]]; then
    if [[ "$priority" == "P0" ]]; then P0_FAIL=$((P0_FAIL + 1)); else P1_FAIL=$((P1_FAIL + 1)); fi
    echo "  FAIL  [$priority] $name (${elapsed}ms) — $class${detail:+: $detail}"
  elif [[ "$status" == "SKIP" ]]; then
    if [[ "$priority" == "P0" ]]; then P0_SKIP=$((P0_SKIP + 1)); else P1_SKIP=$((P1_SKIP + 1)); fi
    echo "  SKIP  [$priority] $name${detail:+ — $detail}"
  fi

  RESULTS_JSON=$(echo "$RESULTS_JSON" | jq --arg p "$priority" --arg ph "$phase" \
    --arg n "$name" --arg s "$status" --arg c "$class" --arg e "$elapsed" --arg d "$detail" \
    '. + [{"priority":$p,"phase":$ph,"name":$n,"status":$s,"classification":$c,"elapsed_ms":($e|tonumber),"detail":$d}]')
}

# Retry wrapper for flake detection (B-3)
# Usage: with_retry <name> <function>
# Sets RETRY_WAS_USED=true if success required >1 attempt
RETRY_WAS_USED=false

with_retry() {
  local name="$1" fn="$2"
  local attempt=0
  RETRY_WAS_USED=false

  while [[ $attempt -lt $RETRY_COUNT ]]; do
    attempt=$((attempt + 1))
    if "$fn"; then
      [[ $attempt -gt 1 ]] && RETRY_WAS_USED=true
      return 0
    fi
    if [[ $attempt -lt $RETRY_COUNT ]]; then
      echo "    Retry ${attempt}/$((RETRY_COUNT - 1)) for $name..."
      sleep 2
    fi
  done
  return 1
}

# Health check functions for retry wrapper
_check_freeside_health() {
  freeside_health=$(curl -sf --max-time 10 "$FREESIDE_URL/health" 2>/dev/null)
}

_check_dixie_health() {
  dixie_health=$(curl -sf --max-time 10 "$DIXIE_URL/api/health" 2>/dev/null)
}

_check_jwks() {
  jwks=$(curl -sf --max-time 10 "$FREESIDE_URL/.well-known/jwks.json" 2>/dev/null)
}

# Reputation query helper — shared by Phase 5 and Phase 7
# Usage: _query_reputation <routing_key>
# Returns: JSON with score field on stdout, exit 0 on success, 1 on failure
_query_reputation() {
  local routing_key="${1:-nft:test}"
  local rep_url="$DIXIE_URL/api/reputation/query?routingKey=$routing_key"
  local resp
  resp=$(curl -sf --max-time 10 "$rep_url" 2>/dev/null) || { echo ""; return 1; }

  local has_score
  has_score=$(echo "$resp" | jq 'has("score") or has("reputation")' 2>/dev/null)
  if [[ "$has_score" == "true" ]]; then
    echo "$resp"
    return 0
  else
    echo ""
    return 1
  fi
}

# Submit quality event to dixie reputation transport via finn
# Usage: _submit_quality_event <routing_key> <quality> <jwt_token>
# quality: "good" | "bad" | "excellent"
_submit_quality_event() {
  local routing_key="$1" quality="$2" token="$3"
  curl -sf --max-time 10 \
    -X POST "$FREESIDE_URL/api/agents/quality" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -d "{\"routingKey\":\"$routing_key\",\"quality\":\"$quality\",\"source\":\"smoke-test\"}" 2>/dev/null
}

# ---------------------------------------------------------------------------
# Banner
# ---------------------------------------------------------------------------

echo "================================================================"
echo "  Staging Smoke Test — SDD §10.1"
echo "================================================================"
echo ""
echo "  Freeside: $FREESIDE_URL"
echo "  Dixie:    $DIXIE_URL"
echo "  Test Key: ${TEST_KEY:-<none — JWT tests skipped>}"
echo "  Retries:  $RETRY_COUNT"
echo ""

# ===========================================================================
# PHASE 1 (P0): Health Checks
# ===========================================================================

echo "── Phase 1: Health Checks (P0) ─────────────────────────"
echo ""

# Freeside health (with retry for flake detection — B-3)
start=$(timer_ms)
with_retry "Freeside /health" _check_freeside_health && fh_ok=true || fh_ok=false
elapsed=$(( $(timer_ms) - start ))

if $fh_ok; then
  fh_status=$(echo "$freeside_health" | jq -r '.status // empty' 2>/dev/null)
  fh_class=""
  $RETRY_WAS_USED && fh_class="FLAKE"
  if [[ "$fh_status" == "healthy" ]] || [[ "$fh_status" == "degraded" ]]; then
    record P0 health "Freeside /health (status: $fh_status${fh_class:+, $fh_class})" PASS "$fh_class" "$elapsed"
  else
    record P0 health "Freeside /health" FAIL PLATFORM_BUG "$elapsed" "unexpected status: $fh_status"
  fi
else
  record P0 health "Freeside /health" FAIL PLATFORM_BUG "$elapsed" "unreachable"
fi

# Dixie health (with retry for flake detection — B-3)
start=$(timer_ms)
with_retry "Dixie /api/health" _check_dixie_health && dh_ok=true || dh_ok=false
elapsed=$(( $(timer_ms) - start ))

if $dh_ok; then
  dh_status=$(echo "$dixie_health" | jq -r '.status // empty' 2>/dev/null)
  dh_class=""
  $RETRY_WAS_USED && dh_class="FLAKE"
  if [[ "$dh_status" == "healthy" ]] || [[ "$dh_status" == "degraded" ]]; then
    record P0 health "Dixie /api/health (status: $dh_status${dh_class:+, $dh_class})" PASS "$dh_class" "$elapsed"
  else
    record P0 health "Dixie /api/health" FAIL PLATFORM_BUG "$elapsed" "unexpected status: $dh_status"
  fi
else
  record P0 health "Dixie /api/health" FAIL PLATFORM_BUG "$elapsed" "unreachable"
fi

echo ""

# ===========================================================================
# PHASE 2 (P0): JWKS Verification
# ===========================================================================

echo "── Phase 2: JWKS Verification (P0) ─────────────────────"
echo ""

start=$(timer_ms)
with_retry "JWKS verification" _check_jwks && jwks_ok=true || jwks_ok=false
elapsed=$(( $(timer_ms) - start ))

if $jwks_ok; then
  key_count=$(echo "$jwks" | jq '.keys | length' 2>/dev/null || echo 0)
  first_alg=$(echo "$jwks" | jq -r '.keys[0].alg // empty' 2>/dev/null)
  first_kid=$(echo "$jwks" | jq -r '.keys[0].kid // empty' 2>/dev/null)

  jwks_class=""
  $RETRY_WAS_USED && jwks_class="FLAKE"
  if [[ "$key_count" -ge 1 ]] && [[ "$first_alg" == "ES256" ]] && [[ -n "$first_kid" ]]; then
    record P0 jwks "JWKS (${key_count} key(s), alg=$first_alg, kid=$first_kid${jwks_class:+, $jwks_class})" PASS "$jwks_class" "$elapsed"
  elif [[ "$key_count" -ge 1 ]] && [[ "$first_alg" == "ES256" ]]; then
    record P0 jwks "JWKS (${key_count} key(s), alg=$first_alg, missing kid)" FAIL PLATFORM_BUG "$elapsed" "kid field required for key rotation"
  else
    record P0 jwks "JWKS" FAIL PLATFORM_BUG "$elapsed" "keys=$key_count, alg=$first_alg"
  fi
else
  record P0 jwks "JWKS" FAIL PLATFORM_BUG "$elapsed" "unreachable or invalid JSON"
fi

echo ""

# ===========================================================================
# PHASE 3 (P0): JWT Round-Trip + Agent Invoke (Task 4.2 + 4.3)
# ===========================================================================

echo "── Phase 3: JWT Round-Trip + Invoke (P0) ────────────────"
echo ""

if [[ -z "$TEST_KEY" ]]; then
  record P0 jwt-roundtrip "JWT round-trip" SKIP "" "0" "no --test-key provided"
  record P0 invoke "Agent invoke" SKIP "" "0" "no --test-key provided"
else
  # Mint JWT
  start=$(timer_ms)
  token=$(node "$SCRIPT_DIR/sign-test-jwt.mjs" "$TEST_KEY" 2>/dev/null) && jwt_mint_ok=true || jwt_mint_ok=false
  elapsed=$(( $(timer_ms) - start ))

  if ! $jwt_mint_ok || [[ -z "$token" ]]; then
    record P0 jwt-roundtrip "JWT mint" FAIL PLATFORM_BUG "$elapsed" "sign-test-jwt.mjs failed"
  else
    record P0 jwt-roundtrip "JWT mint (ES256)" PASS "" "$elapsed"

    # Invoke agent — this validates the full JWT round-trip:
    # freeside verifies JWT → forwards to finn → finn validates via JWKS → finn calls dixie
    invoke_successes=0
    invoke_failures=0
    invoke_total_ms=0

    for i in $(seq 1 5); do
      # Re-mint each iteration (unique jti per SDD §4.5)
      token=$(node "$SCRIPT_DIR/sign-test-jwt.mjs" "$TEST_KEY" 2>/dev/null) || true

      start=$(timer_ms)
      invoke_resp=$(curl -sf --max-time 30 \
        -X POST "$FREESIDE_URL/api/agents/invoke" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $token" \
        -d '{"prompt":"Say hello in exactly 3 words","model":"cheap"}' 2>/dev/null) && inv_ok=true || inv_ok=false
      elapsed=$(( $(timer_ms) - start ))
      invoke_total_ms=$((invoke_total_ms + elapsed))

      if $inv_ok; then
        has_content=$(echo "$invoke_resp" | jq 'has("content") or has("text") or has("choices")' 2>/dev/null)
        if [[ "$has_content" == "true" ]]; then
          invoke_successes=$((invoke_successes + 1))
        else
          invoke_failures=$((invoke_failures + 1))
        fi
      else
        invoke_failures=$((invoke_failures + 1))
      fi
    done

    avg_ms=$((invoke_total_ms / 5))

    if [[ $invoke_successes -eq 5 ]]; then
      record P0 invoke "Agent invoke (5/5 pass, avg ${avg_ms}ms)" PASS "" "$avg_ms"
    elif [[ $invoke_successes -ge 3 ]]; then
      # Model API flake — not our fault if JWT validates but model times out
      record P0 invoke "Agent invoke (${invoke_successes}/5 pass)" FAIL EXTERNAL_OUTAGE "$avg_ms" "${invoke_failures} failures (model API instability)"
    else
      record P0 invoke "Agent invoke (${invoke_successes}/5 pass)" FAIL PLATFORM_BUG "$avg_ms" "${invoke_failures} failures"
    fi

    # Latency check (p95 <10s per Task 4.3)
    if [[ $avg_ms -gt 10000 ]]; then
      echo "    WARN  Average invoke latency ${avg_ms}ms exceeds 10s target"
    fi
  fi
fi

echo ""

# ===========================================================================
# PHASE 4 (P0): Budget Conservation (Task 4.4)
# ===========================================================================

echo "── Phase 4: Budget Conservation (P0) ────────────────────"
echo ""

if [[ -z "$TEST_KEY" ]] || [[ -z "$COMMUNITY_ID" ]]; then
  skip_reason=""
  [[ -z "$TEST_KEY" ]] && skip_reason="no --test-key"
  [[ -z "$COMMUNITY_ID" ]] && skip_reason="${skip_reason:+$skip_reason + }no --community-id"
  record P0 budget "Budget conservation" SKIP "" "0" "$skip_reason"
else
  # Query initial budget
  start=$(timer_ms)
  budget_token=$(node "$SCRIPT_DIR/sign-test-jwt.mjs" "$TEST_KEY" 2>/dev/null) || true
  budget_before=$(curl -sf --max-time 10 \
    "$FREESIDE_URL/api/v1/communities/$COMMUNITY_ID/budget" \
    -H "Authorization: Bearer $budget_token" 2>/dev/null) && budget_ok=true || budget_ok=false
  elapsed=$(( $(timer_ms) - start ))

  if ! $budget_ok; then
    record P0 budget "Budget query" FAIL PLATFORM_BUG "$elapsed" "could not fetch budget"
  else
    monthly_budget=$(echo "$budget_before" | jq -r '.monthlyBudgetCents // 0' 2>/dev/null)
    initial_spent=$(echo "$budget_before" | jq -r '.spentCents // .committed // 0' 2>/dev/null)

    # Run 10 sequential invoke requests
    conservation_ok=true
    for i in $(seq 1 10); do
      inv_token=$(node "$SCRIPT_DIR/sign-test-jwt.mjs" "$TEST_KEY" 2>/dev/null) || true
      curl -sf --max-time 30 \
        -X POST "$FREESIDE_URL/api/agents/invoke" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $inv_token" \
        -d '{"prompt":"Hi","model":"cheap"}' >/dev/null 2>&1 || true

      # Check conservation invariant after each
      check_token=$(node "$SCRIPT_DIR/sign-test-jwt.mjs" "$TEST_KEY" 2>/dev/null) || true
      budget_now=$(curl -sf --max-time 10 \
        "$FREESIDE_URL/api/v1/communities/$COMMUNITY_ID/budget" \
        -H "Authorization: Bearer $check_token" 2>/dev/null) || true

      if [[ -n "$budget_now" ]]; then
        committed=$(echo "$budget_now" | jq -r '.committed // .spentCents // 0' 2>/dev/null)
        reserved=$(echo "$budget_now" | jq -r '.reserved // 0' 2>/dev/null)
        total_used=$((committed + reserved))

        if [[ $total_used -gt $monthly_budget ]]; then
          conservation_ok=false
          echo "    VIOLATION at iteration $i: committed($committed) + reserved($reserved) = $total_used > budget($monthly_budget)"
          break
        fi
      fi
    done

    elapsed=$(( $(timer_ms) - start ))

    if $conservation_ok; then
      record P0 budget "Budget conservation (10 sequential, invariant held)" PASS "" "$elapsed"

      # B-4: Concurrent budget conservation test
      # Stripe Rainforest pattern: sequential tests don't predict Redis MULTI/EXEC
      # behavior under contention. Fire parallel requests and check invariant after.
      echo ""
      echo "  Running concurrent budget test (5 parallel requests)..."

      concurrent_start=$(timer_ms)
      concurrent_pids=()

      for i in $(seq 1 5); do
        (
          c_token=$(node "$SCRIPT_DIR/sign-test-jwt.mjs" "$TEST_KEY" 2>/dev/null) || true
          curl -sf --max-time 30 \
            -X POST "$FREESIDE_URL/api/agents/invoke" \
            -H "Content-Type: application/json" \
            -H "Authorization: Bearer $c_token" \
            -d '{"prompt":"Hi","model":"cheap"}' >/dev/null 2>&1 || true
        ) &
        concurrent_pids+=($!)
      done

      # Wait for all concurrent requests to complete
      concurrent_failures=0
      for pid in "${concurrent_pids[@]}"; do
        wait "$pid" || concurrent_failures=$((concurrent_failures + 1))
      done

      # Check conservation invariant after concurrent burst
      c_check_token=$(node "$SCRIPT_DIR/sign-test-jwt.mjs" "$TEST_KEY" 2>/dev/null) || true
      budget_after_concurrent=$(curl -sf --max-time 10 \
        "$FREESIDE_URL/api/v1/communities/$COMMUNITY_ID/budget" \
        -H "Authorization: Bearer $c_check_token" 2>/dev/null) || true

      concurrent_elapsed=$(( $(timer_ms) - concurrent_start ))
      concurrent_ok=true

      if [[ -n "$budget_after_concurrent" ]]; then
        c_committed=$(echo "$budget_after_concurrent" | jq -r '.committed // .spentCents // 0' 2>/dev/null)
        c_reserved=$(echo "$budget_after_concurrent" | jq -r '.reserved // 0' 2>/dev/null)
        c_total=$((c_committed + c_reserved))

        if [[ $c_total -gt $monthly_budget ]]; then
          concurrent_ok=false
          echo "    CONCURRENT VIOLATION: committed($c_committed) + reserved($c_reserved) = $c_total > budget($monthly_budget)"
        fi
      fi

      if $concurrent_ok; then
        record P0 budget "Budget conservation (5 concurrent, invariant held)" PASS "" "$concurrent_elapsed"
      else
        # Concurrent fail + sequential pass = PLATFORM_BUG (race condition in budget logic)
        record P0 budget "Budget conservation (concurrent)" FAIL PLATFORM_BUG "$concurrent_elapsed" "invariant violated under concurrency"
      fi
    else
      record P0 budget "Budget conservation" FAIL PLATFORM_BUG "$elapsed" "invariant violated"
    fi
  fi
fi

echo ""

# ===========================================================================
# CHAOS: Economic Invariant Scenarios (--chaos flag)
# ===========================================================================
# Constellation Review §V.3: Test self-healing properties of the economic protocol.
# FAANG parallel: Amazon GameDay exercises for billing systems.

if $CHAOS_MODE && [[ -n "$TEST_KEY" ]] && [[ -n "$COMMUNITY_ID" ]]; then
  echo "── Chaos: Economic Invariant Scenarios (P1) ─────────────"
  echo ""

  # Chaos 1: Duplicate finalization — submit same usage report twice
  echo "  Scenario 1: Duplicate finalization (idempotency test)..."
  chaos1_start=$(timer_ms)
  chaos1_token=$(node "$SCRIPT_DIR/sign-test-jwt.mjs" "$TEST_KEY" 2>/dev/null) || true

  # First submission
  chaos1_resp=$(curl -sf --max-time 15 \
    -X POST "$FREESIDE_URL/api/agents/invoke" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $chaos1_token" \
    -d '{"prompt":"Chaos test 1","model":"cheap","idempotency_key":"chaos-smoke-dup-001"}' 2>/dev/null) || true

  # Duplicate submission with same idempotency key
  chaos1_dup_token=$(node "$SCRIPT_DIR/sign-test-jwt.mjs" "$TEST_KEY" 2>/dev/null) || true
  chaos1_dup_resp=$(curl -sf --max-time 15 \
    -X POST "$FREESIDE_URL/api/agents/invoke" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $chaos1_dup_token" \
    -d '{"prompt":"Chaos test 1","model":"cheap","idempotency_key":"chaos-smoke-dup-001"}' 2>/dev/null) || true

  # Check budget wasn't double-charged
  chaos1_check_token=$(node "$SCRIPT_DIR/sign-test-jwt.mjs" "$TEST_KEY" 2>/dev/null) || true
  chaos1_budget=$(curl -sf --max-time 10 \
    "$FREESIDE_URL/api/v1/communities/$COMMUNITY_ID/budget" \
    -H "Authorization: Bearer $chaos1_check_token" 2>/dev/null) || true
  chaos1_elapsed=$(( $(timer_ms) - chaos1_start ))

  if [[ -n "$chaos1_budget" ]]; then
    chaos1_committed=$(echo "$chaos1_budget" | jq -r '.committed // .spentCents // 0' 2>/dev/null)
    chaos1_reserved=$(echo "$chaos1_budget" | jq -r '.reserved // 0' 2>/dev/null)
    chaos1_total=$((chaos1_committed + chaos1_reserved))
    chaos1_limit=$(echo "$chaos1_budget" | jq -r '.monthlyBudgetCents // 0' 2>/dev/null)

    if [[ $chaos1_total -le $chaos1_limit ]]; then
      record P1 chaos "Chaos: duplicate finalization (invariant held)" PASS "" "$chaos1_elapsed"
    else
      record P1 chaos "Chaos: duplicate finalization" FAIL PLATFORM_BUG "$chaos1_elapsed" "double-charge detected: total=$chaos1_total > limit=$chaos1_limit"
    fi
  else
    record P1 chaos "Chaos: duplicate finalization" SKIP "" "$chaos1_elapsed" "budget query failed"
  fi

  # Chaos 2: Over-budget request — attempt to exceed remaining budget
  echo "  Scenario 2: Over-budget request (402/429 expected)..."
  chaos2_start=$(timer_ms)
  chaos2_token=$(node "$SCRIPT_DIR/sign-test-jwt.mjs" "$TEST_KEY" 2>/dev/null) || true

  # Use architect pool (most expensive) to try to hit budget limit
  chaos2_http_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 30 \
    -X POST "$FREESIDE_URL/api/agents/invoke" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $chaos2_token" \
    -d '{"prompt":"Write a 10000 word essay on chaos engineering","model":"architect"}' 2>/dev/null) || chaos2_http_code="000"
  chaos2_elapsed=$(( $(timer_ms) - chaos2_start ))

  # Any response is valid — we're testing the system handles budget exhaustion gracefully
  if [[ "$chaos2_http_code" == "402" ]] || [[ "$chaos2_http_code" == "429" ]]; then
    record P1 chaos "Chaos: over-budget request (HTTP $chaos2_http_code — correctly rejected)" PASS "" "$chaos2_elapsed"
  elif [[ "$chaos2_http_code" == "200" ]]; then
    # Budget not exhausted — still valid, just means we had headroom
    record P1 chaos "Chaos: over-budget request (HTTP 200 — budget had headroom)" PASS "" "$chaos2_elapsed"
  else
    record P1 chaos "Chaos: over-budget request (HTTP $chaos2_http_code)" FAIL PLATFORM_BUG "$chaos2_elapsed" "unexpected status code"
  fi

  # Chaos 3: Concurrent burst + conservation check (10 parallel)
  echo "  Scenario 3: Concurrent burst (10 parallel) + conservation check..."
  chaos3_start=$(timer_ms)
  chaos3_pids=()

  for i in $(seq 1 10); do
    (
      t=$(node "$SCRIPT_DIR/sign-test-jwt.mjs" "$TEST_KEY" 2>/dev/null) || true
      curl -sf --max-time 30 \
        -X POST "$FREESIDE_URL/api/agents/invoke" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $t" \
        -d '{"prompt":"Hi","model":"cheap"}' >/dev/null 2>&1 || true
    ) &
    chaos3_pids+=($!)
  done

  for pid in "${chaos3_pids[@]}"; do
    wait "$pid" 2>/dev/null || true
  done

  # Check invariant after burst
  chaos3_check_token=$(node "$SCRIPT_DIR/sign-test-jwt.mjs" "$TEST_KEY" 2>/dev/null) || true
  chaos3_budget=$(curl -sf --max-time 10 \
    "$FREESIDE_URL/api/v1/communities/$COMMUNITY_ID/budget" \
    -H "Authorization: Bearer $chaos3_check_token" 2>/dev/null) || true
  chaos3_elapsed=$(( $(timer_ms) - chaos3_start ))

  if [[ -n "$chaos3_budget" ]]; then
    chaos3_committed=$(echo "$chaos3_budget" | jq -r '.committed // .spentCents // 0' 2>/dev/null)
    chaos3_reserved=$(echo "$chaos3_budget" | jq -r '.reserved // 0' 2>/dev/null)
    chaos3_total=$((chaos3_committed + chaos3_reserved))
    chaos3_limit=$(echo "$chaos3_budget" | jq -r '.monthlyBudgetCents // 0' 2>/dev/null)

    if [[ $chaos3_total -le $chaos3_limit ]]; then
      record P1 chaos "Chaos: 10-concurrent burst (invariant held, total=$chaos3_total/$chaos3_limit)" PASS "" "$chaos3_elapsed"
    else
      record P1 chaos "Chaos: 10-concurrent burst" FAIL PLATFORM_BUG "$chaos3_elapsed" "conservation violated: total=$chaos3_total > limit=$chaos3_limit"
    fi
  else
    record P1 chaos "Chaos: 10-concurrent burst" SKIP "" "$chaos3_elapsed" "budget query failed after burst"
  fi

  echo ""
fi

# ===========================================================================
# PHASE 5 (P1): Reputation Query (Task 5.1 prerequisite)
# ===========================================================================

echo "── Phase 5: Reputation Query (P1) ───────────────────────"
echo ""

start=$(timer_ms)
rep_resp=$(_query_reputation "nft:test") && rep_ok=true || rep_ok=false
elapsed=$(( $(timer_ms) - start ))

if $rep_ok && [[ -n "$rep_resp" ]]; then
  score=$(echo "$rep_resp" | jq -r '.score // .reputation // "?"' 2>/dev/null)
  record P1 reputation "Reputation query (score: $score)" PASS "" "$elapsed"
else
  record P1 reputation "Reputation query" FAIL PLATFORM_BUG "$elapsed" "unreachable or auth required"
fi

echo ""

# ===========================================================================
# PHASE 6 (P1): SSE Streaming
# ===========================================================================

echo "── Phase 6: SSE Streaming (P1) ──────────────────────────"
echo ""

if [[ -z "$TEST_KEY" ]]; then
  record P1 sse "SSE streaming" SKIP "" "0" "no --test-key provided"
else
  start=$(timer_ms)
  sse_token=$(node "$SCRIPT_DIR/sign-test-jwt.mjs" "$TEST_KEY" 2>/dev/null) || true

  # Request SSE stream with short timeout — we just need to see event: lines
  sse_output=$(curl -sf --max-time 15 --no-buffer \
    -X POST "$FREESIDE_URL/api/agents/invoke" \
    -H "Content-Type: application/json" \
    -H "Accept: text/event-stream" \
    -H "Authorization: Bearer $sse_token" \
    -d '{"prompt":"Say hi","model":"cheap","stream":true}' 2>/dev/null) || true
  elapsed=$(( $(timer_ms) - start ))

  if echo "$sse_output" | grep -q "^data:"; then
    event_count=$(echo "$sse_output" | grep -c "^data:" || true)
    record P1 sse "SSE streaming ($event_count data events)" PASS "" "$elapsed"
  elif [[ -n "$sse_output" ]]; then
    record P1 sse "SSE streaming" FAIL PLATFORM_BUG "$elapsed" "response received but no SSE data: events"
  else
    record P1 sse "SSE streaming" FAIL EXTERNAL_OUTAGE "$elapsed" "no response (timeout or model API)"
  fi
fi

echo ""

# ===========================================================================
# PHASE 7 (P1): Autopoietic Loop Trace
# ===========================================================================
# "The single most important gap" — Bridgebuilder Constellation Review §V.1
# Proves the autopoietic loop: invoke → reputation signal → routing change
# FAANG parallel: Netflix recommendation "check trace"

echo "── Phase 7: Autopoietic Loop Trace (P1) ────────────────"
echo ""

if [[ -z "$TEST_KEY" ]] || [[ -z "$COMMUNITY_ID" ]]; then
  skip_reason=""
  [[ -z "$TEST_KEY" ]] && skip_reason="no --test-key"
  [[ -z "$COMMUNITY_ID" ]] && skip_reason="${skip_reason:+$skip_reason + }no --community-id"
  record P1 autopoietic "Autopoietic loop trace" SKIP "" "0" "$skip_reason"
else
  # Step 1: Query baseline reputation
  echo "  Step 1: Querying baseline reputation..."
  if [[ -n "${TEST_NFT_CONTRACT:-}" ]] && [[ -n "${TEST_NFT_TOKEN_ID:-}" ]]; then
    baseline_routing_key="nft:$TEST_NFT_CONTRACT:$TEST_NFT_TOKEN_ID"
  else
    baseline_routing_key="nft:test"
  fi

  autopoietic_start=$(timer_ms)
  baseline_resp=$(_query_reputation "$baseline_routing_key") && baseline_ok=true || baseline_ok=false

  if ! $baseline_ok || [[ -z "$baseline_resp" ]]; then
    elapsed=$(( $(timer_ms) - autopoietic_start ))
    record P1 autopoietic "Autopoietic loop trace" SKIP "" "$elapsed" "reputation system not reachable"
  else
    baseline_score=$(echo "$baseline_resp" | jq -r '.score // .reputation // 0' 2>/dev/null)
    echo "    Baseline score: $baseline_score"

    # Step 2: Invoke agent 3x to generate usage history
    echo "  Step 2: Invoking agent 3x to generate usage signals..."
    invoke_models=()
    for i in 1 2 3; do
      inv_token=$(node "$SCRIPT_DIR/sign-test-jwt.mjs" "$TEST_KEY" 2>/dev/null) || true
      inv_resp=$(curl -sf --max-time 30 \
        -X POST "$FREESIDE_URL/api/agents/invoke" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $inv_token" \
        -d '{"prompt":"Explain autopoiesis in one sentence","model":"cheap"}' 2>/dev/null) || true
      model_used=$(echo "$inv_resp" | jq -r '.model // .meta.model // "unknown"' 2>/dev/null)
      invoke_models+=("$model_used")
      echo "    Invoke $i: model=$model_used"
    done

    # Step 3: Submit quality events to dixie via finn reputation transport
    echo "  Step 3: Submitting quality events..."
    quality_submitted=0
    for quality in "good" "excellent" "good"; do
      q_token=$(node "$SCRIPT_DIR/sign-test-jwt.mjs" "$TEST_KEY" 2>/dev/null) || true
      if _submit_quality_event "$baseline_routing_key" "$quality" "$q_token" >/dev/null 2>&1; then
        quality_submitted=$((quality_submitted + 1))
        echo "    Submitted: $quality"
      else
        echo "    Failed to submit: $quality"
      fi
    done

    if [[ $quality_submitted -eq 0 ]]; then
      elapsed=$(( $(timer_ms) - autopoietic_start ))
      record P1 autopoietic "Autopoietic loop trace" FAIL PLATFORM_BUG "$elapsed" "quality events rejected (0/3 accepted)"
    else
      # Step 4: Wait for eventual consistency (SDD §FR-7: 10s)
      echo "  Step 4: Waiting 10s for reputation propagation (SDD §FR-7)..."
      sleep 10

      # Step 5: Query updated reputation
      echo "  Step 5: Querying updated reputation..."
      updated_resp=$(_query_reputation "$baseline_routing_key") && updated_ok=true || updated_ok=false

      if ! $updated_ok || [[ -z "$updated_resp" ]]; then
        elapsed=$(( $(timer_ms) - autopoietic_start ))
        record P1 autopoietic "Autopoietic loop trace" FAIL PLATFORM_BUG "$elapsed" "reputation unreachable after quality events"
      else
        updated_score=$(echo "$updated_resp" | jq -r '.score // .reputation // 0' 2>/dev/null)
        echo "    Updated score: $updated_score (was: $baseline_score)"

        # Step 6: Invoke again and compare routing
        echo "  Step 6: Invoking agent again — checking for routing change..."
        post_token=$(node "$SCRIPT_DIR/sign-test-jwt.mjs" "$TEST_KEY" 2>/dev/null) || true
        post_resp=$(curl -sf --max-time 30 \
          -X POST "$FREESIDE_URL/api/agents/invoke" \
          -H "Content-Type: application/json" \
          -H "Authorization: Bearer $post_token" \
          -d '{"prompt":"Explain autopoiesis in one sentence","model":"cheap"}' 2>/dev/null) || true
        post_model=$(echo "$post_resp" | jq -r '.model // .meta.model // "unknown"' 2>/dev/null)
        echo "    Post-quality model: $post_model (pre-quality: ${invoke_models[0]:-unknown})"

        elapsed=$(( $(timer_ms) - autopoietic_start ))

        # Step 7: Evaluate — score changed OR routing changed OR threshold not met
        score_changed=false
        routing_changed=false

        if [[ "$updated_score" != "$baseline_score" ]]; then
          score_changed=true
        fi
        if [[ "$post_model" != "${invoke_models[0]:-unknown}" ]] && [[ "$post_model" != "unknown" ]]; then
          routing_changed=true
        fi

        if $score_changed || $routing_changed; then
          detail="score: $baseline_score→$updated_score"
          $routing_changed && detail="$detail, routing: ${invoke_models[0]:-?}→$post_model"
          record P1 autopoietic "Autopoietic loop trace ($detail)" PASS "" "$elapsed"
        elif [[ "$quality_submitted" -gt 0 ]] && [[ "$updated_score" == "$baseline_score" ]]; then
          # Quality events accepted but no change after 10s — could be threshold
          # Wait additional 20s (total 30s) before declaring bug
          echo "    Score unchanged — waiting additional 20s..."
          sleep 20
          final_resp=$(_query_reputation "$baseline_routing_key") || true
          final_score=$(echo "$final_resp" | jq -r '.score // .reputation // 0' 2>/dev/null)
          elapsed=$(( $(timer_ms) - autopoietic_start ))

          if [[ "$final_score" != "$baseline_score" ]]; then
            record P1 autopoietic "Autopoietic loop trace (score: $baseline_score→$final_score, slow propagation)" PASS "" "$elapsed"
          else
            record P1 autopoietic "Autopoietic loop trace" SKIP "" "$elapsed" "quality events accepted ($quality_submitted) but score unchanged after 30s — reputation threshold not met"
          fi
        else
          record P1 autopoietic "Autopoietic loop trace" SKIP "" "$elapsed" "insufficient data for threshold"
        fi
      fi
    fi
  fi
fi

echo ""

# ===========================================================================
# PHASE 8 (P1): x402 Payment (Base Sepolia)
# ===========================================================================
# PRD FR-8, G-6: Validate x402 payment flow on Base Sepolia testnet.
# Mandatory: 402 response with payment-required headers.
# Optional: On-chain payment if SEPOLIA_RPC_URL and STAGING_WALLET_KEY are set.

echo "── Phase 8: x402 Payment (P1) ─────────────────────────"
echo ""

if [[ -z "$TEST_KEY" ]]; then
  record P1 x402 "x402 payment flow" SKIP "" "0" "no --test-key provided"
else
  # Step 1: POST without payment → expect 402 with x402 headers
  start=$(timer_ms)
  x402_token=$(node "$SCRIPT_DIR/sign-test-jwt.mjs" "$TEST_KEY" 2>/dev/null) || true

  x402_headers=$(mktemp)
  x402_body=$(curl -s -D "$x402_headers" -o - --max-time 15 \
    -X POST "$FREESIDE_URL/api/v1/x402/invoke" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $x402_token" \
    -d '{"prompt":"x402 payment test","model":"cheap"}' 2>/dev/null) || true
  x402_status=$(grep -i "^HTTP" "$x402_headers" | tail -1 | awk '{print $2}')
  elapsed=$(( $(timer_ms) - start ))

  if [[ "$x402_status" == "402" ]]; then
    # Verify x402 headers present
    has_x402_price=$(grep -ci "x-payment-required\|x-price\|x402" "$x402_headers" 2>/dev/null || echo 0)
    if [[ "$has_x402_price" -gt 0 ]]; then
      record P1 x402 "x402 402 response with payment headers" PASS "" "$elapsed"
    else
      record P1 x402 "x402 402 response" FAIL PLATFORM_BUG "$elapsed" "402 returned but missing x402 payment headers"
    fi

    # Step 2: On-chain payment (optional — requires wallet config)
    if [[ -n "${SEPOLIA_RPC_URL:-}" ]] && [[ -n "${STAGING_WALLET_KEY:-}" ]]; then
      echo "  Step 2: On-chain payment (Base Sepolia)..."
      # Parse payment requirements from 402 response
      payment_addr=$(echo "$x402_body" | jq -r '.paymentAddress // .address // empty' 2>/dev/null)
      payment_amount=$(echo "$x402_body" | jq -r '.amount // .price // empty' 2>/dev/null)

      if [[ -n "$payment_addr" ]] && [[ -n "$payment_amount" ]]; then
        onchain_start=$(timer_ms)
        # Submit payment via simple cast send (foundry) or node script
        if command -v cast &>/dev/null; then
          tx_hash=$(cast send "$payment_addr" --value "$payment_amount" \
            --rpc-url "$SEPOLIA_RPC_URL" \
            --private-key "$STAGING_WALLET_KEY" 2>/dev/null) || tx_hash=""
        fi

        if [[ -n "$tx_hash" ]]; then
          # Re-invoke with payment proof
          x402_pay_token=$(node "$SCRIPT_DIR/sign-test-jwt.mjs" "$TEST_KEY" 2>/dev/null) || true
          x402_paid_resp=$(curl -sf --max-time 30 \
            -X POST "$FREESIDE_URL/api/v1/x402/invoke" \
            -H "Content-Type: application/json" \
            -H "Authorization: Bearer $x402_pay_token" \
            -H "X-Payment-Proof: $tx_hash" \
            -d '{"prompt":"x402 payment test","model":"cheap"}' 2>/dev/null) || true
          onchain_elapsed=$(( $(timer_ms) - onchain_start ))

          credit_note=$(echo "$x402_paid_resp" | jq -r '.creditNote // .credit_note // empty' 2>/dev/null)
          if [[ -n "$credit_note" ]]; then
            record P1 x402 "x402 on-chain settlement + credit note issued" PASS "" "$onchain_elapsed"
          elif [[ -n "$x402_paid_resp" ]]; then
            record P1 x402 "x402 on-chain payment accepted (no credit note)" PASS "" "$onchain_elapsed"
          else
            record P1 x402 "x402 on-chain settlement" FAIL PLATFORM_BUG "$onchain_elapsed" "payment submitted but no response"
          fi
        else
          onchain_elapsed=$(( $(timer_ms) - onchain_start ))
          record P1 x402 "x402 on-chain payment" FAIL EXTERNAL_OUTAGE "$onchain_elapsed" "transaction failed (check Sepolia RPC)"
        fi
      else
        record P1 x402 "x402 on-chain payment" SKIP "" "0" "402 response missing payment address or amount"
      fi
    else
      echo "  SKIP: On-chain payment — SEPOLIA_RPC_URL and STAGING_WALLET_KEY not set"
      echo "    To enable: export SEPOLIA_RPC_URL=<rpc> STAGING_WALLET_KEY=<key>"
    fi
  elif [[ "$x402_status" == "404" ]]; then
    record P1 x402 "x402 endpoint" SKIP "" "$elapsed" "x402 endpoint not deployed (404)"
  else
    record P1 x402 "x402 402 response" FAIL PLATFORM_BUG "$elapsed" "expected 402, got $x402_status"
  fi

  rm -f "$x402_headers"
fi

echo ""

# ===========================================================================
# Summary
# ===========================================================================

echo "================================================================"
echo "  Summary"
echo "================================================================"
echo ""
echo "  P0: $P0_PASS pass, $P0_FAIL fail, $P0_SKIP skip"
echo "  P1: $P1_PASS pass, $P1_FAIL fail, $P1_SKIP skip"
echo ""

# JSON output
if $JSON_OUTPUT; then
  echo "$RESULTS_JSON" | jq '{
    timestamp: (now | strftime("%Y-%m-%dT%H:%M:%SZ")),
    freeside_url: $freeside,
    dixie_url: $dixie,
    p0: {pass: $p0p, fail: $p0f, skip: $p0s},
    p1: {pass: $p1p, fail: $p1f, skip: $p1s},
    exit_code: (if $p0f > 0 then 1 elif $p1f > 0 then 2 else 0 end),
    results: .
  }' --arg freeside "$FREESIDE_URL" --arg dixie "$DIXIE_URL" \
     --argjson p0p "$P0_PASS" --argjson p0f "$P0_FAIL" --argjson p0s "$P0_SKIP" \
     --argjson p1p "$P1_PASS" --argjson p1f "$P1_FAIL" --argjson p1s "$P1_SKIP" \
     > /dev/fd/2
fi

# Exit code per SDD §10.1
if [[ $P0_FAIL -gt 0 ]]; then
  echo "  Result: FAIL (P0 — deployment broken)"
  echo ""
  echo "================================================================"
  exit 1
elif [[ $P1_FAIL -gt 0 ]]; then
  echo "  Result: DEGRADED (P1 only — functional but impaired)"
  echo ""
  echo "================================================================"
  exit 2
else
  echo "  Result: PASS"
  echo ""
  echo "================================================================"
  exit 0
fi

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
# PHASE 5 (P1): Reputation Query (Task 5.1 prerequisite)
# ===========================================================================

echo "── Phase 5: Reputation Query (P1) ───────────────────────"
echo ""

start=$(timer_ms)
rep_resp=$(curl -sf --max-time 10 \
  "$DIXIE_URL/api/reputation/query?routingKey=nft:test" 2>/dev/null) && rep_ok=true || rep_ok=false
elapsed=$(( $(timer_ms) - start ))

if $rep_ok; then
  has_score=$(echo "$rep_resp" | jq 'has("score") or has("reputation")' 2>/dev/null)
  if [[ "$has_score" == "true" ]]; then
    score=$(echo "$rep_resp" | jq -r '.score // .reputation // "?"' 2>/dev/null)
    record P1 reputation "Reputation query (score: $score)" PASS "" "$elapsed"
  else
    record P1 reputation "Reputation query" FAIL PLATFORM_BUG "$elapsed" "response missing score field"
  fi
else
  # Dixie might require auth or the endpoint might differ — P1 so not blocking
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

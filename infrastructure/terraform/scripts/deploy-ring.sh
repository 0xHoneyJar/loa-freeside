#!/usr/bin/env bash
# =============================================================================
# Deploy Ring — Sequential Orchestrator with Health Gates
# Cycle 046: Armitage Platform — Sprint 2, Task 2.3
# SDD §5.1-§5.2: deploy-ring.sh
# =============================================================================
#
# 6-phase deployment: build → TF apply → Dixie → Finn → Freeside → wiring tests
# Health gates use sliding-window p99 with configurable thresholds (SKP-004/IMP-007).
# Automated rollback on health gate failure (SKP-004).
#
# Usage:
#   ./deploy-ring.sh <ring> [--services all|dixie,finn,freeside]
#   ./deploy-ring.sh staging
#   ./deploy-ring.sh staging --services finn,freeside

set -euo pipefail

# --- Configuration (configurable via env vars per IMP-007) ---
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-300}"                     # 5 minutes
HEALTH_INTERVAL="${HEALTH_INTERVAL:-5}"                     # 5 seconds
HEALTH_CONSECUTIVE_CHECKS="${HEALTH_CONSECUTIVE_CHECKS:-10}" # 10 consecutive
HEALTH_P99_THRESHOLD_MS="${HEALTH_P99_THRESHOLD_MS:-2000}"  # p99 < 2s
HEALTH_5XX_LIMIT="${HEALTH_5XX_LIMIT:-3}"                   # < 3 5xx errors

# --- Arguments ---
RING="${1:?Usage: deploy-ring.sh <ring> [--services all|dixie,finn,freeside]}"
shift
SERVICES="all"

DRY_RUN=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --services) SERVICES="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    *) echo "Unknown option: $1"; exit 2 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLUSTER="arrakis-${RING}"

# --- Centralized Health URLs (single source of truth) ---
# All services use HTTPS — no redirects expected.
declare -A HEALTH_URLS=(
  [dixie]="https://dixie.${RING}.arrakis.community/api/health"
  [finn]="https://finn.${RING}.arrakis.community/health"
  [freeside]="https://${RING}.api.arrakis.community/health"
)

# Prerequisites
command -v aws >/dev/null 2>&1 || { echo "ERROR: aws CLI required"; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "ERROR: curl required"; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "ERROR: jq required"; exit 1; }

# --- Logging ---
log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }
error() { log "ERROR: $*" >&2; }

# --- Rollback tracking ---
declare -A PREVIOUS_TD

capture_previous_td() {
  local service="$1"
  local td_arn
  td_arn=$(aws ecs describe-services --cluster "$CLUSTER" --services "${CLUSTER}-${service}" \
    --query 'services[0].taskDefinition' --output text 2>/dev/null) || td_arn=""
  if [[ -n "$td_arn" && "$td_arn" != "None" ]]; then
    PREVIOUS_TD["$service"]="$td_arn"
    log "Captured previous TD for $service: $td_arn"
  fi
}

rollback_service() {
  local service="$1"
  local prev_td="${PREVIOUS_TD[$service]:-}"
  if [[ -z "$prev_td" ]]; then
    error "No previous task definition for $service — cannot rollback"
    return 1
  fi
  log "ROLLBACK: Reverting $service to $prev_td"
  aws ecs update-service --cluster "$CLUSTER" --service "${CLUSTER}-${service}" \
    --task-definition "$prev_td" --force-new-deployment >/dev/null
  log "ROLLBACK: $service reverted — waiting for stability..."
  aws ecs wait services-stable --cluster "$CLUSTER" --services "${CLUSTER}-${service}" || true
}

# --- Health Gate (SDD §5.2) ---
health_gate() {
  local service="$1"
  local url="$2"
  local start_time
  start_time=$(date +%s)
  local consecutive=0
  local total_checks=0
  local latency_sum=0
  local fivexx_count=0
  local -a latency_window=()

  log "Health gate: checking $service at $url"

  while true; do
    local elapsed=$(( $(date +%s) - start_time ))
    if (( elapsed > HEALTH_TIMEOUT )); then
      error "Health gate TIMEOUT for $service after ${HEALTH_TIMEOUT}s (consecutive=$consecutive, 5xx=$fivexx_count)"
      rollback_service "$service"
      return 1
    fi

    local check_start check_end http_code latency_ms
    check_start=$(date +%s%N)
    http_code=$(curl -sf -o /dev/null -w '%{http_code}' --max-time 10 "$url" 2>/dev/null) || http_code="000"
    check_end=$(date +%s%N)
    latency_ms=$(( (check_end - check_start) / 1000000 ))

    total_checks=$((total_checks + 1))
    latency_sum=$((latency_sum + latency_ms))
    latency_window+=("$latency_ms")

    if [[ "$http_code" == "200" ]]; then
      consecutive=$((consecutive + 1))
    elif [[ "$http_code" =~ ^5 ]]; then
      fivexx_count=$((fivexx_count + 1))
      consecutive=0
      if (( fivexx_count >= HEALTH_5XX_LIMIT )); then
        error "Health gate FAILED for $service: ${fivexx_count} 5xx errors (limit: ${HEALTH_5XX_LIMIT})"
        rollback_service "$service"
        return 1
      fi
    else
      consecutive=0
    fi

    # Evaluate p99 over sliding window
    if (( ${#latency_window[@]} >= HEALTH_CONSECUTIVE_CHECKS )); then
      local p99_latency
      p99_latency=$(printf '%s\n' "${latency_window[@]}" | sort -n | awk -v p=0.99 \
        'BEGIN{c=0} {v[c++]=$1} END{idx=int(c*p); if(idx>=c) idx=c-1; print v[idx]}')

      if (( consecutive >= HEALTH_CONSECUTIVE_CHECKS )) && (( p99_latency < HEALTH_P99_THRESHOLD_MS )); then
        local avg_latency=$((latency_sum / total_checks))
        log "Health gate PASSED for $service: ${consecutive} consecutive OK, p99=${p99_latency}ms, avg=${avg_latency}ms"
        return 0
      elif (( p99_latency >= HEALTH_P99_THRESHOLD_MS )); then
        log "Health gate: p99 ${p99_latency}ms exceeds ${HEALTH_P99_THRESHOLD_MS}ms — waiting..."
        consecutive=0
      fi
    fi

    sleep "$HEALTH_INTERVAL"
  done
}

deploy_service() {
  local service="$1"
  log "Deploying $service on $RING..."
  aws ecs update-service --cluster "$CLUSTER" --service "${CLUSTER}-${service}" \
    --force-new-deployment >/dev/null
  log "Waiting for $service deployment to stabilize..."
  aws ecs wait services-stable --cluster "$CLUSTER" --services "${CLUSTER}-${service}"
}

should_deploy() {
  local service="$1"
  [[ "$SERVICES" == "all" ]] || echo "$SERVICES" | tr ',' '\n' | grep -qx "$service"
}

# --- Dry-run preflight (B1.3: validate URLs before deploy) ---
dry_run_preflight() {
  log "DRY-RUN: Validating health URLs..."
  local failures=0
  for svc in dixie finn freeside; do
    if ! should_deploy "$svc"; then continue; fi
    local url="${HEALTH_URLS[$svc]}"
    log "  Checking $svc → $url"
    local http_code effective_url
    http_code=$(curl -sI -o /dev/null -w '%{http_code}' --max-time 10 "$url" 2>/dev/null) || http_code="000"
    effective_url=$(curl -sI -o /dev/null -w '%{url_effective}' --max-time 10 "$url" 2>/dev/null) || effective_url=""
    log "    HTTP $http_code | Effective URL: ${effective_url:-N/A}"
    if [[ "$http_code" =~ ^[23] ]]; then
      log "    OK"
    else
      error "    FAIL: $svc health URL returned HTTP $http_code"
      failures=$((failures + 1))
    fi
  done
  if (( failures > 0 )); then
    error "DRY-RUN FAILED: $failures health URL(s) unreachable"
    exit 1
  fi
  log "DRY-RUN: All health URLs reachable"
}

if $DRY_RUN; then
  dry_run_preflight
  log "DRY-RUN complete — exiting without deploying"
  exit 0
fi

# --- Execution ---
log "════════════════════════════════════════"
log "Deploy Ring: $RING (services: $SERVICES)"
log "════════════════════════════════════════"

# Phase 1: Capture previous task definitions for rollback
log "Phase 0: Capturing previous task definitions..."
for svc in dixie finn freeside; do
  if should_deploy "$svc"; then
    capture_previous_td "$svc"
  fi
done

# Phase 2: Terraform Apply (if changes pending)
log "Phase 2: Terraform infrastructure..."
cd infrastructure/terraform
terraform plan -var-file="environments/${RING}/terraform.tfvars" -out=plan.tfplan -input=false
"${SCRIPT_DIR}/tf-plan-guard.sh" <(terraform show -json plan.tfplan)
terraform apply -input=false plan.tfplan
rm -f plan.tfplan
cd ../..

# Phase 3: Deploy Dixie (no upstream dependencies)
if should_deploy "dixie"; then
  log "Phase 3: Deploying Dixie..."
  deploy_service "dixie"
  health_gate "dixie" "${HEALTH_URLS[dixie]}" || {
    error "Phase 3 failed: Dixie health gate"
    exit 1
  }
fi

# Phase 4: Deploy Finn (needs DIXIE_BASE_URL)
if should_deploy "finn"; then
  log "Phase 4: Deploying Finn..."
  deploy_service "finn"
  health_gate "finn" "${HEALTH_URLS[finn]}" || {
    error "Phase 4 failed: Finn health gate"
    exit 1
  }
fi

# Phase 5: Deploy Freeside (needs both)
if should_deploy "freeside"; then
  log "Phase 5: Deploying Freeside..."
  deploy_service "freeside"
  health_gate "freeside" "${HEALTH_URLS[freeside]}" || {
    error "Phase 5 failed: Freeside health gate"
    exit 1
  }
fi

# Phase 6: Wiring tests
log "Phase 6: Wiring tests..."
"${SCRIPT_DIR}/staging-wiring-test.sh" "$RING"

log "════════════════════════════════════════"
log "Deploy complete. All services healthy, wiring verified."
log "════════════════════════════════════════"

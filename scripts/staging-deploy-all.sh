#!/usr/bin/env bash
# =============================================================================
# Cross-Repo Deployment Orchestration — B-8 (SDD §11.1)
# =============================================================================
# Triggers all three repos' deploy pipelines in dependency order:
#   freeside (infra + JWKS) → finn (needs JWKS) → dixie (needs finn)
#
# Uber "deployment groups" pattern: services that must be deployed together
# are updated in a defined order with verification between each.
#
# Usage:
#   ./scripts/staging-deploy-all.sh
#   ./scripts/staging-deploy-all.sh --dry-run
#   ./scripts/staging-deploy-all.sh --parallel
#
# Prerequisites:
#   - gh CLI authenticated with access to all 3 repos
#   - All repos have deploy-staging.yml workflow
#
# @see SDD §11.1, Sprint-373 Task 3.3
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
START_TIME=$(date +%s)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

REPOS=(
  "0xHoneyJar/loa-freeside"
  "0xHoneyJar/loa-finn"
  "0xHoneyJar/loa-dixie"
)
WORKFLOW="deploy-staging.yml"
BRANCH="staging"
DRY_RUN=false
PARALLEL=false
POLL_INTERVAL=30  # seconds between status checks

# ---------------------------------------------------------------------------
# Arguments
# ---------------------------------------------------------------------------

usage() {
  echo "Usage: $0 [options]"
  echo ""
  echo "Options:"
  echo "  --dry-run     Show what would be triggered without executing"
  echo "  --parallel    Deploy finn + dixie in parallel after freeside"
  echo "  --branch <b>  Branch to deploy (default: staging)"
  echo "  -h, --help    Show this help"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)   DRY_RUN=true; shift ;;
    --parallel)  PARALLEL=true; shift ;;
    --branch)    BRANCH="$2"; shift 2 ;;
    -h|--help)   usage; exit 0 ;;
    *)           echo "Unknown: $1"; usage; exit 1 ;;
  esac
done

elapsed() {
  echo $(( $(date +%s) - START_TIME ))
}

# ---------------------------------------------------------------------------
# Pre-flight: Verify gh auth for all repos
# ---------------------------------------------------------------------------

echo "================================================================"
echo "  Cross-Repo Staging Deployment"
echo "================================================================"
echo ""
echo "  Deploy order: freeside → finn → dixie"
echo "  Branch:       $BRANCH"
echo "  Parallel:     $PARALLEL"
echo "  Dry Run:      $DRY_RUN"
echo ""

echo "Verifying GitHub CLI auth for all repos..."
auth_ok=true
for repo in "${REPOS[@]}"; do
  if gh repo view "$repo" --json name >/dev/null 2>&1; then
    echo "  ✓ $repo"
  else
    echo "  ✗ $repo — no access"
    auth_ok=false
  fi
done

if ! $auth_ok; then
  echo ""
  echo "ERROR: Cannot access all repos. Ensure gh CLI is authenticated."
  exit 1
fi

echo ""

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

trigger_deploy() {
  local repo="$1"
  local repo_name=$(basename "$repo")

  echo "[$(elapsed)s] Triggering deploy for $repo_name..."

  if $DRY_RUN; then
    echo "  [dry-run] gh workflow run $WORKFLOW --repo $repo --ref $BRANCH"
    return 0
  fi

  gh workflow run "$WORKFLOW" --repo "$repo" --ref "$BRANCH" || {
    echo "  ERROR: Failed to trigger deploy for $repo_name"
    return 1
  }

  echo "  Deploy triggered for $repo_name"
}

wait_for_deploy() {
  local repo="$1"
  local repo_name=$(basename "$repo")
  local max_wait=600  # 10 minutes max
  local waited=0

  if $DRY_RUN; then
    echo "  [dry-run] Would wait for $repo_name deploy to complete"
    return 0
  fi

  echo "  Waiting for $repo_name deploy to complete..."

  # Brief pause for workflow to register
  sleep 5

  # Get the most recent run ID
  local run_id
  run_id=$(gh run list --repo "$repo" --workflow "$WORKFLOW" --limit 1 --json databaseId --jq '.[0].databaseId' 2>/dev/null) || true

  if [[ -z "$run_id" ]]; then
    echo "  WARNING: Could not find workflow run for $repo_name"
    return 1
  fi

  while [[ $waited -lt $max_wait ]]; do
    local status
    status=$(gh run view "$run_id" --repo "$repo" --json status,conclusion --jq '.status + ":" + (.conclusion // "")' 2>/dev/null) || true

    case "$status" in
      completed:success)
        echo "  ✓ $repo_name deploy succeeded (${waited}s)"
        return 0
        ;;
      completed:failure|completed:cancelled)
        echo "  ✗ $repo_name deploy failed ($status)"
        return 1
        ;;
      *)
        sleep "$POLL_INTERVAL"
        waited=$((waited + POLL_INTERVAL))
        echo "    $repo_name: $status (${waited}s elapsed)"
        ;;
    esac
  done

  echo "  ✗ $repo_name deploy timed out after ${max_wait}s"
  return 1
}

# ---------------------------------------------------------------------------
# Deploy in dependency order
# ---------------------------------------------------------------------------

DEPLOY_STATUS=0

# Step 1: Deploy freeside (infra + JWKS — must be first)
echo "── Step 1/3: Deploy freeside (infra + JWKS) ─────────────"
trigger_deploy "${REPOS[0]}" || { DEPLOY_STATUS=1; }
if [[ $DEPLOY_STATUS -eq 0 ]]; then
  wait_for_deploy "${REPOS[0]}" || { DEPLOY_STATUS=1; }
fi
echo ""

if [[ $DEPLOY_STATUS -ne 0 ]] && ! $DRY_RUN; then
  echo "ERROR: Freeside deploy failed — aborting (finn and dixie depend on freeside)"
  exit 1
fi

if $PARALLEL; then
  # Step 2+3: Deploy finn and dixie in parallel
  echo "── Step 2-3/3: Deploy finn + dixie (parallel) ───────────"

  trigger_deploy "${REPOS[1]}" &
  FINN_PID=$!
  trigger_deploy "${REPOS[2]}" &
  DIXIE_PID=$!
  wait $FINN_PID; FINN_TRIGGER=$?
  wait $DIXIE_PID; DIXIE_TRIGGER=$?

  if [[ $FINN_TRIGGER -ne 0 ]] || [[ $DIXIE_TRIGGER -ne 0 ]]; then
    echo "ERROR: Failed to trigger parallel deploys"
    DEPLOY_STATUS=1
  else
    wait_for_deploy "${REPOS[1]}" &
    FINN_WAIT_PID=$!
    wait_for_deploy "${REPOS[2]}" &
    DIXIE_WAIT_PID=$!

    wait $FINN_WAIT_PID; FINN_STATUS=$?
    wait $DIXIE_WAIT_PID; DIXIE_STATUS=$?

    [[ $FINN_STATUS -ne 0 ]] && DEPLOY_STATUS=1
    [[ $DIXIE_STATUS -ne 0 ]] && DEPLOY_STATUS=1
  fi
else
  # Step 2: Deploy finn (needs JWKS from freeside)
  echo "── Step 2/3: Deploy finn (needs JWKS) ───────────────────"
  trigger_deploy "${REPOS[1]}" || { DEPLOY_STATUS=1; }
  if [[ $DEPLOY_STATUS -eq 0 ]]; then
    wait_for_deploy "${REPOS[1]}" || { DEPLOY_STATUS=1; }
  fi
  echo ""

  # Step 3: Deploy dixie (needs finn for reputation)
  echo "── Step 3/3: Deploy dixie (needs finn) ──────────────────"
  trigger_deploy "${REPOS[2]}" || { DEPLOY_STATUS=1; }
  if [[ $DEPLOY_STATUS -eq 0 ]]; then
    wait_for_deploy "${REPOS[2]}" || { DEPLOY_STATUS=1; }
  fi
fi
echo ""

# ---------------------------------------------------------------------------
# Post-deploy: Run smoke test
# ---------------------------------------------------------------------------

echo "── Post-Deploy: Smoke Test ────────────────────────────────"

if $DRY_RUN; then
  echo "[dry-run] Would run staging-smoke.sh"
else
  if [[ -x "$SCRIPT_DIR/staging-smoke.sh" ]]; then
    echo "Running smoke test..."
    "$SCRIPT_DIR/staging-smoke.sh" && SMOKE_OK=true || SMOKE_OK=false

    if $SMOKE_OK; then
      echo "  ✓ Smoke test passed"
    else
      echo "  ✗ Smoke test failed"
      DEPLOY_STATUS=2
    fi
  else
    echo "  SKIP: staging-smoke.sh not found"
  fi
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

TOTAL_TIME=$(elapsed)

echo ""
echo "================================================================"
echo "  Deployment Summary"
echo "================================================================"
echo ""
echo "  Total Time:    ${TOTAL_TIME}s"
echo "  Mode:          $(if $PARALLEL; then echo "parallel (finn+dixie)"; else echo "sequential"; fi)"

if [[ $DEPLOY_STATUS -eq 0 ]]; then
  echo "  Status:        ALL PASSED"
elif [[ $DEPLOY_STATUS -eq 2 ]]; then
  echo "  Status:        DEPLOYED (smoke test failed)"
else
  echo "  Status:        FAILED"
fi

echo ""
echo "================================================================"
exit $DEPLOY_STATUS

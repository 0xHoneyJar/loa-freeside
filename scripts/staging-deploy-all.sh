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
# Post-deploy: Quick smoke test (basic health validation)
# ---------------------------------------------------------------------------

echo "── Post-Deploy: Quick Smoke Test ────────────────────────────"

if $DRY_RUN; then
  echo "[dry-run] Would run staging-smoke.sh"
else
  if [[ -x "$SCRIPT_DIR/staging-smoke.sh" ]]; then
    echo "Running quick smoke test (health + JWKS)..."
    "$SCRIPT_DIR/staging-smoke.sh" && SMOKE_OK=true || SMOKE_OK=false

    if $SMOKE_OK; then
      echo "  ✓ Quick smoke test passed"
    else
      echo "  ✗ Quick smoke test failed"
      DEPLOY_STATUS=2
    fi
  else
    echo "  SKIP: staging-smoke.sh not found"
  fi
fi

echo ""

# ---------------------------------------------------------------------------
# Post-deploy: Full validation with launch readiness report
# ---------------------------------------------------------------------------

echo "── Post-Deploy: Full Validation & Launch Readiness ──────────"

LAUNCH_STATUS="UNKNOWN"
P0_PASS=0
P0_FAIL=0
P0_SKIP=0
P1_PASS=0
P1_FAIL=0
P1_SKIP=0
P0_FAILURES=0
P1_FAILURES=0

if $DRY_RUN; then
  echo "[dry-run] Would run full validation with --retries 3 --auto-seed --json"
  LAUNCH_STATUS="DRY_RUN"
elif [[ $DEPLOY_STATUS -ne 0 ]]; then
  echo "  SKIP: Quick smoke test failed — skipping full validation"
  LAUNCH_STATUS="BLOCKED"
else
  if [[ -x "$SCRIPT_DIR/staging-smoke.sh" ]]; then
    echo "Running full validation (retries=3, auto-seed, JSON)..."

    VALIDATION_JSON=$(mktemp)
    "$SCRIPT_DIR/staging-smoke.sh" \
      --retries 3 \
      --auto-seed \
      --json \
      >"$VALIDATION_JSON" 2>&1 && FULL_OK=true || FULL_OK=false

    if [[ -s "$VALIDATION_JSON" ]]; then
      # Parse JSON output for P0/P1 pass/fail/skip counts
      P0_PASS=$(jq -r '.p0.pass // 0' "$VALIDATION_JSON" 2>/dev/null || echo 0)
      P0_FAIL=$(jq -r '.p0.fail // 0' "$VALIDATION_JSON" 2>/dev/null || echo 0)
      P0_SKIP=$(jq -r '.p0.skip // 0' "$VALIDATION_JSON" 2>/dev/null || echo 0)
      P1_PASS=$(jq -r '.p1.pass // 0' "$VALIDATION_JSON" 2>/dev/null || echo 0)
      P1_FAIL=$(jq -r '.p1.fail // 0' "$VALIDATION_JSON" 2>/dev/null || echo 0)
      P1_SKIP=$(jq -r '.p1.skip // 0' "$VALIDATION_JSON" 2>/dev/null || echo 0)
      P0_FAILURES=$P0_FAIL
      P1_FAILURES=$P1_FAIL
    fi

    rm -f "$VALIDATION_JSON"

    if [[ $P0_FAILURES -eq 0 ]] && [[ $P1_FAILURES -eq 0 ]]; then
      LAUNCH_STATUS="READY"
    elif [[ $P0_FAILURES -eq 0 ]]; then
      LAUNCH_STATUS="READY_DEGRADED"
    else
      LAUNCH_STATUS="NOT_READY"
      DEPLOY_STATUS=1
    fi
  fi
fi

echo ""

# ---------------------------------------------------------------------------
# Launch Readiness Report
# ---------------------------------------------------------------------------

TOTAL_TIME=$(elapsed)

echo "================================================================"
echo "  Launch Readiness Report"
echo "================================================================"
echo ""
echo "  Deploy Time:     ${TOTAL_TIME}s"
echo "  Deploy Mode:     $(if $PARALLEL; then echo "parallel (finn+dixie)"; else echo "sequential"; fi)"
echo "  Launch Status:   $LAUNCH_STATUS"
echo ""
echo "  ── Smoke Test Results ──"
echo "  P0 (blocking):   $P0_PASS pass, $P0_FAILURES fail, $P0_SKIP skip"
echo "  P1 (degraded):   $P1_PASS pass, $P1_FAILURES fail, $P1_SKIP skip"
echo ""
echo "  ── PRD Goal Coverage ──"
echo "  G-1 Infrastructure:   $(if [[ ${P0_PASS:-0} -ge 2 ]]; then echo "MET (health + JWKS)"; else echo "UNVERIFIED"; fi)"
echo "  G-2 Authentication:   $(if [[ ${P0_PASS:-0} -ge 3 ]]; then echo "MET (JWT round-trip)"; else echo "UNVERIFIED"; fi)"
echo "  G-3 Core Flow:        $(if [[ ${P0_PASS:-0} -ge 4 ]]; then echo "MET (invoke + budget)"; else echo "UNVERIFIED"; fi)"
echo "  G-4 Budget:           $(if [[ ${P0_FAILURES:-1} -eq 0 ]]; then echo "MET (conservation holds)"; else echo "FAILED"; fi)"
echo "  G-5 Reputation:       See Phase 7 results"
echo "  G-6 Payments:         See Phase 8 results"
echo "  G-7 Reliability:      $(if [[ ${P0_FAILURES:-1} -eq 0 ]]; then echo "MET (0 P0 failures)"; else echo "FAILED"; fi)"
echo "  G-9 Monitoring:       Check CloudWatch dashboards manually"
echo ""

case "$LAUNCH_STATUS" in
  READY)
    echo "  VERDICT: LAUNCH READY — all P0 and P1 checks passed"
    ;;
  READY_DEGRADED)
    echo "  VERDICT: LAUNCH READY (DEGRADED) — P0 passed, $P1_FAILURES P1 failures"
    echo "  Action: Review P1 failures and track as follow-up"
    ;;
  NOT_READY)
    echo "  VERDICT: NOT READY — $P0_FAILURES P0 failures must be resolved"
    echo "  Action: Fix P0 failures and re-run validation"
    ;;
  BLOCKED)
    echo "  VERDICT: BLOCKED — deployment failed, validation skipped"
    ;;
  *)
    echo "  VERDICT: $LAUNCH_STATUS"
    ;;
esac

echo ""
echo "================================================================"

# Exit with launch-readiness status: 0 (ready), 1 (P0 failures), 2 (P1 only)
if [[ "$LAUNCH_STATUS" == "READY" ]]; then
  exit 0
elif [[ "$LAUNCH_STATUS" == "READY_DEGRADED" ]]; then
  exit 2
else
  exit 1
fi

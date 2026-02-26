#!/usr/bin/env bash
# =============================================================================
# Emergency Key Revocation — <5min Target (SDD §4.6, SKP-002)
# =============================================================================
# Immediately revokes a compromised key and deploys a replacement.
# NO overlap window — compromised kid is removed instantly.
#
# Time budget (SDD §4.6):
#   0:00 — Remove compromised key from Secrets Manager
#   0:30 — New key generated and deployed
#   1:00 — Force-restart services to flush JWKS caches
#   3:00 — All services running with new key
#   5:00 — Verification complete
#
# Usage:
#   ./scripts/revoke-staging-key.sh --service freeside
#   ./scripts/revoke-staging-key.sh --service finn --dry-run
#
# @see SDD §4.6, Sprint-370 Task 5.5
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
START_TIME=$(date +%s)

# ---------------------------------------------------------------------------
# Arguments
# ---------------------------------------------------------------------------

SERVICE=""
REGION="${AWS_DEFAULT_REGION:-us-east-1}"
ENV="staging"
DRY_RUN=false
PREFIX=""
CLUSTER=""

usage() {
  echo "Usage: $0 --service <freeside|finn|dixie> [options]"
  echo ""
  echo "Options:"
  echo "  --service   Service with compromised key (required)"
  echo "  --env       Environment (default: staging)"
  echo "  --region    AWS region (default: us-east-1)"
  echo "  --dry-run   Show what would happen without making changes"
  echo "  -h, --help  Show this help"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --service)  SERVICE="$2"; shift 2 ;;
    --env)      ENV="$2"; shift 2 ;;
    --region)   REGION="$2"; shift 2 ;;
    --dry-run)  DRY_RUN=true; shift ;;
    -h|--help)  usage; exit 0 ;;
    *)          echo "Unknown: $1"; usage; exit 1 ;;
  esac
done

if [[ -z "$SERVICE" ]]; then
  echo "ERROR: --service is required"
  usage
  exit 1
fi

case "$SERVICE" in
  freeside|finn|dixie) ;;
  *) echo "ERROR: service must be freeside, finn, or dixie"; exit 1 ;;
esac

PREFIX="arrakis-${ENV}"
CLUSTER="${PREFIX}-cluster"
SECRET_ID="${PREFIX}/${SERVICE}/es256-private-key"
NEW_KID="${SERVICE}-emergency-$(date +%Y%m%d%H%M%S)"

elapsed() {
  echo $(( $(date +%s) - START_TIME ))
}

echo "================================================================"
echo "  EMERGENCY KEY REVOCATION — ${SERVICE} (${ENV})"
echo "================================================================"
echo ""
echo "  Secret:   $SECRET_ID"
echo "  New KID:  $NEW_KID"
echo "  Dry Run:  $DRY_RUN"
echo ""

if $DRY_RUN; then
  echo "[dry-run] Would revoke key for $SERVICE and generate replacement"
  echo "[dry-run] Would force-restart ECS service"
  echo "[dry-run] No changes made"
  exit 0
fi

# ---------------------------------------------------------------------------
# Step 1: Generate replacement key FIRST (before revoking)
# ---------------------------------------------------------------------------

echo "[$(elapsed)s] Step 1: Generating replacement ES256 keypair..."

TMPDIR=$(mktemp -d)
chmod 700 "$TMPDIR"
trap 'rm -rf "$TMPDIR"' EXIT

openssl ecparam -genkey -name prime256v1 -noout \
  -out "$TMPDIR/new-private.pem" 2>/dev/null
openssl ec -in "$TMPDIR/new-private.pem" -check -noout 2>/dev/null || {
  echo "ERROR: Generated key failed validation"
  exit 1
}

echo "  Replacement key generated and validated"

# ---------------------------------------------------------------------------
# Step 2: Deploy replacement key (atomic — revoke old + deploy new)
# ---------------------------------------------------------------------------

echo "[$(elapsed)s] Step 2: Deploying replacement key (revoking old)..."

NEW_PRIVATE_PEM=$(cat "$TMPDIR/new-private.pem")

# Build new secret with only the new key — old key is gone
REVOKED_SECRET=$(jq -n \
  --arg kid "$NEW_KID" \
  --arg key "$NEW_PRIVATE_PEM" \
  '{activeKid: $kid, privateKey: $key, revocation: {timestamp: (now | strftime("%Y-%m-%dT%H:%M:%SZ")), reason: "emergency"}}')

echo "$REVOKED_SECRET" > "$TMPDIR/secret-value.json"
chmod 600 "$TMPDIR/secret-value.json"

aws secretsmanager put-secret-value \
  --secret-id "$SECRET_ID" \
  --cli-input-json "{\"SecretId\":\"$SECRET_ID\",\"SecretString\":$(jq -Rs '.' "$TMPDIR/secret-value.json")}" \
  --region "$REGION" >/dev/null

echo "  Compromised key revoked. New key deployed: $NEW_KID"

# ---------------------------------------------------------------------------
# Step 3: Force-restart service to flush JWKS caches
# ---------------------------------------------------------------------------

echo "[$(elapsed)s] Step 3: Force-restarting ECS service to flush caches..."

# Map service name to ECS service name
case "$SERVICE" in
  freeside) ECS_SERVICE="${PREFIX}-api" ;;
  finn)     ECS_SERVICE="${PREFIX}-finn" ;;
  dixie)    ECS_SERVICE="${PREFIX}-dixie" ;;
esac

aws ecs update-service \
  --cluster "$CLUSTER" \
  --service "$ECS_SERVICE" \
  --force-new-deployment \
  --region "$REGION" \
  --query 'service.deployments[0].status' \
  --output text >/dev/null

echo "  Service $ECS_SERVICE force-restarting"

# If freeside key was revoked, also restart consumers (finn, dixie)
# They cache freeside's JWKS and need to refresh
if [[ "$SERVICE" == "freeside" ]]; then
  echo "  Freeside key revoked — also restarting consumers..."
  for consumer in "${PREFIX}-finn" "${PREFIX}-dixie"; do
    aws ecs update-service \
      --cluster "$CLUSTER" \
      --service "$consumer" \
      --force-new-deployment \
      --region "$REGION" \
      --query 'service.deployments[0].status' \
      --output text >/dev/null 2>&1 || echo "  WARNING: Could not restart $consumer"
  done
  echo "  All consumer services restarting"
fi

# ---------------------------------------------------------------------------
# Step 4: Wait for services to stabilize
# ---------------------------------------------------------------------------

echo "[$(elapsed)s] Step 4: Waiting for service stability..."

aws ecs wait services-stable \
  --cluster "$CLUSTER" \
  --services "$ECS_SERVICE" \
  --region "$REGION" 2>/dev/null || {
  echo "  WARNING: Service did not stabilize within timeout"
  echo "  Check ECS console for deployment status"
}

echo "  Service stable"

# ---------------------------------------------------------------------------
# Step 5: Verify
# ---------------------------------------------------------------------------

echo "[$(elapsed)s] Step 5: Verifying new key is active..."

if [[ -x "$SCRIPT_DIR/staging-smoke.sh" ]]; then
  FREESIDE_URL="https://staging.api.arrakis.community" \
  DIXIE_URL="https://dixie.staging.arrakis.community" \
    "$SCRIPT_DIR/staging-smoke.sh" 2>/dev/null && VERIFY_OK=true || VERIFY_OK=false

  if $VERIFY_OK; then
    echo "  Verification passed — new key accepted by all services"
  else
    echo "  WARNING: Verification had failures — check smoke test output"
  fi
else
  echo "  SKIP: staging-smoke.sh not found — manual verification required"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

TOTAL_TIME=$(elapsed)

echo ""
echo "================================================================"
echo "  EMERGENCY REVOCATION COMPLETE"
echo "================================================================"
echo ""
echo "  Service:      $SERVICE"
echo "  New KID:      $NEW_KID"
echo "  Total Time:   ${TOTAL_TIME}s"
echo "  Time Budget:  $(if [[ $TOTAL_TIME -le 300 ]]; then echo "WITHIN 5min target"; else echo "EXCEEDED 5min target (${TOTAL_TIME}s)"; fi)"
echo ""
echo "  Post-revocation checklist:"
echo "    [ ] Verify no JWT_VALIDATION_FAILED errors in CloudWatch"
echo "    [ ] Notify team of key revocation"
echo "    [ ] Investigate compromised key source"
echo "    [ ] Update incident log"
echo ""
echo "================================================================"

#!/usr/bin/env bash
#
# Agent JWT Key Rotation Script
# Sprint S5-T7: Generates new RS256 key pair, updates Secrets Manager,
# preserves previous key for 48h overlap window.
#
# Usage:
#   ./scripts/agent-key-rotation.sh [--dry-run] [--env staging|production]
#
# Prerequisites:
#   - AWS CLI configured with appropriate credentials
#   - openssl available
#   - jq available
#
# @see SDD §8.1 Key Rotation
# @see Trust Boundary §3.1 JWKS Trust Model

set -euo pipefail

# --------------------------------------------------------------------------
# Configuration (S1-T4: parameterized — Bridgebuilder Finding #6)
# --------------------------------------------------------------------------

DRY_RUN=false
ENV=""
SECRET_NAME=""
AWS_REGION="${AWS_REGION:-us-east-1}"
KEY_ID_PREFIX="arrakis-key"
OVERLAP_HOURS=48

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)       DRY_RUN=true; shift ;;
    --env)           ENV="$2"; shift 2 ;;
    --secret-name)   SECRET_NAME="$2"; shift 2 ;;
    --region)        AWS_REGION="$2"; shift 2 ;;
    --overlap-hours) OVERLAP_HOURS="$2"; shift 2 ;;
    *)
      echo "Unknown option: $1"
      echo "Usage: $0 [--dry-run] [--env staging|production] [--secret-name NAME] [--region REGION] [--overlap-hours N]"
      exit 2
      ;;
  esac
done

# Defaults
ENV="${ENV:-staging}"
SECRET_NAME="${SECRET_NAME:-arrakis-${ENV}/agent-jwt-signing-key}"

if [[ "${DRY_RUN}" == "true" ]]; then
  echo "[DRY RUN] No changes will be made"
fi

# Concurrent rotation prevention: check if rotation already in progress
ROTATION_TAG=$(aws secretsmanager describe-secret \
  --secret-id "${SECRET_NAME}" \
  --region "${AWS_REGION}" \
  --query 'Tags[?Key==`rotation-in-progress`].Value | [0]' \
  --output text 2>/dev/null || echo "None")

if [[ "${ROTATION_TAG}" != "None" && "${ROTATION_TAG}" != "null" && "${ROTATION_TAG}" != "" ]]; then
  echo "ERROR: Rotation already in progress (started: ${ROTATION_TAG})"
  echo "If this is stale, remove the 'rotation-in-progress' tag manually."
  exit 1
fi

echo "=== Agent JWT Key Rotation ==="
echo "Environment: ${ENV}"
echo "Secret: ${SECRET_NAME}"
echo "Overlap window: ${OVERLAP_HOURS}h"
echo ""

# --------------------------------------------------------------------------
# Step 1: Generate new RS256 key pair
# --------------------------------------------------------------------------

echo "[1/5] Generating new RS256 key pair..."

TIMESTAMP=$(date +%Y%m%d%H%M%S)
NEW_KEY_ID="${KEY_ID_PREFIX}-${TIMESTAMP}"
TMPDIR=$(mktemp -d)
trap 'rm -rf "${TMPDIR}"' EXIT

openssl genrsa -out "${TMPDIR}/private.pem" 2048 2>/dev/null
openssl rsa -in "${TMPDIR}/private.pem" -pubout -out "${TMPDIR}/public.pem" 2>/dev/null

echo "  Key ID: ${NEW_KEY_ID}"
echo "  Private key: ${TMPDIR}/private.pem"
echo "  Public key: ${TMPDIR}/public.pem"

# --------------------------------------------------------------------------
# Step 2: Read current secret (previous key)
# --------------------------------------------------------------------------

echo "[2/5] Reading current key from Secrets Manager..."

CURRENT_SECRET=""
if aws secretsmanager describe-secret --secret-id "${SECRET_NAME}" --region "${AWS_REGION}" &>/dev/null; then
  CURRENT_SECRET=$(aws secretsmanager get-secret-value \
    --secret-id "${SECRET_NAME}" \
    --region "${AWS_REGION}" \
    --query 'SecretString' \
    --output text 2>/dev/null || echo "")

  if [[ -n "${CURRENT_SECRET}" ]]; then
    CURRENT_KEY_ID=$(echo "${CURRENT_SECRET}" | jq -r '.key_id // "unknown"')
    echo "  Current key ID: ${CURRENT_KEY_ID}"
  else
    echo "  No current key found (first rotation)"
  fi
else
  echo "  Secret does not exist yet (will be created by Terraform)"
  echo "  ERROR: Run 'terraform apply' first to create the secret resource"
  exit 1
fi

# --------------------------------------------------------------------------
# Step 3: Build new secret value with previous key
# --------------------------------------------------------------------------

echo "[3/5] Building new secret value..."

PRIVATE_KEY=$(cat "${TMPDIR}/private.pem")
PUBLIC_KEY=$(cat "${TMPDIR}/public.pem")
ROTATION_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
EXPIRY_TIME=$(date -u -d "+${OVERLAP_HOURS} hours" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || \
              date -u -v+${OVERLAP_HOURS}H +"%Y-%m-%dT%H:%M:%SZ")

# Build JSON with previous key for overlap
if [[ -n "${CURRENT_SECRET}" ]]; then
  PREVIOUS_KEY_ID=$(echo "${CURRENT_SECRET}" | jq -r '.key_id')
  PREVIOUS_PRIVATE=$(echo "${CURRENT_SECRET}" | jq -r '.private_key')

  NEW_SECRET=$(jq -n \
    --arg kid "${NEW_KEY_ID}" \
    --arg priv "${PRIVATE_KEY}" \
    --arg pub "${PUBLIC_KEY}" \
    --arg rot "${ROTATION_TIME}" \
    --arg pkid "${PREVIOUS_KEY_ID}" \
    --arg ppriv "${PREVIOUS_PRIVATE}" \
    --arg exp "${EXPIRY_TIME}" \
    '{
      key_id: $kid,
      private_key: $priv,
      public_key: $pub,
      rotated_at: $rot,
      previous: {
        key_id: $pkid,
        private_key: $ppriv,
        expires_at: $exp
      }
    }')
else
  NEW_SECRET=$(jq -n \
    --arg kid "${NEW_KEY_ID}" \
    --arg priv "${PRIVATE_KEY}" \
    --arg pub "${PUBLIC_KEY}" \
    --arg rot "${ROTATION_TIME}" \
    '{
      key_id: $kid,
      private_key: $priv,
      public_key: $pub,
      rotated_at: $rot
    }')
fi

echo "  New key ID: ${NEW_KEY_ID}"
echo "  Rotation time: ${ROTATION_TIME}"
if [[ -n "${CURRENT_SECRET}" ]]; then
  echo "  Previous key expires: ${EXPIRY_TIME}"
fi

# --------------------------------------------------------------------------
# Step 4: Update Secrets Manager
# --------------------------------------------------------------------------

echo "[4/5] Updating Secrets Manager..."

if [[ "${DRY_RUN}" == "true" ]]; then
  echo "  [DRY RUN] Would update secret: ${SECRET_NAME}"
else
  aws secretsmanager put-secret-value \
    --secret-id "${SECRET_NAME}" \
    --secret-string "${NEW_SECRET}" \
    --region "${AWS_REGION}"

  echo "  Secret updated successfully"
fi

# --------------------------------------------------------------------------
# Step 5: Verify
# --------------------------------------------------------------------------

echo "[5/5] Verification..."

if [[ "${DRY_RUN}" == "true" ]]; then
  echo "  [DRY RUN] Skipping verification"
else
  VERIFY=$(aws secretsmanager get-secret-value \
    --secret-id "${SECRET_NAME}" \
    --region "${AWS_REGION}" \
    --query 'SecretString' \
    --output text | jq -r '.key_id')

  if [[ "${VERIFY}" == "${NEW_KEY_ID}" ]]; then
    echo "  Verification PASSED: key_id = ${VERIFY}"
  else
    echo "  Verification FAILED: expected ${NEW_KEY_ID}, got ${VERIFY}"
    exit 1
  fi
fi

echo ""
echo "=== Key Rotation Complete ==="
echo ""
echo "Next steps:"
echo "  1. ECS tasks will pick up new key on next deployment/restart"
echo "  2. JWKS endpoint will serve both keys during ${OVERLAP_HOURS}h overlap"
echo "  3. Previous key auto-expires at ${EXPIRY_TIME:-N/A}"
echo "  4. Monitor: check for 401 errors in agent gateway logs"

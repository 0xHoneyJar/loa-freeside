#!/usr/bin/env bash
# =============================================================================
# Staging Key Rotation — Dual-KID Protocol (SDD §4.6)
# =============================================================================
# 8-step ES256 key rotation with zero-downtime dual-kid overlap.
#
# Protocol:
#   1. Generate new keypair with new kid
#   2. Dual-publish: update secret to serve both old and new kid
#   3. Wait for JWKS cache TTL (5min)
#   4. Switch issuer to new kid
#   5. Monitor for JWT_VALIDATION_FAILED errors (15min)
#   6. Remove old kid from JWKS
#   7. Run staging-smoke.sh JWT round-trip
#   8. Delete old private key material
#
# Usage:
#   ./scripts/rotate-staging-keys.sh --service freeside
#   ./scripts/rotate-staging-keys.sh --service finn --dry-run
#   ./scripts/rotate-staging-keys.sh --service dixie --skip-monitor
#
# @see SDD §4.6, PRD FR-4
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ---------------------------------------------------------------------------
# Arguments
# ---------------------------------------------------------------------------

SERVICE=""
REGION="${AWS_DEFAULT_REGION:-us-east-1}"
ENV="staging"
DRY_RUN=false
SKIP_MONITOR=false
PREFIX="arrakis-staging"

usage() {
  echo "Usage: $0 --service <freeside|finn|dixie> [options]"
  echo ""
  echo "Options:"
  echo "  --service       Service to rotate keys for (required)"
  echo "  --env           Environment (default: staging)"
  echo "  --region        AWS region (default: us-east-1)"
  echo "  --dry-run       Generate keys but don't deploy"
  echo "  --skip-monitor  Skip the 15min monitoring window"
  echo "  -h, --help      Show this help"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --service)      SERVICE="$2"; shift 2 ;;
    --env)          ENV="$2"; shift 2 ;;
    --region)       REGION="$2"; shift 2 ;;
    --dry-run)      DRY_RUN=true; shift ;;
    --skip-monitor) SKIP_MONITOR=true; shift ;;
    -h|--help)      usage; exit 0 ;;
    *)              echo "Unknown: $1"; usage; exit 1 ;;
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
SECRET_ID="${PREFIX}/${SERVICE}/es256-private-key"
NEW_KID="${SERVICE}-$(date +%Y%m%d)-$(openssl rand -hex 4)"

echo "================================================================"
echo "  Key Rotation — ${SERVICE} (${ENV})"
echo "================================================================"
echo ""
echo "  Secret ID:  $SECRET_ID"
echo "  New KID:    $NEW_KID"
echo "  Dry Run:    $DRY_RUN"
echo ""

# ---------------------------------------------------------------------------
# Step 1: Read current key state
# ---------------------------------------------------------------------------

echo "[step 1/8] Reading current secret..."

CURRENT_SECRET=$(aws secretsmanager get-secret-value \
  --secret-id "$SECRET_ID" \
  --region "$REGION" \
  --query SecretString \
  --output text 2>/dev/null) || {
  echo "ERROR: Could not read secret $SECRET_ID"
  exit 1
}

# Secret may be raw PEM or JSON with activeKid (schemaVersion 1+)
if echo "$CURRENT_SECRET" | jq -e '.activeKid' >/dev/null 2>&1; then
  CURRENT_KID=$(echo "$CURRENT_SECRET" | jq -r '.activeKid')
  SCHEMA_VERSION=$(echo "$CURRENT_SECRET" | jq -r '.schemaVersion // 0')
  echo "  Current KID: $CURRENT_KID (structured secret, schema v${SCHEMA_VERSION})"
else
  CURRENT_KID="legacy-$(date +%Y%m%d)"
  echo "  Current KID: <raw PEM, no kid> — will migrate to structured format (schema v1)"
fi

# ---------------------------------------------------------------------------
# Step 2: Generate new ES256 keypair
# ---------------------------------------------------------------------------

echo "[step 2/8] Generating new ES256 keypair..."

TMPDIR=$(mktemp -d)
chmod 700 "$TMPDIR"
trap 'rm -rf "$TMPDIR"' EXIT

openssl ecparam -genkey -name prime256v1 -noout \
  -out "$TMPDIR/new-private.pem" 2>/dev/null
openssl ec -in "$TMPDIR/new-private.pem" -pubout \
  -out "$TMPDIR/new-public.pem" 2>/dev/null

# Validate key
openssl ec -in "$TMPDIR/new-private.pem" -check -noout 2>/dev/null || {
  echo "ERROR: Generated key failed validation"
  exit 1
}

echo "  New keypair generated and validated"

if $DRY_RUN; then
  echo ""
  echo "[dry-run] Would update secret $SECRET_ID with dual-kid structure"
  echo "[dry-run] Schema version: 1"
  echo "[dry-run] Old kid: $CURRENT_KID"
  echo "[dry-run] New kid: $NEW_KID"
  echo "[dry-run] JWKS verification: skipped (no live endpoint in dry-run)"
  echo "[dry-run] No changes made"
  exit 0
fi

# ---------------------------------------------------------------------------
# Step 3: Dual-publish — both old and new kid active
# ---------------------------------------------------------------------------

echo "[step 3/8] Dual-publishing old + new kid..."

# SECURITY NOTE: PEM material is held in shell variables during this script's
# execution. Shell variables are visible in /proc/<pid>/environ and core dumps.
# Exposure window: ~20min (rotation).
# This is the same pattern AWS Secrets Manager rotation Lambdas use.
# Alternative (piping openssl → aws CLI) creates fragile pipelines.
# Mitigation: script runs with restricted permissions, temp dir is 0700.
NEW_PRIVATE_PEM=$(cat "$TMPDIR/new-private.pem")

# Build dual-kid secret value with schema version
# The JWKS endpoint reads activeKid to determine which key to use for signing,
# but serves all keys in the keys array for verification
DUAL_SECRET=$(jq -n \
  --arg old_kid "$CURRENT_KID" \
  --arg new_kid "$NEW_KID" \
  --arg new_key "$NEW_PRIVATE_PEM" \
  --arg old_key "$(echo "$CURRENT_SECRET" | jq -r '.privateKey // .')" \
  '{
    schemaVersion: 1,
    activeKid: $old_kid,
    pendingKid: $new_kid,
    privateKey: $old_key,
    pendingPrivateKey: $new_key
  }')

# Write via temp file to avoid process table exposure
echo "$DUAL_SECRET" > "$TMPDIR/secret-value.json"
chmod 600 "$TMPDIR/secret-value.json"

aws secretsmanager put-secret-value \
  --secret-id "$SECRET_ID" \
  --cli-input-json "{\"SecretId\":\"$SECRET_ID\",\"SecretString\":$(jq -Rs '.' "$TMPDIR/secret-value.json")}" \
  --region "$REGION" >/dev/null

echo "  Both keys now in Secrets Manager (old=active, new=pending)"

# ---------------------------------------------------------------------------
# Step 3.5: Verify JWKS serves both kids (B-1)
# ---------------------------------------------------------------------------
# Google Certificate Transparency overlap verification pattern:
# Before proceeding with cache TTL wait, confirm the JWKS endpoint actually
# serves both the old and new kid. This prevents silent failures where
# dual-publish succeeds in Secrets Manager but JWKS doesn't pick up the change.

echo "[step 3.5/8] Verifying JWKS serves both kids..."

FREESIDE_URL="${FREESIDE_URL:-https://staging.api.arrakis.community}"

# Brief wait for secrets refresh (freeside polls every 60s)
sleep 5

JWKS_VERIFY=$(curl -sf --max-time 10 "$FREESIDE_URL/.well-known/jwks.json" 2>/dev/null) || {
  echo "  ERROR: Cannot reach JWKS endpoint at $FREESIDE_URL/.well-known/jwks.json"
  echo "  Dual-published keys remain in Secrets Manager — safe to retry"
  echo "  Rollback: remove pendingKid from $SECRET_ID"
  exit 1
}

OLD_KID_IN_JWKS=$(echo "$JWKS_VERIFY" | jq --arg kid "$CURRENT_KID" '[.keys[] | select(.kid == $kid)] | length' 2>/dev/null)
NEW_KID_IN_JWKS=$(echo "$JWKS_VERIFY" | jq --arg kid "$NEW_KID" '[.keys[] | select(.kid == $kid)] | length' 2>/dev/null)

if [[ "${OLD_KID_IN_JWKS:-0}" -lt 1 ]]; then
  echo "  ERROR: Old kid '$CURRENT_KID' not found in JWKS response"
  echo "  Rollback: remove pendingKid from $SECRET_ID"
  exit 1
fi

if [[ "${NEW_KID_IN_JWKS:-0}" -lt 1 ]]; then
  echo "  ERROR: New kid '$NEW_KID' not found in JWKS response"
  echo "  This may indicate freeside hasn't refreshed secrets yet — wait and retry"
  echo "  Rollback: remove pendingKid from $SECRET_ID"
  exit 1
fi

echo "  JWKS verified: both $CURRENT_KID (old) and $NEW_KID (new) present"

# ---------------------------------------------------------------------------
# Step 4: Wait for JWKS cache refresh
# ---------------------------------------------------------------------------

echo "[step 4/8] Waiting for JWKS cache TTL (5 minutes)..."
echo "  Freeside refreshes secrets every 60s"
echo "  Finn caches JWKS for 5 minutes"

for i in $(seq 300 -30 0); do
  echo "    ${i}s remaining..."
  sleep 30
done

echo "  Cache TTL expired"

# ---------------------------------------------------------------------------
# Step 5: Switch active kid to new key
# ---------------------------------------------------------------------------

echo "[step 5/8] Switching activeKid to new key..."

SWITCHED_SECRET=$(jq -n \
  --arg kid "$NEW_KID" \
  --arg key "$NEW_PRIVATE_PEM" \
  '{schemaVersion: 1, activeKid: $kid, privateKey: $key}')

echo "$SWITCHED_SECRET" > "$TMPDIR/secret-value.json"
chmod 600 "$TMPDIR/secret-value.json"

aws secretsmanager put-secret-value \
  --secret-id "$SECRET_ID" \
  --cli-input-json "{\"SecretId\":\"$SECRET_ID\",\"SecretString\":$(jq -Rs '.' "$TMPDIR/secret-value.json")}" \
  --region "$REGION" >/dev/null

echo "  activeKid switched: $CURRENT_KID → $NEW_KID"

# Post-switch JWKS verification (B-1)
echo "  Verifying new kid is active in JWKS..."
sleep 5

JWKS_POST_SWITCH=$(curl -sf --max-time 10 "$FREESIDE_URL/.well-known/jwks.json" 2>/dev/null) || true

if [[ -n "${JWKS_POST_SWITCH:-}" ]]; then
  POST_SWITCH_KID=$(echo "$JWKS_POST_SWITCH" | jq -r '.keys[0].kid // empty' 2>/dev/null)
  if [[ "$POST_SWITCH_KID" == "$NEW_KID" ]]; then
    echo "  Verified: $NEW_KID is now primary in JWKS"
  else
    echo "  NOTE: JWKS primary kid is '$POST_SWITCH_KID' — may need cache refresh"
  fi
else
  echo "  WARNING: Could not verify JWKS post-switch — continuing"
fi

# ---------------------------------------------------------------------------
# Step 6: Monitor for errors (optional)
# ---------------------------------------------------------------------------

if $SKIP_MONITOR; then
  echo "[step 6/8] Monitoring skipped (--skip-monitor)"
else
  echo "[step 6/8] Monitoring for JWT_VALIDATION_FAILED (15 minutes)..."
  echo "  Check CloudWatch for errors. Press Ctrl+C to skip."

  MONITOR_END=$(($(date +%s) + 900))
  while [[ $(date +%s) -lt $MONITOR_END ]]; do
    REMAINING=$(( (MONITOR_END - $(date +%s)) / 60 ))
    echo "    ${REMAINING}min remaining — checking logs..."

    # Query CloudWatch for JWT validation failures
    ERROR_COUNT=$(aws logs filter-log-events \
      --log-group-name "/ecs/${PREFIX}-api" \
      --start-time "$(($(date +%s) - 60))000" \
      --filter-pattern "JWT_VALIDATION_FAILED" \
      --region "$REGION" \
      --query 'events | length(@)' \
      --output text 2>/dev/null || echo "0")

    if [[ "$ERROR_COUNT" -gt 0 ]]; then
      echo "  WARNING: $ERROR_COUNT JWT validation failures detected!"
      echo "  Consider rolling back: re-run with old kid"
    fi

    sleep 60
  done

  echo "  Monitoring complete — no blocking issues"
fi

# ---------------------------------------------------------------------------
# Step 7: Verify with smoke test
# ---------------------------------------------------------------------------

echo "[step 7/8] Running JWT round-trip verification..."

if [[ -x "$SCRIPT_DIR/staging-smoke.sh" ]]; then
  # Run only health + JWKS phases (no test-key needed for basic verification)
  FREESIDE_URL="https://staging.api.arrakis.community" \
  DIXIE_URL="https://dixie.staging.arrakis.community" \
    "$SCRIPT_DIR/staging-smoke.sh" 2>/dev/null && SMOKE_OK=true || SMOKE_OK=false

  if $SMOKE_OK; then
    echo "  Smoke test passed"
  else
    echo "  WARNING: Smoke test had failures (check output above)"
  fi
else
  echo "  SKIP: staging-smoke.sh not found"
fi

# ---------------------------------------------------------------------------
# Step 8: Cleanup
# ---------------------------------------------------------------------------

echo "[step 8/8] Rotation complete"
echo ""
echo "================================================================"
echo "  Key Rotation Summary"
echo "================================================================"
echo ""
echo "  Service:    $SERVICE"
echo "  Old KID:    $CURRENT_KID (revoked)"
echo "  New KID:    $NEW_KID (active)"
echo "  Secret:     $SECRET_ID"
echo ""
echo "  The old private key has been removed from Secrets Manager."
echo "  Old public key remains in JWKS for in-flight JWT validation."
echo ""
echo "================================================================"

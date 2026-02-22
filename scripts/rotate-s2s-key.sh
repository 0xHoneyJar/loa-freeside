#!/usr/bin/env bash
# =============================================================================
# Rotate S2S ES256 Key (Cycle 036, Task 2.1)
# =============================================================================
# Generates a new ES256 keypair, inserts the new public JWK into the database,
# and updates activeKid in Secrets Manager. Does NOT remove the old key —
# that's a manual step after the 24h overlap window.
#
# Rotation procedure (atomic ordering per SKP-003):
#   1. Generate new keypair
#   2. Insert new public JWK into s2s_jwks_public_keys (DB)
#   3. Verify JWKS endpoint serves the new kid
#   4. Update activeKid in Secrets Manager (freeside picks up within 60s)
#   5. Keep old key for 24h overlap, then manual removal
#
# Usage:
#   ./scripts/rotate-s2s-key.sh --env staging
#   ./scripts/rotate-s2s-key.sh --env production --verify-url https://api.arrakis.community
#
# @see SDD §1.9 Security Architecture — Key Rotation Playbook
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Arguments
# ---------------------------------------------------------------------------

ENV=""
REGION="${AWS_DEFAULT_REGION:-us-east-1}"
VERIFY_URL=""
DRY_RUN=false
KID_PREFIX="key"

usage() {
  echo "Usage: $0 --env <staging|production> [--verify-url <base-url>] [--region <aws-region>] [--dry-run]"
  echo ""
  echo "Options:"
  echo "  --env          Environment name (required)"
  echo "  --verify-url   Base URL to verify JWKS endpoint (e.g., https://api.arrakis.community)"
  echo "  --region       AWS region (default: us-east-1)"
  echo "  --dry-run      Generate keys but don't store or rotate"
  exit 2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env) ENV="$2"; shift 2 ;;
    --verify-url) VERIFY_URL="$2"; shift 2 ;;
    --region) REGION="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    -h|--help) usage ;;
    *) echo "Unknown option: $1"; usage ;;
  esac
done

if [[ -z "$ENV" ]]; then
  echo "ERROR: --env is required"
  usage
fi

NAME_PREFIX="arrakis-${ENV}"
SECRET_ID="${NAME_PREFIX}-s2s-es256-private-key"
NEW_KID="${KID_PREFIX}-$(date +%Y%m%d)-$(openssl rand -hex 4)"

echo "[rotate] Environment: ${ENV}"
echo "[rotate] Secret ID: ${SECRET_ID}"
echo "[rotate] New Key ID: ${NEW_KID}"

# ---------------------------------------------------------------------------
# Step 1: Read current activeKid
# ---------------------------------------------------------------------------

echo "[rotate] Reading current secret..."
set +x
CURRENT_SECRET=$(aws secretsmanager get-secret-value \
  --secret-id "$SECRET_ID" \
  --region "$REGION" \
  --query SecretString \
  --output text)
set -x 2>/dev/null || true

CURRENT_KID=$(echo "$CURRENT_SECRET" | jq -r '.activeKid')
echo "[rotate] Current activeKid: ${CURRENT_KID}"

# ---------------------------------------------------------------------------
# Step 2: Generate new ES256 keypair
# ---------------------------------------------------------------------------

TMPDIR=$(mktemp -d)
chmod 700 "$TMPDIR"
trap 'rm -rf "$TMPDIR"' EXIT

set +x
openssl ecparam -genkey -name prime256v1 -noout \
  -out "$TMPDIR/private.pem" 2>/dev/null
openssl ec -in "$TMPDIR/private.pem" -pubout \
  -out "$TMPDIR/public.pem" 2>/dev/null
set -x 2>/dev/null || true

echo "[rotate] New ES256 keypair generated"

# Export public JWK coordinates
PUBLIC_JWK=$(node -e "
  const { createPublicKey } = require('node:crypto');
  const fs = require('node:fs');
  const pem = fs.readFileSync('$TMPDIR/public.pem', 'utf8');
  const key = createPublicKey(pem);
  const jwk = key.export({ format: 'jwk' });
  console.log(JSON.stringify(jwk));
")

X=$(echo "$PUBLIC_JWK" | jq -r '.x')
Y=$(echo "$PUBLIC_JWK" | jq -r '.y')

# ---------------------------------------------------------------------------
# Step 3: Output SQL for new public key insertion
# ---------------------------------------------------------------------------

EXPIRES_AT=$(date -u -d "+90 days" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -v+90d +%Y-%m-%dT%H:%M:%SZ)
CREATED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)

echo ""
echo "============================================================"
echo "Step 3a: INSERT new public key into database FIRST"
echo "============================================================"
echo "INSERT INTO s2s_jwks_public_keys (kid, kty, crv, x, y, issuer, created_at, expires_at)"
echo "VALUES ("
echo "  '${NEW_KID}',"
echo "  'EC',"
echo "  'P-256',"
echo "  '${X}',"
echo "  '${Y}',"
echo "  'loa-freeside',"
echo "  '${CREATED_AT}',"
echo "  '${EXPIRES_AT}'"
echo ");"
echo "============================================================"
echo ""

if [[ "$DRY_RUN" == "true" ]]; then
  echo "[rotate] DRY-RUN: Would update activeKid to ${NEW_KID}"
  echo "[rotate] DRY-RUN: Old kid ${CURRENT_KID} would remain for 24h overlap"
  exit 0
fi

# ---------------------------------------------------------------------------
# Step 4: Wait for confirmation that DB insert is done
# ---------------------------------------------------------------------------

echo "[rotate] IMPORTANT: Run the INSERT above, then press Enter to continue."
echo "[rotate] The new public key MUST be in the database before switching activeKid."
read -r -p "[rotate] Press Enter after DB insert is confirmed... "

# ---------------------------------------------------------------------------
# Step 5: Verify JWKS endpoint serves the new kid (optional)
# ---------------------------------------------------------------------------

if [[ -n "$VERIFY_URL" ]]; then
  echo "[rotate] Verifying JWKS endpoint at ${VERIFY_URL}/.well-known/jwks.json ..."
  JWKS_RESPONSE=$(curl -s "${VERIFY_URL}/.well-known/jwks.json")
  if echo "$JWKS_RESPONSE" | jq -e ".keys[] | select(.kid == \"${NEW_KID}\")" >/dev/null 2>&1; then
    echo "[rotate] VERIFIED: kid ${NEW_KID} found in JWKS response"
  else
    echo "[rotate] WARNING: kid ${NEW_KID} NOT found in JWKS response"
    echo "[rotate] Wait for JWKS cache to refresh (max 5 minutes) and re-verify"
    read -r -p "[rotate] Continue with activeKid switch? (y/N) " CONFIRM
    if [[ "$CONFIRM" != "y" && "$CONFIRM" != "Y" ]]; then
      echo "[rotate] Aborted. No changes made to Secrets Manager."
      exit 1
    fi
  fi
fi

# ---------------------------------------------------------------------------
# Step 6: Update activeKid in Secrets Manager
# ---------------------------------------------------------------------------

echo "[rotate] Updating activeKid: ${CURRENT_KID} → ${NEW_KID}"

set +x
NEW_PRIVATE_PEM=$(cat "$TMPDIR/private.pem")

# Build new secret value with new activeKid and new private key
NEW_SECRET_VALUE=$(jq -n \
  --arg kid "$NEW_KID" \
  --arg key "$NEW_PRIVATE_PEM" \
  '{activeKid: $kid, privateKey: $key}')

aws secretsmanager put-secret-value \
  --secret-id "$SECRET_ID" \
  --secret-string "$NEW_SECRET_VALUE" \
  --region "$REGION" >/dev/null
set -x 2>/dev/null || true

echo "[rotate] activeKid updated to ${NEW_KID}"

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

echo ""
echo "============================================================"
echo "Key rotation complete"
echo "============================================================"
echo "  Old kid: ${CURRENT_KID} (keep for 24h overlap)"
echo "  New kid: ${NEW_KID} (now active)"
echo ""
echo "Next steps:"
echo "  1. Wait 6.5 minutes for full propagation"
echo "     (freeside 60s refresh + finn 5min JWKS cache + 30s clock skew)"
echo "  2. Run canary test: sign JWT → validate on finn"
echo "  3. After 24h: remove old kid from s2s_jwks_public_keys"
echo "============================================================"

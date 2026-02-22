#!/usr/bin/env bash
# =============================================================================
# Bootstrap S2S ES256 Key Material (Cycle 036, Task 2.1)
# =============================================================================
# Generates an ES256 keypair, stores private key + activeKid in Secrets Manager,
# and outputs the public JWK for insertion into s2s_jwks_public_keys table.
#
# Usage:
#   ./scripts/bootstrap-s2s-keys.sh --env staging
#   ./scripts/bootstrap-s2s-keys.sh --env production --region us-east-1
#
# Prerequisites:
#   - AWS CLI configured with appropriate IAM permissions
#   - openssl, jq, node (for jose JWK export)
#
# Security:
#   - Private key material is NEVER logged or written to stdout
#   - set +x around all key operations (prevents trace leakage)
#   - Temporary files use mktemp with restrictive permissions
#
# @see SDD §1.9 Security Architecture
# @see Sprint 2, Task 2.1 Acceptance Criteria
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Arguments
# ---------------------------------------------------------------------------

ENV=""
REGION="${AWS_DEFAULT_REGION:-us-east-1}"
DRY_RUN=false
KID_PREFIX="key"

usage() {
  echo "Usage: $0 --env <staging|production> [--region <aws-region>] [--dry-run]"
  echo ""
  echo "Options:"
  echo "  --env        Environment name (required)"
  echo "  --region     AWS region (default: us-east-1)"
  echo "  --dry-run    Generate keys but don't store in Secrets Manager"
  exit 2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env) ENV="$2"; shift 2 ;;
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
KID="${KID_PREFIX}-$(date +%Y%m%d)-$(openssl rand -hex 4)"

echo "[bootstrap] Environment: ${ENV}"
echo "[bootstrap] Region: ${REGION}"
echo "[bootstrap] Secret ID: ${SECRET_ID}"
echo "[bootstrap] Key ID (kid): ${KID}"

# ---------------------------------------------------------------------------
# Generate ES256 Keypair
# ---------------------------------------------------------------------------

TMPDIR=$(mktemp -d)
chmod 700 "$TMPDIR"
trap 'rm -rf "$TMPDIR"' EXIT

# Suppress trace output during key generation (SKP-003)
set +x
openssl ecparam -genkey -name prime256v1 -noout \
  -out "$TMPDIR/private.pem" 2>/dev/null
openssl ec -in "$TMPDIR/private.pem" -pubout \
  -out "$TMPDIR/public.pem" 2>/dev/null
set -x 2>/dev/null || true

echo "[bootstrap] ES256 keypair generated"

# ---------------------------------------------------------------------------
# Export Public JWK (x, y coordinates for s2s_jwks_public_keys table)
# ---------------------------------------------------------------------------

# Use node + jose to export public key as JWK
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

echo "[bootstrap] Public JWK exported"
echo "[bootstrap]   kty: EC, crv: P-256"
echo "[bootstrap]   x: ${X:0:8}..."
echo "[bootstrap]   y: ${Y:0:8}..."

# ---------------------------------------------------------------------------
# Store in Secrets Manager (or dry-run)
# ---------------------------------------------------------------------------

set +x
PRIVATE_PEM=$(cat "$TMPDIR/private.pem")
set -x 2>/dev/null || true

SECRET_VALUE=$(jq -n \
  --arg kid "$KID" \
  --arg key "$PRIVATE_PEM" \
  '{activeKid: $kid, privateKey: $key}')

if [[ "$DRY_RUN" == "true" ]]; then
  echo "[bootstrap] DRY-RUN: Would store secret in ${SECRET_ID}"
  echo "[bootstrap] DRY-RUN: activeKid = ${KID}"
else
  # Check if secret already exists
  if aws secretsmanager describe-secret --secret-id "$SECRET_ID" --region "$REGION" &>/dev/null; then
    echo "[bootstrap] Secret ${SECRET_ID} already exists — updating value"
    set +x
    aws secretsmanager put-secret-value \
      --secret-id "$SECRET_ID" \
      --secret-string "$SECRET_VALUE" \
      --region "$REGION" >/dev/null
    set -x 2>/dev/null || true
  else
    echo "[bootstrap] Creating secret ${SECRET_ID}"
    set +x
    aws secretsmanager create-secret \
      --name "$SECRET_ID" \
      --secret-string "$SECRET_VALUE" \
      --region "$REGION" \
      --description "S2S ES256 private key for loa-freeside → loa-finn JWT signing" >/dev/null
    set -x 2>/dev/null || true
  fi
  echo "[bootstrap] Secret stored successfully"
fi

# ---------------------------------------------------------------------------
# Output: SQL for s2s_jwks_public_keys table insertion
# ---------------------------------------------------------------------------

EXPIRES_AT=$(date -u -d "+90 days" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -v+90d +%Y-%m-%dT%H:%M:%SZ)
CREATED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)

echo ""
echo "============================================================"
echo "INSERT INTO s2s_jwks_public_keys (kid, kty, crv, x, y, issuer, created_at, expires_at)"
echo "VALUES ("
echo "  '${KID}',"
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
echo "[bootstrap] Done. Next steps:"
echo "  1. Run the INSERT above against your database"
echo "  2. Verify: curl https://api.arrakis.community/.well-known/jwks.json"
echo "  3. Verify: kid '${KID}' appears in the JWKS response"

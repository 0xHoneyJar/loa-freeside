#!/usr/bin/env bash
# =============================================================================
# E2E Key Generation Script (Sprint 244, Task 6.2)
# =============================================================================
# Generates ES256 keypairs for arrakis (tenant JWT) and deterministic HS256
# secrets for billing JWT auth.
#
# Usage:
#   ./scripts/e2e-keygen.sh [output-dir]
#
# Outputs to e2e/keys/ directory (or specified dir):
#   - arrakis-private.pem   ES256 private key (tenant JWT signing)
#   - arrakis-public.pem    ES256 public key
#   - billing-secrets.env   HS256 secrets for billing admin + S2S JWT
#
# @see SDD §6.3 E2E Key Bootstrap
# =============================================================================

set -euo pipefail

KEY_DIR="${1:-$(cd "$(dirname "$0")/.." && pwd)/.e2e-keys}"

echo "[e2e-keygen] Generating keys in $KEY_DIR"
mkdir -p "$KEY_DIR"

# ---------------------------------------------------------------------------
# ES256 Keypair (tenant JWT — arrakis signs, loa-finn verifies)
# ---------------------------------------------------------------------------

if [ ! -f "$KEY_DIR/arrakis-private.pem" ]; then
  openssl ecparam -genkey -name prime256v1 -noout \
    -out "$KEY_DIR/arrakis-private.pem" 2>/dev/null
  openssl ec -in "$KEY_DIR/arrakis-private.pem" -pubout \
    -out "$KEY_DIR/arrakis-public.pem" 2>/dev/null
  echo "[e2e-keygen] ES256 keypair generated"
else
  echo "[e2e-keygen] ES256 keypair already exists, skipping"
fi

# ---------------------------------------------------------------------------
# HS256 Secrets (billing JWT — deterministic for E2E reproducibility)
# ---------------------------------------------------------------------------
# These are test-only secrets. Never use in production.

cat > "$KEY_DIR/billing-secrets.env" << 'SECRETS_EOF'
# E2E Billing JWT Secrets — test-only, deterministic
BILLING_ADMIN_JWT_SECRET=e2e-admin-jwt-secret-for-testing-only-32ch
BILLING_INTERNAL_JWT_SECRET=e2e-s2s-jwt-secret-for-testing-only-32chr
SECRETS_EOF

echo "[e2e-keygen] Billing secrets written"

# ---------------------------------------------------------------------------
# Export AGENT_JWT_PRIVATE_KEY for docker-compose
# ---------------------------------------------------------------------------

AGENT_JWT_PRIVATE_KEY=$(cat "$KEY_DIR/arrakis-private.pem")
export AGENT_JWT_PRIVATE_KEY

echo "[e2e-keygen] Done. 4 files in $KEY_DIR:"
ls -la "$KEY_DIR"

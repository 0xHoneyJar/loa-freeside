#!/usr/bin/env bash
# =============================================================================
# Staging Secrets Bootstrap — SDD §9.4 / Sprint 1, Task 1.5
# =============================================================================
# Generates ES256 key pairs for freeside, finn, and dixie, then stores them
# in AWS Secrets Manager using `put-secret-value` (NOT `create-secret` —
# Terraform owns resource creation).
#
# Idempotent: skips if secret already has a non-PLACEHOLDER value.
# Validates all keys with `openssl ec -check` post-population.
#
# Usage:
#   ./scripts/bootstrap-staging-secrets.sh
#   ./scripts/bootstrap-staging-secrets.sh --prefix arrakis-staging
#   ./scripts/bootstrap-staging-secrets.sh --dry-run
#
# Prerequisites:
#   - AWS CLI configured with appropriate IAM permissions
#   - Terraform has already created the secret shells (terraform apply)
#   - openssl with EC support
#
# @see SDD §4.2 Key Bootstrap Procedure
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

PREFIX="${PREFIX:-arrakis-staging}"
SERVICES=(freeside finn dixie)
DRY_RUN=false
VERBOSE=false

# Canonical secret ID pattern per SDD §4.2
# {prefix}/{service}/es256-private-key
secret_id() {
  local service="$1"
  echo "${PREFIX}/${service}/es256-private-key"
}

# ---------------------------------------------------------------------------
# Parse Arguments
# ---------------------------------------------------------------------------

while [[ $# -gt 0 ]]; do
  case "$1" in
    --prefix)
      if [[ $# -lt 2 ]]; then echo "ERROR: --prefix requires a value"; exit 2; fi
      PREFIX="$2"; shift 2 ;;
    --dry-run)
      DRY_RUN=true; shift ;;
    --verbose)
      VERBOSE=true; shift ;;
    -h|--help)
      echo "Usage: $0 [--prefix <prefix>] [--dry-run] [--verbose]"
      echo ""
      echo "Bootstrap ES256 key pairs for staging services."
      echo ""
      echo "Options:"
      echo "  --prefix   Secrets Manager prefix (default: arrakis-staging)"
      echo "  --dry-run  Generate keys but don't write to Secrets Manager"
      echo "  --verbose  Show detailed output"
      echo ""
      echo "Canonical secret IDs:"
      for svc in "${SERVICES[@]}"; do
        echo "  ${PREFIX}/${svc}/es256-private-key"
      done
      exit 0
      ;;
    *) echo "ERROR: Unknown option: $1"; exit 2 ;;
  esac
done

# ---------------------------------------------------------------------------
# Prerequisites
# ---------------------------------------------------------------------------

for cmd in openssl aws jq; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "ERROR: Required command '$cmd' not found."
    exit 1
  fi
done

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

log() {
  echo "[bootstrap] $*"
}

log_verbose() {
  if $VERBOSE; then
    echo "[bootstrap]   $*"
  fi
}

# Check if a secret already has a real (non-placeholder) value
secret_has_value() {
  local sid="$1"
  local value
  value=$(aws secretsmanager get-secret-value --secret-id "$sid" \
    --query 'SecretString' --output text 2>/dev/null) || return 1

  # Empty, placeholder, or default values → needs population
  if [[ -z "$value" || "$value" == "PLACEHOLDER" || "$value" == "CHANGE_ME" || "$value" == "{}" ]]; then
    return 1
  fi

  # Check if it looks like a PEM key
  if echo "$value" | grep -q "BEGIN.*KEY"; then
    return 0
  fi

  # Non-empty, non-placeholder → assume populated
  return 0
}

# Generate an ES256 private key (PKCS#8 PEM format)
generate_es256_key() {
  openssl ecparam -name prime256v1 -genkey -noout 2>/dev/null | \
    openssl pkcs8 -topk8 -nocrypt 2>/dev/null
}

# Validate an ES256 private key
validate_es256_key() {
  local key="$1"
  echo "$key" | openssl ec -check -noout 2>/dev/null
}

# ---------------------------------------------------------------------------
# Banner
# ---------------------------------------------------------------------------

echo "================================================================"
echo "  Staging Secrets Bootstrap"
echo "================================================================"
echo ""
echo "  Prefix:    $PREFIX"
echo "  Services:  ${SERVICES[*]}"
echo "  Dry Run:   $DRY_RUN"
echo ""

# ---------------------------------------------------------------------------
# Main: Bootstrap ES256 keys for each service
# ---------------------------------------------------------------------------

errors=0
skipped=0
populated=0

for svc in "${SERVICES[@]}"; do
  sid=$(secret_id "$svc")
  log "Processing: $sid"

  # Check if already populated
  if secret_has_value "$sid"; then
    log "  SKIP  Secret already has a value (idempotent)"
    skipped=$((skipped + 1))
    continue
  fi

  # Generate key
  log "  GENERATE  Creating ES256 key pair for $svc..."
  private_key=$(generate_es256_key)

  if [[ -z "$private_key" ]]; then
    log "  ERROR  Failed to generate ES256 key for $svc"
    errors=$((errors + 1))
    continue
  fi

  # Validate key
  if ! validate_es256_key "$private_key"; then
    log "  ERROR  Generated key failed validation for $svc"
    errors=$((errors + 1))
    continue
  fi
  log_verbose "Key validation passed"

  # Write to Secrets Manager
  # Use --cli-input-json with a temp file to avoid exposing key material
  # in the process table (/proc/PID/cmdline)
  if $DRY_RUN; then
    log "  DRY-RUN  Would write to $sid"
  else
    key_tmpfile=$(mktemp)
    chmod 600 "$key_tmpfile"
    jq -n --arg sid "$sid" --arg key "$private_key" \
      '{"SecretId": $sid, "SecretString": $key}' > "$key_tmpfile"

    if aws secretsmanager put-secret-value \
      --cli-input-json "file://${key_tmpfile}" 2>/dev/null; then
      log "  STORED  Key written to Secrets Manager"
    else
      log "  ERROR  Failed to write secret $sid"
      rm -f "$key_tmpfile"
      errors=$((errors + 1))
      continue
    fi
    rm -f "$key_tmpfile"
  fi

  populated=$((populated + 1))
done

# ---------------------------------------------------------------------------
# Post-population validation (non-dry-run only)
# ---------------------------------------------------------------------------

if ! $DRY_RUN && [[ $populated -gt 0 || $skipped -gt 0 ]]; then
  echo ""
  log "Validating all secrets..."

  for svc in "${SERVICES[@]}"; do
    sid=$(secret_id "$svc")
    value=$(aws secretsmanager get-secret-value --secret-id "$sid" \
      --query 'SecretString' --output text 2>/dev/null) || {
      log "  FAIL  Cannot read $sid"
      errors=$((errors + 1))
      continue
    }

    if validate_es256_key "$value"; then
      log "  PASS  $sid — valid ES256 key"
    else
      log "  FAIL  $sid — invalid key material"
      errors=$((errors + 1))
    fi
  done
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

echo ""
echo "================================================================"
echo "  Results"
echo "================================================================"
echo "  Populated: $populated"
echo "  Skipped:   $skipped (already had values)"
echo "  Errors:    $errors"
echo "================================================================"

if [[ $errors -gt 0 ]]; then
  echo ""
  echo "ERROR: $errors secret(s) failed. Fix and re-run."
  exit 1
fi

exit 0

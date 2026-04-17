#!/usr/bin/env bash
# =============================================================================
# Honey Road (mibera-honeyroad) — AWS Secrets Manager loader
# =============================================================================
# Pulls secrets from Vercel env (pre-fetched via `vercel env pull`) and posts
# them to AWS Secrets Manager under the arrakis/<env>/worlds/honeyroad/ prefix.
#
# Validations (flatline SKP-004):
#   - non-empty values (empty secret crashes ECS at task start)
#   - no placeholder values (your_*, REDACTED, xxx, <...>)
#
# Usage:
#   vercel env pull /tmp/honeyroad.env --yes --environment=production
#   bash scripts/load-honeyroad-secrets.sh
#
# Related: grimoires/loa/prd.md §6.4, 06-execution-plan.md:189-274
# =============================================================================
set -euo pipefail

AWS_PROFILE="${AWS_PROFILE:-admin}"
AWS_REGION="${AWS_REGION:-us-east-1}"
ENVIRONMENT="${ENVIRONMENT:-production}"
ENV_FILE="${ENV_FILE:-/tmp/honeyroad.env}"
SECRET_PREFIX="arrakis/${ENVIRONMENT}/worlds/honeyroad"

# vercel-var → aws-secret-key mapping.
# ONLY true runtime secrets. NEXT_PUBLIC_* and SENTRY_AUTH_TOKEN are handled
# separately in CI (--build-arg and BuildKit --secret mount respectively).
declare -a MAP=(
  "DATABASE_URL:database_url"
  "SUPABASE_SERVICE_ROLE_KEY:supabase_service_role"
  "DYNAMIC_AUTH_TOKEN:dynamic_auth_token"
  "DYNAMIC_SERVER_API_KEY:dynamic_server_api_key"
  "OPENAI_API_KEY:openai_api_key"
  "ANTHROPIC_API_KEY:anthropic_api_key"
  "SESSION_SECRET:session_secret"
  "DEV_WALLET_PRIVATE_KEY:dev_wallet_pk"
  "TRIGGER_SECRET_KEY:trigger_secret"
  "TWITTER_CLIENT_ID:twitter_client_id"
  "TWITTER_CLIENT_SECRET:twitter_client_secret"
  "DISCORD_CLIENT_ID:discord_client_id"
  "DISCORD_CLIENT_SECRET:discord_client_secret"
  "CLOUDINARY_API_KEY:cloudinary_key"
  "CLOUDINARY_API_SECRET:cloudinary_secret"
  "DUNE_API_KEY:dune_api_key"
  "QUESTS_API_SECRET:quests_api_secret"
  "VM_API_SECRET:vm_api_secret"
  "AWS_ACCESS_KEY_ID_VM:aws_access_key_vm"
  "AWS_SECRET_ACCESS_KEY_VM:aws_secret_key_vm"
  "AWS_BUCKET_NAME_VM:aws_bucket_name_vm"
  "AWS_REGION_VM:aws_region_vm"
  "ALLOWED_PARENT_URL:allowed_parent_url"
)

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE not found" >&2
  echo "Run: vercel env pull $ENV_FILE --yes --environment=production" >&2
  exit 1
fi

# Preflight: confirm AWS identity before writing anything
EXPECTED_ACCOUNT="${EXPECTED_ACCOUNT:-891376933289}"
ACTUAL_ACCOUNT=$(aws sts get-caller-identity --profile "$AWS_PROFILE" --query Account --output text)
if [[ "$ACTUAL_ACCOUNT" != "$EXPECTED_ACCOUNT" ]]; then
  echo "ERROR: Wrong AWS account. Expected $EXPECTED_ACCOUNT, got $ACTUAL_ACCOUNT" >&2
  exit 1
fi

echo "Loading Honey Road secrets to $SECRET_PREFIX/* (account $ACTUAL_ACCOUNT)"
echo ""

pass=0
fail=0
failures=()

for entry in "${MAP[@]}"; do
  vercel_var="${entry%%:*}"
  aws_key="${entry##*:}"
  raw=$(grep "^${vercel_var}=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- | sed -E 's/^"(.*)"$/\1/' || echo "")

  if [[ -z "$raw" ]]; then
    echo "FAIL empty:       $vercel_var"
    failures+=("$vercel_var (empty)")
    fail=$((fail+1))
    continue
  fi

  if [[ "$raw" =~ ^(your_|REDACTED|xxx|\<) ]]; then
    echo "FAIL placeholder: $vercel_var -> ${raw:0:20}..."
    failures+=("$vercel_var (placeholder)")
    fail=$((fail+1))
    continue
  fi

  if aws secretsmanager put-secret-value \
      --profile "$AWS_PROFILE" --region "$AWS_REGION" \
      --secret-id "${SECRET_PREFIX}/${aws_key}" \
      --secret-string "$raw" >/dev/null 2>&1; then
    echo "OK:               $vercel_var -> $aws_key"
    pass=$((pass+1))
  else
    echo "FAIL put:         $vercel_var -> $aws_key"
    failures+=("$vercel_var (put-secret-value failed)")
    fail=$((fail+1))
  fi
done

# Cleanup: never leave secrets on disk
rm -f "$ENV_FILE"

echo ""
echo "Summary: $pass passed, $fail failed"

if [[ $fail -gt 0 ]]; then
  echo ""
  echo "Failures:"
  for f in "${failures[@]}"; do
    echo "  - $f"
  done
  exit 1
fi

exit 0

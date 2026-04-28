#!/usr/bin/env bash
# =============================================================================
# Midi (midi-interface / mibera-dimensions) — AWS Secrets Manager loader
# =============================================================================
# Pulls secrets from Vercel env (pre-fetched via `vercel env pull`) and posts
# them to AWS Secrets Manager under the arrakis/<env>/worlds/midi/ prefix.
#
# Validations (flatline SKP-004):
#   - non-empty values (empty secret crashes ECS at task start)
#   - no placeholder values (your_*, REDACTED, xxx, <...>)
#
# Usage:
#   vercel env pull /tmp/midi.env --yes --environment=production
#   bash scripts/load-midi-secrets.sh
#
# midi-interface and mibera-dimensions share Vercel project
# prj_J6Q0SydniMeDWK0mARqRwUOqRrbn ("midi-interface"). Either repo's
# `vercel env pull` produces the same env file.
#
# Related: world-midi.tf, world-midi-secrets.tf
# =============================================================================
set -euo pipefail

AWS_PROFILE="${AWS_PROFILE:-admin}"
AWS_REGION="${AWS_REGION:-us-east-1}"
ENVIRONMENT="${ENVIRONMENT:-production}"
ENV_FILE="${ENV_FILE:-/tmp/midi.env}"
SECRET_PREFIX="arrakis/${ENVIRONMENT}/worlds/midi"

# vercel-var → aws-secret-key mapping.
# ONLY true runtime secrets. NEXT_PUBLIC_* are public-by-design (--build-arg
# in CI). BETA_DEV_BYPASS_WALLETS is dev-only and not loaded in prod.
declare -a MAP=(
  "DYNAMIC_AUTH_TOKEN:dynamic_auth_token"
  "SUPABASE_SERVICE_ROLE_KEY:supabase_service_role"
  "SCORE_API_URL:score_api_url"
  "SCORE_API_KEY:score_api_key"
  "SIGNALS_API_KEY:signals_api_key"
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

echo "Loading Midi secrets to $SECRET_PREFIX/* (account $ACTUAL_ACCOUNT)"
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

  # Pipe secret via stdin instead of --secret-string "$raw" — the CLI arg form
  # is visible in /proc/*/cmdline, ps aux, and shell history (bridgebuilder
  # CRIT-001). file:///dev/stdin reads from stdin without touching disk.
  if printf '%s' "$raw" | aws secretsmanager put-secret-value \
      --profile "$AWS_PROFILE" --region "$AWS_REGION" \
      --secret-id "${SECRET_PREFIX}/${aws_key}" \
      --secret-string file:///dev/stdin >/dev/null 2>&1; then
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

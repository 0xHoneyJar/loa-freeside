# =============================================================================
# Honey Road (mibera-honeyroad) — AWS Secrets Manager structure
# =============================================================================
# Defines the 23 runtime secrets the Honey Road ECS task resolves at start.
# Values are NOT populated by terraform — they're loaded via
# `scripts/load-honeyroad-secrets.sh` which pulls from Vercel env and validates
# (non-empty + no placeholder) before calling aws secretsmanager put-secret-value.
# This avoids committing secret values to git while keeping the structural
# definition in IaC (prd.md §6.4, flatline SKP-004).
#
# The key set here MUST be a superset of the keys referenced in
# world-mibera.tf's `secrets = {...}` map. Mismatch → terraform plan error.
#
# Intentionally absent (by design):
#   - NEXT_PUBLIC_*       public-by-design, --build-arg only in CI
#   - SENTRY_AUTH_TOKEN   build-time-only, BuildKit --secret mount in CI
#
# Related: 0xHoneyJar/loa-freeside#153
# =============================================================================

locals {
  honeyroad_secrets = toset([
    # Database (Drizzle + Railway Postgres, post-Supabase migration)
    "database_url",

    # Auth (Dynamic Labs + iron-session)
    "dynamic_auth_token",
    "dynamic_server_api_key",
    "session_secret",

    # AI APIs (vendor personality, honey-gpt)
    "openai_api_key",
    "anthropic_api_key",

    # Wallet signer (admin scripts + runtime)
    "dev_wallet_pk",

    # Background jobs (Trigger.dev)
    "trigger_secret",

    # OAuth (forum account linking)
    "twitter_client_id",
    "twitter_client_secret",
    "discord_client_id",
    "discord_client_secret",

    # Media (Cloudinary CDN)
    "cloudinary_key",
    "cloudinary_secret",

    # Analytics / data
    "dune_api_key",

    # API gates (internal auth)
    "quests_api_secret",
    "vm_api_secret",

    # AWS S3 (VM avatar/GIF/quiz image storage)
    "aws_access_key_vm",
    "aws_secret_key_vm",
    "aws_bucket_name_vm",
    "aws_region_vm",

    # CSP (frame-ancestors for hub embedding)
    "allowed_parent_url",
  ])
}

resource "aws_secretsmanager_secret" "honeyroad" {
  for_each = local.honeyroad_secrets

  name        = "arrakis/${var.environment}/worlds/honeyroad/${each.key}"
  description = "Honey Road (mibera-honeyroad) runtime secret — loaded via scripts/load-honeyroad-secrets.sh"
  kms_key_id  = aws_kms_key.secrets.arn

  tags = merge(local.common_tags, {
    World   = "mibera"
    App     = "honeyroad"
    Purpose = each.key
  })
}

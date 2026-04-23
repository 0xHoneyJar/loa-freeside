# =============================================================================
# constructs-network — AWS Secrets Manager structure
# =============================================================================
# Defines the 16 runtime secrets the constructs-network ECS task resolves at
# task start. Values are NOT populated by terraform — they're loaded via
# `scripts/load-constructs-network-secrets.sh` (to be authored, mirrors
# load-honeyroad-secrets.sh). The script pulls from operator-side env (Vercel
# export or 1Password), validates non-empty + no placeholder, and calls
# aws secretsmanager put-secret-value.
#
# This avoids committing secret values to git while keeping the structural
# definition in IaC. Mismatch between this set and world-constructs-network.tf's
# `secrets = {...}` map → terraform plan error.
#
# Intentionally absent (by design):
#   - NEXT_PUBLIC_*       public-by-design, --build-arg only in CI
#   - SENTRY_AUTH_TOKEN   build-time-only, BuildKit --secret mount in CI
#   - CONSTRUCTS_API_URL  non-secret; set as env_var in world-constructs-network.tf
#   - NODE_ENV            non-secret; set as env_var
#
# Env-var source-of-truth mapping (operator reference, for migration):
#   apps/constructs-network/.env.example  → AWS Secrets Manager key (this file)
#   Vercel env dashboard (loa-constructs-explorer-5bfi / successor)  → ditto
#
# Related: loa-freeside#176, cycle-009 SEED, sprawl-world:apps/constructs-network
# =============================================================================

locals {
  constructs_network_secrets = toset([
    # AI APIs (agent-facing catalog + signal generation)
    "anthropic_api_key",
    "gemini_api_key",
    "google_api_key",

    # Convex (catalog DB backend; write key for cron + server actions)
    "convex_url",
    "convex_write_key",

    # Cron auth (bearer token for /api/cron/reconcile)
    "cron_secret",

    # Signals pipeline (feedback → Convex → Discord)
    "signals_api_key",
    "signals_endpoint",
    "discord_signals_webhook_url",

    # Linear (ticket integration, webhook)
    "linear_api_key",
    "linear_webhook_secret",

    # Telegram (notification bot for operators)
    "telegram_bot_token",
    "telegram_chat_id",

    # Umami (self-hosted analytics, multi-site)
    "umami_api_key",
    "umami_purupuru_website_id",
    "umami_site_ids",
  ])
}

resource "aws_secretsmanager_secret" "constructs_network" {
  for_each = local.constructs_network_secrets

  name                    = "${local.name_prefix}/worlds/constructs-network/${each.value}"
  description             = "constructs-network runtime secret: ${each.value}"
  kms_key_id              = aws_kms_key.secrets.arn
  recovery_window_in_days = 7

  tags = merge(local.common_tags, {
    World  = "constructs-network"
    Secret = each.value
  })
}

# NOTE on re-creation: recovery_window_in_days = 7 means a destroyed secret
# remains recoverable (not purged) for 7 days. To re-create a secret with the
# same name within that window, either wait 7 days OR manually delete with
# `aws secretsmanager delete-secret --secret-id <arn> --force-delete-without-recovery`.
# This pattern inherited from world-mibera-secrets.tf.

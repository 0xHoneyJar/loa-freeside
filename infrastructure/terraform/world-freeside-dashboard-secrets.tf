# =============================================================================
# freeside-dashboard — AWS Secrets Manager structure
# =============================================================================
# Cycle-010 L-migrate-prep (DRAFT · not applied · not in PR yet).
# Defines the 4 runtime secrets the freeside-dashboard ECS task resolves at
# task start. Values are NOT populated by terraform — they're loaded via
# `sprawl-world/scripts/load-freeside-dashboard-secrets.sh` (to be authored).
#
# This avoids committing secret values to git while keeping the structural
# definition in IaC. Mismatch between this set and world-freeside-dashboard.tf's
# `secrets = {...}` map → terraform plan error.
#
# Intentionally absent (by design):
#   - ADMIN_ADDRESSES    public wallet allowlist; set as env_var, not secret
#   - SIWE_*             non-secret config; env_var
#   - AWS_ACCESS_KEY_ID  avoid static keys; prefer task role + IAM policy
#                        attachment (deferred, see world-freeside-dashboard.tf
#                        "task-role extension" comment)
#
# Env-var source-of-truth mapping (operator reference, for migration):
#   sprawl-world/apps/dashboard/.env.example  → AWS Secrets Manager key (this file)
#
# Related: loa-freeside#176, cycle-009 SEED, cycle-010 SEED §AC-MP.6
# =============================================================================

locals {
  freeside_dashboard_secrets = toset([
    # Turso (SvelteKit session + dashboard state)
    "turso_database_url",
    "turso_auth_token",

    # GitHub (deploy correlation + log-fetch)
    "github_token",

    # Sentry DSN — treated as secret pending L-migrate-dashboard decision
    # (see world-freeside-dashboard.tf `secrets` comment). If reclassified as
    # non-secret env_var, remove from this set + move to module env_vars.
    "sentry_dsn",
  ])
}

resource "aws_secretsmanager_secret" "freeside_dashboard" {
  for_each = local.freeside_dashboard_secrets

  name                    = "${local.name_prefix}/worlds/freeside-dashboard/${each.value}"
  description             = "freeside-dashboard runtime secret: ${each.value}"
  kms_key_id              = aws_kms_key.secrets.arn
  recovery_window_in_days = 7

  tags = merge(local.common_tags, {
    World  = "freeside-dashboard"
    Secret = each.value
  })
}

# NOTE on re-creation: recovery_window_in_days = 7 — destroyed secrets are
# recoverable for 7 days. To re-create within that window, either wait or
# `aws secretsmanager delete-secret --secret-id <arn> --force-delete-without-recovery`.
# Inherited from world-mibera-secrets.tf + world-constructs-network-secrets.tf.

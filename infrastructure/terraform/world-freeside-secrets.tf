# =============================================================================
# Freeside Dashboard (freeside-dashboard) — AWS Secrets Manager structure
# =============================================================================
# Runtime secrets for the CM dashboard at freeside.0xhoneyjar.xyz.
# Values are NOT populated by terraform — load via operator script from Vercel
# env (bootstrap) or `vercel env pull` + `aws secretsmanager put-secret-value`.
#
# The key set MUST be a superset of world-freeside.tf's `secrets = {...}` map.
# =============================================================================

locals {
  freeside_dashboard_secrets = toset([
    "database_url",
    "score_api_key",
    "link_service_token",
    "ordering_service_token",
    "config_service_token",
  ])
}

resource "aws_secretsmanager_secret" "freeside_dashboard" {
  for_each = local.freeside_dashboard_secrets

  name        = "arrakis/${var.environment}/worlds/freeside-dashboard/${each.key}"
  description = "Freeside Dashboard runtime secret — loaded by operator after terraform apply"
  kms_key_id  = aws_kms_key.secrets.arn

  tags = merge(local.common_tags, {
    World   = "freeside"
    App     = "freeside-dashboard"
    Purpose = each.key
  })
}

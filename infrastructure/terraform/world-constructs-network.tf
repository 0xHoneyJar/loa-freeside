# =============================================================================
# World: constructs-network — constructs.network registry UI (Next.js 15 + Convex)
# =============================================================================
# Cycle-009 L-migrate-constructs (loa-constructs, parallel to loa-freeside#176):
# Migrates the constructs.network UI off Vercel onto Freeside ECS Fargate.
# The app is a Next.js 15 monorepo member at
# 0xHoneyJar/sprawl-world:apps/constructs-network (lifted from loa-constructs
# in cycle-007 via PR #39). Vercel project `loa-constructs-explorer-5bfi`
# retired post-cutover + 48h parallel window (see cycle-009 SEED).
#
# Bug closed: bd-1o9 (constructs.network empty-catalog — Vercel config drift
# + stale build path). Migration supersedes spot-fix per cycle-008 L-bug-triage.
#
# Registry + network visibility is part of the product, not chrome
# (operator 2026-04-24: "visibility and transparency with agents on a UI
# surface is coexistence"). This migration restores the agent+human shared
# UI that went dark post-cycle-007.
#
# Related: loa-freeside#176, #174, #153
# SEED:    loa-constructs/grimoires/loa-constructs-seed-2026-04-21/cycle-009-SEED-freeside-host-migration.md
# =============================================================================

module "world_constructs_network" {
  source = "./modules/world"

  name        = "constructs-network"
  repo        = "0xHoneyJar/sprawl-world"
  environment = var.environment

  # Shared infrastructure references
  cluster_id               = aws_ecs_cluster.main.id
  cluster_name             = aws_ecs_cluster.main.name
  vpc_id                   = module.vpc.vpc_id
  private_subnets          = module.vpc.private_subnets
  alb_listener_arn         = aws_lb_listener.https.arn
  alb_security_group_id    = aws_security_group.alb.id
  efs_file_system_id       = aws_efs_file_system.worlds.id
  efs_security_group_id    = aws_security_group.worlds_efs.id
  github_oidc_provider_arn = aws_iam_openid_connect_provider.github.arn
  kms_key_arn              = aws_kms_key.secrets.arn
  name_prefix              = local.name_prefix
  common_tags              = local.common_tags
  aws_region               = var.aws_region
  account_id               = data.aws_caller_identity.current.account_id

  # Next.js 15 + Convex client + React Flow + Radix + Sentry. Starting point
  # matching mibera baseline; tune via CloudWatch post-deploy. React Flow in
  # particular can spike render memory on dense construct graphs.
  cpu    = 512
  memory = 1024

  # Use dedicated /api/health endpoint — "/" renders the catalog landing with
  # Convex queries, which can exceed 5s health-check timeout on cold cache.
  # NOTE: /api/health does NOT yet exist in apps/constructs-network/app/api/
  # and must be added as part of L-migrate-constructs dispatch (10-line route
  # returning static 200 with no IO). See SEED AC-MC pre-apply checklist.
  health_check_path = "/api/health"

  # Non-secret runtime env.
  # NEXT_PUBLIC_* vars are baked into the client bundle at build time via
  # --build-arg in CI (see sprawl-world/.github/workflows/deploy-constructs-
  # network.yml) — PUBLIC BY DESIGN and NOT stored in Secrets Manager.
  env_vars = {
    CONSTRUCTS_API_URL = "https://api.constructs.network/v1"
    NODE_ENV           = "production"
  }

  # Runtime secrets — resolved by ECS from AWS Secrets Manager at task start.
  # Structure defined in world-constructs-network-secrets.tf.
  # Values populated via scripts/load-constructs-network-secrets.sh (to be
  # authored in L-migrate-constructs dispatch; mirrors load-honeyroad-secrets.sh).
  #
  # Intentionally absent:
  #   - NEXT_PUBLIC_*       public-by-design, --build-arg only (see above)
  #   - SENTRY_AUTH_TOKEN   build-time-only, BuildKit --secret mount in CI
  secrets = {
    ANTHROPIC_API_KEY           = aws_secretsmanager_secret.constructs_network["anthropic_api_key"].arn
    CONVEX_URL                  = aws_secretsmanager_secret.constructs_network["convex_url"].arn
    CONVEX_WRITE_KEY            = aws_secretsmanager_secret.constructs_network["convex_write_key"].arn
    CRON_SECRET                 = aws_secretsmanager_secret.constructs_network["cron_secret"].arn
    DISCORD_SIGNALS_WEBHOOK_URL = aws_secretsmanager_secret.constructs_network["discord_signals_webhook_url"].arn
    GEMINI_API_KEY              = aws_secretsmanager_secret.constructs_network["gemini_api_key"].arn
    GOOGLE_API_KEY              = aws_secretsmanager_secret.constructs_network["google_api_key"].arn
    LINEAR_API_KEY              = aws_secretsmanager_secret.constructs_network["linear_api_key"].arn
    LINEAR_WEBHOOK_SECRET       = aws_secretsmanager_secret.constructs_network["linear_webhook_secret"].arn
    SIGNALS_API_KEY             = aws_secretsmanager_secret.constructs_network["signals_api_key"].arn
    SIGNALS_ENDPOINT            = aws_secretsmanager_secret.constructs_network["signals_endpoint"].arn
    TELEGRAM_BOT_TOKEN          = aws_secretsmanager_secret.constructs_network["telegram_bot_token"].arn
    TELEGRAM_CHAT_ID            = aws_secretsmanager_secret.constructs_network["telegram_chat_id"].arn
    UMAMI_API_KEY               = aws_secretsmanager_secret.constructs_network["umami_api_key"].arn
    UMAMI_PURUPURU_WEBSITE_ID   = aws_secretsmanager_secret.constructs_network["umami_purupuru_website_id"].arn
    UMAMI_SITE_IDS              = aws_secretsmanager_secret.constructs_network["umami_site_ids"].arn
  }

  secret_arns = [for s in aws_secretsmanager_secret.constructs_network : s.arn]
}

# =============================================================================
# Cron replacement: /api/cron/reconcile (was Vercel cron */15 * * * *)
# =============================================================================
# The retired Vercel cron hit constructs.network/api/cron/reconcile every 15
# minutes with CRON_SECRET bearer auth. On ECS we re-home via EventBridge
# scheduled rule → private target invoking the endpoint. The schedule
# replacement is defined separately (not inline here) so it can be rotated
# or disabled without re-planning the world module.
#
# Implementation: EventBridge rule + Lambda target (~30 LOC Python/Node) that
# curls https://constructs-network.0xhoneyjar.xyz/api/cron/reconcile with
# `Authorization: Bearer <CRON_SECRET>`. Secret resolved at Lambda invocation
# via ECS task role extension, NOT embedded in EventBridge input (flatline-
# style posture).
#
# DEFERRED: EventBridge + Lambda resource declaration. Draft issue + decision
# tracked in loa-freeside#176 comment thread. If cron-reconcile turns out to
# be non-load-bearing (catalog ingest pipeline is externalized), drop entirely.

output "constructs_network_ecr_url" {
  value       = module.world_constructs_network.ecr_repository_url
  description = "ECR repository for constructs-network image pushes (CI uses this)"
}

output "constructs_network_ci_role_arn" {
  value       = module.world_constructs_network.ci_deploy_role_arn
  description = "IAM role ARN for sprawl-world constructs-network GitHub Actions OIDC (set as AWS_DEPLOY_ROLE_ARN_CONSTRUCTS_NETWORK repo secret)"
}

output "constructs_network_subdomain" {
  value       = "constructs-network.${var.environment == "production" ? "0xhoneyjar.xyz" : "staging.0xhoneyjar.xyz"}"
  description = "Provisional subdomain during staged cutover (before www.constructs.network alias swap)"
}

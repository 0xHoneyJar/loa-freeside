# =============================================================================
# World: freeside-dashboard — SvelteKit operator dashboard (adapter-node)
# =============================================================================
# Cycle-010 L-migrate-prep (DRAFT · not applied · not in PR yet).
# Mirror of world-constructs-network.tf, tuned for SvelteKit adapter-node
# runtime. Host target: sprawl-world/apps/dashboard/ on ECS Fargate.
#
# The dashboard IS the operator surface for Freeside worlds (per PRD
# grimoires/loa/cycles/cycle-374098eb43/). Migrating it onto Freeside ECS is
# the ultimate dogfood — if the dashboard can't deploy itself onto the
# platform it describes, the platform has a credibility gap. Cycle-009
# L-migrate-dashboard / cycle-010 L-migrate-prep predicate closes that gap.
#
# Bootstrap sequence: Vercel deploy of apps/dashboard stays warm at ALL TIMES
# through cutover + 48h post-cutover. DNS flip-back in <5min if freeside-
# dashboard-on-freeside fails. Explicit rollback SLA (cycle-009 AC-MD.5).
#
# Related: loa-freeside#176, cycle-009 SEED §L-migrate-dashboard, cycle-010 SEED
# =============================================================================

module "world_freeside_dashboard" {
  source = "./modules/world"

  name        = "freeside-dashboard"
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

  # SvelteKit adapter-node. Lighter footprint than Next.js (no Sentry webpack
  # plugin overhead). Start at the module default 256/512, bump if observed.
  cpu    = 256
  memory = 512

  # Use /api/health endpoint — "/" renders world-list with Turso queries;
  # cold-cache path can exceed 5s health-check timeout. /api/health is a
  # framework-standard static 200 (to be added if not present).
  health_check_path = "/api/health"

  # Non-secret runtime env.
  #   ADMIN_ADDRESSES  public wallet allowlist; security is signature
  #                    verification, not key secrecy.
  #   SIWE_*           domain/origin config for SIWE; non-secret.
  #   KILL_SESSIONS    break-glass; intentionally empty; set via
  #                    `aws ssm put-parameter` + force-deploy when needed.
  env_vars = {
    NODE_ENV       = "production"
    PORT           = "3000"
    SIWE_DOMAIN    = "dashboard.sprawl.world"
    SIWE_ORIGIN    = "https://dashboard.sprawl.world"
    SIWE_CHAIN_ID  = "8453"
    KILL_SESSIONS  = ""
    # FREESIDE_ECS_CLUSTER + FREESIDE_COST_ACCOUNT_ID are populated post-apply
    # once the cluster ARN + account ID are known — set via `aws ssm` or
    # module-outputs-wired-in on a follow-up apply.
  }

  # Runtime secrets — resolved by ECS from AWS Secrets Manager at task start.
  # Structure defined in world-freeside-dashboard-secrets.tf.
  # Values populated via sprawl-world/scripts/load-freeside-dashboard-secrets.sh
  # (to be authored in L-migrate-dashboard dispatch; mirrors
  # load-constructs-network-secrets.sh).
  #
  # Intentionally absent:
  #   - ADMIN_ADDRESSES    public allowlist, env_var only (see above)
  #   - SIWE_*             config, env_var only
  #   - SENTRY_DSN         per operator convention, DSN is non-secret env_var
  #                        IF treating as semi-public; else move to secrets.
  #                        Filed as open decision in L-migrate-dashboard.
  secrets = {
    TURSO_DATABASE_URL    = aws_secretsmanager_secret.freeside_dashboard["turso_database_url"].arn
    TURSO_AUTH_TOKEN      = aws_secretsmanager_secret.freeside_dashboard["turso_auth_token"].arn
    GITHUB_TOKEN          = aws_secretsmanager_secret.freeside_dashboard["github_token"].arn
    SENTRY_DSN            = aws_secretsmanager_secret.freeside_dashboard["sentry_dsn"].arn
  }

  secret_arns = [for s in aws_secretsmanager_secret.freeside_dashboard : s.arn]
}

# =============================================================================
# ECS task-role extension: dashboard reads ECS state for observability
# =============================================================================
# The dashboard is an operator surface that reads ECS cluster state (services,
# tasks, events), ECR image tags, and CloudWatch logs for all Freeside worlds.
# That requires specific IAM permissions on the dashboard's own ECS task role,
# beyond the default world-module policy (which just grants secrets access).
#
# DEFERRED: task-role additional-policy-attachment resource. Draft scope:
#   - ecs:DescribeClusters, DescribeServices, DescribeTasks, ListTasks
#   - ecr:DescribeImages, BatchGetImage (read-only)
#   - logs:DescribeLogStreams, GetLogEvents, FilterLogEvents
#   - tagging:GetResources (for cost-tag correlation)
#   Scoped to `arn:aws:ecs:*:*:cluster/arrakis-*` and children only.
#
# Tracked as open decision in L-migrate-dashboard (cycle-011+ continuation).
# Acceptable interim: dashboard runs in read-only-degraded mode if these perms
# are missing — env FREESIDE_ECS_CLUSTER empty → dashboard shows "ECS probe unavailable".

output "freeside_dashboard_ecr_url" {
  value       = module.world_freeside_dashboard.ecr_repository_url
  description = "ECR repository for freeside-dashboard image pushes (sprawl-world CI uses this)"
}

output "freeside_dashboard_ci_role_arn" {
  value       = module.world_freeside_dashboard.ci_deploy_role_arn
  description = "IAM role ARN for sprawl-world freeside-dashboard GitHub Actions OIDC (set as AWS_DEPLOY_ROLE_ARN_FREESIDE_DASHBOARD repo secret)"
}

output "freeside_dashboard_subdomain" {
  value       = "freeside-dashboard.${var.environment == "production" ? "0xhoneyjar.xyz" : "staging.0xhoneyjar.xyz"}"
  description = "Provisional subdomain during staged cutover (before dashboard.sprawl.world alias swap)"
}

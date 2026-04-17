# =============================================================================
# World: mibera — Honey Road marketplace (Next.js 15.3.8, Berachain)
# =============================================================================
# B2 migration 2026-04-16: repo swapped from mibera-world (SvelteKit sovereign-
# stack prototype) to mibera-honeyroad (production Vercel-hosted Next.js app).
# See grimoires/loa/prd.md §10 for the in-place-swap vs destroy-recreate
# tradeoff rationale. The `name = "mibera"` is preserved to keep the ECR repo,
# ALB listener rule, and Route53 slot stable across the swap.
#
# Related: 0xHoneyJar/loa-freeside#153
# Seed:    (bonfire) grimoires/bonfire/context/honeyroad-to-freeside-seed/
# =============================================================================

module "world_mibera" {
  source = "./modules/world"

  name        = "mibera"
  repo        = "0xHoneyJar/mibera-honeyroad"
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

  # Next.js 15 + Sentry + sharp is heavier than the SvelteKit baseline (256/512).
  # Starting point; tune via CloudWatch observation (prd.md §6.3).
  cpu    = 512
  memory = 1024

  # Honey Road responds 200 at / (Next.js default). Module health check uses
  # `node -e "require('http').get(...)"` which is portable on node:22-alpine.
  health_check_path = "/"

  # Non-secret runtime env. NEXT_PUBLIC_* vars are baked into the client bundle
  # at build time via --build-arg in CI (see mibera-honeyroad/.github/workflows/
  # deploy-freeside.yml) — they are PUBLIC BY DESIGN and MUST NOT be stored as
  # "secrets". The security boundary for NEXT_PUBLIC_SUPABASE_ANON_KEY is
  # Supabase Row Level Security, not secrecy of the key (flatline SKP-001).
  env_vars = {
    NEXT_PUBLIC_DYNAMIC_COOKIE_DOMAIN = "auth.0xhoneyjar.xyz"
  }

  # Runtime secrets — resolved by ECS from AWS Secrets Manager at task start.
  # Values populated via scripts/load-honeyroad-secrets.sh (see world-mibera-
  # secrets.tf for the structural definition of each secret).
  #
  # Intentionally absent:
  #   - NEXT_PUBLIC_*       — public-by-design, --build-arg only (see above)
  #   - SENTRY_AUTH_TOKEN   — build-time-only, BuildKit --secret mount in CI
  #                           (never lands in an image layer; never reaches a
  #                           running container — prd.md:299, flatline SKP-001)
  secrets = {
    DATABASE_URL                = aws_secretsmanager_secret.honeyroad["database_url"].arn
    SUPABASE_SERVICE_ROLE_KEY   = aws_secretsmanager_secret.honeyroad["supabase_service_role"].arn
    DYNAMIC_AUTH_TOKEN          = aws_secretsmanager_secret.honeyroad["dynamic_auth_token"].arn
    DYNAMIC_SERVER_API_KEY      = aws_secretsmanager_secret.honeyroad["dynamic_server_api_key"].arn
    OPENAI_API_KEY              = aws_secretsmanager_secret.honeyroad["openai_api_key"].arn
    ANTHROPIC_API_KEY           = aws_secretsmanager_secret.honeyroad["anthropic_api_key"].arn
    SESSION_SECRET              = aws_secretsmanager_secret.honeyroad["session_secret"].arn
    DEV_WALLET_PRIVATE_KEY      = aws_secretsmanager_secret.honeyroad["dev_wallet_pk"].arn
    TRIGGER_SECRET_KEY          = aws_secretsmanager_secret.honeyroad["trigger_secret"].arn
    TWITTER_CLIENT_ID           = aws_secretsmanager_secret.honeyroad["twitter_client_id"].arn
    TWITTER_CLIENT_SECRET       = aws_secretsmanager_secret.honeyroad["twitter_client_secret"].arn
    DISCORD_CLIENT_ID           = aws_secretsmanager_secret.honeyroad["discord_client_id"].arn
    DISCORD_CLIENT_SECRET       = aws_secretsmanager_secret.honeyroad["discord_client_secret"].arn
    CLOUDINARY_API_KEY          = aws_secretsmanager_secret.honeyroad["cloudinary_key"].arn
    CLOUDINARY_API_SECRET       = aws_secretsmanager_secret.honeyroad["cloudinary_secret"].arn
    DUNE_API_KEY                = aws_secretsmanager_secret.honeyroad["dune_api_key"].arn
    QUESTS_API_SECRET           = aws_secretsmanager_secret.honeyroad["quests_api_secret"].arn
    VM_API_SECRET               = aws_secretsmanager_secret.honeyroad["vm_api_secret"].arn
    AWS_ACCESS_KEY_ID_VM        = aws_secretsmanager_secret.honeyroad["aws_access_key_vm"].arn
    AWS_SECRET_ACCESS_KEY_VM    = aws_secretsmanager_secret.honeyroad["aws_secret_key_vm"].arn
    AWS_BUCKET_NAME_VM          = aws_secretsmanager_secret.honeyroad["aws_bucket_name_vm"].arn
    AWS_REGION_VM               = aws_secretsmanager_secret.honeyroad["aws_region_vm"].arn
    ALLOWED_PARENT_URL          = aws_secretsmanager_secret.honeyroad["allowed_parent_url"].arn
  }

  secret_arns = [for s in aws_secretsmanager_secret.honeyroad : s.arn]
}

output "mibera_ecr_url" {
  value       = module.world_mibera.ecr_repository_url
  description = "ECR repository for Honey Road image pushes (CI uses this)"
}

output "mibera_ci_role_arn" {
  value       = module.world_mibera.ci_deploy_role_arn
  description = "IAM role ARN for mibera-honeyroad GitHub Actions OIDC (set as AWS_DEPLOY_ROLE_ARN repo secret)"
}

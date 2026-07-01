# =============================================================================
# World: freeside — Freeside CM dashboard (Next.js 15, freeside-dashboard)
# =============================================================================
# Operator dashboard at freeside.0xhoneyjar.xyz — the sovereign Vercel replacement
# surface for managing worlds, communities, and substrate cutovers.
# Repo: 0xHoneyJar/freeside-dashboard
# =============================================================================

module "world_freeside" {
  source = "./modules/world"

  name        = "freeside"
  repo        = "0xHoneyJar/freeside-dashboard"
  environment = var.environment

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

  cpu    = 512
  memory = 1024

  # Static health route — see freeside-dashboard/src/app/api/health/route.ts
  health_check_path = "/api/health"

  env_vars = {
    APP_URL                  = "https://freeside.0xhoneyjar.xyz"
    NEXT_PUBLIC_APP_URL      = "https://freeside.0xhoneyjar.xyz"
    IDENTITY_API_URL         = "https://identity.0xhoneyjar.xyz"
    IDENTITY_RESOLVE_ENABLED = "true"
    SCORE_API_URL            = "https://score-api.0xhoneyjar.xyz"
    TRUST_PROXY_HEADERS      = "true"
    NODE_ENV                 = "production"
  }

  secrets = {
    DATABASE_URL             = aws_secretsmanager_secret.freeside_dashboard["database_url"].arn
    SCORE_API_KEY            = aws_secretsmanager_secret.freeside_dashboard["score_api_key"].arn
    LINK_SERVICE_TOKEN       = aws_secretsmanager_secret.freeside_dashboard["link_service_token"].arn
    ORDERING_SERVICE_TOKEN   = aws_secretsmanager_secret.freeside_dashboard["ordering_service_token"].arn
    CONFIG_SERVICE_TOKEN     = aws_secretsmanager_secret.freeside_dashboard["config_service_token"].arn
  }

  secret_arns = [for s in aws_secretsmanager_secret.freeside_dashboard : s.arn]
}

# Dashboard calls identity-api, score-api, ordering-service, config-service, and
# external Postgres (Neon/Vercel DB during bootstrap). Broad TCP egress matches
# the Honey Road pattern until the world module grows an egress_mode variable.
resource "aws_security_group_rule" "freeside_broad_tcp_outbound" {
  type              = "egress"
  from_port         = 0
  to_port           = 65535
  protocol          = "tcp"
  cidr_blocks       = ["0.0.0.0/0"]
  security_group_id = module.world_freeside.security_group_id
  description       = "Freeside Dashboard broad TCP outbound (Postgres + substrate APIs)."
}

output "freeside_ecr_url" {
  value       = module.world_freeside.ecr_repository_url
  description = "ECR repository for freeside-dashboard image pushes (set in CI as ECR_REPOSITORY)"
}

output "freeside_ci_role_arn" {
  value       = module.world_freeside.ci_deploy_role_arn
  description = "IAM role ARN for freeside-dashboard GitHub Actions OIDC (AWS_DEPLOY_ROLE_ARN secret)"
}

output "freeside_subdomain" {
  value       = module.world_freeside.subdomain
  description = "Canonical dashboard hostname (freeside.0xhoneyjar.xyz)"
}

# =============================================================================
# World: score-api — Hono API for THJ scoring/leaderboard (Railway migration)
# =============================================================================
# Issue: https://github.com/0xHoneyJar/loa-freeside/issues/159
# =============================================================================

# -----------------------------------------------------------------------------
# Secrets Manager — DATABASE_URL for score-api on shared RDS
# -----------------------------------------------------------------------------

resource "aws_secretsmanager_secret" "score_api_db_url" {
  name                    = "${local.name_prefix}/world-score-api/database-url"
  recovery_window_in_days = 7
  kms_key_id              = aws_kms_key.secrets.id

  tags = merge(local.common_tags, {
    Service = "World"
    World   = "score-api"
  })
}

resource "aws_secretsmanager_secret_version" "score_api_db_url" {
  secret_id     = aws_secretsmanager_secret.score_api_db_url.id
  secret_string = "postgresql://${aws_db_instance.main.username}:${random_password.db_password.result}@${aws_db_instance.main.address}:${aws_db_instance.main.port}/score_api?sslmode=no-verify"
}

# -----------------------------------------------------------------------------
# World Module
# -----------------------------------------------------------------------------

module "world_score_api" {
  source = "./modules/world"

  name        = "score-api"
  repo        = "0xHoneyJar/score-api"
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

  cpu    = 256
  memory = 512

  health_check_path = "/v1/health"

  secrets = {
    DATABASE_URL = aws_secretsmanager_secret.score_api_db_url.arn
  }

  secret_arns = [
    aws_secretsmanager_secret.score_api_db_url.arn
  ]

  env_vars = {
    PORT = "3000"
  }
}

# -----------------------------------------------------------------------------
# Network: Allow score-api → RDS (port 5432)
# -----------------------------------------------------------------------------

resource "aws_security_group_rule" "score_api_to_rds" {
  type                     = "egress"
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  security_group_id        = module.world_score_api.security_group_id
  source_security_group_id = aws_security_group.rds.id
  description              = "score-api world to RDS"
}

resource "aws_security_group_rule" "rds_from_score_api" {
  type                     = "ingress"
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  security_group_id        = aws_security_group.rds.id
  source_security_group_id = module.world_score_api.security_group_id
  description              = "RDS from score-api world"
}

# -----------------------------------------------------------------------------
# Outputs
# -----------------------------------------------------------------------------

output "score_api_ecr_url" {
  value = module.world_score_api.ecr_repository_url
}

output "score_api_ci_role_arn" {
  value = module.world_score_api.ci_deploy_role_arn
}

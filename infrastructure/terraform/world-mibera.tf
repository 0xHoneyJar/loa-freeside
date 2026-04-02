# =============================================================================
# World: mibera — Identity mirror + marketplace (Berachain)
# =============================================================================
# Issue: https://github.com/0xHoneyJar/loa-freeside/issues/153
# =============================================================================

module "world_mibera" {
  source = "./modules/world"

  name        = "mibera"
  repo        = "0xHoneyJar/mibera-world"
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

  env_vars = {
    PUBLIC_CHAIN_ID = "80094"
    PUBLIC_RPC_URL  = "https://rpc.berachain.com"
  }
}

output "mibera_ecr_url" {
  value = module.world_mibera.ecr_repository_url
}

output "mibera_ci_role_arn" {
  value = module.world_mibera.ci_deploy_role_arn
}

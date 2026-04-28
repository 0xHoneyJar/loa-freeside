# =============================================================================
# World: midi — MOB scoring + analytics surface (Next.js 15, Berachain)
# =============================================================================
# midi-interface (canonical) + mibera-dimensions (paired surface) — both deploy
# to the same Vercel project (prj_J6Q0SydniMeDWK0mARqRwUOqRrbn) named
# "midi-interface". Cross-world dependency: calls into score-api (deployed via
# world-score-api.tf) for ridge plots + leaderboard data.
#
# Lighter than mibera/honeyroad: no Trigger.dev jobs, no Cloudinary, no OAuth,
# no VM uploads. Pure Next.js + Supabase + score-api consumer. Starting compute
# is 256/512 (vs honeyroad's 512/1024); tune via CloudWatch observation.
#
# Repo target: 0xHoneyJar/midi-interface (canonical, more recent activity).
# mibera-dimensions is the same Vercel project; treating midi-interface as the
# Docker source of truth.
#
# Health-check requirement: midi-interface needs `/api/health/route.ts` added
# before terraform apply (see staged route in micodex-studio's
# grimoires/loa/cultivations/midi/staging/). Until that lands, health_check_path
# falls back to "/" with a longer timeout.
#
# Related: world-score-api.tf (cross-world dep), world-mibera.tf (template)
# =============================================================================

module "world_midi" {
  source = "./modules/world"

  name        = "midi"
  repo        = "0xHoneyJar/midi-interface"
  environment = var.environment

  # Shared infrastructure references (mirror honeyroad)
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

  # Lighter than honeyroad — no Sentry/sharp build pressure, no Trigger.dev runtime,
  # no Cloudinary background uploads. Starting point; tune via CloudWatch.
  cpu    = 256
  memory = 512

  # Use dedicated /api/health endpoint once midi-interface ships it.
  # The homepage hits Supabase + score-api on cold render and may exceed the
  # 5s container health-check timeout. /api/health returns static 200 with no IO.
  #
  # PREREQUISITE: midi-interface PR adding `app/api/health/route.ts` must merge
  # before terraform apply. See micodex-studio/grimoires/loa/cultivations/midi/staging/
  # for the route stub.
  health_check_path = "/api/health"

  # Non-secret runtime env. NEXT_PUBLIC_* vars are baked into the client bundle
  # at build time via --build-arg in CI (see midi-interface/.github/workflows/
  # deploy-freeside.yml when authored). Public by design.
  env_vars = {
    NEXT_PUBLIC_DYNAMIC_COOKIE_DOMAIN = "auth.0xhoneyjar.xyz"
  }

  # Runtime secrets — resolved by ECS from AWS Secrets Manager at task start.
  # Values populated via scripts/load-midi-secrets.sh (see world-midi-secrets.tf
  # for the structural definition of each secret).
  #
  # 5 secrets vs honeyroad's 23 — midi is a leaner surface (no Trigger, no
  # Cloudinary, no OAuth, no VM uploads, no Dune ingest, Supabase external).
  secrets = {
    DYNAMIC_AUTH_TOKEN        = aws_secretsmanager_secret.midi["dynamic_auth_token"].arn
    SUPABASE_SERVICE_ROLE_KEY = aws_secretsmanager_secret.midi["supabase_service_role"].arn
    SCORE_API_URL             = aws_secretsmanager_secret.midi["score_api_url"].arn
    SCORE_API_KEY             = aws_secretsmanager_secret.midi["score_api_key"].arn
    SIGNALS_API_KEY           = aws_secretsmanager_secret.midi["signals_api_key"].arn
  }

  secret_arns = [for s in aws_secretsmanager_secret.midi : s.arn]
}

# Note: NO broad TCP outbound rule. Midi only needs HTTPS (443) for:
#   - Supabase (external service)
#   - score-api (internal, but resolves via HTTPS through ALB)
#   - Berachain RPC (HTTPS)
#   - Signals API (Ruggy, HTTPS)
# Default world module egress (HTTPS + EFS + Finn) covers all of these.

output "midi_ecr_url" {
  value       = module.world_midi.ecr_repository_url
  description = "ECR repository for midi-interface image pushes (CI uses this)"
}

output "midi_ci_role_arn" {
  value       = module.world_midi.ci_deploy_role_arn
  description = "IAM role ARN for midi-interface GitHub Actions OIDC (set as AWS_DEPLOY_ROLE_ARN repo secret)"
}

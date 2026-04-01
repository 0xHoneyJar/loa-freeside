# =============================================================================
# World Module — Main (locals + computed values)
# =============================================================================

locals {
  world_name   = "${var.name_prefix}-world-${var.name}"
  subdomain    = "${var.name}.${var.domain}"
  finn_url     = var.finn_url != "" ? var.finn_url : "http://finn.${var.name_prefix}.local:3000"

  # Deterministic ALB priority from name hash (range 300-499)
  priority_hash = parseint(substr(md5(var.name), 0, 4), 16)
  alb_priority  = 300 + (local.priority_hash % 200)

  tags = merge(var.common_tags, {
    World   = var.name
    Service = "World"
  })

  # Default + custom environment variables
  default_env = {
    NODE_ENV      = "production"
    PORT          = tostring(var.port)
    DATABASE_PATH = "/data/${var.name}.db"
    AI_GATEWAY_URL = local.finn_url
  }

  all_env = merge(local.default_env, var.env_vars)
}

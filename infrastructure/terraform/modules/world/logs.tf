# =============================================================================
# World Module — CloudWatch Logs
# =============================================================================

resource "aws_cloudwatch_log_group" "world" {
  name              = "/ecs/${var.name_prefix}/worlds/${var.name}"
  retention_in_days = var.log_retention_days

  tags = local.tags
}

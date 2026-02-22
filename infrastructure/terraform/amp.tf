# =============================================================================
# Amazon Managed Prometheus (AMP) + ADOT Configuration
# Cycle 036: Launch Readiness — Sprint 1, Task 1.6
# =============================================================================
#
# AMP workspace collects Prometheus metrics from all ECS services via ADOT
# sidecar containers. CloudWatch Container Insights remain active for
# ECS-level metrics (CPU, memory, network).
#
# ADOT sidecar in each task definition scrapes /metrics and forwards to AMP.

# -----------------------------------------------------------------------------
# AMP Workspace
# -----------------------------------------------------------------------------

resource "aws_prometheus_workspace" "main" {
  alias = "${local.name_prefix}-metrics"

  logging_configuration {
    log_group_arn = "${aws_cloudwatch_log_group.amp.arn}:*"
  }

  tags = merge(local.common_tags, {
    Service = "Observability"
    Sprint  = "C36-1"
  })
}

resource "aws_cloudwatch_log_group" "amp" {
  name              = "/amp/${local.name_prefix}"
  retention_in_days = var.log_retention_days

  tags = merge(local.common_tags, {
    Service = "Observability"
    Sprint  = "C36-1"
  })
}

# -----------------------------------------------------------------------------
# IAM Role for ADOT to write to AMP
# -----------------------------------------------------------------------------

resource "aws_iam_role_policy" "finn_task_amp" {
  name = "${local.name_prefix}-finn-task-amp"
  role = aws_iam_role.finn_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AMPRemoteWrite"
        Effect = "Allow"
        Action = [
          "aps:RemoteWrite"
        ]
        Resource = aws_prometheus_workspace.main.arn
      }
    ]
  })
}

# Grant AMP write to the shared ECS task role (for freeside ADOT sidecar)
resource "aws_iam_role_policy" "ecs_task_amp" {
  name = "${local.name_prefix}-ecs-task-amp"
  role = aws_iam_role.ecs_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AMPRemoteWrite"
        Effect = "Allow"
        Action = [
          "aps:RemoteWrite"
        ]
        Resource = aws_prometheus_workspace.main.arn
      }
    ]
  })
}

# -----------------------------------------------------------------------------
# Outputs
# -----------------------------------------------------------------------------

output "amp_workspace_id" {
  description = "AMP workspace ID"
  value       = aws_prometheus_workspace.main.id
}

output "amp_remote_write_url" {
  description = "AMP remote write endpoint"
  value       = "${aws_prometheus_workspace.main.prometheus_endpoint}api/v1/remote_write"
}

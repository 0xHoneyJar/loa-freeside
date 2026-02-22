# =============================================================================
# Alerting Rules — Conservation Guard + Service Health
# Cycle 036: Sprint 7 (320), Task 7.2
# =============================================================================
#
# All alarms fire to SNS → Slack webhook. 60s evaluation period where possible
# to meet <60s alerting requirement.
#
# Existing alarms in monitoring.tf cover: CPU, memory, ALB 5xx, Redis,
# agent budget/reconciliation/drift/reaper. This file adds Sprint 7 alarms
# for conservation guard, billing flow, auth, and webhook processing.

# -----------------------------------------------------------------------------
# Slack Integration — AWS Chatbot (SNS → Slack)
# -----------------------------------------------------------------------------
#
# AWS Chatbot provides managed SNS → Slack routing without Lambda.
# Requires one-time Slack workspace authorization in AWS Console:
#   AWS Chatbot → Configure new client → Slack → Authorize
# The workspace_id and channel_id are then available for Terraform.

resource "aws_iam_role" "chatbot" {
  count = (var.slack_workspace_id != "" && var.slack_channel_id != "") ? 1 : 0
  name  = "${local.name_prefix}-chatbot"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Principal = { Service = "chatbot.amazonaws.com" }
        Action    = "sts:AssumeRole"
      }
    ]
  })

  tags = merge(local.common_tags, {
    Sprint = "320-Task-7.2"
  })
}

resource "aws_iam_role_policy" "chatbot_cloudwatch" {
  count = (var.slack_workspace_id != "" && var.slack_channel_id != "") ? 1 : 0
  name  = "${local.name_prefix}-chatbot-cw-read"
  role  = aws_iam_role.chatbot[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "cloudwatch:Describe*",
          "cloudwatch:Get*",
          "cloudwatch:List*"
        ]
        Resource = "*"
      }
    ]
  })
}

resource "aws_chatbot_slack_channel_configuration" "alerts" {
  count              = (var.slack_workspace_id != "" && var.slack_channel_id != "") ? 1 : 0
  configuration_name = "${local.name_prefix}-alerts"
  iam_role_arn       = aws_iam_role.chatbot[0].arn
  slack_team_id      = var.slack_workspace_id
  slack_channel_id   = var.slack_channel_id
  sns_topic_arns     = [aws_sns_topic.alerts.arn]
  logging_level      = "ERROR"

  tags = merge(local.common_tags, {
    Sprint = "320-Task-7.2"
  })
}

# -----------------------------------------------------------------------------
# Conservation Guard Alarms
# -----------------------------------------------------------------------------

# Conservation guard check failure — budget invariant violated
resource "aws_cloudwatch_metric_alarm" "conservation_guard_failure" {
  alarm_name          = "${local.name_prefix}-conservation-guard-failure"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "ConservationCheckFailed"
  namespace           = "Arrakis/Billing"
  period              = 60
  statistic           = "Sum"
  threshold           = 0
  alarm_description   = "Conservation guard failure detected — budget invariant violated. Dashboard: https://${var.aws_region}.console.aws.amazon.com/cloudwatch/home?region=${var.aws_region}#dashboards:name=${local.name_prefix}-service-health"
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = merge(local.common_tags, {
    Service  = "Billing"
    Severity = "critical"
    Sprint   = "320-Task-7.2"
  })
}

# Budget drift >1% — conservation guard drift warning
resource "aws_cloudwatch_metric_alarm" "conservation_budget_drift" {
  alarm_name          = "${local.name_prefix}-conservation-budget-drift"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "ConservationDriftPercent"
  namespace           = "Arrakis/Billing"
  period              = 60
  statistic           = "Maximum"
  threshold           = 1.0
  alarm_description   = "Budget drift >1%% detected — conservation guard warning. Dashboard: https://${var.aws_region}.console.aws.amazon.com/cloudwatch/home?region=${var.aws_region}#dashboards:name=${local.name_prefix}-service-health"
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = merge(local.common_tags, {
    Service  = "Billing"
    Severity = "high"
    Sprint   = "320-Task-7.2"
  })
}

# -----------------------------------------------------------------------------
# Service Health Alarms
# -----------------------------------------------------------------------------

# ECS API service health check failure
resource "aws_cloudwatch_metric_alarm" "api_health_check_failure" {
  alarm_name          = "${local.name_prefix}-api-health-check-failure"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 1
  metric_name         = "HealthyHostCount"
  namespace           = "AWS/ApplicationELB"
  period              = 60
  statistic           = "Minimum"
  threshold           = 1
  alarm_description   = "API service has no healthy targets — service is DOWN. Dashboard: https://${var.aws_region}.console.aws.amazon.com/cloudwatch/home?region=${var.aws_region}#dashboards:name=${local.name_prefix}-service-health"
  treat_missing_data  = "breaching"

  dimensions = {
    TargetGroup  = aws_lb_target_group.api.arn_suffix
    LoadBalancer = aws_lb.main.arn_suffix
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = merge(local.common_tags, {
    Service  = "API"
    Severity = "critical"
    Sprint   = "320-Task-7.2"
  })
}

# 5xx error rate >5% for 5 minutes (math expression alarm)
resource "aws_cloudwatch_metric_alarm" "api_5xx_rate_high" {
  alarm_name          = "${local.name_prefix}-api-5xx-rate-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 5
  threshold           = 5
  alarm_description   = "5xx error rate >5%% for 5 minutes. Dashboard: https://${var.aws_region}.console.aws.amazon.com/cloudwatch/home?region=${var.aws_region}#dashboards:name=${local.name_prefix}-service-health"
  treat_missing_data  = "notBreaching"

  metric_query {
    id          = "e1"
    expression  = "IF(m1 > 0, (m2 / m1) * 100, 0)"
    label       = "5xx Error Rate %"
    return_data = true
  }

  metric_query {
    id = "m1"
    metric {
      metric_name = "RequestCount"
      namespace   = "AWS/ApplicationELB"
      period      = 60
      stat        = "Sum"
      dimensions = {
        LoadBalancer = aws_lb.main.arn_suffix
      }
    }
  }

  metric_query {
    id = "m2"
    metric {
      metric_name = "HTTPCode_ELB_5XX_Count"
      namespace   = "AWS/ApplicationELB"
      period      = 60
      stat        = "Sum"
      dimensions = {
        LoadBalancer = aws_lb.main.arn_suffix
      }
    }
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = merge(local.common_tags, {
    Service  = "API"
    Severity = "high"
    Sprint   = "320-Task-7.2"
  })
}

# -----------------------------------------------------------------------------
# Payment / Webhook Alarms
# -----------------------------------------------------------------------------

# Payment webhook 5xx — NOWPayments IPN processing failure
resource "aws_cloudwatch_metric_alarm" "webhook_processing_failure" {
  alarm_name          = "${local.name_prefix}-webhook-processing-failure"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "WebhookRejected"
  namespace           = "Arrakis/Webhook"
  period              = 60
  statistic           = "Sum"
  threshold           = 0
  alarm_description   = "Payment webhook rejected — HMAC validation or processing failure. Dashboard: https://${var.aws_region}.console.aws.amazon.com/cloudwatch/home?region=${var.aws_region}#dashboards:name=${local.name_prefix}-service-health"
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alerts.arn]

  tags = merge(local.common_tags, {
    Service  = "Webhook"
    Severity = "high"
    Sprint   = "320-Task-7.2"
  })
}

# Payment failure — NOWPayments payment status failed
resource "aws_cloudwatch_metric_alarm" "payment_failure" {
  alarm_name          = "${local.name_prefix}-payment-failure"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "PaymentFailed"
  namespace           = "Arrakis/Billing"
  period              = 60
  statistic           = "Sum"
  threshold           = 0
  alarm_description   = "Payment failure detected — investigate NOWPayments status. Dashboard: https://${var.aws_region}.console.aws.amazon.com/cloudwatch/home?region=${var.aws_region}#dashboards:name=${local.name_prefix}-service-health"
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alerts.arn]

  tags = merge(local.common_tags, {
    Service  = "Billing"
    Severity = "high"
    Sprint   = "320-Task-7.2"
  })
}

# -----------------------------------------------------------------------------
# Auth Failure Alarms
# -----------------------------------------------------------------------------

# JWT validation failure spike — possible token forgery or misconfiguration
resource "aws_cloudwatch_metric_alarm" "jwt_validation_failure_spike" {
  alarm_name          = "${local.name_prefix}-jwt-validation-failure-spike"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "JwtValidationFailure"
  namespace           = "Arrakis/Auth"
  period              = 60
  statistic           = "Sum"
  threshold           = 10
  alarm_description   = "JWT validation failures >10 in 2 minutes — possible key rotation issue or attack. Dashboard: https://${var.aws_region}.console.aws.amazon.com/cloudwatch/home?region=${var.aws_region}#dashboards:name=${local.name_prefix}-service-health"
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alerts.arn]

  tags = merge(local.common_tags, {
    Service  = "Auth"
    Severity = "high"
    Sprint   = "320-Task-7.2"
  })
}

# API key failure spike — possible brute force attempt
resource "aws_cloudwatch_metric_alarm" "api_key_failure_spike" {
  alarm_name          = "${local.name_prefix}-api-key-failure-spike"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "ApiKeyFailure"
  namespace           = "Arrakis/Auth"
  period              = 60
  statistic           = "Sum"
  threshold           = 20
  alarm_description   = "API key failures >20 in 2 minutes — possible brute force. Dashboard: https://${var.aws_region}.console.aws.amazon.com/cloudwatch/home?region=${var.aws_region}#dashboards:name=${local.name_prefix}-service-health"
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alerts.arn]

  tags = merge(local.common_tags, {
    Service  = "Auth"
    Severity = "high"
    Sprint   = "320-Task-7.2"
  })
}

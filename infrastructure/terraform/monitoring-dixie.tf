# =============================================================================
# CloudWatch Alarms & Metric Filters for Dixie Service
# Cycle 046: Armitage Platform — Sprint 2, Task 2.1
# SDD §3.7: monitoring-dixie.tf
# =============================================================================
#
# 4 CloudWatch alarms + 2 metric filters for Dixie service monitoring.
# All alarms route to existing SNS topic for alerting.

# -----------------------------------------------------------------------------
# Alarms
# -----------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "dixie_cpu_high" {
  alarm_name          = "${local.name_prefix}-dixie-cpu-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "CPUUtilization"
  namespace           = "AWS/ECS"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  alarm_description   = "Dixie CPU utilization exceeds 80%"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]

  dimensions = {
    ClusterName = aws_ecs_cluster.main.name
    ServiceName = aws_ecs_service.dixie.name
  }

  tags = merge(local.common_tags, { Service = "dixie" })
}

resource "aws_cloudwatch_metric_alarm" "dixie_memory_high" {
  alarm_name          = "${local.name_prefix}-dixie-memory-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "MemoryUtilization"
  namespace           = "AWS/ECS"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  alarm_description   = "Dixie memory utilization exceeds 80%"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]

  dimensions = {
    ClusterName = aws_ecs_cluster.main.name
    ServiceName = aws_ecs_service.dixie.name
  }

  tags = merge(local.common_tags, { Service = "dixie" })
}

resource "aws_cloudwatch_metric_alarm" "dixie_5xx" {
  alarm_name          = "${local.name_prefix}-dixie-5xx"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Dixie5xxErrors"
  namespace           = "Arrakis/Dixie"
  period              = 60
  statistic           = "Sum"
  threshold           = 5
  alarm_description   = "Dixie 5xx error rate elevated"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  treat_missing_data  = "notBreaching"

  tags = merge(local.common_tags, { Service = "dixie" })
}

resource "aws_cloudwatch_metric_alarm" "dixie_task_count" {
  alarm_name          = "${local.name_prefix}-dixie-task-count"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 1
  metric_name         = "RunningTaskCount"
  namespace           = "ECS/ContainerInsights"
  period              = 60
  statistic           = "Minimum"
  threshold           = 1
  alarm_description   = "Dixie has no running tasks"
  alarm_actions       = [aws_sns_topic.alerts.arn]

  dimensions = {
    ClusterName = aws_ecs_cluster.main.name
    ServiceName = aws_ecs_service.dixie.name
  }

  tags = merge(local.common_tags, { Service = "dixie" })
}

# -----------------------------------------------------------------------------
# Metric Filters
# -----------------------------------------------------------------------------

resource "aws_cloudwatch_log_metric_filter" "dixie_errors" {
  name           = "${local.name_prefix}-dixie-error-filter"
  log_group_name = aws_cloudwatch_log_group.dixie.name
  pattern        = "{ $.level = \"error\" }"

  metric_transformation {
    name      = "DixieErrors"
    namespace = "Arrakis/Dixie"
    value     = "1"
  }
}

resource "aws_cloudwatch_log_metric_filter" "dixie_5xx_filter" {
  name           = "${local.name_prefix}-dixie-5xx-filter"
  log_group_name = aws_cloudwatch_log_group.dixie.name
  pattern        = "{ $.statusCode >= 500 }"

  metric_transformation {
    name      = "Dixie5xxErrors"
    namespace = "Arrakis/Dixie"
    value     = "1"
  }
}

# =============================================================================
# CloudWatch Alarms & Metric Filters for Finn Service
# Cycle 046: Armitage Platform — Sprint 2, Task 2.1
# SDD §3.6: monitoring-finn.tf
# =============================================================================
#
# 6 CloudWatch alarms + 2 metric filters for Finn service monitoring.
# All alarms route to existing SNS topic for alerting.

# -----------------------------------------------------------------------------
# Alarms
# -----------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "finn_cpu_high" {
  alarm_name          = "${local.name_prefix}-finn-cpu-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "CPUUtilization"
  namespace           = "AWS/ECS"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  alarm_description   = "Finn CPU utilization exceeds 80%"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]

  dimensions = {
    ClusterName = aws_ecs_cluster.main.name
    ServiceName = aws_ecs_service.finn.name
  }

  tags = merge(local.common_tags, { Service = "finn" })
}

resource "aws_cloudwatch_metric_alarm" "finn_memory_high" {
  alarm_name          = "${local.name_prefix}-finn-memory-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "MemoryUtilization"
  namespace           = "AWS/ECS"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  alarm_description   = "Finn memory utilization exceeds 80%"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]

  dimensions = {
    ClusterName = aws_ecs_cluster.main.name
    ServiceName = aws_ecs_service.finn.name
  }

  tags = merge(local.common_tags, { Service = "finn" })
}

resource "aws_cloudwatch_metric_alarm" "finn_5xx" {
  alarm_name          = "${local.name_prefix}-finn-5xx"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Finn5xxErrors"
  namespace           = "Arrakis/Finn"
  period              = 60
  statistic           = "Sum"
  threshold           = 5
  alarm_description   = "Finn 5xx error rate elevated"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  treat_missing_data  = "notBreaching"

  tags = merge(local.common_tags, { Service = "finn" })
}

resource "aws_cloudwatch_metric_alarm" "finn_task_count" {
  alarm_name          = "${local.name_prefix}-finn-task-count"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 1
  metric_name         = "RunningTaskCount"
  namespace           = "ECS/ContainerInsights"
  period              = 60
  statistic           = "Minimum"
  threshold           = 1
  alarm_description   = "Finn has no running tasks"
  alarm_actions       = [aws_sns_topic.alerts.arn]

  dimensions = {
    ClusterName = aws_ecs_cluster.main.name
    ServiceName = aws_ecs_service.finn.name
  }

  tags = merge(local.common_tags, { Service = "finn" })
}

resource "aws_cloudwatch_metric_alarm" "finn_latency_p99" {
  alarm_name          = "${local.name_prefix}-finn-latency-p99"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "FinnLatencyP99"
  namespace           = "Arrakis/Finn"
  period              = 60
  extended_statistic  = "p99"
  threshold           = 2000
  alarm_description   = "Finn p99 latency exceeds 2s"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  treat_missing_data  = "notBreaching"

  tags = merge(local.common_tags, { Service = "finn" })
}

resource "aws_cloudwatch_metric_alarm" "finn_redis_connection" {
  alarm_name          = "${local.name_prefix}-finn-redis-connection"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 2
  metric_name         = "CurrConnections"
  namespace           = "AWS/ElastiCache"
  period              = 300
  statistic           = "Minimum"
  threshold           = 1
  alarm_description   = "Finn dedicated Redis has no connections"
  alarm_actions       = [aws_sns_topic.alerts.arn]

  dimensions = {
    ReplicationGroupId = aws_elasticache_replication_group.finn_dedicated.id
  }

  tags = merge(local.common_tags, { Service = "finn" })
}

# -----------------------------------------------------------------------------
# Metric Filters
# -----------------------------------------------------------------------------

resource "aws_cloudwatch_log_metric_filter" "finn_errors" {
  name           = "${local.name_prefix}-finn-error-filter"
  log_group_name = aws_cloudwatch_log_group.finn.name
  pattern        = "{ $.level = \"error\" }"

  metric_transformation {
    name      = "FinnErrors"
    namespace = "Arrakis/Finn"
    value     = "1"
  }
}

resource "aws_cloudwatch_log_metric_filter" "finn_5xx_filter" {
  name           = "${local.name_prefix}-finn-5xx-filter"
  log_group_name = aws_cloudwatch_log_group.finn.name
  pattern        = "{ $.statusCode >= 500 }"

  metric_transformation {
    name      = "Finn5xxErrors"
    namespace = "Arrakis/Finn"
    value     = "1"
  }
}

# CloudWatch Alarms
resource "aws_cloudwatch_metric_alarm" "api_cpu_high" {
  alarm_name          = "${local.name_prefix}-api-cpu-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "CPUUtilization"
  namespace           = "AWS/ECS"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  alarm_description   = "API CPU utilization > 80%"

  dimensions = {
    ClusterName = aws_ecs_cluster.main.name
    ServiceName = aws_ecs_service.api.name
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = local.common_tags
}

resource "aws_cloudwatch_metric_alarm" "api_memory_high" {
  alarm_name          = "${local.name_prefix}-api-memory-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "MemoryUtilization"
  namespace           = "AWS/ECS"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  alarm_description   = "API memory utilization > 80%"

  dimensions = {
    ClusterName = aws_ecs_cluster.main.name
    ServiceName = aws_ecs_service.api.name
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = local.common_tags
}

resource "aws_cloudwatch_metric_alarm" "rds_cpu_high" {
  alarm_name          = "${local.name_prefix}-rds-cpu-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "CPUUtilization"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  alarm_description   = "RDS CPU utilization > 80%"

  dimensions = {
    DBInstanceIdentifier = aws_db_instance.main.id
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = local.common_tags
}

resource "aws_cloudwatch_metric_alarm" "alb_5xx_errors" {
  alarm_name          = "${local.name_prefix}-alb-5xx-errors"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "HTTPCode_ELB_5XX_Count"
  namespace           = "AWS/ApplicationELB"
  period              = 300
  statistic           = "Sum"
  threshold           = 10
  alarm_description   = "ALB 5XX errors > 10 in 5 minutes"
  treat_missing_data  = "notBreaching"

  dimensions = {
    LoadBalancer = aws_lb.main.arn_suffix
  }

  alarm_actions = [aws_sns_topic.alerts.arn]

  tags = local.common_tags
}

# =============================================================================
# Hounfour Phase 4: Agent Gateway Alarms
# =============================================================================

resource "aws_cloudwatch_metric_alarm" "agent_redis_cpu_high" {
  alarm_name          = "${local.name_prefix}-agent-redis-cpu-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "EngineCPUUtilization"
  namespace           = "AWS/ElastiCache"
  period              = 300
  statistic           = "Average"
  threshold           = 70
  alarm_description   = "Agent Redis CPU > 70% — budget enforcement at risk"

  dimensions = {
    CacheClusterId = aws_elasticache_cluster.redis.id
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = local.common_tags
}

resource "aws_cloudwatch_metric_alarm" "agent_redis_connections_high" {
  alarm_name          = "${local.name_prefix}-agent-redis-connections-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "CurrConnections"
  namespace           = "AWS/ElastiCache"
  period              = 300
  statistic           = "Average"
  threshold           = 500
  alarm_description   = "Agent Redis connections > 500 — connection pool exhaustion risk"

  dimensions = {
    CacheClusterId = aws_elasticache_cluster.redis.id
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = local.common_tags
}

# =============================================================================
# Agent Budget Business-Logic Alarms (S1-T3: Bridgebuilder Finding #5)
# These alarm on financial correctness — the most expensive silent failures.
# =============================================================================

# Budget overspend: core invariant violation (committed + reserved > limit)
resource "aws_cloudwatch_metric_alarm" "agent_budget_overspend" {
  alarm_name          = "${local.name_prefix}-agent-budget-overspend"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "agent_budget_overspend_cents"
  namespace           = "${local.name_prefix}/agent"
  period              = 300
  statistic           = "Maximum"
  threshold           = 0
  alarm_description   = "Budget overspend detected — committed+reserved exceeds limit for a community"
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alerts.arn]

  tags = merge(local.common_tags, {
    Service  = "AgentGateway"
    Severity = "critical"
  })
}

# Stream reconciliation failures — budget may be silently leaking
resource "aws_cloudwatch_metric_alarm" "agent_reconciliation_failures" {
  alarm_name          = "${local.name_prefix}-agent-reconciliation-failures"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "agent_reconciliation_errors_total"
  namespace           = "${local.name_prefix}/agent"
  period              = 300
  statistic           = "Sum"
  threshold           = 5
  alarm_description   = "Stream reconciliation failures > 5 in 10 minutes — dropped streams not being recovered"
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alerts.arn]

  tags = merge(local.common_tags, {
    Service  = "AgentGateway"
    Severity = "high"
  })
}

# Accounting drift — reserved counter went negative (double-decrement race)
resource "aws_cloudwatch_metric_alarm" "agent_accounting_drift" {
  alarm_name          = "${local.name_prefix}-agent-accounting-drift"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "agent_accounting_drift_cents"
  namespace           = "${local.name_prefix}/agent"
  period              = 300
  statistic           = "Sum"
  threshold           = 0
  alarm_description   = "Accounting drift detected — reserved counter went negative (finalize/reaper race)"
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alerts.arn]

  tags = merge(local.common_tags, {
    Service  = "AgentGateway"
    Severity = "high"
  })
}

# Budget reaper failures — expired reservations not being cleaned up
resource "aws_cloudwatch_metric_alarm" "agent_reaper_failures" {
  alarm_name          = "${local.name_prefix}-agent-reaper-failures"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "agent_reaper_errors_total"
  namespace           = "${local.name_prefix}/agent"
  period              = 300
  statistic           = "Sum"
  threshold           = 3
  alarm_description   = "Budget reaper errors > 3 in 5 minutes — reservations accumulating"
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alerts.arn]

  tags = merge(local.common_tags, {
    Service  = "AgentGateway"
    Severity = "high"
  })
}

resource "aws_cloudwatch_metric_alarm" "agent_redis_evictions" {
  alarm_name          = "${local.name_prefix}-agent-redis-evictions"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Evictions"
  namespace           = "AWS/ElastiCache"
  period              = 300
  statistic           = "Sum"
  threshold           = 0
  alarm_description   = "Agent Redis evictions detected — budget keys may be lost"

  dimensions = {
    CacheClusterId = aws_elasticache_cluster.redis.id
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = local.common_tags
}

# =============================================================================
# Application-Level Log Metric Filters (Sprint 373 — Four Golden Signals)
# =============================================================================
# Defense-in-depth: extract metrics from log streams as leading indicators.
# These complement the app-emitted metrics in Arrakis/Auth and Arrakis/Billing.

# 1. JWT Validation Failure Rate (auth chain health)
resource "aws_cloudwatch_log_metric_filter" "jwt_validation_failed" {
  name           = "${local.name_prefix}-jwt-validation-failed"
  pattern        = "JWT_VALIDATION_FAILED"
  log_group_name = aws_cloudwatch_log_group.api.name

  metric_transformation {
    name          = "JwtValidationFailedCount"
    namespace     = "${local.name_prefix}/AppMetrics"
    value         = "1"
    default_value = "0"
  }
}

# 2. Budget Conservation Violation (financial invariant breach)
resource "aws_cloudwatch_log_metric_filter" "conservation_violation" {
  name           = "${local.name_prefix}-conservation-violation"
  pattern        = "?CONSERVATION_VIOLATION ?budget_exceeded ?\"committed + reserved\""
  log_group_name = aws_cloudwatch_log_group.api.name

  metric_transformation {
    name          = "ConservationViolationCount"
    namespace     = "${local.name_prefix}/AppMetrics"
    value         = "1"
    default_value = "0"
  }
}

# 3. Cross-Service Latency (freeside → finn invoke duration)
# Space-delimited format: "INVOKE_COMPLETE ... duration_ms=1234"
resource "aws_cloudwatch_log_metric_filter" "invoke_latency" {
  name           = "${local.name_prefix}-invoke-latency"
  pattern        = "[..., duration_ms]"
  log_group_name = aws_cloudwatch_log_group.api.name

  metric_transformation {
    name          = "InvokeLatencyMs"
    namespace     = "${local.name_prefix}/AppMetrics"
    value         = "$duration_ms"
    default_value = "0"
  }
}

# 3b. Cross-Service Latency — JSON format fallback (low-1)
# JSON format: {"event":"INVOKE_COMPLETE","duration_ms":1234}
# Both filters write to the same metric — only one will match depending on log format
resource "aws_cloudwatch_log_metric_filter" "invoke_latency_json" {
  name           = "${local.name_prefix}-invoke-latency-json"
  pattern        = "{ $.duration_ms = * }"
  log_group_name = aws_cloudwatch_log_group.api.name

  metric_transformation {
    name          = "InvokeLatencyMs"
    namespace     = "${local.name_prefix}/AppMetrics"
    value         = "$.duration_ms"
    default_value = "0"
  }
}

# 4. Reputation Query Latency (finn → dixie)
# Space-delimited format: "REPUTATION_QUERY ... reputation_duration_ms=567"
resource "aws_cloudwatch_log_metric_filter" "reputation_latency" {
  name           = "${local.name_prefix}-reputation-latency"
  pattern        = "[..., reputation_duration_ms]"
  log_group_name = aws_cloudwatch_log_group.finn.name

  metric_transformation {
    name          = "ReputationQueryLatencyMs"
    namespace     = "${local.name_prefix}/AppMetrics"
    value         = "$reputation_duration_ms"
    default_value = "0"
  }
}

# 4b. Reputation Query Latency — JSON format fallback (low-1)
# JSON format: {"event":"REPUTATION_QUERY","reputation_duration_ms":567}
resource "aws_cloudwatch_log_metric_filter" "reputation_latency_json" {
  name           = "${local.name_prefix}-reputation-latency-json"
  pattern        = "{ $.reputation_duration_ms = * }"
  log_group_name = aws_cloudwatch_log_group.finn.name

  metric_transformation {
    name          = "ReputationQueryLatencyMs"
    namespace     = "${local.name_prefix}/AppMetrics"
    value         = "$.reputation_duration_ms"
    default_value = "0"
  }
}

# Alarm: JWT validation failures from log metric filter (>5 in 5min)
resource "aws_cloudwatch_metric_alarm" "jwt_log_validation_failures" {
  alarm_name          = "${local.name_prefix}-jwt-log-validation-failures"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "JwtValidationFailedCount"
  namespace           = "${local.name_prefix}/AppMetrics"
  period              = 300
  statistic           = "Sum"
  threshold           = 5
  alarm_description   = "POTENTIAL KEY COMPROMISE: JWT validation failures exceeding threshold (>5 in 5min). Investigate: check CloudWatch logs for JWT_VALIDATION_FAILED events in /ecs/${local.name_prefix}/api. If compromise confirmed: ./scripts/revoke-staging-key.sh --service <service>"
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alerts.arn]

  tags = merge(local.common_tags, {
    Service  = "Auth"
    Severity = "critical"
    Sprint   = "373-Task-3.1"
  })
}

# Alarm: Conservation violation — any occurrence is critical
resource "aws_cloudwatch_metric_alarm" "conservation_log_violation" {
  alarm_name          = "${local.name_prefix}-conservation-log-violation"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "ConservationViolationCount"
  namespace           = "${local.name_prefix}/AppMetrics"
  period              = 300
  statistic           = "Sum"
  threshold           = 0
  alarm_description   = "CONSERVATION VIOLATION: Budget invariant breached (committed + reserved > monthlyBudgetCents). Immediate investigation required."
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alerts.arn]

  tags = merge(local.common_tags, {
    Service  = "Billing"
    Severity = "critical"
    Sprint   = "373-Task-3.1"
  })
}

# SNS Topic for alerts
resource "aws_sns_topic" "alerts" {
  name              = "${local.name_prefix}-alerts"
  kms_master_key_id = "alias/aws/sns"

  tags = local.common_tags
}

# CloudWatch Dashboard
resource "aws_cloudwatch_dashboard" "main" {
  dashboard_name = "${local.name_prefix}-overview"

  dashboard_body = jsonencode({
    widgets = [
      {
        type   = "metric"
        x      = 0
        y      = 0
        width  = 12
        height = 6
        properties = {
          title  = "ECS API Service"
          region = var.aws_region
          metrics = [
            ["AWS/ECS", "CPUUtilization", "ClusterName", aws_ecs_cluster.main.name, "ServiceName", aws_ecs_service.api.name],
            [".", "MemoryUtilization", ".", ".", ".", "."]
          ]
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 0
        width  = 12
        height = 6
        properties = {
          title  = "RDS PostgreSQL"
          region = var.aws_region
          metrics = [
            ["AWS/RDS", "CPUUtilization", "DBInstanceIdentifier", aws_db_instance.main.id],
            [".", "DatabaseConnections", ".", "."],
            [".", "FreeStorageSpace", ".", "."]
          ]
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 6
        width  = 12
        height = 6
        properties = {
          title  = "ALB Requests"
          region = var.aws_region
          metrics = [
            ["AWS/ApplicationELB", "RequestCount", "LoadBalancer", aws_lb.main.arn_suffix],
            [".", "HTTPCode_Target_2XX_Count", ".", "."],
            [".", "HTTPCode_Target_5XX_Count", ".", "."]
          ]
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 6
        width  = 12
        height = 6
        properties = {
          title  = "Redis ElastiCache"
          region = var.aws_region
          metrics = [
            ["AWS/ElastiCache", "CPUUtilization", "ReplicationGroupId", aws_elasticache_replication_group.main.id],
            [".", "DatabaseMemoryUsagePercentage", ".", "."],
            [".", "CurrConnections", ".", "."]
          ]
        }
      }
    ]
  })
}

# =============================================================================
# Gateway Proxy Monitoring Dashboard
# =============================================================================
# Dedicated dashboard for Gateway Proxy pattern monitoring per SDD Section 8.1

resource "aws_cloudwatch_dashboard" "gateway_proxy" {
  dashboard_name = "${local.name_prefix}-gateway-proxy"

  dashboard_body = jsonencode({
    widgets = [
      # Row 0: Header text widget
      {
        type   = "text"
        x      = 0
        y      = 0
        width  = 24
        height = 1
        properties = {
          markdown = "# Gateway Proxy Pattern - Operational Dashboard\n**Flow:** Discord Gateway → Ingestor → RabbitMQ → Worker → Discord REST"
        }
      },

      # Row 1: Ingestor Service Metrics
      {
        type   = "metric"
        x      = 0
        y      = 1
        width  = 8
        height = 6
        properties = {
          title  = "🎧 Ingestor - Resource Usage"
          region = var.aws_region
          stat   = "Average"
          period = 60
          metrics = [
            ["AWS/ECS", "CPUUtilization", "ClusterName", aws_ecs_cluster.main.name, "ServiceName", aws_ecs_service.ingestor.name, { label = "CPU %" }],
            [".", "MemoryUtilization", ".", ".", ".", ".", { label = "Memory %" }]
          ]
          yAxis = {
            left = { min = 0, max = 100 }
          }
        }
      },
      {
        type   = "metric"
        x      = 8
        y      = 1
        width  = 8
        height = 6
        properties = {
          title  = "🐰 RabbitMQ - Queue Depth"
          region = var.aws_region
          stat   = "Average"
          period = 60
          metrics = [
            ["AWS/AmazonMQ", "MessageCount", "Broker", aws_mq_broker.rabbitmq.broker_name, "Queue", "arrakis.interactions", { label = "Interactions Queue" }],
            [".", ".", ".", ".", ".", "arrakis.events.guild", { label = "Events Queue" }],
            [".", ".", ".", ".", ".", "arrakis.dlq", { label = "Dead Letter Queue", color = "#d62728" }]
          ]
          yAxis = {
            left = { min = 0 }
          }
        }
      },
      {
        type   = "metric"
        x      = 16
        y      = 1
        width  = 8
        height = 6
        properties = {
          title  = "⚙️ Worker - Resource Usage"
          region = var.aws_region
          stat   = "Average"
          period = 60
          metrics = [
            ["AWS/ECS", "CPUUtilization", "ClusterName", aws_ecs_cluster.main.name, "ServiceName", aws_ecs_service.gp_worker.name, { label = "CPU %" }],
            [".", "MemoryUtilization", ".", ".", ".", ".", { label = "Memory %" }]
          ]
          yAxis = {
            left = { min = 0, max = 100 }
          }
        }
      },

      # Row 2: RabbitMQ Broker Metrics
      {
        type   = "metric"
        x      = 0
        y      = 7
        width  = 8
        height = 6
        properties = {
          title  = "🐰 RabbitMQ - Message Throughput"
          region = var.aws_region
          stat   = "Sum"
          period = 60
          metrics = [
            ["AWS/AmazonMQ", "PublishRate", "Broker", aws_mq_broker.rabbitmq.broker_name, { label = "Publish Rate/min" }],
            [".", "AckRate", ".", ".", { label = "Ack Rate/min" }]
          ]
        }
      },
      {
        type   = "metric"
        x      = 8
        y      = 7
        width  = 8
        height = 6
        properties = {
          title  = "🐰 RabbitMQ - Broker Health"
          region = var.aws_region
          stat   = "Average"
          period = 60
          metrics = [
            ["AWS/AmazonMQ", "SystemCpuUtilization", "Broker", aws_mq_broker.rabbitmq.broker_name, { label = "CPU %" }],
            [".", "RabbitMQMemUsed", ".", ".", { label = "Memory Used (bytes)" }],
            [".", "RabbitMQDiskFree", ".", ".", { label = "Disk Free (bytes)" }]
          ]
        }
      },
      {
        type   = "metric"
        x      = 16
        y      = 7
        width  = 8
        height = 6
        properties = {
          title  = "🐰 RabbitMQ - Connections"
          region = var.aws_region
          stat   = "Average"
          period = 60
          metrics = [
            ["AWS/AmazonMQ", "ConnectionCount", "Broker", aws_mq_broker.rabbitmq.broker_name, { label = "Total Connections" }],
            [".", "ChannelCount", ".", ".", { label = "Total Channels" }],
            [".", "ConsumerCount", ".", ".", { label = "Active Consumers" }]
          ]
        }
      },

      # Row 3: ECS Service Status
      {
        type   = "metric"
        x      = 0
        y      = 13
        width  = 8
        height = 6
        properties = {
          title  = "🎧 Ingestor - Running Tasks"
          region = var.aws_region
          stat   = "Average"
          period = 60
          metrics = [
            ["ECS/ContainerInsights", "RunningTaskCount", "ClusterName", aws_ecs_cluster.main.name, "ServiceName", aws_ecs_service.ingestor.name, { label = "Running Tasks" }],
            [".", "DesiredTaskCount", ".", ".", ".", ".", { label = "Desired Tasks", color = "#7f7f7f" }]
          ]
          annotations = {
            horizontal = [
              { value = 1, label = "Minimum", color = "#d62728" }
            ]
          }
        }
      },
      {
        type   = "metric"
        x      = 8
        y      = 13
        width  = 8
        height = 6
        properties = {
          title  = "⚙️ Worker - Running Tasks"
          region = var.aws_region
          stat   = "Average"
          period = 60
          metrics = [
            ["ECS/ContainerInsights", "RunningTaskCount", "ClusterName", aws_ecs_cluster.main.name, "ServiceName", aws_ecs_service.gp_worker.name, { label = "Running Tasks" }],
            [".", "DesiredTaskCount", ".", ".", ".", ".", { label = "Desired Tasks", color = "#7f7f7f" }]
          ]
          annotations = {
            horizontal = [
              { value = 1, label = "Minimum", color = "#d62728" }
            ]
          }
        }
      },
      {
        type   = "metric"
        x      = 16
        y      = 13
        width  = 8
        height = 6
        properties = {
          title  = "📊 Redis - Session State"
          region = var.aws_region
          stat   = "Average"
          period = 60
          metrics = [
            ["AWS/ElastiCache", "CurrConnections", "ReplicationGroupId", aws_elasticache_replication_group.main.id, { label = "Current Connections" }],
            [".", "CacheHitRate", ".", ".", { label = "Cache Hit Rate %" }],
            [".", "DatabaseMemoryUsagePercentage", ".", ".", { label = "Memory %" }]
          ]
        }
      },

      # Row 4: Latency and Error Metrics
      {
        type   = "metric"
        x      = 0
        y      = 19
        width  = 12
        height = 6
        properties = {
          title  = "⏱️ Gateway Proxy - Processing Latency (Custom Metrics)"
          region = var.aws_region
          stat   = "p99"
          period = 60
          view   = "timeSeries"
          metrics = [
            ["Arrakis/GatewayProxy", "IngestorLatencyMs", "Service", "Ingestor", { label = "Ingestor p99 (target <50ms)" }],
            [".", "WorkerLatencyMs", "Service", "Worker", { label = "Worker p99 (target <100ms)" }],
            [".", "QueueWaitTimeMs", "Service", "RabbitMQ", { label = "Queue Wait p99" }]
          ]
          annotations = {
            horizontal = [
              { value = 50, label = "Ingestor SLA", color = "#2ca02c" },
              { value = 100, label = "Worker SLA", color = "#ff7f0e" }
            ]
          }
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 19
        width  = 12
        height = 6
        properties = {
          title  = "❌ Gateway Proxy - Error Rates (Custom Metrics)"
          region = var.aws_region
          stat   = "Sum"
          period = 60
          metrics = [
            ["Arrakis/GatewayProxy", "MessagesProcessed", "Service", "Worker", { label = "Messages Processed" }],
            [".", "ProcessingErrors", "Service", "Worker", { label = "Processing Errors", color = "#d62728" }],
            [".", "DLQMessages", "Service", "Worker", { label = "DLQ Messages", color = "#9467bd" }]
          ]
        }
      }
    ]
  })
}

# =============================================================================
# Gateway Proxy CloudWatch Alarms
# =============================================================================

# Ingestor CPU High
resource "aws_cloudwatch_metric_alarm" "ingestor_cpu_high" {
  alarm_name          = "${local.name_prefix}-ingestor-cpu-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "CPUUtilization"
  namespace           = "AWS/ECS"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  alarm_description   = "Ingestor CPU utilization > 80% - may need scaling"

  dimensions = {
    ClusterName = aws_ecs_cluster.main.name
    ServiceName = aws_ecs_service.ingestor.name
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = merge(local.common_tags, {
    Service = "GatewayProxy"
  })
}

# Ingestor Memory High (critical - memory leak detection)
resource "aws_cloudwatch_metric_alarm" "ingestor_memory_high" {
  alarm_name          = "${local.name_prefix}-ingestor-memory-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "MemoryUtilization"
  namespace           = "AWS/ECS"
  period              = 300
  statistic           = "Average"
  threshold           = 85
  alarm_description   = "Ingestor memory > 85% - potential memory leak"

  dimensions = {
    ClusterName = aws_ecs_cluster.main.name
    ServiceName = aws_ecs_service.ingestor.name
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = merge(local.common_tags, {
    Service = "GatewayProxy"
  })
}

# Worker CPU High
resource "aws_cloudwatch_metric_alarm" "gp_worker_cpu_high" {
  alarm_name          = "${local.name_prefix}-gp-worker-cpu-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "CPUUtilization"
  namespace           = "AWS/ECS"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  alarm_description   = "Gateway Proxy Worker CPU > 80% - may need scaling"

  dimensions = {
    ClusterName = aws_ecs_cluster.main.name
    ServiceName = aws_ecs_service.gp_worker.name
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = merge(local.common_tags, {
    Service = "GatewayProxy"
  })
}

# Worker Memory High
resource "aws_cloudwatch_metric_alarm" "gp_worker_memory_high" {
  alarm_name          = "${local.name_prefix}-gp-worker-memory-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "MemoryUtilization"
  namespace           = "AWS/ECS"
  period              = 300
  statistic           = "Average"
  threshold           = 85
  alarm_description   = "Gateway Proxy Worker memory > 85%"

  dimensions = {
    ClusterName = aws_ecs_cluster.main.name
    ServiceName = aws_ecs_service.gp_worker.name
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = merge(local.common_tags, {
    Service = "GatewayProxy"
  })
}

# RabbitMQ Queue Depth - Interactions (priority queue)
resource "aws_cloudwatch_metric_alarm" "rabbitmq_interactions_queue_high" {
  alarm_name          = "${local.name_prefix}-rabbitmq-interactions-queue-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "MessageCount"
  namespace           = "AWS/AmazonMQ"
  period              = 60
  statistic           = "Average"
  threshold           = 100
  alarm_description   = "RabbitMQ interactions queue depth > 100 - Workers may be falling behind"
  treat_missing_data  = "notBreaching"

  dimensions = {
    Broker = aws_mq_broker.rabbitmq.broker_name
    Queue  = "arrakis.interactions"
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = merge(local.common_tags, {
    Service = "GatewayProxy"
  })
}

# RabbitMQ DLQ Messages (any messages here is concerning)
resource "aws_cloudwatch_metric_alarm" "rabbitmq_dlq_messages" {
  alarm_name          = "${local.name_prefix}-rabbitmq-dlq-messages"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "MessageCount"
  namespace           = "AWS/AmazonMQ"
  period              = 300
  statistic           = "Average"
  threshold           = 0
  alarm_description   = "Messages in Dead Letter Queue - requires investigation"
  treat_missing_data  = "notBreaching"

  dimensions = {
    Broker = aws_mq_broker.rabbitmq.broker_name
    Queue  = "arrakis.dlq"
  }

  alarm_actions = [aws_sns_topic.alerts.arn]

  tags = merge(local.common_tags, {
    Service = "GatewayProxy"
  })
}

# Ingestor Task Count (ensure at least 1 running)
resource "aws_cloudwatch_metric_alarm" "ingestor_no_tasks" {
  alarm_name          = "${local.name_prefix}-ingestor-no-tasks"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 1
  metric_name         = "RunningTaskCount"
  namespace           = "ECS/ContainerInsights"
  period              = 60
  statistic           = "Average"
  threshold           = 1
  alarm_description   = "CRITICAL: No Ingestor tasks running - Discord events not being captured"
  treat_missing_data  = "breaching"

  dimensions = {
    ClusterName = aws_ecs_cluster.main.name
    ServiceName = aws_ecs_service.ingestor.name
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = merge(local.common_tags, {
    Service = "GatewayProxy"
  })
}

# Worker Task Count (ensure at least 1 running)
resource "aws_cloudwatch_metric_alarm" "gp_worker_no_tasks" {
  alarm_name          = "${local.name_prefix}-gp-worker-no-tasks"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 1
  metric_name         = "RunningTaskCount"
  namespace           = "ECS/ContainerInsights"
  period              = 60
  statistic           = "Average"
  threshold           = 1
  alarm_description   = "CRITICAL: No Worker tasks running - queue messages not being processed"
  treat_missing_data  = "breaching"

  dimensions = {
    ClusterName = aws_ecs_cluster.main.name
    ServiceName = aws_ecs_service.gp_worker.name
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = merge(local.common_tags, {
    Service = "GatewayProxy"
  })
}

# =============================================================================
# Discord Server Sandbox CloudWatch Alarms
# Sprint 87: Cleanup & Polish
# =============================================================================

# Sandbox Cleanup Job Failures
resource "aws_cloudwatch_metric_alarm" "sandbox_cleanup_failures" {
  alarm_name          = "${local.name_prefix}-sandbox-cleanup-failures"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "CleanupFailures"
  namespace           = "Arrakis/Sandbox"
  period              = 900 # 15 minutes (cleanup job interval)
  statistic           = "Sum"
  threshold           = 0
  alarm_description   = "Sandbox cleanup job has failures - sandboxes may not be properly cleaned up"
  treat_missing_data  = "notBreaching"

  dimensions = {
    Environment = var.environment
  }

  alarm_actions = [aws_sns_topic.alerts.arn]

  tags = merge(local.common_tags, {
    Service = "Sandbox"
  })
}

# Sandbox Orphaned Resources Detected
resource "aws_cloudwatch_metric_alarm" "sandbox_orphaned_resources" {
  alarm_name          = "${local.name_prefix}-sandbox-orphaned-resources"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 4 # 4 cleanup cycles (1 hour)
  metric_name         = "OrphanedResourceCount"
  namespace           = "Arrakis/Sandbox"
  period              = 900 # 15 minutes
  statistic           = "Maximum"
  threshold           = 5
  alarm_description   = "Sandbox orphaned resources > 5 for 1 hour - manual cleanup may be required"
  treat_missing_data  = "notBreaching"

  dimensions = {
    Environment = var.environment
  }

  alarm_actions = [aws_sns_topic.alerts.arn]

  tags = merge(local.common_tags, {
    Service = "Sandbox"
  })
}

# Sandbox Schema Creation Failures
resource "aws_cloudwatch_metric_alarm" "sandbox_schema_failures" {
  alarm_name          = "${local.name_prefix}-sandbox-schema-failures"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "SchemaCreationErrors"
  namespace           = "Arrakis/Sandbox"
  period              = 300 # 5 minutes
  statistic           = "Sum"
  threshold           = 3
  alarm_description   = "Multiple sandbox schema creation failures - PostgreSQL may have issues"
  treat_missing_data  = "notBreaching"

  dimensions = {
    Environment = var.environment
  }

  alarm_actions = [aws_sns_topic.alerts.arn]

  tags = merge(local.common_tags, {
    Service = "Sandbox"
  })
}

# Sandbox Event Routing Errors (high rate)
resource "aws_cloudwatch_metric_alarm" "sandbox_routing_errors" {
  alarm_name          = "${local.name_prefix}-sandbox-routing-errors"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "EventRoutingErrors"
  namespace           = "Arrakis/Sandbox"
  period              = 300 # 5 minutes
  statistic           = "Sum"
  threshold           = 50
  alarm_description   = "High sandbox event routing error rate - events may not be reaching sandboxes"
  treat_missing_data  = "notBreaching"

  dimensions = {
    Environment = var.environment
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = merge(local.common_tags, {
    Service = "Sandbox"
  })
}

# Sandbox Active Count Too High (resource exhaustion prevention)
resource "aws_cloudwatch_metric_alarm" "sandbox_count_high" {
  alarm_name          = "${local.name_prefix}-sandbox-count-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "ActiveSandboxCount"
  namespace           = "Arrakis/Sandbox"
  period              = 300 # 5 minutes
  statistic           = "Maximum"
  threshold           = 100 # Alert if > 100 active sandboxes
  alarm_description   = "High number of active sandboxes - may impact database performance"
  treat_missing_data  = "notBreaching"

  dimensions = {
    Environment = var.environment
  }

  alarm_actions = [aws_sns_topic.alerts.arn]

  tags = merge(local.common_tags, {
    Service = "Sandbox"
  })
}

# =============================================================================
# Sandbox CloudWatch Dashboard
# Sprint 87: Cleanup & Polish
# =============================================================================

resource "aws_cloudwatch_dashboard" "sandbox" {
  dashboard_name = "${local.name_prefix}-sandbox"

  dashboard_body = jsonencode({
    widgets = [
      # Row 0: Header
      {
        type   = "text"
        x      = 0
        y      = 0
        width  = 24
        height = 1
        properties = {
          markdown = "# Discord Server Sandboxes - Operational Dashboard\n**Purpose:** Isolated testing environments for Discord bot functionality"
        }
      },

      # Row 1: Sandbox Lifecycle
      {
        type   = "metric"
        x      = 0
        y      = 1
        width  = 8
        height = 6
        properties = {
          title  = "Active Sandboxes"
          region = var.aws_region
          stat   = "Average"
          period = 60
          metrics = [
            ["Arrakis/Sandbox", "ActiveSandboxCount", "Environment", var.environment, { label = "Active Sandboxes" }]
          ]
        }
      },
      {
        type   = "metric"
        x      = 8
        y      = 1
        width  = 8
        height = 6
        properties = {
          title  = "Sandbox Lifecycle"
          region = var.aws_region
          stat   = "Sum"
          period = 300
          metrics = [
            ["Arrakis/Sandbox", "SandboxesCreated", "Environment", var.environment, { label = "Created", color = "#2ca02c" }],
            [".", "SandboxesDestroyed", ".", ".", { label = "Destroyed", color = "#d62728" }]
          ]
        }
      },
      {
        type   = "metric"
        x      = 16
        y      = 1
        width  = 8
        height = 6
        properties = {
          title  = "Guild Mappings"
          region = var.aws_region
          stat   = "Average"
          period = 60
          metrics = [
            ["Arrakis/Sandbox", "GuildMappingCount", "Environment", var.environment, { label = "Active Mappings" }]
          ]
        }
      },

      # Row 2: Cleanup Metrics
      {
        type   = "metric"
        x      = 0
        y      = 7
        width  = 8
        height = 6
        properties = {
          title  = "Cleanup Job"
          region = var.aws_region
          stat   = "Sum"
          period = 900
          metrics = [
            ["Arrakis/Sandbox", "SandboxesCleanedUp", "Environment", var.environment, { label = "Sandboxes Cleaned" }],
            [".", "CleanupFailures", ".", ".", { label = "Cleanup Failures", color = "#d62728" }]
          ]
        }
      },
      {
        type   = "metric"
        x      = 8
        y      = 7
        width  = 8
        height = 6
        properties = {
          title  = "Cleanup Duration"
          region = var.aws_region
          stat   = "Average"
          period = 900
          metrics = [
            ["Arrakis/Sandbox", "CleanupDurationMs", "Environment", var.environment, { label = "Duration (ms)" }]
          ]
        }
      },
      {
        type   = "metric"
        x      = 16
        y      = 7
        width  = 8
        height = 6
        properties = {
          title  = "Orphaned Resources"
          region = var.aws_region
          stat   = "Maximum"
          period = 900
          metrics = [
            ["Arrakis/Sandbox", "OrphanedSchemas", "Environment", var.environment, { label = "Orphaned Schemas" }],
            [".", "OrphanedRedisKeys", ".", ".", { label = "Orphaned Redis Keys" }]
          ]
        }
      },

      # Row 3: Event Routing
      {
        type   = "metric"
        x      = 0
        y      = 13
        width  = 12
        height = 6
        properties = {
          title  = "Event Routing"
          region = var.aws_region
          stat   = "Sum"
          period = 60
          metrics = [
            ["Arrakis/Sandbox", "EventsRoutedToSandbox", "Environment", var.environment, { label = "To Sandbox" }],
            [".", "EventsRoutedToProduction", ".", ".", { label = "To Production" }],
            [".", "EventRoutingErrors", ".", ".", { label = "Errors", color = "#d62728" }]
          ]
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 13
        width  = 12
        height = 6
        properties = {
          title  = "Route Lookup Performance"
          region = var.aws_region
          stat   = "Average"
          period = 60
          metrics = [
            ["Arrakis/Sandbox", "RouteLookupDurationMs", "Environment", var.environment, { label = "Lookup Duration (ms)" }],
            [".", "CacheHitRate", ".", ".", { label = "Cache Hit Rate %" }]
          ]
        }
      }
    ]
  })
}

# Sprint 7 (320), Task 7.1: Unified Service Health Dashboard
resource "aws_cloudwatch_dashboard" "service_health" {
  dashboard_name = "${local.name_prefix}-service-health"

  dashboard_body = jsonencode({
    widgets = [
      # Row 1: Inference Latency by Pool (p50, p95, p99)
      {
        type   = "metric"
        x      = 0
        y      = 0
        width  = 24
        height = 6
        properties = {
          title  = "Inference Latency by Pool"
          region = var.aws_region
          period = 60
          view   = "timeSeries"
          metrics = [
            ["Arrakis/Agent", "InferenceLatencyMs", "Pool", "cheap", "Environment", var.environment, { stat = "p50", label = "cheap p50" }],
            ["...", { stat = "p95", label = "cheap p95" }],
            ["...", { stat = "p99", label = "cheap p99", color = "#d62728" }],
            ["Arrakis/Agent", "InferenceLatencyMs", "Pool", "reasoning", "Environment", var.environment, { stat = "p50", label = "reasoning p50" }],
            ["...", { stat = "p95", label = "reasoning p95" }],
            ["...", { stat = "p99", label = "reasoning p99", color = "#ff7f0e" }],
            ["Arrakis/Agent", "InferenceLatencyMs", "Pool", "architect", "Environment", var.environment, { stat = "p50", label = "architect p50" }],
            ["...", { stat = "p95", label = "architect p95" }],
            ["...", { stat = "p99", label = "architect p99", color = "#9467bd" }]
          ]
        }
      },
      # Row 2: HTTP Error Rates + Request Count
      {
        type   = "metric"
        x      = 0
        y      = 6
        width  = 12
        height = 6
        properties = {
          title  = "HTTP Error Rates"
          region = var.aws_region
          stat   = "Sum"
          period = 60
          metrics = [
            ["Arrakis/API", "Http4xxCount", "Environment", var.environment, { label = "4xx", color = "#ff7f0e" }],
            [".", "Http5xxCount", ".", ".", { label = "5xx", color = "#d62728" }]
          ]
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 6
        width  = 12
        height = 6
        properties = {
          title  = "Request Count"
          region = var.aws_region
          stat   = "Sum"
          period = 60
          metrics = [
            ["Arrakis/API", "RequestCount", "Environment", var.environment, { label = "Total Requests" }],
            [".", "RequestCount", "Service", "inference", "Environment", var.environment, { label = "Inference" }],
            [".", "RequestCount", "Service", "webhook", ".", ".", { label = "Webhooks" }]
          ]
        }
      },
      # Row 3: Billing Flow
      {
        type   = "metric"
        x      = 0
        y      = 12
        width  = 12
        height = 6
        properties = {
          title  = "Billing Flow — Payments"
          region = var.aws_region
          stat   = "Sum"
          period = 60
          metrics = [
            ["Arrakis/Billing", "PaymentCreated", "Environment", var.environment, { label = "Created", color = "#2ca02c" }],
            [".", "PaymentFinished", ".", ".", { label = "Finished", color = "#1f77b4" }],
            [".", "PaymentFailed", ".", ".", { label = "Failed", color = "#d62728" }]
          ]
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 12
        width  = 12
        height = 6
        properties = {
          title  = "Billing Flow — Credits"
          region = var.aws_region
          stat   = "Sum"
          period = 60
          metrics = [
            ["Arrakis/Billing", "CreditsMinted", "Environment", var.environment, { label = "Credits Minted", color = "#2ca02c" }],
            [".", "CreditsSpent", ".", ".", { label = "Credits Spent", color = "#ff7f0e" }],
            [".", "CreditsMintedValue", ".", ".", { label = "Mint Value ($)", color = "#9467bd" }]
          ]
        }
      },
      # Row 4: Webhook Processing
      {
        type   = "metric"
        x      = 0
        y      = 18
        width  = 12
        height = 6
        properties = {
          title  = "Webhook Processing"
          region = var.aws_region
          stat   = "Sum"
          period = 60
          metrics = [
            ["Arrakis/Webhook", "WebhookReceived", "Environment", var.environment, { label = "Received" }],
            [".", "WebhookProcessed", ".", ".", { label = "Processed", color = "#2ca02c" }],
            [".", "WebhookRejected", ".", ".", { label = "Rejected", color = "#d62728" }],
            [".", "WebhookThrottled", ".", ".", { label = "Throttled", color = "#ff7f0e" }]
          ]
        }
      },
      # Row 4 (right): Auth Failures + Sessions
      {
        type   = "metric"
        x      = 12
        y      = 18
        width  = 12
        height = 6
        properties = {
          title  = "Auth Failures & Sessions"
          region = var.aws_region
          stat   = "Sum"
          period = 60
          metrics = [
            ["Arrakis/Auth", "JwtValidationFailure", "Environment", var.environment, { label = "JWT Failure", color = "#d62728" }],
            [".", "ApiKeyFailure", ".", ".", { label = "API Key Failure", color = "#ff7f0e" }],
            [".", "SiweFailure", ".", ".", { label = "SIWE Failure", color = "#9467bd" }],
            [".", "SiweSessionCreated", ".", ".", { label = "SIWE Sessions", color = "#2ca02c" }]
          ]
        }
      },
      # Row 5: Conservation Guard
      {
        type   = "metric"
        x      = 0
        y      = 24
        width  = 12
        height = 6
        properties = {
          title  = "Conservation Guard"
          region = var.aws_region
          stat   = "Sum"
          period = 60
          metrics = [
            ["Arrakis/Billing", "ConservationCheckPassed", "Environment", var.environment, { label = "Checks Passed", color = "#2ca02c" }],
            [".", "ConservationCheckFailed", ".", ".", { label = "Checks Failed", color = "#d62728" }],
            [".", "ConservationDriftPercent", ".", ".", { stat = "Maximum", label = "Budget Drift %", color = "#ff7f0e" }]
          ]
        }
      },
      # Row 5 (right): WebSocket Connections
      {
        type   = "metric"
        x      = 12
        y      = 24
        width  = 12
        height = 6
        properties = {
          title  = "WebSocket Connections"
          region = var.aws_region
          period = 60
          metrics = [
            ["Arrakis/WebSocket", "ActiveConnections", "Environment", var.environment, { stat = "Maximum", label = "Active Connections" }],
            [".", "UniqueUsers", ".", ".", { stat = "Maximum", label = "Unique Users", color = "#1f77b4" }],
            [".", "MessagesReceived", ".", ".", { stat = "Sum", label = "Messages Received", color = "#2ca02c" }]
          ]
        }
      }
    ]
  })

  tags = merge(local.common_tags, {
    Sprint = "320-Task-7.1"
  })
}

# =============================================================================
# Economic Health Dashboard — Conservation Invariant Observability
# Sprint 375, Task 2.1 (Constellation Review §V.2)
# =============================================================================
# "Proof of economic life made visible" — the economic equivalent of Netflix's
# traffic dashboard. Shows conservation invariant (committed + reserved + available = limit)
# in real time per community.

resource "aws_cloudwatch_dashboard" "economic_health" {
  dashboard_name = "${local.name_prefix}-economic-health"

  dashboard_body = jsonencode({
    widgets = [
      # Row 0: Header
      {
        type   = "text"
        x      = 0
        y      = 0
        width  = 24
        height = 1
        properties = {
          markdown = "# Economic Health Dashboard\n**Conservation Invariant:** committed + reserved + available = limit | **FAANG Parallel:** Stripe money-flow dashboard"
        }
      },

      # Row 1: Budget Utilization per Community
      {
        type   = "metric"
        x      = 0
        y      = 1
        width  = 12
        height = 6
        properties = {
          title  = "Budget Utilization — Committed vs Reserved vs Available"
          region = var.aws_region
          stat   = "Average"
          period = 60
          metrics = [
            ["${local.name_prefix}/agent", "budget_committed_cents", "Environment", var.environment, { label = "Committed (cents)" }],
            [".", "budget_reserved_cents", ".", ".", { label = "Reserved (cents)", color = "#ff7f0e" }],
            [".", "budget_available_cents", ".", ".", { label = "Available (cents)", color = "#2ca02c" }],
            [".", "budget_limit_cents", ".", ".", { label = "Limit (cents)", color = "#7f7f7f" }]
          ]
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 1
        width  = 12
        height = 6
        properties = {
          title  = "Budget Utilization %"
          region = var.aws_region
          stat   = "Average"
          period = 60
          view   = "gauge"
          metrics = [
            ["${local.name_prefix}/agent", "budget_utilization_percent", "Environment", var.environment, { label = "Utilization %" }]
          ]
          yAxis = {
            left = { min = 0, max = 100 }
          }
        }
      },

      # Row 2: Conservation Invariant Drift (I-3 Reconciliation)
      {
        type   = "metric"
        x      = 0
        y      = 7
        width  = 12
        height = 6
        properties = {
          title  = "Conservation Invariant Drift (I-3 Reconciliation)"
          region = var.aws_region
          period = 60
          metrics = [
            ["${local.name_prefix}/agent", "conservation_drift_cents", "Environment", var.environment, { stat = "Maximum", label = "Max Drift (cents)", color = "#d62728" }],
            [".", "reconciliation_sweep_count", ".", ".", { stat = "Sum", label = "Sweep Count", color = "#1f77b4" }],
            [".", "reconciliation_corrections", ".", ".", { stat = "Sum", label = "Corrections Applied", color = "#ff7f0e" }]
          ]
          annotations = {
            horizontal = [
              { value = 0, label = "Zero Drift (ideal)", color = "#2ca02c" }
            ]
          }
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 7
        width  = 12
        height = 6
        properties = {
          title  = "Conservation Guard — Pass/Fail Rate"
          region = var.aws_region
          stat   = "Sum"
          period = 60
          metrics = [
            ["Arrakis/Billing", "ConservationCheckPassed", "Environment", var.environment, { label = "Passed", color = "#2ca02c" }],
            [".", "ConservationCheckFailed", ".", ".", { label = "Failed", color = "#d62728" }]
          ]
        }
      },

      # Row 3: Invocation Cost Distribution
      {
        type   = "metric"
        x      = 0
        y      = 13
        width  = 12
        height = 6
        properties = {
          title  = "Invocation Cost Distribution by Pool (p50, p90, p99)"
          region = var.aws_region
          period = 300
          view   = "timeSeries"
          metrics = [
            ["${local.name_prefix}/agent", "invocation_cost_micro", "Pool", "cheap", "Environment", var.environment, { stat = "p50", label = "cheap p50" }],
            ["...", { stat = "p90", label = "cheap p90" }],
            ["...", { stat = "p99", label = "cheap p99", color = "#d62728" }],
            ["${local.name_prefix}/agent", "invocation_cost_micro", "Pool", "reasoning", "Environment", var.environment, { stat = "p50", label = "reasoning p50" }],
            ["...", { stat = "p90", label = "reasoning p90" }],
            ["...", { stat = "p99", label = "reasoning p99", color = "#ff7f0e" }]
          ]
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 13
        width  = 12
        height = 6
        properties = {
          title  = "Invocation Volume by Pool"
          region = var.aws_region
          stat   = "Sum"
          period = 60
          metrics = [
            ["${local.name_prefix}/agent", "invocation_count", "Pool", "cheap", "Environment", var.environment, { label = "cheap" }],
            [".", "invocation_count", "Pool", "fast-code", ".", ".", { label = "fast-code" }],
            [".", "invocation_count", "Pool", "reasoning", ".", ".", { label = "reasoning" }],
            [".", "invocation_count", "Pool", "architect", ".", ".", { label = "architect" }]
          ]
        }
      },

      # Row 4: Credit Lot Lifecycle
      {
        type   = "metric"
        x      = 0
        y      = 19
        width  = 12
        height = 6
        properties = {
          title  = "Credit Lot Lifecycle"
          region = var.aws_region
          stat   = "Sum"
          period = 300
          metrics = [
            ["Arrakis/Billing", "CreditsMinted", "Environment", var.environment, { label = "Lots Minted", color = "#2ca02c" }],
            [".", "CreditsSpent", ".", ".", { label = "Lots Debited", color = "#ff7f0e" }],
            [".", "LotsExhausted", ".", ".", { label = "Lots Exhausted", color = "#d62728" }]
          ]
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 19
        width  = 12
        height = 6
        properties = {
          title  = "Credit Lot Remaining Value"
          region = var.aws_region
          stat   = "Average"
          period = 300
          metrics = [
            ["Arrakis/Billing", "CreditLotRemainingCents", "Environment", var.environment, { label = "Avg Remaining (cents)" }],
            [".", "CreditLotTotalCents", ".", ".", { label = "Avg Total (cents)", color = "#7f7f7f" }]
          ]
        }
      }
    ]
  })

  tags = merge(local.common_tags, {
    Sprint = "375-Task-2.1"
  })
}

# =============================================================================
# Cross-Service Latency Alarm — p99 Invoke Path (Constellation Review §V.2c)
# Sprint 376, Task 3.4
# =============================================================================
# Completes Four Golden Signals coverage: latency alarm for the critical
# freeside -> finn invoke path. PRD G-3 requires <10s p95; we alarm at p99 > 10s.

resource "aws_cloudwatch_metric_alarm" "invoke_latency_p99" {
  alarm_name          = "${local.name_prefix}-invoke-latency-p99"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "InvokeLatencyMs"
  namespace           = "${local.name_prefix}/AppMetrics"
  period              = 300
  extended_statistic  = "p99"
  threshold           = 10000
  alarm_description   = <<-EOT
    INVOKE LATENCY P99 > 10s — critical cross-service path (freeside -> finn) is slow.
    Investigation steps:
    1. Check finn service health: ECS task count, CPU, memory
    2. Check model provider latency: CloudWatch Arrakis/Agent InferenceLatencyMs
    3. Check Redis latency: ElastiCache dashboard for budget operations
    4. Check network: Security group rules, Cloud Map DNS resolution
    5. If model provider: Consider pool fallback or circuit breaker activation
    PRD G-3 target: <10s p95. This alarm fires at p99 > 10s (more permissive).
  EOT
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = merge(local.common_tags, {
    Service  = "AgentGateway"
    Severity = "high"
    Sprint   = "376-Task-3.4"
  })
}

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

# SNS Topic for alerts
resource "aws_sns_topic" "alerts" {
  name = "${local.name_prefix}-alerts"

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

# =============================================================================
# ECS Service Auto Scaling Configuration (Sprint S-11)
# =============================================================================
# Implements automatic horizontal scaling for ECS services based on:
# - CPU utilization (Target Tracking)
# - Memory utilization (Target Tracking)
# - Queue depth (Step Scaling for Workers)
#
# Architecture:
#   API Service     -> Target Tracking (CPU 70%, min 2, max 10)
#   GP Worker       -> Target Tracking (CPU 70%) + Step Scaling (queue depth)
#   Ingestor        -> Static (1 per shard group, scaling handled by Discord sharding)
#   NATS            -> Static (3 for HA, cluster quorum requirements)
#   PgBouncer       -> Static (1, connection pooler)
#
# Reference: Sprint S-11 - Auto-Scaling Configuration

# =============================================================================
# Variables for Auto Scaling
# =============================================================================

variable "api_min_count" {
  description = "Minimum number of API tasks"
  type        = number
  default     = 2
}

variable "api_max_count" {
  description = "Maximum number of API tasks"
  type        = number
  default     = 10
}

variable "gp_worker_min_count" {
  description = "Minimum number of Gateway Proxy Worker tasks"
  type        = number
  default     = 1
}

variable "gp_worker_max_count" {
  description = "Maximum number of Gateway Proxy Worker tasks"
  type        = number
  default     = 10
}

variable "autoscaling_cpu_target" {
  description = "Target CPU utilization percentage for auto scaling"
  type        = number
  default     = 70
}

variable "autoscaling_memory_target" {
  description = "Target memory utilization percentage for auto scaling (optional)"
  type        = number
  default     = 80
}

variable "autoscaling_scale_in_cooldown" {
  description = "Cooldown period in seconds before scale-in (scale-down stabilization)"
  type        = number
  default     = 300 # 5 minutes
}

variable "autoscaling_scale_out_cooldown" {
  description = "Cooldown period in seconds before scale-out"
  type        = number
  default     = 60 # 1 minute for fast response
}

variable "queue_depth_scale_threshold" {
  description = "Queue depth threshold to trigger worker scaling"
  type        = number
  default     = 50
}

# =============================================================================
# API Service Auto Scaling
# =============================================================================

# Register API service with Application Auto Scaling
resource "aws_appautoscaling_target" "api" {
  max_capacity       = var.api_max_count
  min_capacity       = var.api_min_count
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.api.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"

  tags = merge(local.common_tags, {
    Name    = "${local.name_prefix}-api-autoscaling-target"
    Service = "API"
    Sprint  = "S-11"
  })
}

# API Target Tracking - CPU Utilization
resource "aws_appautoscaling_policy" "api_cpu" {
  name               = "${local.name_prefix}-api-cpu-scaling"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.api.resource_id
  scalable_dimension = aws_appautoscaling_target.api.scalable_dimension
  service_namespace  = aws_appautoscaling_target.api.service_namespace

  target_tracking_scaling_policy_configuration {
    target_value       = var.autoscaling_cpu_target
    scale_in_cooldown  = var.autoscaling_scale_in_cooldown
    scale_out_cooldown = var.autoscaling_scale_out_cooldown

    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
  }
}

# API Target Tracking - Memory Utilization (secondary metric)
resource "aws_appautoscaling_policy" "api_memory" {
  name               = "${local.name_prefix}-api-memory-scaling"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.api.resource_id
  scalable_dimension = aws_appautoscaling_target.api.scalable_dimension
  service_namespace  = aws_appautoscaling_target.api.service_namespace

  target_tracking_scaling_policy_configuration {
    target_value       = var.autoscaling_memory_target
    scale_in_cooldown  = var.autoscaling_scale_in_cooldown
    scale_out_cooldown = var.autoscaling_scale_out_cooldown

    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageMemoryUtilization"
    }
  }
}

# API Target Tracking - ALB Request Count Per Target
resource "aws_appautoscaling_policy" "api_alb_requests" {
  name               = "${local.name_prefix}-api-alb-request-scaling"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.api.resource_id
  scalable_dimension = aws_appautoscaling_target.api.scalable_dimension
  service_namespace  = aws_appautoscaling_target.api.service_namespace

  target_tracking_scaling_policy_configuration {
    target_value       = 1000 # Scale when >1000 requests per target
    scale_in_cooldown  = var.autoscaling_scale_in_cooldown
    scale_out_cooldown = var.autoscaling_scale_out_cooldown

    predefined_metric_specification {
      predefined_metric_type = "ALBRequestCountPerTarget"
      resource_label         = "${aws_lb.main.arn_suffix}/${aws_lb_target_group.api.arn_suffix}"
    }
  }
}

# =============================================================================
# Gateway Proxy Worker Auto Scaling
# =============================================================================

# Register GP Worker service with Application Auto Scaling
resource "aws_appautoscaling_target" "gp_worker" {
  max_capacity       = var.gp_worker_max_count
  min_capacity       = var.gp_worker_min_count
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.gp_worker.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"

  tags = merge(local.common_tags, {
    Name    = "${local.name_prefix}-gp-worker-autoscaling-target"
    Service = "GatewayProxy"
    Sprint  = "S-11"
  })
}

# GP Worker Target Tracking - CPU Utilization
resource "aws_appautoscaling_policy" "gp_worker_cpu" {
  name               = "${local.name_prefix}-gp-worker-cpu-scaling"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.gp_worker.resource_id
  scalable_dimension = aws_appautoscaling_target.gp_worker.scalable_dimension
  service_namespace  = aws_appautoscaling_target.gp_worker.service_namespace

  target_tracking_scaling_policy_configuration {
    target_value       = var.autoscaling_cpu_target
    scale_in_cooldown  = var.autoscaling_scale_in_cooldown
    scale_out_cooldown = var.autoscaling_scale_out_cooldown

    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
  }
}

# GP Worker Target Tracking - Memory Utilization
resource "aws_appautoscaling_policy" "gp_worker_memory" {
  name               = "${local.name_prefix}-gp-worker-memory-scaling"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.gp_worker.resource_id
  scalable_dimension = aws_appautoscaling_target.gp_worker.scalable_dimension
  service_namespace  = aws_appautoscaling_target.gp_worker.service_namespace

  target_tracking_scaling_policy_configuration {
    target_value       = var.autoscaling_memory_target
    scale_in_cooldown  = var.autoscaling_scale_in_cooldown
    scale_out_cooldown = var.autoscaling_scale_out_cooldown

    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageMemoryUtilization"
    }
  }
}

# =============================================================================
# Queue-Based Step Scaling for GP Worker
# =============================================================================
# Step scaling based on RabbitMQ queue depth for event-driven scaling

# Scale OUT policy (increase workers when queue depth is high)
resource "aws_appautoscaling_policy" "gp_worker_queue_scale_out" {
  name               = "${local.name_prefix}-gp-worker-queue-scale-out"
  policy_type        = "StepScaling"
  resource_id        = aws_appautoscaling_target.gp_worker.resource_id
  scalable_dimension = aws_appautoscaling_target.gp_worker.scalable_dimension
  service_namespace  = aws_appautoscaling_target.gp_worker.service_namespace

  step_scaling_policy_configuration {
    adjustment_type         = "ChangeInCapacity"
    cooldown                = var.autoscaling_scale_out_cooldown
    metric_aggregation_type = "Average"

    # Queue 50-100: Add 1 worker
    step_adjustment {
      metric_interval_lower_bound = 0
      metric_interval_upper_bound = 50
      scaling_adjustment          = 1
    }

    # Queue 100-200: Add 2 workers
    step_adjustment {
      metric_interval_lower_bound = 50
      metric_interval_upper_bound = 150
      scaling_adjustment          = 2
    }

    # Queue >200: Add 3 workers
    step_adjustment {
      metric_interval_lower_bound = 150
      scaling_adjustment          = 3
    }
  }
}

# Scale IN policy (decrease workers when queue depth is low)
resource "aws_appautoscaling_policy" "gp_worker_queue_scale_in" {
  name               = "${local.name_prefix}-gp-worker-queue-scale-in"
  policy_type        = "StepScaling"
  resource_id        = aws_appautoscaling_target.gp_worker.resource_id
  scalable_dimension = aws_appautoscaling_target.gp_worker.scalable_dimension
  service_namespace  = aws_appautoscaling_target.gp_worker.service_namespace

  step_scaling_policy_configuration {
    adjustment_type         = "ChangeInCapacity"
    cooldown                = var.autoscaling_scale_in_cooldown
    metric_aggregation_type = "Average"

    # Queue <10: Remove 1 worker (if above minimum)
    step_adjustment {
      metric_interval_upper_bound = 0
      scaling_adjustment          = -1
    }
  }
}

# CloudWatch Alarm for Queue Scale OUT
resource "aws_cloudwatch_metric_alarm" "gp_worker_queue_high" {
  alarm_name          = "${local.name_prefix}-gp-worker-queue-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "MessageCount"
  namespace           = "AWS/AmazonMQ"
  period              = 60
  statistic           = "Average"
  threshold           = var.queue_depth_scale_threshold
  alarm_description   = "RabbitMQ interactions queue depth exceeded ${var.queue_depth_scale_threshold} - scaling out workers"

  dimensions = {
    Broker = aws_mq_broker.rabbitmq.broker_name
    Queue  = "arrakis.interactions"
  }

  alarm_actions = [
    aws_appautoscaling_policy.gp_worker_queue_scale_out.arn,
    aws_sns_topic.alerts.arn
  ]

  tags = merge(local.common_tags, {
    Service = "GatewayProxy"
    Sprint  = "S-11"
  })
}

# CloudWatch Alarm for Queue Scale IN
resource "aws_cloudwatch_metric_alarm" "gp_worker_queue_low" {
  alarm_name          = "${local.name_prefix}-gp-worker-queue-low"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 5 # Longer evaluation for scale-in stability
  metric_name         = "MessageCount"
  namespace           = "AWS/AmazonMQ"
  period              = 60
  statistic           = "Average"
  threshold           = 10
  alarm_description   = "RabbitMQ interactions queue depth below 10 - scaling in workers"
  treat_missing_data  = "notBreaching"

  dimensions = {
    Broker = aws_mq_broker.rabbitmq.broker_name
    Queue  = "arrakis.interactions"
  }

  alarm_actions = [
    aws_appautoscaling_policy.gp_worker_queue_scale_in.arn
  ]

  tags = merge(local.common_tags, {
    Service = "GatewayProxy"
    Sprint  = "S-11"
  })
}

# =============================================================================
# Scheduled Scaling (Optional - for predictable traffic patterns)
# =============================================================================
# Uncomment if you have predictable peak hours

# # Scale up API during peak hours (e.g., 9 AM - 9 PM UTC)
# resource "aws_appautoscaling_scheduled_action" "api_scale_up" {
#   name               = "${local.name_prefix}-api-scheduled-scale-up"
#   service_namespace  = aws_appautoscaling_target.api.service_namespace
#   resource_id        = aws_appautoscaling_target.api.resource_id
#   scalable_dimension = aws_appautoscaling_target.api.scalable_dimension
#   schedule           = "cron(0 9 * * ? *)" # 9 AM UTC daily
#
#   scalable_target_action {
#     min_capacity = 3
#     max_capacity = 10
#   }
# }
#
# # Scale down API during off-peak hours (e.g., 9 PM - 9 AM UTC)
# resource "aws_appautoscaling_scheduled_action" "api_scale_down" {
#   name               = "${local.name_prefix}-api-scheduled-scale-down"
#   service_namespace  = aws_appautoscaling_target.api.service_namespace
#   resource_id        = aws_appautoscaling_target.api.resource_id
#   scalable_dimension = aws_appautoscaling_target.api.scalable_dimension
#   schedule           = "cron(0 21 * * ? *)" # 9 PM UTC daily
#
#   scalable_target_action {
#     min_capacity = 2
#     max_capacity = 5
#   }
# }

# =============================================================================
# Auto Scaling Dashboard Widget Additions
# =============================================================================
# Adds scaling metrics to the CloudWatch dashboard

resource "aws_cloudwatch_dashboard" "autoscaling" {
  dashboard_name = "${local.name_prefix}-autoscaling"

  dashboard_body = jsonencode({
    widgets = [
      # Header
      {
        type   = "text"
        x      = 0
        y      = 0
        width  = 24
        height = 1
        properties = {
          markdown = "# Auto Scaling Dashboard - Sprint S-11\nMonitors ECS service scaling activity, task counts, and scaling triggers"
        }
      },

      # Row 1: Service Task Counts
      {
        type   = "metric"
        x      = 0
        y      = 1
        width  = 6
        height = 6
        properties = {
          title  = "API Service - Task Count"
          region = var.aws_region
          stat   = "Average"
          period = 60
          metrics = [
            ["ECS/ContainerInsights", "RunningTaskCount", "ClusterName", aws_ecs_cluster.main.name, "ServiceName", aws_ecs_service.api.name, { label = "Running Tasks" }],
            [".", "DesiredTaskCount", ".", ".", ".", ".", { label = "Desired Tasks", color = "#7f7f7f" }]
          ]
          annotations = {
            horizontal = [
              { value = var.api_min_count, label = "Minimum", color = "#d62728" },
              { value = var.api_max_count, label = "Maximum", color = "#2ca02c" }
            ]
          }
        }
      },
      {
        type   = "metric"
        x      = 6
        y      = 1
        width  = 6
        height = 6
        properties = {
          title  = "GP Worker - Task Count"
          region = var.aws_region
          stat   = "Average"
          period = 60
          metrics = [
            ["ECS/ContainerInsights", "RunningTaskCount", "ClusterName", aws_ecs_cluster.main.name, "ServiceName", aws_ecs_service.gp_worker.name, { label = "Running Tasks" }],
            [".", "DesiredTaskCount", ".", ".", ".", ".", { label = "Desired Tasks", color = "#7f7f7f" }]
          ]
          annotations = {
            horizontal = [
              { value = var.gp_worker_min_count, label = "Minimum", color = "#d62728" },
              { value = var.gp_worker_max_count, label = "Maximum", color = "#2ca02c" }
            ]
          }
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 1
        width  = 6
        height = 6
        properties = {
          title  = "Gateway - Task Count"
          region = var.aws_region
          stat   = "Average"
          period = 60
          metrics = [
            ["ECS/ContainerInsights", "RunningTaskCount", "ClusterName", aws_ecs_cluster.main.name, "ServiceName", aws_ecs_service.gateway.name, { label = "Running Tasks" }],
            [".", "DesiredTaskCount", ".", ".", ".", ".", { label = "Desired Tasks", color = "#7f7f7f" }]
          ]
          annotations = {
            horizontal = [
              { value = var.gateway_min_count, label = "Minimum", color = "#d62728" },
              { value = var.gateway_max_count, label = "Maximum", color = "#2ca02c" }
            ]
          }
        }
      },
      {
        type   = "metric"
        x      = 18
        y      = 1
        width  = 6
        height = 6
        properties = {
          title  = "Queue Depth (Scaling Trigger)"
          region = var.aws_region
          stat   = "Average"
          period = 60
          metrics = [
            ["AWS/AmazonMQ", "MessageCount", "Broker", aws_mq_broker.rabbitmq.broker_name, "Queue", "arrakis.interactions", { label = "Interactions Queue" }],
            [".", ".", ".", ".", ".", "arrakis.events.guild", { label = "Events Queue" }]
          ]
          annotations = {
            horizontal = [
              { value = var.queue_depth_scale_threshold, label = "Scale Out Threshold", color = "#ff7f0e" },
              { value = 10, label = "Scale In Threshold", color = "#2ca02c" }
            ]
          }
        }
      },

      # Row 2: CPU and Memory (Scaling Metrics)
      {
        type   = "metric"
        x      = 0
        y      = 7
        width  = 8
        height = 6
        properties = {
          title  = "API - CPU & Memory (Target: ${var.autoscaling_cpu_target}%)"
          region = var.aws_region
          stat   = "Average"
          period = 60
          metrics = [
            ["AWS/ECS", "CPUUtilization", "ClusterName", aws_ecs_cluster.main.name, "ServiceName", aws_ecs_service.api.name, { label = "CPU %" }],
            [".", "MemoryUtilization", ".", ".", ".", ".", { label = "Memory %" }]
          ]
          annotations = {
            horizontal = [
              { value = var.autoscaling_cpu_target, label = "CPU Target", color = "#ff7f0e" },
              { value = var.autoscaling_memory_target, label = "Memory Target", color = "#2ca02c" }
            ]
          }
          yAxis = { left = { min = 0, max = 100 } }
        }
      },
      {
        type   = "metric"
        x      = 8
        y      = 7
        width  = 8
        height = 6
        properties = {
          title  = "GP Worker - CPU & Memory (Target: ${var.autoscaling_cpu_target}%)"
          region = var.aws_region
          stat   = "Average"
          period = 60
          metrics = [
            ["AWS/ECS", "CPUUtilization", "ClusterName", aws_ecs_cluster.main.name, "ServiceName", aws_ecs_service.gp_worker.name, { label = "CPU %" }],
            [".", "MemoryUtilization", ".", ".", ".", ".", { label = "Memory %" }]
          ]
          annotations = {
            horizontal = [
              { value = var.autoscaling_cpu_target, label = "CPU Target", color = "#ff7f0e" },
              { value = var.autoscaling_memory_target, label = "Memory Target", color = "#2ca02c" }
            ]
          }
          yAxis = { left = { min = 0, max = 100 } }
        }
      },
      {
        type   = "metric"
        x      = 16
        y      = 7
        width  = 8
        height = 6
        properties = {
          title  = "Gateway - CPU & Memory (Target: ${var.autoscaling_cpu_target}%)"
          region = var.aws_region
          stat   = "Average"
          period = 60
          metrics = [
            ["AWS/ECS", "CPUUtilization", "ClusterName", aws_ecs_cluster.main.name, "ServiceName", aws_ecs_service.gateway.name, { label = "CPU %" }],
            [".", "MemoryUtilization", ".", ".", ".", ".", { label = "Memory %" }]
          ]
          annotations = {
            horizontal = [
              { value = var.autoscaling_cpu_target, label = "CPU Target", color = "#ff7f0e" },
              { value = var.autoscaling_memory_target, label = "Memory Target", color = "#2ca02c" }
            ]
          }
          yAxis = { left = { min = 0, max = 100 } }
        }
      },

      # Row 3: Scaling Activity
      {
        type   = "metric"
        x      = 0
        y      = 13
        width  = 12
        height = 6
        properties = {
          title  = "ALB Request Count (Scaling Trigger)"
          region = var.aws_region
          stat   = "Sum"
          period = 60
          metrics = [
            ["AWS/ApplicationELB", "RequestCount", "LoadBalancer", aws_lb.main.arn_suffix, { label = "Total Requests" }],
            [".", "TargetResponseTime", ".", ".", { label = "Response Time (s)", stat = "Average" }]
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
          title  = "RabbitMQ Throughput"
          region = var.aws_region
          stat   = "Sum"
          period = 60
          metrics = [
            ["AWS/AmazonMQ", "PublishRate", "Broker", aws_mq_broker.rabbitmq.broker_name, { label = "Publish Rate/min" }],
            [".", "AckRate", ".", ".", { label = "Ack Rate/min" }]
          ]
        }
      },

      # Row 4: Cost Optimization
      {
        type   = "metric"
        x      = 0
        y      = 19
        width  = 24
        height = 6
        properties = {
          title  = "Cluster Capacity - Cost Optimization View"
          region = var.aws_region
          stat   = "Average"
          period = 300
          view   = "timeSeries"
          metrics = [
            ["ECS/ContainerInsights", "RunningTaskCount", "ClusterName", aws_ecs_cluster.main.name, { label = "Total Running Tasks" }],
            [".", "CpuReserved", ".", ".", { label = "CPU Reserved (units)" }],
            [".", "MemoryReserved", ".", ".", { label = "Memory Reserved (MiB)" }]
          ]
        }
      }
    ]
  })
}

# =============================================================================
# Outputs
# =============================================================================

output "autoscaling_api_target_arn" {
  description = "ARN of the API auto scaling target"
  value       = aws_appautoscaling_target.api.id
}

output "autoscaling_gp_worker_target_arn" {
  description = "ARN of the GP Worker auto scaling target"
  value       = aws_appautoscaling_target.gp_worker.id
}

output "autoscaling_dashboard_url" {
  description = "URL to the Auto Scaling CloudWatch dashboard"
  value       = "https://${var.aws_region}.console.aws.amazon.com/cloudwatch/home?region=${var.aws_region}#dashboards:name=${local.name_prefix}-autoscaling"
}

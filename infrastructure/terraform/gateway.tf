# =============================================================================
# Rust Gateway (Twilight) ECS Service Infrastructure
# Sprint S-11: Auto-Scaling Configuration
# =============================================================================
# The Rust Gateway connects to Discord via Twilight and publishes events to NATS.
# Each gateway instance manages a pool of 25 Discord shards.
#
# Architecture:
#   Discord Gateway (WSS) -> Rust Gateway -> NATS JetStream -> Workers
#
# Scaling Model:
#   - 1 gateway pod per 25 shards
#   - Discord auto-assigns shards based on bot's guild count
#   - At 2,500+ guilds, Discord recommends 2+ shards
#   - Target: 10,000 guilds = 4 gateway pods (100 shards)

# =============================================================================
# CloudWatch Log Group for Gateway
# =============================================================================

resource "aws_cloudwatch_log_group" "gateway" {
  name              = "/ecs/${local.name_prefix}/gateway"
  retention_in_days = 30

  tags = merge(local.common_tags, {
    Service = "Gateway"
    Sprint  = "S-11"
  })
}

# =============================================================================
# ECR Repository for Gateway
# =============================================================================

resource "aws_ecr_repository" "gateway" {
  name                 = "${local.name_prefix}-gateway"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }

  tags = merge(local.common_tags, {
    Service = "Gateway"
    Sprint  = "S-11"
  })
}

# ECR Lifecycle Policy for Gateway
resource "aws_ecr_lifecycle_policy" "gateway" {
  repository = aws_ecr_repository.gateway.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep last 10 images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 10
        }
        action = {
          type = "expire"
        }
      },
      {
        rulePriority = 2
        description  = "Expire untagged images after 7 days"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 7
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}

# =============================================================================
# Gateway Task Definition
# =============================================================================

resource "aws_ecs_task_definition" "gateway" {
  family                   = "${local.name_prefix}-gateway"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.gateway_cpu
  memory                   = var.gateway_memory
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name      = "gateway"
      image     = "${aws_ecr_repository.gateway.repository_url}:${var.environment}"
      essential = true

      portMappings = [
        {
          containerPort = 9090
          hostPort      = 9090
          protocol      = "tcp"
          name          = "metrics"
        },
        {
          containerPort = 8080
          hostPort      = 8080
          protocol      = "tcp"
          name          = "health"
        }
      ]

      environment = [
        {
          name  = "RUST_LOG"
          value = "info,twilight_gateway=info,twilight_http=warn"
        },
        {
          name  = "ENVIRONMENT"
          value = var.environment
        },
        {
          name  = "METRICS_PORT"
          value = "9090"
        },
        {
          name  = "HEALTH_PORT"
          value = "8080"
        },
        {
          name  = "SHARDS_PER_POOL"
          value = "25"
        },
        # NATS connection via service discovery
        {
          name  = "NATS_URL"
          value = "nats://nats.${local.name_prefix}:4222"
        }
      ]

      secrets = [
        {
          name      = "DISCORD_TOKEN"
          valueFrom = "${data.aws_secretsmanager_secret.app_config.arn}:DISCORD_BOT_TOKEN::"
        }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.gateway.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "gateway"
        }
      }

      healthCheck = {
        command     = ["CMD-SHELL", "curl -f http://localhost:8080/health || exit 1"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 60
      }

      # Resource limits to prevent runaway memory
      ulimits = [
        {
          name      = "nofile"
          softLimit = 65536
          hardLimit = 65536
        }
      ]
    }
  ])

  tags = merge(local.common_tags, {
    Service = "Gateway"
    Sprint  = "S-11"
  })
}

# =============================================================================
# Gateway ECS Service
# =============================================================================

resource "aws_ecs_service" "gateway" {
  name            = "${local.name_prefix}-gateway"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.gateway.arn
  desired_count   = var.gateway_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = module.vpc.private_subnets
    security_groups  = [aws_security_group.gateway.id]
    assign_public_ip = false
  }

  # No load balancer - Gateway only makes outbound connections to Discord and NATS
  # Metrics are scraped by Prometheus via service discovery

  deployment_maximum_percent         = 200
  deployment_minimum_healthy_percent = 100

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  # Enable ECS Exec for debugging
  enable_execute_command = true

  tags = merge(local.common_tags, {
    Service = "Gateway"
    Sprint  = "S-11"
  })

  lifecycle {
    # Allow auto-scaling to manage desired_count
    ignore_changes = [desired_count]
  }
}

# =============================================================================
# Gateway Auto Scaling
# =============================================================================

# Register Gateway service with Application Auto Scaling
resource "aws_appautoscaling_target" "gateway" {
  max_capacity       = var.gateway_max_count
  min_capacity       = var.gateway_min_count
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.gateway.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"

  tags = merge(local.common_tags, {
    Service = "Gateway"
    Sprint  = "S-11"
  })
}

# Gateway Target Tracking - CPU Utilization
resource "aws_appautoscaling_policy" "gateway_cpu" {
  name               = "${local.name_prefix}-gateway-cpu-scaling"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.gateway.resource_id
  scalable_dimension = aws_appautoscaling_target.gateway.scalable_dimension
  service_namespace  = aws_appautoscaling_target.gateway.service_namespace

  target_tracking_scaling_policy_configuration {
    target_value       = var.autoscaling_cpu_target
    scale_in_cooldown  = var.autoscaling_scale_in_cooldown
    scale_out_cooldown = var.autoscaling_scale_out_cooldown

    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
  }
}

# Gateway Target Tracking - Memory Utilization
resource "aws_appautoscaling_policy" "gateway_memory" {
  name               = "${local.name_prefix}-gateway-memory-scaling"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.gateway.resource_id
  scalable_dimension = aws_appautoscaling_target.gateway.scalable_dimension
  service_namespace  = aws_appautoscaling_target.gateway.service_namespace

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
# Gateway Scaling Variables
# =============================================================================

variable "gateway_min_count" {
  description = "Minimum number of Gateway tasks"
  type        = number
  default     = 1
}

variable "gateway_max_count" {
  description = "Maximum number of Gateway tasks (each handles 25 shards)"
  type        = number
  default     = 4 # Supports up to 10,000 guilds
}

# =============================================================================
# Gateway CloudWatch Alarms
# =============================================================================

# Gateway CPU High
resource "aws_cloudwatch_metric_alarm" "gateway_cpu_high" {
  alarm_name          = "${local.name_prefix}-gateway-cpu-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "CPUUtilization"
  namespace           = "AWS/ECS"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  alarm_description   = "Gateway CPU > 80% - may need scaling"

  dimensions = {
    ClusterName = aws_ecs_cluster.main.name
    ServiceName = aws_ecs_service.gateway.name
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = merge(local.common_tags, {
    Service = "Gateway"
    Sprint  = "S-11"
  })
}

# Gateway Memory High
resource "aws_cloudwatch_metric_alarm" "gateway_memory_high" {
  alarm_name          = "${local.name_prefix}-gateway-memory-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "MemoryUtilization"
  namespace           = "AWS/ECS"
  period              = 300
  statistic           = "Average"
  threshold           = 85
  alarm_description   = "Gateway memory > 85% - potential memory issue"

  dimensions = {
    ClusterName = aws_ecs_cluster.main.name
    ServiceName = aws_ecs_service.gateway.name
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = merge(local.common_tags, {
    Service = "Gateway"
    Sprint  = "S-11"
  })
}

# Gateway Task Count (ensure at least 1 running)
resource "aws_cloudwatch_metric_alarm" "gateway_no_tasks" {
  alarm_name          = "${local.name_prefix}-gateway-no-tasks"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 1
  metric_name         = "RunningTaskCount"
  namespace           = "ECS/ContainerInsights"
  period              = 60
  statistic           = "Average"
  threshold           = 1
  alarm_description   = "CRITICAL: No Gateway tasks running - Discord events not being processed"
  treat_missing_data  = "breaching"

  dimensions = {
    ClusterName = aws_ecs_cluster.main.name
    ServiceName = aws_ecs_service.gateway.name
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = merge(local.common_tags, {
    Service = "Gateway"
    Sprint  = "S-11"
  })
}

# =============================================================================
# Gateway Service Discovery (for Prometheus scraping)
# =============================================================================

resource "aws_service_discovery_service" "gateway" {
  count = var.enable_service_discovery ? 1 : 0

  name = "gateway"

  dns_config {
    namespace_id   = aws_service_discovery_private_dns_namespace.main[0].id
    routing_policy = "MULTIVALUE"

    dns_records {
      ttl  = 10
      type = "A"
    }
  }

  health_check_custom_config {
    failure_threshold = 1
  }

  tags = merge(local.common_tags, {
    Service = "Gateway"
    Sprint  = "S-11"
  })
}

# =============================================================================
# Outputs
# =============================================================================

output "gateway_ecr_url" {
  description = "ECR repository URL for Gateway"
  value       = aws_ecr_repository.gateway.repository_url
}

output "gateway_service_name" {
  description = "ECS service name for Gateway"
  value       = aws_ecs_service.gateway.name
}

output "gateway_autoscaling_target_arn" {
  description = "ARN of the Gateway auto scaling target"
  value       = aws_appautoscaling_target.gateway.id
}

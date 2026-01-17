# =============================================================================
# Grafana Tempo - Distributed Tracing Backend
# Sprint S-13: Distributed Tracing
# =============================================================================
# Tempo provides cost-effective, scalable trace storage and query capabilities.
# This configuration deploys Tempo as an ECS Fargate service.

# -----------------------------------------------------------------------------
# Security Group for Tempo
# -----------------------------------------------------------------------------
resource "aws_security_group" "tempo" {
  name_prefix = "${local.name_prefix}-tempo-"
  description = "Security group for Grafana Tempo tracing backend"
  vpc_id      = module.vpc.vpc_id

  tags = merge(local.common_tags, {
    Name    = "${local.name_prefix}-tempo"
    Service = "Tracing"
    Sprint  = "S-13"
  })

  lifecycle {
    create_before_destroy = true
  }
}

# Tempo Query API (for Grafana)
resource "aws_security_group_rule" "tempo_query_from_grafana" {
  type              = "ingress"
  from_port         = 3200
  to_port           = 3200
  protocol          = "tcp"
  cidr_blocks       = [module.vpc.vpc_cidr_block]
  security_group_id = aws_security_group.tempo.id
  description       = "Tempo Query API from VPC"
}

# OTLP gRPC receiver (for workers)
resource "aws_security_group_rule" "tempo_otlp_grpc" {
  type              = "ingress"
  from_port         = 4317
  to_port           = 4317
  protocol          = "tcp"
  cidr_blocks       = [module.vpc.vpc_cidr_block]
  security_group_id = aws_security_group.tempo.id
  description       = "OTLP gRPC from VPC"
}

# OTLP HTTP receiver (for workers)
resource "aws_security_group_rule" "tempo_otlp_http" {
  type              = "ingress"
  from_port         = 4318
  to_port           = 4318
  protocol          = "tcp"
  cidr_blocks       = [module.vpc.vpc_cidr_block]
  security_group_id = aws_security_group.tempo.id
  description       = "OTLP HTTP from VPC"
}

# Allow all outbound
resource "aws_security_group_rule" "tempo_egress" {
  type              = "egress"
  from_port         = 0
  to_port           = 0
  protocol          = "-1"
  cidr_blocks       = ["0.0.0.0/0"]
  security_group_id = aws_security_group.tempo.id
  description       = "Allow all outbound"
}

# -----------------------------------------------------------------------------
# EFS for Tempo data persistence
# -----------------------------------------------------------------------------
resource "aws_efs_file_system" "tempo" {
  creation_token = "${local.name_prefix}-tempo"
  encrypted      = true

  performance_mode = "generalPurpose"
  throughput_mode  = "bursting"

  tags = merge(local.common_tags, {
    Name    = "${local.name_prefix}-tempo"
    Service = "Tracing"
    Sprint  = "S-13"
  })
}

resource "aws_efs_mount_target" "tempo" {
  count = length(module.vpc.private_subnets)

  file_system_id  = aws_efs_file_system.tempo.id
  subnet_id       = module.vpc.private_subnets[count.index]
  security_groups = [aws_security_group.tempo.id]
}

resource "aws_efs_access_point" "tempo" {
  file_system_id = aws_efs_file_system.tempo.id

  posix_user {
    gid = 10001
    uid = 10001
  }

  root_directory {
    path = "/tempo"
    creation_info {
      owner_gid   = 10001
      owner_uid   = 10001
      permissions = "0755"
    }
  }

  tags = merge(local.common_tags, {
    Name    = "${local.name_prefix}-tempo"
    Service = "Tracing"
  })
}

# -----------------------------------------------------------------------------
# CloudWatch Log Group
# -----------------------------------------------------------------------------
resource "aws_cloudwatch_log_group" "tempo" {
  name              = "/ecs/${local.name_prefix}/tempo"
  retention_in_days = 14

  tags = merge(local.common_tags, {
    Service = "Tracing"
    Sprint  = "S-13"
  })
}

# -----------------------------------------------------------------------------
# ECS Task Definition
# -----------------------------------------------------------------------------
resource "aws_ecs_task_definition" "tempo" {
  family                   = "${local.name_prefix}-tempo"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "512"
  memory                   = "1024"
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.tempo_task.arn

  container_definitions = jsonencode([
    {
      name      = "tempo"
      image     = "grafana/tempo:2.3.1"
      essential = true

      command = ["-config.file=/etc/tempo/tempo.yaml"]

      portMappings = [
        {
          containerPort = 3200
          protocol      = "tcp"
          name          = "query"
        },
        {
          containerPort = 4317
          protocol      = "tcp"
          name          = "otlp-grpc"
        },
        {
          containerPort = 4318
          protocol      = "tcp"
          name          = "otlp-http"
        }
      ]

      environment = [
        {
          name  = "ENVIRONMENT"
          value = var.environment
        }
      ]

      mountPoints = [
        {
          sourceVolume  = "tempo-data"
          containerPath = "/var/tempo"
          readOnly      = false
        },
        {
          sourceVolume  = "tempo-config"
          containerPath = "/etc/tempo"
          readOnly      = true
        }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.tempo.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "tempo"
        }
      }

      healthCheck = {
        command     = ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:3200/ready"]
        interval    = 30
        timeout     = 10
        retries     = 3
        startPeriod = 60
      }
    }
  ])

  volume {
    name = "tempo-data"

    efs_volume_configuration {
      file_system_id          = aws_efs_file_system.tempo.id
      transit_encryption      = "ENABLED"
      authorization_config {
        access_point_id = aws_efs_access_point.tempo.id
        iam             = "ENABLED"
      }
    }
  }

  volume {
    name = "tempo-config"

    efs_volume_configuration {
      file_system_id     = aws_efs_file_system.tempo.id
      transit_encryption = "ENABLED"
      authorization_config {
        access_point_id = aws_efs_access_point.tempo.id
        iam             = "ENABLED"
      }
    }
  }

  tags = merge(local.common_tags, {
    Service = "Tracing"
    Sprint  = "S-13"
  })
}

# -----------------------------------------------------------------------------
# IAM Role for Tempo Task
# -----------------------------------------------------------------------------
resource "aws_iam_role" "tempo_task" {
  name = "${local.name_prefix}-tempo-task"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
      }
    ]
  })

  tags = merge(local.common_tags, {
    Service = "Tracing"
  })
}

resource "aws_iam_role_policy" "tempo_task" {
  name = "${local.name_prefix}-tempo-task"
  role = aws_iam_role.tempo_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "elasticfilesystem:ClientMount",
          "elasticfilesystem:ClientWrite",
          "elasticfilesystem:ClientRootAccess"
        ]
        Resource = aws_efs_file_system.tempo.arn
      },
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "${aws_cloudwatch_log_group.tempo.arn}:*"
      }
    ]
  })
}

# -----------------------------------------------------------------------------
# ECS Service
# -----------------------------------------------------------------------------
resource "aws_ecs_service" "tempo" {
  name            = "${local.name_prefix}-tempo"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.tempo.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = module.vpc.private_subnets
    security_groups  = [aws_security_group.tempo.id]
    assign_public_ip = false
  }

  # Service discovery for internal DNS resolution
  service_registries {
    registry_arn = aws_service_discovery_service.tempo.arn
  }

  tags = merge(local.common_tags, {
    Service = "Tracing"
    Sprint  = "S-13"
  })

  depends_on = [aws_efs_mount_target.tempo]
}

# -----------------------------------------------------------------------------
# Service Discovery
# -----------------------------------------------------------------------------
resource "aws_service_discovery_service" "tempo" {
  name = "tempo"

  dns_config {
    namespace_id = aws_service_discovery_private_dns_namespace.internal.id

    dns_records {
      ttl  = 10
      type = "A"
    }

    routing_policy = "MULTIVALUE"
  }

  health_check_custom_config {
    failure_threshold = 1
  }
}

# -----------------------------------------------------------------------------
# CloudWatch Alarms for Tempo
# -----------------------------------------------------------------------------
resource "aws_cloudwatch_metric_alarm" "tempo_cpu_high" {
  alarm_name          = "${local.name_prefix}-tempo-cpu-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "CPUUtilization"
  namespace           = "AWS/ECS"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  alarm_description   = "Tempo CPU utilization > 80%"

  dimensions = {
    ClusterName = aws_ecs_cluster.main.name
    ServiceName = aws_ecs_service.tempo.name
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = merge(local.common_tags, {
    Service = "Tracing"
    Sprint  = "S-13"
  })
}

resource "aws_cloudwatch_metric_alarm" "tempo_memory_high" {
  alarm_name          = "${local.name_prefix}-tempo-memory-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "MemoryUtilization"
  namespace           = "AWS/ECS"
  period              = 300
  statistic           = "Average"
  threshold           = 85
  alarm_description   = "Tempo memory utilization > 85%"

  dimensions = {
    ClusterName = aws_ecs_cluster.main.name
    ServiceName = aws_ecs_service.tempo.name
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = merge(local.common_tags, {
    Service = "Tracing"
    Sprint  = "S-13"
  })
}

# -----------------------------------------------------------------------------
# Outputs
# -----------------------------------------------------------------------------
output "tempo_service_name" {
  description = "Tempo ECS service name"
  value       = aws_ecs_service.tempo.name
}

output "tempo_endpoint_query" {
  description = "Tempo Query API endpoint (internal)"
  value       = "http://tempo.${aws_service_discovery_private_dns_namespace.internal.name}:3200"
}

output "tempo_endpoint_otlp_grpc" {
  description = "Tempo OTLP gRPC endpoint (internal)"
  value       = "tempo.${aws_service_discovery_private_dns_namespace.internal.name}:4317"
}

output "tempo_endpoint_otlp_http" {
  description = "Tempo OTLP HTTP endpoint (internal)"
  value       = "http://tempo.${aws_service_discovery_private_dns_namespace.internal.name}:4318"
}

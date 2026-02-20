# =============================================================================
# loa-finn ECS Service Infrastructure
# Cycle 036: Launch Readiness — Sprint 1, Task 1.1
# =============================================================================
#
# loa-finn is the inference/payments microservice that runs alongside
# loa-freeside (the API). Communication is internal-only via Cloud Map DNS.
# No public ALB listener — finn is reached only from freeside's ECS tasks.

# -----------------------------------------------------------------------------
# CloudWatch Log Group
# -----------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "finn" {
  name              = "/ecs/${local.name_prefix}/finn"
  retention_in_days = var.log_retention_days

  tags = merge(local.common_tags, {
    Service = "Finn"
    Sprint  = "C36-1"
  })
}

# -----------------------------------------------------------------------------
# ECR Repository
# -----------------------------------------------------------------------------

resource "aws_ecr_repository" "finn" {
  name                 = "${local.name_prefix}-loa-finn"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }

  tags = merge(local.common_tags, {
    Service = "Finn"
    Sprint  = "C36-1"
  })
}

resource "aws_ecr_lifecycle_policy" "finn" {
  repository = aws_ecr_repository.finn.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
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
      },
      {
        rulePriority = 2
        description  = "Keep last 10 images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 10
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}

# -----------------------------------------------------------------------------
# Execution Role (Least-Privilege per Sprint 94 pattern)
# Needs: db_credentials, redis, ES256 key, NOWPayments secrets
# -----------------------------------------------------------------------------

resource "aws_iam_role" "ecs_execution_finn" {
  name = "${local.name_prefix}-ecs-execution-finn"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "ecs-tasks.amazonaws.com"
      }
    }]
  })

  tags = merge(local.common_tags, {
    Service = "Finn"
    Sprint  = "C36-1"
  })
}

resource "aws_iam_role_policy_attachment" "ecs_execution_finn" {
  role       = aws_iam_role.ecs_execution_finn.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "ecs_execution_finn_secrets" {
  name = "${local.name_prefix}-ecs-execution-finn-secrets"
  role = aws_iam_role.ecs_execution_finn.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "FinnServiceSecrets"
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue"
        ]
        Resource = [
          aws_secretsmanager_secret.db_credentials.arn,
          aws_secretsmanager_secret.redis_credentials.arn,
          aws_secretsmanager_secret.finn_s2s_es256_private_key.arn,
          aws_secretsmanager_secret.finn_nowpayments_api_key.arn,
          aws_secretsmanager_secret.finn_nowpayments_ipn_secret.arn
        ]
      }
    ]
  })
}

# Service discovery permissions for finn execution role
resource "aws_iam_role_policy" "ecs_execution_finn_servicediscovery" {
  name = "${local.name_prefix}-ecs-execution-finn-servicediscovery"
  role = aws_iam_role.ecs_execution_finn.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "servicediscovery:RegisterInstance",
          "servicediscovery:DeregisterInstance",
          "servicediscovery:DiscoverInstances",
          "servicediscovery:GetInstancesHealthStatus",
          "servicediscovery:GetOperation",
          "servicediscovery:GetService",
          "servicediscovery:ListInstances"
        ]
        Resource = "*"
      }
    ]
  })
}

# -----------------------------------------------------------------------------
# Secrets (empty — values set operationally in Task 1.5)
# -----------------------------------------------------------------------------

resource "aws_secretsmanager_secret" "finn_s2s_es256_private_key" {
  name                    = "${local.name_prefix}/s2s-es256-private-key"
  description             = "ES256 private key for S2S JWT signing (loa-finn ↔ loa-freeside)"
  recovery_window_in_days = 7
  kms_key_id              = aws_kms_key.secrets.arn

  tags = merge(local.common_tags, {
    Service  = "Finn"
    Sprint   = "C36-1"
    Rotation = "quarterly"
  })
}

resource "aws_secretsmanager_secret" "finn_nowpayments_api_key" {
  name                    = "${local.name_prefix}/nowpayments-api-key"
  description             = "NOWPayments API key for crypto payment processing"
  recovery_window_in_days = 7
  kms_key_id              = aws_kms_key.secrets.arn

  tags = merge(local.common_tags, {
    Service  = "Finn"
    Sprint   = "C36-1"
    Rotation = "on-compromise"
  })
}

resource "aws_secretsmanager_secret" "finn_nowpayments_ipn_secret" {
  name                    = "${local.name_prefix}/nowpayments-ipn-secret"
  description             = "NOWPayments IPN webhook HMAC secret for signature verification"
  recovery_window_in_days = 7
  kms_key_id              = aws_kms_key.secrets.arn

  tags = merge(local.common_tags, {
    Service  = "Finn"
    Sprint   = "C36-1"
    Rotation = "on-compromise"
  })
}

# -----------------------------------------------------------------------------
# Security Group — inbound only from loa-freeside (ecs_tasks SG)
# -----------------------------------------------------------------------------

resource "aws_security_group" "finn" {
  name_prefix = "${local.name_prefix}-finn-"
  vpc_id      = module.vpc.vpc_id
  description = "Security group for loa-finn — inbound only from loa-freeside"

  # Inbound from loa-freeside ECS tasks on port 3000
  ingress {
    description     = "HTTP from loa-freeside"
    from_port       = 3000
    to_port         = 3000
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs_tasks.id]
  }

  # Egress to database (PostgreSQL via PgBouncer)
  egress {
    description     = "PostgreSQL via PgBouncer"
    from_port       = 6432
    to_port         = 6432
    protocol        = "tcp"
    security_groups = [aws_security_group.pgbouncer.id]
  }

  # Egress to Redis (ElastiCache)
  egress {
    description     = "Redis"
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.redis.id]
  }

  # Egress to NATS (JetStream)
  egress {
    description     = "NATS client"
    from_port       = 4222
    to_port         = 4222
    protocol        = "tcp"
    security_groups = [aws_security_group.nats.id]
  }

  # Egress HTTPS for external APIs (NOWPayments, model providers)
  egress {
    description = "HTTPS for external APIs and Secrets Manager"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # Egress to loa-freeside for JWKS handled by aws_security_group_rule.finn_to_freeside

  tags = merge(local.common_tags, {
    Name    = "${local.name_prefix}-finn-sg"
    Service = "Finn"
    Sprint  = "C36-1"
  })

  lifecycle {
    create_before_destroy = true
  }
}

# Allow finn to reach freeside for JWKS endpoint
resource "aws_security_group_rule" "finn_to_freeside" {
  type                     = "egress"
  from_port                = 3000
  to_port                  = 3000
  protocol                 = "tcp"
  security_group_id        = aws_security_group.finn.id
  source_security_group_id = aws_security_group.ecs_tasks.id
  description              = "loa-finn egress to loa-freeside for JWKS"
}

# Allow freeside to also accept inbound from finn (bidirectional S2S)
resource "aws_security_group_rule" "freeside_from_finn" {
  type                     = "ingress"
  from_port                = 3000
  to_port                  = 3000
  protocol                 = "tcp"
  security_group_id        = aws_security_group.ecs_tasks.id
  source_security_group_id = aws_security_group.finn.id
  description              = "loa-freeside ingress from loa-finn for S2S callbacks"
}

# Allow PgBouncer to accept inbound from finn
resource "aws_security_group_rule" "pgbouncer_from_finn" {
  type                     = "ingress"
  from_port                = 6432
  to_port                  = 6432
  protocol                 = "tcp"
  security_group_id        = aws_security_group.pgbouncer.id
  source_security_group_id = aws_security_group.finn.id
  description              = "PgBouncer ingress from loa-finn"
}

# Allow Redis to accept inbound from finn
resource "aws_security_group_rule" "redis_from_finn" {
  type                     = "ingress"
  from_port                = 6379
  to_port                  = 6379
  protocol                 = "tcp"
  security_group_id        = aws_security_group.redis.id
  source_security_group_id = aws_security_group.finn.id
  description              = "Redis ingress from loa-finn"
}

# Allow NATS to accept inbound from finn
resource "aws_security_group_rule" "nats_from_finn" {
  type                     = "ingress"
  from_port                = 4222
  to_port                  = 4222
  protocol                 = "tcp"
  security_group_id        = aws_security_group.nats.id
  source_security_group_id = aws_security_group.finn.id
  description              = "NATS client ingress from loa-finn"
}

# -----------------------------------------------------------------------------
# Task Definition (with ADOT sidecar for Prometheus metrics)
# -----------------------------------------------------------------------------

resource "aws_ecs_task_definition" "finn" {
  family                   = "${local.name_prefix}-finn"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.finn_cpu
  memory                   = var.finn_memory
  execution_role_arn       = aws_iam_role.ecs_execution_finn.arn
  task_role_arn            = aws_iam_role.finn_task.arn

  container_definitions = jsonencode([
    {
      name      = "finn"
      image     = "${aws_ecr_repository.finn.repository_url}:${var.environment}"
      essential = true

      portMappings = [
        {
          containerPort = 3000
          hostPort      = 3000
          protocol      = "tcp"
          name          = "http"
        }
      ]

      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "PORT", value = "3000" },
        { name = "LOG_LEVEL", value = var.log_level },
        # Service discovery URLs (resolved via Cloud Map)
        { name = "FREESIDE_BASE_URL", value = "http://freeside.${local.name_prefix}.local:3000" },
        { name = "NATS_URL", value = "nats://nats.${local.name_prefix}.local:4222" },
        # Feature flags
        { name = "FEATURE_PAYMENTS_ENABLED", value = "false" },
        { name = "FEATURE_INFERENCE_ENABLED", value = "true" }
      ]

      secrets = [
        { name = "DATABASE_URL", valueFrom = "${aws_secretsmanager_secret.db_credentials.arn}:url::" },
        { name = "REDIS_URL", valueFrom = "${aws_secretsmanager_secret.redis_credentials.arn}:url::" },
        { name = "S2S_ES256_PRIVATE_KEY", valueFrom = aws_secretsmanager_secret.finn_s2s_es256_private_key.arn },
        { name = "NOWPAYMENTS_API_KEY", valueFrom = aws_secretsmanager_secret.finn_nowpayments_api_key.arn },
        { name = "NOWPAYMENTS_IPN_SECRET", valueFrom = aws_secretsmanager_secret.finn_nowpayments_ipn_secret.arn }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.finn.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "finn"
        }
      }

      healthCheck = {
        command     = ["CMD-SHELL", "curl -f http://localhost:3000/health || exit 1"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 60
      }

      # Allow graceful shutdown for in-flight inference requests
      stopTimeout = 120
    },
    # ADOT sidecar for Prometheus metrics collection
    {
      name      = "adot-collector"
      image     = "public.ecr.aws/aws-observability/aws-otel-collector:v0.40.0"
      essential = false

      portMappings = [
        {
          containerPort = 4317
          hostPort      = 4317
          protocol      = "tcp"
          name          = "otlp-grpc"
        },
        {
          containerPort = 4318
          hostPort      = 4318
          protocol      = "tcp"
          name          = "otlp-http"
        }
      ]

      environment = [
        { name = "AOT_CONFIG_CONTENT", value = yamlencode({
          receivers = {
            prometheus = {
              config = {
                scrape_configs = [
                  {
                    job_name   = "finn-metrics"
                    scrape_interval = "30s"
                    static_configs = [
                      { targets = ["localhost:3000"] }
                    ]
                    metrics_path = "/metrics"
                  }
                ]
              }
            }
          }
          exporters = {
            awsemf = {
              region    = var.aws_region
              namespace = "Arrakis/Finn"
              log_group_name = "/ecs/${local.name_prefix}/finn/metrics"
            }
          }
          service = {
            pipelines = {
              metrics = {
                receivers = ["prometheus"]
                exporters = ["awsemf"]
              }
            }
          }
        })}
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.finn.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "adot"
        }
      }
    }
  ])

  tags = merge(local.common_tags, {
    Service = "Finn"
    Sprint  = "C36-1"
  })
}

# Task role for finn application (CloudWatch, X-Ray, ADOT)
resource "aws_iam_role" "finn_task" {
  name = "${local.name_prefix}-finn-task"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "ecs-tasks.amazonaws.com"
      }
    }]
  })

  tags = merge(local.common_tags, {
    Service = "Finn"
    Sprint  = "C36-1"
  })
}

resource "aws_iam_role_policy" "finn_task" {
  name = "${local.name_prefix}-finn-task-policy"
  role = aws_iam_role.finn_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "CloudWatchLogs"
        Effect = "Allow"
        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents",
          "logs:CreateLogGroup"
        ]
        Resource = "*"
      },
      {
        Sid    = "XRayTracing"
        Effect = "Allow"
        Action = [
          "xray:PutTraceSegments",
          "xray:PutTelemetryRecords"
        ]
        Resource = "*"
      },
      {
        Sid    = "CloudWatchMetrics"
        Effect = "Allow"
        Action = [
          "cloudwatch:PutMetricData"
        ]
        Resource = "*"
      }
    ]
  })
}

# -----------------------------------------------------------------------------
# Service Discovery (Cloud Map)
# -----------------------------------------------------------------------------

resource "aws_service_discovery_service" "finn" {
  name = "finn"

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
    Service = "Finn"
    Sprint  = "C36-1"
  })
}

# -----------------------------------------------------------------------------
# ECS Service
# -----------------------------------------------------------------------------

resource "aws_ecs_service" "finn" {
  name            = "${local.name_prefix}-finn"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.finn.arn
  desired_count   = var.finn_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = module.vpc.private_subnets
    security_groups  = [aws_security_group.finn.id]
    assign_public_ip = false
  }

  # No load_balancer block — finn is internal-only, no public ALB listener

  # Cloud Map service discovery
  service_registries {
    registry_arn = aws_service_discovery_service.finn.arn
  }

  deployment_maximum_percent         = 200
  deployment_minimum_healthy_percent = 100

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  depends_on = [
    aws_iam_role_policy.ecs_execution_finn_secrets,
    aws_iam_role_policy.ecs_execution_finn_servicediscovery
  ]

  tags = merge(local.common_tags, {
    Service = "Finn"
    Sprint  = "C36-1"
  })
}

# -----------------------------------------------------------------------------
# Outputs
# -----------------------------------------------------------------------------

output "finn_ecr_url" {
  description = "ECR repository URL for loa-finn"
  value       = aws_ecr_repository.finn.repository_url
}

output "finn_service_name" {
  description = "ECS service name for loa-finn"
  value       = aws_ecs_service.finn.name
}

output "finn_service_discovery_dns" {
  description = "Cloud Map DNS name for loa-finn"
  value       = "finn.${aws_service_discovery_private_dns_namespace.main[0].name}"
}

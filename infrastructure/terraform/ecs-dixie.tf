# =============================================================================
# loa-dixie ECS Service Infrastructure
# Cycle 044: Staging Integration — Sprint 1, Task 1.2
# =============================================================================
#
# loa-dixie is the BFF/reputation microservice. It runs alongside freeside
# (API gateway) and finn (inference/payments). Public traffic arrives via ALB
# host-based routing (dixie.staging.arrakis.community). Internal S2S traffic
# uses Cloud Map DNS (dixie.arrakis-staging.local).
#
# @see SDD §3.1 Component Design
# @see SDD §3.2 Security Group Rules

# -----------------------------------------------------------------------------
# CloudWatch Log Group
# -----------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "dixie" {
  name              = "/ecs/${local.name_prefix}/dixie"
  retention_in_days = var.log_retention_days

  tags = merge(local.common_tags, {
    Service = "Dixie"
    Sprint  = "C44-1"
  })
}

# -----------------------------------------------------------------------------
# ECR Repository
# -----------------------------------------------------------------------------

resource "aws_ecr_repository" "dixie" {
  name                 = "${local.name_prefix}-loa-dixie"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }

  tags = merge(local.common_tags, {
    Service = "Dixie"
    Sprint  = "C44-1"
  })
}

resource "aws_ecr_lifecycle_policy" "dixie" {
  repository = aws_ecr_repository.dixie.name

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
# Execution Role (Least-Privilege — SDD §12.1)
# Needs: dixie DB credentials, Redis, ES256 key, admin key
# -----------------------------------------------------------------------------

resource "aws_iam_role" "ecs_execution_dixie" {
  name = "${local.name_prefix}-ecs-execution-dixie"

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
    Service = "Dixie"
    Sprint  = "C44-1"
  })
}

resource "aws_iam_role_policy_attachment" "ecs_execution_dixie" {
  role       = aws_iam_role.ecs_execution_dixie.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "ecs_execution_dixie_secrets" {
  name = "${local.name_prefix}-ecs-execution-dixie-secrets"
  role = aws_iam_role.ecs_execution_dixie.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "DixieServiceSecrets"
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue"
        ]
        Resource = [
          aws_secretsmanager_secret.dixie_es256_private_key.arn,
          aws_secretsmanager_secret.dixie_admin_key.arn,
          aws_secretsmanager_secret.dixie_db_url.arn,
          aws_secretsmanager_secret.redis_credentials.arn
        ]
      }
    ]
  })
}

# Service discovery permissions for dixie execution role
resource "aws_iam_role_policy" "ecs_execution_dixie_servicediscovery" {
  name = "${local.name_prefix}-ecs-execution-dixie-servicediscovery"
  role = aws_iam_role.ecs_execution_dixie.id

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
# Secrets (empty shells — values set by bootstrap-staging-secrets.sh)
# Canonical IDs per SDD §4.2
# -----------------------------------------------------------------------------

resource "aws_secretsmanager_secret" "dixie_es256_private_key" {
  name                    = "${local.name_prefix}/dixie/es256-private-key"
  description             = "ES256 private key for S2S JWT signing (loa-dixie)"
  recovery_window_in_days = 7
  kms_key_id              = aws_kms_key.secrets.arn

  tags = merge(local.common_tags, {
    Service  = "Dixie"
    Sprint   = "C44-1"
    Rotation = "quarterly"
  })
}

resource "aws_secretsmanager_secret" "dixie_admin_key" {
  name                    = "${local.name_prefix}/dixie/admin-key"
  description             = "Admin API key for loa-dixie management endpoints"
  recovery_window_in_days = 7
  kms_key_id              = aws_kms_key.secrets.arn

  tags = merge(local.common_tags, {
    Service  = "Dixie"
    Sprint   = "C44-1"
    Rotation = "on-compromise"
  })
}

resource "aws_secretsmanager_secret" "dixie_db_url" {
  name                    = "${local.name_prefix}/dixie/db-url"
  description             = "PostgreSQL connection URL for loa-dixie (via PgBouncer)"
  recovery_window_in_days = 7
  kms_key_id              = aws_kms_key.secrets.arn

  tags = merge(local.common_tags, {
    Service  = "Dixie"
    Sprint   = "C44-1"
    Rotation = "on-rotation"
  })
}

# -----------------------------------------------------------------------------
# Security Group — SDD §3.2 Network Matrix
# -----------------------------------------------------------------------------

resource "aws_security_group" "dixie" {
  name_prefix = "${local.name_prefix}-dixie-"
  vpc_id      = module.vpc.vpc_id
  description = "Security group for loa-dixie — inbound from ALB and finn"

  # Ingress from ALB on port 3001 (public traffic)
  ingress {
    description     = "HTTP from ALB"
    from_port       = 3001
    to_port         = 3001
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  # Ingress from loa-finn on port 3001 (reputation query)
  ingress {
    description     = "HTTP from loa-finn (reputation query)"
    from_port       = 3001
    to_port         = 3001
    protocol        = "tcp"
    security_groups = [aws_security_group.finn.id]
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

  # Egress HTTPS for external APIs and Secrets Manager
  egress {
    description = "HTTPS for external APIs and Secrets Manager"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.common_tags, {
    Name    = "${local.name_prefix}-dixie-sg"
    Service = "Dixie"
    Sprint  = "C44-1"
  })

  lifecycle {
    create_before_destroy = true
  }
}

# Allow PgBouncer to accept inbound from dixie
resource "aws_security_group_rule" "pgbouncer_from_dixie" {
  type                     = "ingress"
  from_port                = 6432
  to_port                  = 6432
  protocol                 = "tcp"
  security_group_id        = aws_security_group.pgbouncer.id
  source_security_group_id = aws_security_group.dixie.id
  description              = "PgBouncer ingress from loa-dixie"
}

# Allow Redis to accept inbound from dixie
resource "aws_security_group_rule" "redis_from_dixie" {
  type                     = "ingress"
  from_port                = 6379
  to_port                  = 6379
  protocol                 = "tcp"
  security_group_id        = aws_security_group.redis.id
  source_security_group_id = aws_security_group.dixie.id
  description              = "Redis ingress from loa-dixie"
}

# -----------------------------------------------------------------------------
# Task Definition
# -----------------------------------------------------------------------------

resource "aws_ecs_task_definition" "dixie" {
  family                   = "${local.name_prefix}-dixie"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.dixie_cpu
  memory                   = var.dixie_memory
  execution_role_arn       = aws_iam_role.ecs_execution_dixie.arn
  task_role_arn            = aws_iam_role.dixie_task.arn

  container_definitions = jsonencode([
    {
      name      = "dixie"
      image     = "${aws_ecr_repository.dixie.repository_url}:${var.dixie_image_tag}"
      essential = true

      portMappings = [
        {
          containerPort = 3001
          hostPort      = 3001
          protocol      = "tcp"
          name          = "http"
        }
      ]

      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "PORT", value = "3001" },
        { name = "LOG_LEVEL", value = var.log_level },
        # Service discovery URLs (resolved via Cloud Map)
        { name = "LOA_FINN_BASE_URL", value = "http://finn.${local.name_prefix}.local:3000" },
        { name = "LOA_FINN_JWKS_URL", value = "http://finn.${local.name_prefix}.local:3000/.well-known/jwks.json" },
        # Graceful degradation: dixie operates without NATS (IMP-009)
        { name = "NATS_OPTIONAL", value = "true" }
      ]

      secrets = [
        { name = "DATABASE_URL", valueFrom = aws_secretsmanager_secret.dixie_db_url.arn },
        { name = "REDIS_URL", valueFrom = "${aws_secretsmanager_secret.redis_credentials.arn}:url::" },
        { name = "ES256_PRIVATE_KEY", valueFrom = aws_secretsmanager_secret.dixie_es256_private_key.arn },
        { name = "ADMIN_KEY", valueFrom = aws_secretsmanager_secret.dixie_admin_key.arn }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.dixie.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "dixie"
        }
      }

      healthCheck = {
        command     = ["CMD-SHELL", "curl -f http://localhost:3001/api/health || exit 1"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 60
      }

      # Dixie has no long-lived inference requests; shorter grace period
      stopTimeout = 30
    }
  ])

  tags = merge(local.common_tags, {
    Service = "Dixie"
    Sprint  = "C44-1"
  })
}

# Task role for dixie application (CloudWatch, X-Ray)
resource "aws_iam_role" "dixie_task" {
  name = "${local.name_prefix}-dixie-task"

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
    Service = "Dixie"
    Sprint  = "C44-1"
  })
}

resource "aws_iam_role_policy" "dixie_task" {
  name = "${local.name_prefix}-dixie-task-policy"
  role = aws_iam_role.dixie_task.id

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
# Service Discovery (Cloud Map) — SDD §3.4
# -----------------------------------------------------------------------------

resource "aws_service_discovery_service" "dixie" {
  name = "dixie"

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
    Service = "Dixie"
    Sprint  = "C44-1"
  })
}

# -----------------------------------------------------------------------------
# ALB Target Group & Listener Rule — SDD §3.3
# -----------------------------------------------------------------------------

resource "aws_lb_target_group" "dixie" {
  name        = "${local.name_prefix}-dixie-tg"
  port        = 3001
  protocol    = "HTTP"
  vpc_id      = module.vpc.vpc_id
  target_type = "ip"

  deregistration_delay = 30

  health_check {
    enabled             = true
    healthy_threshold   = 2
    interval            = 30
    matcher             = "200"
    path                = "/api/health"
    port                = "traffic-port"
    protocol            = "HTTP"
    timeout             = 5
    unhealthy_threshold = 3
  }

  tags = merge(local.common_tags, {
    Service = "Dixie"
    Sprint  = "C44-1"
  })
}

resource "aws_lb_listener_rule" "dixie" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 200

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.dixie.arn
  }

  condition {
    host_header {
      values = ["dixie.${var.environment}.${var.root_domain}"]
    }
  }

  tags = merge(local.common_tags, {
    Service = "Dixie"
    Sprint  = "C44-1"
  })
}

# -----------------------------------------------------------------------------
# ECS Service
# -----------------------------------------------------------------------------

resource "aws_ecs_service" "dixie" {
  name            = "${local.name_prefix}-dixie"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.dixie.arn
  desired_count   = var.dixie_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = module.vpc.private_subnets
    security_groups  = [aws_security_group.dixie.id]
    assign_public_ip = false
  }

  # Public traffic via ALB
  load_balancer {
    target_group_arn = aws_lb_target_group.dixie.arn
    container_name   = "dixie"
    container_port   = 3001
  }

  # Cloud Map service discovery (VPC-internal)
  service_registries {
    registry_arn = aws_service_discovery_service.dixie.arn
  }

  deployment_maximum_percent         = 200
  deployment_minimum_healthy_percent = 100

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  depends_on = [
    aws_iam_role_policy.ecs_execution_dixie_secrets,
    aws_iam_role_policy.ecs_execution_dixie_servicediscovery,
    aws_lb_listener_rule.dixie
  ]

  tags = merge(local.common_tags, {
    Service = "Dixie"
    Sprint  = "C44-1"
  })
}

# -----------------------------------------------------------------------------
# Migration Task Definition (SDD §5.2 / IMP-004)
# One-shot ECS task for dixie database migrations.
# Invoked via `aws ecs run-task` — NOT inside the service container.
# -----------------------------------------------------------------------------

resource "aws_ecs_task_definition" "dixie_migration" {
  family                   = "${local.name_prefix}-dixie-migration"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.ecs_execution_migration.arn
  task_role_arn            = aws_iam_role.dixie_task.arn

  container_definitions = jsonencode([
    {
      name      = "migration"
      image     = "${aws_ecr_repository.dixie.repository_url}:${var.dixie_image_tag}"
      essential = true

      command = ["node", "dist/db/migrate.js"]

      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "MIGRATION_TIMEOUT_MS", value = "90000" }
      ]

      secrets = [
        { name = "DATABASE_URL", valueFrom = aws_secretsmanager_secret.dixie_db_url.arn }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.dixie.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "migration"
        }
      }

      # IMP-004: Prevent hung migration tasks
      stopTimeout = 120
    }
  ])

  tags = merge(local.common_tags, {
    Service = "Dixie"
    Sprint  = "C44-2"
    Purpose = "migration"
  })
}

# -----------------------------------------------------------------------------
# Outputs
# -----------------------------------------------------------------------------

output "dixie_ecr_url" {
  description = "ECR repository URL for loa-dixie"
  value       = aws_ecr_repository.dixie.repository_url
}

output "dixie_service_name" {
  description = "ECS service name for loa-dixie"
  value       = aws_ecs_service.dixie.name
}

output "dixie_service_discovery_dns" {
  description = "Cloud Map DNS name for loa-dixie"
  value       = "dixie.${aws_service_discovery_private_dns_namespace.main[0].name}"
}

output "dixie_target_group_arn" {
  description = "ALB target group ARN for loa-dixie"
  value       = aws_lb_target_group.dixie.arn
}

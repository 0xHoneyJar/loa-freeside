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
# Needs: finn_db_credentials (read-only), redis, ES256 key, NOWPayments secrets
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
          aws_secretsmanager_secret.finn_db_credentials.arn,
          aws_secretsmanager_secret.redis_credentials.arn,
          aws_secretsmanager_secret.finn_s2s_es256_private_key.arn,
          aws_secretsmanager_secret.finn_nowpayments_api_key.arn,
          aws_secretsmanager_secret.finn_nowpayments_ipn_secret.arn,
          aws_secretsmanager_secret.nats_tls_ca.arn,
          data.aws_secretsmanager_secret.app_config.arn,
        ]
      },
      {
        Sid    = "FinnKmsDecrypt"
        Effect = "Allow"
        Action = [
          "kms:Decrypt",
          "kms:DescribeKey"
        ]
        Resource = [
          aws_kms_key.secrets.arn
        ]
      },
      {
        Sid    = "FinnLegacySSMParams"
        Effect = "Allow"
        Action = [
          "ssm:GetParameters",
          "ssm:GetParameter"
        ]
        Resource = [
          "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/loa-finn/armitage/*"
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
  name                    = "${local.name_prefix}/finn/es256-private-key"
  description             = "ES256 private key for S2S JWT signing (loa-finn)"
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
  description = "Security group for loa-finn - inbound only from loa-freeside"

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
    ignore_changes        = [ingress, egress]
  }
}

# Allow finn to reach dixie for reputation query (SDD §3.2)
resource "aws_security_group_rule" "finn_to_dixie" {
  type                     = "egress"
  from_port                = 3001
  to_port                  = 3001
  protocol                 = "tcp"
  security_group_id        = aws_security_group.finn.id
  source_security_group_id = aws_security_group.dixie.id
  description              = "loa-finn egress to loa-dixie for reputation query"
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
        { name = "ARRAKIS_JWKS_URL", value = "http://freeside.${local.name_prefix}.local:3000/.well-known/jwks.json" },
        { name = "DIXIE_REPUTATION_URL", value = "http://dixie.${local.name_prefix}.local:3001/api/reputation/query" },
        { name = "NATS_URL", value = "tls://nats.${local.name_prefix}.local:4222" },
        # Feature flags
        { name = "FEATURE_PAYMENTS_ENABLED", value = "false" },
        { name = "FEATURE_INFERENCE_ENABLED", value = "true" },
        { name = "FEATURE_REDIS_ENABLED", value = "true" },
        { name = "FINN_POSTGRES_ENABLED", value = "false" },
        # Per-NFT Personality Pipeline (loa-finn PR #135)
        { name = "FINN_PERSONALITY_PIPELINE", value = "true" },
        { name = "BERACHAIN_RPC_URL", value = "https://rpc.berachain.com" },
        { name = "CHAT_ALLOWED_ADDRESSES", value = var.chat_allowed_addresses },
        # Security: Finn requires explicit CORS origins in production
        { name = "CORS_ALLOWED_ORIGINS", value = "https://api.0xhoneyjar.xyz,https://staging.api.arrakis.community,https://0xhoneyjar.xyz" },
      ]

      secrets = [
        # DATABASE_URL removed — Finn's postgres.js v3.4.8 sends unsupported startup parameter.
        # Re-enable when FINN_POSTGRES_ENABLED is true and postgres.js is compatible with RDS.
        # { name = "DATABASE_URL", valueFrom = "${aws_secretsmanager_secret.finn_db_credentials.arn}:url::" },
        { name = "REDIS_URL", valueFrom = "${aws_secretsmanager_secret.redis_credentials.arn}:url::" },
        { name = "S2S_ES256_PRIVATE_KEY", valueFrom = aws_secretsmanager_secret.finn_s2s_es256_private_key.arn },
        { name = "NOWPAYMENTS_API_KEY", valueFrom = aws_secretsmanager_secret.finn_nowpayments_api_key.arn },
        { name = "NOWPAYMENTS_IPN_SECRET", valueFrom = aws_secretsmanager_secret.finn_nowpayments_ipn_secret.arn },
        # Legacy SSM parameters (migrated from loa-finn-armitage)
        { name = "ANTHROPIC_API_KEY", valueFrom = "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/loa-finn/armitage/ANTHROPIC_API_KEY" },
        { name = "FINN_S2S_SECRET", valueFrom = "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/loa-finn/armitage/FINN_S2S_SECRET" },
        { name = "BASE_RPC_URL", valueFrom = "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/loa-finn/armitage/BASE_RPC_URL" },
        { name = "TREASURY_ADDRESS", valueFrom = "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/loa-finn/armitage/TREASURY_ADDRESS" },
        { name = "R2_BUCKET", valueFrom = "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/loa-finn/armitage/R2_BUCKET" },
        { name = "JWT_KMS_KEY_ID", valueFrom = "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/loa-finn/armitage/JWT_KMS_KEY_ID" },
        { name = "CHEVAL_HMAC_SECRET", valueFrom = "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/loa-finn/armitage/CHEVAL_HMAC_SECRET" },
        { name = "FINN_CALIBRATION_BUCKET_NAME", valueFrom = "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/loa-finn/armitage/FINN_CALIBRATION_BUCKET_NAME" },
        { name = "FINN_CALIBRATION_HMAC_KEY", valueFrom = "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/loa-finn/armitage/FINN_CALIBRATION_HMAC_KEY" },
        { name = "FINN_METRICS_BEARER_TOKEN", valueFrom = "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/loa-finn/armitage/FINN_METRICS_BEARER_TOKEN" },
        # SEC-4.4: NATS TLS CA certificate for client verification
        { name = "NATS_TLS_CA", valueFrom = aws_secretsmanager_secret.nats_tls_ca.arn },
        # Per-NFT Personality Pipeline (loa-finn PR #135)
        { name = "FINN_COLLECTION_SALT", valueFrom = "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/loa-finn/armitage/FINN_COLLECTION_SALT" },
        # Finn config requires these at boot (Zod validation).
        # Sourced from app-config secret via JSON key extraction.
        { name = "BGT_ADDRESS", valueFrom = "${data.aws_secretsmanager_secret.app_config.arn}:BGT_ADDRESS::" },
        { name = "DISCORD_BOT_TOKEN", valueFrom = "${data.aws_secretsmanager_secret.app_config.arn}:DISCORD_BOT_TOKEN::" },
        { name = "DISCORD_GUILD_ID", valueFrom = "${data.aws_secretsmanager_secret.app_config.arn}:DISCORD_GUILD_ID::" },
        { name = "DISCORD_APPLICATION_ID", valueFrom = "${data.aws_secretsmanager_secret.app_config.arn}:DISCORD_APPLICATION_ID::" },
        { name = "DISCORD_CHANNEL_THE_DOOR", valueFrom = "${data.aws_secretsmanager_secret.app_config.arn}:DISCORD_CHANNEL_THE_DOOR::" },
        { name = "DISCORD_CHANNEL_CENSUS", valueFrom = "${data.aws_secretsmanager_secret.app_config.arn}:DISCORD_CHANNEL_CENSUS::" },
        { name = "DISCORD_CHANNEL_ANNOUNCEMENTS", valueFrom = "${data.aws_secretsmanager_secret.app_config.arn}:DISCORD_CHANNEL_ANNOUNCEMENTS::" },
        { name = "DISCORD_CHANNEL_CAVE_ENTRANCE", valueFrom = "${data.aws_secretsmanager_secret.app_config.arn}:DISCORD_CHANNEL_CAVE_ENTRANCE::" },
        { name = "DISCORD_CHANNEL_OASIS", valueFrom = "${data.aws_secretsmanager_secret.app_config.arn}:DISCORD_CHANNEL_OASIS::" },
        { name = "DISCORD_CHANNEL_DEEP_DESERT", valueFrom = "${data.aws_secretsmanager_secret.app_config.arn}:DISCORD_CHANNEL_DEEP_DESERT::" },
        { name = "DISCORD_CHANNEL_STILLSUIT_LOUNGE", valueFrom = "${data.aws_secretsmanager_secret.app_config.arn}:DISCORD_CHANNEL_STILLSUIT_LOUNGE::" },
        { name = "DISCORD_CHANNEL_NAIB_COUNCIL", valueFrom = "${data.aws_secretsmanager_secret.app_config.arn}:DISCORD_CHANNEL_NAIB_COUNCIL::" },
        { name = "DISCORD_CHANNEL_INTRODUCTIONS", valueFrom = "${data.aws_secretsmanager_secret.app_config.arn}:DISCORD_CHANNEL_INTRODUCTIONS::" },
        { name = "DISCORD_ROLE_NAIB", valueFrom = "${data.aws_secretsmanager_secret.app_config.arn}:DISCORD_ROLE_NAIB::" },
        { name = "DISCORD_ROLE_FEDAYKIN", valueFrom = "${data.aws_secretsmanager_secret.app_config.arn}:DISCORD_ROLE_FEDAYKIN::" },
        { name = "TRIGGER_PROJECT_ID", valueFrom = "${data.aws_secretsmanager_secret.app_config.arn}:TRIGGER_PROJECT_ID::" },
        { name = "TRIGGER_SECRET_KEY", valueFrom = "${data.aws_secretsmanager_secret.app_config.arn}:TRIGGER_SECRET_KEY::" },
        { name = "DEVELOPER_API_S2S_SECRET", valueFrom = "${data.aws_secretsmanager_secret.app_config.arn}:DEVELOPER_API_S2S_SECRET::" },
        { name = "API_KEY_PEPPER", valueFrom = "${data.aws_secretsmanager_secret.app_config.arn}:API_KEY_PEPPER::" },
        { name = "RATE_LIMIT_SALT", valueFrom = "${data.aws_secretsmanager_secret.app_config.arn}:RATE_LIMIT_SALT::" },
        { name = "INTERNAL_API_KEY", valueFrom = "${data.aws_secretsmanager_secret.app_config.arn}:INTERNAL_API_KEY::" },
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
        command     = ["CMD-SHELL", "node -e \"require('http').get('http://localhost:3000/health',r=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))\""]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 90
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
      },
      {
        Sid    = "ECSExec"
        Effect = "Allow"
        Action = [
          "ssmmessages:CreateControlChannel",
          "ssmmessages:CreateDataChannel",
          "ssmmessages:OpenControlChannel",
          "ssmmessages:OpenDataChannel"
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

  enable_execute_command = true

  depends_on = [
    aws_iam_role_policy.ecs_execution_finn_secrets,
    aws_iam_role_policy.ecs_execution_finn_servicediscovery
  ]

  tags = merge(local.common_tags, {
    Service = "Finn"
    Sprint  = "C46-3"
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

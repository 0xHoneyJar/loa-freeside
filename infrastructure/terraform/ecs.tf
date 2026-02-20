# ECS Cluster
resource "aws_ecs_cluster" "main" {
  name = "${local.name_prefix}-cluster"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  configuration {
    execute_command_configuration {
      logging = "OVERRIDE"

      log_configuration {
        cloud_watch_log_group_name = aws_cloudwatch_log_group.ecs_exec.name
      }
    }
  }

  tags = local.common_tags
}

resource "aws_ecs_cluster_capacity_providers" "main" {
  cluster_name = aws_ecs_cluster.main.name

  capacity_providers = ["FARGATE", "FARGATE_SPOT"]

  default_capacity_provider_strategy {
    base              = 1
    weight            = 100
    capacity_provider = "FARGATE"
  }
}

# CloudWatch Log Groups
resource "aws_cloudwatch_log_group" "ecs_exec" {
  name              = "/ecs/${local.name_prefix}/exec"
  retention_in_days = 30
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/ecs/${local.name_prefix}/api"
  retention_in_days = 30
}

resource "aws_cloudwatch_log_group" "worker" {
  name              = "/ecs/${local.name_prefix}/worker"
  retention_in_days = 30
}

# ECS Task Execution Role
resource "aws_iam_role" "ecs_execution" {
  name = "${local.name_prefix}-ecs-execution"

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
}

resource "aws_iam_role_policy_attachment" "ecs_execution" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# Data source for manually created app-config secret
data "aws_secretsmanager_secret" "app_config" {
  name = "${local.name_prefix}/app-config"
}

# =============================================================================
# Service-Specific Execution Roles (Sprint 94 - Least Privilege)
# =============================================================================
# Each ECS service gets its own execution role with access only to the secrets
# it needs. This prevents lateral movement if any single container is compromised.
#
# Finding: C-1 - Overly Permissive IAM Access to Discord Bot Token
# CVSS: 9.1 (Critical)

# -----------------------------------------------------------------------------
# API Service Execution Role
# Needs: vault_token, app_config (Discord, API keys), db_credentials, redis
# -----------------------------------------------------------------------------
resource "aws_iam_role" "ecs_execution_api" {
  name = "${local.name_prefix}-ecs-execution-api"

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
    Service = "API"
    Sprint  = "94"
  })
}

resource "aws_iam_role_policy_attachment" "ecs_execution_api" {
  role       = aws_iam_role.ecs_execution_api.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "ecs_execution_api_secrets" {
  name = "${local.name_prefix}-ecs-execution-api-secrets"
  role = aws_iam_role.ecs_execution_api.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "APIServiceSecrets"
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue"
        ]
        Resource = [
          data.aws_secretsmanager_secret.vault_token.arn,
          data.aws_secretsmanager_secret.app_config.arn,
          aws_secretsmanager_secret.db_credentials.arn,
          aws_secretsmanager_secret.redis_credentials.arn,
          aws_secretsmanager_secret.agent_jwt_signing_key.arn  # Hounfour Phase 4
        ]
      }
    ]
  })
}

# -----------------------------------------------------------------------------
# Worker Service Execution Role
# Needs: vault_token, app_config (limited), db_credentials, redis
# -----------------------------------------------------------------------------
resource "aws_iam_role" "ecs_execution_worker" {
  name = "${local.name_prefix}-ecs-execution-worker"

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
    Service = "Worker"
    Sprint  = "94"
  })
}

resource "aws_iam_role_policy_attachment" "ecs_execution_worker" {
  role       = aws_iam_role.ecs_execution_worker.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "ecs_execution_worker_secrets" {
  name = "${local.name_prefix}-ecs-execution-worker-secrets"
  role = aws_iam_role.ecs_execution_worker.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "WorkerServiceSecrets"
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue"
        ]
        Resource = [
          data.aws_secretsmanager_secret.vault_token.arn,
          data.aws_secretsmanager_secret.app_config.arn,
          aws_secretsmanager_secret.db_credentials.arn,
          aws_secretsmanager_secret.redis_credentials.arn
        ]
      }
    ]
  })
}

# -----------------------------------------------------------------------------
# Ingestor Service Execution Role
# Needs: app_config (Discord token only), rabbitmq_credentials
# Minimal secrets - Ingestor only connects to Discord and publishes to RabbitMQ
# -----------------------------------------------------------------------------
resource "aws_iam_role" "ecs_execution_ingestor" {
  name = "${local.name_prefix}-ecs-execution-ingestor"

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
    Service = "Ingestor"
    Sprint  = "94"
  })
}

resource "aws_iam_role_policy_attachment" "ecs_execution_ingestor" {
  role       = aws_iam_role.ecs_execution_ingestor.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "ecs_execution_ingestor_secrets" {
  name = "${local.name_prefix}-ecs-execution-ingestor-secrets"
  role = aws_iam_role.ecs_execution_ingestor.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "IngestorServiceSecrets"
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue"
        ]
        Resource = [
          data.aws_secretsmanager_secret.app_config.arn,
          aws_secretsmanager_secret.rabbitmq_credentials.arn
        ]
      }
    ]
  })
}

# -----------------------------------------------------------------------------
# Gateway (Rust/Twilight) Execution Role
# Needs: app_config (Discord token only) - minimal attack surface
# -----------------------------------------------------------------------------
resource "aws_iam_role" "ecs_execution_gateway" {
  name = "${local.name_prefix}-ecs-execution-gateway"

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
    Service = "Gateway"
    Sprint  = "94"
  })
}

resource "aws_iam_role_policy_attachment" "ecs_execution_gateway" {
  role       = aws_iam_role.ecs_execution_gateway.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "ecs_execution_gateway_secrets" {
  name = "${local.name_prefix}-ecs-execution-gateway-secrets"
  role = aws_iam_role.ecs_execution_gateway.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "GatewayServiceSecrets"
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue"
        ]
        Resource = [
          data.aws_secretsmanager_secret.app_config.arn
        ]
      }
    ]
  })
}

# -----------------------------------------------------------------------------
# GP Worker Execution Role
# Needs: app_config (Discord), db_credentials, redis, rabbitmq
# -----------------------------------------------------------------------------
resource "aws_iam_role" "ecs_execution_gp_worker" {
  name = "${local.name_prefix}-ecs-execution-gp-worker"

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
    Service = "GPWorker"
    Sprint  = "94"
  })
}

resource "aws_iam_role_policy_attachment" "ecs_execution_gp_worker" {
  role       = aws_iam_role.ecs_execution_gp_worker.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "ecs_execution_gp_worker_secrets" {
  name = "${local.name_prefix}-ecs-execution-gp-worker-secrets"
  role = aws_iam_role.ecs_execution_gp_worker.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "GPWorkerServiceSecrets"
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue"
        ]
        Resource = [
          data.aws_secretsmanager_secret.app_config.arn,
          aws_secretsmanager_secret.db_credentials.arn,
          aws_secretsmanager_secret.redis_credentials.arn,
          aws_secretsmanager_secret.rabbitmq_credentials.arn
        ]
      }
    ]
  })
}

# -----------------------------------------------------------------------------
# Sprint 95 (A-94.3): Legacy IAM role removed - all services use service-specific roles
# This policy was removed because it granted blanket access to ALL secrets,
# bypassing the least-privilege architecture implemented in Sprint 94.
#
# Service-specific roles:
# - ecs_execution_api: vault_token, app_config, db_credentials, redis_credentials
# - ecs_execution_worker: vault_token, app_config, db_credentials, redis_credentials
# - ecs_execution_ingestor: app_config, rabbitmq_credentials
# - ecs_execution_gateway: app_config only
# - ecs_execution_gp_worker: app_config, db_credentials, redis_credentials, rabbitmq_credentials
# -----------------------------------------------------------------------------

# Cloud Map / Service Discovery permissions for ECS services
# Required for DNS-based service discovery (NATS, etc.)
resource "aws_iam_role_policy" "ecs_execution_servicediscovery" {
  name = "${local.name_prefix}-ecs-execution-servicediscovery"
  role = aws_iam_role.ecs_execution.id

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
      },
      {
        Effect = "Allow"
        Action = [
          "route53:GetHostedZone",
          "route53:ListResourceRecordSets",
          "route53:ChangeResourceRecordSets"
        ]
        Resource = "*"
      }
    ]
  })
}

# ECS Task Role (for application)
resource "aws_iam_role" "ecs_task" {
  name = "${local.name_prefix}-ecs-task"

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
}

# Task role policy for CloudWatch and X-Ray
resource "aws_iam_role_policy" "ecs_task" {
  name = "${local.name_prefix}-ecs-task-policy"
  role = aws_iam_role.ecs_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "xray:PutTraceSegments",
          "xray:PutTelemetryRecords"
        ]
        Resource = "*"
      }
    ]
  })
}

# API Task Definition
resource "aws_ecs_task_definition" "api" {
  family                   = "${local.name_prefix}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.api_cpu
  memory                   = var.api_memory
  execution_role_arn       = aws_iam_role.ecs_execution_api.arn # Sprint 94: Least-privilege
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name  = "api"
      image = "${aws_ecr_repository.api.repository_url}:staging"

      portMappings = [{
        containerPort = 3000
        protocol      = "tcp"
      }]

      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "PORT", value = "3000" },
        { name = "API_PORT", value = "3000" },
        { name = "API_HOST", value = "0.0.0.0" },
        { name = "VAULT_NAMESPACE", value = var.vault_namespace },
        { name = "DISABLE_PII_SCRUBBING", value = "false" },
        { name = "LOG_LEVEL", value = "info" },
        { name = "FEATURE_VAULT_ENABLED", value = "false" },
        { name = "FEATURE_BILLING_ENABLED", value = "false" },
        { name = "FEATURE_REDIS_ENABLED", value = "true" },
        { name = "FEATURE_TELEGRAM_ENABLED", value = "false" },
        # Sprint 172: In-house wallet verification base URL (derived from domain)
        { name = "VERIFY_BASE_URL", value = "https://${var.domain_name}" },
        # Hounfour Phase 4: Agent gateway
        { name = "AGENT_ENABLED", value = var.agent_enabled },
        { name = "ENSEMBLE_ENABLED", value = var.ensemble_enabled },
        { name = "BYOK_ENABLED", value = var.byok_enabled ? "true" : "false" },
        # Cycle 036: Use Cloud Map DNS for finn discovery in ECS
        { name = "LOA_FINN_BASE_URL", value = var.enable_service_discovery ? "http://finn.${local.name_prefix}.local:3000" : var.loa_finn_base_url }
      ]

      secrets = [
        { name = "VAULT_TOKEN", valueFrom = data.aws_secretsmanager_secret.vault_token.arn },
        { name = "API_KEY_PEPPER", valueFrom = "${data.aws_secretsmanager_secret.app_config.arn}:API_KEY_PEPPER::" },
        { name = "RATE_LIMIT_SALT", valueFrom = "${data.aws_secretsmanager_secret.app_config.arn}:RATE_LIMIT_SALT::" },
        { name = "WEBHOOK_SECRET", valueFrom = "${data.aws_secretsmanager_secret.app_config.arn}:WEBHOOK_SECRET::" },
        { name = "BGT_ADDRESS", valueFrom = "${data.aws_secretsmanager_secret.app_config.arn}:BGT_ADDRESS::" },
        { name = "BERACHAIN_RPC_URLS", valueFrom = "${data.aws_secretsmanager_secret.app_config.arn}:BERACHAIN_RPC_URLS::" },
        { name = "TRIGGER_PROJECT_ID", valueFrom = "${data.aws_secretsmanager_secret.app_config.arn}:TRIGGER_PROJECT_ID::" },
        { name = "TRIGGER_SECRET_KEY", valueFrom = "${data.aws_secretsmanager_secret.app_config.arn}:TRIGGER_SECRET_KEY::" },
        { name = "DISCORD_BOT_TOKEN", valueFrom = "${data.aws_secretsmanager_secret.app_config.arn}:DISCORD_BOT_TOKEN::" },
        { name = "DISCORD_GUILD_ID", valueFrom = "${data.aws_secretsmanager_secret.app_config.arn}:DISCORD_GUILD_ID::" },
        { name = "DISCORD_CHANNEL_THE_DOOR", valueFrom = "${data.aws_secretsmanager_secret.app_config.arn}:DISCORD_CHANNEL_THE_DOOR::" },
        { name = "DISCORD_CHANNEL_CENSUS", valueFrom = "${data.aws_secretsmanager_secret.app_config.arn}:DISCORD_CHANNEL_CENSUS::" },
        { name = "DISCORD_ROLE_NAIB", valueFrom = "${data.aws_secretsmanager_secret.app_config.arn}:DISCORD_ROLE_NAIB::" },
        { name = "DISCORD_ROLE_FEDAYKIN", valueFrom = "${data.aws_secretsmanager_secret.app_config.arn}:DISCORD_ROLE_FEDAYKIN::" },
        { name = "ADMIN_API_KEYS", valueFrom = "${data.aws_secretsmanager_secret.app_config.arn}:ADMIN_API_KEYS::" },
        { name = "DATABASE_URL", valueFrom = "${aws_secretsmanager_secret.db_credentials.arn}:url::" },
        { name = "REDIS_URL", valueFrom = "${aws_secretsmanager_secret.redis_credentials.arn}:url::" },
        # Sprint 175: Internal API key for Trigger.dev -> ECS communication
        { name = "INTERNAL_API_KEY", valueFrom = "${data.aws_secretsmanager_secret.app_config.arn}:INTERNAL_API_KEY::" },
        # Sprint 17: Dune Sim integration and CORS configuration
        { name = "DUNE_SIM_API_KEY", valueFrom = "${data.aws_secretsmanager_secret.app_config.arn}:DUNE_SIM_API_KEY::" },
        { name = "CHAIN_PROVIDER", valueFrom = "${data.aws_secretsmanager_secret.app_config.arn}:CHAIN_PROVIDER::" },
        { name = "CHAIN_PROVIDER_FALLBACK_ENABLED", valueFrom = "${data.aws_secretsmanager_secret.app_config.arn}:CHAIN_PROVIDER_FALLBACK_ENABLED::" },
        { name = "CORS_ALLOWED_ORIGINS", valueFrom = "${data.aws_secretsmanager_secret.app_config.arn}:CORS_ALLOWED_ORIGINS::" },
        # Hounfour Phase 4: Agent gateway configuration
        { name = "AGENT_JWT_SIGNING_KEY", valueFrom = aws_secretsmanager_secret.agent_jwt_signing_key.arn },
        { name = "AGENT_JWT_KEY_ID", valueFrom = "${data.aws_secretsmanager_secret.app_config.arn}:AGENT_JWT_KEY_ID::" }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.api.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "api"
        }
      }

      healthCheck = {
        command     = ["CMD-SHELL", "curl -f http://localhost:3000/health || exit 1"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 60
      }

      # Hounfour Phase 4 (IMP-003): Allow SSE stream drain before SIGKILL
      stopTimeout = 120
    }
  ])

  tags = local.common_tags
}

# =============================================================================
# Hounfour Phase 4: Agent Gateway Secrets
# =============================================================================

# JWT signing key for agent gateway (RS256 private key in PEM format)
resource "aws_secretsmanager_secret" "agent_jwt_signing_key" {
  name        = "${local.name_prefix}/agent-jwt-signing-key"
  description = "RS256 private key for signing agent gateway JWTs"
  kms_key_id  = aws_kms_key.secrets.arn

  tags = merge(local.common_tags, {
    Sprint = "Hounfour-Phase4"
  })
}

# Worker Task Definition
resource "aws_ecs_task_definition" "worker" {
  family                   = "${local.name_prefix}-worker"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.ecs_execution_worker.arn # Sprint 94: Least-privilege
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name  = "worker"
      image = "${aws_ecr_repository.api.repository_url}:staging"

      command = ["node", "dist/jobs/worker.js"]

      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "VAULT_NAMESPACE", value = var.vault_namespace },
        { name = "DISABLE_PII_SCRUBBING", value = "false" },
        { name = "LOG_LEVEL", value = "info" },
        { name = "FEATURE_VAULT_ENABLED", value = "false" },
        { name = "FEATURE_BILLING_ENABLED", value = "false" },
        { name = "FEATURE_REDIS_ENABLED", value = "true" },
        { name = "FEATURE_TELEGRAM_ENABLED", value = "false" }
      ]

      secrets = [
        { name = "VAULT_TOKEN", valueFrom = data.aws_secretsmanager_secret.vault_token.arn },
        { name = "API_KEY_PEPPER", valueFrom = "${data.aws_secretsmanager_secret.app_config.arn}:API_KEY_PEPPER::" },
        { name = "RATE_LIMIT_SALT", valueFrom = "${data.aws_secretsmanager_secret.app_config.arn}:RATE_LIMIT_SALT::" },
        { name = "WEBHOOK_SECRET", valueFrom = "${data.aws_secretsmanager_secret.app_config.arn}:WEBHOOK_SECRET::" },
        { name = "BGT_ADDRESS", valueFrom = "${data.aws_secretsmanager_secret.app_config.arn}:BGT_ADDRESS::" },
        { name = "BERACHAIN_RPC_URLS", valueFrom = "${data.aws_secretsmanager_secret.app_config.arn}:BERACHAIN_RPC_URLS::" },
        { name = "TRIGGER_PROJECT_ID", valueFrom = "${data.aws_secretsmanager_secret.app_config.arn}:TRIGGER_PROJECT_ID::" },
        { name = "TRIGGER_SECRET_KEY", valueFrom = "${data.aws_secretsmanager_secret.app_config.arn}:TRIGGER_SECRET_KEY::" },
        { name = "DISCORD_BOT_TOKEN", valueFrom = "${data.aws_secretsmanager_secret.app_config.arn}:DISCORD_BOT_TOKEN::" },
        { name = "DISCORD_GUILD_ID", valueFrom = "${data.aws_secretsmanager_secret.app_config.arn}:DISCORD_GUILD_ID::" },
        { name = "DISCORD_CHANNEL_THE_DOOR", valueFrom = "${data.aws_secretsmanager_secret.app_config.arn}:DISCORD_CHANNEL_THE_DOOR::" },
        { name = "DISCORD_CHANNEL_CENSUS", valueFrom = "${data.aws_secretsmanager_secret.app_config.arn}:DISCORD_CHANNEL_CENSUS::" },
        { name = "DISCORD_ROLE_NAIB", valueFrom = "${data.aws_secretsmanager_secret.app_config.arn}:DISCORD_ROLE_NAIB::" },
        { name = "DISCORD_ROLE_FEDAYKIN", valueFrom = "${data.aws_secretsmanager_secret.app_config.arn}:DISCORD_ROLE_FEDAYKIN::" },
        { name = "ADMIN_API_KEYS", valueFrom = "${data.aws_secretsmanager_secret.app_config.arn}:ADMIN_API_KEYS::" },
        { name = "DATABASE_URL", valueFrom = "${aws_secretsmanager_secret.db_credentials.arn}:url::" },
        { name = "REDIS_URL", valueFrom = "${aws_secretsmanager_secret.redis_credentials.arn}:url::" }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.worker.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "worker"
        }
      }
    }
  ])

  tags = local.common_tags
}

# API Service
resource "aws_ecs_service" "api" {
  name            = "${local.name_prefix}-api"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = var.api_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = module.vpc.private_subnets
    security_groups  = [aws_security_group.ecs_tasks.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = 3000
  }

  # Cloud Map service discovery — resolves as freeside.arrakis-{env}.local
  # Cycle 036: Enables finn → freeside S2S communication via DNS
  service_registries {
    registry_arn = aws_service_discovery_service.freeside.arn
  }

  deployment_maximum_percent         = 200
  deployment_minimum_healthy_percent = 100

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  depends_on = [aws_lb_listener.https]

  tags = local.common_tags
}

# Worker Service
resource "aws_ecs_service" "worker" {
  name            = "${local.name_prefix}-worker"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.worker.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = module.vpc.private_subnets
    security_groups  = [aws_security_group.ecs_tasks.id]
    assign_public_ip = false
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  tags = local.common_tags
}

# Security Group for ECS Tasks
resource "aws_security_group" "ecs_tasks" {
  name_prefix = "${local.name_prefix}-ecs-tasks-"
  vpc_id      = module.vpc.vpc_id

  ingress {
    from_port       = 3000
    to_port         = 3000
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-ecs-tasks-sg"
  })
}

# ECR Repository
resource "aws_ecr_repository" "api" {
  name                 = "${local.name_prefix}-api"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }

  tags = local.common_tags
}

# ECR Lifecycle Policy
resource "aws_ecr_lifecycle_policy" "api" {
  repository = aws_ecr_repository.api.name

  policy = jsonencode({
    rules = [{
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
    }]
  })
}

# =============================================================================
# Gateway Proxy Pattern - Ingestor Service
# =============================================================================
# The Ingestor ("The Ear") is a lightweight Discord Gateway listener that
# publishes events to RabbitMQ. It has ZERO business logic and minimal caching.

# CloudWatch Log Group for Ingestor
resource "aws_cloudwatch_log_group" "ingestor" {
  name              = "/ecs/${local.name_prefix}/ingestor"
  retention_in_days = 30

  tags = local.common_tags
}

# ECR Repository for Ingestor
resource "aws_ecr_repository" "ingestor" {
  name                 = "${local.name_prefix}-ingestor"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }

  tags = merge(local.common_tags, {
    Service = "GatewayProxy"
  })
}

# ECR Lifecycle Policy for Ingestor
resource "aws_ecr_lifecycle_policy" "ingestor" {
  repository = aws_ecr_repository.ingestor.name

  policy = jsonencode({
    rules = [{
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
    }]
  })
}

# Security Group for Ingestor
# Minimal attack surface: No ingress, only egress to Discord Gateway and RabbitMQ
resource "aws_security_group" "ingestor" {
  name_prefix = "${local.name_prefix}-ingestor-"
  vpc_id      = module.vpc.vpc_id
  description = "Security group for Ingestor service - Discord Gateway listener"

  # No ingress rules - Ingestor only makes outbound connections

  # Egress to RabbitMQ (AMQPS)
  egress {
    description     = "AMQPS to RabbitMQ"
    from_port       = 5671
    to_port         = 5671
    protocol        = "tcp"
    security_groups = [aws_security_group.rabbitmq.id]
  }

  # Egress to Discord Gateway and CloudWatch (HTTPS)
  egress {
    description = "HTTPS for Discord Gateway and CloudWatch"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # Egress for health check endpoint (internal)
  egress {
    description = "Health check HTTP"
    from_port   = 8080
    to_port     = 8080
    protocol    = "tcp"
    self        = true
  }

  tags = merge(local.common_tags, {
    Name    = "${local.name_prefix}-ingestor-sg"
    Service = "GatewayProxy"
  })

  lifecycle {
    create_before_destroy = true
  }
}

# Ingestor Task Definition
resource "aws_ecs_task_definition" "ingestor" {
  family                   = "${local.name_prefix}-ingestor"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.ingestor_cpu
  memory                   = var.ingestor_memory
  execution_role_arn       = aws_iam_role.ecs_execution_ingestor.arn # Sprint 94: Least-privilege
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name  = "ingestor"
      image = "${aws_ecr_repository.ingestor.repository_url}:latest"

      # Health check port
      portMappings = [{
        containerPort = 8080
        protocol      = "tcp"
      }]

      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "LOG_LEVEL", value = "info" },
        { name = "HEALTH_PORT", value = "8080" },
        { name = "SHARD_COUNT", value = "1" }, # Auto-shard when >2500 guilds
        { name = "MEMORY_THRESHOLD_MB", value = "75" }
      ]

      secrets = [
        # ONLY Discord bot token - Ingestor has minimal secrets
        { name = "DISCORD_BOT_TOKEN", valueFrom = "${data.aws_secretsmanager_secret.app_config.arn}:DISCORD_BOT_TOKEN::" },
        # RabbitMQ connection for publishing events
        { name = "RABBITMQ_URL", valueFrom = "${aws_secretsmanager_secret.rabbitmq_credentials.arn}:url::" }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.ingestor.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "ingestor"
        }
      }

      healthCheck = {
        command     = ["CMD-SHELL", "curl -f http://localhost:8080/health || exit 1"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 60
      }
    }
  ])

  tags = merge(local.common_tags, {
    Service = "GatewayProxy"
  })
}

# Ingestor Service
# Sprint GW-2: Ingestor code ready - enable service with desired count
resource "aws_ecs_service" "ingestor" {
  name            = "${local.name_prefix}-ingestor"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.ingestor.arn
  desired_count   = var.ingestor_desired_count # Enabled in Sprint GW-2
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = module.vpc.private_subnets
    security_groups  = [aws_security_group.ingestor.id]
    assign_public_ip = false
  }

  # No load balancer - Ingestor only makes outbound connections

  deployment_maximum_percent         = 200
  deployment_minimum_healthy_percent = 100

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  tags = merge(local.common_tags, {
    Service = "GatewayProxy"
  })
}

# =============================================================================
# Gateway Proxy Worker Infrastructure (Sprint GW-3)
# =============================================================================

# CloudWatch Log Group for Worker
resource "aws_cloudwatch_log_group" "gp_worker" {
  name              = "/ecs/${local.name_prefix}/gp-worker"
  retention_in_days = var.log_retention_days

  tags = merge(local.common_tags, {
    Service = "GatewayProxy"
  })
}

# ECR Repository for Worker
resource "aws_ecr_repository" "gp_worker" {
  name                 = "${local.name_prefix}-gp-worker"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = merge(local.common_tags, {
    Service = "GatewayProxy"
  })
}

# ECR Lifecycle Policy for Worker
resource "aws_ecr_lifecycle_policy" "gp_worker" {
  repository = aws_ecr_repository.gp_worker.name

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

# Security Group for Worker
resource "aws_security_group" "gp_worker" {
  name        = "${local.name_prefix}-gp-worker-sg"
  description = "Security group for Gateway Proxy Worker"
  vpc_id      = module.vpc.vpc_id

  # No inbound rules - Worker only makes outbound connections

  tags = merge(local.common_tags, {
    Name    = "${local.name_prefix}-gp-worker-sg"
    Service = "GatewayProxy"
  })
}

# Worker egress to RabbitMQ (AMQPS)
resource "aws_security_group_rule" "gp_worker_to_rabbitmq" {
  type                     = "egress"
  from_port                = 5671
  to_port                  = 5671
  protocol                 = "tcp"
  security_group_id        = aws_security_group.gp_worker.id
  source_security_group_id = aws_security_group.rabbitmq.id
  description              = "Allow AMQPS to RabbitMQ"
}

# Worker egress to Redis
resource "aws_security_group_rule" "gp_worker_to_redis" {
  type                     = "egress"
  from_port                = 6379
  to_port                  = 6379
  protocol                 = "tcp"
  security_group_id        = aws_security_group.gp_worker.id
  source_security_group_id = aws_security_group.redis.id
  description              = "Allow Redis access"
}

# Worker egress to PostgreSQL
resource "aws_security_group_rule" "gp_worker_to_postgres" {
  type                     = "egress"
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  security_group_id        = aws_security_group.gp_worker.id
  source_security_group_id = aws_security_group.rds.id
  description              = "Allow PostgreSQL access"
}

# Worker egress to HTTPS (Discord REST API, CloudWatch)
resource "aws_security_group_rule" "gp_worker_https" {
  type              = "egress"
  from_port         = 443
  to_port           = 443
  protocol          = "tcp"
  security_group_id = aws_security_group.gp_worker.id
  cidr_blocks       = ["0.0.0.0/0"]
  description       = "Allow HTTPS for Discord REST API"
}

# Worker egress to NATS
resource "aws_security_group_rule" "gp_worker_to_nats" {
  type                     = "egress"
  from_port                = 4222
  to_port                  = 4222
  protocol                 = "tcp"
  security_group_id        = aws_security_group.gp_worker.id
  source_security_group_id = aws_security_group.nats.id
  description              = "Allow NATS access"
}

# Allow NATS ingress from GP Worker
resource "aws_security_group_rule" "nats_from_gp_worker" {
  type                     = "ingress"
  from_port                = 4222
  to_port                  = 4222
  protocol                 = "tcp"
  security_group_id        = aws_security_group.nats.id
  source_security_group_id = aws_security_group.gp_worker.id
  description              = "NATS client from GP worker"
}

# Allow RabbitMQ ingress from Worker
resource "aws_security_group_rule" "rabbitmq_from_gp_worker" {
  type                     = "ingress"
  from_port                = 5671
  to_port                  = 5671
  protocol                 = "tcp"
  security_group_id        = aws_security_group.rabbitmq.id
  source_security_group_id = aws_security_group.gp_worker.id
  description              = "Allow AMQPS from GP Worker"
}

# Allow Redis ingress from Worker
resource "aws_security_group_rule" "redis_from_gp_worker" {
  type                     = "ingress"
  from_port                = 6379
  to_port                  = 6379
  protocol                 = "tcp"
  security_group_id        = aws_security_group.redis.id
  source_security_group_id = aws_security_group.gp_worker.id
  description              = "Allow Redis from GP Worker"
}

# Allow PostgreSQL ingress from Worker
resource "aws_security_group_rule" "postgres_from_gp_worker" {
  type                     = "ingress"
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  security_group_id        = aws_security_group.rds.id
  source_security_group_id = aws_security_group.gp_worker.id
  description              = "Allow PostgreSQL from GP Worker"
}

# Worker Task Definition
resource "aws_ecs_task_definition" "gp_worker" {
  family                   = "${local.name_prefix}-gp-worker"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.gp_worker_cpu
  memory                   = var.gp_worker_memory
  execution_role_arn       = aws_iam_role.ecs_execution_gp_worker.arn # Sprint 94: Least-privilege IAM
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name  = "gp-worker"
      image = "${aws_ecr_repository.gp_worker.repository_url}:${var.environment}"

      essential = true

      environment = [
        {
          name  = "NODE_ENV"
          value = var.environment
        },
        {
          name  = "LOG_LEVEL"
          value = var.log_level
        },
        {
          name  = "HEALTH_PORT"
          value = "8080"
        },
        {
          name  = "MEMORY_THRESHOLD_MB"
          value = tostring(var.gp_worker_memory * 0.85)
        },
        {
          name  = "INTERACTION_PREFETCH"
          value = "5"
        },
        {
          name  = "EVENT_PREFETCH"
          value = "10"
        },
        # NATS connection via DNS-based service discovery
        {
          name  = "NATS_URL"
          value = "nats://nats.${local.name_prefix}.local:4222"
        }
      ]

      secrets = [
        {
          name      = "RABBITMQ_URL"
          valueFrom = aws_secretsmanager_secret.rabbitmq_credentials.arn
        },
        {
          name      = "REDIS_URL"
          valueFrom = "${aws_secretsmanager_secret.redis_credentials.arn}:url::"
        },
        {
          name      = "DATABASE_URL"
          valueFrom = "${aws_secretsmanager_secret.db_credentials.arn}:url::"
        },
        {
          name      = "DISCORD_APPLICATION_ID"
          valueFrom = "${data.aws_secretsmanager_secret.app_config.arn}:DISCORD_APPLICATION_ID::"
        },
        {
          name      = "DISCORD_BOT_TOKEN"
          valueFrom = "${data.aws_secretsmanager_secret.app_config.arn}:DISCORD_BOT_TOKEN::"
        }
      ]

      portMappings = [
        {
          containerPort = 8080
          hostPort      = 8080
          protocol      = "tcp"
        }
      ]

      healthCheck = {
        command     = ["CMD-SHELL", "curl -f http://localhost:8080/health || exit 1"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 60
      }

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.gp_worker.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "gp-worker"
        }
      }
    }
  ])

  tags = merge(local.common_tags, {
    Service = "GatewayProxy"
  })
}

# Worker Service
resource "aws_ecs_service" "gp_worker" {
  name            = "${local.name_prefix}-gp-worker"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.gp_worker.arn
  desired_count   = var.gp_worker_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = module.vpc.private_subnets
    security_groups  = [aws_security_group.gp_worker.id]
    assign_public_ip = false
  }

  # No load balancer - Worker makes outbound connections only

  deployment_maximum_percent         = 200
  deployment_minimum_healthy_percent = 100

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  # No Service Connect needed - using DNS-based service discovery for NATS

  tags = merge(local.common_tags, {
    Service = "GatewayProxy"
  })
}

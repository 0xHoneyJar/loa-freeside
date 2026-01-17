# PgBouncer - Connection Pooler for PostgreSQL
# Sprint S-1: Foundation Hardening
#
# Deploys PgBouncer as an ECS service to pool PostgreSQL connections
# and prevent connection exhaustion at scale.

# CloudWatch Log Group for PgBouncer
resource "aws_cloudwatch_log_group" "pgbouncer" {
  name              = "/ecs/${local.name_prefix}/pgbouncer"
  retention_in_days = 30

  tags = local.common_tags
}

# Security group for PgBouncer
resource "aws_security_group" "pgbouncer" {
  name_prefix = "${local.name_prefix}-pgbouncer-"
  vpc_id      = module.vpc.vpc_id

  # Allow connections from ECS tasks
  ingress {
    from_port       = 6432
    to_port         = 6432
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs_tasks.id]
    description     = "PgBouncer from ECS tasks"
  }

  # Allow connections from workers specifically
  ingress {
    from_port       = 6432
    to_port         = 6432
    protocol        = "tcp"
    security_groups = [aws_security_group.worker.id]
    description     = "PgBouncer from workers"
  }

  # Allow outbound to RDS
  egress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.rds.id]
    description     = "PgBouncer to RDS"
  }

  # Allow outbound HTTPS for secrets manager
  egress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "HTTPS for AWS APIs"
  }

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-pgbouncer-sg"
  })
}

# Update RDS security group to allow PgBouncer
resource "aws_security_group_rule" "rds_from_pgbouncer" {
  type                     = "ingress"
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.pgbouncer.id
  security_group_id        = aws_security_group.rds.id
  description              = "PostgreSQL from PgBouncer"
}

# ECS Task Definition for PgBouncer
resource "aws_ecs_task_definition" "pgbouncer" {
  family                   = "${local.name_prefix}-pgbouncer"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name      = "pgbouncer"
      image     = "edoburu/pgbouncer:1.21.0"
      essential = true

      portMappings = [
        {
          containerPort = 6432
          hostPort      = 6432
          protocol      = "tcp"
        }
      ]

      environment = [
        {
          name  = "POOL_MODE"
          value = "transaction"
        },
        {
          name  = "MAX_CLIENT_CONN"
          value = tostring(var.pgbouncer_max_client_conn)
        },
        {
          name  = "DEFAULT_POOL_SIZE"
          value = tostring(var.pgbouncer_default_pool_size)
        },
        {
          name  = "MIN_POOL_SIZE"
          value = "5"
        },
        {
          name  = "RESERVE_POOL_SIZE"
          value = "5"
        },
        {
          name  = "SERVER_IDLE_TIMEOUT"
          value = "300"
        },
        {
          name  = "QUERY_TIMEOUT"
          value = "30"
        },
        {
          name  = "STATS_PERIOD"
          value = "60"
        },
        {
          name  = "ADMIN_USERS"
          value = "arrakis_admin"
        },
        {
          name  = "AUTH_TYPE"
          value = "md5"
        }
      ]

      secrets = [
        {
          name      = "DATABASE_URL"
          valueFrom = "${aws_secretsmanager_secret.db_credentials.arn}:url::"
        },
        {
          name      = "DB_HOST"
          valueFrom = "${aws_secretsmanager_secret.db_credentials.arn}:host::"
        },
        {
          name      = "DB_USER"
          valueFrom = "${aws_secretsmanager_secret.db_credentials.arn}:username::"
        },
        {
          name      = "DB_PASSWORD"
          valueFrom = "${aws_secretsmanager_secret.db_credentials.arn}:password::"
        }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.pgbouncer.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "pgbouncer"
        }
      }

      healthCheck = {
        command     = ["CMD-SHELL", "pg_isready -h localhost -p 6432 -U arrakis_admin || exit 1"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 60
      }
    }
  ])

  tags = local.common_tags
}

# ECS Service for PgBouncer
resource "aws_ecs_service" "pgbouncer" {
  name            = "${local.name_prefix}-pgbouncer"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.pgbouncer.arn
  desired_count   = var.pgbouncer_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = module.vpc.private_subnets
    security_groups  = [aws_security_group.pgbouncer.id]
    assign_public_ip = false
  }

  # Service discovery for internal DNS
  service_registries {
    registry_arn = aws_service_discovery_service.pgbouncer.arn
  }

  tags = local.common_tags
}

# Service Discovery for PgBouncer
resource "aws_service_discovery_private_dns_namespace" "main" {
  count = var.enable_service_discovery ? 1 : 0

  name        = "${local.name_prefix}.local"
  description = "Private DNS namespace for ${local.name_prefix}"
  vpc         = module.vpc.vpc_id

  tags = local.common_tags
}

resource "aws_service_discovery_service" "pgbouncer" {
  name = "pgbouncer"

  dns_config {
    namespace_id = var.enable_service_discovery ? aws_service_discovery_private_dns_namespace.main[0].id : null

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

# Store PgBouncer connection info in Secrets Manager
resource "aws_secretsmanager_secret" "pgbouncer_credentials" {
  name                    = "${local.name_prefix}/pgbouncer"
  recovery_window_in_days = 7

  tags = local.common_tags
}

resource "aws_secretsmanager_secret_version" "pgbouncer_credentials" {
  secret_id = aws_secretsmanager_secret.pgbouncer_credentials.id
  secret_string = jsonencode({
    host = var.enable_service_discovery ? "pgbouncer.${local.name_prefix}.local" : "localhost"
    port = 6432
    url  = "postgresql://${aws_db_instance.main.username}:${random_password.db_password.result}@pgbouncer.${local.name_prefix}.local:6432/${aws_db_instance.main.db_name}?sslmode=prefer"
  })
}

# Output for other services to use
output "pgbouncer_endpoint" {
  description = "PgBouncer service discovery endpoint"
  value       = var.enable_service_discovery ? "pgbouncer.${local.name_prefix}.local:6432" : null
}

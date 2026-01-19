# Amazon MQ (RabbitMQ) for Gateway Proxy Pattern
# Decouples Discord Gateway from business logic workers

# RabbitMQ Broker
resource "aws_mq_broker" "rabbitmq" {
  broker_name = "${local.name_prefix}-rabbitmq"

  engine_type         = "RabbitMQ"
  engine_version      = "3.13"
  host_instance_type  = var.rabbitmq_instance_type
  # CLUSTER_MULTI_AZ requires mq.m5.large or larger; t3.micro only supports SINGLE_INSTANCE
  deployment_mode     = can(regex("^mq\\.(m5|m6|r5|r6)", var.rabbitmq_instance_type)) && var.environment == "production" ? "CLUSTER_MULTI_AZ" : "SINGLE_INSTANCE"
  publicly_accessible = false

  # Authentication
  user {
    username = "arrakis"
    password = random_password.rabbitmq_password.result
  }

  # Network configuration - SINGLE_INSTANCE requires single subnet, CLUSTER_MULTI_AZ requires multiple
  subnet_ids      = can(regex("^mq\\.(m5|m6|r5|r6)", var.rabbitmq_instance_type)) && var.environment == "production" ? module.vpc.private_subnets : [module.vpc.private_subnets[0]]
  security_groups = [aws_security_group.rabbitmq.id]

  # Maintenance window (early morning UTC)
  maintenance_window_start_time {
    day_of_week = "SUNDAY"
    time_of_day = "03:00"
    time_zone   = "UTC"
  }

  # Logging
  logs {
    general = true
  }

  # Auto minor version upgrades
  auto_minor_version_upgrade = true

  tags = merge(local.common_tags, {
    Name    = "${local.name_prefix}-rabbitmq"
    Service = "GatewayProxy"
  })
}

# Generate secure password for RabbitMQ
resource "random_password" "rabbitmq_password" {
  length  = 32
  special = false # RabbitMQ password restrictions
}

# Security Group for RabbitMQ
resource "aws_security_group" "rabbitmq" {
  name_prefix = "${local.name_prefix}-rabbitmq-"
  vpc_id      = module.vpc.vpc_id
  description = "Security group for Amazon MQ RabbitMQ broker"

  # Management Console (from VPC for debugging)
  ingress {
    description = "RabbitMQ Management Console"
    from_port   = 15671
    to_port     = 15671
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
  }

  # No egress restrictions needed for managed service
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-rabbitmq-sg"
  })

  lifecycle {
    create_before_destroy = true
  }
}

# Separate security group rules to avoid circular dependency
# AMQPS from ECS tasks (Workers)
resource "aws_security_group_rule" "rabbitmq_from_ecs" {
  type                     = "ingress"
  from_port                = 5671
  to_port                  = 5671
  protocol                 = "tcp"
  security_group_id        = aws_security_group.rabbitmq.id
  source_security_group_id = aws_security_group.ecs_tasks.id
  description              = "AMQPS from ECS Worker tasks"
}

# AMQPS from Ingestor (separate rule to avoid cycle)
resource "aws_security_group_rule" "rabbitmq_from_ingestor" {
  type                     = "ingress"
  from_port                = 5671
  to_port                  = 5671
  protocol                 = "tcp"
  security_group_id        = aws_security_group.rabbitmq.id
  source_security_group_id = aws_security_group.ingestor.id
  description              = "AMQPS from Ingestor service"
}

# Store RabbitMQ credentials in AWS Secrets Manager
resource "aws_secretsmanager_secret" "rabbitmq_credentials" {
  name                    = "${local.name_prefix}/rabbitmq"
  description             = "RabbitMQ connection credentials for Gateway Proxy"
  recovery_window_in_days = 7
  kms_key_id              = aws_kms_key.secrets.id # Sprint 95: A-94.1 - Customer-managed KMS encryption

  tags = merge(local.common_tags, {
    Service = "RabbitMQ"
    Sprint  = "95"
  })
}

resource "aws_secretsmanager_secret_version" "rabbitmq_credentials" {
  secret_id = aws_secretsmanager_secret.rabbitmq_credentials.id
  secret_string = jsonencode({
    host           = aws_mq_broker.rabbitmq.instances[0].endpoints[0]
    username       = "arrakis"
    password       = random_password.rabbitmq_password.result
    url            = "amqps://arrakis:${random_password.rabbitmq_password.result}@${replace(aws_mq_broker.rabbitmq.instances[0].endpoints[0], "amqps://", "")}"
    management_url = "https://${replace(aws_mq_broker.rabbitmq.instances[0].console_url, "https://", "")}"
  })
}

# CloudWatch Log Group for RabbitMQ
resource "aws_cloudwatch_log_group" "rabbitmq" {
  name              = "/aws/amazonmq/${local.name_prefix}-rabbitmq"
  retention_in_days = 30

  tags = local.common_tags
}

# Allow ECS execution role to read RabbitMQ secret
resource "aws_iam_role_policy" "ecs_execution_rabbitmq_secrets" {
  name = "${local.name_prefix}-ecs-execution-rabbitmq-secrets"
  role = aws_iam_role.ecs_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue"
        ]
        Resource = [
          aws_secretsmanager_secret.rabbitmq_credentials.arn
        ]
      }
    ]
  })
}

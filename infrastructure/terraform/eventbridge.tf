# =============================================================================
# EventBridge Scheduled Rules — Economic Lifecycle Tasks
#
# Cycle 037, Sprint 0B: Conservation guard sweep + lot expiry sweep
# Cycle 037, Sprint 2:  NOWPayments reconciliation sweep
#
# These scheduled rules trigger ECS Fargate tasks on fixed intervals.
# No Redis dependency — they run independently and operate on PostgreSQL.
# =============================================================================

# -----------------------------------------------------------------------------
# CloudWatch Log Group for scheduled tasks
# -----------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "scheduled_tasks" {
  name              = "/ecs/${local.name_prefix}/scheduled-tasks"
  retention_in_days = 30

  tags = merge(local.common_tags, {
    Sprint = "C037-0B"
  })
}

# -----------------------------------------------------------------------------
# IAM Role for EventBridge to invoke ECS tasks
# -----------------------------------------------------------------------------

resource "aws_iam_role" "eventbridge_ecs" {
  name = "${local.name_prefix}-eventbridge-ecs"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "events.amazonaws.com"
      }
    }]
  })

  tags = merge(local.common_tags, {
    Sprint = "C037-0B"
  })
}

resource "aws_iam_role_policy" "eventbridge_ecs_run_task" {
  name = "${local.name_prefix}-eventbridge-run-task"
  role = aws_iam_role.eventbridge_ecs.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "RunTask"
        Effect = "Allow"
        Action = "ecs:RunTask"
        Resource = [
          aws_ecs_task_definition.conservation_sweep.arn,
          aws_ecs_task_definition.lot_expiry_sweep.arn,
          aws_ecs_task_definition.nowpayments_reconciliation.arn,
        ]
        Condition = {
          ArnEquals = {
            "ecs:cluster" = aws_ecs_cluster.main.arn
          }
        }
      },
      {
        Sid    = "PassRole"
        Effect = "Allow"
        Action = "iam:PassRole"
        Resource = [
          aws_iam_role.ecs_execution.arn,
          aws_iam_role.ecs_task.arn,
        ]
      }
    ]
  })
}

# -----------------------------------------------------------------------------
# Conservation Guard Sweep — Every 60 seconds
# Checks I-1, I-2, I-3 invariants. Cursor-based reconciliation.
# -----------------------------------------------------------------------------

resource "aws_ecs_task_definition" "conservation_sweep" {
  family                   = "${local.name_prefix}-conservation-sweep"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name      = "conservation-sweep"
      image     = "${aws_ecr_repository.api.repository_url}:staging"
      essential = true
      command   = ["node", "dist/jobs/conservation-sweep.js"]

      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "LOG_LEVEL", value = "info" },
        { name = "TASK_TYPE", value = "conservation-sweep" }
      ]

      secrets = [
        { name = "DATABASE_URL", valueFrom = "${aws_secretsmanager_secret.db_credentials.arn}:url::" },
        { name = "REDIS_URL", valueFrom = "${aws_secretsmanager_secret.redis_credentials.arn}:url::" }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.scheduled_tasks.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "conservation-sweep"
        }
      }
    }
  ])

  tags = merge(local.common_tags, {
    Service = "ConservationSweep"
    Sprint  = "C037-0B"
  })
}

resource "aws_cloudwatch_event_rule" "conservation_sweep" {
  name                = "${local.name_prefix}-conservation-sweep"
  description         = "Conservation guard sweep — invariant check + cursor reconciliation (every 60s)"
  schedule_expression = "rate(1 minute)"
  state               = "ENABLED"

  tags = merge(local.common_tags, {
    Sprint = "C037-0B"
  })
}

resource "aws_cloudwatch_event_target" "conservation_sweep" {
  rule     = aws_cloudwatch_event_rule.conservation_sweep.name
  arn      = aws_ecs_cluster.main.arn
  role_arn = aws_iam_role.eventbridge_ecs.arn

  ecs_target {
    task_definition_arn = aws_ecs_task_definition.conservation_sweep.arn
    task_count          = 1
    launch_type         = "FARGATE"

    network_configuration {
      subnets          = var.private_subnet_ids
      security_groups  = [aws_security_group.ecs.id]
      assign_public_ip = false
    }
  }
}

# -----------------------------------------------------------------------------
# Lot Expiry Sweep — Every 5 minutes
# Finds expired lots, creates expiry entries, adjusts Redis limits.
# -----------------------------------------------------------------------------

resource "aws_ecs_task_definition" "lot_expiry_sweep" {
  family                   = "${local.name_prefix}-lot-expiry-sweep"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name      = "lot-expiry-sweep"
      image     = "${aws_ecr_repository.api.repository_url}:staging"
      essential = true
      command   = ["node", "dist/jobs/lot-expiry-sweep.js"]

      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "LOG_LEVEL", value = "info" },
        { name = "TASK_TYPE", value = "lot-expiry-sweep" }
      ]

      secrets = [
        { name = "DATABASE_URL", valueFrom = "${aws_secretsmanager_secret.db_credentials.arn}:url::" },
        { name = "REDIS_URL", valueFrom = "${aws_secretsmanager_secret.redis_credentials.arn}:url::" }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.scheduled_tasks.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "lot-expiry-sweep"
        }
      }
    }
  ])

  tags = merge(local.common_tags, {
    Service = "LotExpirySweep"
    Sprint  = "C037-0B"
  })
}

resource "aws_cloudwatch_event_rule" "lot_expiry_sweep" {
  name                = "${local.name_prefix}-lot-expiry-sweep"
  description         = "Lot expiry sweep — expire lots past expires_at, adjust Redis limits (every 5 min)"
  schedule_expression = "rate(5 minutes)"
  state               = "ENABLED"

  tags = merge(local.common_tags, {
    Sprint = "C037-0B"
  })
}

resource "aws_cloudwatch_event_target" "lot_expiry_sweep" {
  rule     = aws_cloudwatch_event_rule.lot_expiry_sweep.name
  arn      = aws_ecs_cluster.main.arn
  role_arn = aws_iam_role.eventbridge_ecs.arn

  ecs_target {
    task_definition_arn = aws_ecs_task_definition.lot_expiry_sweep.arn
    task_count          = 1
    launch_type         = "FARGATE"

    network_configuration {
      subnets          = var.private_subnet_ids
      security_groups  = [aws_security_group.ecs.id]
      assign_public_ip = false
    }
  }
}

# -----------------------------------------------------------------------------
# NOWPayments Reconciliation Sweep — Every 5 minutes
# Polls NOWPayments API for stuck payments. Idempotent lot minting for
# missed webhooks. Operates independently of Redis availability.
# Sprint 2, Task 2.2 (F-19)
# -----------------------------------------------------------------------------

resource "aws_ecs_task_definition" "nowpayments_reconciliation" {
  family                   = "${local.name_prefix}-nowpayments-reconciliation"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name      = "nowpayments-reconciliation"
      image     = "${aws_ecr_repository.api.repository_url}:staging"
      essential = true
      command   = ["node", "dist/jobs/nowpayments-reconciliation.js"]

      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "LOG_LEVEL", value = "info" },
        { name = "TASK_TYPE", value = "nowpayments-reconciliation" },
        { name = "RECONCILIATION_MIN_AGE_MINS", value = "10" },
        { name = "RECONCILIATION_BATCH_SIZE", value = "50" }
      ]

      secrets = [
        { name = "DATABASE_URL", valueFrom = "${aws_secretsmanager_secret.db_credentials.arn}:url::" },
        { name = "REDIS_URL", valueFrom = "${aws_secretsmanager_secret.redis_credentials.arn}:url::" },
        { name = "NOWPAYMENTS_API_KEY", valueFrom = "${aws_secretsmanager_secret.nowpayments_credentials.arn}:api_key::" }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.scheduled_tasks.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "nowpayments-reconciliation"
        }
      }
    }
  ])

  tags = merge(local.common_tags, {
    Service = "NowpaymentsReconciliation"
    Sprint  = "C037-2"
  })
}

resource "aws_cloudwatch_event_rule" "nowpayments_reconciliation" {
  name                = "${local.name_prefix}-nowpayments-reconciliation"
  description         = "NOWPayments reconciliation sweep — poll stuck payments, idempotent lot mint (every 5 min)"
  schedule_expression = "rate(5 minutes)"
  state               = "ENABLED"

  tags = merge(local.common_tags, {
    Sprint = "C037-2"
  })
}

resource "aws_cloudwatch_event_target" "nowpayments_reconciliation" {
  rule     = aws_cloudwatch_event_rule.nowpayments_reconciliation.name
  arn      = aws_ecs_cluster.main.arn
  role_arn = aws_iam_role.eventbridge_ecs.arn

  ecs_target {
    task_definition_arn = aws_ecs_task_definition.nowpayments_reconciliation.arn
    task_count          = 1
    launch_type         = "FARGATE"

    network_configuration {
      subnets          = var.private_subnet_ids
      security_groups  = [aws_security_group.ecs.id]
      assign_public_ip = false
    }
  }
}

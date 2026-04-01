# =============================================================================
# World Module — ECS Task Definition + Service
# =============================================================================

# -----------------------------------------------------------------------------
# Task Definition
# -----------------------------------------------------------------------------

resource "aws_ecs_task_definition" "world" {
  family                   = local.world_name
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.cpu
  memory                   = var.memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  volume {
    name = "world-data"

    efs_volume_configuration {
      file_system_id          = var.efs_file_system_id
      transit_encryption      = "ENABLED"
      authorization_configuration {
        access_point_id = aws_efs_access_point.world.id
        iam             = "ENABLED"
      }
    }
  }

  container_definitions = jsonencode([
    {
      name      = var.name
      image     = "${aws_ecr_repository.world.repository_url}:${var.image_tag}"
      essential = true
      cpu       = var.cpu
      memory    = var.memory

      portMappings = [
        {
          containerPort = var.port
          protocol      = "tcp"
        }
      ]

      mountPoints = [
        {
          sourceVolume  = "world-data"
          containerPath = "/data"
          readOnly      = false
        }
      ]

      environment = [for k, v in local.all_env : { name = k, value = tostring(v) }]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.world.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = var.name
        }
      }

      healthCheck = {
        command     = ["CMD-SHELL", "wget -qO- http://localhost:${var.port}${var.health_check_path} || exit 1"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 60
      }
    }
  ])

  tags = local.tags
}

# -----------------------------------------------------------------------------
# ECS Service
# -----------------------------------------------------------------------------

resource "aws_ecs_service" "world" {
  name            = local.world_name
  cluster         = var.cluster_id
  task_definition = aws_ecs_task_definition.world.arn
  desired_count   = var.desired_count

  # Fargate Spot with on-demand fallback
  capacity_provider_strategy {
    capacity_provider = "FARGATE_SPOT"
    weight            = 100
    base              = 0
  }

  capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 1
    base              = 0
  }

  # Stop-then-start for SQLite safety (no concurrent tasks sharing EFS DB)
  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 100
  health_check_grace_period_seconds  = 60

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = var.private_subnets
    security_groups  = [aws_security_group.world.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.world.arn
    container_name   = var.name
    container_port   = var.port
  }

  enable_execute_command = true

  tags = local.tags

  lifecycle {
    ignore_changes = [desired_count]
  }
}

# =============================================================================
# World Module — ALB Target Group + Listener Rule
# =============================================================================

resource "aws_lb_target_group" "world" {
  name                 = "${var.name_prefix}-w-${var.name}"
  port                 = var.port
  protocol             = "HTTP"
  vpc_id               = var.vpc_id
  target_type          = "ip"
  deregistration_delay = 30

  health_check {
    path                = var.health_check_path
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
    matcher             = "200-399"
  }

  tags = local.tags
}

resource "aws_lb_listener_rule" "world" {
  listener_arn = var.alb_listener_arn
  priority     = local.alb_priority

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.world.arn
  }

  condition {
    host_header {
      values = [local.subdomain]
    }
  }

  tags = local.tags
}

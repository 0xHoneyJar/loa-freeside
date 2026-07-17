# =============================================================================
# World Module — Health Monitoring
# =============================================================================
# Added 2026-07-17 (void-alarm audit): the worlds are the platform's live
# surface but had zero alarm coverage — staging rektdrop and score-api were
# broken for months with no signal. See
# grimoires/loa/context/2026-07-17-arrakis-void-alarm-audit.md
# =============================================================================

resource "aws_cloudwatch_metric_alarm" "world_health_check_failure" {
  count = var.alerts_topic_arn != "" ? 1 : 0

  alarm_name          = "${var.name_prefix}-world-${var.name}-health-check-failure"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 3
  metric_name         = "HealthyHostCount"
  namespace           = "AWS/ApplicationELB"
  period              = 60
  statistic           = "Minimum"
  threshold           = 1
  alarm_description   = "World ${var.name} has no healthy targets — world is DOWN or failing to place tasks (check ECS service events for image-pull/secrets errors)."
  treat_missing_data  = "breaching"

  # Self-disabling: a world deliberately scaled to zero must not page.
  actions_enabled = var.desired_count > 0

  dimensions = {
    TargetGroup  = aws_lb_target_group.world.arn_suffix
    LoadBalancer = var.alb_arn_suffix
  }

  alarm_actions = [var.alerts_topic_arn]
  ok_actions    = [var.alerts_topic_arn]

  lifecycle {
    # Prevent a mis-dimensioned alarm: with an empty LoadBalancer dimension the
    # alarm would sit on missing data forever (treat_missing_data = breaching →
    # permanent false ALARM). Hard-fail at plan time instead.
    precondition {
      condition     = var.alb_arn_suffix != ""
      error_message = "alb_arn_suffix must be set when alerts_topic_arn is provided — the HealthyHostCount alarm needs the shared ALB dimension."
    }
  }

  tags = local.tags
}

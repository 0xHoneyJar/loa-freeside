# =============================================================================
# Dixie Auto-Scaling Configuration
# Cycle 046: Armitage Platform — Sprint 2, Task 2.1
# SDD §3.8: autoscaling-dixie.tf
# =============================================================================
#
# AppAutoScaling target + CPU-based scaling policy for Dixie service.

resource "aws_appautoscaling_target" "dixie" {
  max_capacity       = var.dixie_max_count
  min_capacity       = var.dixie_desired_count
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.dixie.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "dixie_cpu" {
  name               = "${local.name_prefix}-dixie-cpu-scaling"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.dixie.resource_id
  scalable_dimension = aws_appautoscaling_target.dixie.scalable_dimension
  service_namespace  = aws_appautoscaling_target.dixie.service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value       = var.autoscaling_cpu_target
    scale_in_cooldown  = var.autoscaling_scale_in_cooldown
    scale_out_cooldown = var.autoscaling_scale_out_cooldown
  }
}

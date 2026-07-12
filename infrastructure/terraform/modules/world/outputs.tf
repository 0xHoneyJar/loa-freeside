# =============================================================================
# World Module — Outputs
# =============================================================================

output "ecr_repository_url" {
  description = "ECR repository URL for CI to push images"
  value       = aws_ecr_repository.world.repository_url
}

output "service_name" {
  description = "ECS service name"
  value       = aws_ecs_service.world.name
}

output "ci_deploy_role_arn" {
  description = "IAM role ARN for GitHub Actions CI deploy"
  value       = aws_iam_role.ci_deploy.arn
}

output "target_group_arn" {
  description = "ALB target group ARN"
  value       = aws_lb_target_group.world.arn
}

output "subdomain" {
  description = "World subdomain"
  value       = local.subdomain
}

output "efs_access_point_arn" {
  description = "EFS access point ARN for this world"
  value       = aws_efs_access_point.world.arn
}

output "alb_priority" {
  description = "Computed ALB listener rule priority"
  value       = local.alb_priority
}

output "security_group_id" {
  description = "World security group ID"
  value       = aws_security_group.world.id
}

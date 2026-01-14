output "vpc_id" {
  description = "VPC ID"
  value       = module.vpc.vpc_id
}

output "ecs_cluster_name" {
  description = "ECS Cluster name"
  value       = aws_ecs_cluster.main.name
}

output "alb_dns_name" {
  description = "ALB DNS name"
  value       = aws_lb.main.dns_name
}

output "ecr_repository_url" {
  description = "ECR repository URL"
  value       = aws_ecr_repository.api.repository_url
}

output "rds_endpoint" {
  description = "RDS endpoint"
  value       = aws_db_instance.main.endpoint
  sensitive   = true
}

output "redis_endpoint" {
  description = "Redis endpoint"
  value       = aws_elasticache_replication_group.main.primary_endpoint_address
  sensitive   = true
}

output "cloudwatch_dashboard_url" {
  description = "CloudWatch dashboard URL"
  value       = "https://${var.aws_region}.console.aws.amazon.com/cloudwatch/home?region=${var.aws_region}#dashboards:name=${aws_cloudwatch_dashboard.main.dashboard_name}"
}

output "acm_certificate_validation" {
  description = "ACM certificate DNS validation records"
  value       = aws_acm_certificate.main.domain_validation_options
}

output "db_credentials_secret_arn" {
  description = "ARN of the database credentials secret"
  value       = aws_secretsmanager_secret.db_credentials.arn
}

output "redis_credentials_secret_arn" {
  description = "ARN of the Redis credentials secret"
  value       = aws_secretsmanager_secret.redis_credentials.arn
}

# Gateway Proxy Pattern - RabbitMQ
output "rabbitmq_broker_id" {
  description = "Amazon MQ RabbitMQ broker ID"
  value       = aws_mq_broker.rabbitmq.id
}

output "rabbitmq_endpoint" {
  description = "RabbitMQ AMQPS endpoint"
  value       = aws_mq_broker.rabbitmq.instances[0].endpoints[0]
  sensitive   = true
}

output "rabbitmq_management_url" {
  description = "RabbitMQ management console URL"
  value       = aws_mq_broker.rabbitmq.instances[0].console_url
}

output "rabbitmq_credentials_secret_arn" {
  description = "ARN of the RabbitMQ credentials secret"
  value       = aws_secretsmanager_secret.rabbitmq_credentials.arn
}

# Gateway Proxy Pattern - Ingestor
output "ingestor_ecr_repository_url" {
  description = "Ingestor ECR repository URL"
  value       = aws_ecr_repository.ingestor.repository_url
}

# =============================================================================
# Staging Environment Configuration
# =============================================================================
# This file contains staging-specific variable values.
# Staging uses reduced resources for cost optimization.
#
# Usage:
#   terraform workspace select staging (or create if needed)
#   terraform plan -var-file=environments/staging/terraform.tfvars
#   terraform apply -var-file=environments/staging/terraform.tfvars
# =============================================================================

environment = "staging"

# VPC - Same structure, different CIDR to avoid conflicts if peered
vpc_cidr = "10.1.0.0/16"

# ECS - Reduced sizing for staging
api_cpu           = 256
api_memory        = 512
api_desired_count = 1

# RDS - Minimal sizing for staging (gp3 requires minimum 20GB)
db_instance_class    = "db.t3.micro"
db_allocated_storage = 20

# ElastiCache - Same minimal instance
redis_node_type = "cache.t3.micro"

# Domain - Staging subdomain
domain_name = "staging.api.arrakis.community"

# Gateway Proxy - Ingestor (Sprint GW-2)
ingestor_cpu           = 256
ingestor_memory        = 512
ingestor_desired_count = 1  # Enable for Gateway Proxy testing

# Gateway Proxy - Worker (Sprint GW-3)
gp_worker_cpu           = 512
gp_worker_memory        = 1024
gp_worker_desired_count = 1  # Enable for Gateway Proxy testing

# RabbitMQ (Sprint GW-1)
rabbitmq_instance_type   = "mq.t3.micro"
rabbitmq_deployment_mode = "SINGLE_INSTANCE"  # Single instance for staging

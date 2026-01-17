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

# RabbitMQ (Sprint GW-1) - Legacy, will be replaced by NATS
rabbitmq_instance_type   = "mq.t3.micro"
rabbitmq_deployment_mode = "SINGLE_INSTANCE"  # Single instance for staging

# =============================================================================
# Part II SaaS Platform - New Infrastructure (Sprints S-1 to S-28)
# =============================================================================

# NATS JetStream (Sprint S-5) - Replaces RabbitMQ
nats_cpu           = 256
nats_memory        = 512
nats_desired_count = 1  # Single node for staging (3 for production)

# Rust Twilight Gateway (Sprint S-5) - Replaces Node.js Discord client
gateway_cpu           = 256
gateway_memory        = 512
gateway_desired_count = 1

# PgBouncer Connection Pooling (Sprint S-1)
pgbouncer_cpu               = 256
pgbouncer_memory            = 512
pgbouncer_desired_count     = 1
pgbouncer_max_client_conn   = 100
pgbouncer_default_pool_size = 10

# Service Discovery (Part II)
enable_service_discovery = true

# Auto-scaling (Sprint S-11)
autoscaling_cpu_target         = 70
autoscaling_memory_target      = 80
autoscaling_scale_in_cooldown  = 300
autoscaling_scale_out_cooldown = 60

# Coexistence Mode (Sprint S-22 to S-28)
# Possible values: shadow, parallel, arrakis_primary, instant
coexistence_mode = "shadow"  # Start with shadow mode for safe testing

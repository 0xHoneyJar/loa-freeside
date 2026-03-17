# =============================================================================
# Production Environment Configuration
# =============================================================================
# This file contains production-specific variable values.
# Production uses higher resource allocations for reliability.
#
# Usage:
#   terraform workspace select production (or create if needed)
#   terraform plan -var-file=environments/production/terraform.tfvars
#   terraform apply -var-file=environments/production/terraform.tfvars
# =============================================================================

environment = "production"

# VPC — Different CIDR to avoid conflicts if peered with staging
vpc_cidr = "10.0.0.0/16"

# Domain — Production serves on 0xhoneyjar.xyz
root_domain = "0xhoneyjar.xyz"
domain_name = "api.0xhoneyjar.xyz"

# ECS - Production sizing (2x staging for headroom)
api_cpu           = 512
api_memory        = 1024
api_desired_count = 2

# RDS - Production sizing (gp3 requires minimum 20GB)
db_instance_class    = "db.t3.small"
db_allocated_storage = 20

# ElastiCache - Same instance class, may upgrade to t3.small later
redis_node_type = "cache.t3.micro"

# Gateway Proxy - Ingestor (Sprint GW-2)
ingestor_cpu           = 256
ingestor_memory        = 512
ingestor_desired_count = 0  # Disabled: source has pre-existing TS build errors, never deployed

# Gateway Proxy - Worker (Sprint GW-3)
gp_worker_cpu           = 512
gp_worker_memory        = 1024
gp_worker_desired_count = 1  # SEC-4.4: NATS TLS now configured, re-enabled

# RabbitMQ (Sprint GW-1) - Legacy, will be replaced by NATS
rabbitmq_instance_type = "mq.t3.micro"

# =============================================================================
# Part II SaaS Platform - New Infrastructure (Sprints S-1 to S-28)
# =============================================================================

# NATS JetStream (Sprint S-5) - Replaces RabbitMQ
nats_cpu           = 512
nats_memory        = 1024
nats_desired_count = 3  # Production: 3-node cluster for HA

# Rust Twilight Gateway (Sprint S-5) - Replaces Node.js Discord client
gateway_cpu           = 256
gateway_memory        = 512
gateway_desired_count = 0  # Disabled: source never built/pushed to ECR
gateway_min_count     = 0  # Prevent autoscaling from restoring disabled service

# PgBouncer Connection Pooling (Sprint S-1)
# Connection budget math:
#   db.t3.small max_connections ≈ 150
#   PgBouncer-freeside pool: 40 server conns (API + worker + migration)
#   PgBouncer-dixie pool:    25 server conns (dixie service + migration)
#   PgBouncer-finn pool:     20 server conns (finn service, read-only)
#   Reserved:                15 (admin/monitoring/ECS Exec)
#   Buffer:                  50
#   Total:                  150
pgbouncer_desired_count     = 1
pgbouncer_max_client_conn   = 200
pgbouncer_default_pool_size = 20

# Service Discovery (Part II)
enable_service_discovery = true

# Auto-scaling (Sprint S-11)
autoscaling_cpu_target         = 70
autoscaling_memory_target      = 80
autoscaling_scale_in_cooldown  = 300
autoscaling_scale_out_cooldown = 60

# =============================================================================
# Hounfour Phase 4: Agent Gateway Feature Flags
# =============================================================================

# Agent gateway (baseline model routing)
agent_enabled = "true"

# Ensemble orchestration (multi-model routing)
ensemble_enabled = "true"

# BYOK key management (bring-your-own-key with Network Firewall)
byok_enabled = true

# =============================================================================
# loa-dixie Service (Cycle 044: Staging Integration)
# =============================================================================

dixie_cpu           = 512
dixie_memory        = 1024
dixie_desired_count = 1
dixie_max_count     = 4   # Production: allow scale-out to 4
dixie_image_tag     = "latest"  # Override with git SHA in CI/CD

# =============================================================================
# loa-finn Dedicated Redis (Cycle 046: Armitage Platform)
# =============================================================================

finn_redis_node_type = "cache.t3.micro"  # May upgrade to t3.small for production load

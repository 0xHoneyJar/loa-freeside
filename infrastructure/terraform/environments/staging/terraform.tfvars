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
api_desired_count = 0 # Ratified 2026-07-17: platform scaled to zero out-of-band; matches live ECS (void-alarm audit)

# Container Insights — disabled on staging to save ~$100/mo (production keeps it on
# for incident drill-down). The 5 dependent task-count alarms are conditioned on
# var.enable_container_insights and will not be created when this is false.
enable_container_insights = false

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
ingestor_desired_count = 0 # Disabled: source has pre-existing TS build errors, never deployed

# Gateway Proxy - Worker (Sprint GW-3)
gp_worker_cpu           = 512
gp_worker_memory        = 1024
gp_worker_desired_count = 0 # Ratified 2026-07-17: platform scaled to zero out-of-band; matches live ECS (void-alarm audit)

# RabbitMQ (Sprint GW-1) - Legacy, will be replaced by NATS
rabbitmq_instance_type   = "mq.t3.micro"
rabbitmq_deployment_mode = "SINGLE_INSTANCE" # Single instance for staging

# =============================================================================
# Part II SaaS Platform - New Infrastructure (Sprints S-1 to S-28)
# =============================================================================

# NATS JetStream (Sprint S-5) - Replaces RabbitMQ
nats_cpu           = 256
nats_memory        = 512
nats_desired_count = 0 # Ratified 2026-07-17: platform scaled to zero out-of-band; matches live ECS (void-alarm audit)

# Rust Twilight Gateway (Sprint S-5) - Replaces Node.js Discord client
gateway_cpu           = 256
gateway_memory        = 512
gateway_desired_count = 0 # Disabled: source never built/pushed to ECR, Rust build not validated
gateway_min_count     = 0 # Prevent autoscaling from restoring disabled service

# PgBouncer Connection Pooling (Sprint S-1)
# Connection budget math (Flatline BLOCKER SKP-003):
#   db.t3.micro max_connections ≈ 85
#   PgBouncer-freeside pool: 30 server conns (API + worker + migration)
#   PgBouncer-dixie pool:    20 server conns (dixie service + migration)
#   PgBouncer-finn pool:     15 server conns (finn service, read-only)
#   Reserved:                10 (admin/monitoring/ECS Exec)
#   Buffer:                  10
#   Total:                   85
pgbouncer_cpu               = 256
pgbouncer_memory            = 512
pgbouncer_desired_count     = 0 # Ratified 2026-07-17: platform scaled to zero out-of-band; matches live ECS (void-alarm audit)
pgbouncer_max_client_conn   = 100
pgbouncer_default_pool_size = 15

# Service Discovery (Part II)
enable_service_discovery = true

# Auto-scaling (Sprint S-11)
autoscaling_cpu_target         = 70
autoscaling_memory_target      = 80
autoscaling_scale_in_cooldown  = 300
autoscaling_scale_out_cooldown = 60

# Coexistence Mode (Sprint S-22 to S-28)
# Possible values: shadow, parallel, arrakis_primary, instant
coexistence_mode = "shadow" # Start with shadow mode for safe testing

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

dixie_cpu           = 256
dixie_memory        = 512
dixie_desired_count = 0        # Ratified 2026-07-17: platform scaled to zero out-of-band; matches live ECS (void-alarm audit)
dixie_max_count     = 2        # Staging: conservative auto-scaling ceiling
dixie_image_tag     = "latest" # Override with git SHA in CI/CD

# =============================================================================
# loa-finn Dedicated Redis (Cycle 046: Armitage Platform)
# =============================================================================

finn_redis_node_type = "cache.t3.micro" # Staging: minimal instance

# =============================================================================
# Feature Flags
# =============================================================================

feature_web_chat_enabled = "true" # Enable /chat page for Dixie testing
chat_allowed_addresses   = "0x40495A781095932e2FC8dccA69F5e358711Fdd41,0xE822ECAC55a3A20BB4b24cDd83401eAa73dD3Bb4,0x8A6498253d2557eEE41B813EcF980b1c3D7f4BBe"

# Finn runtime — scaled to zero out-of-band; explicit 0 prevents variables.tf default=1 resurrecting it on apply
finn_desired_count = 0

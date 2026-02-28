variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Deployment environment"
  type        = string
  default     = "production"
}

variable "vault_addr" {
  description = "HashiCorp Vault address"
  type        = string
  default     = ""
}

variable "vault_namespace" {
  description = "Vault namespace"
  type        = string
  default     = "admin"
}

# vault_token is now stored in Secrets Manager and referenced via data source
# Create it manually: aws secretsmanager create-secret --name arrakis-{env}/vault-token

# VPC
variable "vpc_cidr" {
  description = "VPC CIDR block"
  type        = string
  default     = "10.0.0.0/16"
}

variable "availability_zones" {
  description = "Availability zones"
  type        = list(string)
  default     = ["us-east-1a", "us-east-1b"]
}

# ECS
variable "api_cpu" {
  description = "API task CPU units"
  type        = number
  default     = 512
}

variable "api_memory" {
  description = "API task memory (MB)"
  type        = number
  default     = 1024
}

variable "api_desired_count" {
  description = "Desired API task count"
  type        = number
  default     = 2
}

# RDS
variable "db_instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t3.small"
}

variable "db_allocated_storage" {
  description = "RDS storage (GB)"
  type        = number
  default     = 20
}

# ElastiCache
variable "redis_node_type" {
  description = "Redis node type"
  type        = string
  default     = "cache.t3.micro"
}

# Domain
variable "root_domain" {
  description = "Root domain for Route 53 hosted zone"
  type        = string
  default     = "arrakis.community"
}

variable "domain_name" {
  description = "Domain name for SSL certificate (API endpoint)"
  type        = string
  default     = "api.arrakis.community"
}

# Amazon MQ (RabbitMQ) for Gateway Proxy Pattern
variable "rabbitmq_instance_type" {
  description = "Amazon MQ RabbitMQ instance type"
  type        = string
  default     = "mq.t3.micro" # Small for staging, mq.m5.large for production
}

# Ingestor Service
variable "ingestor_cpu" {
  description = "Ingestor task CPU units"
  type        = number
  default     = 256
}

variable "ingestor_memory" {
  description = "Ingestor task memory (MB)"
  type        = number
  default     = 512
}

variable "ingestor_desired_count" {
  description = "Desired Ingestor task count (1 per Discord shard group)"
  type        = number
  default     = 1
}

# Gateway Proxy Worker Service
variable "gp_worker_cpu" {
  description = "GP Worker task CPU units"
  type        = number
  default     = 256
}

variable "gp_worker_memory" {
  description = "GP Worker task memory (MB)"
  type        = number
  default     = 512
}

variable "gp_worker_desired_count" {
  description = "Desired GP Worker task count (can scale horizontally)"
  type        = number
  default     = 1
}

# PgBouncer Configuration (Sprint S-1 + C037-2: Pool Sizing)
# PostgreSQL max_connections=120, 20 reserved for admin = 100 available
# Per-service: API=60, worker=20, reconciliation=10, headroom=10
variable "pgbouncer_max_client_conn" {
  description = "Maximum client connections to PgBouncer"
  type        = number
  default     = 1000
}

variable "pgbouncer_default_pool_size" {
  description = "Default pool size per database/user pair (100 total via per-service pools)"
  type        = number
  default     = 25
}

variable "pgbouncer_desired_count" {
  description = "Desired PgBouncer task count"
  type        = number
  default     = 1
}

variable "pgbouncer_reserve_pool_timeout" {
  description = "Queue timeout in seconds — exceeding returns 503 Retry-After:5"
  type        = number
  default     = 5
}

variable "pgbouncer_server_idle_timeout" {
  description = "Server idle timeout in seconds"
  type        = number
  default     = 300
}

variable "enable_service_discovery" {
  description = "Enable AWS Cloud Map service discovery"
  type        = bool
  default     = true
}

# NATS JetStream Configuration (Sprint S-5: Scaling Phase 2)
variable "nats_cpu" {
  description = "NATS task CPU units"
  type        = number
  default     = 512
}

variable "nats_memory" {
  description = "NATS task memory (MB)"
  type        = number
  default     = 1024
}

variable "nats_desired_count" {
  description = "Desired NATS cluster node count (recommend 3 for HA)"
  type        = number
  default     = 3
}

# Gateway (Rust Twilight) Configuration (Sprint S-5)
variable "gateway_cpu" {
  description = "Gateway task CPU units"
  type        = number
  default     = 512
}

variable "gateway_memory" {
  description = "Gateway task memory (MB)"
  type        = number
  default     = 1024
}

variable "gateway_desired_count" {
  description = "Desired Gateway pool count (each manages 25 shards)"
  type        = number
  default     = 1
}

# =============================================================================
# Hounfour Phase 4: Agent Gateway
# =============================================================================

variable "agent_enabled" {
  description = "Enable agent gateway (AGENT_ENABLED env var)"
  type        = string
  default     = "false"
}

variable "ensemble_enabled" {
  description = "Enable ensemble orchestration (ENSEMBLE_ENABLED env var)"
  type        = string
  default     = "false"
}

variable "loa_finn_base_url" {
  description = "loa-finn service base URL (overridden by Cloud Map in production)"
  type        = string
  default     = "http://loa-finn:3000"
}

# Sprint 6 (319), Task 6.7: SIWE Auth
variable "siwe_session_secret_kid" {
  description = "Key ID (kid) for SIWE session secret routing"
  type        = string
  default     = "v1"
}

# Sprint 7 (320), Task 7.2: Slack alerting integration via AWS Chatbot
variable "slack_workspace_id" {
  description = "Slack workspace ID for AWS Chatbot integration (leave empty to disable)"
  type        = string
  default     = ""

  # Sprint 321 (medium-6): Validate Slack workspace ID format
  validation {
    condition     = var.slack_workspace_id == "" || can(regex("^T[A-Z0-9]+$", var.slack_workspace_id))
    error_message = "Must be empty or a valid Slack workspace ID (starts with T, e.g. T01ABCDEF)."
  }
}

variable "slack_channel_id" {
  description = "Slack channel ID for CloudWatch alarm notifications"
  type        = string
  default     = ""

  # Sprint 321 (medium-6): Validate Slack channel ID format
  validation {
    condition     = var.slack_channel_id == "" || can(regex("^C[A-Z0-9]+$", var.slack_channel_id))
    error_message = "Must be empty or a valid Slack channel ID (starts with C, e.g. C01ABCDEF)."
  }
}

# Sprint 7 (320), Task 7.3: Feature flag kill switches
variable "feature_crypto_payments_enabled" {
  description = "Enable crypto payments (NOWPayments integration)"
  type        = string
  default     = "false"

  # Sprint 321 (medium-6): Validate boolean string
  validation {
    condition     = contains(["true", "false"], var.feature_crypto_payments_enabled)
    error_message = "Must be 'true' or 'false'."
  }
}

variable "feature_api_keys_enabled" {
  description = "Enable developer API key management"
  type        = string
  default     = "false"

  # Sprint 321 (medium-6): Validate boolean string
  validation {
    condition     = contains(["true", "false"], var.feature_api_keys_enabled)
    error_message = "Must be 'true' or 'false'."
  }
}

variable "feature_web_chat_enabled" {
  description = "Enable web chat widget and standalone chat page"
  type        = string
  default     = "false"

  # Sprint 321 (medium-6): Validate boolean string
  validation {
    condition     = contains(["true", "false"], var.feature_web_chat_enabled)
    error_message = "Must be 'true' or 'false'."
  }
}

# =============================================================================
# loa-finn Service (Cycle 036)
# =============================================================================

variable "finn_cpu" {
  description = "loa-finn task CPU units"
  type        = number
  default     = 512
}

variable "finn_memory" {
  description = "loa-finn task memory (MB)"
  type        = number
  default     = 1024
}

variable "finn_desired_count" {
  description = "Desired loa-finn task count"
  type        = number
  default     = 1
}

# =============================================================================
# loa-dixie Service (Cycle 044)
# =============================================================================

variable "dixie_cpu" {
  description = "loa-dixie task CPU units"
  type        = number
  default     = 256
}

variable "dixie_memory" {
  description = "loa-dixie task memory (MB)"
  type        = number
  default     = 512
}

variable "dixie_desired_count" {
  description = "Desired loa-dixie task count"
  type        = number
  default     = 1
}

variable "dixie_image_tag" {
  description = "Docker image tag for loa-dixie (git SHA for immutable deploys per IMP-003)"
  type        = string
  default     = "latest"
}

# =============================================================================
# Finn Dedicated Redis (Cycle 046)
# =============================================================================

variable "finn_redis_node_type" {
  description = "Finn dedicated Redis node type"
  type        = string
  default     = "cache.t3.micro"
}

# =============================================================================
# Dixie Auto-Scaling (Cycle 046)
# =============================================================================

variable "dixie_max_count" {
  description = "Maximum Dixie task count for auto-scaling"
  type        = number
  default     = 4
}

variable "autoscaling_cpu_target" {
  description = "Target CPU utilization percentage for auto-scaling"
  type        = number
  default     = 70
}

variable "autoscaling_scale_in_cooldown" {
  description = "Scale-in cooldown period in seconds"
  type        = number
  default     = 300
}

variable "autoscaling_scale_out_cooldown" {
  description = "Scale-out cooldown period in seconds"
  type        = number
  default     = 60
}

# SNS Alarm Topic
variable "sns_alarm_topic_arn" {
  description = "SNS topic ARN for CloudWatch alarm notifications (empty = no notifications)"
  type        = string
  default     = ""
}

# Observability
variable "log_retention_days" {
  description = "CloudWatch log retention in days"
  type        = number
  default     = 30
}

variable "log_level" {
  description = "Application log level"
  type        = string
  default     = "info"
}

# --- Agent Gateway Alarm Thresholds ---

variable "agent_alarm_error_rate_pct" {
  description = "Agent Gateway error rate alarm threshold (%)"
  type        = number
  default     = 5
}

variable "agent_alarm_latency_p99_ms" {
  description = "Agent Gateway p99 latency alarm threshold (ms)"
  type        = number
  default     = 5000
}

variable "agent_alarm_budget_delta_pct" {
  description = "Agent Gateway budget delta alarm threshold (%)"
  type        = number
  default     = 80
}

variable "agent_alarm_stale_reservation_ms" {
  description = "Agent Gateway stale reservation age alarm threshold (ms)"
  type        = number
  default     = 300000
}

variable "agent_alarm_token_drift_pct" {
  description = "Agent Gateway token estimate drift alarm threshold (%)"
  type        = number
  default     = 100
}

variable "economic_alarm_budget_drift_micro" {
  description = "Economic budget drift alarm threshold (micro-USD)"
  type        = number
  default     = 500000
}

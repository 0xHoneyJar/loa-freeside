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

# PgBouncer Configuration (Sprint S-1: Scaling Foundation)
variable "pgbouncer_max_client_conn" {
  description = "Maximum client connections to PgBouncer"
  type        = number
  default     = 1000
}

variable "pgbouncer_default_pool_size" {
  description = "Default pool size per database/user pair"
  type        = number
  default     = 25
}

variable "pgbouncer_desired_count" {
  description = "Desired PgBouncer task count"
  type        = number
  default     = 1
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

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
variable "domain_name" {
  description = "Domain name for SSL certificate"
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

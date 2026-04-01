# =============================================================================
# World Module — Input Variables
# =============================================================================

# --- Required ---

variable "name" {
  description = "World identifier (lowercase alphanumeric + hyphens)"
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,20}$", var.name))
    error_message = "World name must be lowercase alphanumeric with hyphens, 2-21 chars."
  }
}

variable "repo" {
  description = "GitHub repo in format 'OrgName/repo-name'"
  type        = string
}

variable "environment" {
  description = "Environment name (staging or production)"
  type        = string
}

variable "cluster_id" {
  description = "ECS cluster ID"
  type        = string
}

variable "cluster_name" {
  description = "ECS cluster name"
  type        = string
}

variable "vpc_id" {
  description = "VPC ID"
  type        = string
}

variable "private_subnets" {
  description = "Private subnet IDs for task placement"
  type        = list(string)
}

variable "alb_listener_arn" {
  description = "ALB HTTPS listener ARN"
  type        = string
}

variable "alb_security_group_id" {
  description = "ALB security group ID (for ingress rules)"
  type        = string
}

variable "efs_file_system_id" {
  description = "Shared world EFS file system ID"
  type        = string
}

variable "efs_security_group_id" {
  description = "EFS mount target security group ID"
  type        = string
}

variable "github_oidc_provider_arn" {
  description = "GitHub OIDC provider ARN (shared singleton)"
  type        = string
}

variable "kms_key_arn" {
  description = "KMS key ARN for secrets encryption"
  type        = string
}

variable "name_prefix" {
  description = "Resource name prefix (e.g., arrakis-staging)"
  type        = string
}

variable "common_tags" {
  description = "Common resource tags"
  type        = map(string)
  default     = {}
}

variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "account_id" {
  description = "AWS account ID"
  type        = string
}

# --- Optional ---

variable "cpu" {
  description = "Fargate CPU units"
  type        = number
  default     = 256
}

variable "memory" {
  description = "Fargate memory MB"
  type        = number
  default     = 512
}

variable "port" {
  description = "Container port"
  type        = number
  default     = 3000
}

variable "health_check_path" {
  description = "ALB health check path"
  type        = string
  default     = "/"
}

variable "desired_count" {
  description = "ECS desired task count (max 1 — SQLite requires single writer)"
  type        = number
  default     = 1

  validation {
    condition     = var.desired_count <= 1
    error_message = "World desired_count must be 0 or 1. SQLite on EFS requires single-writer access."
  }
}

variable "env_vars" {
  description = "Non-sensitive environment variables"
  type        = map(string)
  default     = {}
}

variable "domain" {
  description = "Base domain for subdomain routing"
  type        = string
  default     = "0xhoneyjar.xyz"
}

variable "finn_url" {
  description = "Finn AI gateway URL (auto-constructed if empty)"
  type        = string
  default     = ""
}

variable "image_tag" {
  description = "Docker image tag"
  type        = string
  default     = "latest"
}

variable "log_retention_days" {
  description = "CloudWatch log retention in days"
  type        = number
  default     = 30
}

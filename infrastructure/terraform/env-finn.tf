# =============================================================================
# SSM Parameters for Finn Service Configuration
# Cycle 046: Armitage Platform — Sprint 1, Task 1.1
# SDD §3.5: env-finn.tf
# =============================================================================
#
# 13 SSM parameters imported from the Finn Terraform state. Values are
# managed outside Terraform after import (ignore_changes on value).
# SecureString parameters use the Finn-dedicated KMS key.
#
# SKP-003b: ignore_changes rationale — SSM parameter values are set by
# operators or CI/CD pipelines after initial import. Terraform manages
# the parameter existence, type, and encryption but not the runtime value.
# Non-sensitive values are tracked in terraform.tfvars for audit.

locals {
  finn_ssm_parameters = {
    "finn/database-url"         = { type = "SecureString", description = "PostgreSQL connection URL" }
    "finn/redis-url"            = { type = "SecureString", description = "Dedicated Redis connection URL" }
    "finn/freeside-base-url"    = { type = "String", description = "Freeside service URL" }
    "finn/arrakis-jwks-url"     = { type = "String", description = "JWKS endpoint for JWT verification" }
    "finn/dixie-reputation-url" = { type = "String", description = "Dixie reputation query endpoint" }
    "finn/nats-url"             = { type = "String", description = "NATS JetStream URL" }
    "finn/s2s-key-kid"          = { type = "String", description = "S2S JWT key identifier" }
    "finn/nowpayments-webhook"  = { type = "SecureString", description = "NOWPayments webhook endpoint" }
    "finn/log-level"            = { type = "String", description = "Application log level" }
    "finn/node-env"             = { type = "String", description = "Node.js environment" }
    "finn/feature-payments"     = { type = "String", description = "Payments feature flag" }
    "finn/feature-inference"    = { type = "String", description = "Inference feature flag" }
    "finn/audit-bucket"         = { type = "String", description = "S3 bucket for audit anchors" }
  }
}

resource "aws_ssm_parameter" "finn" {
  for_each = local.finn_ssm_parameters

  name        = "/${local.name_prefix}/${each.key}"
  type        = each.value.type
  description = each.value.description
  value       = "PLACEHOLDER" # Real values imported from finn state
  key_id      = each.value.type == "SecureString" ? aws_kms_key.finn_audit_signing.key_id : null

  lifecycle {
    ignore_changes = [value] # Values managed outside terraform after import
  }

  tags = merge(local.common_tags, { Service = "finn" })
}

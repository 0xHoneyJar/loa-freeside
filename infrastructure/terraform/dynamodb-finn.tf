# =============================================================================
# DynamoDB Tables for Finn Audit & Settlement
# Cycle 046: Armitage Platform — Sprint 1, Task 1.1
# SDD §3.2: dynamodb-finn.tf
# =============================================================================
#
# Provenance: imported from loa-finn state (cycle-046, Sprint 1)
# Original: loa-finn/infrastructure/terraform/dynamodb.tf
# Import commit: d3d3ea68 (feat(sprint-1): stateful resource consolidation)
# Lifecycle: prevent_destroy (conservation invariant — see docs/conservation-invariants.md)
#
# Two DynamoDB tables:
# 1. scoring_path_log — Audit trail for scoring path evaluations
# 2. x402_settlements — x402 payment settlement records
# Both use PAY_PER_REQUEST billing and Finn-dedicated KMS encryption.

resource "aws_dynamodb_table" "finn_scoring_path_log" {
  name         = "${local.name_prefix}-finn-scoring-path-log"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"

  attribute {
    name = "pk"
    type = "S"
  }

  attribute {
    name = "sk"
    type = "S"
  }

  attribute {
    name = "gsi1pk"
    type = "S"
  }

  attribute {
    name = "gsi1sk"
    type = "S"
  }

  global_secondary_index {
    name            = "gsi1"
    hash_key        = "gsi1pk"
    range_key       = "gsi1sk"
    projection_type = "ALL"
  }

  point_in_time_recovery {
    enabled = true
  }

  server_side_encryption {
    enabled     = true
    kms_key_arn = aws_kms_key.finn_audit_signing.arn
  }

  lifecycle {
    prevent_destroy = true
  }

  tags = merge(local.common_tags, {
    Service = "finn"
    Purpose = "audit-log"
  })
}

resource "aws_dynamodb_table" "finn_x402_settlements" {
  name         = "${local.name_prefix}-finn-x402-settlements"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"

  attribute {
    name = "pk"
    type = "S"
  }

  attribute {
    name = "sk"
    type = "S"
  }

  attribute {
    name = "gsi1pk"
    type = "S"
  }

  attribute {
    name = "gsi1sk"
    type = "S"
  }

  global_secondary_index {
    name            = "gsi1"
    hash_key        = "gsi1pk"
    range_key       = "gsi1sk"
    projection_type = "ALL"
  }

  point_in_time_recovery {
    enabled = true
  }

  server_side_encryption {
    enabled     = true
    kms_key_arn = aws_kms_key.finn_audit_signing.arn
  }

  lifecycle {
    prevent_destroy = true
  }

  tags = merge(local.common_tags, {
    Service = "finn"
    Purpose = "x402-settlements"
  })
}

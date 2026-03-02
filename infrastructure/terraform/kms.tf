# =============================================================================
# KMS Keys for Encryption
# Sprint 94: Enable KMS Encryption on Terraform State (C-2)
# =============================================================================
#
# IMPORTANT: The Terraform state KMS key is managed externally to avoid
# chicken-and-egg dependency. This file documents the key specification and
# manages additional KMS keys for the application.
#
# Bootstrap Instructions:
# 1. Create the KMS key manually BEFORE terraform init:
#    aws kms create-key --description "Arrakis Terraform state encryption" \
#      --tags TagKey=Project,TagValue=Arrakis TagKey=Purpose,TagValue=TerraformState
#
# 2. Create an alias for easier reference:
#    aws kms create-alias --alias-name alias/arrakis-terraform-state \
#      --target-key-id <key-id-from-step-1>
#
# 3. Update backend.tfvars with kms_key_id = "<key-arn>"
#
# 4. Enable key rotation:
#    aws kms enable-key-rotation --key-id <key-id>
#
# =============================================================================

# -----------------------------------------------------------------------------
# Data source for the externally-managed Terraform state KMS key
# This validates the key exists and provides its ARN for reference
# -----------------------------------------------------------------------------
data "aws_kms_key" "terraform_state" {
  key_id = "alias/arrakis-terraform-state"
}

# -----------------------------------------------------------------------------
# KMS Key for Secrets Manager (Application Secrets)
# This key encrypts all secrets in AWS Secrets Manager
# -----------------------------------------------------------------------------
resource "aws_kms_key" "secrets" {
  description             = "Arrakis secrets encryption key"
  deletion_window_in_days = 30
  enable_key_rotation     = true

  # Sprint 95 (A-94.5): Prevent accidental deletion via terraform destroy
  lifecycle {
    prevent_destroy = true
  }

  # Policy allowing Secrets Manager to use this key
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "Enable IAM User Permissions"
        Effect = "Allow"
        Principal = {
          AWS = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"
        }
        Action   = "kms:*"
        Resource = "*"
      },
      {
        Sid    = "Allow Secrets Manager"
        Effect = "Allow"
        Principal = {
          Service = "secretsmanager.amazonaws.com"
        }
        Action = [
          "kms:Encrypt",
          "kms:Decrypt",
          "kms:ReEncrypt*",
          "kms:GenerateDataKey*",
          "kms:DescribeKey"
        ]
        Resource = "*"
        Condition = {
          StringEquals = {
            "kms:CallerAccount" = data.aws_caller_identity.current.account_id
          }
        }
      },
      {
        Sid    = "Allow ECS Task Execution Roles"
        Effect = "Allow"
        Principal = {
          AWS = [
            aws_iam_role.ecs_execution_api.arn,
            aws_iam_role.ecs_execution_worker.arn,
            aws_iam_role.ecs_execution_ingestor.arn,
            aws_iam_role.ecs_execution_gateway.arn,
            aws_iam_role.ecs_execution_gp_worker.arn,
            aws_iam_role.ecs_execution_finn.arn,
            aws_iam_role.ecs_execution_dixie.arn,
            aws_iam_role.ecs_execution.arn
          ]
        }
        Action = [
          "kms:Decrypt",
          "kms:DescribeKey"
        ]
        Resource = "*"
      }
    ]
  })

  tags = merge(local.common_tags, {
    Name    = "${local.name_prefix}-secrets-kms"
    Purpose = "SecretsEncryption"
    Sprint  = "95"
  })
}

resource "aws_kms_alias" "secrets" {
  name          = "alias/${local.name_prefix}-secrets"
  target_key_id = aws_kms_key.secrets.key_id
}

# -----------------------------------------------------------------------------
# Current account ID for IAM policies
# -----------------------------------------------------------------------------
data "aws_caller_identity" "current" {}

# -----------------------------------------------------------------------------
# Outputs
# -----------------------------------------------------------------------------
output "terraform_state_kms_key_arn" {
  description = "ARN of the KMS key for Terraform state encryption"
  value       = data.aws_kms_key.terraform_state.arn
}

output "secrets_kms_key_arn" {
  description = "ARN of the KMS key for Secrets Manager encryption"
  value       = aws_kms_key.secrets.arn
}

output "secrets_kms_key_id" {
  description = "ID of the KMS key for Secrets Manager encryption"
  value       = aws_kms_key.secrets.key_id
}

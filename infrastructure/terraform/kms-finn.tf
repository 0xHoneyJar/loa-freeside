# =============================================================================
# KMS Key for Finn Audit Signing & Encryption
# Cycle 046: Armitage Platform — Sprint 1, Task 1.1
# SDD §3.4: kms-finn.tf
# =============================================================================
#
# Provenance: imported from loa-finn state (cycle-046, Sprint 1)
# Original: loa-finn/infrastructure/terraform/kms.tf
# Import commit: d3d3ea68 (feat(sprint-1): stateful resource consolidation)
# Lifecycle: prevent_destroy (conservation invariant — see docs/conservation-invariants.md)
#
# Dedicated KMS key for Finn audit signing, DynamoDB encryption, and S3
# bucket encryption. Separate from the shared secrets KMS key to enforce
# least-privilege: only the Finn task role and designated admin roles
# have access.

resource "aws_kms_key" "finn_audit_signing" {
  description             = "Finn audit signing and encryption key"
  deletion_window_in_days = 30
  enable_key_rotation     = true

  policy = data.aws_iam_policy_document.finn_kms_policy.json

  lifecycle {
    prevent_destroy = true
  }

  tags = merge(local.common_tags, {
    Service = "finn"
    Purpose = "audit-signing"
  })
}

resource "aws_kms_alias" "finn_audit_signing" {
  name          = "alias/${local.name_prefix}-finn-audit-signing"
  target_key_id = aws_kms_key.finn_audit_signing.key_id
}

# SKP-002: Explicit admin role — no blanket root kms:*
data "aws_iam_policy_document" "finn_kms_policy" {
  statement {
    sid    = "AllowKeyAdministration"
    effect = "Allow"
    principals {
      type = "AWS"
      identifiers = [
        "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/github-actions-terraform",
        "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/admin"
      ]
    }
    actions = [
      "kms:Create*",
      "kms:Describe*",
      "kms:Enable*",
      "kms:List*",
      "kms:Put*",
      "kms:Update*",
      "kms:Revoke*",
      "kms:Disable*",
      "kms:Get*",
      "kms:Delete*",
      "kms:TagResource",
      "kms:UntagResource",
      "kms:ScheduleKeyDeletion",
      "kms:CancelKeyDeletion"
    ]
    resources = ["*"]
  }

  statement {
    sid    = "AllowFinnTaskRole"
    effect = "Allow"
    principals {
      type        = "AWS"
      identifiers = [aws_iam_role.finn_task.arn]
    }
    actions = [
      "kms:Decrypt",
      "kms:GenerateDataKey",
      "kms:DescribeKey",
      "kms:Sign",
      "kms:Verify"
    ]
    resources = ["*"]
  }

  # Allow key grant creation for AWS services (explicit roles, no root — SKP-002)
  statement {
    sid    = "AllowGrantsForAWSServices"
    effect = "Allow"
    principals {
      type = "AWS"
      identifiers = [
        "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/github-actions-terraform",
        "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/admin"
      ]
    }
    actions   = ["kms:CreateGrant"]
    resources = ["*"]
    condition {
      test     = "Bool"
      variable = "kms:GrantIsForAWSResource"
      values   = ["true"]
    }
  }
}

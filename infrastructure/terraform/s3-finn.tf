# =============================================================================
# S3 Buckets for Finn Audit Anchors & Calibration
# Cycle 046: Armitage Platform — Sprint 1, Task 1.1
# SDD §3.3: s3-finn.tf
# =============================================================================
#
# Two S3 buckets:
# 1. audit-anchors — Object Lock (COMPLIANCE 365d) for immutable audit records
# 2. calibration — Versioned storage for calibration data
# Both encrypted with Finn-dedicated KMS key.

# -----------------------------------------------------------------------------
# Audit Anchors Bucket (Object Lock)
# -----------------------------------------------------------------------------

resource "aws_s3_bucket" "finn_audit_anchors" {
  bucket              = "${local.name_prefix}-finn-audit-anchors"
  object_lock_enabled = true # Must match existing bucket; Object Lock is immutable at creation

  lifecycle {
    prevent_destroy = true
  }

  tags = merge(local.common_tags, {
    Service = "finn"
    Purpose = "audit-anchors"
  })
}

resource "aws_s3_bucket_object_lock_configuration" "finn_audit_anchors" {
  bucket = aws_s3_bucket.finn_audit_anchors.id

  rule {
    default_retention {
      mode = "COMPLIANCE"
      days = 365
    }
  }
}

resource "aws_s3_bucket_versioning" "finn_audit_anchors" {
  bucket = aws_s3_bucket.finn_audit_anchors.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "finn_audit_anchors" {
  bucket = aws_s3_bucket.finn_audit_anchors.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.finn_audit_signing.arn
    }
    bucket_key_enabled = true
  }
}

# -----------------------------------------------------------------------------
# Calibration Bucket (Versioned)
# -----------------------------------------------------------------------------

resource "aws_s3_bucket" "finn_calibration" {
  bucket = "${local.name_prefix}-finn-calibration"

  lifecycle {
    prevent_destroy = true
  }

  tags = merge(local.common_tags, {
    Service = "finn"
    Purpose = "calibration-data"
  })
}

resource "aws_s3_bucket_versioning" "finn_calibration" {
  bucket = aws_s3_bucket.finn_calibration.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "finn_calibration" {
  bucket = aws_s3_bucket.finn_calibration.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.finn_audit_signing.arn
    }
    bucket_key_enabled = true
  }
}

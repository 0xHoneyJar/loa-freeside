# =============================================================================
# Gaib Backup Infrastructure
# Sprint 166-171: Backup & Snapshot System
#
# Resources:
# - S3 bucket for backup storage with versioning and lifecycle rules
# - KMS key for backup encryption
# - DynamoDB tables for metadata and tier configuration
# - SNS topic for notifications
# - EventBridge rules for scheduled backups
# - CloudWatch alarms for monitoring
# =============================================================================

# -----------------------------------------------------------------------------
# S3 Bucket for Backups
# -----------------------------------------------------------------------------

resource "aws_s3_bucket" "gaib_backups" {
  bucket = "gaib-backups-${data.aws_caller_identity.current.account_id}"

  tags = merge(local.common_tags, {
    Name    = "${local.name_prefix}-gaib-backups"
    Purpose = "DiscordIaCBackups"
    Sprint  = "166"
  })
}

resource "aws_s3_bucket_versioning" "gaib_backups" {
  bucket = aws_s3_bucket.gaib_backups.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "gaib_backups" {
  bucket = aws_s3_bucket.gaib_backups.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.gaib_backups.arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "gaib_backups" {
  bucket = aws_s3_bucket.gaib_backups.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "gaib_backups" {
  bucket = aws_s3_bucket.gaib_backups.id

  # Free tier: 7 day retention
  rule {
    id     = "free-tier-retention"
    status = "Enabled"

    filter {
      tag {
        key   = "Tier"
        value = "free"
      }
    }

    expiration {
      days = 7
    }
  }

  # Premium tier: Glacier after 30 days, expire after 90
  rule {
    id     = "premium-tier-glacier"
    status = "Enabled"

    filter {
      tag {
        key   = "Tier"
        value = "premium"
      }
    }

    transition {
      days          = 30
      storage_class = "GLACIER"
    }

    expiration {
      days = 90
    }
  }

  # Clean up incomplete multipart uploads
  rule {
    id     = "cleanup-incomplete-uploads"
    status = "Enabled"

    filter {
      prefix = ""
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }

  # Clean up old versions after 30 days
  rule {
    id     = "cleanup-old-versions"
    status = "Enabled"

    filter {
      prefix = ""
    }

    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }
}

# -----------------------------------------------------------------------------
# KMS Key for Backup Encryption
# -----------------------------------------------------------------------------

resource "aws_kms_key" "gaib_backups" {
  description             = "Gaib backup encryption key"
  deletion_window_in_days = 30
  enable_key_rotation     = true

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
        Sid    = "Allow S3 Service"
        Effect = "Allow"
        Principal = {
          Service = "s3.amazonaws.com"
        }
        Action = [
          "kms:Decrypt",
          "kms:GenerateDataKey"
        ]
        Resource = "*"
        Condition = {
          StringEquals = {
            "kms:CallerAccount" = data.aws_caller_identity.current.account_id
          }
        }
      },
      {
        Sid    = "Allow ECS Task Roles"
        Effect = "Allow"
        Principal = {
          AWS = [
            aws_iam_role.ecs_execution_api.arn,
            aws_iam_role.ecs_execution_worker.arn
          ]
        }
        Action = [
          "kms:Decrypt",
          "kms:GenerateDataKey",
          "kms:DescribeKey"
        ]
        Resource = "*"
      }
    ]
  })

  tags = merge(local.common_tags, {
    Name    = "${local.name_prefix}-gaib-backups-kms"
    Purpose = "BackupEncryption"
    Sprint  = "166"
  })
}

resource "aws_kms_alias" "gaib_backups" {
  name          = "alias/${local.name_prefix}-gaib-backups"
  target_key_id = aws_kms_key.gaib_backups.key_id
}

# -----------------------------------------------------------------------------
# DynamoDB Table for Backup Metadata
# -----------------------------------------------------------------------------

resource "aws_dynamodb_table" "gaib_backup_metadata" {
  name         = "gaib-backup-metadata"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "PK"
  range_key    = "SK"

  attribute {
    name = "PK"
    type = "S"
  }

  attribute {
    name = "SK"
    type = "S"
  }

  attribute {
    name = "GSI1PK"
    type = "S"
  }

  attribute {
    name = "GSI1SK"
    type = "S"
  }

  global_secondary_index {
    name            = "GSI1"
    hash_key        = "GSI1PK"
    range_key       = "GSI1SK"
    projection_type = "ALL"
  }

  ttl {
    attribute_name = "TTL"
    enabled        = true
  }

  point_in_time_recovery {
    enabled = true
  }

  tags = merge(local.common_tags, {
    Name    = "${local.name_prefix}-gaib-backup-metadata"
    Purpose = "BackupMetadata"
    Sprint  = "166"
  })
}

# -----------------------------------------------------------------------------
# DynamoDB Table for Server Tiers
# -----------------------------------------------------------------------------

resource "aws_dynamodb_table" "gaib_server_tiers" {
  name         = "gaib-server-tiers"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "PK"

  attribute {
    name = "PK"
    type = "S"
  }

  tags = merge(local.common_tags, {
    Name    = "${local.name_prefix}-gaib-server-tiers"
    Purpose = "ServerTierConfig"
    Sprint  = "166"
  })
}

# -----------------------------------------------------------------------------
# SNS Topic for Notifications
# -----------------------------------------------------------------------------

resource "aws_sns_topic" "gaib_backup_notifications" {
  name = "gaib-backup-notifications"

  tags = merge(local.common_tags, {
    Name    = "${local.name_prefix}-gaib-backup-notifications"
    Purpose = "BackupNotifications"
    Sprint  = "171"
  })
}

# -----------------------------------------------------------------------------
# EventBridge Rules for Scheduled Backups
# -----------------------------------------------------------------------------

# Free tier: Daily at 03:00 UTC
resource "aws_cloudwatch_event_rule" "gaib_backup_daily" {
  name                = "gaib-backup-daily"
  description         = "Daily backup trigger for free tier servers"
  schedule_expression = "cron(0 3 * * ? *)"

  tags = merge(local.common_tags, {
    Name   = "${local.name_prefix}-backup-daily"
    Tier   = "free"
    Sprint = "170"
  })
}

# Premium tier: Hourly
resource "aws_cloudwatch_event_rule" "gaib_backup_hourly" {
  name                = "gaib-backup-hourly"
  description         = "Hourly backup trigger for premium tier servers"
  schedule_expression = "rate(1 hour)"

  tags = merge(local.common_tags, {
    Name   = "${local.name_prefix}-backup-hourly"
    Tier   = "premium"
    Sprint = "170"
  })
}

# Premium tier: Weekly snapshots (Sunday at 04:00 UTC)
resource "aws_cloudwatch_event_rule" "gaib_snapshot_weekly" {
  name                = "gaib-snapshot-weekly"
  description         = "Weekly snapshot trigger for premium tier servers"
  schedule_expression = "cron(0 4 ? * SUN *)"

  tags = merge(local.common_tags, {
    Name   = "${local.name_prefix}-snapshot-weekly"
    Tier   = "premium"
    Sprint = "170"
  })
}

# -----------------------------------------------------------------------------
# CloudWatch Alarms
# -----------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "gaib_backup_errors" {
  alarm_name          = "${local.name_prefix}-gaib-backup-errors"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "BackupErrors"
  namespace           = "Gaib/Backups"
  period              = 300
  statistic           = "Sum"
  threshold           = 0
  alarm_description   = "Gaib backup errors detected"
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.gaib_backup_notifications.arn]

  tags = merge(local.common_tags, {
    Name   = "${local.name_prefix}-backup-errors-alarm"
    Sprint = "171"
  })
}

# -----------------------------------------------------------------------------
# IAM Policy for Backup Operations
# -----------------------------------------------------------------------------

resource "aws_iam_policy" "gaib_backup_access" {
  name        = "${local.name_prefix}-gaib-backup-access"
  description = "IAM policy for Gaib backup operations"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "S3BackupAccess"
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:ListBucket"
        ]
        Resource = [
          aws_s3_bucket.gaib_backups.arn,
          "${aws_s3_bucket.gaib_backups.arn}/*"
        ]
      },
      {
        Sid    = "DynamoDBMetadataAccess"
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:DeleteItem",
          "dynamodb:Query",
          "dynamodb:UpdateItem"
        ]
        Resource = [
          aws_dynamodb_table.gaib_backup_metadata.arn,
          "${aws_dynamodb_table.gaib_backup_metadata.arn}/index/*",
          aws_dynamodb_table.gaib_server_tiers.arn
        ]
      },
      {
        Sid    = "KMSAccess"
        Effect = "Allow"
        Action = [
          "kms:Decrypt",
          "kms:GenerateDataKey",
          "kms:DescribeKey"
        ]
        Resource = [aws_kms_key.gaib_backups.arn]
      },
      {
        Sid    = "SNSPublish"
        Effect = "Allow"
        Action = ["sns:Publish"]
        Resource = [aws_sns_topic.gaib_backup_notifications.arn]
      },
      {
        Sid    = "CloudWatchMetrics"
        Effect = "Allow"
        Action = ["cloudwatch:PutMetricData"]
        Resource = ["*"]
        Condition = {
          StringEquals = {
            "cloudwatch:namespace" = "Gaib/Backups"
          }
        }
      }
    ]
  })

  tags = merge(local.common_tags, {
    Name   = "${local.name_prefix}-gaib-backup-policy"
    Sprint = "166"
  })
}

# -----------------------------------------------------------------------------
# Outputs
# -----------------------------------------------------------------------------

output "gaib_backups_bucket_name" {
  description = "Name of the Gaib backups S3 bucket"
  value       = aws_s3_bucket.gaib_backups.id
}

output "gaib_backups_bucket_arn" {
  description = "ARN of the Gaib backups S3 bucket"
  value       = aws_s3_bucket.gaib_backups.arn
}

output "gaib_backups_kms_key_arn" {
  description = "ARN of the KMS key for backup encryption"
  value       = aws_kms_key.gaib_backups.arn
}

output "gaib_backups_kms_key_id" {
  description = "ID of the KMS key for backup encryption"
  value       = aws_kms_key.gaib_backups.key_id
}

output "gaib_backup_metadata_table_name" {
  description = "Name of the DynamoDB table for backup metadata"
  value       = aws_dynamodb_table.gaib_backup_metadata.name
}

output "gaib_backup_metadata_table_arn" {
  description = "ARN of the DynamoDB table for backup metadata"
  value       = aws_dynamodb_table.gaib_backup_metadata.arn
}

output "gaib_server_tiers_table_name" {
  description = "Name of the DynamoDB table for server tiers"
  value       = aws_dynamodb_table.gaib_server_tiers.name
}

output "gaib_server_tiers_table_arn" {
  description = "ARN of the DynamoDB table for server tiers"
  value       = aws_dynamodb_table.gaib_server_tiers.arn
}

output "gaib_backup_notifications_topic_arn" {
  description = "ARN of the SNS topic for backup notifications"
  value       = aws_sns_topic.gaib_backup_notifications.arn
}

output "gaib_backup_policy_arn" {
  description = "ARN of the IAM policy for backup access"
  value       = aws_iam_policy.gaib_backup_access.arn
}

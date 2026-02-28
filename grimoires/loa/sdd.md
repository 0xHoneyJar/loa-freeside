# SDD: Armitage Platform — Terraform Consolidation & DNS Authority

> **Version**: 1.1.0 (Flatline SDD: 4 BLOCKERs + 10 DISPUTED integrated)
> **Cycle**: cycle-046
> **Date**: 2026-02-28
> **PRD**: `grimoires/loa/prd.md`
> **Issues**: #105, #106

## 1. Executive Summary

Armitage Platform consolidates three competing Terraform configurations (Freeside, Finn, Dixie) into a single canonical root and migrates DNS authority for `0xhoneyjar.xyz` from Gandi to Route 53 under IaC. The architecture uses a **two-root Terraform layout**: a compute root (existing, extended with 8 new files) and a DNS root (new, 11 files). State backends are isolated — DNS changes cannot risk compute resources.

The design prioritizes safety: stateful resources (S3 Object Lock, KMS, DynamoDB) are imported with `lifecycle { prevent_destroy = true }`, applies are phased (networking/IAM first, then compute), and all deploys pass SLO-aligned health gates before proceeding. The Finn cutover uses a scale-to-zero + recreate pattern to prevent duplicate ECS services.

**Key constraints:**
- Zero-downtime DNS migration (NFR-1)
- No `terraform destroy` on legacy stacks until imports verified (PRD safety invariant)
- Serialized CI execution during migration period (IMP-004)
- SLO-aligned health gates: latency < 2s p99, 0 5xx errors, 10 consecutive checks (IMP-008)

## 2. System Architecture

### 2.1 Two-Root Terraform Layout

```
infrastructure/terraform/           ← COMPUTE ROOT (existing, extended)
├── main.tf                         ← Backend: s3://arrakis-tfstate-891376933289
├── environments/
│   ├── staging/
│   │   ├── terraform.tfvars
│   │   └── backend.tfvars          ← key = "staging.tfstate"
│   └── production/
│       ├── terraform.tfvars
│       └── backend.tfvars          ← key = "production.tfstate"
├── ecs-finn.tf                     ← EXISTING: Finn ECS service, task def, SGs
├── ecs-dixie.tf                    ← EXISTING: Dixie ECS service, task def, SGs
├── elasticache-finn.tf             ← NEW: Dedicated Redis (noeviction, AOF)
├── dynamodb-finn.tf                ← NEW: 2 DynamoDB tables + GSI
├── s3-finn.tf                      ← NEW: 2 S3 buckets (Object Lock + calibration)
├── kms-finn.tf                     ← NEW: KMS audit signing key
├── env-finn.tf                     ← NEW: 13 SSM SecureString parameters
├── monitoring-finn.tf              ← NEW: 6 CloudWatch alarms + metric filters
├── monitoring-dixie.tf             ← NEW: 4 CloudWatch alarms + 2 metric filters
└── autoscaling-dixie.tf            ← NEW: AppAutoScaling target + CPU policy

infrastructure/terraform/dns/       ← DNS ROOT (new, separate state)
├── main.tf                         ← Backend: s3://arrakis-tfstate-891376933289
│                                      key via -backend-config
├── variables.tf
├── outputs.tf
├── honeyjar-xyz.tf                 ← Zone + apex A records
├── honeyjar-xyz-email.tf           ← MX, SPF, DKIM, DMARC
├── honeyjar-xyz-vercel.tf          ← Wildcard CNAME, ACME delegation
├── honeyjar-xyz-agents.tf          ← *.agents wildcard + ACME
├── honeyjar-xyz-backend.tf         ← api.0xhoneyjar.xyz → ALB alias
├── security.tf                     ← CAA, DNSSEC (feature-flagged)
└── environments/
    ├── staging/
    │   ├── terraform.tfvars        ← Env-specific variables
    │   └── backend.tfvars          ← key = "dns/staging.tfstate"
    └── production/
        ├── terraform.tfvars
        └── backend.tfvars          ← key = "dns/production.tfstate"
```

### 2.2 State Backend Isolation

Both roots share the same S3 bucket but use different key prefixes:

| Root | State Key | Lock Table | Purpose |
|------|-----------|------------|---------|
| Compute | `{env}.tfstate` | `arrakis-terraform-locks` | ECS, ALB, SGs, data stores |
| DNS | `dns/{env}.tfstate` | `arrakis-terraform-locks` | Route 53 zones, records |

**State backend hardening (per PRD NFR-2):**
- S3 bucket: versioning enabled, SSE-KMS encryption (`aws_kms_key.secrets`), bucket policy denying unencrypted uploads
- DynamoDB lock table: point-in-time recovery enabled
- IAM: only CI service role (`github-actions-terraform`) and designated operators may read/write state
- Prohibition of local state files in CI — all runs must use remote backend
- State bucket access logging enabled (existing `arrakis-tfstate-891376933289` already has versioning)

### 2.3 Cross-Root References

The DNS root needs to reference the compute ALB for `api.0xhoneyjar.xyz`. Two approaches:

**Selected: `data.aws_lbs` with tag filter → `data.aws_lb` by ARN** (avoids cross-state coupling)

```hcl
# dns/honeyjar-xyz-backend.tf
data "aws_lbs" "compute" {
  count = var.enable_production_api ? 1 : 0

  tags = {
    Name = "arrakis-${var.environment}-alb"
  }

  lifecycle {
    postcondition {
      condition     = length(self.arns) == 1
      error_message = "Expected exactly one ALB matching arrakis-${var.environment}-alb, got ${length(self.arns)}"
    }
  }
}

data "aws_lb" "compute_alb" {
  count = var.enable_production_api ? 1 : 0
  arn   = one(data.aws_lbs.compute[0].arns)
}
```

**Why `aws_lbs` → `aws_lb`**: The `aws_lb` data source does not support `tags` filtering in AWS provider ~> 5.x. The `aws_lbs` data source supports tag filtering and returns ARN lists; `one()` enforces exactly one match, then `aws_lb` reads `dns_name`/`zone_id` from the selected ARN.

**Why not `terraform_remote_state`**: Avoids tight coupling between roots. The compute root doesn't need to know about DNS, and DNS doesn't need read access to compute state files.

## 3. Component Design — Compute Root Extensions

### 3.1 `elasticache-finn.tf` — Dedicated Finn Redis

```hcl
resource "aws_elasticache_replication_group" "finn_dedicated" {
  replication_group_id = "${local.name_prefix}-finn-redis"
  description          = "Dedicated Redis for Finn billing (noeviction + AOF)"

  node_type            = var.finn_redis_node_type
  num_cache_clusters   = 1
  engine_version       = "7.1"
  port                 = 6379
  parameter_group_name = aws_elasticache_parameter_group.finn_redis.name

  at_rest_encryption_enabled = true
  transit_encryption_enabled = true

  # SKP-003: Do NOT set auth_token in Terraform to avoid storing it in state.
  # Auth token is managed out-of-band via:
  #   scripts/bootstrap-redis-auth.sh → aws elasticache modify-replication-group
  # See §3.1 external secret provisioning notes below.

  subnet_group_name  = aws_elasticache_subnet_group.main.name  # reuse existing
  security_group_ids = [aws_security_group.finn_redis.id]

  snapshot_retention_limit = 7
  snapshot_window          = "02:00-03:00"
  maintenance_window       = "sun:04:00-sun:05:00"

  apply_immediately = false

  lifecycle {
    prevent_destroy = true
    ignore_changes  = [auth_token]  # Managed externally after bootstrap
  }

  tags = merge(local.common_tags, {
    Service = "finn"
    Purpose = "billing-ledger"
  })
}

resource "aws_elasticache_parameter_group" "finn_redis" {
  family = "redis7"
  name   = "${local.name_prefix}-finn-redis-params"

  parameter {
    name  = "maxmemory-policy"
    value = "noeviction"
  }

  parameter {
    name  = "appendonly"
    value = "yes"
  }

  parameter {
    name  = "appendfsync"
    value = "everysec"
  }
}

resource "aws_security_group" "finn_redis" {
  name_prefix = "${local.name_prefix}-finn-redis-"
  vpc_id      = module.vpc.vpc_id

  ingress {
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.finn.id]
    description     = "Redis from Finn service only"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.common_tags, { Name = "${local.name_prefix}-finn-redis" })
}

# SKP-003: Redis auth token provisioned externally (not in TF state).
# A bootstrap script or rotation Lambda generates the auth token and stores it
# in Secrets Manager. Terraform only references the secret, never the plaintext.
resource "aws_secretsmanager_secret" "finn_redis" {
  name       = "${local.name_prefix}/finn/redis"
  kms_key_id = aws_kms_key.secrets.arn

  tags = merge(local.common_tags, {
    Service = "finn"
    Purpose = "redis-credentials"
  })
}

# Secret value is populated by scripts/bootstrap-redis-auth.sh:
#   1. Generate 32-char alphanumeric token
#   2. aws secretsmanager put-secret-value --secret-id <secret_arn> --secret-string '{"host":..., "auth":...}'
#   3. aws elasticache modify-replication-group --auth-token <token> --auth-token-update-strategy ROTATE
# This ensures plaintext credentials never appear in Terraform state.
```

### 3.2 `dynamodb-finn.tf` — Audit & Settlement Tables

```hcl
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
```

### 3.3 `s3-finn.tf` — Audit Anchors & Calibration

```hcl
resource "aws_s3_bucket" "finn_audit_anchors" {
  bucket              = "${local.name_prefix}-finn-audit-anchors"
  object_lock_enabled = true  # Must match existing bucket; Object Lock is immutable at creation

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
```

### 3.4 `kms-finn.tf` — Audit Signing Key

```hcl
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

data "aws_iam_policy_document" "finn_kms_policy" {
  # SKP-002: Explicit admin role — no blanket root kms:*
  statement {
    sid    = "AllowKeyAdministration"
    effect = "Allow"
    principals {
      type        = "AWS"
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

  # Allow key grant creation for services that need delegated access
  statement {
    sid    = "AllowGrantsForAWSServices"
    effect = "Allow"
    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"]
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

data "aws_caller_identity" "current" {}
```

### 3.5 `env-finn.tf` — SSM Parameters

```hcl
locals {
  finn_ssm_parameters = {
    "finn/database-url"          = { type = "SecureString", description = "PostgreSQL connection URL" }
    "finn/redis-url"             = { type = "SecureString", description = "Dedicated Redis connection URL" }
    "finn/freeside-base-url"     = { type = "String", description = "Freeside service URL" }
    "finn/arrakis-jwks-url"      = { type = "String", description = "JWKS endpoint for JWT verification" }
    "finn/dixie-reputation-url"  = { type = "String", description = "Dixie reputation query endpoint" }
    "finn/nats-url"              = { type = "String", description = "NATS JetStream URL" }
    "finn/s2s-key-kid"           = { type = "String", description = "S2S JWT key identifier" }
    "finn/nowpayments-webhook"   = { type = "SecureString", description = "NOWPayments webhook endpoint" }
    "finn/log-level"             = { type = "String", description = "Application log level" }
    "finn/node-env"              = { type = "String", description = "Node.js environment" }
    "finn/feature-payments"      = { type = "String", description = "Payments feature flag" }
    "finn/feature-inference"     = { type = "String", description = "Inference feature flag" }
    "finn/audit-bucket"          = { type = "String", description = "S3 bucket for audit anchors" }
  }
}

resource "aws_ssm_parameter" "finn" {
  for_each = local.finn_ssm_parameters

  name        = "/${local.name_prefix}/${each.key}"
  type        = each.value.type
  description = each.value.description
  value       = "PLACEHOLDER"  # Real values imported from finn state
  key_id      = each.value.type == "SecureString" ? aws_kms_key.finn_audit_signing.key_id : null

  lifecycle {
    ignore_changes = [value]  # Values managed outside terraform after import
  }

  tags = merge(local.common_tags, { Service = "finn" })
}
```

### 3.6 `monitoring-finn.tf` — Finn Alarms & Metric Filters

```hcl
resource "aws_cloudwatch_metric_alarm" "finn_cpu_high" {
  alarm_name          = "${local.name_prefix}-finn-cpu-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "CPUUtilization"
  namespace           = "AWS/ECS"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  alarm_description   = "Finn CPU utilization exceeds 80%"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]

  dimensions = {
    ClusterName = aws_ecs_cluster.main.name
    ServiceName = aws_ecs_service.finn.name
  }

  tags = merge(local.common_tags, { Service = "finn" })
}

resource "aws_cloudwatch_metric_alarm" "finn_memory_high" {
  alarm_name          = "${local.name_prefix}-finn-memory-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "MemoryUtilization"
  namespace           = "AWS/ECS"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  alarm_description   = "Finn memory utilization exceeds 80%"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]

  dimensions = {
    ClusterName = aws_ecs_cluster.main.name
    ServiceName = aws_ecs_service.finn.name
  }

  tags = merge(local.common_tags, { Service = "finn" })
}

resource "aws_cloudwatch_metric_alarm" "finn_5xx" {
  alarm_name          = "${local.name_prefix}-finn-5xx"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Finn5xxErrors"
  namespace           = "Arrakis/Finn"
  period              = 60
  statistic           = "Sum"
  threshold           = 5
  alarm_description   = "Finn 5xx error rate elevated"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  treat_missing_data  = "notBreaching"

  tags = merge(local.common_tags, { Service = "finn" })
}

resource "aws_cloudwatch_metric_alarm" "finn_task_count" {
  alarm_name          = "${local.name_prefix}-finn-task-count"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 1
  metric_name         = "RunningTaskCount"
  namespace           = "ECS/ContainerInsights"
  period              = 60
  statistic           = "Minimum"
  threshold           = 1
  alarm_description   = "Finn has no running tasks"
  alarm_actions       = [aws_sns_topic.alerts.arn]

  dimensions = {
    ClusterName = aws_ecs_cluster.main.name
    ServiceName = aws_ecs_service.finn.name
  }

  tags = merge(local.common_tags, { Service = "finn" })
}

resource "aws_cloudwatch_metric_alarm" "finn_latency_p99" {
  alarm_name          = "${local.name_prefix}-finn-latency-p99"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "FinnLatencyP99"
  namespace           = "Arrakis/Finn"
  period              = 60
  extended_statistic  = "p99"
  threshold           = 2000
  alarm_description   = "Finn p99 latency exceeds 2s"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  treat_missing_data  = "notBreaching"

  tags = merge(local.common_tags, { Service = "finn" })
}

resource "aws_cloudwatch_metric_alarm" "finn_redis_connection" {
  alarm_name          = "${local.name_prefix}-finn-redis-connection"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 2
  metric_name         = "CurrConnections"
  namespace           = "AWS/ElastiCache"
  period              = 300
  statistic           = "Minimum"
  threshold           = 1
  alarm_description   = "Finn dedicated Redis has no connections"
  alarm_actions       = [aws_sns_topic.alerts.arn]

  dimensions = {
    ReplicationGroupId = aws_elasticache_replication_group.finn_dedicated.id
  }

  tags = merge(local.common_tags, { Service = "finn" })
}

resource "aws_cloudwatch_log_metric_filter" "finn_errors" {
  name           = "${local.name_prefix}-finn-error-filter"
  log_group_name = aws_cloudwatch_log_group.finn.name
  pattern        = "{ $.level = \"error\" }"

  metric_transformation {
    name      = "FinnErrors"
    namespace = "Arrakis/Finn"
    value     = "1"
  }
}

resource "aws_cloudwatch_log_metric_filter" "finn_5xx_filter" {
  name           = "${local.name_prefix}-finn-5xx-filter"
  log_group_name = aws_cloudwatch_log_group.finn.name
  pattern        = "{ $.statusCode >= 500 }"

  metric_transformation {
    name      = "Finn5xxErrors"
    namespace = "Arrakis/Finn"
    value     = "1"
  }
}
```

### 3.7 `monitoring-dixie.tf` — Dixie Alarms

```hcl
resource "aws_cloudwatch_metric_alarm" "dixie_cpu_high" {
  alarm_name          = "${local.name_prefix}-dixie-cpu-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "CPUUtilization"
  namespace           = "AWS/ECS"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  alarm_description   = "Dixie CPU utilization exceeds 80%"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]

  dimensions = {
    ClusterName = aws_ecs_cluster.main.name
    ServiceName = aws_ecs_service.dixie.name
  }

  tags = merge(local.common_tags, { Service = "dixie" })
}

resource "aws_cloudwatch_metric_alarm" "dixie_memory_high" {
  alarm_name          = "${local.name_prefix}-dixie-memory-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "MemoryUtilization"
  namespace           = "AWS/ECS"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  alarm_description   = "Dixie memory utilization exceeds 80%"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]

  dimensions = {
    ClusterName = aws_ecs_cluster.main.name
    ServiceName = aws_ecs_service.dixie.name
  }

  tags = merge(local.common_tags, { Service = "dixie" })
}

resource "aws_cloudwatch_metric_alarm" "dixie_5xx" {
  alarm_name          = "${local.name_prefix}-dixie-5xx"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Dixie5xxErrors"
  namespace           = "Arrakis/Dixie"
  period              = 60
  statistic           = "Sum"
  threshold           = 5
  alarm_description   = "Dixie 5xx error rate elevated"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  treat_missing_data  = "notBreaching"

  tags = merge(local.common_tags, { Service = "dixie" })
}

resource "aws_cloudwatch_metric_alarm" "dixie_task_count" {
  alarm_name          = "${local.name_prefix}-dixie-task-count"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 1
  metric_name         = "RunningTaskCount"
  namespace           = "ECS/ContainerInsights"
  period              = 60
  statistic           = "Minimum"
  threshold           = 1
  alarm_description   = "Dixie has no running tasks"
  alarm_actions       = [aws_sns_topic.alerts.arn]

  dimensions = {
    ClusterName = aws_ecs_cluster.main.name
    ServiceName = aws_ecs_service.dixie.name
  }

  tags = merge(local.common_tags, { Service = "dixie" })
}

resource "aws_cloudwatch_log_metric_filter" "dixie_errors" {
  name           = "${local.name_prefix}-dixie-error-filter"
  log_group_name = aws_cloudwatch_log_group.dixie.name
  pattern        = "{ $.level = \"error\" }"

  metric_transformation {
    name      = "DixieErrors"
    namespace = "Arrakis/Dixie"
    value     = "1"
  }
}

resource "aws_cloudwatch_log_metric_filter" "dixie_5xx_filter" {
  name           = "${local.name_prefix}-dixie-5xx-filter"
  log_group_name = aws_cloudwatch_log_group.dixie.name
  pattern        = "{ $.statusCode >= 500 }"

  metric_transformation {
    name      = "Dixie5xxErrors"
    namespace = "Arrakis/Dixie"
    value     = "1"
  }
}
```

### 3.8 `autoscaling-dixie.tf` — Dixie Auto-Scaling

```hcl
resource "aws_appautoscaling_target" "dixie" {
  max_capacity       = var.dixie_max_count
  min_capacity       = var.dixie_desired_count
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.dixie.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "dixie_cpu" {
  name               = "${local.name_prefix}-dixie-cpu-scaling"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.dixie.resource_id
  scalable_dimension = aws_appautoscaling_target.dixie.scalable_dimension
  service_namespace  = aws_appautoscaling_target.dixie.service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value       = var.autoscaling_cpu_target
    scale_in_cooldown  = var.autoscaling_scale_in_cooldown
    scale_out_cooldown = var.autoscaling_scale_out_cooldown
  }
}
```

## 4. Resource Import Inventory

**Authoritative per-resource mapping per PRD IMP-002. Physical IDs must be confirmed from loa-finn's state before execution.**

### 4.1 Stateful Resources (Import with `prevent_destroy`)

| # | Resource Type | Logical Name | Expected Physical ID Pattern | Import Command | Expected Plan Diff |
|---|--------------|-------------|---------------------------|---------------|-------------------|
| 1 | `aws_elasticache_replication_group` | `finn_dedicated` | `arrakis-staging-finn-redis` | `terraform import aws_elasticache_replication_group.finn_dedicated arrakis-staging-finn-redis` | 0 changes |
| 2 | `aws_elasticache_parameter_group` | `finn_redis` | `arrakis-staging-finn-redis-params` | `terraform import aws_elasticache_parameter_group.finn_redis arrakis-staging-finn-redis-params` | 0 changes |
| 3 | `aws_dynamodb_table` | `finn_scoring_path_log` | `arrakis-staging-finn-scoring-path-log` | `terraform import aws_dynamodb_table.finn_scoring_path_log arrakis-staging-finn-scoring-path-log` | 0 changes |
| 4 | `aws_dynamodb_table` | `finn_x402_settlements` | `arrakis-staging-finn-x402-settlements` | `terraform import aws_dynamodb_table.finn_x402_settlements arrakis-staging-finn-x402-settlements` | 0 changes |
| 5 | `aws_s3_bucket` | `finn_audit_anchors` | `arrakis-staging-finn-audit-anchors` | `terraform import aws_s3_bucket.finn_audit_anchors arrakis-staging-finn-audit-anchors` | 0 changes |
| 6 | `aws_s3_bucket` | `finn_calibration` | `arrakis-staging-finn-calibration` | `terraform import aws_s3_bucket.finn_calibration arrakis-staging-finn-calibration` | 0 changes |
| 7 | `aws_kms_key` | `finn_audit_signing` | `{key-id from finn state}` | `terraform import aws_kms_key.finn_audit_signing {key-id}` | 0 changes |
| 8 | `aws_kms_alias` | `finn_audit_signing` | `alias/arrakis-staging-finn-audit-signing` | `terraform import aws_kms_alias.finn_audit_signing alias/arrakis-staging-finn-audit-signing` | 0 changes |

### 4.2 Configuration Resources (Import, values managed externally)

| # | Resource Type | Logical Name | Expected Physical ID Pattern | Import Command | Expected Plan Diff |
|---|--------------|-------------|---------------------------|---------------|-------------------|
| 9-21 | `aws_ssm_parameter` | `finn["finn/*"]` (13 params) | `/arrakis-staging/finn/*` | `terraform import 'aws_ssm_parameter.finn["finn/database-url"]' /arrakis-staging/finn/database-url` (repeat per param) | 0 changes (ignore_changes on value) |
| 22 | `aws_cloudwatch_log_group` | `finn` (if legacy exists) | `/ecs/arrakis-staging/finn` | `terraform import aws_cloudwatch_log_group.finn /ecs/arrakis-staging/finn` | 0 changes |

### 4.3 New Resources (Creates Only, No Import)

| Resource Type | Logical Name | Expected Plan Diff |
|--------------|-------------|-------------------|
| `aws_security_group` | `finn_redis` | create |
| `aws_secretsmanager_secret` | `finn_redis` | create |
| `aws_cloudwatch_metric_alarm` | `finn_cpu_high`, `finn_memory_high`, `finn_5xx`, `finn_task_count`, `finn_latency_p99`, `finn_redis_connection` | create (6) |
| `aws_cloudwatch_log_metric_filter` | `finn_errors`, `finn_5xx_filter` | create (2) |
| `aws_cloudwatch_metric_alarm` | `dixie_cpu_high`, `dixie_memory_high`, `dixie_5xx`, `dixie_task_count` | create (4) |
| `aws_cloudwatch_log_metric_filter` | `dixie_errors`, `dixie_5xx_filter` | create (2) |
| `aws_appautoscaling_target` | `dixie` | create |
| `aws_appautoscaling_policy` | `dixie_cpu` | create |
| `aws_s3_bucket_*` | versioning, encryption configs for audit/calibration | create (may show changes if existing config differs) |

### 4.4 Import Procedural Safeguards (IMP-003)

Every import batch follows this sequence:

1. **Pre-import state backup**: `terraform state pull > backup-$(date +%Y%m%d-%H%M%S).tfstate`
2. **Dry-run plan**: `terraform plan` before any import — document expected creates
3. **Import execution**: One resource at a time for stateful resources (rows 1-8); SSM params may be batched
4. **Post-import diff review**: `terraform plan` after each import batch — operator must confirm 0 unexpected changes before proceeding
5. **Post-import validation**: Run wiring test subset targeting imported resources (e.g., W-8 for Redis, W-9/W-10 for PgBouncer connectivity)
6. **Checkpoint commit**: `git add -A && git commit -m "import: <resource_group>"` after each verified batch

**Rollback**: If any import produces unexpected plan diff → `terraform state rm <resource>` to un-import, fix definition, retry. State backup enables full reset if needed.

### 4.5 Verification Procedure

After all imports, `terraform plan` must show:
- **0 changes** for all imported stateful resources (rows 1-8)
- **0 changes** for imported SSM parameters (rows 9-21, due to `ignore_changes`)
- **Create** only for new monitoring/scaling resources
- **No destroys or replaces** for any existing resources

## 5. Deploy Pipeline Design

### 5.1 `scripts/deploy-ring.sh`

Sequential orchestrator with SLO-aligned health gates:

```bash
#!/usr/bin/env bash
set -euo pipefail

RING="${1:?Usage: deploy-ring.sh <ring> [--services all|dixie,finn,freeside]}"
SERVICES="${2:-all}"
HEALTH_TIMEOUT=300        # 5 minutes
HEALTH_INTERVAL=5         # 5 seconds
CONSECUTIVE_REQUIRED=10   # 10 consecutive healthy checks
LATENCY_THRESHOLD_MS=2000 # p99 < 2s

# Phase 1: Build + Push
log "Phase 1: Building Docker images..."
for svc in freeside finn dixie; do
  ./scripts/deploy-to-ecr.sh "$svc" "$RING"
done

# Phase 2: Terraform Apply (if changes pending)
log "Phase 2: Terraform infrastructure..."
cd infrastructure/terraform
terraform plan -var-file="environments/${RING}/terraform.tfvars" -out=plan.tfplan
# Plan must be reviewed — in CI this is a separate approval step
terraform apply plan.tfplan
cd ../..

# Phase 3: Deploy Dixie (no upstream dependencies)
log "Phase 3: Deploying Dixie..."
deploy_service "dixie" "$RING"
health_gate "dixie" "http://dixie.${RING}.arrakis.community/api/health"

# Phase 4: Deploy Finn (needs DIXIE_BASE_URL)
log "Phase 4: Deploying Finn..."
deploy_service "finn" "$RING"
health_gate "finn" "http://finn.${RING}.arrakis.community/health"

# Phase 5: Deploy Freeside (needs both)
log "Phase 5: Deploying Freeside..."
deploy_service "freeside" "$RING"
health_gate "freeside" "https://${RING}.api.arrakis.community/health"

# Phase 6: Integration tests
log "Phase 6: Wiring tests..."
./scripts/staging-wiring-test.sh "$RING"

log "Deploy complete. All services healthy, wiring verified."
```

### 5.2 Health Gate Function

```bash
health_gate() {
  local service="$1"
  local url="$2"
  local start_time=$(date +%s)
  local consecutive=0
  local total_checks=0
  local latency_sum=0
  local fivexx_count=0
  local -a latency_window=()

  while true; do
    local elapsed=$(( $(date +%s) - start_time ))
    if (( elapsed > HEALTH_TIMEOUT )); then
      error "Health gate TIMEOUT for $service after ${HEALTH_TIMEOUT}s"
      exit 1
    fi

    local check_start=$(date +%s%N)
    local http_code
    http_code=$(curl -sf -o /dev/null -w '%{http_code}' --max-time 10 "$url" 2>/dev/null) || http_code="000"
    local check_end=$(date +%s%N)
    local latency_ms=$(( (check_end - check_start) / 1000000 ))

    total_checks=$((total_checks + 1))
    latency_sum=$((latency_sum + latency_ms))

    # SKP-004 / IMP-006: Track sliding-window p99 (not just per-request latency)
    latency_window+=("$latency_ms")

    if [[ "$http_code" == "200" ]]; then
      consecutive=$((consecutive + 1))
    elif [[ "$http_code" =~ ^5 ]]; then
      fivexx_count=$((fivexx_count + 1))
      if (( fivexx_count > 0 )); then
        error "Health gate FAILED for $service: ${fivexx_count} 5xx errors during gate"
        exit 1
      fi
    else
      consecutive=0  # Reset on non-200
    fi

    # Evaluate p99 over sliding window (need ≥10 samples)
    if (( ${#latency_window[@]} >= CONSECUTIVE_REQUIRED )); then
      local p99_latency
      p99_latency=$(printf '%s\n' "${latency_window[@]}" | sort -n | awk -v p=0.99 \
        'BEGIN{c=0} {v[c++]=$1} END{idx=int(c*p); if(idx>=c) idx=c-1; print v[idx]}')

      if (( consecutive >= CONSECUTIVE_REQUIRED )) && (( p99_latency < LATENCY_THRESHOLD_MS )); then
        local avg_latency=$((latency_sum / total_checks))
        log "Health gate PASSED for $service: ${consecutive} consecutive OK, p99=${p99_latency}ms, avg=${avg_latency}ms"
        return 0
      elif (( p99_latency >= LATENCY_THRESHOLD_MS )); then
        log "Health gate: p99 ${p99_latency}ms exceeds ${LATENCY_THRESHOLD_MS}ms — waiting..."
        consecutive=0  # Reset — SLO not met
      fi
    fi

    sleep "$HEALTH_INTERVAL"
  done
}
```

### 5.3 CI Serialization & Safety Gates

```yaml
# .github/workflows/deploy-staging.yml
concurrency:
  group: terraform-${{ github.event.inputs.environment || 'staging' }}
  cancel-in-progress: false  # Queue, don't cancel

# .github/workflows/dns-apply.yml
concurrency:
  group: terraform-dns-${{ github.event.inputs.environment || 'staging' }}
  cancel-in-progress: false
```

#### IMP-009: CI Gate for Destructive Plan Actions

Before any `terraform apply`, CI scans the plan for replacement or destroy actions on `prevent_destroy` resources:

```bash
# scripts/tf-plan-guard.sh — run in CI after terraform plan
#!/usr/bin/env bash
set -euo pipefail

PLAN_JSON="${1:?Usage: tf-plan-guard.sh <plan.json>}"
CRITICAL_RESOURCES=(
  "aws_elasticache_replication_group"
  "aws_dynamodb_table"
  "aws_s3_bucket"
  "aws_kms_key"
  "aws_route53_zone"
)

# Check for replace/delete actions on critical resource types
for resource_type in "${CRITICAL_RESOURCES[@]}"; do
  replacements=$(jq -r --arg rt "$resource_type" '
    [.resource_changes[] |
     select(.type == $rt and (.change.actions | contains(["delete"]) or contains(["create","delete"])))] |
     length' "$PLAN_JSON")

  if (( replacements > 0 )); then
    echo "BLOCKED: Plan contains replace/destroy for $resource_type ($replacements actions)"
    echo "This requires manual approval — prevent_destroy resource would be recreated."
    exit 1
  fi
done

echo "Plan guard PASSED: No destructive actions on critical resources."
```

Add to CI workflow after `terraform plan`:
```yaml
      - name: Plan Guard
        run: |
          terraform show -json plan.tfplan > plan.json
          ./scripts/tf-plan-guard.sh plan.json
```

### 5.4 Staging → Production Promotion Policy

Per PRD IMP-005:
1. Staging must pass: all wiring tests (W-1..W-10), health gates for all 3 services, `terraform plan` shows no unexpected changes
2. Staging must be green for ≥1 hour before production promotion
3. Production promotion requires: `DEPLOYMENT.md` checklist sign-off, manual approval gate in CI workflow
4. No direct-to-production applies

## 6. Wiring Test Design

### 6.1 `scripts/staging-wiring-test.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

RING="${1:?Usage: staging-wiring-test.sh <ring>}"
CLUSTER="arrakis-${RING}"
PASS=0
FAIL=0
RESULTS=()

# External tests (W-1 through W-3)
test_external() {
  local name="$1" url="$2"
  local code
  code=$(curl -sf -o /dev/null -w '%{http_code}' --max-time 15 "$url" 2>/dev/null) || code="000"
  if [[ "$code" == "200" ]]; then
    RESULTS+=("PASS: $name → HTTP $code")
    PASS=$((PASS + 1))
  else
    RESULTS+=("FAIL: $name → HTTP $code")
    FAIL=$((FAIL + 1))
  fi
}

# Internal tests via ECS Exec (W-4 through W-10)
test_internal() {
  local name="$1" task_service="$2" container="$3" cmd="$4"
  local task_arn
  task_arn=$(aws ecs list-tasks --cluster "$CLUSTER" --service-name "$task_service" \
    --query 'taskArns[0]' --output text)

  if [[ "$task_arn" == "None" ]]; then
    RESULTS+=("FAIL: $name → No running task for $task_service")
    FAIL=$((FAIL + 1))
    return
  fi

  local output
  if output=$(aws ecs execute-command --cluster "$CLUSTER" --task "$task_arn" \
    --container "$container" --command "/bin/sh -c '$cmd'" \
    --interactive 2>&1); then
    RESULTS+=("PASS: $name")
    PASS=$((PASS + 1))
  else
    RESULTS+=("FAIL: $name → $output")
    FAIL=$((FAIL + 1))
  fi
}

# W-1: External → Freeside
test_external "W-1 External→Freeside" "https://${RING}.api.arrakis.community/health"

# W-2: External → Finn (staging only)
test_external "W-2 External→Finn" "https://finn.${RING}.arrakis.community/health"

# W-3: External → Dixie
test_external "W-3 External→Dixie" "https://dixie.${RING}.arrakis.community/api/health"

# W-4: Freeside → Finn (Cloud Map)
test_internal "W-4 Freeside→Finn" "arrakis-${RING}-api" "api" \
  "curl -sf http://finn.arrakis-${RING}.local:3000/health"

# W-5: Freeside → Dixie (Cloud Map)
test_internal "W-5 Freeside→Dixie" "arrakis-${RING}-api" "api" \
  "curl -sf http://dixie.arrakis-${RING}.local:3001/api/health"

# W-6: Finn → Dixie (reputation query)
test_internal "W-6 Finn→Dixie" "arrakis-${RING}-finn" "finn" \
  "curl -sf http://dixie.arrakis-${RING}.local:3001/api/health"

# W-7: Finn → Freeside (JWKS)
test_internal "W-7 Finn→Freeside" "arrakis-${RING}-finn" "finn" \
  "curl -sf http://freeside.arrakis-${RING}.local:3000/.well-known/jwks.json"

# W-8: Finn → Redis (dedicated ElastiCache)
test_internal "W-8 Finn→Redis" "arrakis-${RING}-finn" "finn" \
  "node -e \"const r=require('ioredis');const c=new r(process.env.FINN_REDIS_URL);c.ping().then(p=>{console.log(p);c.quit()}).catch(e=>{console.error(e);process.exit(1)})\""

# W-9: Freeside → PostgreSQL (PgBouncer)
test_internal "W-9 Freeside→PgBouncer" "arrakis-${RING}-api" "api" \
  "node -e \"const {Pool}=require('pg');const p=new Pool({connectionString:process.env.DATABASE_URL});p.query('SELECT 1').then(()=>{console.log('OK');p.end()}).catch(e=>{console.error(e);process.exit(1)})\""

# W-10: Dixie → PostgreSQL (PgBouncer)
test_internal "W-10 Dixie→PgBouncer" "arrakis-${RING}-dixie" "dixie" \
  "node -e \"const {Pool}=require('pg');const p=new Pool({connectionString:process.env.DATABASE_URL});p.query('SELECT 1').then(()=>{console.log('OK');p.end()}).catch(e=>{console.error(e);process.exit(1)})\""

# Report
echo "════════════════════════════════════════"
echo "Wiring Test Results: ${PASS} passed, ${FAIL} failed"
echo "════════════════════════════════════════"
for r in "${RESULTS[@]}"; do echo "  $r"; done

if (( FAIL > 0 )); then
  echo "WIRING TESTS FAILED"
  exit 1
fi
```

### 6.2 ECS Exec Prerequisites

Add to `ecs.tf` (cluster configuration):

```hcl
resource "aws_ecs_cluster" "main" {
  name = local.name_prefix

  configuration {
    execute_command_configuration {
      logging = "OVERRIDE"
      log_configuration {
        cloud_watch_log_group_name = aws_cloudwatch_log_group.ecs_exec.name
      }
    }
  }
}
```

Add to each task role (finn, dixie, freeside):

```hcl
statement {
  effect = "Allow"
  actions = [
    "ssmmessages:CreateControlChannel",
    "ssmmessages:CreateDataChannel",
    "ssmmessages:OpenControlChannel",
    "ssmmessages:OpenDataChannel"
  ]
  resources = ["*"]
}
```

### 6.3 ECS Exec Network Prerequisites (IMP-007)

ECS Exec requires the `ssmmessages` API endpoint to be reachable from tasks. For tasks in private subnets (no NAT gateway), provision a VPC endpoint:

```hcl
resource "aws_vpc_endpoint" "ssmmessages" {
  vpc_id              = module.vpc.vpc_id
  service_name        = "com.amazonaws.${var.aws_region}.ssmmessages"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = module.vpc.private_subnets
  security_group_ids  = [aws_security_group.vpc_endpoints.id]
  private_dns_enabled = true

  tags = merge(local.common_tags, { Purpose = "ecs-exec" })
}

resource "aws_security_group" "vpc_endpoints" {
  name_prefix = "${local.name_prefix}-vpce-"
  vpc_id      = module.vpc.vpc_id

  ingress {
    from_port       = 443
    to_port         = 443
    protocol        = "tcp"
    security_groups = [
      aws_security_group.finn.id,
      aws_security_group.dixie.id,
      aws_security_group.ecs_tasks.id
    ]
    description = "HTTPS from ECS tasks for SSM messages"
  }

  tags = merge(local.common_tags, { Name = "${local.name_prefix}-vpce-ssm" })
}
```

**Note**: If tasks already have NAT gateway egress, the VPC endpoint is optional but recommended for lower latency and cost. Verify with `aws ecs execute-command` in staging before relying on wiring tests.

## 7. DNS Module Design

### 7.1 `dns/main.tf`

```hcl
terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.82.0"  # IMP-002: Exact minor version pin for deterministic plans
    }
  }

  backend "s3" {
    bucket         = "arrakis-tfstate-891376933289"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "arrakis-terraform-locks"
    # key is set via -backend-config at init time, e.g.:
    # terraform init -backend-config=environments/staging/backend.tfvars
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "Arrakis"
      Environment = var.environment
      ManagedBy   = "Terraform"
      Module      = "dns"
    }
  }
}

locals {
  name_prefix = "arrakis-${var.environment}"
}
```

### 7.2 `dns/variables.tf`

```hcl
variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "environment" {
  type = string
}

variable "domain" {
  type    = string
  default = "0xhoneyjar.xyz"
}

variable "vercel_anycast_ip" {
  type    = string
  default = "76.76.21.21"
  description = "Vercel anycast IP for A records (per Vercel docs for custom domains)"
}

variable "vercel_cname" {
  type    = string
  default = "cname.vercel-dns.com"
}

variable "google_workspace_mx" {
  type = list(object({
    priority = number
    value    = string
  }))
  default = [
    { priority = 1, value = "aspmx.l.google.com" },
    { priority = 5, value = "alt1.aspmx.l.google.com" },
    { priority = 5, value = "alt2.aspmx.l.google.com" },
    { priority = 10, value = "alt3.aspmx.l.google.com" },
    { priority = 10, value = "alt4.aspmx.l.google.com" }
  ]
}

variable "dkim_key" {
  type        = string
  default     = ""
  description = "Google Workspace DKIM public key (retrieve from Admin Console)"
  sensitive   = true
}

variable "enable_production_api" {
  type    = bool
  default = false
  description = "Create api.0xhoneyjar.xyz alias to compute ALB"
}

variable "enable_dnssec" {
  type    = bool
  default = false
  description = "Enable DNSSEC signing for the zone"
}

# IMP-008: Feature flag safety guardrails
# Environment-specific defaults prevent accidental production enablement.
# Staging tfvars: enable_production_api = true, enable_dnssec = true
# Production tfvars: enable_production_api = false, enable_dnssec = false (until cutover)
# CI lint rule: production tfvars must NOT set enable_dnssec=true without matching
# DS record upload confirmation in DEPLOYMENT.md checklist.

variable "dmarc_email" {
  type    = string
  default = "dmarc@0xhoneyjar.xyz"
}
```

### 7.3 `dns/honeyjar-xyz.tf`

```hcl
resource "aws_route53_zone" "honeyjar" {
  name    = var.domain
  comment = "Managed by Terraform (Armitage Platform)"

  tags = {
    Project = "Arrakis"
    Purpose = "production-dns"
  }
}

# Apex A record → Vercel
resource "aws_route53_record" "apex_a" {
  zone_id = aws_route53_zone.honeyjar.zone_id
  name    = var.domain
  type    = "A"
  ttl     = 300
  records = [var.vercel_anycast_ip]
}

# www CNAME → Vercel
resource "aws_route53_record" "www" {
  zone_id = aws_route53_zone.honeyjar.zone_id
  name    = "www.${var.domain}"
  type    = "CNAME"
  ttl     = 300
  records = [var.vercel_cname]
}
```

### 7.4 `dns/honeyjar-xyz-email.tf`

```hcl
# MX records — Google Workspace
resource "aws_route53_record" "mx" {
  zone_id = aws_route53_zone.honeyjar.zone_id
  name    = var.domain
  type    = "MX"
  ttl     = 3600

  records = [for mx in var.google_workspace_mx : "${mx.priority} ${mx.value}"]
}

# SPF
resource "aws_route53_record" "spf" {
  zone_id = aws_route53_zone.honeyjar.zone_id
  name    = var.domain
  type    = "TXT"
  ttl     = 3600
  records = ["v=spf1 include:_spf.google.com ~all"]
}

# DKIM (Google Workspace)
resource "aws_route53_record" "dkim" {
  count = var.dkim_key != "" ? 1 : 0

  zone_id = aws_route53_zone.honeyjar.zone_id
  name    = "google._domainkey.${var.domain}"
  type    = "TXT"
  ttl     = 3600
  records = [var.dkim_key]
}

# DMARC (FIXED — replaces broken Gandi placeholder)
resource "aws_route53_record" "dmarc" {
  zone_id = aws_route53_zone.honeyjar.zone_id
  name    = "_dmarc.${var.domain}"
  type    = "TXT"
  ttl     = 3600
  records = ["v=DMARC1; p=quarantine; rua=mailto:${var.dmarc_email}; ruf=mailto:${var.dmarc_email}; fo=1"]
}
```

### 7.5 `dns/honeyjar-xyz-vercel.tf`

```hcl
# Wildcard CNAME for Vercel deployments
resource "aws_route53_record" "wildcard" {
  zone_id = aws_route53_zone.honeyjar.zone_id
  name    = "*.${var.domain}"
  type    = "CNAME"
  ttl     = 300
  records = [var.vercel_cname]
}

# ACME challenge NS delegation to Vercel (for SSL cert issuance)
resource "aws_route53_record" "acme_challenge" {
  zone_id = aws_route53_zone.honeyjar.zone_id
  name    = "_acme-challenge.${var.domain}"
  type    = "NS"
  ttl     = 300
  records = ["ns1.vercel-dns.com.", "ns2.vercel-dns.com."]
}
```

### 7.6 `dns/honeyjar-xyz-agents.tf`

```hcl
# Agent economy wildcard: *.agents.0xhoneyjar.xyz
# More specific than *.0xhoneyjar.xyz per RFC 4592 — no conflict
resource "aws_route53_record" "agents_wildcard" {
  zone_id = aws_route53_zone.honeyjar.zone_id
  name    = "*.agents.${var.domain}"
  type    = "CNAME"
  ttl     = 300
  records = [var.vercel_cname]
}

# Bare agents.0xhoneyjar.xyz (explicit, prevents lookup failures)
resource "aws_route53_record" "agents_bare" {
  zone_id = aws_route53_zone.honeyjar.zone_id
  name    = "agents.${var.domain}"
  type    = "A"
  ttl     = 300
  records = [var.vercel_anycast_ip]
}

# ACME challenge delegation for agent wildcard certs
resource "aws_route53_record" "agents_acme" {
  zone_id = aws_route53_zone.honeyjar.zone_id
  name    = "_acme-challenge.agents.${var.domain}"
  type    = "NS"
  ttl     = 300
  records = ["ns1.vercel-dns.com.", "ns2.vercel-dns.com."]
}
```

### 7.7 `dns/honeyjar-xyz-backend.tf`

```hcl
# Step 1: Find ALB by tag (aws_lbs supports tag filtering; aws_lb does not)
data "aws_lbs" "compute" {
  count = var.enable_production_api ? 1 : 0

  tags = {
    Name = "arrakis-${var.environment}-alb"
  }

  lifecycle {
    postcondition {
      condition     = length(self.arns) == 1
      error_message = "Expected exactly one ALB matching arrakis-${var.environment}-alb, got ${length(self.arns)}"
    }
  }
}

# Step 2: Read ALB details by ARN
data "aws_lb" "compute_alb" {
  count = var.enable_production_api ? 1 : 0
  arn   = one(data.aws_lbs.compute[0].arns)
}

# Step 3: Create alias record
resource "aws_route53_record" "api" {
  count = var.enable_production_api ? 1 : 0

  zone_id = aws_route53_zone.honeyjar.zone_id
  name    = "api.${var.domain}"
  type    = "A"

  alias {
    name                   = data.aws_lb.compute_alb[0].dns_name
    zone_id                = data.aws_lb.compute_alb[0].zone_id
    evaluate_target_health = true
  }
}
```

### 7.8 `dns/security.tf`

```hcl
# CAA records — restrict certificate issuance
resource "aws_route53_record" "caa" {
  zone_id = aws_route53_zone.honeyjar.zone_id
  name    = var.domain
  type    = "CAA"
  ttl     = 3600
  records = [
    "0 issue \"letsencrypt.org\"",
    "0 issue \"amazon.com\"",
    "0 issuewild \"letsencrypt.org\"",
    "0 iodef \"mailto:security@0xhoneyjar.xyz\""
  ]
}

# DNSSEC (gated by feature flag)
resource "aws_route53_key_signing_key" "honeyjar" {
  count = var.enable_dnssec ? 1 : 0

  hosted_zone_id             = aws_route53_zone.honeyjar.zone_id
  key_management_service_arn = aws_kms_key.dnssec[0].arn
  name                       = "${var.domain}-ksk"
}

resource "aws_route53_hosted_zone_dnssec" "honeyjar" {
  count = var.enable_dnssec ? 1 : 0

  hosted_zone_id = aws_route53_zone.honeyjar.zone_id

  depends_on = [aws_route53_key_signing_key.honeyjar[0]]
}

resource "aws_kms_key" "dnssec" {
  count = var.enable_dnssec ? 1 : 0

  customer_master_key_spec = "ECC_NIST_P256"
  deletion_window_in_days  = 7
  key_usage                = "SIGN_VERIFY"
  description              = "DNSSEC KSK for ${var.domain}"

  # SKP-002 (applied to DNSSEC key): Explicit admin roles, no root kms:*
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowKeyAdministration"
        Effect = "Allow"
        Principal = {
          AWS = [
            "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/github-actions-terraform",
            "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/admin"
          ]
        }
        Action = [
          "kms:Create*", "kms:Describe*", "kms:Enable*", "kms:List*",
          "kms:Put*", "kms:Update*", "kms:Revoke*", "kms:Disable*",
          "kms:Get*", "kms:Delete*", "kms:TagResource", "kms:UntagResource",
          "kms:ScheduleKeyDeletion", "kms:CancelKeyDeletion"
        ]
        Resource = "*"
      },
      {
        Sid    = "AllowRoute53DNSSEC"
        Effect = "Allow"
        Principal = { Service = "dnssec-route53.amazonaws.com" }
        Action = ["kms:DescribeKey", "kms:GetPublicKey", "kms:Sign"]
        Resource = "*"
        Condition = {
          StringEquals = {
            "aws:SourceAccount" = data.aws_caller_identity.current.account_id
          }
        }
      }
    ]
  })
}

data "aws_caller_identity" "current" {}
```

### 7.9 `dns/outputs.tf`

```hcl
output "zone_id" {
  value = aws_route53_zone.honeyjar.zone_id
}

output "nameservers" {
  value       = aws_route53_zone.honeyjar.name_servers
  description = "Set these as NS records at Gandi registrar"
}

output "ds_record" {
  value       = var.enable_dnssec ? aws_route53_key_signing_key.honeyjar[0].ds_record : "DNSSEC not enabled"
  description = "DS record to upload to Gandi for DNSSEC chain"
}
```

## 8. Validation Scripts Design

### 8.1 `scripts/dns-pre-migration.sh`

Validates Route 53 records match Gandi before NS cutover:

```bash
#!/usr/bin/env bash
set -euo pipefail

DOMAIN="0xhoneyjar.xyz"
ZONE_ID=$(aws route53 list-hosted-zones-by-name --dns-name "$DOMAIN" \
  --query "HostedZones[0].Id" --output text | sed 's|/hostedzone/||')

# Records to compare (diff allowlist: SOA, NS, TTL differences expected)
DIFF_ALLOWLIST=("SOA" "NS")

compare_record() {
  local type="$1" name="$2"
  local r53_value gandi_value

  r53_value=$(aws route53 list-resource-record-sets --hosted-zone-id "$ZONE_ID" \
    --query "ResourceRecordSets[?Name=='${name}.' && Type=='${type}'].ResourceRecords[].Value" \
    --output text | sort)

  gandi_value=$(dig +short "$name" "$type" @dns.gandi.net | sort)

  if [[ "$r53_value" == "$gandi_value" ]]; then
    echo "MATCH: $type $name"
  elif printf '%s\n' "${DIFF_ALLOWLIST[@]}" | grep -q "^${type}$"; then
    echo "EXPECTED_DIFF: $type $name (in allowlist)"
  else
    echo "MISMATCH: $type $name"
    echo "  Route 53: $r53_value"
    echo "  Gandi:    $gandi_value"
    MISMATCHES=$((MISMATCHES + 1))
  fi
}

MISMATCHES=0

# Get Gandi authoritative nameservers (query current NS set, not fixed hostname)
GANDI_NS=$(dig +short NS "$DOMAIN" | head -1 | sed 's/\.$//')

compare_record_ns() {
  local type="$1" name="$2" ns="${3:-$GANDI_NS}"
  local r53_value gandi_value

  r53_value=$(aws route53 list-resource-record-sets --hosted-zone-id "$ZONE_ID" \
    --query "ResourceRecordSets[?Name=='${name}.' && Type=='${type}'].ResourceRecords[].Value" \
    --output text | sort)

  gandi_value=$(dig +short "$name" "$type" "@${ns}" | sort)

  if [[ "$r53_value" == "$gandi_value" ]]; then
    echo "MATCH: $type $name"
  elif printf '%s\n' "${DIFF_ALLOWLIST[@]}" | grep -q "^${type}$"; then
    echo "EXPECTED_DIFF: $type $name (in allowlist)"
  else
    echo "MISMATCH: $type $name"
    echo "  Route 53: $r53_value"
    echo "  Gandi:    $gandi_value"
    MISMATCHES=$((MISMATCHES + 1))
  fi
}

# Apex records
for type in A AAAA MX TXT CAA; do
  compare_record_ns "$type" "$DOMAIN"
done

# Explicit subdomains
compare_record_ns "CNAME" "www.${DOMAIN}"
compare_record_ns "CNAME" "*.${DOMAIN}"
compare_record_ns "TXT" "_dmarc.${DOMAIN}"
compare_record_ns "TXT" "google._domainkey.${DOMAIN}"

# Agent economy records
compare_record_ns "CNAME" "*.agents.${DOMAIN}"
compare_record_ns "A" "agents.${DOMAIN}"

# ACME delegation records (NS type)
compare_record_ns "NS" "_acme-challenge.${DOMAIN}"
compare_record_ns "NS" "_acme-challenge.agents.${DOMAIN}"

if (( MISMATCHES > 0 )); then
  echo "PRE-MIGRATION CHECK FAILED: $MISMATCHES mismatches"
  exit 1
fi
echo "PRE-MIGRATION CHECK PASSED: All records match (or in diff allowlist)"
```

### 8.2 `scripts/dns-post-migration-check.sh`

Monitors propagation after NS change with quantified checks per PRD IMP-003:

```bash
#!/usr/bin/env bash
set -euo pipefail

DOMAIN="0xhoneyjar.xyz"
RESOLVERS=("8.8.8.8" "1.1.1.1" "208.67.222.222" "9.9.9.9" "64.6.64.6"
           "185.228.168.9" "76.76.19.19" "94.140.14.14")
AGREEMENT_THRESHOLD=95  # ≥95% resolver agreement
TIMEOUT_HOURS=4
CHECK_INTERVAL=60  # 1 minute between full checks
MAX_CHECKS=$(( TIMEOUT_HOURS * 3600 / CHECK_INTERVAL ))

check_propagation() {
  local record_type="$1" name="$2" expected="$3"
  local agree=0 total=${#RESOLVERS[@]}

  for resolver in "${RESOLVERS[@]}"; do
    local result
    result=$(dig +short "$name" "$record_type" "@${resolver}" 2>/dev/null | sort | tr '\n' ',')
    if [[ "$result" == *"$expected"* ]]; then
      agree=$((agree + 1))
    fi
  done

  local pct=$(( agree * 100 / total ))
  echo "$pct"
}

check_email() {
  # MX record propagation is critical
  local mx_pct
  mx_pct=$(check_propagation "MX" "$DOMAIN" "aspmx.l.google.com")
  echo "MX propagation: ${mx_pct}%"
  (( mx_pct >= AGREEMENT_THRESHOLD ))
}

check_api_latency() {
  local url="https://api.${DOMAIN}/health"
  local latency
  latency=$(curl -sf -o /dev/null -w '%{time_total}' --max-time 5 "$url" 2>/dev/null || echo "99")
  local latency_ms=$(echo "$latency * 1000" | bc | cut -d. -f1)
  echo "API latency: ${latency_ms}ms"
  (( latency_ms < 500 ))
}

# Main monitoring loop
for (( i=1; i<=MAX_CHECKS; i++ )); do
  echo "Check $i/$MAX_CHECKS ($(date -u +%H:%M:%S))"

  a_pct=$(check_propagation "A" "$DOMAIN" "76.76.21.21")
  mx_pct=$(check_propagation "MX" "$DOMAIN" "aspmx.l.google.com")

  echo "  A record:  ${a_pct}% agreement"
  echo "  MX record: ${mx_pct}% agreement"

  if (( a_pct >= AGREEMENT_THRESHOLD )) && (( mx_pct >= AGREEMENT_THRESHOLD )); then
    echo "PROPAGATION COMPLETE: ≥${AGREEMENT_THRESHOLD}% agreement achieved"
    echo "Send test email to verify MX within 1 hour"
    exit 0
  fi

  sleep "$CHECK_INTERVAL"
done

echo "PROPAGATION TIMEOUT after ${TIMEOUT_HOURS}h — TRIGGER ROLLBACK ALERT"
echo "Rollback: Revert NS records at Gandi registrar"
exit 1
```

### 8.3 DNS Drift Check Workflow

```yaml
# .github/workflows/dns-drift-check.yml
name: DNS Drift Check
on:
  schedule:
    - cron: '0 6 * * *'  # Daily at 06:00 UTC
  workflow_dispatch:

jobs:
  drift-check:
    runs-on: ubuntu-latest
    concurrency:
      group: terraform-dns-drift
      cancel-in-progress: false
    steps:
      - uses: actions/checkout@v4
      - uses: hashicorp/setup-terraform@v3
      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.TERRAFORM_ROLE_ARN }}
          aws-region: us-east-1
      - name: Terraform Init
        working-directory: infrastructure/terraform/dns
        run: terraform init -backend-config=environments/production/backend.tfvars
      - name: Terraform Plan (drift detection)
        working-directory: infrastructure/terraform/dns
        run: |
          terraform plan -var-file=environments/production/terraform.tfvars \
            -detailed-exitcode -out=drift.tfplan 2>&1 | tee plan-output.txt
          EXIT_CODE=${PIPESTATUS[0]}
          if [ $EXIT_CODE -eq 2 ]; then
            echo "::warning::DNS drift detected — review plan output"
          fi
```

## 9. Security Architecture

### 9.1 Service Mesh Security Model (NFR-3)

All service-to-service traffic uses SG-to-SG references (no CIDR within mesh):

```
Internet → ALB SG (0.0.0.0/0:443) → ECS Tasks SG (from ALB SG)
                                    → Dixie SG (from ALB SG + Finn SG)

Finn SG:    ingress from ECS Tasks SG (port 3000)
            egress to PgBouncer SG (6432), Redis SG (6379), NATS SG (4222),
                    Dixie SG (3001), Freeside SG (3000), HTTPS (443)

Dixie SG:   ingress from ALB SG (3001) + Finn SG (3001)
            egress to PgBouncer SG (6432), Redis SG (6379), HTTPS (443)
```

**Finn's dedicated Redis SG**: Ingress only from Finn SG (not shared with other services).

### 9.2 State Backend Security (NFR-2, SKP-002)

- S3 bucket policy: deny `s3:PutObject` without `aws:kms` encryption
- DynamoDB lock table: `arrakis-terraform-locks` with PITR enabled
- IAM policy for CI: `arn:aws:iam::<account>:role/github-actions-terraform`
- No wildcard permissions on `s3://arrakis-tfstate-891376933289/*`
- Access logging on state bucket

### 9.3 DNS Security (Post-Migration)

- CAA records restrict cert issuance to Let's Encrypt + Amazon
- DNSSEC via feature flag (requires DS record upload to Gandi)
- DMARC ramped to `p=reject` 4 weeks post-cutover
- SPF pruned (remove Gandi include) after cutover confirmed

### 9.4 RPO/RTO Targets for Stateful Components (IMP-005)

| Component | RPO | RTO | Backup Mechanism | Recovery Procedure |
|-----------|-----|-----|-----------------|-------------------|
| ElastiCache Redis (Finn) | 1 second (AOF everysec) | 15 min (automatic failover) | AOF persistence + daily snapshots | Automatic: Multi-AZ failover. Manual: Restore from snapshot |
| DynamoDB (scoring-path-log) | 0 (synchronous replication) | < 5 min | PITR enabled (35-day window) | `aws dynamodb restore-table-to-point-in-time` |
| DynamoDB (x402-settlements) | 0 (synchronous replication) | < 5 min | PITR enabled (35-day window) | `aws dynamodb restore-table-to-point-in-time` |
| S3 (finn-audit-anchors) | 0 (cross-AZ replication) | N/A (always available) | Versioning + Object Lock | Objects are immutable; no recovery needed |
| S3 (finn-calibration) | 0 (cross-AZ replication) | < 1 min | Versioning enabled | `aws s3api get-object --version-id` for rollback |
| KMS (finn-audit-signing) | N/A (AWS-managed) | < 1 min | Automatic key material backup by AWS | Key rotation; 30-day deletion window for accidental disable |

**Monitoring**: CloudWatch alarms on `FreeableMemory` (Redis), `ConsumedReadCapacityUnits` (DynamoDB), and `NumberOfObjects` (S3) detect anomalies that may indicate data loss.

## 10. Deployment Workflow

### Phase 1: Compute Consolidation (Sprints 1-2)

```
1. Add 8 new .tf files to infrastructure/terraform/
2. terraform plan → verify "will be created" for new resources
3. Freeze loa-finn terraform applies
4. Export resource IDs from loa-finn state
5. Pre-import state backup (§4.4)
6. terraform import (22 resources, see §4) with per-batch verification
7. terraform plan → verify 0 changes on imported, creates on new
8. Run tf-plan-guard.sh (§5.3) — block any replace/destroy on critical resources
9. terraform apply
10. Finn cutover procedure (PRD FR-1):
    a. Scale finn legacy desired_count=0
    b. Apply freeside canonical (creates single Finn service)
    c. Health gate + wiring tests
    d. terraform state rm in finn's state for ECS/ALB/IAM resources
11. Deploy pipeline validation (deploy-ring.sh --ring staging)
```

**Phase 1 Rollback Plan** (IMP-001):
```
TRIGGER: Import produces unexpected plan diff OR health gate fails post-apply
OWNER: Infrastructure engineer
STEPS:
  1. terraform state rm <resource> for any mis-imported resources
  2. Restore state from pre-import backup if needed
  3. Re-enable loa-finn terraform applies (unfreeze)
  4. For Finn cutover failure: re-scale legacy desired_count=1, scale canonical to 0
  5. Verify: health gates + wiring tests pass with legacy configuration
RECOVERY TIME: <15 min (state operations only, no infrastructure changes)
```

### Phase 2: DNS Module (Sprint 3)

```
1. Create infrastructure/terraform/dns/ (11 files)
2. terraform init -backend-config=environments/staging/backend.tfvars
3. terraform plan → all creates
4. terraform apply → zone + records created
5. dns-pre-migration.sh → validate functional equivalence with Gandi
6. Manual: Lower TTLs at Gandi to 300s (48h before cutover)
```

### Phase 3: DNS Cutover & Hardening (Sprints 4-5)

#### SKP-001: Formal DNS Cutover Playbook

**T-72h: TTL Reduction**
```
1. Lower ALL record TTLs at Gandi to 300s (A, MX, TXT, CNAME, CAA)
2. Verify lower TTLs propagated: dig +short @8.8.8.8 0xhoneyjar.xyz | check TTL in dig +noall +answer
3. Confirm negative cache TTL (SOA MINIMUM) at Gandi is ≤300s
4. Document registrar's NS update SLA (Gandi: typically <15 min)
```

**T-0: NS Cutover**
```
1. Pre-flight: dns-pre-migration.sh → must PASS (all records match)
2. Manual: Update NS records at Gandi → Route 53 nameservers
3. Immediately start dns-post-migration-check.sh → monitor propagation
4. Multi-geo validation: Check from 8 diverse resolvers (see §8.2)
5. Verify email delivery: Send test email within 30 min of cutover
6. Monitor: CloudWatch DNS query logs + Gandi legacy traffic (if available)
```

**T+1h: Verification Gate**
```
1. ≥95% resolver agreement on A and MX records
2. Test email sent AND received successfully
3. HTTPS cert still valid on all subdomains (agents.*, www.*, api.*)
4. No elevated error rates in CloudWatch
```

**T+24h: Enable API Record**
```
1. Set enable_production_api=true in production tfvars
2. terraform plan → verify only api.0xhoneyjar.xyz A alias record created
3. terraform apply
4. Health gate: curl https://api.0xhoneyjar.xyz/health → 200
```

**Rollback Procedure** (IMP-001):
```
TRIGGER: ≥2 of: MX propagation <80%, A record propagation <80%, cert issuance failure
OWNER: On-call engineer (documented in DEPLOYMENT.md)
STEPS:
  1. Revert NS records at Gandi registrar (< 5 min manual action)
  2. Gandi re-asserts authority within TTL window (≤300s due to T-72h reduction)
  3. Verify Gandi NS serving: dig NS 0xhoneyjar.xyz @8.8.8.8
  4. Negative cache flush: wait SOA MINIMUM (300s) for NXDOMAIN recovery
  5. Send test email to confirm MX recovery
  6. Post-mortem: document what failed, fix in Route 53, re-attempt
RECOVERY TIME: <30 min (dominated by registrar NS update propagation)
```

#### IMP-004: DNSSEC Activation Playbook

DNSSEC activation is a **separate operation** from NS cutover, performed ≥48h after confirmed NS migration:

```
PREREQUISITES:
  - NS cutover confirmed stable for ≥48h
  - dns-drift-check.yml running clean for ≥2 days

SEQUENCE:
  1. Set enable_dnssec=true in production tfvars
  2. terraform plan → verify KSK + zone signing resources created
  3. terraform apply → Route 53 signs the zone
  4. Extract DS record: terraform output ds_record
  5. Upload DS record to Gandi registrar (establishes chain of trust)
  6. Monitor: dig +dnssec 0xhoneyjar.xyz → verify RRSIG present
  7. Validate chain: https://dnsviz.net/d/0xhoneyjar.xyz/dnssec/
  8. Monitor for 24h: no elevated SERVFAIL rates

ROLLBACK:
  TRIGGER: SERVFAIL rate >1% from major resolvers OR dnsviz shows broken chain
  STEPS:
    1. Remove DS record at Gandi registrar (breaks chain of trust, resolvers fall back to unsigned)
    2. Set enable_dnssec=false in production tfvars
    3. terraform apply → removes KSK and zone signing
    4. Verify: dig 0xhoneyjar.xyz → responses returned without RRSIG (unsigned, but resolvable)
    5. Wait 24h before re-attempting
```

#### Legacy Phase 3 Steps (retained)

```
6. Ramp DMARC to p=reject (4 weeks post-cutover)
7. dns-drift-check.yml activated (nightly)
```

## 11. Technical Risks & Mitigations

| Risk | Impact | Mitigation | Fallback |
|------|--------|------------|----------|
| Import fails for stateful resource | Data loss if recreated | Safe import workflow (§4): add code → plan → import → plan-again. State snapshot before every apply. | Fix definition to match actual resource, re-import |
| Partial apply corrupts state | Services unreachable | Phased applies (networking/IAM first, compute second). DynamoDB lock prevents concurrent applies. | Run-forward with targeted fixes (prefer over rollback) |
| DNS migration breaks email | Google Workspace email down | Pre-migration validation (§8.1), low TTL, MX propagation monitoring | Revert NS at Gandi registrar (< 30 min recovery) |
| Duplicate Finn ECS services | Two competing services, routing chaos | Finn cutover procedure: scale-to-zero → apply canonical → verify → retire legacy | Rollback: re-enable legacy, scale canonical to 0 |
| `data.aws_lb` resolves wrong ALB | DNS points to wrong load balancer | Deterministic tag filter + postcondition validation | Use `terraform_remote_state` as alternative |
| Concurrent TF applies during migration | State corruption | CI `concurrency` groups + documented prohibition of local applies | DynamoDB lock provides last-resort protection |
| ECS Exec not enabled | Can't run internal wiring tests | Enable in cluster config + IAM + SSM endpoint access | Defer internal tests, use CloudWatch logs for verification |

## 12. File Manifest

### New Files — Compute Root (8 files)

| File | Sprint | Purpose |
|------|--------|---------|
| `infrastructure/terraform/elasticache-finn.tf` | 1 | Dedicated Redis (noeviction + AOF) |
| `infrastructure/terraform/dynamodb-finn.tf` | 1 | 2 DynamoDB tables + GSI |
| `infrastructure/terraform/s3-finn.tf` | 1 | 2 S3 buckets (Object Lock + calibration) |
| `infrastructure/terraform/kms-finn.tf` | 1 | KMS audit signing key |
| `infrastructure/terraform/env-finn.tf` | 1 | 13 SSM SecureString parameters |
| `infrastructure/terraform/monitoring-finn.tf` | 2 | 6 CloudWatch alarms + metric filters |
| `infrastructure/terraform/monitoring-dixie.tf` | 2 | 4 CloudWatch alarms + metric filters |
| `infrastructure/terraform/autoscaling-dixie.tf` | 2 | AppAutoScaling target + CPU policy |

### New Files — DNS Root (13 files)

| File | Sprint | Purpose |
|------|--------|---------|
| `infrastructure/terraform/dns/main.tf` | 3 | Backend config, providers |
| `infrastructure/terraform/dns/variables.tf` | 3 | Environment vars, feature flags |
| `infrastructure/terraform/dns/outputs.tf` | 3 | Zone ID, nameservers, DS record |
| `infrastructure/terraform/dns/honeyjar-xyz.tf` | 3 | Zone + apex A records |
| `infrastructure/terraform/dns/honeyjar-xyz-email.tf` | 3 | MX, SPF, DKIM, DMARC |
| `infrastructure/terraform/dns/honeyjar-xyz-vercel.tf` | 3 | Wildcard CNAME, ACME delegation |
| `infrastructure/terraform/dns/honeyjar-xyz-agents.tf` | 3 | Agent economy wildcards |
| `infrastructure/terraform/dns/honeyjar-xyz-backend.tf` | 3 | api subdomain → ALB alias |
| `infrastructure/terraform/dns/security.tf` | 3 | CAA, DNSSEC |
| `infrastructure/terraform/dns/environments/staging/terraform.tfvars` | 3 | Staging variables |
| `infrastructure/terraform/dns/environments/staging/backend.tfvars` | 3 | Staging state key (`dns/staging.tfstate`) |
| `infrastructure/terraform/dns/environments/production/terraform.tfvars` | 3 | Production variables |
| `infrastructure/terraform/dns/environments/production/backend.tfvars` | 3 | Production state key (`dns/production.tfstate`) |

### New Files — Scripts (6 files)

| File | Sprint | Purpose |
|------|--------|---------|
| `scripts/deploy-ring.sh` | 2 | Sequential deploy orchestrator with p99 health gates |
| `scripts/staging-wiring-test.sh` | 2 | E2E connectivity validation |
| `scripts/tf-plan-guard.sh` | 2 | CI gate blocking replace/destroy on critical resources (IMP-009) |
| `scripts/bootstrap-redis-auth.sh` | 1 | External Redis auth token provisioning (SKP-003) |
| `scripts/dns-pre-migration.sh` | 4 | Pre-cutover record comparison |
| `scripts/dns-post-migration-check.sh` | 4 | Post-cutover propagation monitor |

### New Files — CI (1 file)

| File | Sprint | Purpose |
|------|--------|---------|
| `.github/workflows/dns-drift-check.yml` | 5 | Nightly DNS drift detection |

### New Files — Infrastructure (IMP-007)

| File | Sprint | Purpose |
|------|--------|---------|
| VPC endpoint resource in `ecs.tf` | 2 | ssmmessages VPC endpoint for ECS Exec |

### Modified Files

| File | Sprint | Change |
|------|--------|--------|
| `infrastructure/terraform/ecs.tf` | 2 | Add ECS Exec configuration, ssmmessages VPC endpoint + SG (IMP-007) |
| `infrastructure/terraform/variables.tf` | 1 | Add `finn_redis_node_type`, `dixie_max_count` vars |
| `infrastructure/terraform/environments/staging/terraform.tfvars` | 1 | Add finn redis + dixie scaling values |
| `infrastructure/terraform/environments/production/terraform.tfvars` | 3 | Feature flag defaults: `enable_production_api=false`, `enable_dnssec=false` (IMP-008) |
| `DEPLOYMENT.md` | 2 | Import procedure, deploy-ring usage, rollback commands, cutover playbooks |

**Total: 29 new files, 5 modified files across 5 sprints.**

### Flatline Integration Traceability (IMP-010)

| Finding | Section(s) Modified | Integration Type |
|---------|---------------------|-----------------|
| SKP-001 | §10 Phase 3 | DNS cutover playbook with rollback |
| SKP-002 | §3.4 | KMS key policy least-privilege |
| SKP-003 | §3.1 | External Redis auth provisioning |
| SKP-004 | §5.2 | Sliding-window p99 health gate |
| IMP-001 | §10 Phase 1, Phase 3 | Executable rollback plans |
| IMP-002 | §7.1 | Exact provider version pin |
| IMP-003 | §4.4 | Import procedural safeguards |
| IMP-004 | §10 Phase 3 | DNSSEC activation playbook |
| IMP-005 | §9.4 | RPO/RTO targets table |
| IMP-006 | §5.2 | Merged with SKP-004 |
| IMP-007 | §6.3 | VPC endpoint for ssmmessages |
| IMP-008 | §7.2 | Feature flag safety comments |
| IMP-009 | §5.3 | CI plan guard script |
| IMP-010 | §12 | This traceability table |

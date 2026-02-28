# Deployment Guide — Armitage Platform (Cycle 046)

> **SDD Reference**: §4.1-§4.5 (Import Inventory & Procedural Safeguards)
> **Sprint**: Sprint 1 (Stateful Resource Consolidation)

## Pre-Import Checklist

- [ ] IAM permissions verified: `elasticache:*`, `dynamodb:*`, `s3:*`, `kms:*`, `ssm:*`, `secretsmanager:*`, `cloudwatch:*`
- [ ] State backend accessible: `terraform init -backend-config=environments/staging/backend.tfvars`
- [ ] Peer session active (Change Approval Protocol)
- [ ] loa-finn Terraform state accessible for identifier confirmation

## Import Inventory

### Task 1.0: Resource Identifier Confirmation

Before importing, confirm exact physical IDs from loa-finn state:

```bash
# From loa-finn Terraform directory:
terraform state show aws_elasticache_replication_group.finn_dedicated
terraform state show aws_elasticache_parameter_group.finn_redis
terraform state show aws_dynamodb_table.finn_scoring_path_log
terraform state show aws_dynamodb_table.finn_x402_settlements
terraform state show aws_s3_bucket.finn_audit_anchors
terraform state show aws_s3_bucket.finn_calibration
terraform state show aws_kms_key.finn_audit_signing
terraform state show aws_kms_alias.finn_audit_signing
```

Record the physical IDs in the table below before proceeding.

### Task 1.3: Import Execution

#### Step 0: State Backup (SKP-002a)

```bash
# Secure backup: encrypted S3 upload with sha256 checksum
terraform state pull > backup-$(date +%Y%m%d-%H%M%S).tfstate
sha256sum backup-*.tfstate > backup-checksums.txt
aws s3 cp backup-*.tfstate s3://arrakis-tfstate-891376933289/backups/ --sse aws:kms
aws s3 cp backup-checksums.txt s3://arrakis-tfstate-891376933289/backups/ --sse aws:kms

# Restore drill: verify restore works before first import
aws s3 cp s3://arrakis-tfstate-891376933289/backups/backup-*.tfstate /tmp/restore-test.tfstate
# In a scratch workspace: terraform state push /tmp/restore-test.tfstate
```

#### Step 1: Import Stateful Resources (Batch 1 — Data Stores)

```bash
# Pre-import plan (document expected creates)
terraform plan -var-file=environments/staging/terraform.tfvars

# ElastiCache
terraform import aws_elasticache_replication_group.finn_dedicated arrakis-staging-finn-redis
terraform import aws_elasticache_parameter_group.finn_redis arrakis-staging-finn-redis-params

# Post-import diff — must show 0 changes for imported resources
terraform plan -var-file=environments/staging/terraform.tfvars

# Checkpoint commit
git add -A && git commit -m "import: elasticache-finn (replication group + parameter group)"
```

#### Step 2: Import DynamoDB Tables

```bash
terraform import aws_dynamodb_table.finn_scoring_path_log arrakis-staging-finn-scoring-path-log
terraform import aws_dynamodb_table.finn_x402_settlements arrakis-staging-finn-x402-settlements

terraform plan -var-file=environments/staging/terraform.tfvars
git add -A && git commit -m "import: dynamodb-finn (scoring_path_log + x402_settlements)"
```

#### Step 3: Import S3 Buckets

```bash
terraform import aws_s3_bucket.finn_audit_anchors arrakis-staging-finn-audit-anchors
terraform import aws_s3_bucket.finn_calibration arrakis-staging-finn-calibration

terraform plan -var-file=environments/staging/terraform.tfvars
git add -A && git commit -m "import: s3-finn (audit_anchors + calibration)"
```

#### Step 4: Import KMS Key

```bash
# Get key-id from loa-finn state
terraform import aws_kms_key.finn_audit_signing {key-id-from-finn-state}
terraform import aws_kms_alias.finn_audit_signing alias/arrakis-staging-finn-audit-signing

terraform plan -var-file=environments/staging/terraform.tfvars
git add -A && git commit -m "import: kms-finn (audit signing key + alias)"
```

#### Step 5: Import SSM Parameters (Batch)

```bash
terraform import 'aws_ssm_parameter.finn["finn/database-url"]' /arrakis-staging/finn/database-url
terraform import 'aws_ssm_parameter.finn["finn/redis-url"]' /arrakis-staging/finn/redis-url
terraform import 'aws_ssm_parameter.finn["finn/freeside-base-url"]' /arrakis-staging/finn/freeside-base-url
terraform import 'aws_ssm_parameter.finn["finn/arrakis-jwks-url"]' /arrakis-staging/finn/arrakis-jwks-url
terraform import 'aws_ssm_parameter.finn["finn/dixie-reputation-url"]' /arrakis-staging/finn/dixie-reputation-url
terraform import 'aws_ssm_parameter.finn["finn/nats-url"]' /arrakis-staging/finn/nats-url
terraform import 'aws_ssm_parameter.finn["finn/s2s-key-kid"]' /arrakis-staging/finn/s2s-key-kid
terraform import 'aws_ssm_parameter.finn["finn/nowpayments-webhook"]' /arrakis-staging/finn/nowpayments-webhook
terraform import 'aws_ssm_parameter.finn["finn/log-level"]' /arrakis-staging/finn/log-level
terraform import 'aws_ssm_parameter.finn["finn/node-env"]' /arrakis-staging/finn/node-env
terraform import 'aws_ssm_parameter.finn["finn/feature-payments"]' /arrakis-staging/finn/feature-payments
terraform import 'aws_ssm_parameter.finn["finn/feature-inference"]' /arrakis-staging/finn/feature-inference
terraform import 'aws_ssm_parameter.finn["finn/audit-bucket"]' /arrakis-staging/finn/audit-bucket

terraform plan -var-file=environments/staging/terraform.tfvars
git add -A && git commit -m "import: env-finn (13 SSM parameters)"
```

#### Step 6: Import CloudWatch Log Group (if legacy exists)

```bash
terraform import aws_cloudwatch_log_group.finn /ecs/arrakis-staging/finn

terraform plan -var-file=environments/staging/terraform.tfvars
git add -A && git commit -m "import: cloudwatch log group finn"
```

### Post-Import Verification (SDD §4.5)

```bash
# Final comprehensive plan — expected output:
# - 0 changes for all imported resources
# - "create" for new monitoring/scaling resources only
# - NO destroys or replaces
terraform plan -var-file=environments/staging/terraform.tfvars
```

### Rollback Procedure

If any import produces unexpected plan diff:

```bash
# Un-import the problematic resource
terraform state rm <resource_address>

# Fix HCL definition to match existing resource attributes
# Re-import after fix

# Full state reset (emergency only):
aws s3 cp s3://arrakis-tfstate-891376933289/backups/backup-YYYYMMDD-HHMMSS.tfstate ./
terraform state push backup-YYYYMMDD-HHMMSS.tfstate
```

### Cleanup

```bash
# Delete local backup files after S3 upload confirmed
rm -f backup-*.tfstate backup-checksums.txt
```

## Redis Auth Bootstrap

After import, bootstrap the dedicated Redis auth token:

```bash
# Requires peer session (Change Approval Protocol)
./scripts/bootstrap-redis-auth.sh staging

# Verify: restart Finn tasks to pick up new credentials
aws ecs update-service --cluster arrakis-staging --service arrakis-staging-finn --force-new-deployment
```

Rotation cadence: quarterly, or on security incident.

## Deploy Pipeline (Sprint 2)

### deploy-ring.sh Usage

```bash
# Deploy all services to staging
./scripts/deploy-ring.sh staging

# Deploy specific services only
./scripts/deploy-ring.sh staging --services finn,freeside

# With custom health thresholds
HEALTH_P99_THRESHOLD_MS=3000 HEALTH_5XX_LIMIT=5 ./scripts/deploy-ring.sh staging
```

**Phases**: Build → TF Apply → Dixie → Finn → Freeside → Wiring Tests

**Health Gate Thresholds** (configurable via env vars):
| Variable | Default | Description |
|----------|---------|-------------|
| `HEALTH_P99_THRESHOLD_MS` | 2000 | p99 latency must be below this (ms) |
| `HEALTH_5XX_LIMIT` | 3 | Max 5xx errors before rollback |
| `HEALTH_CONSECUTIVE_CHECKS` | 10 | Consecutive healthy checks required |
| `HEALTH_TIMEOUT` | 300 | Timeout per health gate (seconds) |

### Rollback Procedures (IMP-004)

#### ECS Service Rollback (automated by deploy-ring.sh)

```bash
# Time limit: 5 minutes
# Trigger: health gate failure (5xx > limit or p99 > threshold for > timeout)
# deploy-ring.sh does this automatically, but manual override:
aws ecs update-service \
  --cluster arrakis-staging \
  --service arrakis-staging-finn \
  --task-definition <previous-task-definition-arn> \
  --force-new-deployment

# Verify: wait for service stability
aws ecs wait services-stable --cluster arrakis-staging --services arrakis-staging-finn

# Expected: service returns to previous healthy state within 5 minutes
```

#### Terraform Import Rollback

```bash
# Trigger: import produces force-replacement on any resource
# Time limit: immediate
terraform state rm <resource_address>
# Fix HCL, re-import
```

#### Full State Rollback (emergency)

```bash
# Trigger: multiple import failures, state corruption
# Time limit: 15 minutes
aws s3 cp s3://arrakis-tfstate-891376933289/backups/backup-YYYYMMDD-HHMMSS.tfstate ./
terraform state push backup-YYYYMMDD-HHMMSS.tfstate
terraform plan -var-file=environments/staging/terraform.tfvars
# Verify: plan shows expected state
```

### Secret Handling Protocol (IMP-008)

- No credential values in commit messages, PR descriptions, or CI logs
- `.tfstate` backups excluded from git (`.gitignore` pattern: `*.tfstate*`)
- `bootstrap-redis-auth.sh` output must not be piped to log files
- SSM SecureString values managed outside Terraform (`ignore_changes = [value]`)
- All secrets encrypted with KMS (either `aws_kms_key.secrets` or `aws_kms_key.finn_audit_signing`)
- Local `terraform apply` prohibited during migration — all applies via CI

### Wiring Tests

```bash
# Run all 10 connectivity tests
./scripts/staging-wiring-test.sh staging
```

| Test | Path | Method |
|------|------|--------|
| W-1 | External → Freeside | curl health endpoint |
| W-2 | External → Finn | curl health endpoint |
| W-3 | External → Dixie | curl health endpoint |
| W-4 | Freeside → Finn | ECS Exec + Cloud Map |
| W-5 | Freeside → Dixie | ECS Exec + Cloud Map |
| W-6 | Finn → Dixie | ECS Exec + Cloud Map |
| W-7 | Finn → Freeside (JWKS) | ECS Exec + Cloud Map |
| W-8 | Finn → Redis | ECS Exec + ioredis ping |
| W-9 | Freeside → PgBouncer | ECS Exec + pg query |
| W-10 | Dixie → PgBouncer | ECS Exec + pg query |

### CI Plan Guard

```bash
# Run after terraform plan in CI
terraform show -json plan.tfplan > plan.json
./scripts/tf-plan-guard.sh plan.json
```

Blocks replace/destroy on: ElastiCache, DynamoDB, S3, KMS, Route 53 zones.

## Alarm Response Runbook (IMP-010)

| Alarm | Owner | First Response | Escalation |
|-------|-------|----------------|------------|
| `finn-cpu-high` | Platform | Check ECS task count, review recent deploys | Scale up `finn_desired_count` |
| `finn-memory-high` | Platform | Check for memory leaks via CloudWatch Logs Insights | Restart tasks, investigate OOM |
| `finn-5xx` | Platform + Backend | Check application logs, recent deploys | Rollback via `deploy-ring.sh` |
| `finn-task-count` | Platform | Check ECS events for placement failures | Verify subnet/SG config |
| `finn-latency-p99` | Platform + Backend | Check Redis latency, DB query times | Scale Redis node type |
| `finn-redis-connection` | Platform | Check SG rules, Redis status | Verify bootstrap-redis-auth.sh ran |
| `dixie-cpu-high` | Platform | Check auto-scaling policy, recent traffic | Adjust `dixie_max_count` |
| `dixie-memory-high` | Platform | Check task memory config | Increase `dixie_memory` |
| `dixie-5xx` | Platform + Backend | Check application logs | Rollback via `deploy-ring.sh` |
| `dixie-task-count` | Platform | Check ECS events | Verify auto-scaling target |

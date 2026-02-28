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

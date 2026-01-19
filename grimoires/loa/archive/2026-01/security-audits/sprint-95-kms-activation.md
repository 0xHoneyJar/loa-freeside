# Sprint 95: KMS Activation & Security Completion

**Source**: `grimoires/loa/a2a/sprint-94/auditor-sprint-feedback.md`
**Created**: 2026-01-18
**Priority**: P0 - CRITICAL (blocks production deployment)
**Estimated Effort**: 8 hours

---

## Sprint Overview

This sprint completes the critical security remediation work from Sprint 94. The auditor identified that while the implementation quality was excellent (5/5 for IAM segregation and Guild ID validation), the KMS encryption controls are prepared but NOT ACTIVE.

| Task | Finding | Severity | CVSS | Status |
|------|---------|----------|------|--------|
| S-95.1 | A-94.1: Secrets Manager KMS | CRITICAL | 8.1 | Pending |
| S-95.2 | A-94.2: Terraform State KMS | CRITICAL | 9.8 | Pending |
| S-95.3 | A-94.3: Legacy IAM Role | HIGH | 7.5 | Pending |
| S-95.4 | A-95: KMS Key Protection | LOW | 4.3 | Pending |

**Security Posture Impact**:
- Before Sprint 95: HIGH RISK (CVSS 8.1 + 7.5)
- After Sprint 95: LOW RISK (All critical cryptographic controls active)

---

## S-95.1: Enable KMS Encryption for Secrets Manager

**Finding**: A-94.1 - Secrets Manager Lacks KMS Encryption
**CVSS**: 8.1 (Critical)
**Estimated Effort**: 2 hours

**Description**: All 5 Terraform-managed AWS Secrets Manager secrets lack explicit KMS encryption. They are currently encrypted with AWS-managed keys (default), NOT the customer-managed KMS key created in `kms.tf`.

**Affected Resources**:
| Secret | File | Current State |
|--------|------|---------------|
| `${local.name_prefix}/database` | rds.tf | Missing `kms_key_id` |
| `${local.name_prefix}/redis` | elasticache.tf | Missing `kms_key_id` |
| `${local.name_prefix}/rabbitmq` | rabbitmq.tf | Missing `kms_key_id` |
| `${local.name_prefix}/nats` | nats.tf | Missing `kms_key_id` |
| `${local.name_prefix}/pgbouncer` | pgbouncer.tf | Missing `kms_key_id` |

**Acceptance Criteria**:
- [ ] Add `kms_key_id = aws_kms_key.secrets.id` to `aws_secretsmanager_secret.db_credentials`
- [ ] Add `kms_key_id = aws_kms_key.secrets.id` to `aws_secretsmanager_secret.redis_credentials`
- [ ] Add `kms_key_id = aws_kms_key.secrets.id` to `aws_secretsmanager_secret.rabbitmq_credentials`
- [ ] Add `kms_key_id = aws_kms_key.secrets.id` to `aws_secretsmanager_secret.nats`
- [ ] Add `kms_key_id = aws_kms_key.secrets.id` to `aws_secretsmanager_secret.pgbouncer_credentials`
- [ ] Run `terraform plan` to verify secrets will be re-encrypted
- [ ] Apply changes to staging first
- [ ] Verify secrets are encrypted with customer KMS key: `aws secretsmanager describe-secret --secret-id <id> --query 'KmsKeyId'`
- [ ] Verify all services still have access to their secrets

**Files to Modify**:
- `infrastructure/terraform/rds.tf`
- `infrastructure/terraform/elasticache.tf`
- `infrastructure/terraform/rabbitmq.tf`
- `infrastructure/terraform/nats.tf`
- `infrastructure/terraform/pgbouncer.tf`

**Implementation**:
```hcl
# Example change for each file:
resource "aws_secretsmanager_secret" "db_credentials" {
  name                    = "${local.name_prefix}/database"
  recovery_window_in_days = 7
  kms_key_id              = aws_kms_key.secrets.id  # ADD THIS LINE

  tags = merge(local.common_tags, {
    Service = "Database"
    Sprint  = "95"  # UPDATE TAG
  })
}
```

**Rollback Plan**: Remove `kms_key_id` attribute (secrets will revert to AWS-managed encryption)

---

## S-95.2: Activate Terraform State KMS Encryption

**Finding**: A-94.2 - Terraform State KMS Encryption Not Active
**CVSS**: 9.8 (Critical)
**Estimated Effort**: 4 hours (includes testing and validation)

**Description**: The KMS key configuration for Terraform state encryption is commented out in both staging and production backend configs. The infrastructure is PREPARED but NOT ACTIVE.

**Current State**:
```hcl
# environments/staging/backend.tfvars
encrypt = true  # S3 default encryption only
# kms_key_id = "alias/arrakis-terraform-state"  # COMMENTED OUT
```

**Acceptance Criteria**:
- [ ] Create KMS key for Terraform state: `aws kms create-key --description "Arrakis Terraform state encryption"`
- [ ] Create KMS alias: `aws kms create-alias --alias-name alias/arrakis-terraform-state --target-key-id <key-id>`
- [ ] Enable key rotation: `aws kms enable-key-rotation --key-id <key-id>`
- [ ] Backup current state files before migration
- [ ] Uncomment `kms_key_id` in `environments/staging/backend.tfvars`
- [ ] Run `terraform init -backend-config=environments/staging/backend.tfvars -reconfigure`
- [ ] Verify state encryption: `aws s3api head-object --bucket <bucket> --key <key> --query 'SSEKMSKeyId'`
- [ ] Repeat for production after staging verification
- [ ] Document emergency state recovery procedure

**Files to Modify**:
- `infrastructure/terraform/environments/staging/backend.tfvars`
- `infrastructure/terraform/environments/production/backend.tfvars`

**Implementation Steps**:

**Step 1: Create KMS Key (Manual - Run Once)**
```bash
# Create the KMS key
aws kms create-key \
  --description "Arrakis Terraform state encryption" \
  --tags TagKey=Project,TagValue=Arrakis TagKey=Purpose,TagValue=TerraformState \
  --query 'KeyMetadata.KeyId' --output text

# Save the key ID (example: 12345678-1234-1234-1234-123456789012)
KEY_ID="<key-id-from-above>"

# Create alias for easier reference
aws kms create-alias \
  --alias-name alias/arrakis-terraform-state \
  --target-key-id $KEY_ID

# Enable automatic key rotation (annual)
aws kms enable-key-rotation --key-id $KEY_ID

# Verify key exists
aws kms describe-key --key-id alias/arrakis-terraform-state
```

**Step 2: Backup Current State**
```bash
# Backup staging state
aws s3 cp s3://arrakis-tfstate-891376933289/staging/terraform.tfstate \
  ./terraform-state-backup-staging-$(date +%Y%m%d).tfstate

# Backup production state
aws s3 cp s3://arrakis-tfstate-891376933289/production/terraform.tfstate \
  ./terraform-state-backup-production-$(date +%Y%m%d).tfstate
```

**Step 3: Update Backend Config**
```hcl
# environments/staging/backend.tfvars - UNCOMMENT THE LINE:
kms_key_id = "alias/arrakis-terraform-state"
```

**Step 4: Migrate Backend**
```bash
cd infrastructure/terraform
terraform init -backend-config=environments/staging/backend.tfvars -reconfigure
```

**Step 5: Verify Encryption**
```bash
aws s3api head-object \
  --bucket arrakis-tfstate-891376933289 \
  --key staging/terraform.tfstate \
  --query '[ServerSideEncryption, SSEKMSKeyId]'
# Expected: ["aws:kms", "arn:aws:kms:us-east-1:...:key/..."]
```

**Rollback Plan**:
1. Comment out `kms_key_id` in backend.tfvars
2. Run `terraform init -reconfigure`
3. State will be re-encrypted with S3 default encryption

**Risk**: MEDIUM - State migration requires careful execution, but backup ensures recovery

---

## S-95.3: Remove Legacy IAM Role Blanket Access

**Finding**: A-94.3 - Legacy IAM Role Retains Blanket Secrets Access
**CVSS**: 7.5 (High)
**Estimated Effort**: 1 hour

**Description**: The legacy `ecs_execution` IAM role still has blanket access to ALL secrets, creating a backdoor that bypasses the least-privilege architecture implemented in Sprint 94.

**Current State**:
```hcl
# ecs.tf - The legacy role policy still grants access to ALL secrets
resource "aws_iam_role_policy" "ecs_execution_secrets" {
  name = "${local.name_prefix}-ecs-execution-secrets"
  role = aws_iam_role.ecs_execution.id
  # Policy grants access to: vault_token, app_config, db_credentials,
  # redis_credentials, rabbitmq_credentials
}
```

**Acceptance Criteria**:
- [ ] Verify no task definitions reference the legacy `ecs_execution` role for execution_role_arn
- [ ] Remove `aws_iam_role_policy.ecs_execution_secrets` resource from ecs.tf
- [ ] Keep `aws_iam_role.ecs_execution` (may be used for Service Discovery policy)
- [ ] Run `terraform plan` to verify only the secrets policy is removed
- [ ] Apply to staging first, verify all services still function
- [ ] Apply to production

**Files to Modify**:
- `infrastructure/terraform/ecs.tf`

**Pre-flight Check**:
```bash
# Verify no task definitions use the legacy role
cd infrastructure/terraform
terraform state list | grep aws_ecs_task_definition | while read td; do
  terraform state show "$td" | grep -A1 "execution_role_arn"
done

# Expected output: All should reference ecs_execution_{service} roles, not ecs_execution
```

**Implementation**:
```hcl
# DELETE this entire resource block from ecs.tf (lines ~347-373):

# Legacy execution role - kept for backward compatibility during migration
# TODO: Remove after all task definitions are updated to use service-specific roles
# resource "aws_iam_role_policy" "ecs_execution_secrets" {
#   name = "${local.name_prefix}-ecs-execution-secrets"
#   role = aws_iam_role.ecs_execution.id
#   ... DELETE ENTIRE BLOCK ...
# }
```

**Rollback Plan**: Re-add the policy if any service fails to access its secrets

---

## S-95.4: Add KMS Key Deletion Protection

**Finding**: A-95 - Missing KMS Key Deletion Protection
**CVSS**: 4.3 (Low)
**Estimated Effort**: 15 minutes

**Description**: The Secrets Manager KMS key lacks lifecycle protection to prevent accidental `terraform destroy`.

**Acceptance Criteria**:
- [ ] Add `lifecycle { prevent_destroy = true }` to `aws_kms_key.secrets` in kms.tf
- [ ] Run `terraform plan` to verify no changes
- [ ] Apply

**Files to Modify**:
- `infrastructure/terraform/kms.tf`

**Implementation**:
```hcl
resource "aws_kms_key" "secrets" {
  description             = "Arrakis secrets encryption key"
  deletion_window_in_days = 30
  enable_key_rotation     = true

  # Sprint 95: Prevent accidental deletion
  lifecycle {
    prevent_destroy = true
  }

  # ... rest of policy ...
}
```

---

## Execution Order

The tasks have dependencies and should be executed in this order:

```
┌─────────────────────────────────────────────────────────────┐
│  S-95.2: Create Terraform State KMS Key (Manual)          │
│  └─→ Must exist before terraform init                       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  S-95.1: Add kms_key_id to Secrets Manager resources      │
│  S-95.3: Remove legacy IAM role policy                    │
│  S-95.4: Add KMS key deletion protection                  │
│  └─→ All can be in same terraform apply                     │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  S-95.2: Activate Backend KMS (terraform init -reconfigure)│
│  └─→ Must be done after apply to ensure kms.tf is deployed  │
└─────────────────────────────────────────────────────────────┘
```

---

## Verification Checklist

After completing all tasks, verify:

### KMS Encryption
- [ ] `aws secretsmanager describe-secret --secret-id arrakis-staging/database --query 'KmsKeyId'` returns customer KMS key ARN
- [ ] `aws s3api head-object --bucket arrakis-tfstate-891376933289 --key staging/terraform.tfstate --query 'SSEKMSKeyId'` returns KMS key ARN

### Service Access
- [ ] Gateway can connect to Discord (read app_config)
- [ ] Worker can connect to database (read db_credentials)
- [ ] Ingestor can connect to RabbitMQ (read rabbitmq_credentials)
- [ ] API can connect to Redis (read redis_credentials)
- [ ] GP Worker can connect to all dependencies

### IAM Verification
- [ ] `aws iam get-role-policy --role-name arrakis-staging-ecs-execution --policy-name arrakis-staging-ecs-execution-secrets` returns "NoSuchEntity" (policy deleted)
- [ ] All services still have access to their required secrets via service-specific roles

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Secrets become inaccessible after KMS change | Low | High | Test in staging first, verify service access |
| State migration fails | Low | Medium | Backup state before migration |
| Services lose access after legacy role removal | Low | High | Pre-flight check confirms no usage |
| KMS key deletion | Very Low | Critical | `prevent_destroy` lifecycle protection |

---

## Success Criteria

Sprint 95 is complete when:

1. **All Secrets Manager secrets** are encrypted with customer-managed KMS key
2. **Terraform state** is encrypted with customer-managed KMS key
3. **Legacy IAM role** secrets policy is removed
4. **KMS key** has deletion protection enabled
5. **All services** remain functional
6. **Security audit** passes with "APPROVED - LET'S FUCKING GO"

---

## Next Steps

After Sprint 95 approval:
```
/implement sprint-95
```

Sprint 95: Authentication & Audit Logging

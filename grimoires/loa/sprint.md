# Sprint Plan: Armitage Platform — Operational Execution

> **Cycle**: cycle-046
> **Codename**: Armitage Platform
> **PRD**: `grimoires/loa/prd.md` (Terraform Consolidation & DNS Authority)
> **SDD**: `grimoires/loa/sdd.md` (v1.1.0)
> **Phase**: Operational Execution (all code exists — PR #109 merged to main)
> **Team**: 1 engineer (solo) + domain owner (manual steps)
> **Total Sprints**: 5 (sprint-7 through sprint-11 in cycle-046; global IDs 391-395)
> **Note**: Sprints 1-6 (global 380-385) were code implementation. This plan covers operational execution.
> **Context**: loa-finn #114 (migration tracker), PR #117 (OIDC role)

---

## Executive Summary

All Terraform code, deploy scripts, wiring tests, and DNS modules were implemented in cycle-046 sprints 1-5 (global 380-384) and merged via PR #109. Cross-repo cleanup is complete: Finn stale TF removed (`c30f745`), Dixie old AWS resources deleted (loa-finn #114 comments). What remains is purely operational — executing the import runbook, verifying services, cleaning up legacy AWS resources, and applying the DNS module. No new `.tf` files need to be written.

**Key safety invariant**: No `terraform destroy` on legacy stacks until all stateful resources are imported and verified in the canonical root. Stateful resources have `lifecycle { prevent_destroy = true }` in the existing code. → **[G-1]**

---

## Sprint 1: CI Unblock — OIDC Role + Finn Deploy Verification

**Scope**: SMALL (3 tasks) | **Priority**: P0
**Sprint Goal**: Enable Finn CI to push images to ECR and trigger ECS redeployments via GitHub OIDC, eliminating the need for static credentials.

> From prd.md FR-2: "Create `scripts/deploy-ring.sh` — sequential orchestrator with health gates" — the OIDC role is the prerequisite for automated Finn deploys.

### Deliverables

- [ ] PR #117 merged and OIDC IAM role created via `terraform apply`
- [ ] Finn CI can push images to `arrakis-staging-loa-finn` ECR
- [ ] Finn CI can trigger ECS force-new-deployment on `arrakis-staging-finn`

### Task 1.1: Merge and Apply PR #117 (OIDC Role) → **[G-3]**

**File**: `infrastructure/terraform/ci-finn.tf`
**SDD Reference**: §5.1 (CI/CD Pipeline)

1. Merge PR #117 to main
2. `terraform init -backend-config=environments/staging/backend.tfvars`
3. `terraform plan -var-file=environments/staging/terraform.tfvars` — expect create for:
   - `aws_iam_role.finn_ci_deploy`
   - `aws_iam_role_policy.finn_ci_deploy`
   - `aws_iam_openid_connect_provider.github` (if not already present)
4. `terraform apply -var-file=environments/staging/terraform.tfvars`
5. Capture output: `terraform output finn_ci_deploy_role_arn`

**Acceptance Criteria**:
- [ ] `terraform plan` shows only creates (no destroys/replaces)
- [ ] `terraform apply` succeeds without errors
- [ ] `finn_ci_deploy_role_arn` output has value `arn:aws:iam::891376933289:role/arrakis-staging-finn-ci-deploy`

### Task 1.2: Configure Finn Repo Secret → **[G-3]**

1. Copy `finn_ci_deploy_role_arn` value from Task 1.1
2. Navigate to https://github.com/0xHoneyJar/loa-finn/settings/secrets/actions
3. Create secret `AWS_DEPLOY_ROLE_ARN` with the ARN value
4. Verify secret is accessible to the `deploy-staging.yml` workflow

**Acceptance Criteria**:
- [ ] `AWS_DEPLOY_ROLE_ARN` secret exists in loa-finn repo settings
- [ ] Secret is scoped to `staging` environment (if environments configured)

### Task 1.3: Verify Finn CI End-to-End → **[G-3]**

1. Trigger loa-finn "Build & Push to ECR" workflow manually (Actions → Run workflow)
2. Monitor: Docker build → ECR push → ECS force-new-deployment
3. Verify: `arrakis-staging-finn` ECS service picks up new image
4. Health check: `aws ecs describe-services --cluster arrakis-staging-cluster --services arrakis-staging-finn` shows `runningCount >= 1`

**Acceptance Criteria**:
- [ ] Finn CI workflow completes green
- [ ] ECR repo `arrakis-staging-loa-finn` has new image with workflow-generated tag
- [ ] ECS service `arrakis-staging-finn` running with latest task definition
- [ ] No OIDC trust errors in workflow logs

### Dependencies
- PR #117 must be merged before Task 1.1
- AWS access required for Task 1.1 (terraform apply) and Task 1.3 (verification)

### Risks & Mitigation
| Risk | Mitigation |
|------|------------|
| OIDC provider doesn't exist in account | Uncomment `resource "aws_iam_openid_connect_provider"` block in `ci-finn.tf` (SDD §5.1) |
| Trust policy rejects Finn workflow | Check `Condition.StringEquals["token.actions.githubusercontent.com:sub"]` matches `repo:0xHoneyJar/loa-finn:ref:refs/heads/main` |

### Success Metrics
- Finn CI workflow: green in ≤5 minutes
- ECS service stable within 3 minutes of deploy
- Zero manual credential management required

---

## Sprint 2: Terraform Import Runbook Execution

**Scope**: LARGE (7 tasks) | **Priority**: P0
**Sprint Goal**: Import all Finn stateful resources into Freeside's canonical Terraform state with zero data loss and zero-diff verification.

> From prd.md FR-1: "Safe Import Workflow for stateful resources" — 29 resources to import per SDD §4.1-§4.2. "Safety invariant: No terraform destroy on legacy stacks until all stateful and shared resources are imported and verified."

### Deliverables

- [ ] State backup in S3 with verified restore capability
- [ ] 29 resources imported into Freeside state
- [ ] `terraform plan` shows 0 changes for all imported resources
- [ ] Redis auth bootstrapped via `bootstrap-redis-auth.sh`
- [ ] Finn ECS tasks restarted and healthy with new Redis credentials

### Task 2.1: State Backup + Lock Verification + Restore Drill → **[G-1]**

**File**: `DEPLOYMENT.md` § Step 0 (SKP-002a)

**Invariant**: No `terraform apply` during Sprint 2. Sprint 2 is import-only. No `-target` flags. All applies happen in Sprint 3.

**Authoritative Import Inventory (29 resources, all root-level — no modules)**:

| # | Terraform Address | Source File | Batch |
|---|-------------------|-------------|-------|
| 1 | `aws_elasticache_replication_group.finn_dedicated` | `elasticache-finn.tf` | 2.3 |
| 2 | `aws_elasticache_parameter_group.finn_redis` | `elasticache-finn.tf` | 2.3 |
| 3 | `aws_dynamodb_table.finn_scoring_path_log` | `dynamodb-finn.tf` | 2.3 |
| 4 | `aws_dynamodb_table.finn_x402_settlements` | `dynamodb-finn.tf` | 2.3 |
| 5 | `aws_s3_bucket.finn_audit_anchors` | `s3-finn.tf` | 2.4 |
| 6 | `aws_s3_bucket_object_lock_configuration.finn_audit_anchors` | `s3-finn.tf` | 2.4 |
| 7 | `aws_s3_bucket_versioning.finn_audit_anchors` | `s3-finn.tf` | 2.4 |
| 8 | `aws_s3_bucket_server_side_encryption_configuration.finn_audit_anchors` | `s3-finn.tf` | 2.4 |
| 9 | `aws_s3_bucket_public_access_block.finn_audit_anchors` | `s3-finn.tf` | 2.4 |
| 10 | `aws_s3_bucket.finn_calibration` | `s3-finn.tf` | 2.4 |
| 11 | `aws_s3_bucket_versioning.finn_calibration` | `s3-finn.tf` | 2.4 |
| 12 | `aws_s3_bucket_server_side_encryption_configuration.finn_calibration` | `s3-finn.tf` | 2.4 |
| 13 | `aws_s3_bucket_public_access_block.finn_calibration` | `s3-finn.tf` | 2.4 |
| 14 | `aws_kms_key.finn_audit_signing` | `kms-finn.tf` | 2.4 |
| 15 | `aws_kms_alias.finn_audit_signing` | `kms-finn.tf` | 2.4 |
| 16-28 | `aws_ssm_parameter.finn["finn/*"]` (13 params) | `env-finn.tf` | 2.5 |
| 29 | `aws_cloudwatch_log_group.finn` | `ecs-finn.tf` | 2.5 |

```bash
cd infrastructure/terraform
terraform init -backend-config=environments/staging/backend.tfvars

# Verify state locking is active (DynamoDB lock table)
aws dynamodb describe-table --table-name arrakis-terraform-locks --query 'Table.TableStatus'
# Expected: "ACTIVE"

# Verify locking works (plan acquires lock)
terraform plan -var-file=environments/staging/terraform.tfvars -lock=true
# If lock fails → another session is running. STOP until resolved.

# Verify resource addresses: canonical root uses NO modules for Finn resources
# (Confirmed: only module "vpc" exists in vpc.tf; all Finn resources are root-level
# in elasticache-finn.tf, dynamodb-finn.tf, s3-finn.tf, kms-finn.tf, env-finn.tf)
terraform state list | grep finn || echo "No finn resources in state yet — expected pre-import"
terraform validate

# Address discovery gate: confirm HCL resource addresses match import commands
# If any import fails with "resource address does not exist in the configuration",
# STOP and run: grep -rn 'resource "aws_' infrastructure/terraform/*finn*.tf
# to find the exact address, then update the import command accordingly.
grep -c '^module ' infrastructure/terraform/*finn*.tf 2>/dev/null || echo "Confirmed: 0 modules in finn TF files"

# State backup
terraform state pull > backup-$(date +%Y%m%d-%H%M%S).tfstate
sha256sum backup-*.tfstate > backup-checksums.txt
aws s3 cp backup-*.tfstate s3://arrakis-tfstate-891376933289/backups/ --sse aws:kms
aws s3 cp backup-checksums.txt s3://arrakis-tfstate-891376933289/backups/ --sse aws:kms
```

Restore drill:
```bash
aws s3 cp s3://arrakis-tfstate-891376933289/backups/backup-*.tfstate /tmp/restore-test.tfstate
# Verify: file size > 0 and valid JSON
jq '.version' /tmp/restore-test.tfstate
```

**Acceptance Criteria**:
- [ ] DynamoDB lock table `arrakis-terraform-locks` is ACTIVE
- [ ] `terraform plan` acquires lock successfully (no concurrent sessions)
- [ ] `terraform validate` passes
- [ ] Backup uploaded to S3 with KMS encryption
- [ ] sha256 checksums recorded and uploaded
- [ ] Restore drill confirms file is valid Terraform state JSON

### Task 2.2: Confirm Resource Identifiers from Finn State → **[G-1]**

**File**: `DEPLOYMENT.md` § Task 1.0

Access loa-finn's Terraform state (backend: `s3://honeyjar-terraform-state`, key: `loa-finn/terraform.tfstate` or `infrastructure/terraform/`) and record physical IDs:

| # | Resource | Expected ID | Confirmed ID |
|---|----------|------------|-------------|
| 1 | ElastiCache replication group | `arrakis-staging-finn-redis` | __________ |
| 2 | ElastiCache parameter group | `arrakis-staging-finn-redis-params` | __________ |
| 3 | DynamoDB `scoring_path_log` | `arrakis-staging-finn-scoring-path-log` | __________ |
| 4 | DynamoDB `x402_settlements` | `arrakis-staging-finn-x402-settlements` | __________ |
| 5 | S3 `audit_anchors` | `arrakis-staging-finn-audit-anchors` | __________ |
| 6 | S3 `calibration` | `arrakis-staging-finn-calibration` | __________ |
| 7 | KMS key | `{key-id}` | __________ |
| 8 | KMS alias | `alias/arrakis-staging-finn-audit-signing` | __________ |

**Note**: If Finn's TF state is in a different backend key or has been removed from the remote backend (stale TF files were deleted in `c30f745`), identifiers must be confirmed via AWS Console or `aws` CLI directly.

**Acceptance Criteria**:
- [ ] All 8 stateful resource IDs confirmed (either from TF state or AWS CLI)
- [ ] KMS key ID recorded (UUID format, not alias)
- [ ] No resource has been accidentally deleted

### Task 2.3: Import Batch 1 — Data Stores (ElastiCache + DynamoDB) → **[G-1]** **[G-2]**

**File**: `DEPLOYMENT.md` § Steps 1-2
**SDD Reference**: §4.1 rows 1-4

```bash
# ElastiCache
terraform import aws_elasticache_replication_group.finn_dedicated {confirmed-id-1}
terraform import aws_elasticache_parameter_group.finn_redis {confirmed-id-2}
terraform plan -var-file=environments/staging/terraform.tfvars
# GATE: 0 changes for imported resources

# DynamoDB
terraform import aws_dynamodb_table.finn_scoring_path_log {confirmed-id-3}
terraform import aws_dynamodb_table.finn_x402_settlements {confirmed-id-4}
terraform plan -var-file=environments/staging/terraform.tfvars
# GATE: 0 changes for imported resources
```

**Rollback** (if import produces drift or force-replace):
```bash
# Remove the bad import from state (does NOT touch the real resource)
terraform state rm aws_elasticache_replication_group.finn_dedicated
# Fix HCL to match real resource config, then re-import
# NEVER run terraform apply to "fix" drift on stateful resources — fix the code instead
```

**Acceptance Criteria**:
- [ ] `terraform import` succeeds for all 4 resources
- [ ] `terraform plan` shows 0 changes for ElastiCache replication group + parameter group
- [ ] `terraform plan` shows 0 changes for both DynamoDB tables
- [ ] No `force replacement` or `must be replaced` in plan output

### Task 2.4: Import Batch 2 — S3 + Sub-Resources + KMS → **[G-1]** **[G-2]**

**File**: `DEPLOYMENT.md` § Steps 3-4
**SDD Reference**: §4.1 rows 5-8

**Critical**: The canonical `s3-finn.tf` defines 9 S3-related resources (not just 2 buckets). Modern Terraform manages versioning, Object Lock, encryption, and public access block as separate resources. All must be imported.

```bash
# S3 audit_anchors — bucket + 4 sub-resources
terraform import aws_s3_bucket.finn_audit_anchors {confirmed-id-5}
terraform import aws_s3_bucket_object_lock_configuration.finn_audit_anchors {confirmed-id-5}
terraform import aws_s3_bucket_versioning.finn_audit_anchors {confirmed-id-5}
terraform import aws_s3_bucket_server_side_encryption_configuration.finn_audit_anchors {confirmed-id-5}
terraform import aws_s3_bucket_public_access_block.finn_audit_anchors {confirmed-id-5}

# S3 calibration — bucket + 3 sub-resources (no Object Lock)
terraform import aws_s3_bucket.finn_calibration {confirmed-id-6}
terraform import aws_s3_bucket_versioning.finn_calibration {confirmed-id-6}
terraform import aws_s3_bucket_server_side_encryption_configuration.finn_calibration {confirmed-id-6}
terraform import aws_s3_bucket_public_access_block.finn_calibration {confirmed-id-6}

# Verify Object Lock still enabled after import
aws s3api get-object-lock-configuration --bucket {confirmed-id-5}
# Expected: ObjectLockEnabled=Enabled, Rule.DefaultRetention present

terraform plan -var-file=environments/staging/terraform.tfvars
# GATE: 0 changes for all 9 S3-related resources

# KMS
terraform import aws_kms_key.finn_audit_signing {confirmed-id-7-uuid}
terraform import aws_kms_alias.finn_audit_signing {confirmed-id-8}
terraform plan -var-file=environments/staging/terraform.tfvars
# GATE: 0 changes for KMS resources
```

**Rollback** (if import produces drift on S3/KMS):
```bash
# Remove the offending resource from state, fix HCL, re-import
terraform state rm aws_s3_bucket_object_lock_configuration.finn_audit_anchors
# CRITICAL: verify Object Lock is still enabled after any state manipulation:
aws s3api get-object-lock-configuration --bucket arrakis-staging-finn-audit-anchors
# Expected: ObjectLockEnabled=Enabled — if missing, STOP and escalate (data safety risk)
# NEVER use terraform apply or -refresh-only on Object Lock resources during rollback
```

**Acceptance Criteria**:
- [ ] All 9 S3 resources imported (2 buckets + 7 sub-resources)
- [ ] Object Lock configuration verified present after import (`aws s3api get-object-lock-configuration`)
- [ ] KMS key imported with correct UUID (not alias)
- [ ] `terraform plan` shows 0 changes for all 11 resources (9 S3 + 2 KMS)
- [ ] `prevent_destroy` lifecycle confirmed present in plan for S3 buckets and KMS key

### Task 2.5: Import Batch 3 — SSM Parameters + CloudWatch → **[G-1]** **[G-2]**

**File**: `DEPLOYMENT.md` § Steps 5-6
**SDD Reference**: §4.2 rows 9-22

Import all 13 SSM parameters + CloudWatch log group:

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
terraform import aws_cloudwatch_log_group.finn /ecs/arrakis-staging/finn

terraform plan -var-file=environments/staging/terraform.tfvars
# GATE: 0 changes for all 14 imported resources (SSM uses ignore_changes on value)
```

**Acceptance Criteria**:
- [ ] All 13 SSM parameters imported successfully
- [ ] CloudWatch log group imported (preserves log history)
- [ ] `terraform plan` shows 0 changes for all 14 resources
- [ ] SSM parameter values unchanged (verified via `aws ssm get-parameter`)

### Task 2.6: Zero-Diff Verification + Plan Guard → **[G-1]**

**File**: `DEPLOYMENT.md` § Post-Import Verification
**SDD Reference**: §4.5, §5.3

```bash
# Comprehensive plan — final verification
terraform plan -var-file=environments/staging/terraform.tfvars -out=plan.tfplan

# Run tf-plan-guard.sh to block unexpected destroys
terraform show -json plan.tfplan > plan.json
./scripts/tf-plan-guard.sh plan.json

# Expected output:
# - 0 changes for all 29 imported resources
# - "create" ONLY for new monitoring/autoscaling resources
# - NO destroys or replaces
# - tf-plan-guard.sh: PASS
```

**Acceptance Criteria**:
- [ ] `terraform plan` shows 0 changes for ALL imported resources (29 total: 4 data stores + 11 S3/KMS + 14 SSM/CW)
- [ ] Plan shows creates only for: monitoring-finn (6 alarms), monitoring-dixie (4 alarms), autoscaling-dixie
- [ ] `tf-plan-guard.sh` passes — no replace/destroy on critical resources
- [ ] Plan output saved as artifact for audit

### Task 2.7: Bootstrap Redis Auth + Finn Restart → **[G-2]**

**File**: `scripts/bootstrap-redis-auth.sh`
**SDD Reference**: §3.1 (external secret provisioning)

```bash
# Requires peer session (Change Approval Protocol)
./scripts/bootstrap-redis-auth.sh staging

# Restart Finn to pick up new credentials
aws ecs update-service --cluster arrakis-staging-cluster --service arrakis-staging-finn --force-new-deployment
aws ecs wait services-stable --cluster arrakis-staging-cluster --services arrakis-staging-finn
```

**Rollback** (if Finn can't connect to Redis after auth bootstrap):
```bash
# 1. Check if the old auth token is stored (bootstrap script should log previous value location)
aws secretsmanager get-secret-value --secret-id arrakis-staging-finn-redis-auth \
  --version-stage AWSPREVIOUS --query 'SecretString' --output text
# If previous version exists, restore it:
aws elasticache modify-replication-group --replication-group-id arrakis-staging-finn-redis \
  --auth-token <previous-token> --auth-token-update-strategy ROTATE
# 2. Force restart Finn to pick up restored token
aws ecs update-service --cluster arrakis-staging-cluster --service arrakis-staging-finn --force-new-deployment
aws ecs wait services-stable --cluster arrakis-staging-cluster --services arrakis-staging-finn
# 3. If no previous token existed (first-time auth), disable auth:
# aws elasticache modify-replication-group --replication-group-id arrakis-staging-finn-redis \
#   --no-auth-token --auth-token-update-strategy DELETE
```

**Acceptance Criteria**:
- [ ] Redis auth token set via `aws elasticache modify-replication-group`
- [ ] Secrets Manager secret updated with new auth token
- [ ] Finn ECS tasks restarted and service stable
- [ ] Finn health endpoint returns 200 after restart

### Dependencies
- Sprint 1 complete (OIDC role exists, Finn CI verified)
- AWS IAM permissions: `elasticache:*`, `dynamodb:*`, `s3:*`, `kms:*`, `ssm:*`, `logs:*`
- Access to loa-finn Terraform state backend (or AWS Console for ID confirmation)

### Risks & Mitigation
| Risk | Mitigation |
|------|------------|
| Import produces force-replace on stateful resource | `terraform state rm <resource>`, fix HCL, re-import (DEPLOYMENT.md rollback) |
| Finn state backend no longer accessible (TF files removed) | Confirm IDs via `aws` CLI: `aws elasticache describe-replication-groups`, `aws dynamodb describe-table`, etc. |
| Redis auth bootstrap fails | Verify SG allows ingress from Finn tasks on port 6379; check `transit_encryption_enabled` matches |
| Plan shows unexpected changes on existing ECS/ALB resources | Only SG rule additions permitted (NFR-3); investigate and fix HCL before applying |

### Success Metrics
- 29/29 resources imported with 0-diff verification
- `tf-plan-guard.sh` passes on first run
- Finn service stable within 5 minutes of Redis auth bootstrap

---

## Sprint 3: Apply New Resources + Service Verification

**Scope**: MEDIUM (5 tasks) | **Priority**: P0
**Sprint Goal**: Apply the remaining Terraform creates (monitoring + autoscaling), run the deploy pipeline end-to-end, and verify all 10 wiring test paths pass.

> From prd.md G-3: "Sequential deploy with health gates — deploy-ring.sh deploys Dixie → Finn → Freeside with health checks — 3/3 services healthy"
> From prd.md G-4: "Cross-service wiring validated — staging-wiring-test.sh passes all 10 connectivity paths — 10/10 pass"

### Deliverables

- [ ] Monitoring and autoscaling resources created for Finn and Dixie
- [ ] `deploy-ring.sh staging` completes with all health gates passing
- [ ] `staging-wiring-test.sh staging` passes 10/10 connectivity tests
- [ ] All 3 services healthy and stable for ≥30 minutes

### Task 3.1: Apply New Resources (Monitoring + Autoscaling) → **[G-2]** **[G-1]**

**Files**: `monitoring-finn.tf`, `monitoring-dixie.tf`, `autoscaling-dixie.tf`
**SDD Reference**: §3.7, §3.8

```bash
cd infrastructure/terraform
terraform apply -var-file=environments/staging/terraform.tfvars

# Expected creates:
# - 6 CloudWatch alarms for Finn (cpu, memory, 5xx, task-count, latency, redis)
# - 4 CloudWatch alarms for Dixie (cpu, memory, 5xx, task-count)
# - 2 CloudWatch metric filters for Dixie
# - AppAutoScaling target + CPU policy for Dixie
# - SNS topics for alarm notifications
```

**Acceptance Criteria**:
- [ ] `terraform apply` succeeds with only creates (no destroys/replaces)
- [ ] All 10 CloudWatch alarms in OK state
- [ ] Dixie autoscaling target registered with AppAutoScaling
- [ ] `terraform plan` shows 0 changes after apply (clean state)

### Task 3.2: Enable ECS Exec Prerequisites → **[G-4]**

**SDD Reference**: §6 (Wiring Test Design), PRD FR-3 (ECS Exec prerequisites)

**Known gap**: `enable_execute_command` is NOT set in `ecs-finn.tf`, `ecs-dixie.tf`, or `ecs.tf` (Freeside). Only `nats.tf` and `gateway.tf` have it. Service-level enablement is required for wiring tests W-4 through W-10.

```bash
# 1. Verify ECS Exec at cluster level
aws ecs describe-clusters --clusters arrakis-staging-cluster \
  --include SETTINGS | jq '.clusters[0].settings'

# 2. Check service-level enablement (EXPECTED: false for finn, dixie, freeside)
for svc in arrakis-staging-finn arrakis-staging-dixie arrakis-staging-freeside; do
  echo "=== $svc ==="
  aws ecs describe-services --cluster arrakis-staging-cluster --services $svc \
    --query 'services[0].enableExecuteCommand'
done

# 3. Enable ECS Exec on each service (requires force-new-deployment)
for svc in arrakis-staging-finn arrakis-staging-dixie arrakis-staging-freeside; do
  aws ecs update-service --cluster arrakis-staging-cluster --service $svc \
    --enable-execute-command --force-new-deployment
done

# 4. Wait for services to stabilize after restart
aws ecs wait services-stable --cluster arrakis-staging-cluster \
  --services arrakis-staging-finn arrakis-staging-dixie arrakis-staging-freeside

# 5. Verify task roles have ssmmessages permissions
for role in arrakis-staging-finn-task arrakis-staging-dixie-task arrakis-staging-freeside-task; do
  echo "=== $role ==="
  aws iam simulate-principal-policy --policy-source-arn arn:aws:iam::891376933289:role/$role \
    --action-names ssmmessages:CreateControlChannel ssmmessages:CreateDataChannel \
    ssmmessages:OpenControlChannel ssmmessages:OpenDataChannel \
    --query 'EvaluationResults[].{Action:EvalActionName,Decision:EvalDecision}'
done
# All actions must show "allowed". If denied → add ssmmessages policy to task role.

# 6. Smoke test: execute command in each service
for svc in arrakis-staging-finn arrakis-staging-dixie arrakis-staging-freeside; do
  TASK=$(aws ecs list-tasks --cluster arrakis-staging-cluster --service-name $svc --query 'taskArns[0]' --output text)
  aws ecs execute-command --cluster arrakis-staging-cluster --task $TASK \
    --container $(echo $svc | sed 's/arrakis-staging-//') \
    --command "/bin/sh -c 'echo ok'" --interactive
done
```

**Rollback**: If service instability after `--enable-execute-command`:
```bash
aws ecs update-service --cluster arrakis-staging-cluster --service $svc \
  --no-enable-execute-command --force-new-deployment
```

**Acceptance Criteria**:
- [ ] ECS Exec enabled at cluster level
- [ ] `enableExecuteCommand: true` confirmed for all 3 target services
- [ ] `ssmmessages:*` permissions verified via `simulate-principal-policy` (not hardcoded policy name)
- [ ] Services stable after restart (`runningCount == desiredCount`)
- [ ] Smoke test succeeds for all 3 services (returns "ok")

### Task 3.3: Deploy Ring Execution → **[G-3]**

**File**: `scripts/deploy-ring.sh`
**SDD Reference**: §5.2 (Deploy Pipeline)

```bash
cd infrastructure/terraform
./scripts/deploy-ring.sh staging
```

Pipeline phases:
1. Build all Docker images → Push to ECR
2. Terraform plan (verify no unexpected changes)
3. Deploy Dixie → health gate (HTTP 200, p99 < 2s, 0 5xx, 10 consecutive checks)
4. Deploy Finn → health gate
5. Deploy Freeside → health gate
6. Integration tests (smoke + wiring)
7. Report

**Acceptance Criteria**:
- [ ] All 3 services deploy without rollback
- [ ] Each health gate passes within 5-minute timeout
- [ ] p99 latency < 2000ms for all services
- [ ] Zero 5xx errors during health check window
- [ ] Pipeline report shows 3/3 services healthy

### Task 3.4: Wiring Test Suite → **[G-4]**

**File**: `scripts/staging-wiring-test.sh`
**SDD Reference**: §6.1-§6.3

```bash
./scripts/staging-wiring-test.sh staging
```

| Test | Path | Verification |
|------|------|-------------|
| W-1 | External → Freeside | HTTPS 200 from health endpoint |
| W-2 | External → Finn | HTTPS 200 from health endpoint |
| W-3 | External → Dixie | HTTPS 200 from health endpoint |
| W-4 | Freeside → Finn | ECS Exec: `curl finn.arrakis.local:3001/health` |
| W-5 | Freeside → Dixie | ECS Exec: `curl dixie.arrakis.local:3002/health` |
| W-6 | Finn → Dixie | ECS Exec: reputation query |
| W-7 | Finn → Freeside | ECS Exec: JWKS endpoint fetch |
| W-8 | Finn → Redis | ECS Exec: `redis-cli PING` → PONG |
| W-9 | Freeside → PgBouncer | ECS Exec: `psql` connection test |
| W-10 | Dixie → PgBouncer | ECS Exec: `psql` connection test |

**Acceptance Criteria**:
- [ ] 10/10 wiring tests pass
- [ ] All external endpoints (W-1, W-2, W-3) respond in < 500ms
- [ ] All internal endpoints (W-4 through W-7) respond in < 200ms
- [ ] Redis PONG received (W-8)
- [ ] Database connections successful (W-9, W-10)

### Task 3.5: Stability Soak → **[G-3]** **[G-4]**

Monitor all 3 services for ≥30 minutes post-deployment:

```bash
# Check CloudWatch alarms
aws cloudwatch describe-alarms --state-value ALARM --alarm-name-prefix "arrakis-staging"
# Expected: no alarms in ALARM state

# Check ECS service stability
for svc in arrakis-staging-finn arrakis-staging-dixie arrakis-staging-freeside; do
  aws ecs describe-services --cluster arrakis-staging-cluster --services $svc \
    --query 'services[0].{status:status,desired:desiredCount,running:runningCount,pending:pendingCount}'
done
```

**Acceptance Criteria**:
- [ ] Zero CloudWatch alarms in ALARM state for ≥30 minutes
- [ ] All services: `runningCount == desiredCount`, `pendingCount == 0`
- [ ] No task restarts or OOM kills in CloudWatch Logs
- [ ] Deploy-ring stable completion confirmed

### Dependencies
- Sprint 2 complete (all 29 resources imported, Redis auth bootstrapped)
- ECS Exec may require cluster re-creation if not already enabled (check existing config first)

### Risks & Mitigation
| Risk | Mitigation |
|------|------------|
| ECS Exec not enabled on existing cluster | Enable via `aws ecs update-cluster-settings`; may require task restart |
| Health gate timeout (service slow to stabilize) | Increase `HEALTH_TIMEOUT` to 600; investigate application startup time |
| Wiring tests fail on internal paths | Check Cloud Map service discovery registration; verify SG rules per NFR-3 |
| Dixie autoscaling triggers unexpectedly | Review CPU target threshold; set conservative initial target (70%) |

### Success Metrics
- Deploy pipeline: < 15 minutes end-to-end
- Health gates: all pass on first attempt
- Wiring tests: 10/10 on first run
- Stability soak: 0 alarms for 30+ minutes

---

## Sprint 4: Legacy AWS Resource Cleanup

**Scope**: MEDIUM (5 tasks) | **Priority**: P1
**Sprint Goal**: Remove all legacy `loa-finn-armitage` and remaining `dixie-armitage` AWS resources that are now superseded by the canonical Freeside infrastructure.

> From loa-finn #114 (final comment): "Old loa-finn-armitage resources need deletion from 891376933289 account" — ECS service, ALB listener rule, Route53, task defs, ECR, CloudWatch, IAM, ElastiCache.

### Deliverables

- [ ] All `loa-finn-armitage` AWS resources deleted
- [ ] Remaining `dixie-armitage` resources deleted (ElastiCache, SGs, SSM)
- [ ] `terraform state rm` completed for both legacy stacks
- [ ] No duplicate services running in `arrakis-staging-cluster`
- [ ] Final verification: only canonical services present

### Task 4.1: Delete loa-finn-armitage ECS + ALB Resources → **[G-1]**

Delete the old Finn deployment that ran alongside the canonical one.

**Step 0: Discover all resource identifiers before deleting anything**

```bash
# Discover ALB ARN by name
ALB_ARN=$(aws elbv2 describe-load-balancers \
  --query 'LoadBalancers[?contains(LoadBalancerName, `arrakis-staging`)].LoadBalancerArn' --output text)
echo "ALB_ARN=$ALB_ARN"

# Discover HTTPS listener ARN
LISTENER_ARN=$(aws elbv2 describe-listeners --load-balancer-arn "$ALB_ARN" \
  --query 'Listeners[?Port==`443`].ListenerArn' --output text)
echo "LISTENER_ARN=$LISTENER_ARN"

# Discover legacy listener rule by priority (expected: 210)
RULE_ARN=$(aws elbv2 describe-rules --listener-arn "$LISTENER_ARN" \
  --query 'Rules[?Priority==`210`].RuleArn' --output text)
echo "RULE_ARN=$RULE_ARN"

# Discover legacy target group ARN
TG_ARN=$(aws elbv2 describe-target-groups \
  --query 'TargetGroups[?contains(TargetGroupName, `finn-armitage`)].TargetGroupArn' --output text)
echo "TG_ARN=$TG_ARN"

# Discover Route53 hosted zone for arrakis.community
ZONE_ID=$(aws route53 list-hosted-zones-by-name --dns-name arrakis.community \
  --query 'HostedZones[0].Id' --output text | sed 's|/hostedzone/||')
echo "ZONE_ID=$ZONE_ID"

# Capture the exact Route53 record for deletion (REQUIRED — use exact payload for delete)
aws route53 list-resource-record-sets --hosted-zone-id "$ZONE_ID" \
  --query 'ResourceRecordSets[?Name==`finn-armitage.arrakis.community.`]' > /tmp/finn-armitage-r53-record.json
cat /tmp/finn-armitage-r53-record.json
# GATE: Verify this is the correct record before proceeding
```

**Step 1: Delete ECS service**

```bash
# Scale to 0 (if not already)
aws ecs update-service --cluster arrakis-staging-cluster --service loa-finn-armitage --desired-count 0

# Wait for tasks to drain
aws ecs wait services-stable --cluster arrakis-staging-cluster --services loa-finn-armitage

# Delete service
aws ecs delete-service --cluster arrakis-staging-cluster --service loa-finn-armitage --force
```

**Step 2: Delete ALB listener rule + target group**

```bash
# Delete listener rule (using discovered ARN)
aws elbv2 delete-rule --rule-arn "$RULE_ARN"

# Delete target group (must have no active targets — service already deleted)
aws elbv2 delete-target-group --target-group-arn "$TG_ARN"
```

**Step 3: Delete Route53 record (using captured payload)**

```bash
# Build deletion batch from captured record (exact match required)
RECORD_JSON=$(cat /tmp/finn-armitage-r53-record.json | jq '.[0]')
aws route53 change-resource-record-sets --hosted-zone-id "$ZONE_ID" --change-batch "{
  \"Changes\": [{\"Action\": \"DELETE\", \"ResourceRecordSet\": $RECORD_JSON}]
}"
```

**Step 4: Deregister task definitions**

```bash
for td in $(aws ecs list-task-definitions --family-prefix loa-finn-armitage --query 'taskDefinitionArns[]' --output text); do
  aws ecs deregister-task-definition --task-definition $td
done
```

**Step 5: Verify canonical services unaffected**

```bash
# Canonical Finn must still be healthy
aws ecs describe-services --cluster arrakis-staging-cluster --services arrakis-staging-finn \
  --query 'services[0].{status:status,running:runningCount,desired:desiredCount}'
# Expected: running == desired, status ACTIVE

# Canonical API endpoint still resolving
curl -sf https://api.arrakis.community/health || echo "FAIL: API health check"
```

**Rollback**: If wrong listener rule or target group deleted:
```bash
# Re-create from Terraform state (if resource was managed)
terraform apply -target=aws_lb_listener_rule.finn_armitage -var-file=environments/staging/terraform.tfvars
# Or manually re-create via CLI using captured config
```

**Acceptance Criteria**:
- [ ] All resource identifiers discovered and recorded before any deletion
- [ ] `loa-finn-armitage` service deleted from `arrakis-staging-cluster`
- [ ] ALB listener rule priority 210 removed
- [ ] Target group `loa-finn-armitage` deleted
- [ ] Route53 record `finn-armitage.arrakis.community` deleted (exact payload used)
- [ ] All `loa-finn-armitage` task definitions deregistered
- [ ] `arrakis-staging-finn` (canonical) still healthy after cleanup

### Task 4.2: Delete loa-finn-armitage ECR + Observability → **[G-1]**

```bash
# ECR: check and delete non-canonical repos
aws ecr describe-repositories --query 'repositories[?starts_with(repositoryName, `loa-finn`)]'
# Delete loa-finn and/or loa-finn-armitage (canonical is arrakis-staging-loa-finn)
aws ecr delete-repository --repository-name loa-finn --force 2>/dev/null
aws ecr delete-repository --repository-name loa-finn-armitage --force 2>/dev/null

# CloudWatch: delete legacy alarms and log groups
aws cloudwatch delete-alarms --alarm-names $(aws cloudwatch describe-alarms --alarm-name-prefix loa-finn-armitage --query 'MetricAlarms[].AlarmName' --output text)
aws logs delete-log-group --log-group-name /ecs/loa-finn-armitage 2>/dev/null

# IAM: delete legacy roles
for role in loa-finn-armitage-ecs-task loa-finn-armitage-ecs-task-execution; do
  # Delete inline policies first
  for policy in $(aws iam list-role-policies --role-name $role --query 'PolicyNames[]' --output text 2>/dev/null); do
    aws iam delete-role-policy --role-name $role --policy-name $policy
  done
  aws iam delete-role --role-name $role 2>/dev/null
done
```

**Acceptance Criteria**:
- [ ] Only `arrakis-staging-loa-finn` ECR repo remains for Finn
- [ ] No `loa-finn-armitage` CloudWatch alarms or log groups
- [ ] No `loa-finn-armitage` IAM roles

### Task 4.3: Delete loa-finn-armitage ElastiCache → **[G-1]**

```bash
# Confirm canonical Redis is arrakis-staging-finn-redis (imported in Sprint 2)
aws elasticache describe-replication-groups --replication-group-id arrakis-staging-finn-redis

# Delete the old loa-finn-armitage ElastiCache (if separate from canonical)
aws elasticache delete-replication-group --replication-group-id loa-finn-armitage --no-final-snapshot-identifier 2>/dev/null
```

**Acceptance Criteria**:
- [ ] Only `arrakis-staging-finn-redis` ElastiCache exists for Finn
- [ ] `loa-finn-armitage` ElastiCache deleted (if it existed as separate from canonical)
- [ ] Finn service still connects to Redis successfully after cleanup (W-8 re-test)

### Task 4.4: Delete Remaining dixie-armitage Resources → **[G-1]**

From loa-finn #114 (Dixie cleanup comment), these remain:

```bash
# 1. Delete dixie-armitage ElastiCache
aws elasticache delete-replication-group --replication-group-id dixie-armitage --no-final-snapshot-identifier

# 2. Wait for deletion (ElastiCache takes 5-10 min)
aws elasticache wait replication-group-deleted --replication-group-id dixie-armitage

# 3. Delete associated security groups (now unblocked)
aws ec2 delete-security-group --group-id $DIXIE_ARMITAGE_ECS_SG
aws ec2 delete-security-group --group-id $DIXIE_ARMITAGE_REDIS_SG

# 4. Delete/migrate SSM parameters
# Check if still referenced by Freeside's ecs-dixie.tf:
# /dixie/armitage/FINN_URL and /dixie/armitage/FINN_WS_URL
# If migrated to /arrakis-staging/dixie/* → delete old params
aws ssm delete-parameters --names /dixie/armitage/FINN_URL /dixie/armitage/FINN_WS_URL
```

**Pre-deletion capture** (required before any delete):
```bash
# Capture ElastiCache config for rollback reference
aws elasticache describe-replication-groups --replication-group-id dixie-armitage > /tmp/dixie-armitage-redis-config.json

# Capture security group rules
for sg in $DIXIE_ARMITAGE_ECS_SG $DIXIE_ARMITAGE_REDIS_SG; do
  aws ec2 describe-security-groups --group-ids "$sg" > "/tmp/sg-${sg}-backup.json"
done

# Capture SSM parameter values
aws ssm get-parameters --names /dixie/armitage/FINN_URL /dixie/armitage/FINN_WS_URL \
  --with-decryption > /tmp/dixie-armitage-ssm-backup.json
```

**Rollback** (if Dixie destabilizes after cleanup):
```bash
# SSM parameters can be re-created from backup:
# aws ssm put-parameter --name /dixie/armitage/FINN_URL --value <from-backup> --type String --overwrite
# Security groups can be re-created from captured JSON (new group-id, update references)
# ElastiCache re-creation takes 10-15 min — consider this a last resort
```

**Acceptance Criteria**:
- [ ] Pre-deletion configs captured to /tmp/ before any deletes
- [ ] `dixie-armitage` ElastiCache deleted
- [ ] `dixie-armitage-ecs` and `dixie-armitage-redis` security groups deleted
- [ ] Legacy SSM parameters deleted (after confirming Freeside no longer references them)
- [ ] Dixie service still healthy (re-run W-3, W-5, W-6, W-10)

### Task 4.5: Terraform State Cleanup + Final Verification → **[G-1]**

```bash
# 1. terraform state rm in Finn's state (if state backend still exists)
# Note: Finn's TF files were removed (c30f745) but state may still have entries
cd /path/to/loa-finn/infrastructure/terraform
terraform state rm aws_elasticache_replication_group.finn_dedicated 2>/dev/null
terraform state rm aws_dynamodb_table.finn_scoring_path_log 2>/dev/null
# ... (for all resources now owned by Freeside)

# 2. Final verification in Freeside
cd /path/to/loa-freeside/infrastructure/terraform
terraform plan -var-file=environments/staging/terraform.tfvars
# GATE: 0 changes (clean state, nothing to create/modify/destroy)

# 3. Service inventory
aws ecs list-services --cluster arrakis-staging-cluster
# Expected: arrakis-staging-freeside, arrakis-staging-finn, arrakis-staging-dixie ONLY

# 4. Re-run wiring tests
./scripts/staging-wiring-test.sh staging
# GATE: 10/10 pass
```

**Acceptance Criteria**:
- [ ] Finn's Terraform state has no entries for resources owned by Freeside
- [ ] Freeside's `terraform plan` shows 0 changes (fully clean)
- [ ] ECS cluster has exactly 3 services (no duplicates)
- [ ] Wiring tests: 10/10 pass after all cleanup
- [ ] No orphaned resources in AWS matching `*-armitage` naming

### Dependencies
- Sprint 3 complete (all canonical services verified healthy)
- AWS access with IAM/ECS/ECR/ElastiCache/Route53 delete permissions
- Access to loa-finn Terraform state backend (for state rm)

### Risks & Mitigation
| Risk | Mitigation |
|------|------------|
| Deleting wrong ElastiCache (canonical vs. legacy) | Confirm IDs before deletion: canonical is `arrakis-staging-finn-redis` (imported in Sprint 2) |
| SSM parameters still referenced by running tasks | Check `ecs-dixie.tf` task definition for parameter references before deleting |
| Security group has remaining dependencies | Check `aws ec2 describe-network-interfaces --filters Name=group-id,Values=$SG_ID` before deleting |
| Finn TF state backend inaccessible | Skip `state rm` — resources are already imported into Freeside's state |

### Success Metrics
- Zero duplicate services in ECS cluster
- `terraform plan` clean (0 changes) in canonical root
- Wiring tests: 10/10 post-cleanup
- No `*-armitage` named resources remaining (excluding canonical `arrakis-staging-*`)

---

## Sprint 5: DNS Module Apply + Migration Prep

**Scope**: MEDIUM (4 tasks) | **Priority**: P1
**Sprint Goal**: Apply the DNS Terraform module to create Route 53 zone for `0xhoneyjar.xyz` and validate readiness for NS cutover.

> From prd.md FR-4: "Create infrastructure/terraform/dns/ as a separate root module" — zone + email records + agent subdomains + backend alias.
> From prd.md G-5: "DNS authority for 0xhoneyjar.xyz under IaC — Route 53 zone with functional equivalence to Gandi"

**Note**: The actual NS cutover at Gandi is a manual step (PRD § Out of Scope). This sprint creates the Route 53 zone and validates it. DNS hardening (DNSSEC, drift check) is also out of scope for this sprint — see PRD FR-6 for future hardening work.

### Deliverables

- [ ] Route 53 zone for `0xhoneyjar.xyz` created via Terraform
- [ ] All DNS records match Gandi records (functional equivalence)
- [ ] DMARC fix applied (corrected `admin@yourdomain.com` placeholder)
- [ ] Pre-migration validation passes

### Task 5.1: DNS Module Init + Plan → **[G-5]**

**Files**: `infrastructure/terraform/dns/*.tf`
**SDD Reference**: §7 (DNS Module Design)

**DKIM handling**: DKIM is conditional. If the Google Workspace DKIM key has been retrieved (Manual Step — Appendix A), set `enable_dkim = true` and provide the key value. If unavailable, set `enable_dkim = false` — the DKIM resource will be skipped, and DNS cutover will be blocked until DKIM is set.

```bash
cd infrastructure/terraform/dns
terraform init -backend-config=environments/staging/backend.tfvars

# Check if DKIM key is available
# If yes: set enable_dkim=true and dkim_key="v=DKIM1; k=rsa; p=<base64-key>"
# If no: set enable_dkim=false (DKIM resource skipped, cutover blocked)
terraform plan -var-file=environments/staging/terraform.tfvars \
  -var='enable_dkim=false'
# OR with DKIM:
# terraform plan -var-file=environments/staging/terraform.tfvars \
#   -var='enable_dkim=true' -var='dkim_key=v=DKIM1; k=rsa; p=<key>'
```

Expected creates:
- Route 53 hosted zone `0xhoneyjar.xyz`
- A records (76.76.21.21 — Vercel anycast)
- MX records (Google Workspace: `ASPMX.L.GOOGLE.COM`, etc.)
- TXT records (SPF: `v=spf1 include:_spf.google.com ~all`)
- DKIM TXT record (**only if** `enable_dkim = true`)
- DMARC TXT record (corrected: `v=DMARC1; p=quarantine; rua=mailto:dmarc@0xhoneyjar.xyz`)
- Wildcard CNAME `*.0xhoneyjar.xyz` → `cname.vercel-dns.com`
- `*.agents.0xhoneyjar.xyz` wildcard CNAME
- `_acme-challenge.agents.0xhoneyjar.xyz` NS delegation
- CAA records

**Pre-requisite check**: If DNS module does not yet have `enable_dkim` variable and conditional resource, add before apply:
```hcl
variable "enable_dkim" { type = bool; default = false }
variable "dkim_key" { type = string; default = "" }

resource "aws_route53_record" "dkim" {
  count   = var.enable_dkim ? 1 : 0
  zone_id = aws_route53_zone.main.zone_id
  name    = "google._domainkey.0xhoneyjar.xyz"
  type    = "TXT"
  ttl     = 3600
  records = [var.dkim_key]
}
```

**Acceptance Criteria**:
- [ ] `terraform init` succeeds with DNS state backend (`dns/staging.tfstate`)
- [ ] `terraform plan` shows only creates (new zone + records)
- [ ] DMARC record uses corrected email (`dmarc@0xhoneyjar.xyz`), not placeholder
- [ ] DKIM resource is conditional — plan shows 0 DKIM resources when `enable_dkim=false`
- [ ] No reference to compute state (blast-radius isolation maintained)

### Task 5.2: DNS Module Apply → **[G-5]** **[G-6]**

```bash
terraform apply -var-file=environments/staging/terraform.tfvars

# Record nameservers for cutover
terraform output nameservers
# Output: ns-XXXX.awsdns-XX.{org,co.uk,com,net}
```

**Acceptance Criteria**:
- [ ] Route 53 hosted zone created
- [ ] All DNS records present (verify via `aws route53 list-resource-record-sets`)
- [ ] Zone ID and nameservers captured in Terraform outputs
- [ ] `terraform plan` shows 0 changes after apply (clean state)

### Task 5.3: Pre-Migration Validation → **[G-5]** **[G-7]**

**File**: `scripts/dns-pre-migration.sh`
**SDD Reference**: §10 Phase 2

```bash
./scripts/dns-pre-migration.sh 0xhoneyjar.xyz
```

The script compares Route 53 records against current Gandi records:
- Expected: MATCH for A, MX, CNAME, CAA records
- Expected: EXPECTED_DIFF for SOA, NS (different providers), DMARC (corrected value)
- DKIM: If `enable_dkim=true` → MATCH required. If `enable_dkim=false` → DEFERRED (not a MISMATCH)
- Required: Zero MISMATCH results

**DKIM gate for cutover**: If DKIM was deferred (`enable_dkim=false`), the pre-migration script passes BUT the NS cutover in Appendix A is **blocked** until DKIM is set. Cutover without DKIM risks email delivery failures (G-7 violation).

**Acceptance Criteria**:
- [ ] Script outputs `PRE-MIGRATION CHECK PASSED`
- [ ] All record types show MATCH, EXPECTED_DIFF, or DEFERRED
- [ ] Zero MISMATCH results
- [ ] MX records match Google Workspace configuration exactly
- [ ] SPF record includes `_spf.google.com`
- [ ] DMARC uses corrected value (not Gandi's placeholder)
- [ ] If DKIM deferred: cutover explicitly blocked in DEPLOYMENT.md until DKIM applied

### Task 5.4: Document Cutover Readiness → **[G-5]**

Update `DEPLOYMENT.md` § DNS Cutover Playbook with:
1. Confirmed Route 53 nameservers (from `terraform output`)
2. Pre-migration check results
3. Cutover checklist with owner assignments
4. Rollback procedure verified

**Acceptance Criteria**:
- [ ] Nameservers populated in DEPLOYMENT.md (replacing `ns-XXXX` placeholders)
- [ ] Pre-migration check results documented
- [ ] Cutover ready for manual execution when team decides to proceed

### Dependencies
- Sprint 3 complete (compute infrastructure verified — DNS `api.0xhoneyjar.xyz` needs ALB reference)
- DKIM public key from Google Admin Console (manual retrieval by domain owner)
- If DKIM key unavailable, apply with placeholder and update later (record-level, not zone-level risk)

### Risks & Mitigation
| Risk | Mitigation |
|------|------------|
| DKIM key not available from Google Admin | Apply without DKIM record initially; add later with targeted `terraform apply` (no zone impact) |
| `data.aws_lbs` fails (ALB not found for `api.` record) | Feature-flagged: `enable_production_api = false` in staging; ALB lookup only runs when true |
| Agent wildcard conflicts with existing wildcard | RFC 4592: `*.agents.0xhoneyjar.xyz` is more specific — no conflict per DNS standards |

### Success Metrics
- DNS module: clean apply with 0 post-apply drift
- Pre-migration validation: PASSED
- All records functionally equivalent to Gandi
- Zone ready for NS cutover

---

## Risk Register

| ID | Risk | Sprint | Impact | Likelihood | Mitigation |
|----|------|--------|--------|------------|------------|
| R-1 | Import produces force-replace on stateful resource | 2 | CRITICAL | Low | `terraform state rm` + fix HCL + re-import |
| R-2 | Finn state backend inaccessible (TF files removed) | 2 | Medium | Medium | Use `aws` CLI to confirm resource IDs directly |
| R-3 | Redis auth bootstrap breaks Finn connectivity | 2 | High | Low | Verify SG rules + TLS config before bootstrap |
| R-4 | ECS Exec not enabled | 3 | Medium | Medium | `aws ecs update-cluster-settings` |
| R-5 | Health gate timeout during deploy-ring | 3 | Medium | Low | Increase timeout; check application startup |
| R-6 | Deleting wrong ElastiCache instance | 4 | CRITICAL | Low | Confirm ID matches import from Sprint 2 |
| R-7 | DKIM key unavailable | 5 | Low | Medium | Apply without; add later as targeted update |
| R-8 | DNS pre-migration shows MISMATCH | 5 | Medium | Medium | Fix Route 53 records before cutover |

---

## Appendix A: Manual Steps (Cannot Be Automated)

| Step | Sprint | System | Owner |
|------|--------|--------|-------|
| Set `AWS_DEPLOY_ROLE_ARN` secret in Finn repo | 1 | GitHub | Admin |
| Retrieve DKIM key from Google Admin Console | 5 | Google Workspace | Domain owner |
| Lower TTLs to 300s at Gandi | Post-5 | Gandi DNS | Domain owner |
| Update nameservers at Gandi | Post-5 | Gandi registrar | Domain owner |
| Fix DMARC placeholder at Gandi (immediate) | Pre-5 | Gandi DNS | Domain owner |
| Merge PR #114 (upload-artifact v4→v7) via GitHub web UI | Pre-1 | GitHub | Admin |

---

## Appendix B: Out of Scope

- **Actual NS cutover at Gandi** — manual step documented in `DEPLOYMENT.md`, executed when team decides
- **DNSSEC enablement** — PRD FR-6, future sprint after NS cutover confirmed stable ≥48h
- **DNS drift check workflow** — PRD FR-6, can be added as GitHub Action after DNS module applied
- **Production ring deployment** — future cycle
- **DMARC ramp to `p=reject`** — 4 weeks post-cutover per PRD FR-6

---

## Appendix C: Goal Traceability

| Goal | Tasks | Status |
|------|-------|--------|
| **G-1** Single terraform root | 2.1-2.6, 3.1, 4.1-4.5 | Import + cleanup complete this goal |
| **G-2** All missing infra in freeside | 2.3-2.5, 2.7, 3.1 | Import data stores + apply monitoring |
| **G-3** Sequential deploy with health gates | 1.1-1.3, 3.3, 3.5 | OIDC unblock + deploy-ring execution |
| **G-4** Cross-service wiring validated | 3.2, 3.4 | ECS Exec + wiring tests |
| **G-5** DNS authority for 0xhoneyjar.xyz | 5.1-5.4 | DNS module apply + validation |
| **G-6** Agent economy subdomains | 5.2 | `*.agents.0xhoneyjar.xyz` wildcard |
| **G-7** Zero email regression | 5.3 | Pre-migration validates MX/SPF/DKIM/DMARC |

All 7 PRD goals have contributing tasks. E2E validation is distributed across Sprint 3 (compute) and Sprint 5 (DNS).

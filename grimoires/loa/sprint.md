# Sprint Plan: Armitage Platform — Terraform Consolidation & DNS Authority

> **Cycle**: cycle-046
> **PRD**: `grimoires/loa/prd.md` (GPT-APPROVED, 4 iter; Flatline: 1 HIGH + 2 BLOCKER + 7 DISPUTED)
> **SDD**: `grimoires/loa/sdd.md` (GPT-APPROVED, 4 iter; Flatline: 4 BLOCKER + 10 DISPUTED)
> **Delivery**: 5 sprints (global IDs: 380-384)
> **Team**: 1 platform engineer (solo)
> **Sprint Duration**: ~1 day each (infrastructure sprints, not application code)
> **Critical Path** (IMP-003): Sprint 1 (import) → Sprint 2 (pipeline) → Sprint 3 (DNS) → Sprint 4 (validation) → Sprint 5 (hardening). Sprint 1 is the longest (import verification is serial). If Sprint 1 exceeds 1 day, subsequent sprints shift — build 0.5-day buffer after Sprint 1 and Sprint 4 (highest-risk sprints).

---

## Sprint Overview

| Sprint | Global ID | Title | Focus | Key Deliverable |
|--------|-----------|-------|-------|-----------------|
| 1 | 380 | Stateful Resource Consolidation | FR-1 Phase 1 | 8 new .tf files + import workflow |
| 2 | 381 | Deploy Pipeline & Observability | FR-2, FR-3, NFR-4 | deploy-ring.sh, wiring tests, alarms |
| 3 | 382 | DNS Module | FR-4 | 13-file DNS root, zone + records |
| 4 | 383 | Migration Validation & Cutover Prep | FR-5, SKP-001 | Validation scripts, cutover playbook |
| 5 | 384 | Hardening & Drift Detection | FR-6, IMP-004 | DNSSEC, drift check, DMARC ramp |

---

## Pre-Flight Requirements

Before sprint execution begins, verify these prerequisites (IMP-005):

- [ ] **IAM permissions**: Confirm the executing role has `terraform:*`, `elasticache:*`, `dynamodb:*`, `s3:*`, `kms:*`, `route53:*`, `ecs:*`, `ssm:*`, `cloudwatch:*`, `logs:*`, `secretsmanager:*`, `ec2:CreateVpcEndpoint` — run `aws sts get-caller-identity` and validate role ARN
- [ ] **State backend access**: `terraform init` succeeds for both compute and DNS roots
- [ ] **Registrar access**: Gandi login confirmed (covered in Task 4.0 but verify credentials exist early)
- [ ] **Secret handling protocol** (IMP-008): `.gitignore` includes `*.tfstate`, `backup-*.tfstate`, `*.tfplan`; no credential values in commit messages or PR descriptions; backup files stored in encrypted S3 bucket (not local)

## Change Approval Protocol

High-risk operations require peer review before execution (SKP-001a, SKP-002b):

| Operation | Approval Required | Approver |
|-----------|-------------------|----------|
| `terraform import` (any resource) | PR review + explicit approval | Team lead or senior engineer |
| `terraform apply` on production | PR review + explicit approval | Team lead or senior engineer |
| DNS NS cutover at Gandi | Written approval (Slack/email) | Domain owner + team lead |
| DNSSEC DS record upload | Written approval | Domain owner + team lead |
| `bootstrap-redis-auth.sh` execution | Pair session or screen share | Any second engineer |

**Bus factor mitigation**: Document all manual steps in DEPLOYMENT.md with enough detail that any engineer can execute them. Critical path tasks (1.3, 4.4, 5.3) require a buddy observer during execution.

---

## Sprint 1: Stateful Resource Consolidation (Global: 380)

**Goal**: Add all missing Finn/Dixie infrastructure to the freeside compute root and safely import stateful resources from loa-finn state.

**PRD Trace**: FR-1 (Issue #105 Phase 1)
**SDD Trace**: §3.1-§3.5, §4.1-§4.4

**Exit Gate** (IMP-002): `terraform plan` shows 0 changes on compute root. All imported resources verified. Checkpoint commit pushed. Peer review approved.

### Tasks

#### 1.0 Inventory Existing Finn Resources

**Description**: Export canonical resource identifiers from loa-finn Terraform state and AWS to ensure HCL definitions match exactly for zero-change imports.

**Acceptance Criteria**:
- [ ] `replication_group_id` for ElastiCache: confirmed from `terraform state show` in loa-finn
- [ ] `parameter_group_name` for ElastiCache: confirmed (`arrakis-staging-finn-redis-params` or actual)
- [ ] DynamoDB table names: confirmed for both `finn-scoring-path-log` and `finn-x402-settlements`
- [ ] S3 bucket names: confirmed for `finn-audit-anchors` and `finn-calibration`
- [ ] KMS key ID and alias: confirmed from loa-finn state
- [ ] CloudWatch log group name: confirmed (`/ecs/arrakis-staging/finn` or actual)
- [ ] SSM parameter paths: all 13 confirmed from AWS SSM console or `aws ssm describe-parameters`
- [ ] All identifiers documented in `DEPLOYMENT.md` import inventory section
- [ ] HCL in task 1.1 uses these exact identifiers (prevents drift on import)

**Dependencies**: Access to loa-finn Terraform state
**Effort**: Small

#### 1.1 Create Finn Stateful Resource Files

**Description**: Create 5 new .tf files for Finn's dedicated infrastructure: `elasticache-finn.tf`, `dynamodb-finn.tf`, `s3-finn.tf`, `kms-finn.tf`, `env-finn.tf`. All resource names/IDs must match identifiers from task 1.0.

**Acceptance Criteria**:
- [ ] `elasticache-finn.tf` defines replication group with exact `replication_group_id` from 1.0, `noeviction`, AOF, TLS, `prevent_destroy` — auth token managed externally per SKP-003 (no `random_password`)
- [ ] `dynamodb-finn.tf` defines tables with exact names from 1.0, GSI, PITR, KMS encryption, `prevent_destroy`
- [ ] `s3-finn.tf` defines buckets with exact names from 1.0, `finn_audit_anchors` with `object_lock_enabled = true`, both with versioning and `prevent_destroy`
- [ ] `kms-finn.tf` defines audit signing key with least-privilege policy per SKP-002 (no root `kms:*`)
- [ ] `env-finn.tf` defines 13 SSM parameters with exact paths from 1.0. Uses `ignore_changes = [value]` with documented rationale: values are managed by CI/application deploy pipeline, Terraform owns structure/paths only. Non-sensitive values tracked in `environments/staging/terraform.tfvars` as source of truth for audit (SKP-003b)
- [ ] `terraform plan` shows "will be created" for all new resources (pre-import expected state)

**Dependencies**: 1.0 (identifiers must be confirmed first)
**Effort**: Medium

#### 1.2 Create Bootstrap Redis Auth Script

**Description**: Create `scripts/bootstrap-redis-auth.sh` for external Redis auth token provisioning per SKP-003.

**Acceptance Criteria**:
- [ ] Script accepts `--replication-group-id`, `--secret-name`, `--region` as required inputs
- [ ] Generates cryptographically strong token: 64-char from `/dev/urandom` using `[A-Za-z0-9!@#%^&*]` character set (SKP-003a)
- [ ] **Atomic ordering** (SKP-001b): (1) generate token → (2) rotate ElastiCache auth token via `modify-replication-group --auth-token-update-strategy ROTATE` → (3) verify rotation succeeded via `describe-replication-groups` → (4) only then update Secrets Manager. If step 2 or 3 fails, DO NOT update Secrets Manager (old credential remains valid)
- [ ] Stores minimal secret payload: `{"auth_token": "..."}` only — host/port derived from Terraform outputs, not duplicated in secret (SKP-003a)
- [ ] Creates Secrets Manager secret if missing (`create-secret` with `kms-key-id`), otherwise updates via `put-secret-value`
- [ ] Reads current replication group auth-token status; no-ops if already matching stored token
- [ ] Secret resource policy restricts access to ECS task roles + terraform role only (SKP-003a)
- [ ] Script is idempotent (safe to re-run)
- [ ] Passes shellcheck
- [ ] Rotation cadence documented: recommend quarterly rotation via scheduled pipeline (SKP-003a)

**Dependencies**: Replication group must exist in AWS (pre-existing, confirmed in 1.0) and be imported (1.3). Execution requires peer session per Change Approval Protocol.
**Effort**: Small

#### 1.3 Import Stateful Resources

**Description**: Execute the safe import workflow per SDD §4.1-§4.4 for all 22 resources.

**Acceptance Criteria**:
- [ ] **Secure backup** (SKP-002a): Pre-import state snapshot uploaded to encrypted S3 bucket (`aws s3 cp backup-*.tfstate s3://<state-bucket>/backups/ --sse aws:kms`), sha256 checksum recorded alongside
- [ ] **Restore drill**: Before first import batch, verify restore works: download backup from S3, run `terraform state push` to a scratch workspace, confirm `terraform plan` matches expected state
- [ ] All 8 stateful resources imported (ElastiCache, 2x DynamoDB, 2x S3, KMS key + alias, parameter group)
- [ ] All 13 SSM parameters imported
- [ ] CloudWatch log group imported (if legacy exists)
- [ ] Post-import: `terraform plan` shows 0 changes for all imported resources. If non-zero diff: adjust HCL to match existing resource attributes before proceeding to next batch (SDD §4.4 rollback: `terraform state rm` to un-import, fix definition, retry)
- [ ] Post-import validation: wiring test subset passes (W-8 for Redis)
- [ ] Checkpoint commit after each verified batch
- [ ] All local `*.tfstate` backup files deleted after S3 upload confirmed (no state files in git)

**Dependencies**: 1.0 (identifiers), 1.1 (HCL files)
**Effort**: Large (most time-consuming task — per-resource verification)

#### 1.4 Add Compute Root Variables

**Description**: Add new variables to `infrastructure/terraform/variables.tf` and tfvars files.

**Acceptance Criteria**:
- [ ] `finn_redis_node_type` variable added with staging default `cache.t3.micro`
- [ ] `dixie_max_count`, `dixie_desired_count` variables added
- [ ] `autoscaling_cpu_target`, `autoscaling_scale_in_cooldown`, `autoscaling_scale_out_cooldown` variables added
- [ ] `environments/staging/terraform.tfvars` updated with all new values
- [ ] `terraform plan` executes without variable errors

**Dependencies**: None
**Effort**: Small

---

## Sprint 2: Deploy Pipeline & Observability (Global: 381)

**Goal**: Create the canonical deploy pipeline with health gates, wiring tests, monitoring alarms, and CI safety gates.

**PRD Trace**: FR-2, FR-3, NFR-3, NFR-4 (Issue #105 Phase 2-3)
**SDD Trace**: §3.6-§3.8, §5.1-§5.3, §6.1-§6.3

**Exit Gate** (IMP-002): `deploy-ring.sh` executes successfully on staging. All 10 wiring tests pass. `tf-plan-guard.sh` passes. DEPLOYMENT.md reviewed and approved.

### Tasks

#### 2.1 Create Monitoring & Autoscaling Files

**Description**: Create `monitoring-finn.tf`, `monitoring-dixie.tf`, `autoscaling-dixie.tf`.

**Acceptance Criteria**:
- [ ] `monitoring-finn.tf`: 6 CloudWatch alarms (CPU, memory, 5xx, task count, latency p99, Redis connection) + 2 metric filters
- [ ] `monitoring-dixie.tf`: 4 CloudWatch alarms (CPU, memory, 5xx, task count) + 2 metric filters
- [ ] `autoscaling-dixie.tf`: AppAutoScaling target + CPU-based scaling policy
- [ ] All alarms route to existing SNS topic
- [ ] **Alarm response ownership** (IMP-010): Each alarm has documented owner and response procedure in DEPLOYMENT.md (who gets paged, what to check, escalation path)
- [ ] `terraform plan` shows creates only

**Dependencies**: Sprint 1 complete (resources imported)
**Effort**: Medium

#### 2.2 Define Health Gate Metric Contract

**Description**: Define and validate the exact CloudWatch metrics consumed by deploy-ring.sh health gates.

**Acceptance Criteria**:
- [ ] Metric source documented: ALB `TargetResponseTime` (p99 statistic) for per-service latency, or log-derived metric with exact namespace/name/dimensions
- [ ] `aws cloudwatch get-metric-statistics --namespace AWS/ApplicationELB --metric-name TargetResponseTime --statistics p99 --dimensions Name=TargetGroup,Value=<tg-arn>` returns non-empty datapoints for each service in staging
- [ ] 5xx metric source: ALB `HTTPCode_Target_5XX_Count` or log-derived `Finn5xxErrors`/`Dixie5xxErrors` namespace confirmed
- [ ] Health gate script will use curl-based probing (not CloudWatch query) for real-time gating, with CloudWatch as verification fallback
- [ ] Documented in DEPLOYMENT.md: exact metric names, namespaces, dimensions per service

**Dependencies**: 2.1 (alarms define metric filters)
**Effort**: Small

#### 2.3 Create Deploy Pipeline Script

**Description**: Create `scripts/deploy-ring.sh` — sequential orchestrator with sliding-window p99 health gates per SKP-004.

**Acceptance Criteria**:
- [ ] 6-phase deployment: build → TF apply → Dixie → Finn → Freeside → wiring tests
- [ ] Health gate function tracks sliding-window p99 latency from curl probes (not just per-request)
- [ ] Health gate counts 5xx errors over gate duration
- [ ] **Quantified thresholds** (IMP-007): p99 latency < 2000ms, 5xx count < 3 over gate window, 10 consecutive healthy checks required. Thresholds configurable via environment variables (`HEALTH_P99_THRESHOLD_MS`, `HEALTH_5XX_LIMIT`, `HEALTH_CONSECUTIVE_CHECKS`)
- [ ] 5-minute timeout with actionable error messages
- [ ] **Automated rollback** (SKP-004): On health gate failure, script automatically redeploys the previous known-good task definition for the failed service (`aws ecs update-service --task-definition <previous-td-arn> --force-new-deployment`). Captures previous task definition ARN before each phase starts. Logs rollback action.
- [ ] On rollback trigger, script exits with non-zero code and summary of which phase failed and which services were rolled back
- [ ] Script is executable and passes shellcheck

**Dependencies**: 2.2 (metric contract defined)
**Effort**: Medium

#### 2.4 Create Wiring Test Script

**Description**: Create `scripts/staging-wiring-test.sh` — validates all 10 service-to-service connectivity paths.

**Acceptance Criteria**:
- [ ] W-1 through W-3: External health checks (Freeside, Finn, Dixie)
- [ ] W-4 through W-7: Internal Cloud Map connectivity via ECS Exec
- [ ] W-8: Finn → Redis (dedicated ElastiCache) via ECS Exec
- [ ] W-9, W-10: DB connectivity via PgBouncer
- [ ] Clear pass/fail reporting with service name and HTTP code
- [ ] Non-zero exit on any failure

**Dependencies**: None (can be written in parallel with 2.1)
**Effort**: Medium

#### 2.5 Enable ECS Exec & VPC Endpoints

**Description**: Add ECS Exec configuration to cluster, task role IAM permissions, and ssmmessages VPC endpoint per IMP-007.

**Acceptance Criteria**:
- [ ] `ecs.tf` updated with `execute_command_configuration`
- [ ] Task roles for finn, dixie, freeside have ssmmessages IAM permissions
- [ ] VPC endpoint for `com.amazonaws.us-east-1.ssmmessages` created with private DNS
- [ ] Security group for VPC endpoint allows HTTPS from ECS task SGs
- [ ] Verify: `aws ecs execute-command` succeeds for each service in staging

**Dependencies**: 2.1 (infra must be applied first)
**Effort**: Medium

#### 2.6 Create CI Plan Guard Script

**Description**: Create `scripts/tf-plan-guard.sh` per IMP-009 — CI gate blocking replace/destroy on critical resources.

**Acceptance Criteria**:
- [ ] Scans `terraform show -json` output for destructive actions on `prevent_destroy` resource types
- [ ] Blocks: ElastiCache replication groups, DynamoDB tables, S3 buckets, KMS keys, Route 53 zones
- [ ] Passes when plan contains only creates or in-place updates
- [ ] Clear error message identifying the blocked resource type and action count
- [ ] Integrated into CI workflow after `terraform plan`

**Dependencies**: None
**Effort**: Small

#### 2.7 Update DEPLOYMENT.md

**Description**: Document import procedure, deploy-ring usage, rollback commands, and Finn cutover procedure.

**Acceptance Criteria**:
- [ ] Import procedure with per-resource commands
- [ ] deploy-ring.sh usage with all service options
- [ ] **Concrete rollback procedures** (IMP-004): Each rollback includes exact CLI commands, expected output, time limit (e.g., "revert ECS service to previous TD within 5 min"), and verification step
- [ ] Phase 1 rollback plan documented per IMP-001 with trigger criteria (e.g., "5xx rate > 1% for > 2 min", "import produces force-replacement on any resource")
- [ ] Finn cutover step-by-step with verification gates
- [ ] **Secret handling protocol** (IMP-008): Document that no credential values appear in commit messages, PR descriptions, or logs. `.tfstate` backups excluded from git. `bootstrap-redis-auth.sh` output not piped to log files.
- [ ] Prohibition of local `terraform apply` during migration documented
- [ ] Health gate metric contract per 2.2
- [ ] Alarm response runbook per IMP-010: table of alarm → owner → first-response action → escalation

**Dependencies**: 2.3, 2.4 (scripts must exist to document)
**Effort**: Small

---

## Sprint 3: DNS Module (Global: 382)

**Goal**: Create the complete DNS Terraform root with zone, records, email, agent wildcard, and security configuration.

**PRD Trace**: FR-4 (Issue #106)
**SDD Trace**: §7.1-§7.9

**Exit Gate** (IMP-002): `terraform apply` succeeds on staging DNS. All `dig` validation queries return expected results. Zone records verified.

### Tasks

#### 3.1 Create DNS Root Structure

**Description**: Create `infrastructure/terraform/dns/` directory with `main.tf`, `variables.tf`, `outputs.tf`, and environment-specific backend/tfvars files.

**Acceptance Criteria**:
- [ ] `main.tf` with provider version `~> 5.82.0` per IMP-002, S3 backend with `-backend-config` pattern
- [ ] `variables.tf` with all variables including feature flags (`enable_production_api`, `enable_dnssec`) with safe defaults per IMP-008
- [ ] `outputs.tf` exposing zone_id, nameservers, ds_record
- [ ] `environments/staging/backend.tfvars` with `key = "dns/staging.tfstate"`
- [ ] `environments/staging/terraform.tfvars` with staging values
- [ ] `environments/production/backend.tfvars` with `key = "dns/production.tfstate"`
- [ ] `environments/production/terraform.tfvars` with production values (flags default off)
- [ ] `terraform init -backend-config=environments/staging/backend.tfvars` succeeds

**Dependencies**: None
**Effort**: Medium

#### 3.2 Create Zone & Record Files

**Description**: Create `honeyjar-xyz.tf`, `honeyjar-xyz-email.tf`, `honeyjar-xyz-vercel.tf`, `honeyjar-xyz-agents.tf`, `honeyjar-xyz-backend.tf`.

**Acceptance Criteria**:
- [ ] `honeyjar-xyz.tf`: Zone resource + apex A record pointing to Vercel anycast IP
- [ ] `honeyjar-xyz-email.tf`: MX (Google Workspace 5 records), SPF, DKIM (gated on `var.dkim_key`), DMARC with corrected `dmarc@0xhoneyjar.xyz`
- [ ] `honeyjar-xyz-vercel.tf`: Wildcard CNAME + `_acme-challenge` NS delegation to Vercel
- [ ] `honeyjar-xyz-agents.tf`: `*.agents` wildcard CNAME, bare `agents` A record, `_acme-challenge.agents` NS delegation
- [ ] `honeyjar-xyz-backend.tf`: `api` A alias record using `data.aws_lbs` → `data.aws_lb` pattern (gated on `enable_production_api`)
- [ ] `terraform plan` shows all creates, no errors

**Dependencies**: 3.1
**Effort**: Medium

#### 3.3 Create Security File

**Description**: Create `dns/security.tf` with CAA records and feature-flagged DNSSEC resources.

**Acceptance Criteria**:
- [ ] CAA records restrict issuance to Let's Encrypt + Amazon
- [ ] KSK resource gated by `enable_dnssec` variable
- [ ] DNSSEC KMS key uses least-privilege policy per SKP-002 (no root `kms:*`)
- [ ] Zone signing depends on KSK creation
- [ ] `terraform plan` with `enable_dnssec=false` shows only CAA record
- [ ] `terraform plan` with `enable_dnssec=true` shows KSK + zone signing + KMS

**Dependencies**: 3.1, 3.2
**Effort**: Small

#### 3.4 Apply DNS Module to Staging

**Description**: Apply the DNS module to create the staging Route 53 zone and all records.

**Acceptance Criteria**:
- [ ] `terraform init -backend-config=environments/staging/backend.tfvars` succeeds
- [ ] `terraform plan` shows all creates (zone + records)
- [ ] `terraform apply` succeeds
- [ ] `dig @<r53-ns> 0xhoneyjar.xyz A` returns Vercel anycast IP
- [ ] `dig @<r53-ns> 0xhoneyjar.xyz MX` returns Google Workspace MX records
- [ ] `dig @<r53-ns> test.agents.0xhoneyjar.xyz CNAME` returns Vercel CNAME (wildcard expansion)
- [ ] `dig @<r53-ns> agents.0xhoneyjar.xyz A` returns Vercel anycast IP
- [ ] `dig @<r53-ns> _acme-challenge.agents.0xhoneyjar.xyz NS` returns Vercel nameservers

**Dependencies**: 3.2, 3.3
**Effort**: Small

---

## Sprint 4: Migration Validation & Cutover Prep (Global: 383)

**Goal**: Create validation scripts and prepare the formal DNS cutover playbook per SKP-001.

**PRD Trace**: FR-5 (Issue #106 Sprint 2)
**SDD Trace**: §8.1-§8.2, §10 Phase 3

**Exit Gate** (IMP-002): `dns-pre-migration.sh` passes with zero mismatches. Cutover playbook reviewed and approved by domain owner. Gandi access confirmed.

### Tasks

#### 4.0 Confirm Gandi Registrar Access

**Description**: Verify registrar access and capabilities before migration scripts depend on it.

**Acceptance Criteria**:
- [ ] Can log into Gandi registrar dashboard and view NS records for `0xhoneyjar.xyz`
- [ ] Can edit NS records (confirmed via UI review, not actual change)
- [ ] Can view/export current zone records (for cross-reference with dns-pre-migration.sh)
- [ ] Can add/remove DS records (required for Sprint 5 DNSSEC)
- [ ] Registrar NS update SLA documented (Gandi: typically <15 min)
- [ ] Access credentials and MFA confirmed with domain owner

**Dependencies**: None
**Effort**: Small (manual verification, no code)

#### 4.1 Create Pre-Migration Validation Script

**Description**: Create `scripts/dns-pre-migration.sh` — validates Route 53 records match Gandi.

**Acceptance Criteria**:
- [ ] Compares all record types: A, AAAA, MX, TXT, CAA, CNAME
- [ ] Checks all critical subdomains: www, *.agents, agents, _dmarc, google._domainkey
- [ ] Checks ACME delegation: `_acme-challenge` NS, `_acme-challenge.agents` NS
- [ ] Uses actual Gandi authoritative nameservers (not fixed hostname)
- [ ] Diff allowlist for expected SOA/NS differences
- [ ] Non-zero exit on any unexpected mismatch
- [ ] Passes shellcheck

**Dependencies**: Sprint 3 complete (zone exists to validate against)
**Effort**: Medium

#### 4.2 Create Post-Migration Check Script

**Description**: Create `scripts/dns-post-migration-check.sh` — monitors propagation after NS change.

**Acceptance Criteria**:
- [ ] Queries 8+ diverse public resolvers
- [ ] Tracks A record and MX record propagation percentage
- [ ] ≥95% agreement threshold for success
- [ ] 4-hour timeout with rollback alert
- [ ] 1-minute check interval with progress reporting
- [ ] Passes shellcheck

**Dependencies**: None (can be written in parallel)
**Effort**: Medium

#### 4.3 Validate Record Equivalence

**Description**: Run `dns-pre-migration.sh` against the staging Route 53 zone and Gandi production records.

**Acceptance Criteria**:
- [ ] Script runs without errors
- [ ] All records MATCH or EXPECTED_DIFF (SOA, NS only)
- [ ] Zero MISMATCH results
- [ ] Email records (MX, SPF, DKIM, DMARC) specifically confirmed

**Dependencies**: 4.1, Sprint 3 (zone applied)
**Effort**: Small

#### 4.4 Document Cutover Playbook in DEPLOYMENT.md

**Description**: Add the formal DNS cutover playbook from SDD §10 Phase 3 (SKP-001) to DEPLOYMENT.md.

**Acceptance Criteria**:
- [ ] T-72h: TTL reduction steps with verification commands
- [ ] T-0: NS cutover steps with pre-flight check
- [ ] T+1h: Verification gate criteria
- [ ] T+24h: Enable API record steps
- [ ] Rollback procedure with trigger criteria and recovery time
- [ ] Owner assignments for each step

**Dependencies**: 4.1, 4.2 (scripts referenced in playbook)
**Effort**: Small

#### 4.5 Execute DNS Cutover Dry Run (IMP-009)

**Description**: Rehearse the full DNS cutover procedure in staging to validate scripts, timing, and team coordination before production execution.

**Acceptance Criteria**:
- [ ] Execute `dns-pre-migration.sh` against staging zone and record results
- [ ] Simulate T-72h TTL reduction on staging zone, verify propagation timing
- [ ] Walk through T-0 NS cutover steps (read-only — do not change production NS) with buddy observer
- [ ] Execute `dns-post-migration-check.sh` against staging zone and verify resolver propagation tracking works
- [ ] Time each step and compare to playbook estimates — update playbook if actuals differ by >50%
- [ ] Document any issues encountered during rehearsal and update playbook accordingly
- [ ] Rehearsal completion signed off by domain owner

**Dependencies**: 4.1, 4.2, 4.4 (playbook must exist to rehearse)
**Effort**: Small

---

## Sprint 5: Hardening & Drift Detection (Global: 384)

**Goal**: Enable DNSSEC (feature-flagged), activate nightly drift detection, and prepare post-cutover hardening steps.

**PRD Trace**: FR-6 (Issue #106 Sprint 3)
**SDD Trace**: §7.8, §8.3, §10 Phase 3 (IMP-004)

**Exit Gate** (IMP-002): Full validation suite passes (5.4). Production DNS zone applied. Drift check workflow active and clean. DNSSEC playbook reviewed.

### Tasks

#### 5.1 Create DNS Drift Check Workflow

**Description**: Create `.github/workflows/dns-drift-check.yml` — nightly Terraform plan for drift detection.

**Acceptance Criteria**:
- [ ] Runs daily at 06:00 UTC via cron schedule
- [ ] Also supports manual `workflow_dispatch`
- [ ] Uses `terraform plan -detailed-exitcode` to detect drift
- [ ] Exit code 2 (changes detected) produces GitHub warning annotation
- [ ] Concurrency group prevents parallel runs
- [ ] Uses OIDC for AWS credential assumption

**Dependencies**: Sprint 3 (DNS module must be applied)
**Effort**: Small

#### 5.2 Document DNSSEC Activation Playbook

**Description**: Add the DNSSEC activation playbook from SDD §10 Phase 3 (IMP-004) to DEPLOYMENT.md.

**Acceptance Criteria**:
- [ ] Prerequisites documented (NS stable for ≥48h, drift check clean for ≥2 days)
- [ ] Step-by-step: enable flag → plan → apply → extract DS → upload to Gandi → validate chain
- [ ] Rollback procedure: remove DS → disable flag → apply → verify unsigned resolution
- [ ] Monitoring: `dig +dnssec` verification command, dnsviz.net URL
- [ ] SERVFAIL rollback trigger criteria documented

**Dependencies**: Sprint 3 (security.tf exists with DNSSEC resources)
**Effort**: Small

#### 5.3 Apply DNS Module to Production

**Description**: Apply the DNS root to production (creates zone and records, does NOT change NS — that's a manual cutover step).

**Acceptance Criteria**:
- [ ] `terraform init -backend-config=environments/production/backend.tfvars` succeeds
- [ ] `terraform plan` shows all creates (identical structure to staging)
- [ ] `terraform apply` succeeds
- [ ] `enable_production_api=false` and `enable_dnssec=false` confirmed in production tfvars
- [ ] Production zone nameservers noted for registrar cutover step

**Dependencies**: Sprint 4 complete (validation scripts proven in staging)
**Effort**: Small

#### 5.4 Run Full Validation Suite

**Description**: Execute the complete validation pipeline on staging to confirm deployment readiness.

**Acceptance Criteria**:
- [ ] `deploy-ring.sh --ring staging --services all` passes with all health gates green
- [ ] `staging-wiring-test.sh staging` passes all 10 tests (W-1 through W-10)
- [ ] `tf-plan-guard.sh` passes on both compute and DNS plans
- [ ] `dns-pre-migration.sh` passes (staging zone vs Gandi)
- [ ] `terraform plan` on compute root shows 0 unexpected changes
- [ ] `terraform plan` on DNS root shows 0 changes (already applied)

**Dependencies**: All previous sprints
**Effort**: Medium

---

## Risk Assessment

| Risk | Sprint | Mitigation | SDD Reference |
|------|--------|------------|---------------|
| Import fails for stateful resource | 1 | Per-batch verification, pre-import backups, `terraform state rm` rollback | §4.2 (Backup), §4.3 (Import), §4.4 (Rollback/Safeguards) |
| Health gate false positive/negative | 2 | Sliding-window p99 (not per-request), 5xx counting, tunable thresholds | §5.2 (Health Gate) |
| DNS record mismatch missed | 4 | Comprehensive record comparison including ACME, agents, DKIM | §8.1 (Pre-Migration Validation) |
| DNSSEC breaks resolution | 5 | Feature-flagged, separate from NS cutover, documented rollback | §7.8 (DNSSEC), §10 Phase 3 (IMP-004 Playbook) |
| ECS Exec unavailable in staging | 2 | VPC endpoint provisioned (IMP-007), fallback to CloudWatch log verification | §6.3 (ECS Exec Network Prerequisites) |

## Flatline Finding Traceability

### SDD Findings (Flatline SDD Review)

Maps each Flatline SDD finding (SKP/IMP) to the sprint task(s) that implement or address it.

| Finding | SDD Section | Sprint Task(s) | Description |
|---------|-------------|-----------------|-------------|
| SKP-001 | §10 Phase 3 | 4.4 (cutover playbook) | Formal DNS cutover playbook with rollback triggers |
| SKP-002 | §3.4, §7.8 | 1.1 (kms-finn.tf), 3.3 (security.tf) | KMS least-privilege policy (no root `kms:*`) |
| SKP-003 | §3.1 | 1.1 (elasticache-finn.tf), 1.2 (bootstrap script) | External Redis auth provisioning (not in TF state) |
| SKP-004 | §5.2 | 2.2 (metric contract), 2.3 (deploy-ring.sh) | Sliding-window p99 health gate |
| IMP-001 | §10 Phase 1, Phase 3 | 2.7 (DEPLOYMENT.md), 4.4 (cutover playbook) | Executable rollback plans |
| IMP-002 | §7.1 | 3.1 (DNS main.tf) | Exact provider version pin `~> 5.82.0` |
| IMP-003 | §4.4 | 1.3 (import workflow) | Import procedural safeguards (backup/verify/checkpoint) |
| IMP-004 | §10 Phase 3 | 5.2 (DNSSEC playbook) | DNSSEC activation playbook with rollback |
| IMP-005 | §9.4 | 1.3 (import backup), 2.7 (DEPLOYMENT.md) | RPO/RTO targets for stateful components |
| IMP-006 | §5.2 | 2.2 (metric contract), 2.3 (deploy-ring.sh) | Merged with SKP-004 (sliding-window p99) |
| IMP-007 | §6.3 | 2.5 (ECS Exec + VPC endpoints) | ssmmessages VPC endpoint for ECS Exec |
| IMP-008 | §7.2 | 3.1 (variables.tf feature flags) | Feature flag safety defaults per environment |
| IMP-009 | §5.3 | 2.6 (tf-plan-guard.sh) | CI gate blocking destructive plan actions |
| IMP-010 | §12 | This table | Traceability mapping |

### Sprint Findings (Flatline Sprint Review)

| Finding | Category | Sprint Task(s) | Description |
|---------|----------|-----------------|-------------|
| FL-SKP-001a | BLOCKER | Change Approval Protocol, all sprints | Peer review gates for high-risk operations |
| FL-SKP-001b | BLOCKER | 1.2 (bootstrap script) | Atomic auth rotation: ElastiCache first, then Secrets Manager |
| FL-SKP-002a | BLOCKER | 1.3 (import) | Encrypted backup storage, checksum, restore drill |
| FL-SKP-002b | BLOCKER | Change Approval Protocol | Bus factor mitigation, buddy observer for critical tasks |
| FL-SKP-003a | BLOCKER | 1.2 (bootstrap script) | Stronger token generation, minimal secret, rotation cadence |
| FL-SKP-003b | BLOCKER | 1.1 (env-finn.tf) | SSM ignore_changes rationale documented |
| FL-SKP-004 | BLOCKER | 2.3 (deploy-ring.sh) | Automated rollback on health gate failure |
| FL-IMP-001 | HIGH | 1.2 (bootstrap script) | Auth bootstrap sequencing after import |
| FL-IMP-002 | DISPUTED | All sprints (exit gates) | Explicit go/no-go exit gates per sprint |
| FL-IMP-003 | DISPUTED | Sprint header | Critical path analysis with buffer days |
| FL-IMP-004 | DISPUTED | 2.7 (DEPLOYMENT.md) | Concrete rollback CLI commands and time limits |
| FL-IMP-005 | DISPUTED | Pre-Flight Requirements | IAM permissions pre-flight check |
| FL-IMP-006 | DISPUTED | Sprint overview | Deliverable count consistency |
| FL-IMP-007 | DISPUTED | 2.3 (deploy-ring.sh) | Quantified health gate thresholds (2000ms p99, <3 5xx) |
| FL-IMP-008 | DISPUTED | 2.7 (DEPLOYMENT.md), Pre-Flight | Secret handling protocol (.gitignore, no creds in commits) |
| FL-IMP-009 | DISPUTED | 4.5 (cutover dry run) | Mandatory DNS cutover rehearsal in staging |
| FL-IMP-010 | DISPUTED | 2.1 (monitoring), 2.7 (DEPLOYMENT.md) | Alarm response ownership and runbook |

**Out-of-scope findings**: None — all SDD findings (14) and sprint findings (17) are addressed.

## Success Criteria

This sprint plan is complete when:
1. All 8 new .tf files exist in compute root with correct HCL
2. All 22 resources imported with 0-change plan verification
3. Deploy pipeline with health gates operational
4. 10/10 wiring tests passing
5. DNS zone created in both staging and production
6. Pre-migration validation script confirms record equivalence
7. Cutover and DNSSEC playbooks documented
8. Drift detection workflow active

---

## Bridge Sprint B1: Bridgebuilder Iteration 1 Findings

> **Source**: bridge-20260228-049956, Iteration 1
> **Findings**: 3 HIGH, 4 MEDIUM, 1 LOW (7 actionable)
> **Delivery**: 1 sprint (single pass through all findings)

### Sprint B1: Address Bridgebuilder Findings

**Goal**: Fix all actionable findings from Bridgebuilder iteration 1 review.

#### Task B1.1: Add S3 public access blocks (HIGH — high-3)
- **File**: `infrastructure/terraform/s3-finn.tf`
- **Action**: Add `aws_s3_bucket_public_access_block` for both `finn_audit_anchors` and `finn_calibration` with all four flags set to `true`
- **AC**: Both buckets have explicit public access block resources; `terraform plan` shows 2 new resources, 0 changes to existing

#### Task B1.2: Normalize pre-migration record comparison (HIGH — high-4)
- **File**: `infrastructure/terraform/scripts/dns-pre-migration.sh`
- **Action**: In `compare_record()`, apply canonicalization pipeline to both data sources:
  1. AWS CLI: `--output text` → `tr '\t' '\n'` → one-value-per-line
  2. dig: already newline-separated
  3. Both: strip trailing dots (`sed 's/\.$//'`), strip surrounding TXT quotes (`sed 's/^"//;s/"$//'`), collapse whitespace, `sed '/^$/d' | sort`
  4. Create a `canonicalize_dns_value()` function that encapsulates all normalization steps
- **AC**: (a) Canonical normalization in a named function applied to both sources; (b) MX records with 5 priority-value pairs compare correctly; (c) TXT records with quoted strings (SPF `v=spf1...`, DKIM long key, DMARC `v=DMARC1...`) compare correctly after quote stripping; (d) CNAME/NS trailing dots handled consistently; (e) Add inline test: run `compare_record "MX" "$DOMAIN"` against live DNS and verify MATCH (not MISMATCH) for known-good records

#### Task B1.3: Fix deploy-ring.sh health check URL scheme (HIGH — high-2)
- **File**: `infrastructure/terraform/scripts/deploy-ring.sh`
- **Action**: Define a single source of truth for health check URLs per service:
  1. Create a `HEALTH_URLS` associative array at top of script mapping service→full URL (scheme+host+path)
  2. Derive scheme from actual service routing configuration: check existing Terraform ALB listener rules and target groups to determine whether each service endpoint terminates TLS externally or not. Freeside is behind public ALB (HTTPS), Finn/Dixie are staging-only or internal (HTTP)
  3. Add `-L` flag to curl to handle unexpected redirects gracefully without masking failures
  4. After constructing each URL, validate reachability: add a `--dry-run` mode that curls each health URL once and reports scheme/status/redirect chain before proceeding with deploy
- **AC**: (a) Health URLs centralized in `HEALTH_URLS` array; (b) URLs verified against actual Terraform ALB/listener config; (c) `curl -sfL` used in health gate; (d) `--dry-run` mode prints each URL + HTTP status + redirect chain; (e) Script header documents URL scheme contract per service

#### Task B1.4: Add explicit `shell: bash` to drift-check workflow (MEDIUM — medium-3)
- **File**: `.github/workflows/dns-drift-check.yml`
- **Action**: Add `shell: bash` to the Terraform Plan step that uses `PIPESTATUS`
- **AC**: Step includes explicit `shell: bash` declaration

#### Task B1.5: Restrict ElastiCache egress to VPC CIDR (MEDIUM — medium-4)
- **File**: `infrastructure/terraform/elasticache-finn.tf`
- **Action**: Remove unrestricted egress and apply least-privilege network policy:
  1. ElastiCache Redis is a single-node group (`num_cache_clusters = 1`) — no inter-node replication traffic
  2. Redis only responds to inbound client connections; it does not initiate outbound connections
  3. DNS resolution uses VPC DNS resolver (within VPC CIDR); NTP uses Amazon Time Sync (169.254.169.123 link-local, not routed via SG)
  4. Replace `0.0.0.0/0` egress with VPC CIDR (`module.vpc.vpc_cidr_block`) to allow only intra-VPC responses
  5. `bootstrap-redis-auth.sh` calls AWS API from the operator's machine, not from the Redis node — unaffected by SG changes
- **AC**: (a) Egress rule changed to VPC CIDR only; (b) `terraform plan` shows 1 changed resource (SG rule), 0 destroyed; (c) W-8 wiring test (Finn→Redis) passes after apply; (d) No connectivity regressions in other wiring tests

#### Task B1.6: Remove dead ROLLED_BACK tracking from deploy-ring.sh (MEDIUM — medium-1)
- **File**: `infrastructure/terraform/scripts/deploy-ring.sh`
- **Action**: Remove `ROLLED_BACK` array tracking since script exits on first health gate failure. Keep rollback_service function (it's used). Remove final summary block that checks ROLLED_BACK.
- **AC**: No dead code; script behavior unchanged (exit on first failure)

#### Task B1.7: Fix wiring test W-7 Cloud Map service name (MEDIUM — medium-2)
- **File**: `infrastructure/terraform/scripts/staging-wiring-test.sh`
- **Action**: Determine correct Cloud Map service discovery hostname deterministically:
  1. Search Terraform HCL for `aws_service_discovery_service` resources: `grep -r 'aws_service_discovery_service' infrastructure/terraform/*.tf` to find the `name` attribute for each service
  2. Cross-reference: the `name` attribute of each `aws_service_discovery_service` resource defines the DNS hostname in the private namespace (`<name>.<namespace>`)
  3. If Terraform shows Freeside registered as `api` (matching ECS service `${CLUSTER}-api`), update W-7 from `freeside.${CLUSTER}.local` to `api.${CLUSTER}.local`
  4. Also audit W-4 through W-10 to ensure all Cloud Map hostnames match their `aws_service_discovery_service.name` attributes
- **AC**: (a) Each wiring test hostname traced to a specific `aws_service_discovery_service` resource name in Terraform; (b) W-7 URL updated to match; (c) `terraform plan` unchanged (no infra changes); (d) Comment in script header documents hostname→Terraform resource mapping for each service

#### Task B1.8: Extract alarm thresholds to variables (LOW — low-1)
- **File**: `infrastructure/terraform/monitoring-finn.tf`, `infrastructure/terraform/monitoring-dixie.tf`, `infrastructure/terraform/variables.tf`
- **Action**: Extract CPU threshold, memory threshold, 5xx threshold, p99 latency threshold into Terraform variables with current values as defaults
- **AC**: All alarm thresholds are parameterized; existing behavior unchanged

---

## Bridge Sprint B2: Bridgebuilder Iteration 2 Findings

> **Source**: bridge-20260228-049956, Iteration 2
> **Findings**: 0 HIGH, 1 MEDIUM, 1 LOW (2 actionable)
> **Delivery**: 1 sprint (polish pass)

### Sprint B2: Address Bridgebuilder Iteration 2 Findings

**Goal**: Fix remaining polish-level findings from Bridgebuilder iteration 2.

#### Task B2.1: Combine double curl in dry-run preflight (MEDIUM — medium-1)
- **File**: `infrastructure/terraform/scripts/deploy-ring.sh`
- **Action**: In `dry_run_preflight()`, combine the two `curl` calls per service into one using multiple `-w` format specifiers: `curl -sI -o /dev/null -w '%{http_code}\n%{url_effective}' --max-time 10 "$url"` and split the two-line output
- **AC**: Single curl call per service in dry-run; output still shows HTTP code and effective URL

#### Task B2.2: Simplify alarm description interpolation (LOW — low-1)
- **File**: `infrastructure/terraform/agent-monitoring.tf`
- **Action**: Replace inline `${var.agent_alarm_stale_reservation_ms / 1000}` division in alarm description with a `locals` block computing `agent_alarm_stale_reservation_s = var.agent_alarm_stale_reservation_ms / 1000`
- **AC**: Alarm description uses `local.agent_alarm_stale_reservation_s`; `terraform plan` shows no effective change

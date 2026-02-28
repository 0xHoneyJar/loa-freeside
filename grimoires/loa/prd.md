# PRD: Armitage Platform — Terraform Consolidation & DNS Authority

> **Cycle**: cycle-046
> **Codename**: Armitage Platform
> **Status**: DRAFT
> **Created**: 2026-02-28
> **Author**: Plan & Analyze (HITL)
> **Issues**: #105, #106 (issue #103 resolved in cycle-045)

## 1. Problem Statement

The Arrakis agent economy stack (Freeside, Finn, Dixie) has three competing Terraform configurations across three repos, and DNS for the production domain (`0xhoneyjar.xyz`) is manually managed at Gandi with no IaC. This creates:

1. **Deployment fragility**: Finn exists in both freeside's `ecs-finn.tf` (internal-only, Cloud Map) AND finn's own `loa-finn-ecs.tf` (public ALB). Applying both creates duplicate ECS services. Different state backends (`arrakis-tfstate-*` vs `honeyjar-terraform-state`), different secret managers (Secrets Manager vs SSM Parameter Store), different security models (SG-to-SG vs CIDR-based).

2. **Missing infrastructure**: Freeside's terraform is missing finn's dedicated ElastiCache (noeviction + AOF), DynamoDB tables (audit + settlements), S3 Object Lock buckets, KMS audit signing key, 13 SSM parameters, 6 CloudWatch alarms. Dixie is missing auto-scaling and 4 alarms.

3. **DNS blind spot**: `0xhoneyjar.xyz` DNS is at Gandi with a broken DMARC record (placeholder `admin@yourdomain.com`). The agent economy needs `api.0xhoneyjar.xyz` for production ALB routing and `*.agents.0xhoneyjar.xyz` for 100K+ dNFT agent websites. Neither can happen without Route 53 IaC.

**Why now?** The system is not live, so ECS service definitions and non-stateful networking can be rebuilt without user impact. However, stateful resources (S3 Object Lock, KMS keys, DynamoDB tables) must NEVER be destroyed/recreated — they must be imported into the canonical state. Fixing competing terraform states and establishing DNS authority under IaC now prevents production-blocking issues after launch.

**Safety invariant**: No `terraform destroy` on legacy stacks until all stateful and shared resources are imported and verified in the canonical root. Stateful resources get `lifecycle { prevent_destroy = true }` in the new code.

> Sources: GitHub Issues #105, #106; infrastructure/terraform/ codebase audit; Bridgebuilder reviews (PRs #97, #99, #100); loa-finn Issue #66 (Launch Readiness RFC)

## 2. Goals & Success Metrics

| ID | Goal | Metric | Target |
|----|------|--------|--------|
| G-1 | Single terraform root manages all three services | `terraform plan`: imported stateful resources show 0 changes; new resources show creates only (no destroys/replaces) | Per-category drift targets below |
| G-2 | All missing finn/dixie infrastructure in freeside | Resource count: ElastiCache, DynamoDB, S3, KMS, SSM, alarms | All present in tf state |
| G-3 | Sequential deploy with health gates | `deploy-ring.sh` deploys Dixie → Finn → Freeside with health checks | 3/3 services healthy |
| G-4 | Cross-service wiring validated | `staging-wiring-test.sh` passes all 10 connectivity paths | 10/10 pass |
| G-5 | DNS authority for 0xhoneyjar.xyz under IaC | Route 53 zone with functional equivalence to Gandi (SOA/NS will differ; see diff allowlist in FR-5) | Functional parity confirmed |
| G-6 | Agent economy subdomain architecture | `*.agents.0xhoneyjar.xyz` wildcard resolves via CNAME in apex zone | DNS lookup returns Vercel CNAME |
| G-7 | Zero email delivery regression | MX, SPF, DKIM, DMARC records functional post-migration | Google Workspace email flowing |

**G-1 acceptance criteria detail:**
- Imported stateful resources (S3 Object Lock, KMS, DynamoDB): `terraform plan` shows 0 changes
- New resources (ElastiCache, alarms, SSM params, autoscaling): plan shows creates only, no destroys/replaces
- Existing ECS services/ALB/SGs: updates permitted only for security group rule additions; no replaces

## 3. Users & Stakeholders

### Primary Users

| Persona | Context | Needs |
|---------|---------|-------|
| **Platform Engineer** | Deploys and operates the Armitage ring | Single `terraform apply`, reliable deploy pipeline, clear wiring tests |
| **Service Developer** (Finn/Dixie) | Ships application code, not infrastructure | `DEPLOYMENT.md` pointing to freeside, no terraform in their repo |
| **Agent Economy Operator** | Manages dNFT agent websites | Wildcard DNS `*.agents.0xhoneyjar.xyz` working with Vercel |

### Stakeholders

- **0xHoneyJar team**: Production DNS must not disrupt email (Google Workspace MX records) or existing Vercel deployments
- **Security**: DNSSEC, CAA, and DMARC hardening required post-migration

## 4. Functional Requirements

### FR-1: Terraform Consolidation (Issue #105, Phase 1)

**Safe Import Workflow for stateful resources:**

1. Add resource definitions to freeside terraform code with `lifecycle { prevent_destroy = true }` for KMS, S3 Object Lock, and DynamoDB
2. Run `terraform plan` — expect "will be created" for each (expected before import)
3. Run `terraform import` for each resource using IDs exported from finn's state
4. Run `terraform plan` again — must show 0 changes for all imported resources
5. Only then proceed with `terraform apply` for non-stateful additions
6. Never run `terraform destroy` on legacy finn/dixie stacks until imports are verified

**Rollback/run-forward procedure for failed applies:**

- Before every `terraform apply`: capture state snapshot (`terraform state pull > backup-$(date +%s).tfstate`)
- Apply in scoped phases: (1) networking/IAM first, (2) compute/services second — never atomic-apply everything
- If apply fails mid-way: assess damage with `terraform plan`, identify drifted resources, apply targeted fixes to reach consistent state (run-forward preferred over rollback to avoid state divergence)
- Recovery commands documented per resource type in `DEPLOYMENT.md`
- Mandatory: `terraform plan` output must be reviewed and saved as artifact before `apply` in CI

**State locking and serialized execution:**

- All CI Terraform jobs must acquire DynamoDB lock before apply (already configured via backend)
- During migration period: only one operator/pipeline may run `terraform apply` at a time — enforce via CI job serialization (GitHub Actions `concurrency` group)
- Prohibition of local `terraform apply` during active migration (document in `DEPLOYMENT.md`)

**Stateful resources to import (cannot be recreated):**
- S3 Object Lock bucket (`audit_anchors`) — Object Lock buckets are immutable
- S3 calibration bucket — has versioned data
- KMS audit signing key — destruction = permanent data loss
- DynamoDB scoring path log — has audit data
- DynamoDB x402 settlements — has settlement data

**Adoption matrix for shared identity/routing resources:**

| Resource | Action | Rationale |
|----------|--------|-----------|
| S3 Object Lock bucket | Import | Immutable, cannot recreate |
| S3 calibration bucket | Import | Has versioned data |
| KMS audit signing key | Import | Destruction = data loss |
| DynamoDB tables (2) | Import | Has audit/settlement data |
| Finn ECS service | Recreate | Freeside already defines `ecs-finn.tf`; see Finn cutover procedure below |
| Finn ALB listener/TG | Recreate | Freeside owns ALB; see Finn cutover procedure below |
| Finn IAM roles | Recreate | Freeside already defines execution/task roles |

**Finn non-stateful cutover procedure (prevents duplicate services):**

1. **Freeze**: Stop all `terraform apply` in loa-finn repo (communicate to team)
2. **Disable legacy**: In finn's legacy stack, scale `desired_count=0` for the ECS service and disable/detach ALB listener rules — keep stateful resources (S3, KMS, DDB, SSM) intact in finn's state
3. **Apply canonical**: Run `terraform apply` in freeside to create the single intended Finn service + ALB routing via `ecs-finn.tf`
4. **Verify**: Run health gates + wiring tests (W-2, W-4, W-7, W-8) to confirm canonical Finn is healthy
5. **Retire legacy**: Remove Finn ECS/ALB/IAM resource definitions from finn's terraform code (without `terraform destroy` — resources are already scaled to 0 / detached). Run `terraform state rm` for these resources in finn's state.
6. **Invariant**: Only one set of Finn listener rules/target groups may be active at any time. Freeside's ALB is authoritative.
| Finn CloudWatch log group | Import | Preserves log history |
| Finn SSM parameters | Import | Already has values set |
| Cloud Map namespace | Exists in freeside | No action needed |
| Cloud Map services | Exists in freeside | No action needed |
| Dixie ECS service | Exists in freeside | No action needed |
| Dixie ALB listener/TG | Exists in freeside | No action needed |

**Dixie stateful resource inventory (explicit):** Dixie has **no dedicated stateful resources** (no ElastiCache, DynamoDB, S3, KMS, or SSM parameters in the dixie repo). Dixie's entire infrastructure — ECS service, ALB routing, Cloud Map service, task definition — already lives in freeside's `ecs-dixie.tf`. The only Dixie gaps are observability (alarms, metric filters) and autoscaling, both of which are new resources (creates, not imports). This means Dixie consolidation has no import/migration risk — only additive resource creation.

**Add missing resources to freeside terraform:**

| File | Resources | Service |
|------|-----------|---------|
| `elasticache-finn.tf` | Dedicated ElastiCache (Redis 7.1, noeviction, TLS, AOF) | Finn |
| `dynamodb-finn.tf` | 2 DynamoDB tables + GSI | Finn |
| `s3-finn.tf` | 2 S3 buckets (Object Lock + calibration) | Finn |
| `kms-finn.tf` | KMS key + alias for audit signing | Finn |
| `env-finn.tf` | 13 SSM parameters (SecureString with KMS) | Finn |
| `monitoring-finn.tf` | 6 CloudWatch alarms + metric filters | Finn |
| `monitoring-dixie.tf` | 4 CloudWatch alarms + 2 metric filters | Dixie |
| `autoscaling-dixie.tf` | AppAutoScaling target + CPU policy | Dixie |

**Detailed resource inventory requirement:** The SDD must include a per-resource Terraform mapping table listing: resource type, logical name, physical ID (from finn's state), import command, and expected plan diff (0 changes vs. expected creates). This is the authoritative source for the import workflow — the PRD adoption matrix above provides categories, the SDD provides the exhaustive line-item inventory.

**Architecture decisions (from Issue #105):**
- Keep SSM Parameter Store for Finn (already has 13 params in staging; both SSM and Secrets Manager coexist)
- Keep Finn public for staging/Armitage ring (direct health checks from outside VPC)
- Keep Finn's dedicated ElastiCache (noeviction policy for billing data, AOF persistence)

### FR-2: Canonical Deploy Pipeline (Issue #105, Phase 2)

Create `scripts/deploy-ring.sh` — sequential orchestrator with health gates:

1. Build all Docker images → Push to ECR
2. Terraform apply (infrastructure changes)
3. Deploy Dixie (no upstream dependencies) → health gate
4. Deploy Finn (needs DIXIE_BASE_URL) → health gate
5. Deploy Freeside (needs both) → health gate
6. Integration tests (smoke + wiring)
7. Report

**Health gate pattern**: SLO-aligned checks, not just reachability. Each health gate must verify:
- HTTP 200 from health endpoint (basic reachability)
- Response latency < 2s p99 over 10 consecutive checks (service responsiveness)
- 0 5xx errors during health check window (stability)
- Timeout: 5 minutes, poll interval: 5 seconds

**Staging → Production promotion policy:**
- Staging must pass: all wiring tests (W-1..W-10), health gates for all 3 services, `terraform plan` shows no unexpected changes
- Production promotion requires: staging green for ≥1 hour, DEPLOYMENT.md checklist sign-off, manual approval gate in CI
- No direct-to-production applies — all changes must be validated in staging first

**Enhancement of existing**: `staging-deploy-all.sh` and `deploy-staging.yml` already exist. The deploy-ring.sh adds the health-gated sequential pattern and wiring verification that's currently missing.

### FR-3: E2E Wiring Tests (Issue #105, Phase 3)

Create `scripts/staging-wiring-test.sh` — validates all service-to-service connectivity:

| Test | From | To | Method |
|------|------|----|--------|
| W-1 | External | Freeside | HTTPS health check |
| W-2 | External | Finn | HTTPS health check (staging only) |
| W-3 | External | Dixie | HTTPS health check |
| W-4 | Freeside → Finn | Cloud Map DNS | Internal health |
| W-5 | Freeside → Dixie | Cloud Map DNS | Internal health |
| W-6 | Finn → Dixie | Cloud Map DNS | Reputation query |
| W-7 | Finn → Freeside | Cloud Map DNS | JWKS endpoint |
| W-8 | Finn → Redis | Dedicated ElastiCache | PONG |
| W-9 | Freeside → PostgreSQL | PgBouncer | Connection |
| W-10 | Dixie → PostgreSQL | PgBouncer | Connection |

Internal tests (W-4 through W-10) require ECS Exec to run commands from inside containers.

**Wiring test operational plan:**
- **Ownership**: Platform team (freeside repo maintainers) own wiring test maintenance
- **Execution**: Run automatically in CI via `deploy-staging.yml` after every deploy-ring.sh invocation
- **Frequency**: On every staging deploy + nightly scheduled run (catch infrastructure drift)
- **Failure policy**: Any wiring test failure blocks the deploy pipeline (no manual override without documented rationale in PR)

**ECS Exec prerequisites (must be in place before wiring tests):**
- ECS cluster `executeCommandConfiguration` enabled (with optional KMS encryption for audit logs)
- Task role IAM permissions: `ssmmessages:CreateControlChannel`, `ssmmessages:CreateDataChannel`, `ssmmessages:OpenControlChannel`, `ssmmessages:OpenDataChannel`
- Task role KMS permissions if using encrypted exec logs
- Network egress to SSM endpoints (via existing NAT Gateway or VPC endpoints for `ssmmessages`, `ec2messages`, `logs`)
- Verification: `aws ecs execute-command --cluster <cluster> --task <task> --container <container> --command "/bin/sh -c 'echo ok'" --interactive` must succeed for each service before running W-4..W-10

### FR-4: DNS Authority Migration (Issue #106)

**Create `infrastructure/terraform/dns/` as a separate root module** (separate state from compute):

| File | Purpose |
|------|---------|
| `dns/main.tf` | Backend config, providers, locals |
| `dns/variables.tf` | Environment, feature flags, DKIM key |
| `dns/honeyjar-xyz.tf` | Zone + apex A records (76.76.21.21 Vercel anycast IP, per Vercel docs for custom domains) |
| `dns/honeyjar-xyz-email.tf` | MX (Google Workspace), SPF/TXT, DKIM, DMARC (fixed) |
| `dns/honeyjar-xyz-vercel.tf` | Wildcard CNAME, `_acme-challenge` NS delegation |
| `dns/honeyjar-xyz-agents.tf` | `*.agents.0xhoneyjar.xyz` wildcard + ACME delegation |
| `dns/honeyjar-xyz-backend.tf` | `api.0xhoneyjar.xyz` alias to ALB (feature-flagged) |
| `dns/security.tf` | CAA records, DNSSEC resources (gated) |
| `dns/outputs.tf` | Zone ID, nameservers |
| `dns/environments/` | staging.tfvars + production.tfvars |

**Key decisions:**
- Separate Terraform state (`dns/staging/terraform.tfstate`) — DNS changes shouldn't risk compute resources
- ALB cross-reference: use `data.aws_lb` with deterministic filter (exact name tag `arrakis-{env}-alb` + region/account constraint) to prevent wrong-ALB resolution. Add `postcondition` validation that exactly one ALB matches. Compute must be applied before `enable_production_api` is toggled on. (Alternative: `terraform_remote_state` from compute state is acceptable if read-only access is configured.)
- Feature flags: `enable_production_api` and `enable_dnssec`
- Agent economy subdomain model: `*.agents.0xhoneyjar.xyz` is a wildcard CNAME record in the apex zone (NOT a delegated sub-zone). The `agents.0xhoneyjar.xyz` bare record also needs an explicit A/CNAME to prevent lookup failures. `_acme-challenge.agents.0xhoneyjar.xyz` NS record delegates certificate validation to Vercel. DNS wildcard precedence: `*.agents.0xhoneyjar.xyz` is a more specific match than `*.0xhoneyjar.xyz` — no conflict per RFC 4592.

### FR-5: Pre/Post Migration Validation (Issue #106, Sprint 2)

- `scripts/dns-pre-migration.sh` — validates Route 53 records match Gandi before cutover (functional equivalence with explicit diff allowlist)
- `scripts/dns-post-migration-check.sh` — monitors propagation after NS change with quantified checks:
  - Query 8+ public resolvers (Google 8.8.8.8, Cloudflare 1.1.1.1, OpenDNS, Quad9, regional resolvers) for all record types
  - Success threshold: ≥95% resolver agreement within 30 minutes of NS update
  - MX record verification: send test email within 1 hour of cutover
  - Health endpoint latency check: API response time < 500ms from 3 geographic regions
  - Automated retry with backoff until thresholds met or 4-hour timeout triggers rollback alert
- Migration runbook in `dns/README.md`

### FR-6: Post-Migration Hardening (Issue #106, Sprint 3)

- Nightly DNS drift check workflow (`.github/workflows/dns-drift-check.yml`)
- DNSSEC enablement (gated by feature flag)
- SPF pruning (remove Gandi after cutover)
- DMARC ramp to `p=reject` (4 weeks post-cutover)

## 5. Technical & Non-Functional Requirements

### NFR-1: Zero-Downtime DNS Migration
- DNS cutover must not interrupt email delivery (MX records), Vercel deployments (wildcard CNAME), or API access
- TTL reduction to 300s required 48h before cutover
- Pre-migration validation must confirm 100% record parity

### NFR-2: Terraform State Safety
- Stateful resources (S3 Object Lock, KMS, DynamoDB) must be imported, never recreated
- `terraform plan` must show 0 unexpected destroys before any apply
- DNS module uses separate state backend from compute module
- **State backend hardening (both compute and DNS roots):**
  - S3 bucket: versioning enabled, SSE-KMS encryption, bucket policy denying unencrypted uploads
  - DynamoDB lock table: point-in-time recovery enabled, IAM least-privilege access
  - IAM: only CI service role and designated operators may read/write state; no wildcard permissions on state bucket/prefix
  - Prohibition of local state files in CI — all runs must use remote backend
  - State bucket access logging enabled for audit trail

### NFR-3: Security Model Consistency
- **Service-to-service traffic**: SG-to-SG references only (no CIDR-based rules within the mesh)
- **Internet ingress**: Only via ALB security group with CIDR `0.0.0.0/0` on port 443; ECS tasks are never directly internet-reachable
- Finn's service SG: inbound from freeside SG only; egress to PgBouncer, Redis, NATS, Dixie, Freeside SGs
- Dixie's service SG: inbound from ALB SG + Finn SG; egress to PgBouncer, Redis SGs
- Finn's public ALB listener (staging only) goes through the shared ALB SG, not a CIDR rule on Finn's service SG

### NFR-4: Observability
- All services must have CloudWatch alarms for CPU, memory, 5xx errors
- Health gate failures must produce actionable error messages with service name and timeout

### NFR-5: DMARC Fix (Immediate)
- Current DMARC record has placeholder `admin@yourdomain.com` — must be fixed to `dmarc@0xhoneyjar.xyz` independent of the migration timeline
- The corrected DMARC value (`v=DMARC1; p=quarantine; rua=mailto:dmarc@0xhoneyjar.xyz; ruf=mailto:dmarc@0xhoneyjar.xyz; fo=1`) must be the source of truth in the Route 53 Terraform module from day one
- Pre-migration parity validation (FR-5) must treat the corrected DMARC as expected, not the broken Gandi value

### NFR-6: Governance & Compliance (Fast-Follow)
- Post-migration: define resource tagging policy (Environment, Service, ManagedBy, CostCenter) for all Terraform-managed resources
- Establish drift detection schedule (weekly `terraform plan` in CI, alert on non-zero diff)
- Document access control matrix: who can apply to which Terraform root (compute vs. DNS) and under what conditions
- **Note**: This is a maturity uplift — not blocking for the migration itself, but should be addressed within 2 weeks of successful cutover

## 6. Scope & Prioritization

### In Scope (MVP)

| Priority | Item | Issue |
|----------|------|-------|
| P0 | Terraform consolidation — add missing finn/dixie resources | #105 Phase 1 |
| P0 | Deploy pipeline with health gates | #105 Phase 2 |
| P0 | E2E wiring tests | #105 Phase 3 |
| P0 | DNS Terraform module for 0xhoneyjar.xyz | #106 Sprint 1 |
| P1 | Pre/post migration validation scripts | #106 Sprint 2 |
| P1 | DNS drift check workflow | #106 Sprint 3 |
| P1 | DNSSEC enablement (feature-flagged) | #106 Sprint 3 |

### Out of Scope

- Actual DNS cutover at Gandi registrar (manual step, documented in runbook)
- Chiba (pre-production) and Production ring deployment (future cycles)
- Migrating finn/dixie from SSM to Secrets Manager (decision: keep SSM)
- Removing terraform from loa-finn and loa-dixie repos (Phase 4 of #105 — separate PR after verification)
- DKIM key retrieval from Google Admin Console (manual step)

## 7. Risks & Dependencies

| ID | Risk | Impact | Mitigation |
|----|------|--------|------------|
| R-1 | Terraform import fails for stateful resources | Data loss if recreated instead of imported | Use safe import workflow (FR-1): add code with `prevent_destroy`, plan, import, plan-again-until-0-changes, then apply. Never use `-target` for imports. |
| R-2 | DNS migration causes email outage | Google Workspace email down | Pre-migration functional-equivalence validation (not literal parity — SOA/NS/TTL differences expected), low TTL, rollback plan (revert NS at registrar) |
| R-3 | Conflicting SG rules between finn's old and new terraform | Service unreachable | Freeze finn's TF applies first; import shared resources into freeside; deprecate old stacks without destroying shared components |
| R-4 | Agent wildcard conflicts with existing wildcard | Vercel routing broken | `*.agents.0xhoneyjar.xyz` is more specific than `*.0xhoneyjar.xyz` per RFC 4592 — no conflict. Both are CNAME records in the same zone. |
| R-5 | ECS Exec not enabled on existing tasks | Can't run internal wiring tests | Enable ECS Exec in task definitions + cluster config + IAM permissions + SSM endpoint access (see FR-3 prerequisites) |
| R-6 | `data.aws_lb` resolves wrong ALB in DNS module | Production DNS points at wrong load balancer | Deterministic lookup with exact name tag + postcondition validation (see FR-4 key decisions) |

### Dependencies

- **loa-finn terraform state**: Need access to export resource IDs for import
- **loa-dixie terraform state**: Need resource IDs for dixie's stateful resources
- **Google Admin Console**: DKIM public key needed before DNS Sprint 1 apply
- **Gandi registrar**: Nameserver update is manual (Sprint 2 cutover)
- **AWS Route 53**: Must be in same account as compute resources (or use cross-account delegation)

## 8. Manual Steps (Cannot Be Automated)

| Step | System | When | Owner |
|------|--------|------|-------|
| Fix DMARC placeholder | Gandi DNS | **NOW** (pre-migration) | Admin |
| Retrieve DKIM key | Google Admin Console | Before DNS Sprint 1 | Admin |
| Lower TTLs to 300s | Gandi DNS | 48h before cutover | Admin |
| Update nameservers | Gandi registrar | Sprint 2 cutover | Admin |
| Upload DS record | Gandi registrar | Sprint 3 DNSSEC | Admin |
| Resolve apiologydao dual-assignment | Vercel dashboard | Before cutover | Admin |

## 9. Success Definition

This cycle is complete when:

1. `terraform plan` on freeside: imported stateful resources show 0 changes; new resources show creates only (no destroys/replaces); existing ECS/ALB/SG show only permitted SG-rule additions
2. `deploy-ring.sh --ring armitage --services all` succeeds with health gates (3/3 services healthy)
3. `staging-wiring-test.sh` passes all 10 connectivity paths (including ECS Exec smoke test prerequisite)
4. `terraform apply` in `dns/` creates a Route 53 zone for `0xhoneyjar.xyz` with functional equivalence to Gandi (SOA/NS differences expected; DMARC uses corrected value as source of truth)
5. `dns-pre-migration.sh` confirms readiness for cutover (functional-equivalence diff with documented allowlist)
6. `dns-drift-check.yml` workflow runs nightly and catches unmanaged changes

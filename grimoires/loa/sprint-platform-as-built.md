# Sprint Plan: World Container Hosting

> **Cycle**: cycle-048
> **PRD**: `grimoires/loa/prd.md` (World Container Hosting)
> **SDD**: Terraform module design (architect output)
> **Sprints**: 2 (sprint-1: Foundation + First World, sprint-2: CI + Remaining Worlds)
> **Estimated**: 2-3 days total

---

## Sprint 1: Foundation + First World (rektdrop)

**Goal**: Terraform `world` module exists and rektdrop is live at `rektdrop.0xhoneyjar.xyz` on staging.

### Task 1.1: Create World Module Structure

**Files**: `infrastructure/terraform/modules/world/{main,variables,outputs}.tf`

Module directory with all inputs/outputs defined. First Terraform module in the project.

**AC**: Valid variable and output definitions, `terraform validate` passes.

### Task 1.2: Module — ECR Repository

**File**: `modules/world/ecr.tf`

Repository `${var.name_prefix}-world-${var.name}` with lifecycle policy (keep last 5 images). Pattern: `ecs-finn.tf:28-78`.

### Task 1.3: Module — ECS Task Definition + Service

**File**: `modules/world/ecs.tf`

Task def: 256 CPU/512 MB, EFS volume at `/data`, env vars (`DATABASE_PATH`, `AI_GATEWAY_URL`, `PORT`), container port 3000.

Service: Fargate Spot (weight 100) with FARGATE fallback (weight 1). `min_healthy=0`, `max=100` (stop-then-start). Circuit breaker with rollback. Health check grace 60s.

### Task 1.4: Module — ALB Target Group + Listener Rule

**File**: `modules/world/alb.tf`

Target group port 3000. Listener rule: host `${name}.0xhoneyjar.xyz`, priority from `md5(name)` hash (range 300-499). Pattern: `ecs-dixie.tf:539-585`.

### Task 1.5: Module — EFS Access Point

**File**: `modules/world/efs.tf`

Access point path `/worlds/${name}/`, POSIX UID/GID 1000, permissions 755. Pattern: `nats.tf:253-273`.

### Task 1.6: Module — IAM Roles (execution + task + CI)

**File**: `modules/world/iam.tf`

Execution role: ECS + Secrets Manager + KMS. Task role: EFS mount (scoped to access point ARN) + CloudWatch + ECS Exec. CI role: OIDC trust for exact repo+branch, ECR push + ECS update-service only.

### Task 1.7: Module — Security Group + Logs

**Files**: `modules/world/security.tf`, `modules/world/logs.tf`

SG: ingress 3000 from ALB, egress 443/3000/2049. Log group: `/ecs/${prefix}/worlds/${name}`, 30 day retention.

### Task 1.8: Shared Resources — World EFS + ACM Wildcard

**Files**: `efs-worlds.tf`, `acm-worlds.tf`

New EFS file system (encrypted, elastic throughput) with mount targets + SG. Wildcard ACM cert `*.0xhoneyjar.xyz` attached to ALB via `aws_lb_listener_certificate`.

### Task 1.9: Deploy First World — rektdrop

**File**: `worlds/rektdrop.tf`

Module invocation. `terraform apply` on staging. Push test image. Verify ALB routing works.

### Task 1.10: DNS — World Records

**File**: `dns/honeyjar-xyz-worlds.tf`

A-alias records for `rektdrop.0xhoneyjar.xyz` → ALB. ACM validation CNAME. Apply dns root.

**AC**: `dig rektdrop.0xhoneyjar.xyz` returns ALB. HTTPS with wildcard cert works.

---

## Sprint 2: CI + Remaining Worlds + Production

**Goal**: All 3 worlds on production with automated deploys. Railway cancelled.

### Task 2.1: Deploy Workflow Template

**File**: `ci-templates/world-deploy.yml`

GitHub Actions: OIDC → ECR build+push → ECS force-deploy → wait stability.

### Task 2.2: Wire rektdrop CI

Copy workflow, set secret, verify push→deploy works.

### Task 2.3: Add mibera + aphive Worlds

`worlds/mibera.tf`, `worlds/aphive.tf`. Same pattern. DNS records.

### Task 2.4: Wire Finn AI Gateway

`AI_GATEWAY_URL` env var + per-world JWT tokens in Secrets Manager. Verify inference call.

### Task 2.5: SQLite Persistence Verification

Write data → redeploy → verify data survives. Confirm single-task during deploy.

### Task 2.6: Production Deployment

Apply all terraform to production. Push images. Verify all 3 worlds at `*.0xhoneyjar.xyz`.

### Task 2.7: Cancel Railway

Cancel subscriptions. Update docs. $15/mo saved.

---

## Success Metrics

- [ ] 3 worlds running on Freeside (staging + production)
- [ ] `git push` → live in <10 minutes
- [ ] SQLite persists across deployments
- [ ] Railway cancelled ($15/mo saved)
- [ ] Per-world cost <$5/mo (verified via Cost Explorer)

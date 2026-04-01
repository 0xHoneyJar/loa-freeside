# PRD: World Container Hosting — Sovereign Stack Platform

> **Cycle**: cycle-048
> **Codename**: World Hosting
> **Status**: DRAFT
> **Created**: 2026-04-01
> **Issue**: [#153](https://github.com/0xHoneyJar/loa-freeside/issues/153)

## 1. Problem Statement

The org pays $5/mo per product world on Railway ($15/mo for 3, growing to $50/mo for 10+). Meanwhile, Freeside's ECS cluster has 4000 vCPU of capacity, an ALB, NAT, DNS, and EFS — all already paid for. Each additional world on Railway is pure waste when the shared infrastructure exists.

Additionally, each world manages its own AI API keys with no centralized billing, no budget enforcement, and no model routing. A bug in any world could burn through an entire API key with no circuit breaker.

**Why now?** The org is running out of funds. Every dollar saved on infrastructure extends runway. Moving 3 worlds off Railway saves $15/mo immediately and establishes the pattern for 10+ worlds at ~$10/mo total vs $50/mo on Railway.

> Sources: issue-153 body, Phase 1 interview (urgency confirmation)

## 2. Goals & Success Metrics

| ID | Goal | Metric | Target |
|----|------|--------|--------|
| G-1 | Eliminate Railway spend | Railway bill | $0/mo (all worlds on Freeside) |
| G-2 | Near-zero marginal cost per world | AWS cost per additional world | <$3/mo (Fargate Spot 256 CPU) |
| G-3 | Centralized AI billing | Worlds using Finn gateway | 3/3 first-wave worlds |
| G-4 | Deploy in minutes, not hours | Time from git push to live | <10 minutes |
| G-5 | One-command world provisioning | Steps to add a new world | 1 Terraform file + 1 CI workflow |
| G-6 | SQLite persistence across deploys | Data survives redeployment | 100% (EFS-backed) |
| G-7 | Subdomain routing | World reachable at {name}.0xhoneyjar.xyz | Automatic via ALB rule |

> Sources: issue-153 body (cost model), Phase 1 interview (urgency)

## 3. Users & Stakeholders

| Persona | Context | Needs |
|---------|---------|-------|
| **Internal Developer** | Builds worlds for THJ products (rektdrop, mibera) | Push code, see it live. No infra ops. |
| **External Builder** | Partners like El Capitan (aphive) | Deploy their world on THJ infra with minimal friction |
| **Platform Engineer** | Manages Freeside infrastructure | Add worlds without manual ECS/ALB/DNS plumbing |
| **Finance** | Org treasury management | Predictable, low infrastructure costs with per-world visibility |

> Sources: issue-153 body (personas described inline)

## 4. Functional Requirements

### FR-1: World Hosting (Fargate + EFS)

Each world runs as a Fargate task on the existing ECS cluster:

| Property | Value | Rationale |
|----------|-------|-----------|
| CPU | 256 units (0.25 vCPU) | SvelteKit apps are lightweight |
| Memory | 512 MB | Sufficient for Node.js + SQLite |
| Launch type | Fargate Spot | Up to 70% cheaper than on-demand |
| Port | 3000 | SvelteKit default |
| Storage | EFS access point per world | Persistent SQLite, survives redeployment |
| Health check | HTTP GET / on port 3000 | Standard SvelteKit health |
| Desired count | 1 | Single instance per world (stateful SQLite) |
| Deployment min healthy % | 0 | Stop-then-start for singleton (no concurrent tasks sharing SQLite) |
| Deployment max % | 100 | Only one task runs at a time |
| Health check grace period | 60s | Allow time for SvelteKit cold start |

**EFS Configuration**:
- One EFS access point per world (path: `/worlds/{name}/`)
- EFS IAM authorization enabled (`iam = ENABLED`) — access point enforced
- Each task role scoped to only its own access point (resource-level IAM)
- Mounted at `/data` in the container
- SQLite database at `/data/{name}.db`
- World template reads `DATABASE_PATH` env var

**SQLite Safety on EFS**:
- Required PRAGMA: `journal_mode=WAL`, `synchronous=NORMAL`, `busy_timeout=5000`
- Single writer process enforced by ECS deployment config (min healthy 0%, max 100%)
- No concurrent task overlap during deployments — stop-then-start pattern
- [FUTURE] AWS Backup for EFS snapshots (corruption recovery)
- **Known limitation**: EFS adds ~1-5ms latency per fsync vs local disk. Acceptable for <100 req/day SvelteKit apps. Load test before onboarding high-traffic worlds.
- **Performance gate**: world template must pass a basic SQLite read/write benchmark on EFS before production onboarding

**Acceptance Criteria**:
- [ ] World container starts and serves HTTP on port 3000
- [ ] SQLite file at `/data/{name}.db` persists across task restarts
- [ ] Fargate Spot used (with on-demand fallback via capacity provider)
- [ ] Container logs visible in CloudWatch at `/ecs/arrakis-{env}/worlds/{name}`

> Sources: issue-153 body (world definition), Phase 1 Q2 (EFS recommendation)

### FR-2: Subdomain Routing (ALB + DNS)

Each world gets a subdomain routed via the existing ALB:

- DNS: `{name}.0xhoneyjar.xyz` → CNAME to ALB (wildcard or per-world)
- ALB: Host-based listener rule → world's target group
- TLS: Wildcard ACM cert for `*.0xhoneyjar.xyz` — one cert for all worlds

**Priority allocation**: Each world module computes its ALB rule priority deterministically from the world name (e.g., `300 + crc32(name) % 200`). The module validates no collision with existing rules at plan time. Range 300-499 reserved for worlds; existing services use <300.

**Implementation pattern** (follows existing Dixie pattern):
```hcl
resource "aws_lb_listener_rule" "world_{name}" {
  listener_arn = aws_lb_listener.https.arn
  priority     = local.world_priority  # Deterministic from name hash
  condition { host_header { values = ["{name}.0xhoneyjar.xyz"] } }
  action { type = "forward"; target_group_arn = aws_lb_target_group.world_{name}.arn }
}
```

**ACM**: Request a wildcard cert for `*.0xhoneyjar.xyz` — eliminates per-world cert management.

**Acceptance Criteria**:
- [ ] `{name}.0xhoneyjar.xyz` resolves and routes to the correct world
- [ ] HTTPS works with valid certificate
- [ ] Adding a new subdomain requires only Terraform, not manual DNS

> Sources: issue-153 body (routing requirement), existing ALB config (Dixie pattern)

### FR-3: AI Gateway via Finn

Worlds call Finn for AI instead of direct Anthropic/OpenAI:

```
POST http://finn.arrakis-{env}.local:3000/api/v1/invoke
Authorization: Bearer <jwt-from-freeside>
{ "agent": "oracle", "prompt": "..." }
```

**Configuration per world**:
```
AI_GATEWAY_URL=http://finn.arrakis-{env}.local:3000
```

Finn provides: model routing (5 pools), budget enforcement (micro-USD), session management, BYOK support. Worlds get this for free by changing one URL.

**S2S Auth**:
- Token type: long-lived per-world token stored in Secrets Manager (rotated quarterly)
- Required JWT claims: `world_id` (world name), `env` (staging/production), `aud: "finn-internal"`, `exp` (90 days)
- Finn validates via JWKS at Freeside's `/.well-known/jwks.json` endpoint
- Per-world budget enforcement: Finn tracks spend by `world_id` claim
- Intra-VPC traffic: HTTP (no TLS) — accepted risk for internal Cloud Map DNS. [FUTURE] mTLS when external builders onboard.

**Acceptance Criteria**:
- [ ] World can call Finn via Cloud Map DNS (zero internet egress)
- [ ] JWT auth works with `world_id` claim (Freeside signs, Finn validates)
- [ ] Model routing returns responses from configured pool
- [ ] Budget enforcement prevents runaway spend (per-world limit)

> Sources: issue-153 body (AI gateway requirement), issue-153 comment (readiness assessment)

### FR-4: Deploy Pipeline (GitHub Actions → ECR → ECS)

Each world repo gets a deploy workflow following the Finn/Dixie CI pattern:

```yaml
# .github/workflows/deploy.yml
name: Deploy World
on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  deploy:
    - Checkout
    - Configure AWS (OIDC role)
    - Build Docker image
    - Push to ECR
    - Force new ECS deployment
    - Wait for stability
```

**Per-world resources** (created during provisioning):
- ECR repository: `arrakis-{env}-world-{name}`
- OIDC IAM role: `arrakis-{env}-world-{name}-ci-deploy`
  - Trust policy: OIDC-only (no static AWS keys)
  - Subject condition: `repo:0xHoneyJar/{repo}:ref:refs/heads/main` (exact repo + branch)
  - Audience: `sts.amazonaws.com`
  - Least-privilege: ECR push + ECS update-service only for this world's resources
- GitHub secret: `AWS_DEPLOY_ROLE_ARN` (non-sensitive — the OIDC trust policy is the security boundary, not the ARN)

**Acceptance Criteria**:
- [ ] `git push` to main triggers build + deploy
- [ ] Manual `workflow_dispatch` also works
- [ ] New image visible in ECR within 5 minutes
- [ ] ECS service updates within 10 minutes of push

> Sources: issue-153 body (deploy pipeline), existing CI patterns (Finn deploy-staging.yml, Dixie deploy-staging.yml)

### FR-5: World Provisioning (Terraform Module)

Adding a new world = one Terraform file:

```hcl
# infrastructure/terraform/worlds/aphive.tf
module "world_aphive" {
  source = "../modules/world"

  name        = "aphive"
  repo        = "0xHoneyJar/aphive"
  cpu         = 256
  memory      = 512
  environment = var.environment

  # Secrets (from SSM or Secrets Manager)
  secrets = {
    DATABASE_PATH = "/data/aphive.db"
    AI_GATEWAY_URL = "http://finn.${local.name_prefix}.local:3000"
  }

  env_vars = {
    PUBLIC_CHAIN_ID = "80094"
    PUBLIC_RPC_URL  = "https://rpc.berachain.com"
  }
}
```

**The `world` module creates**:
- ECS task definition
- ECS service (Fargate Spot)
- ECR repository
- Target group + ALB listener rule
- EFS access point
- CloudWatch log group
- OIDC IAM role for CI
- Route53 CNAME record (if not using wildcard)

**Acceptance Criteria**:
- [ ] Adding `worlds/{name}.tf` and running `terraform apply` creates all resources
- [ ] Removing the file and applying destroys all resources cleanly
- [ ] Module is reusable across staging and production

> Sources: issue-153 body (provisioning requirement), Phase 1 Q4 (Terraform module recommendation)

## 5. Technical & Non-Functional Requirements

### NFR-1: Cost Efficiency

**Fargate pricing (us-east-1)**: $0.04048/vCPU-hr + $0.004445/GB-hr.
730 hours/month. Spot discount: 50-70% (variable, not guaranteed).

| Resource | On-demand | Fargate Spot (est 60% discount) | Notes |
|----------|-----------|----------------------------------|-------|
| Compute (0.25 vCPU) | $7.39/mo | ~$2.96/mo | 730h × $0.04048 × 0.25 = $7.39 |
| Memory (512 MB) | $1.62/mo | ~$0.65/mo | 730h × $0.004445 × 0.5 = $1.62 |
| EFS storage | $0.10/mo | $0.10/mo | 100MB SQLite |
| ECR storage | $0.10/mo | $0.10/mo | Image layers shared |
| ALB rule | $0 | $0 | Included in existing ALB |
| DNS | $0 | $0 | Included in existing Route53 zone |
| Logs | $0.50/mo | $0.50/mo | CloudWatch ingestion |
| **Total per world** | **$9.71/mo** | **~$4.31/mo** | **vs $5/mo on Railway** |

**Note**: Spot savings are estimates — actual discount varies. With Spot, worlds cost slightly less than Railway. The real savings come from shared infrastructure (ALB, NAT, DNS already paid). At 10+ worlds, the per-world overhead is amortized further.

**Validation**: After migrating 3 worlds, verify actual costs via AWS Cost Explorer with per-world tags (tag: `World={name}`). Adjust Spot strategy if savings are insufficient.

### NFR-2: Security

- Container-level isolation (same VPC, separate task definitions)
- Per-world secrets (env vars from Secrets Manager, not shared)
- **EFS isolation** (primary boundary): EFS IAM authorization enabled + access point enforcement. Each world's task role has resource-level permissions scoped to only its own access point ARN. POSIX UID/GID is defense-in-depth only, not the primary isolation mechanism.
- Finn JWT auth with `world_id` claim prevents unauthorized AI usage and cross-world budget spend
- **External builder gate**: Per-world security groups REQUIRED before onboarding external builders. MVP is internal-only (THJ repos). External onboarding blocked until SG isolation is implemented and verified.

### NFR-3: Availability

- Fargate Spot with on-demand capacity provider fallback
- ECS circuit breaker with rollback on failed deployments
- Health check: 30s interval, 3 failures before replacement
- SQLite on EFS: data survives task replacement

### NFR-4: Observability

- CloudWatch logs per world: `/ecs/arrakis-{env}/worlds/{name}`
- ECS service metrics (CPU, memory, task count)
- [FUTURE] Per-world cost tagging for AWS Cost Explorer

> Sources: issue-153 body (cost model, security questions), Phase 1 answers

## 6. Scope & Prioritization

### MVP (This Cycle)

| # | Deliverable | Effort |
|---|-------------|--------|
| 1 | Terraform `world` module | 1 day |
| 2 | First world deployed (rektdrop) | 2 hours |
| 3 | Wildcard ACM cert for `*.0xhoneyjar.xyz` | 30 min |
| 4 | Deploy pipeline template | 2 hours |
| 5 | Second + third worlds (mibera, aphive) | 1 hour each |
| 6 | Finn AI gateway wiring | 2 hours |

**Estimated**: 2-3 days of focused work.

### Post-MVP

- Scale-to-zero with Lambda or App Runner (when cost justifies complexity)
- Per-world budget dashboards
- External builder self-service provisioning API
- Automated world health monitoring
- Per-world security groups for external isolation

### Out of Scope

- Custom domains per world (all use `*.0xhoneyjar.xyz` for now)
- Multi-region deployment
- Dedicated databases per world (SQLite on EFS is sufficient)
- Auto-scaling (single instance per world is sufficient at current traffic)

> Sources: issue-153 body (scope), Phase 1 interview (urgency = MVP focus)

## 7. Risks & Dependencies

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Fargate Spot interruption | Medium | Low | On-demand fallback via capacity provider strategy |
| EFS latency for SQLite | Low | Medium | SQLite WAL mode + EFS throughput mode |
| Wildcard cert CAA issues | Low | Medium | CAA records already allow amazon.com |
| World container crash loop | Low | Medium | ECS circuit breaker + rollback |
| Railway migration downtime | Low | High | Deploy on Freeside first, verify, then update DNS |

**Dependencies**:
- vCPU quota: 4000 (approved — no blocker)
- EFS: already provisioned on both clusters
- ALB: already running with host-based routing
- DNS: Route53 zone active with 19 records
- Finn: running on both staging and production

> Sources: infrastructure audit (this session), issue-153 body (risks section)

## 8. Migration Plan

```
1. Deploy world module + rektdrop on staging    → verify
2. Deploy on production                         → verify at rektdrop.0xhoneyjar.xyz
3. Update rektdrop DNS from Railway to Freeside → live cutover
4. Repeat for mibera, aphive
5. Cancel Railway
```

Each world cutover is independently reversible — just point DNS back to Railway.

> Sources: issue-153 body (migration), Phase 1 interview (urgency)

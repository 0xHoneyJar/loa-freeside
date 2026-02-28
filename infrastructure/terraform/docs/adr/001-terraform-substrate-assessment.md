# ADR-001: Terraform Substrate Assessment

> **Status**: Proposed (awaiting validation during agent economy implementation)
> **Date**: 2026-02-28
> **Source**: Bridgebuilder deep review, PR #109 (Question 1)
> **Deciders**: Infrastructure team

## Context

PR #109 (cycle-046, Armitage Platform) consolidates three competing Terraform configurations (Freeside, Finn, Dixie) into a single canonical root and migrates DNS authority for `0xhoneyjar.xyz` from Gandi to Route 53 under IaC. This establishes Terraform as the infrastructure management tool for the entire platform.

The agent economy roadmap (loa-finn #31 Hounfour RFC, loa-finn #80 Conway research) envisions 100K+ finnNFT agents. At that scale, the platform may need dynamic infrastructure:

- **Per-agent DNS routing**: Each agent may need distinct DNS records, x402 payment endpoints, and JWKS discovery URLs
- **Ephemeral inference endpoints**: Agents may spin up/down inference capacity based on economic demand
- **Real-time scaling**: Infrastructure changes driven by economic signals (budget utilization, settlement queues) rather than human operators

Terraform's plan/apply cycle (minutes) is well-suited for zone-level and cluster-level resources that change infrequently. It is poorly suited for resources that are lifecycle-bound to individual agents (seconds-to-minutes lifecycle).

## Decision

**Terraform manages the static substrate. Dynamic per-agent resources are managed by application-layer APIs operating alongside Terraform, not replacing it.**

Specifically:

| Layer | Owner | Examples | Change Frequency |
|-------|-------|----------|-----------------|
| Static substrate | Terraform | ECS services, security groups, DNS zones, state backends, KMS keys, S3 buckets, DynamoDB tables | Days to weeks |
| Zone-level DNS | Terraform | CAA, DNSSEC, MX, SPF, DKIM, DMARC, wildcard CNAME | Weeks to months |
| Per-agent DNS | Application API (Route 53) | `agent-42.agents.0xhoneyjar.xyz` A/CNAME records | Seconds (agent mint/burn) |
| Per-agent compute | Application API (ECS/Lambda) | Inference task definitions, scaling events | Minutes (demand-driven) |

The boundary principle: if a resource's lifecycle is bound to an agent's lifecycle, it belongs to the application layer. If a resource's lifecycle is bound to the platform's lifecycle, it belongs to Terraform.

## Consequences

### Positive

- Terraform state remains manageable (hundreds of resources, not hundreds of thousands)
- Plan/apply review cycle provides human oversight for critical infrastructure changes
- Static substrate benefits from Terraform's drift detection and state locking
- Application-layer APIs can respond to economic signals in real-time

### Negative

- Per-agent resources are not in Terraform state, so Terraform-based drift detection cannot see them
- Two operational models (Terraform CLI + application API) increase cognitive overhead
- Application layer must implement its own reconciliation for per-agent resources (see ADR-003 § Drift Detection)

### Neutral

- CI/CD pipeline complexity unchanged — Terraform CI handles substrate, application CI handles deployments
- Monitoring strategy unchanged — CloudWatch alarms cover both layers

## Alternatives Considered

### Full Pulumi Migration

**Rejected.** Pulumi supports imperative resource management which would handle dynamic resources better. However, migrating the existing Terraform state (40+ resources across compute and DNS roots) introduces significant risk for marginal benefit. The static substrate works well with Terraform.

### AWS CDK

**Rejected.** CDK generates CloudFormation, which has the same plan/apply characteristics as Terraform. Does not solve the dynamic resource management problem.

### Custom Kubernetes Operators

**Deferred.** The Kubernetes Operators pattern (reconciliation loop, desired-state declaration) is architecturally well-suited for dynamic per-agent resources. However, the platform does not currently run Kubernetes. If EKS is adopted in a future cycle, this becomes a strong candidate for the dynamic layer.

### HashiCorp Consul-Terraform-Sync (CTS)

**Noted as pattern inspiration.** CTS bridges Consul service discovery with Terraform execution for infrastructure that is too dynamic for manual plan/apply but too important for untracked changes. The two-tier DNS pattern in ADR-003 follows a similar philosophy.

## References

- PR #109: Armitage Platform — Terraform Consolidation & DNS Authority
- SDD §2.1: Two-Root Terraform Layout
- ADR-003: Agent DNS Programmatic Management (two-tier DNS pattern)
- `docs/conservation-invariants.md`: Three-layer invariant mapping
- loa-finn #31: Hounfour RFC (agent economy vision)
- loa-finn #80: Conway research (organizational structure)

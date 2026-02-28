# ADR-003: Agent DNS Programmatic Management

> **Status**: Proposed (awaiting validation during agent economy implementation)
> **Date**: 2026-02-28
> **Source**: Bridgebuilder deep review, PR #109 (SPECULATION-2, Question 2)
> **Deciders**: Infrastructure team, Agent Platform team

## Context

The DNS root (`infrastructure/terraform/dns/`) manages `0xhoneyjar.xyz` zone records declaratively via Terraform. This works well for zone-level resources (CAA, DNSSEC, MX, SPF, wildcard CNAME) that change infrequently.

The agent economy roadmap envisions 100K+ agents, each potentially needing:
- A distinct DNS record (`agent-42.agents.0xhoneyjar.xyz`)
- x402 payment endpoint routing
- JWKS discovery URL

Managing per-agent DNS records in Terraform would mean:
- Terraform state grows to 100K+ resources (plan/apply becomes impractically slow)
- Every agent mint/burn requires a Terraform apply (minutes vs seconds)
- State file size becomes a operational bottleneck
- CI serialization (IMP-004) creates a deployment queue for agent operations

## Decision

**Two-tier DNS management: Terraform for zone-level, application API for per-agent.**

### Tier 1 — Terraform (Declarative)

Manages zone-level resources that change infrequently and benefit from plan/apply review:

| Resource | Type | Purpose |
|----------|------|---------|
| `*.agents.0xhoneyjar.xyz` | CNAME | Wildcard fallback to Vercel (RFC 4592) |
| `agents.0xhoneyjar.xyz` | A | Bare subdomain to Vercel anycast |
| `_acme-challenge.agents.*` | NS | TLS certificate delegation |
| Zone-level: CAA, DNSSEC, MX, SPF | Various | Domain security and email |

### Tier 2 — Application API (Programmatic)

Manages per-agent DNS records via Route 53 API directly:

| Resource | Type | Purpose |
|----------|------|---------|
| `<agent-slug>.agents.0xhoneyjar.xyz` | A or CNAME | Per-agent endpoint |

These records are lifecycle-bound to agent minting/burning and are too numerous/dynamic for Terraform state.

### Coexistence — RFC 4592 Wildcard Fallback

Per RFC 4592, DNS wildcard resolution works as follows:
- A query for `agent-42.agents.0xhoneyjar.xyz` first checks for an exact match
- If an API-managed A/CNAME record exists for `agent-42`, it is returned (exact match takes precedence)
- If no exact match exists, the Terraform-managed wildcard `*.agents.0xhoneyjar.xyz` CNAME is returned as fallback

This means:
- **New agents** immediately work via the wildcard fallback (routes to Vercel)
- **Configured agents** get per-agent DNS records via the API (routes to agent endpoint)
- **Burned agents** have their DNS record deleted; subsequent queries fall back to wildcard

The wildcard CNAME is a conservation invariant — it must not be deleted because it is the safety net for all agents without specific records. It has `lifecycle { prevent_destroy = true }` in Terraform.

### Agent DNS Lifecycle

```
Agent minted → API creates DNS record → Agent running
                                          ↓
                                      API updates on migration
                                          ↓
Agent burned → API deletes DNS record → Wildcard fallback resumes
```

### State Tracking

API-managed records are tracked in the application database (agent table), not Terraform state. The agent platform service is the source of truth for per-agent DNS records.

## Drift Detection

### Current State (Sprint 5, Task 5.1)

The existing drift detection uses `terraform plan` in `.github/workflows/dns-drift-check.yml`. This detects drift in Terraform-managed records only — it runs `terraform plan` against the DNS root and flags any differences between state and actual Route 53 configuration.

### Two-Tier Boundary

When the agent platform creates per-agent DNS records via Route 53 API, those records are **invisible to the existing drift check**. This is by design:

- Per-agent records are not in Terraform state
- `terraform plan` only compares state vs reality for resources it manages
- API-managed records exist in the same Route 53 zone but are outside Terraform's purview

The existing `dns-drift-check.yml` workflow **requires no changes** — Terraform-plan-based drift detection inherently ignores non-Terraform records.

### Future: Agent Platform DNS Health Check

When the agent platform is built, it should include its own health check that verifies per-agent DNS records match application database state. This is a requirement for the agent platform cycle, not this cycle.

The agent platform DNS health check should:
1. Query the application database for all active agents with DNS records
2. Verify each expected DNS record exists in Route 53
3. Verify no orphaned DNS records exist (records for burned agents)
4. Report drift metrics to CloudWatch

This is architecturally separate from Terraform drift detection — two different systems checking two different sources of truth.

## Consequences

### Positive

- Terraform state remains manageable (tens of zone-level records, not thousands of per-agent records)
- Agent operations (mint/burn) complete in seconds (API call) not minutes (Terraform plan/apply)
- Wildcard fallback provides zero-configuration agent DNS
- Zone-level security (CAA, DNSSEC) remains under Terraform's plan/apply review cycle

### Negative

- Two operational models for the same Route 53 zone
- Per-agent DNS records are not visible in Terraform state (intentional but requires awareness)
- Agent platform must implement its own DNS reconciliation
- Risk of orphaned DNS records if agent burn fails to delete the record

### Neutral

- Route 53 API rate limits (5 requests/second for ChangeResourceRecordSets) may require batching for large-scale operations
- DNS propagation delay (TTL) affects both tiers equally

## Alternatives Considered

### All Records in Terraform

**Rejected.** State file grows linearly with agent count. Plan/apply time becomes impractical at 10K+ records. Every agent operation requires CI pipeline execution.

### Separate Route 53 Zone for Agents

**Considered but deferred.** A dedicated zone (`agents.0xhoneyjar.xyz` with its own NS delegation) would provide cleaner separation. However, the wildcard fallback pattern works within the existing zone and avoids additional DNS delegation complexity. Can be revisited if API rate limits become an issue.

### HashiCorp CTS (Consul-Terraform-Sync)

**Noted as pattern inspiration.** CTS bridges service discovery with Terraform execution for infrastructure too dynamic for manual plan/apply but too important for untracked changes. The two-tier pattern follows a similar philosophy — zone-level resources get Terraform's review cycle, per-agent resources get API responsiveness.

## References

- PR #109: Armitage Platform — Terraform Consolidation & DNS Authority
- SDD §7.6: `dns/honeyjar-xyz-agents.tf`
- RFC 4592: The Role of Wildcards in the Domain Name System
- ADR-001: Terraform substrate assessment (static vs dynamic boundary)
- `dns/honeyjar-xyz-agents.tf`: Wildcard CNAME + bare A records
- `.github/workflows/dns-drift-check.yml`: Existing Terraform-based drift detection

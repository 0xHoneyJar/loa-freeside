# ADR-002: Governance-Infrastructure Integration Surface

> **Status**: Deferred (captured for architectural awareness)
> **Date**: 2026-02-28
> **Source**: Bridgebuilder deep review, PR #109 (SPECULATION-1, Question 3)
> **Deciders**: Infrastructure team, Governance team

## Context

Infrastructure operations are currently gated by technical controls:
- CI permissions (GitHub Actions IAM role)
- Plan guards (`tf-plan-guard.sh` blocks destroy/replace on protected resources)
- Peer review (pull request approval)

The agent economy roadmap introduces economic commitments: budget reservations, in-flight x402 settlements, and reconciliation state. When billing is live, infrastructure changes carry economic risk — a failed deploy during active settlements could strand funds in intermediate states.

The governance layer (loa-hounfour) provides primitives for community-driven decision-making: conviction voting, reputation gates, three-witness quorum, and `ResourceGovernor<T>` wrappers. These are currently used for protocol governance decisions, not infrastructure operations.

## Decision

**Deferred.** Governance-gated infrastructure operations are not needed until billing is live and agent count exceeds 1000. This ADR captures the integration surface for architectural awareness.

### Future Integration Pattern

When economic commitments are at risk, infrastructure operations may warrant governance primitives:

| Operation | Current Gate | Future Gate | Trigger Condition |
|-----------|-------------|-------------|-------------------|
| DNS root changes | CI + peer review | Reputation-gated approval | Agent DNS affects agent reachability |
| DNSSEC enablement | CI + peer review | Quorum decision | Affects trust chain for all agents |
| Production deploys | Health gate + CI | Conviction-weighted approval | High budget-utilization periods |
| State backend migration | Manual + backup | Three-witness quorum | Affects all infrastructure state |

### Integration Mechanism

`ResourceGovernor<T>` from loa-hounfour could wrap Terraform operations:

- `ResourceGovernor<TerraformPlan>` — governance review before `terraform apply`
- `ResourceGovernor<DNSRecord>` — governance review before agent DNS mutation
- `ResourceGovernor<DeployRing>` — governance review before production ring deployment

The integration point is the deploy pipeline (`deploy-ring.sh`), where a pre-deploy governance check would query the governance layer:

```
deploy-ring.sh → check_billing_status() → [future] governance_gate() → proceed/block
```

The `check_billing_status()` function (Sprint 7, Task 7.3) is the first step in this direction — it provides operator awareness without blocking.

## Consequences

### If Implemented

- Infrastructure operations gain economic-aware governance gates
- Deploy latency increases by governance resolution time (seconds to hours depending on mechanism)
- Operational complexity increases (governance layer must be healthy for deploys)
- Risk of governance deadlock blocking critical deployments (requires override mechanism)

### If Not Implemented

- Infrastructure operations remain technically-gated only
- Economic risk during deploys is managed by operational procedures (deploy windows, settlement drain)
- Simpler operational model at the cost of less formal economic protection

## Timeline

| Milestone | Gate |
|-----------|------|
| Billing goes live | `check_billing_status()` advisory warnings |
| Agent count > 1000 | Evaluate governance integration ROI |
| First economic incident during deploy | Implement governance gates |

## References

- PR #109: Armitage Platform — Terraform Consolidation & DNS Authority
- `deploy-ring.sh`: `check_billing_status()` (Sprint 7, Task 7.3)
- loa-hounfour #22: Governance primitives (conviction voting, reputation gates)
- loa-hounfour #29: `ResourceGovernor<T>` pattern
- ADR-001: Terraform substrate assessment (static vs dynamic boundary)
- `docs/conservation-invariants.md`: Three-layer invariant mapping

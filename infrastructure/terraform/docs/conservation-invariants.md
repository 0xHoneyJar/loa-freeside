# Conservation Invariants — Three-Layer Pattern

> **Source**: Bridgebuilder deep review, PR #109 (REFRAME-2)
> **Principle**: Mutations must be auditable, reversible, and guarded by invariants — regardless of abstraction layer.

## Overview

The Arrakis system enforces conservation invariants at three abstraction layers. This is not coincidental — it reflects a design philosophy where every mutation is guarded, every state change is traceable, and every destructive operation requires explicit intent.

## Layer 1: Infrastructure (This Repository)

| Safeguard | Mechanism | Effect |
|-----------|-----------|--------|
| `lifecycle { prevent_destroy = true }` | Terraform lifecycle rule | Stateful resources (S3, KMS, DynamoDB, ElastiCache) cannot be destroyed without removing the rule first |
| `tf-plan-guard.sh` | CI gate script | Blocks `terraform apply` if plan contains replace/destroy on protected resource types |
| State backend isolation | Separate S3 keys per root | DNS state cannot be corrupted by compute operations and vice versa |
| `ignore_changes = [auth_token]` | Terraform lifecycle rule | Credentials managed out-of-band cannot be overwritten by Terraform apply |
| `ignore_changes = [value]` (SSM) | Terraform lifecycle rule | Application-managed values cannot be overwritten by infrastructure operations |

**Conservation statement**: The sum of stateful resources must never decrease without explicit lifecycle rule removal, plan guard override, and peer review.

## Layer 2: Application (Proof of Economic Life, PR #90)

| Invariant | Mechanism | Effect |
|-----------|-----------|--------|
| I-1: `committed + reserved + available = limit` | Redis atomic ops (MULTI/EXEC) | Budget sum is conserved across all state transitions |
| I-2: `SUM(lot_entries) = original_micro` | Postgres CHECK constraints | Lot decomposition preserves original amount |
| I-3: Redis.committed ≈ Postgres.usage_events | Guard sweep (reconciliation) | Cross-store consistency verified periodically |
| I-4: Every Redis mutation keyed by durable ID | Append-only ledger pattern | All mutations are traceable to their source |
| I-5: Budget monotonically decreasing during inference | Application logic + DB constraints | Credits can only be consumed, never created |

**Conservation statement**: `committed + reserved + available = limit` holds at every point in time, enforced by atomic operations and verified by reconciliation sweeps.

## Layer 3: Governance (loa-hounfour #22, #29)

| Safeguard | Mechanism | Effect |
|-----------|-----------|--------|
| Genesis constraints | Constitutional provenance tracking | Foundational rules cannot be modified without migration ceremony |
| Enacted constraints | Three-witness quorum | New rules require multi-party agreement |
| Chain-bound hash chains | Cryptographic audit trail | Every governance decision is tamper-evident |
| Conviction voting | Time-weighted preference aggregation | Resource allocation requires sustained community commitment |
| Reputation gates | Score-based access control | Governance actions require demonstrated track record |

**Conservation statement**: Every constraint has a provenance (genesis, enacted, or migrated) and every governance action is recorded in a tamper-evident chain.

## The Cross-Cutting Pattern

All three layers share a structural template:

```
BEFORE_MUTATION:
  1. Verify invariant holds (plan guard / guard sweep / quorum check)
  2. Record intent (plan output / usage event / governance proposal)

DURING_MUTATION:
  3. Execute atomically (terraform apply / Redis MULTI / chain append)

AFTER_MUTATION:
  4. Verify invariant still holds (post-apply plan / reconciliation / chain verification)
  5. Record outcome (state file / ledger entry / audit event)
```

This pattern is the system's immune system — it ensures that no layer can silently degrade without detection.

## References

- Infrastructure: `DEPLOYMENT.md` § Conservation Invariants
- Application: `packages/core/budget/` + PR #90
- Governance: `loa-hounfour` PRs #22, #29
- Bridgebuilder review: PR #109 comment (REFRAME-2)

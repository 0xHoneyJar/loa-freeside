# grimoires/freeside-platform/

**Domain**: platform · **Purpose**: cycle artifacts for the vertical-platform concern

This directory holds cycle artifacts (PRDs, SDDs, sprint plans, retrospectives) for **freeside the platform** — the vertical-SaaS substrate at `freeside.0xhoneyjar.xyz`:

- Discord gateway (Rust, `apps/gateway/`)
- Ingestor (`apps/ingestor/`)
- Worker (`apps/worker/`)
- Sietch theme (`themes/sietch/`)
- Score / ledger / conviction / billing
- Stripe / x402 payment surface
- Terraform / infrastructure
- gaib IaC CLI (`packages/cli/`)
- Core / adapters / sandbox / shared packages

## What does NOT live here

Network-domain cycle artifacts (BeaconV3, federation manifest, mcp-gateway, freeside-cli, freeside-registry) live in `grimoires/freeside-network/`. Mixing platform and network cycles in the same PR is **prohibited** per [ADR-007 §D-3](../../decisions/007-loa-freeside-absorption.md). Enforced by `.github/workflows/path-domain-check.yml`.

## Cycle entry format

When a platform-domain cycle ships:

```
grimoires/freeside-platform/
└── cycle-NNN-<slug>/
    ├── prd.md
    ├── sdd.md
    ├── sprint.md
    └── retrospective.md
```

The cycle's entry in `grimoires/loa/ledger.json` MUST include `"domain": "platform"`. CI rejects ledger entries missing the domain field (per `.github/workflows/ledger-domain-check.yml`).

## Beads issues

Beads issues touching platform-domain code MUST carry the `domain:platform` label. CI rejects untagged issues (per `.github/workflows/ledger-domain-check.yml`).

## Related

- [ADR-007 §D-1](../../decisions/007-loa-freeside-absorption.md) — workspace structure
- [ADR-007 §D-3](../../decisions/007-loa-freeside-absorption.md) — boundary rules + enforcement
- `grimoires/freeside-network/` — the sibling network-domain directory
- `grimoires/loa/ledger.json` — cycle ledger (carries `domain` field)

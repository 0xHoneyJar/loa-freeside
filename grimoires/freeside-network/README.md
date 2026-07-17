# grimoires/freeside-network/

**Domain**: network · **Purpose**: cycle artifacts for the ecosystem-registry concern

This directory holds cycle artifacts (PRDs, SDDs, sprint plans, retrospectives) for **freeside the network** — the ecosystem-parent surface for the `freeside-*` module network:

- BeaconV3 schema (`packages/beacon-schema/`)
- Module registry (`packages/freeside-registry/`)
- MCP federation gateway (`apps/mcp-gateway/`)
- Ecosystem CLI (`packages/freeside-cli/`)
- Federation manifest endpoint (`/federation.json`)
- L5 ambient agent hooks (operator-local, eventually org-wide)
- Honeycomb Tag composition validation

## What does NOT live here

Platform-domain cycle artifacts (Score, ledger, Discord gateway, sietch theme, terraform, gaib) live in `grimoires/freeside-platform/`. Mixing platform and network cycles in the same PR is **prohibited** per [ADR-007 §D-3](../../decisions/007-loa-freeside-absorption.md). Enforced by `.github/workflows/path-domain-check.yml`.

## Cycle entry format

When a network-domain cycle ships:

```
grimoires/freeside-network/
└── cycle-NNN-<slug>/
    ├── prd.md
    ├── sdd.md
    ├── sprint.md
    └── retrospective.md
```

The cycle's entry in `grimoires/loa/ledger.json` MUST include `"domain": "network"`. CI rejects ledger entries missing the domain field (per `.github/workflows/ledger-domain-check.yml`).

## Beads issues

Beads issues touching network-domain code MUST carry the `domain:network` label. CI rejects untagged issues (per `.github/workflows/ledger-domain-check.yml`).

## Cross-domain dependencies

Cross-domain `blocked-by` relationships in beads (a network issue blocked by a platform issue, or vice versa) are **prohibited**. If a real dependency exists, either:

1. Refactor to remove the cross-domain dependency (preferred — it's a smell)
2. Land the dependency through `shared/` scope first, then the dependent issues can both reference shared infrastructure

CI rejects cross-domain `blocked-by` dependencies.

## Related

- [ADR-007 §D-1](../../decisions/007-loa-freeside-absorption.md) — workspace structure
- [ADR-007 §D-3](../../decisions/007-loa-freeside-absorption.md) — boundary rules + enforcement
- [ADR-007 §D-4 + Appendix A](../../decisions/007-loa-freeside-absorption.md) — BeaconV3 schema
- [ADR-007 §D-5 + D-8](../../decisions/007-loa-freeside-absorption.md) — federation manifest + visibility
- [ADR-007 §D-7](../../decisions/007-loa-freeside-absorption.md) — L5 ambient experiment
- `grimoires/freeside-platform/` — the sibling platform-domain directory
- `grimoires/loa/ledger.json` — cycle ledger (carries `domain` field)
- [RFC #207](https://github.com/0xHoneyJar/loa-freeside/issues/207)

---
session: 4
date: 2026-05-26
type: kickoff
status: planned (dispatch in fresh session)
cycle_kind: cluster-meta (per ADR-009 §D-7)
mode: ARCH (Ostrom structural) + KRANZ (execution)
operator_construct_frame: gecko + construct-freeside
---

# Session 4 — Events Pillar v1 (cluster's first cross-cell events substrate)

## Scope

- Cluster's FIRST cross-cell events trace — sonar NFT mints (and ALL handlers later) publish ACVP-enveloped events on NATS JetStream; characters subscribes to MST-mint events and announces enriched in Discord
- 4 net-new builds: `@0xhoneyjar/events` npm package · sonar publish layer · characters NATS subscriber · operator-dash event-trace panel
- Substrate-clean from v1: full ACVP cycle-098 L1-L7 envelope (prev_hash + Ed25519 sig + JCS canonicalization) — pattern future cells inherit
- Mad-agent extension included: operator-dash event-trace panel (Sprint 4) — same shape as Soju-lens; observability is foundational

## Artifacts

- **Build doc** (source of truth): `grimoires/loa/specs/enhance-events-pillar-v1-nft-mints.md` (~360 lines)
- **TEND audit** (substrate baseline): `grimoires/freeside-network/cluster-2026-05-26-mint-announcement-tend/audit.md`
- **Sibling roadmap** (user-plane analog): `grimoires/loa/proposals/identity-api-sovereign-aggregator-substitution.md`
- **5 Loa-continuity memories** (`~/.claude/projects/.../memory/`):
  - `project_mst-naming-chain.md` · `project_sonar-is-pure-index.md` · `project_nats-deployed-but-unconsumed.md` · `project_token-entity-gap.md` · `project_acvp-events-pillar-positioning.md`

## Prior session

Cluster-meta cycle 2026-05-25/26: shipped the sovereign-aggregator-substitution roadmap (auth substrate, user-plane) — Soju now resolves through identity-api on Honey Road end-to-end. 8 PRs merged across 4 repos. This events-pillar cycle is the **service-plane sibling** — same doctrine (vendor → substrate → adoption), opposite plane.

## Decisions made (operator confirmed 2026-05-26)

- **NATS JetStream** is the canonical bus (verified `ecs-finn.tf` / `ecs-dixie.tf` NATS_URL); no RabbitMQ legacy buildout
- **Full ACVP envelope from v1** — substrate-clean, future cells inherit verifiability free
- **Publishing scope: universal** — ALL sonar handlers publish (NFT + non-NFT); pattern earned at maximum breadth
- **Display scope: MST-only for v1** — characters announcement enrichment scoped narrow; other classes are dormant subscribers until v2
- **Mad-agent extension: IN SCOPE** — operator-dash event-trace panel ships as Sprint 4
- **Library home**: `loa-freeside/packages/events/` (workspace npm, mirrors `packages/beacon-schema/`)
- **Sequence**: events pillar first, Stash bring-back after (separate cycle)
- **Dispatch**: NOT this session — fresh session via `/coord` (clipboard pointer prepared)

## Open questions for the fresh session

None blocking. /coord init can author PRD/SDD/sprint from the build doc + audit + memories.

## How to resume

In the fresh session:
1. Paste the clipboard pointer
2. Read the build doc + audit + sibling roadmap + ACVP vault doc (load order in the build doc)
3. `/coord init` to author the master coordinator at `~/bonfire/cluster-events-pillar-coordinator/`
4. Per-cell child cycle stubs land in loa-freeside, freeside-sonar, freeside-characters
5. Sprint 1 ships first (the library blocks Sprints 2-4)

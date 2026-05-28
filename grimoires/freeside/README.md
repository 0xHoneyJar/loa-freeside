# `grimoires/freeside/` — Cluster-Wide Operational Artifacts

> KRANZ + GECKO operational surface for cross-repo cluster work. The cluster's substrate-cutover runbooks, atlases (cluster maps), and doctrines (codified patterns) live here.

This directory is where the construct-freeside operational thinking persists across cycles. It is not a per-cycle scratchpad; it is the **load-bearing artifact** that future cycles read to inherit pattern + decision history.

## Directory structure

```
grimoires/freeside/
  cultivations/       — per-cutover runbooks; one file per Move; KRANZ 5-act discipline
  atlases/            — cluster maps; territorial intelligence; living documents (versioned)
  doctrines/          — codified patterns; reusable across cutovers
  briefs/             — exploratory thinking; pre-runbook surveys; operator-decision input
```

### `cultivations/` — Runbooks

Naming convention: `move-<N>-<repo>-<topic>-<date>.runbook.md`

Each runbook follows KRANZ 5-act structure:
1. **Coordinate** — read the room (telemetry, dependencies, audit findings)
2. **Mirror** — substrate move (the actual change; reversibility profile)
3. **Verify** — three-layer gate (smoke / parity / operator)
4. **Flip** — switch traffic (if applicable; many substrate-prep cutovers have no flip)
5. **Distill** — feed the construct (retro; doctrine emergence; lessons-learned)

Current cultivations:
- `move-1-honey-road-substrate-prep-2026-05-27.runbook.md` — Bearer pattern instantiation at mibera-honeyroad (PR #105)
- `move-3-sonar-token-entity-2026-05-27.runbook.md` — Per-token ownership index for Mibera handlers (PR #38; invariant survives Envio→Ponder port)
- `move-3b-inventory-api-flip-2026-05-27.runbook.md` — Consumer flip; gated on indexer-side write + re-index + parity
- `move-5-mibera-dimensions-substrate-prep-2026-05-28.runbook.md` — Bearer pattern adoption at mibera-dimensions (forward-track)

### `atlases/` — Cluster maps

Living documents that capture the cluster's territorial state. Versioned (`-v0.1.md`, `-v0.2.md`, etc.). The map is not the territory; atlases are best-effort approximations updated as reality teaches.

Current atlases:
- `world-atlas-v0.1.md` — Cluster worlds × auth state × user-databases × spine status (drafted post-GECKO patrols 2026-05-28)

### `doctrines/` — Codified patterns

Reusable patterns lifted from cycles. Cited by runbooks. When a runbook's pattern matures across 2-3 instantiations, it gets codified here.

Current doctrines:
- `bearer-pattern-cluster-auth-protocol.md` (v0.1) — How a honey-road-class consumer adopts identity-api as the spine without taking on cookie-domain coupling. Instantiated by Move 1; Move 5 is the first composition test.

## Persona context

This directory is owned by **KRANZ** (construct-freeside persona — cross-repo cutover lead) with operational input from **GECKO** (construct-gecko persona — ecosystem-floor reconnaissance). When a runbook is authored, KRANZ writes; when an atlas is updated, GECKO scans + KRANZ synthesizes.

The doctrine for what lives here vs `grimoires/loa/`:
- `grimoires/loa/` — Loa workflow artifacts (PRDs, SDDs, sprint plans, cycles)
- `grimoires/freeside/` — operational cutover artifacts (runbooks, atlases, doctrines)

They compose: a Loa cycle PRD names the strategic intent; a freeside cultivation runbook names the operational implementation; a freeside doctrine codifies the reusable pattern that emerges.

## How to extend

When a new cutover begins:
1. Author a runbook in `cultivations/` BEFORE Mirror act
2. Cite related atlases + doctrines in frontmatter
3. After cutover completes, distill — update atlas if territory shifted; consider doctrine candidacy if pattern is reusable
4. Update this README if directory structure changes

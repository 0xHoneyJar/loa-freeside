# tools/operator-dash/ — v0 spike (SUPERSEDED)

> ⚠ This is a **pre-bridgebuilder v0 spike**. v1 implementation lives at
> `apps/freeside-operator-dash/` (per
> [`grimoires/loa/proposals/freeside-operator-dash-kickoff.md`](../../grimoires/loa/proposals/freeside-operator-dash-kickoff.md)).
> Retained here as design-direction evidence — do NOT extend in place.

## Why it's here

Built 2026-05-25 as a "lightweight HTML site" prototype before the
ADR-009-grounded design surfaced. Bridgebuilder review caught:

- F2: uses pre-rename `freeside-*` names (canonical is `*-api` per ADR-009 D-2)
- F5: lives in `tools/` — operator-visibility belongs in cluster-meta scope (`apps/freeside-operator-dash/` per kickoff)
- Missing `yaml` dependency at runtime (`Cannot find module 'yaml'` on first run)

## What survives forward into v1

The design direction in `dash.ts` is salvageable as a reference for the
`apps/freeside-operator-dash/src/app.ts` rebuild:

- Server-side probe orchestration (`Promise.all` over targets, no browser CORS)
- **Soju-lens implementation** — parallel-fetch operator identity across N
  surfaces, discrepancy detection, BERA→Soju gap rendered visually. This is
  the actually-novel primitive per bridgebuilder F6.
- HTML render structure: phase scoreboard + federation tiles + Soju-lens table
- State typing (`DashState` shape) — reusable as the wire-shape for the v1 service

## What does NOT survive

- File location (move to `apps/freeside-operator-dash/`)
- Naming (`freeside-*` → `*-api` per ADR-009 D-2)
- The architecture brief at `grimoires/loa/proposals/archive/freeside-federation-topology.md`
  (superseded; was reasoning about decided ground per bridgebuilder F1)

## Lifecycle

This directory should be deleted once `apps/freeside-operator-dash/` lands
v0.1 with the Soju-lens working. Until then, kept as a reference fence.

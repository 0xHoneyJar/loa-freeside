---
session: 3
date: 2026-05-31
type: kickoff
status: planned
---

# Session 3 — Freeside CM Control Plane: theme→role map + the runway (kickoff)

## Scope
- **Track 2 — full theme→role map** (operator chose Reference model): P2 bot role-awareness endpoint (guild Discord roles → dashboard) ∥ P3 dashboard role-map editor (bind score-api tiers → Discord roles + restyle, write the live `role-map` surface) → P4 bot role-assignment (assign Discord roles by score-api-computed tier; closes the loop).
- **Then** the account profile page (`arrakis-7nw9`) — global Freeside username (NET-NEW; distinct from per-world nyms) + pfp + credits; per-USER Settings surface.
- **Runway** (beaded): DB-4 bot-posts-the-verify-card (`arrakis-83y2`, the read half), composer expressiveness (`arrakis-et2h/tkma/fh5r`), roster Discord-reachability via identity-api verified links (`arrakis-ea3i`), Discord-OAuth login (`arrakis-ank6`), mediums self-distribution (`arrakis-euqr`).

## Artifacts
- Build doc: `grimoires/loa/specs/enhance-theme-role-map-and-runway.md` (source of truth)
- Cluster mental model: `grimoires/loa/context/2026-05-31-cluster-topology-map.md`
- Active grounding: `grimoires/loa/context/2026-05-31-ride-ground-truth.md`

## Prior session (Session 2 → this kickoff)
Shipped the **entire authoring loop, live**: config service deployed (C-6); CV2 medium-parametric verify composer (#53); wallet-sign CM login + account display, live-QA'd end-to-end (#54); project-switcher→managed-worlds (#55); role-map config surface schema, Reference model, live (worlds-api #6). Built the cluster topology map + the module-self-distribution doctrine. `mediums-api` flipped public (Vercel git-source fix).

## Decisions made (the contracts to honor)
- **Reference model** (role-map): score-api OWNS the tier ladder + gates; the role-map BINDS its tier-ids → Discord roles + restyles. No `gate` in the surface (schema rejects it).
- **Discord-reachability SoR**: identity-api VERIFIED links (not score-api/MIDI's unverified handle) — needs a net-new batch endpoint.
- **Account profile**: a global Freeside username is NET-NEW (identity-api has only per-world nyms); show per-world nyms for clarity, never adopt one.
- **Auth**: wallet-sign now (server-mediated SIWE, first-party HttpOnly cookie); Discord-OAuth after (the bot is the distribution entry point).
- **Distribution**: away-from-npm git-source; each module self-distributes (produce dist + CI-verify outputs↔declared-schemas).
- **Pattern**: scaffold-agent → BB-review → PR; schema changes mirror verify-message; server-mediated (no browser CORS); ARTISAN for UI craft; operator directs at AskUserQuestion forks + live QA.

## Repos
freeside-dashboard · freeside-characters (bot) · worlds-api/freeside-worlds (config-protocol) · identity-api/freeside-auth · all under `~/Documents/GitHub/`.

## Open beads (cycle:freeside-dashboard)
arrakis-7nw9 (profile) · 83y2 (DB-4) · et2h/tkma/fh5r (composer expressiveness) · ea3i (reachability) · ank6 (Discord login) · euqr (mediums self-dist).

---
atlas: world-atlas
version: v0.4
supersedes: world-atlas-v0.3.md
date: 2026-05-28
persona: KRANZ × GECKO
status: GROUNDED · vault SoT integrated · operator framing 2026-05-28 reconciled
disclaimer: THE MAP IS NOT THE TERRITORY · 2 placements remain operator-clarification-pending (henlo · interpol)
references:
  - "vault: wiki/entities/world-registry.md (updated 2026-04-23) — THE world SoT"
  - "vault: wiki/concepts/mibera-world-consolidation.md (2026-04-28) — the turborepo-umbrella-with-apps doctrine"
  - "freeside-auth/packages/engine/src/tenants.yaml — auth tenant config"
  - "freeside-worlds/packages/registry/worlds/*.yaml — per-app manifests (schema currently misnamed 'world' — see below)"
---

# Cluster World Atlas — v0.4

> v0.3 had a fundamental error: it conflated brand · world · app · tenant. The vault SoT clarifies. THJ is the ORG. Worlds are the BRAND level (8 of them). Apps are deployments within worlds. Tenants are auth contexts. Some modules (score-api, identity-api) are horizontal — serving multiple worlds — and don't have a brand placement.

## The 4-layer model (definitive, per vault SoT)

```
LAYER 0 — ORG                    THJ (0xHoneyJar Inc)
                                 │
LAYER 1 — WORLD                  ├── Mibera World          (brand · 2 apps)
                                 ├── Honey Port World      (brand · 4 apps)
                                 ├── APDao World           (brand · 1 app)
                                 ├── Henlo World           (brand · 1 app — vault SoT)
                                 ├── Sprawl World          (brand · 1 app · rektdrop)
                                 ├── Purupuru World        (brand · 2 apps)
                                 ├── Constructs Network    (brand · 4 apps · Loa experience layer)
                                 └── (horizontal modules — not worlds — see below)

LAYER 2 — APP                    Each world has N apps with their own design intention
                                 World provides shared infrastructure + design system inheritance floor
                                 Apps may fork the design floor when app-intent justifies divergence

LAYER 3 — TENANT (auth context)  freeside-auth/tenants.yaml — what user-DB the app authenticates against
                                 1:1 with world OR shared across worlds (mibera world's 2 apps share one tenant DB)

HORIZONTAL MODULES — serve N worlds; don't have a world placement
                                 score-api · identity-api · CubQuests-as-Questing-module
                                 freeside-storage · freeside-mediums · etc
```

**Vault doctrine (`world-system-pattern`, `mibera-world-consolidation`):** a world is a turborepo umbrella with `apps/*` (orthogonal surfaces) and `packages/*` (hoisted contracts shared by the apps). Brand coherence = DNA + shared inheritance floor. Apps inherit by default; may fork when app-intent justifies it.

## The corrected world inventory (per vault, 2026-04-23)

| World | Apps | Stack | Spine status | Notes |
|---|---|---|---|---|
| **Mibera World** | Honey Road (mibera-honeyroad), Mibera Dimensions (mibera-dimensions) | Next.js + shared Railway PG (midi_profiles) | 🟡 3/192 mibera tenant; Move 1 PR #105 unblocks lazy claim | Both apps SHARE the DB — different design intentions, one world. Mibera-world repo is the consolidation target (vault: "instance-2 of contracts-as-bridges"); not yet migrated. |
| **Honey Port World** | Honey Port main (hub.0xhoneyjar.xyz → honeyport.* planned), Moneycomb Vaults, Set and Forgetti (candidate), honey-interface (legacy mint) | Next.js (multiple) | 🔴 not in spine | Formerly hub-interface; target March 3 2026 (Honeycomb 3rd anniversary). HoneyPort v2 'Horizon Voice' design system (stone/timber/parchment/brass/honey). First ECS migration in the multi-app-world class. |
| **APDao World** | apdao (apdao.0xhoneyjar.xyz) | SvelteKit + Turso | n/a (chain-read only; no user data) | Treasury dashboard. Live on Freeside ECS. |
| **Henlo World** | henlo landing (henlo monorepo) | Next.js | ❓ tenant exists in tenants.yaml (declarative-stub); Henlo as world per vault | **Operator clarification needed** — vault SoT says Henlo is its own world; operator said 2026-05-28 that Henlo is "within Honey Port world." Vault may be stale OR operator's mental model evolved. Resolve before atlas v0.5. |
| **Sprawl World** | rektdrop | SvelteKit + Turso | n/a | CRT/cyberpunk SprawlOS. NFT loss calculator + daemon chat. |
| **Purupuru World** | purupuru.world, purupuru-mcp | SvelteKit + Turso (purupuru.world), MCP server (purupuru-mcp) | n/a | Ghibli-warm; honey + puru tokens. |
| **Constructs Network** | constructs.network, Registry API, Docs, Ruggy (Telegram bot) | Next.js + Convex, Hono + Supabase, VitePress, Convex cron | n/a (Loa experience layer) | Construct discovery + dashboard. |

## Horizontal modules (serve all worlds; no brand placement)

| Module | Subdomain / Surface | Role | Spine consumer? |
|---|---|---|---|
| **score-api** | score-api.0xhoneyjar.xyz | Reputation/score module · serves N worlds | Yes (reads identity for per-user scores) |
| **identity-api** | identity.0xhoneyjar.xyz | THE spine · unified auth | Self |
| **CubQuests** (evolving) | cubquests.com (today; module-future) | Quest engine · evolving from standalone → import-by-world module | Pending (Move 2 was scoped before reframe; now uncertain — is CubQuests becoming a module or a world?) |
| **freeside-storage** | (asset CDN) | Sovereign asset pipeline | No (server-side) |
| **freeside-mediums** | (capability registry) | Discord/medium capability schemas | No |
| **inventory-api** | (sonar+codex aggregator) | Sovereign Alchemy-replacement | Indirect (consumes spine identity via composing layer) |
| **freeside-mcp-gateway** | (cross-cell discovery) | MCP federation gateway | No (different auth — per-tenant API keys) |
| **freeside-auth tenants** (honeyjar) | n/a | 0xHoneyJar **org-wide telemetry** config tenant | Yes (audit events) |

## Open placements (need operator confirm)

| Item | What I'm uncertain about | Hypothesis |
|---|---|---|
| **Henlo** | Vault SoT (Apr 23) = own world; operator (May 28) = "in Honey Port" | Operator's latest framing likely correct — Henlo was extracted into Honey Port post-vault-update. Atlas v0.5 will update Honey Port's app list to include Henlo IF operator confirms. |
| **interpol** | Operator (May 28) = "THJ"; vault SoT doesn't list interpol as a world | Most likely: interpol is a private/internal tool that doesn't have a public world surface; "THJ" = org-level tool. Tenant `interpol` (sf_users table) suggests user data; placement = horizontal-org-tool or unmapped world. |
| **CubQuests** | Vault (Apr 23) = "evolving from world → module"; operator's Move 2 plan treats cubquests-interface as a Move target | Ambiguity: if cubquests is becoming a MODULE imported by worlds, then Move 2 substrate-prep doesn't apply to "cubquests world" — it applies to whichever world uses CubQuests today. Today that's cubquests.com (standalone). Resolve: Move 2 still valid until cubquests.com retires. |

## Subdomain → world mapping (corrected from auth-proxy.tf CORS allowlist)

| Subdomain | World | Status |
|---|---|---|
| `mibera.0xhoneyjar.xyz` | Mibera World → Honey Road app | ✅ live |
| `midi.0xhoneyjar.xyz` | Mibera World → Mibera Dimensions app | ✅ live |
| `cubquests.0xhoneyjar.xyz` | CubQuests-as-world (pending module transition) | ✅ live |
| `hub.0xhoneyjar.xyz` | Honey Port World → Honey Port main app (will become honeyport.*) | ✅ live |
| `moneycomb.0xhoneyjar.xyz` | Honey Port World → Moneycomb Vaults app | ✅ live |
| `henlo.0xhoneyjar.xyz` | Henlo World OR Honey Port World → Henlo (pending operator clarify) | ✅ live |
| `auction.0xhoneyjar.xyz` | APDao World → apdao-auction-house app | ✅ live |
| `apdao.0xhoneyjar.xyz` | APDao World → apdao app | ✅ live |
| `app.0xhoneyjar.xyz` | THJ org legacy — OG THJ app w/ Genesis mints | 🌑 legacy (operator named) |
| `staging.0xhoneyjar.xyz` | (env, not world) | n/a |
| `0xhoneyjar.xyz` | THJ org apex | n/a |
| ~~`honey.0xhoneyjar.xyz`~~ | NOT a real subdomain (operator clarified — CORS allowlist mistake) | ❌ remove from terraform allowlist |

**Action item:** Open a PR to `loa-freeside/infrastructure/terraform/auth-proxy.tf` removing `honey.0xhoneyjar.xyz` from the CORS allowlist (small operator-time-saving cleanup).

## The schema misalignment (load-bearing finding)

The current `freeside-worlds` schema treats `world` = ECS deployable unit (one subdomain). But the vault SoT (and operator's mental model) treats `world` = container with N apps, each app being a deployable unit.

```
SCHEMA-shipped "world"          VAULT/operator "world"
────────────────────            ────────────────────
slug → subdomain                slug → brand identity
1 manifest per deployment       1 manifest per brand (with apps[] inside)
mibera.yaml = honeyroad app     mibera-world.yaml = { apps: [honeyroad, dimensions], packages: [...] }
midi.yaml = dimensions app      
```

**The schema's "world" is actually closer to "app" in operator's mental model.** Three reconciliation paths:

1. **Schema v1.3 — add `apps[]` array, rename schema** — `world-manifest.schema.json` becomes truly world-shaped; existing files migrate from per-app to per-world with `apps[]`
2. **Schema v1.3 — rename "world" → "app" in schema** — keep existing per-deployment shape; new "world" concept enters as separate `world-registry.yaml` listing apps
3. **Atlas-only** — schema stays; vault SoT remains the human-readable world doctrine; agents treat schema as app-level and vault as world-level

**KRANZ recommendation:** Path 2 (rename in schema; new world layer above). Less migration cost than Path 1; clearer semantics than Path 3.

## Dynamic export as the auth migration baseline (operator's reframe)

Per operator 2026-05-28: "the union [wallets + users CSV] should serve as baseline for our auth."

Telemetry from CSVs (already in v0.3):
- 90,106 unique Dynamic users
- 45,271 unique wallets
- 99% blockchain, 0.7% oauth, 0.25% email
- SINGLE Dynamic env (`137aa286...`) across the entire cluster

**The 90k users are the migration target across all worlds.** Per identity-api LBR-1 atomic resolve-or-mint: lazy claim-on-first-login (per Bearer pattern) is the path. As users visit any world's apps, their spine `user_id` is created (or matched) on first SIWE; world_identity row added for that world.

**Cross-world identity coherence is the headline:** a user who signed in at mibera.0xhoneyjar.xyz then visits cubquests.0xhoneyjar.xyz resolves to the SAME spine `user_id` with two `world_identity` rows. Proven via Move 2 two-world test.

## v0.4 → v0.5 amendments expected

- Henlo placement confirmation (own world vs Honey Port app)
- interpol placement confirmation (THJ horizontal tool vs unmapped world)
- CubQuests-as-module transition status (when does cubquests.com become module-only?)
- Schema reconciliation direction (Path 1 / 2 / 3) — gates `freeside-worlds` v1.3
- `honey.0xhoneyjar.xyz` removed from auth-proxy.tf CORS allowlist
- Move 2 framing — substrate-prep targets cubquests.com app (the deployed app), not "cubquests world" (which is dissolving into module)

## v0.3 corrections captured

Acknowledging where v0.3 was wrong:
- ❌ "THJ is a brand" → ✅ THJ is the ORG
- ❌ "honey-pot brand" → ✅ Honey Port (one word, vault-canonical spelling) is a WORLD
- ❌ "Mibera is brand+world" → ✅ Mibera IS a world; brand is the world identity itself (operator: "brand atm until people build within")
- ❌ "rektdrop is standalone" → ✅ rektdrop is the app inside Sprawl World
- ❌ "score-mibera is a tenant" → ✅ score-mibera was renamed to score-api; it's a horizontal module
- ❌ "Brand options A/B/C" → ✅ World IS the brand layer; the gap is schema's "world" being misnamed for "app"

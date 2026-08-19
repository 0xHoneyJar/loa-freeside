---
atlas: world-atlas
version: v0.3
supersedes: world-atlas-v0.2.md
date: 2026-05-28
persona: KRANZ × GECKO
status: GROUNDED · brand/world/tenant model surfaced + freeside-worlds SoT integrated + Dynamic export depth measured + auth.0xhoneyjar.xyz reality clarified
disclaimer: THE MAP IS NOT THE TERRITORY · brand model awaits operator decision (3 directional options); rest grounded in shipped code + CSV
---

# Cluster World Atlas — v0.3

> v0.2 mapped 10 user-data surfaces. v0.3 reframes the entire taxonomy: the cluster has THREE layers (brand · world · user-DB) but the schema today only models TWO (world + tenant). v0.3 surfaces the gap + proposes the model + measures the Dynamic export depth.

## The 3-layer model (proposed — operator decision required)

```
LAYER 1 — BRAND (operator-organizational; NOT in schema today)
    │
    └── owns N worlds; humans think at this level
        Examples per operator's 2026-05-28 framing:
          THJ        (The Honey Jar)
          honey-pot  (The Honey Pot)
          my-bear    (Mibera-adjacent)
          rektdrop   (standalone? operator decides)
          interpol   (standalone? operator decides)

LAYER 2 — WORLD (freeside-worlds/registry/worlds/<slug>.yaml)
    │
    └── ECS deployable unit; one subdomain per slug
        Has hosting, identity[], secrets, network, compose_with, rooms
        Optional `tenant_id` (v1.2 schema) for auth binding
        Examples today: apdao, mibera, midi, rektdrop

LAYER 3 — TENANT (freeside-auth/packages/engine/tenants.yaml)
    │
    └── Auth/identity context; one DB adapter shape
        References a Railway project for user data
        1:1 with worlds today (when tenant_id is set)
        Examples: mibera, cubquest, apdao, honeyjar, validator, henlo, henlo-old, interpol, score-mibera, thj
```

**The schema (freeside-worlds v1.2) has Layers 2 + 3 but NOT Layer 1.**

## Operator's brand hierarchy (named 2026-05-28)

| Brand | Worlds (operator's mapping) | Status today |
|---|---|---|
| **THJ** (The Honey Jar) | apdao, validator, henlo, honeyjar (config tenant) | apdao deployed; validator/henlo tenant-only (no world manifest) |
| **honey-pot** (The Honey Pot) | cubquests, satin, forgetti, honeycomb-vaults | cubquests has frontend; satin/forgetti/honeycomb-vaults exist NOWHERE in registry today |
| **my-bear** (Mibera-adjacent) | mibera (honey-road + dimensions), midi, score-mibera | mibera + midi deployed; score-mibera in tenants but not in worlds |
| **rektdrop** (standalone) | rektdrop | deployed; first template world |
| **interpol** (standalone) | interpol (sf_users) | declarative-stub tenant; operator-clarification needed |

**Gaps the brand hierarchy exposes:**
- 5 brand-layer concepts that don't exist in schema or registry: `satin`, `forgetti`, `honeycomb-vaults`, `my-bear`, `honey-pot`, `THJ`
- 3 tenants that have no world manifest: validator, henlo, honeyjar, interpol, score-mibera
- 1 brand-vs-tenant ambiguity: `honeyjar` — is it (a) a config tenant inside THJ, (b) the THJ brand itself, (c) something else?

## Brand-model decision (3 directional options for operator)

**Option A — Schema upgrade (v1.3 adds `brand_slug`):**
- world-manifest.schema.json bumps to v1.3
- Optional `brand_slug` field; validates against new brands.yaml registry
- identity-api spine adds `brands` table + (optional) `brand_identity` for cross-world identity-within-brand
- KEEP existing world slugs as-is; LAYER brand on top
- Reversibility: high (schema additive); existing worlds work unchanged
- Effort: ~1 cycle to ship; ~2 cycles to migrate naming if needed

**Option B — Rebase (existing "worlds" become "tenants"; new "worlds" at brand level):**
- Rename: apdao.yaml world → apdao tenant under thj.yaml world
- Schema requires major bump; existing terraform names migrate
- Reversibility: low (subdomain churn possible); operational risk
- Effort: 2-3 cycles; high coordination cost

**Option C — Atlas-only (no schema change; brand stays organizational):**
- Brand hierarchy lives in atlases/ + brand annotations in tenants.yaml comments
- world-manifest stays v1.2; spine stays 2-level
- Operator-mental-model only; no agent ever asks "which brand?"
- Reversibility: trivial (it's just docs)
- Effort: zero beyond atlas

**KRANZ recommendation:** Option A. The brand layer is real organizational structure; making it schema-visible enables future cross-world brand-level features (THJ-wide leaderboard? Honey-Pot shared inventory?). Option C is the safe-but-stunted path. Option B is the "do it right but expensive" path; defer unless operator wants a fresh rebase.

## Subdomain inventory (from `loa-freeside/infrastructure/terraform/auth-proxy.tf` CORS allowlist)

The auth-proxy terraform names 11 subdomains in its CORS allowlist — the cluster's full UI surface:

| Subdomain | Likely world | Brand (per operator hierarchy) |
|---|---|---|
| `mibera.0xhoneyjar.xyz` | mibera (honey-road) | my-bear |
| `midi.0xhoneyjar.xyz` | midi (mibera-dimensions) | my-bear |
| `cubquests.0xhoneyjar.xyz` | cubquests | honey-pot |
| `henlo.0xhoneyjar.xyz` | (henlo has a frontend!) | THJ |
| `moneycomb.0xhoneyjar.xyz` | (Honey Comb Vaults? operator-clarify) | honey-pot |
| `auction.0xhoneyjar.xyz` | apdao-auction-house | THJ |
| `hub.0xhoneyjar.xyz` | (operator-clarify what this is) | ? |
| `honey.0xhoneyjar.xyz` | (operator-clarify) | THJ? |
| `app.0xhoneyjar.xyz` | (operator-clarify — main app?) | ? |
| `staging.0xhoneyjar.xyz` | staging | (env not brand) |
| `0xhoneyjar.xyz` | apex | (org root) |

**Operator: 4 subdomains need clarification** (hub, honey, app, moneycomb). These are deployed UIs we haven't surveyed.

## auth.0xhoneyjar.xyz reality (clarified from v0.2)

**auth.0xhoneyjar.xyz is NOT an identity-api session surface. It's a Dynamic Labs CORS proxy.**

Per `loa-freeside/infrastructure/terraform/auth-proxy.tf`:
- AWS API Gateway HTTP API
- Transparent pass-through to `app.dynamic.xyz`
- Purpose: fix Dynamic's broken CORS-on-error behavior (Dynamic only sets CORS on 2xx; this proxy sets it on all responses)
- Probe confirms: `curl -I https://auth.0xhoneyjar.xyz/` → `302 → location: app.dynamic.xyz`

**Implication:** the mibera.yaml `cookie_domain: "auth.0xhoneyjar.xyz"` is for **Dynamic's cookies** to be set at that subdomain (NOT identity-api's). The cookie-domain blocker for identity-api remains valid — Bearer pattern (Move 1's choice) is still the right answer.

## Dynamic export depth (measured 2026-05-28)

Two complementary CSVs from one Dynamic environment (`137aa286-922e-4308-835d-eb00d04b9f14`):

| Export | File | Size | Rows | Unique | Schema |
|---|---|---|---|---|---|
| **Wallets** | `export-5946b8fd...csv` | 25 MB | 149,683 wallet records | 45,271 addresses | address, chain, createdAt, id, projectEnvId, provider, walletName |
| **Users (current)** | `export-cf79ddd9...csv` | 45 MB | 98,414 credentials | **90,106 users** | user_id, user_*, verified_credential_* (37 fields) |
| Users (April snapshot) | `export-d5e7f445...csv` | 45 MB | 98,322 credentials | (estimate ~89,500 users) | same schema |

**Credential formats:** 99% blockchain (wallet-only), 0.7% oauth (Twitter/Discord/etc), 0.25% email, 0.008% externalUser

**Migration arithmetic:**
- **~90k human migration target** (single Dynamic env across the whole cluster)
- Lazy claim-on-first-login: ~90k spine rows created over time as users return to any consumer (mibera-honeyroad, cubquests, etc.)
- Eager backfill: at LBR-1 ~30 user creates/sec = **~50 min to write 90k spine entries**
- Eager risk: 90k user_ids exist but most users may never return → write amplification + churn
- **Recommended:** lazy (per the Bearer doctrine + operator's 2026-05-27 decision)

## Updated tenant matrix (v0.3 — absorbs brand hierarchy)

| Brand | Tenant slug | World deployed? | DB | Spine status | Notes |
|---|---|---|---|---|---|
| my-bear | `mibera` | ✅ mibera.yaml | midi_profiles (Railway split) | 🟡 3 of 192 claimed | Move 1 unblocks lazy claim |
| my-bear | `midi` | ✅ midi.yaml | Supabase (not in tenants.yaml) | 🔴 not in spine | second consumer of mibera world's DB? operator clarify |
| my-bear | `score-mibera` | ❌ no world manifest | own Railway `dynamic_users` | 🔴 not in spine | sovereign-score work |
| honey-pot | `cubquest` | ❌ no world manifest | Railway `profiles` | 🔴 not in spine | Move 2 target (runbook drafted) |
| honey-pot | satin · forgetti · honeycomb-vaults | ❌ nowhere | n/a | n/a | brand-only, no infrastructure yet |
| THJ | `apdao` | ✅ apdao.yaml | none (chain-read only) | n/a | treasury dashboard; no user data |
| THJ | `honeyjar` | ❌ no world manifest | none (config) | n/a | telemetry config tenant |
| THJ | `validator` | ❌ no world manifest | none (config) | n/a | declarative-stub |
| THJ | `henlo` | ❓ subdomain exists | henlo_profiles | 🔴 declarative-stub | frontend lives at henlo.0xhoneyjar.xyz but no world.yaml |
| THJ legacy | `henlo-old` | ❌ archive_only | crew_members frozen | n/a | billing waste candidate |
| rektdrop | `rektdrop` | ✅ rektdrop.yaml | none (no auth in v1.0) | n/a | template world |
| (unsure brand) | `interpol` | ❌ no world manifest | sf_users | 🔴 declarative-stub | operator-clarify |
| 🛡️ spine | `freeside-auth` | n/a | spine PG | LIVE Phase 1-4 | identity.0xhoneyjar.xyz |

## v0.3 amendments captured

1. **3-layer model surfaced** (brand · world · tenant); schema covers 2; brand is operator-mental-model only today
2. **Operator brand hierarchy mapped** (THJ · honey-pot · my-bear · rektdrop · interpol uncertain)
3. **5 brand-layer concepts missing from infrastructure** (satin, forgetti, honeycomb-vaults, honey-pot brand, my-bear brand)
4. **5 tenants without world manifests** (validator, henlo, honeyjar, score-mibera, interpol)
5. **Subdomain inventory** added — 11 CORS-allowlisted subdomains; 4 need operator clarification (hub, honey, app, moneycomb)
6. **auth.0xhoneyjar.xyz reality** — Dynamic CORS proxy, NOT an identity-api session surface (Bearer pattern unchanged)
7. **Dynamic export measured** — 90,106 unique users · 45,271 unique wallets · single Dynamic env across whole cluster
8. **Migration arithmetic** — ~90k users; lazy claim recommended; eager backfill ~50min (write amplification risk)

## Open questions for operator

1. **Brand-model decision** — A / B / C (schema upgrade vs rebase vs atlas-only)?
2. **Subdomain clarification** — what live at `hub.0xhoneyjar.xyz`, `honey.0xhoneyjar.xyz`, `app.0xhoneyjar.xyz`, `moneycomb.0xhoneyjar.xyz`?
3. **interpol brand placement** — standalone? THJ? what's "sf"?
4. **honeyjar tenant** — config-tenant inside THJ brand, or THJ brand itself?
5. **mibera vs my-bear** — is "my bear" the brand and mibera the tenant/world? Operator's phrasing implied my-bear is the brand (Mibera-adjacent), but mibera is also the deployed world's slug.
6. **score-mibera vs midi** — both seem to be Mibera-world tenants; relationship?
7. **Users CSV April vs May** — older snapshot exists at `export-d5e7f445...csv`; useful for diff analysis?

## v0.3 → v0.4 amendments expected after operator answers

- Brand-model decision lands; schema v1.3 PR opened OR atlas-only convention codified
- Subdomain clarifications integrated; missing world manifests authored
- score-mibera + interpol + honeyjar placements resolved
- Wallet sync + user backfill plan scoped (lazy + telemetry milestones)

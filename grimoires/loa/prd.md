---
title: PRD — identity-api (the central identity organ for the freeside ecosystem)
cycle: identity-api-2026-05-24
building_slug: identity-api
status: v3.0 draft (third-pass reconciliation — merges the building's 2026-04-30 plan + operator scale-corrections; supersedes v1 @ ddf1a11d) — see §11
building_existing_plan: ~/Documents/GitHub/freeside-auth/grimoires/{prd,sdd,sprint}.md (2026-04-30, ready-for-architect, 40 beads, ADR-039) — reconciled in §11
date: 2026-05-24
mode: ARCH
authoring: /plan-and-analyze → forks resolved → doctrine reconciled (freeside-as-identity-spine + score-vs-identity-boundary, operator-activated) → re-planned build-on-existing
supersedes: v1 greenfield baseline (commit ddf1a11d) — that draft wrongly assumed a new repo + @freeside-auth as an external dependency
the_repo: 0xHoneyJar/freeside-identity (renamed → identity-api) — already contains the @freeside-auth building (engine/adapters/protocol/ports/mcp-tools, merged cycle-B PR #1)
operator_decisions_2026_05_24:
  - Q1 Writer graduation · identity-api OWNS the canonical spine (mint user, write wallet[], link credentials) · midi_profiles → backfill → reads from identity-api
  - Q2 JWT issuance · keep the JWTSigner PORT (already in the building) · v1 = local ES256 signer + own JWKS · seam preserved to delegate to the platform Rust gateway later
  - Q3 Profile compose · identity-api owns read-time getProfile/getMiberaDimensions (JOIN via wallet[], NEVER embed/store)
  - D3-reframed · "replace Dynamic" = swap the CREDENTIAL layer (Dynamic → SIWE-direct), NOT delete the identity layer · dynamic_user_id demotes from resolve-Tier-1 to a backfill credential
  - Build · extend the existing building (engine/adapters/protocol) · Hyper · single Railway service · loa-freeside = PLATFORM substrate
reconciliation_doctrine:
  - ~/vault/wiki/concepts/freeside-as-identity-spine.md (activated · usable · the 3-layer credential/identity/session split)
  - ~/vault/wiki/concepts/score-vs-identity-boundary.md (activated · usable · JOIN via wallet[], never embed)
companion_artifacts:
  - grimoires/loa/cycles/cycle-c-freeside-auth-substrate-2026-05-05/prd.md (the cycle-c auth substrate; its verify lifecycle becomes a client of this SoR)
  - decisions/008-freeside-as-factory.md §D-11 (*-api building convention) + §D-8 (plane ≠ domain)
memory: project_freeside-identity-api.md
---

# PRD — identity-api

## §0 Frame

**identity-api is the central identity organ for the freeside ecosystem.** It is NOT a new building — it is the **evolution of the existing `freeside-identity` repo** (which already houses the `@freeside-auth` building: `engine` + `adapters` + `protocol` + `ports` + `mcp-tools`, merged in cycle-B PR #1, 2026-05-06). We **rename `freeside-identity` → `identity-api`** (per ADR-008 §D-11 the building slug is `*-api`) and **build on what's there** — not greenfield.

### The reconciliation that produced this PRD

The v1 draft (commit `ddf1a11d`) assumed a greenfield build with `@freeside-auth` as an external dependency. That was wrong on both counts, and its forks appeared to *contradict* the building's own `INTENT.md`. Reading the canonical doctrine (`freeside-as-identity-spine`, `score-vs-identity-boundary`) dissolved the contradiction by separating **three layers** the word "auth" was blurring:

| Layer | What | Owner |
|-------|------|-------|
| **Credential** | wallet-sig / passkey / Dynamic / SeedVault | *pluggable — NOT freeside's job* |
| **Identity** | canonical `user_id` + `wallets[]` + tenant/tier claims | **identity-api owns this** |
| **Session** | JWT issued, verified via JWKS | issued via the `JWTSigner` port; worlds verify |

Re-read through that lens, this session's forks are **compatible with the spine doctrine**, with one deliberate evolution:

- **"Replace Dynamic"** = swap the *credential* source Dynamic → **SIWE-direct**. The identity layer is untouched; the credential layer was *designed* pluggable (the `credential-siwe` schema + bridge are already on the building's plan). `dynamic_user_id` demotes from resolve-Tier-1 to a backfill credential. **Not** a deletion of the identity layer.
- **"Hybrid graph"** = literally the doctrine's *"freeside provides the `sub`; brands keep their profile tables."*
- **"Central SoR / writer"** (the one evolution to ratify, now ratified Q1) = graduate the building from the Phase-0 stance (`INTENT.md`: "midi is the writer, this reads") to **owning the canonical identity spine** — exactly what `freeside-as-identity-spine` says freeside should do ("mint the canonical user, link credentials"). midi_profiles → backfill → reads from identity-api.

### The three seams this building owns

| Seam | Question | Status in the building today | This cycle |
|------|----------|------------------------------|------------|
| **① Authenticate** | "prove you're you" | credential bridges (`credential-bridge-siwe` planned, `-dynamic` stub); verify via `engine/jwt-verify` | swap primary credential → **SIWE-direct**; Dynamic → backfill |
| **② Resolve** | "1 human ↔ N wallets ↔ N per-world nyms" | **the 4-tier `resolve-tier` engine already exists** (Tier1 dynamic_user_id → Tier2 additional_wallets → Tier3 wallet_groups → Tier4 direct), reading midi via `pg-midi-profiles` adapter | **graduate to own the spine** (write, not just read); re-tier to **wallet-first** |
| **③ Serve profile** | "compose holdings + score + dimensions per world" | not present | **new**: read-time `getProfile`/`getMiberaDimensions`, JOIN via wallet[], never embed (Q3) |

**Baseline pattern (proven):** the inventory-api federation — one repo (schema + runtime + docs), a BeaconV3 declaration, a registry entry, deployed behind the MCP gateway (`mcp.0xhoneyjar.xyz`), consumed two-organ (typed SDK `@0xhoneyjar/inventory` + MCP). identity-api replicates this.

**Headline achievement (acceptance bar):** a user's **Mibera dimensions profile** — their tokens' 7-dimension codex traits + holdings + score — served by identity-api and **surveyed on the honey road** (mibera-world), sourced from identity-api, not Alchemy/Dynamic.

---

## §1 Goals

`G-N` ids per repo CLAUDE.md. Delivery sequenced: **G-1/G-2/G-3 → G-5 → G-6 → G-4** (cycle-c redirect last — it couples to a separate in-flight cycle).

| ID | Goal | Success metric |
|----|------|----------------|
| **G-1** | Rename `freeside-identity` → `identity-api`; bring it to building-standard — single Railway service, BeaconV3 + registry entry + typed SDK (`@0xhoneyjar/identity`) + MCP, **extending** the existing `engine`/`adapters`/`protocol` | beacon broadcasts valid V3; registered in `packages/freeside-registry/registry.yaml`; `import { resolveUser } from '@0xhoneyjar/identity'` type-checks; reachable via the gateway federation manifest; the existing `@freeside-auth` packages still build |
| **G-2** | **Resolution spine as SoR** — own `users` ↔ `wallet_links`(+primary) ↔ `linked_accounts` ↔ `world_identity`; refactor the existing 4-tier `resolve-tier` to wallet-first | one human with 2 verified wallets + 2 per-world nyms resolves to a single `user_id` from wallet, discord id, or (world, nym); identity-api WRITES the spine (no longer read-only on midi) |
| **G-3** | **Credential swap → wallet-first** — SIWE/EIP-191 as the primary credential (extend the planned `credential-bridge-siwe`); `dynamic_user_id` → backfill credential in `linked_accounts`; sessions issued via the `JWTSigner` port | zero Dynamic SDK calls in the credential path; an honey-road session is issued + verified through identity-api; `credential-bridge-dynamic` used only for backfill |
| **G-4** | **cycle-c redirect** — Sietch verify-completion writes linkage to identity-api (typed-SDK/HTTP), replacing cycle-c's direct `MidiPgIdentityLink` PG write | a Discord `/verify` produces/updates a spine row via identity-api; cycle-c's direct-midi write path is retired in favor of the identity-api client |
| **G-5** | **Profile serving (read-time compose, no embed)** — `getProfile` joins inventory (holdings) + score (score) + codex (dimensions) via wallet[]; nothing downstream is stored in the spine | a profile read returns spine + composed content with graceful degradation; an audit confirms no score/holdings/dimensions persisted in the spine (boundary honored) |
| **G-6** | **Headline** — serve a user's Mibera dimensions profile, surveyed on the honey road | honey-road renders a holder's 7-dim Mibera profile (archetype/ancestor/element/tarot/era/molecule/swag + grail) from `@0xhoneyjar/identity`, not Alchemy |

---

## §2 Scope

### §2.1 In scope (v1)

- **Rename + building-standard (G-1):** `freeside-identity` → `identity-api`; root pkg + `@freeside-auth/*` sub-packages reconcile toward `@0xhoneyjar/identity` (scope migration per memory `project_freeside-npm-scope-and-consume`); BeaconV3 (rewrite the `is`/`is_not` from the old read-side scope), registry entry, MCP tenant, typed SDK. Hyper runtime (Bun).
- **Spine-as-SoR (G-2):** the 5-table spine (§4.2) as a Postgres schema identity-api OWNS; refactor `engine/resolve-tier` to write + wallet-first; keep the tier algorithm's structure.
- **Credential swap (G-3):** finish `credential-bridge-siwe` as the primary; demote `credential-bridge-dynamic` to backfill; SIWE + legacy EIP-191 (reuse Sietch `SignatureVerifier` + the existing challenge/nonce shape); Hyper sessions.
- **JWT via port (Q2):** keep `ports/JWTSigner` + `mint-jwt-orchestrator` (claims construction); **v1 local ES256 signer adapter** (own JWKS endpoint, overlap rotation); preserve `HttpJWTSigner` seam for later platform-gateway delegation.
- **Profile serving (G-5):** read-time compose endpoint + sealed profile schema in `packages/protocol/`.
- **Mibera path (G-6):** codex 7-dim resolver + honey-road survey swap (`lib/alchemy.ts` → `@0xhoneyjar/identity`).
- **cycle-c redirect (G-4):** `IdentityLinkPort` impl calling identity-api; Sietch wired; `midi_profiles` backfill.

### §2.2 Out of scope (v1)

| Deferred | Why |
|----------|-----|
| Passkey / email / social-OAuth credentials | wallet-first; additive bridges later (the `credential-passkey`/`-seedvault` stubs already reserve this) |
| ACVP signed identity attestations (loa-oracle pattern) | power-up: makes a dimensions profile a verifiable credential; not on the headline path |
| Telegram linked-account flow | provider row reserved; flow deferred |
| Worlds beyond THJ + Mibera | spine is world-generic; only THJ + mibera-world wired |
| NATS event linkage sync | v1 redirect is a synchronous client call (cycle-c+1 doctrine) |
| Embedded-wallet onboarding | removed with Dynamic; rebuild from first principles only if demanded |
| Delegating signing to the Rust gateway | seam preserved; v1 signs locally — flip the adapter when the gateway exposes a session-claim `/issue` |
| Storing profile content (bios/dimensions/holdings) in the spine | D2 + score-vs-identity boundary: federate, compose on read |

### §2.3 Non-goals (explicitly NOT doing)

| Non-goal | Why |
|----------|-----|
| Re-implement the 4-tier resolve or JWT verify | extend the existing `engine` (`resolve-tier`, `jwt-verify`, `mint-jwt-orchestrator`) |
| Re-implement holdings / score / dimensions | compose inventory-api / score-api / codex; never index chains or compute score |
| Embed score/holdings/dimensions into the identity tables | score-vs-identity boundary: JOIN via wallet[], never embed |
| Own the cryptographic signing forever | signing is platform substrate; reached via the `JWTSigner` port (v1 local, gateway later) |
| Greenfield a new repo | the building exists; rename + extend |

---

## §3 Decisions (load-bearing)

- **D1 — Writer graduation (SoR).** identity-api mints the canonical user, writes `wallet_links`/`linked_accounts`/`world_identity`, links credentials. midi_profiles → one-time backfill → then reads from identity-api. Evolves the building's `INTENT.md` ("midi is writer") to match `freeside-as-identity-spine` ("freeside mints the canonical user").
- **D2 — Hybrid graph.** Centralize the spine (the dot-connector); federate world content (bios, Mibera dimensions, holdings) composed on read. = the doctrine's "freeside provides the `sub`; brands keep profile tables."
- **D3 — Credential swap, not identity deletion.** Drop Dynamic as the credential *source*; SIWE-direct becomes primary. The identity layer (resolve → canonical user → claims) is unchanged. `dynamic_user_id` survives only as a backfill credential in `linked_accounts`.
- **D4 — Build on the existing building.** Rename `freeside-identity` → `identity-api`; extend `engine`/`adapters`/`protocol`/`ports`. Hyper, single Railway service. loa-freeside = platform substrate; identity-api is a building extracted from / atop it.
- **D5 — Composes with inventory-api + score-api + codex** for ③ (read-time JOIN via wallet[]).
- **D6 — Cross-cutting credential plane, orthogonal to the data-depth DAG** (ADR-008 §D-8); auth/resolve failures isolate from profile-compose failures.
- **D7 — JWT issuance via the `JWTSigner` port (Q2).** `mint-jwt-orchestrator` constructs claims (never signs — building's royal decree). v1: a **local ES256 signer adapter** + own JWKS. Seam preserved: swap to `HttpJWTSigner` → platform Rust gateway when it exposes a session-claim `/issue`. Signing is the long-term platform boundary.
- **D8 — Read-time compose, never embed (Q3).** `getProfile`/`getMiberaDimensions` JOIN downstream buildings live; the spine stores none of their data (score-vs-identity boundary).
- **D9 — Conflict policy inherits cycle-c FR-L3** (latest-wins single-axis; hard-fail `cross_user_collision` on third-party-claimed pair). Confirm in §9.

---

## §4 Functional Requirements

### §4.1 Building / contract surface (G-1)

| ID | Requirement |
|----|-------------|
| **FR-B1** | GitHub repo `freeside-identity` renamed → `identity-api`; registry slug + BeaconV3 `slug: identity-api` (ADR-008 §D-11 identity-leads-the-rename). Existing `@freeside-auth/*` packages migrate scope toward `@0xhoneyjar/identity` (coordinate; preserve cycle-c's import expectations during cutover). |
| **FR-B2** | BeaconV3 `is`/`is_not` **rewritten** from the old read-side scope: `is`: resolve identity + issue sessions + serve composed profiles; `is_not`: "does NOT index chains / compute score / store profile content / own the credential UI." `composes_with: {inventory-api, score-api, codex}`. |
| **FR-B3** | Registered in `packages/freeside-registry/registry.yaml`; appears in `/.well-known/federation.json`. |
| **FR-B4** | Typed SDK `@0xhoneyjar/identity` exports the resolve + profile + session clients (consume organ). |
| **FR-B5** | MCP surface (extend the existing `mcp-tools`: `resolve_wallet`, `resolve_wallets`, `verify_token`, + new `get_profile`); added as an mcp-gateway tenant. |

### §4.2 Resolution spine — the SoR schema (G-2)

```
users(user_id uuid pk, primary_wallet text null, created_at timestamptz)
wallet_links(wallet_address text, user_id uuid fk, chain_ids text[], is_primary bool,
             verified_at timestamptz, unlinked_at timestamptz null,
             unique(wallet_address) where unlinked_at is null)
linked_accounts(user_id uuid fk, provider text,   -- 'discord'|'telegram'|'dynamic_user_id'
             external_id text, verified_at timestamptz, unique(provider, external_id))
worlds(world_slug text pk, ...)                    -- references the freeside-worlds registry
world_identity(user_id uuid fk, world_slug text fk, nym text, joined_at timestamptz,
             unique(world_slug, nym))
```
Maps onto the existing `protocol/user.schema` + `identity-component.schema` (the canonical User Entity + wallets[]). The existing 4-tier `resolve-tier` keeps its structure; Tier-4 (direct wallet) becomes primary, Tier-1 (dynamic_user_id) becomes backfill.

| ID | Requirement |
|----|-------------|
| **FR-R1** | `resolveByWallet(address) → user_id?` |
| **FR-R2** | `resolveByAccount(provider, external_id) → user_id?` (e.g. discord_id) |
| **FR-R3** | `resolveByNym(world_slug, nym) → user_id?` |
| **FR-R4** | `getIdentity(user_id) → { wallets[], primary_wallet, accounts[], world_identities[] }` |
| **FR-R5** | Primary-wallet: exactly one `is_primary` per user; setting a new primary clears the prior |
| **FR-R6** | **Write authority (D1):** mint user / link wallet / link account / claim nym are idempotent, audited; one human = one `user_id` |

### §4.3 Authentication — wallet-first credential swap (G-3)

| ID | Requirement |
|----|-------------|
| **FR-A1** | SIWE (EIP-4361) primary, legacy EIP-191 supported (reuse Sietch `SignatureVerifier` + the existing challenge/nonce shape). Finish `credential-bridge-siwe`. |
| **FR-A2** | On verify: resolve-or-create `user_id` (FR-R6) → `mint-jwt-orchestrator` constructs claims → `JWTSigner` issues → Hyper encrypted-cookie session + CSRF. |
| **FR-A3** | Session-validation middleware (consumes the JWKS) usable by honey-road + Sietch. |
| **FR-A4** | `credential-bridge-dynamic` retained for **backfill only**; `dynamic_user_id` lands in `linked_accounts`. No Dynamic SDK in the live credential path. |
| **FR-A5** | Honey-road login swaps Dynamic → identity-api sessions; no embedded-wallet onboarding dependency. |

### §4.4 JWT issuance via port (G-3 / D7)

| ID | Requirement |
|----|-------------|
| **FR-J1** | `mint-jwt-orchestrator` constructs tenant-scoped claims; **never signs** (building royal decree) — delegates to the `JWTSigner` port. |
| **FR-J2** | v1 `LocalEs256Signer` adapter: ES256, own JWKS at `/.well-known/jwks.json`, overlap-window key rotation (harvested from loa-freeside `jwt-service.ts`). |
| **FR-J3** | `HttpJWTSigner` seam retained: swapping the port impl points issuance at the platform Rust gateway `/issue` when available — one-line change, no orchestrator edit. |

### §4.5 Profile serving — read-time compose, no embed (G-5 / D8)

| ID | Requirement |
|----|-------------|
| **FR-P1** | `getProfile(user_id\|wallet, world_slug)` JOINs spine + holdings (inventory-api) + score (score-api) + world content (codex) via wallet[]. |
| **FR-P2** | Fan-out with per-source timeouts + `Promise.allSettled`; downstream failure → partial profile + `degraded[]`, never a hard 5xx (D6). |
| **FR-P3** | **No-embed invariant:** the spine stores no score/holdings/dimensions; composition is live-join only (score-vs-identity boundary). |
| **FR-P4** | Profile shape sealed in `packages/protocol/`; consumed via `@0xhoneyjar/identity`. |

### §4.6 Mibera dimensions on the honey road (G-6)

| ID | Requirement |
|----|-------------|
| **FR-M1** | `getMiberaDimensions(user_id\|wallet)` → per-token 7-dim profile (archetype/ancestor/element/tarot/era/molecule/swag + grail); tokens via inventory-api holdings, traits via codex. |
| **FR-M2** | honey-road reads from `@0xhoneyjar/identity` (replacing `lib/alchemy.ts`) and renders the **survey** (semantics §9 Q1, default self-view). |
| **FR-M3** | grail-ness surfaced verbatim from codex (codex-authoritative). |

### §4.7 cycle-c redirect (G-4)

| ID | Requirement |
|----|-------------|
| **FR-C1** | `IdentityLinkPort` impl POSTs verified linkage to identity-api, replacing cycle-c's direct `MidiPgIdentityLink` PG write. |
| **FR-C2** | Sietch `VerificationService.completeSession` calls it; failure isolation preserved (cycle-c NFR-3). |
| **FR-C3** | Conflict handling per D9 (server-side in identity-api). |
| **FR-C4** | One-time idempotent/reversible `midi_profiles` backfill into the spine (reuse the existing `pg-midi-profiles` adapter as the read source). |

---

## §5 Non-Functional Requirements

| ID | Requirement |
|----|-------------|
| **NFR-1** | Resolve < 100ms p95 (local spine); compose profile < 800ms p95 (bounded by slowest downstream timeout). |
| **NFR-2** | Isolation (D6): downstream outage degrades profile only — never auth/resolve. |
| **NFR-3** | Single Railway service; identity-api owns its Postgres spine. |
| **NFR-4** | Sovereignty: no Dynamic in the live credential path; ES256 keys self-hosted (32-byte minimum), overlap rotation. |
| **NFR-5** | Auditability: link/unlink/primary-change/conflict emit audit events (reuse the building's audit hook). |
| **NFR-6** | Two-organ parity: every capability via typed SDK + MCP (Hyper one-definition). |
| **NFR-7** | Idempotency: re-link is a no-op; spine writes are upserts with conflict policy (D9). |
| **NFR-8** | Backfill safety: `midi_profiles` import idempotent + reversible, row-count verified. |
| **NFR-9** | Adopt loa-freeside's JWKS resilience: tiered cache (fresh<1h / stale<72h / 60s cooldown), single-flight dedup, clock-skew leeway. |

---

## §6 Architecture

```mermaid
graph TD
    SIETCH["Sietch / Discord verify (client)"]
    HR["honey road (mibera-world)"]
    IDAPI["identity-api · Hyper · single Railway<br/>(renamed freeside-identity)<br/>1 auth: SIWE + mint-orchestrator<br/>2 resolve: spine SoR (4-tier, wallet-first)<br/>3 serve: read-time compose"]
    PG["identity-api Postgres (spine only)"]
    SIGN["JWTSigner port<br/>v1: local ES256 · later: platform Rust gateway"]
    INV["inventory-api"]; SCORE["score-api"]; CODEX["codex"]
    SIETCH -->|FR-C1 linkage write| IDAPI
    HR -->|session + getProfile| IDAPI
    IDAPI --> PG
    IDAPI -->|claims → sign| SIGN
    IDAPI -->|JOIN via wallet[], no embed| INV
    IDAPI --> SCORE
    IDAPI --> CODEX
```

**Reused (extend, don't rebuild):** `engine/{resolve-tier, jwt-verify, mint-jwt-orchestrator}`, `adapters/{http-jwt-signer, jwks-validator, pg-midi-profiles}`, `protocol/{user, identity-component, jwt-claims, resolve-result, credential-siwe}`, `ports/{i-identity-service, i-jwks-provider, i-credential-bridge, JWTSigner}`, `mcp-tools`. Plus harvested-from-loa-freeside patterns: ES256 + JWKS overlap rotation, tiered JWKS cache, server-side session extraction.
**New:** the spine as a written SoR (vs read-only midi adapter), `LocalEs256Signer`, the compose endpoint, the codex dimensions resolver, the `IdentityLinkPort`, the `@0xhoneyjar/identity` SDK.
**Left behind from loa-freeside:** Vault Transit (use Bun `crypto`), conviction-scoring-as-tier (use SIWE/on-chain), OAuth token encryption.

---

## §7 Sequenced delivery

| Phase | Goals | Lands |
|-------|-------|-------|
| **1 · Rename + Spine + Auth** | G-1, G-2, G-3 | rename → identity-api; spine as written SoR (refactor resolve-tier wallet-first); SIWE credential bridge; JWTSigner local-signer; Dynamic → backfill; beacon/registry/SDK/MCP |
| **2 · Serve** | G-5 | read-time compose (inventory+score+codex), no-embed invariant, sealed profile schema |
| **3 · Mibera** | G-6 | codex 7-dim resolver + honey-road survey swap |
| **4 · Redirect** | G-4 | `IdentityLinkPort` → identity-api; Sietch wired; midi backfill |

---

## §8 Risks + mitigations

| Risk | Mitigation |
|------|------------|
| Dynamic removal regresses onboarding UX | accepted (wallet-first); passkey/email later via the reserved credential bridges |
| Scope migration (`@freeside-auth/*` → `@0xhoneyjar/identity`) breaks cycle-c's imports | stage the rename; keep import aliases during cutover; coordinate with cycle-c |
| Writer graduation diverges from midi mid-flight | backfill once, then make midi read identity-api; keep `pg-midi-profiles` read path during cutover |
| Local signer now, gateway later = two issuers | the `JWTSigner` port isolates the swap; JWKS overlap rotation covers the transition |
| Compose latency / downstream outage | NFR-1/2: per-source timeouts + graceful degradation |
| cycle-c redirect couples two cycles | sequence it last; keep cycle-c's direct write as fallback during cutover |
| Doctrine drift (INTENT.md still says read-side) | Phase-1 rewrites INTENT.md + the beacon `is_not` to the SoR posture |

---

## §9 Open questions (non-blocking)

1. **"Survey" semantics (G-6):** self-view / cross-holder query / leaderboard? Default v1 **self-view**.
2. **Conflict policy (D9):** inherit cycle-c FR-L3 (latest-wins + hard-fail third-party) or first-claim-wins?
3. **Redirect sequencing (G-4):** cycle-c ships its midi write then we cut over, vs cycle-c targets identity-api from the start.
4. **npm scope cutover:** big-bang `@freeside-auth/*` → `@0xhoneyjar/identity`, or alias period?
5. **Worlds SoT:** `worlds` seeded from the freeside-worlds registry at deploy, or queried at runtime?

---

## §10 Dependencies

| Dependency | Role | State |
|------------|------|-------|
| `freeside-identity` repo (→ identity-api) | THE building — extend it | exists; `@freeside-auth` engine/adapters/protocol merged (cycle-B PR #1) |
| Hyper (hyperjs.ai) | runtime + OpenAPI + typed client + MCP | external; spike Phase 1 |
| platform Rust gateway (`apps/gateway`) | future signing delegation (JWTSigner) | platform substrate; v1 not required |
| inventory-api (`@0xhoneyjar/inventory`) | holdings (compose) | typed SDK exists (baseline) |
| score-api | score (compose) | exists; typed facade to verify |
| codex (mibera-codex) | 7-dim traits + grail | exists; read-only |
| cycle-c-freeside-auth-substrate | verify lifecycle + linkage to redirect | ready; couples at Phase 4 |
| Sietch verification substrate | reused verify + call-site | production-grade |
| mcp-gateway | discovery/federation | live |
| midi_profiles (mibera-honeyroad) | backfill source (via `pg-midi-profiles`) | schema exists |

---

## §11 Third-Pass Reconciliation — merge with the building's 2026-04-30 plan + operator corrections

identity-api = the existing `freeside-identity`/`@freeside-auth` building, which has its **own mature plan** (`~/Documents/GitHub/freeside-auth/grimoires/`, 2026-04-30, ready-for-architect: canonical user spine, 3-layer split, per-world heterogeneity, ADR-039 superseding ADR-003/038, 40 beads). This section merges that plan + this PRD + the operator's scale-corrections into one authoritative direction.

### Operator corrections (2026-05-24)
- **Scale: ~<100 users matter** (NOT the building plan's 98,320). Dynamic auth data is **already in Railway DBs**; per-app profiles exist; **mibera-db holds the profiles** (the `midi_profiles` table: `discord_id`/`wallet_address`/`dynamic_user_id`). → migration collapses to a **trivial one-time backfill** — the building's 98k migration tooling (its FR-5 / M3 / GOAL-5) is **de-scoped**.
- **Centralize identity** for the ecosystem; **ease of operation is a goal**. Users span apps/worlds; **worlds can contain multiple apps** (apps nest in worlds — the `world_identity` is per-world, shared by a world's apps).

### Adopted FROM the building's 2026-04-30 plan
- Canonical user spine: **ULID `user_id`**, `credentials[]` graph, relink mutates the array not the `sub` (building FR-1) — refine §4.2.
- **Per-world heterogeneity (building FR-4) — KEPT as architecture**; v1 ships the **wallet/SIWE adapter only**; a `world-manifest` declares accepted credential adapters (minimal mechanism in v1).
- Credential adapters: **SIWE primary**; **Dynamic = a per-world opt-in credential, NOT the spine** (building FR-2.6, refined 2026-05-01: "refuse Dynamic as the SPINE, not as a credential adapter"); passkey / Better Auth / Discord-bot-attestation deferred.
- JWKS **claims shape** mirror: `sub`·`wallets[]`·`credentials[]`·`tenant_id`(world slug)·`tier`·`exp`·`iss`·`aud`·`iat`·`jti` (building FR-3.1).
- **ADR-039** (supersedes ADR-003 + ADR-038) — file as part of this work.
- MCP tools: `resolve_wallet`, `link_credential`, `issue_jwt_for_world` (building FR-7).

### Superseded BY this session (operator-ratified)
- **Writer:** building = "midi is writer, freeside-auth reads." → **SoR**: identity-api writes the spine; mibera-db → trivial backfill → then reads from identity-api. Justified by <100 users (the migration risk that drove the read-side caution is gone).
- **First consumer:** building's slice = Sprawl Dashboard cutover → **Mibera honey-road dimensions survey (G-6)**; Sprawl Dashboard becomes a later slice.
- **Credential default:** building leaned Better Auth POC → **wallet/SIWE-first**; Better Auth deferred to a per-world adapter.
- **JWT issuance:** building = JWKS stays in the Rust gateway → **`JWTSigner` port, local ES256 signer v1**; the gateway is the preserved delegation seam (Q2).

### Net v1 (reconciled, authoritative)
Rename `freeside-identity` → `identity-api`; **extend** its packages. Central **SoR** spine (ULID users / wallets / credentials[] / linked_accounts / worlds / world_identity), **backfilled from mibera-db** (~<100 users); apps nest in worlds. **Wallet/SIWE** credential (Dynamic → backfill + per-world opt-in); JWT via **port** (local signer). **Read-time compose**; **Mibera dimensions on the honey road = the v1 slice**. **Per-world heterogeneity present as architecture** (world-manifest), wallet-only adapter in v1. **ADR-039** filed. **Ease of operation** is a first-class goal (one canonical, easy-to-run identity store).

### Beads reconciliation (deferred to the repo-move)
loa-freeside cycle-046 has **29 `arrakis-*` beads** (this session); the building has **40 `bd-*` beads** (2026-04-30). When the plan ports into the identity-api repo: keep building beads that survive (canonical spine, credential adapters, JWKS validator, MCP), **retire** the 98k-migration + Sprawl-Dashboard-slice beads, **add** the Mibera-slice + SoR-write + compose beads.

---

> **Sources** (grounded): operator forks + reconciliation 2026-05-24 · `freeside-identity` repo internals (engine `mint-jwt-orchestrator` "never signs / delegates to JWTSigner"; `adapters/http-jwt-signer`; `docs/INTENT.md` + `INTEGRATION-PATH.md`; 4-tier resolve) · vault doctrine `freeside-as-identity-spine.md` + `score-vs-identity-boundary.md` (operator-activated, usable) · loa-freeside auth harvest (`packages/adapters/agent/{jwt-service,s2s-jwt-validator}.ts`, `packages/adapters/security/wallet-verification.ts`, `packages/core/ports/*`) · ADR-008 §D-11/§D-8 · cycle-c PRD · npm scope `@0xhoneyjar` (memory project_freeside-npm-scope-and-consume) · loa-oracle = optional ACVP power-up (out of v1).

*PRD v2.0 (reconciled) authored 2026-05-24. Supersedes v1 greenfield baseline @ ddf1a11d. Ready for SDD reconciliation + sprint/beads update.*

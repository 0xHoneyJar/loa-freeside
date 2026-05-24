---
title: Repo-Move Runbook — freeside-identity → identity-api
cycle: identity-api-2026-05-24 (cycle-046)
status: ready-to-execute (handoff)
date: 2026-05-24
authoritative_plan: grimoires/loa/prd.md (PRD v3.0 — §11 third-pass reconciliation)
building_repo: 0xHoneyJar/freeside-identity (alias redirect: freeside-auth) · local checkout ~/Documents/GitHub/freeside-auth
owner: zksoju
---

# Repo-Move Runbook — `freeside-identity` → `identity-api`

> **Goal:** land the reconciled identity-api plan (PRD v3.0) in the building repo and build Phase 1. This is a **cross-repo, partly outward-facing** phase — run it as a fresh focused session.

## 0 · Context (read first)

- **identity-api is NOT greenfield.** It is the existing **`freeside-identity`** repo, which houses the **`@freeside-auth`** building (`packages/{engine,adapters,protocol,ports,mcp-tools,ui}`, merged cycle-B PR #1). Local checkout: `~/Documents/GitHub/freeside-auth` (remote uses the `freeside-auth` alias, which GitHub redirects to `freeside-identity`).
- **The reconciled plan is PRD v3.0** (`grimoires/loa/prd.md` here in loa-freeside, §11). It merges: this session's forks (SoR, Mibera headline, JWTSigner port, read-time compose) + the building's own 2026-04-30 plan (canonical ULID spine, per-world heterogeneity, ADR-039, 40 beads) + the operator's scale corrections.
- **Operator corrections (load-bearing):** ~**<100 users** matter (not the building plan's 98,320) · Dynamic auth data **already in Railway** · **mibera-db holds profiles** (`midi_profiles`) · **centralize identity, easy to operate** · worlds contain multiple apps (apps nest in worlds).
- **Net v1:** rename+extend · central **SoR** spine backfilled from mibera-db (trivial, <100 users) · **wallet/SIWE** (Dynamic→per-world-opt-in, never the spine) · JWT via **port** (local signer v1) · **read-time compose, no embed** · **Mibera honey-road = v1 slice** · per-world heterogeneity kept as architecture (wallet-only v1) · file **ADR-039** · ease-of-operation first-class.

## Pre-flight (confirm before step 1)

- [ ] `gh auth status` — push access to `0xHoneyJar/freeside-identity`.
- [ ] Identify every consumer of the `@freeside-auth/*` packages (esp. **cycle-c** in loa-freeside: `themes/sietch` imports `@freeside-auth/{protocol,engine,adapters}`). The scope migration (step 2) breaks these until aliased.
- [ ] Confirm read access to **mibera-db** (Railway) — the `midi_profiles` backfill source. (Building's 2026-04-30 plan flagged "soju Railway DB read access" as an open coordination dep.)
- [ ] Decide the 5 open questions (PRD v3.0 §9): survey semantics (default self-view), conflict policy (default cycle-c FR-L3), redirect sequencing, npm-scope cutover style, worlds SoT.

## Step 1 — Rename the repo (OUTWARD-FACING — confirm before firing)

- [ ] `gh repo rename identity-api --repo 0xHoneyJar/freeside-identity` (GitHub keeps `freeside-identity` + `freeside-auth` as redirect aliases).
- [ ] Update local remote: `git -C ~/Documents/GitHub/freeside-auth remote set-url origin https://github.com/0xHoneyJar/identity-api.git`.
- [ ] (Optional) rename local dir `~/Documents/GitHub/freeside-auth` → `~/Documents/GitHub/identity-api`.
- [ ] Update references: `packages/freeside-registry/registry.yaml` (here) + any `git_url`/`beacon_url`; the building's `README.md` + `CLAUDE.md`.
- ⚠️ Redirects keep old URLs working, but update them anyway for clarity (ease-of-operation).

## Step 2 — npm scope migration (staged)

- [ ] Root pkg `freeside-auth` → `@0xhoneyjar/identity`; sub-packages `@freeside-auth/{engine,adapters,protocol,ports,mcp-tools}` → `@0xhoneyjar/identity-{engine,…}` (or a single `@0xhoneyjar/identity` with subpath exports — decide).
- [ ] **Alias period:** keep `@freeside-auth/*` re-export shims so **cycle-c** keeps building during cutover; coordinate cycle-c's import swap, then drop shims.
- [ ] Per memory `project_freeside-npm-scope-and-consume`: org scope is `@0xhoneyjar` (NOT `@freeside`).

## Step 3 — Port the reconciled plan into the building

- [ ] Bring **PRD v3.0** into the building's `grimoires/` as the authoritative plan; mark the building's 2026-04-30 `prd.md` **superseded** (keep for provenance).
- [ ] Reconcile the building's `sdd.md`/`sprint.md` against PRD v3.0 (the loa-freeside SDD + sprint here carry the engineering; the building's SDD has the canonical-spine + JWKS detail — merge).

## Step 4 — Reconcile the beads (40 `bd-*` ⊕ 29 `arrakis-*`)

Into one task graph in the identity-api repo:

| Action | Beads |
|--------|-------|
| **KEEP** (building survivors) | canonical ULID spine, credential adapters (SIWE), JWKS validator, MCP tools, ADR-039, per-world manifest |
| **KEEP** (this-session) | rename+extend (T1.1), spine-as-SoR write + wallet-first re-tier, JWTSigner local signer (T1.J), read-time compose (Phase 2), Mibera dimensions (Phase 3) |
| **RETIRE** | 98k Dynamic-CSV migration tooling (FR-5/M3), Sprawl-Dashboard vertical slice, Better-Auth-POC-as-v1 |
| **ADD** | mibera-db backfill (<100 users), Mibera honey-road slice as the v1 vertical, ease-of-operation/ops tasks |
| **STAYS in loa-freeside** | the **Phase-4 cycle-c redirect** beads (`arrakis-zedx`, `arrakis-vjjz` — `domain:platform`; `arrakis-ll70` — `domain:network`) |

## Step 5 — Mount Loa in the building

- [ ] The building has `grimoires/` + `.beads/` + `CLAUDE.md` but **no `.claude/`** → run `/mount` (or `loa-setup`) so it can run `/build → /review → /audit`.

## Step 6 — Build Phase 1 (in identity-api)

Per PRD v3.0 §7 + the reconciled beads:
- [ ] rename+extend the existing packages to building-standard.
- [ ] spine as written **SoR** (ULID users / wallets / credentials[] / linked_accounts / worlds / world_identity); refactor the existing 4-tier `resolve-tier` to **write + wallet-first**; **backfill from mibera-db** (<100 users, idempotent/reversible).
- [ ] **wallet/SIWE** credential (finish `credential-bridge-siwe`); `credential-bridge-dynamic` → backfill + per-world opt-in.
- [ ] JWT via `JWTSigner` port → **local ES256 signer** + own JWKS (seam preserved for platform-gateway delegation).
- [ ] BeaconV3 (rewrite `is_not` read-side → SoR) + registry entry + `@0xhoneyjar/identity` SDK + MCP tenant.
- [ ] file **ADR-039** (supersedes ADR-003 + ADR-038).
- [ ] Phase 2 (read-time compose, no-embed) → Phase 3 (Mibera honey-road survey) → Phase 4 (cycle-c redirect, lands in loa-freeside).

## Step 7 — loa-freeside's residual scope

- [ ] Only the **Phase-4 cycle-c redirect** stays here (`IdentityLinkPort` → identity-api; Sietch wire; midi backfill source). loa-freeside = **platform**; identity-api is the building.

## Coordination / risks

- **cycle-c imports** `@freeside-auth/*` — the rename + scope migration must not break its build (alias shims, step 2).
- **@janitooor** owns the loa-freeside Rust gateway (the future JWTSigner delegation target) — coordinate the claims shape (building FR-3.1) before flipping the port from local signer.
- **Railway/mibera-db** read access for the backfill (open dep).
- **ADR-039** must land in `0xHoneyJar/hivemind`.

> **Provenance:** PRD v3.0 §11 (this loa-freeside cycle-046) + building's `grimoires/{prd,sdd,sprint}.md` (2026-04-30) + operator corrections 2026-05-24. v2.0 baseline @ `8fa9b106`.

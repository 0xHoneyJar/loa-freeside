---
title: freeside-federation topology — where the operator dashboard lives [SUPERSEDED]
status: superseded
superseded_by: grimoires/loa/proposals/freeside-operator-dash-kickoff.md
superseded_reason: |
  Adversarial review (2026-05-25) caught: this proposal was reasoning about a
  topology that ADR-009 (decisions/009-freeside-hexagonal-federation.md,
  Accepted 2026-05-25) had already settled THREE DAYS PRIOR. Options A vs B
  were re-litigated; the actual decision (registry + gateway as SEPARATE
  network-scope components per D-5) was already in canon. Naming was also
  stale by 48 hours — *-api convention ratified 2026-05-23 in
  grimoires/loa/specs/enhance-freeside-api-surface.md.

  Retained as audit trail / bridgebuilder review evidence; do NOT use as
  guidance for any new work.
date: 2026-05-25
author: soju (via GECKO-embodied claude)
review_requested: bridgebuilder / adversarial multi-model
review_outcome: bridgebuilder verdict E (drop everything in the proposal; do the smaller correct thing)
related:
  - decisions/007-loa-freeside-absorption.md (ADR-007 — BINDING)
  - decisions/008-freeside-as-factory.md (ADR-008 — ORIENTATION)
  - decisions/009-freeside-hexagonal-federation.md (ADR-009 — SETTLES TOPOLOGY; missed by this proposal)
  - packages/freeside-registry/README.md (scaffold)
  - apps/mcp-gateway/src/app.ts (working federation server)
goals_original:
  - G-OPS-1: operator can see freeside-* API health in one pane
  - G-OPS-2: naming reflects internal-API-first reality (MCP is future capability, not present need)
  - G-OPS-3: don't ship a name we'll regret when MCP federation becomes real
---

> ⚠ **THIS PROPOSAL IS SUPERSEDED.** See [`freeside-operator-dash-kickoff.md`](../freeside-operator-dash-kickoff.md) for current direction. Retained in archive as bridgebuilder-review audit trail.

# freeside-federation topology

## Pushback (the thing to doubt first)

**The whole question might be premature.** `tools/operator-dash/` as static HTML + a Node probe script ships visibility TODAY without committing to a topology. The federation-vs-registry-vs-mcp naming question can wait until the dash is in operator hands and the FAANG-shape requirements (multi-team, multi-environment, alarm routing) actually surface. **Naming optimization in advance of usage is YAGNI.** Counter-argument: the operator named the question explicitly and asked for adversarial review — that itself is signal that the substrate question matters now.

## The problem in one line

`apps/mcp-gateway/` is doing two jobs (MCP protocol routing + internal API registry/health) under an MCP-flavored name. `packages/freeside-registry/` was meant to be the registry but is scaffold-only. The operator (small team, FAANG-pattern) needs one pane to monitor all freeside-* API health, and the name shouldn't pre-commit to MCP-as-the-only-protocol.

## Current state (verified)

| Component | Path | Status | What it does |
|---|---|---|---|
| `packages/freeside-registry/` | scaffold | README + `registry.yaml` (6 modules) + empty src | Planned per ADR-007 §D-5 to serve `/.well-known/federation.json`. Not implemented. (Note: `packages/freeside-registry/README.md` omits the `.well-known` prefix — drift vs the actual implemented path in `apps/mcp-gateway/src/app.ts:12`; sweep target.) |
| `apps/mcp-gateway/` | running | Hono service, full federation manifest + 30s tenant probing + 5min beacon refresh + path-routing | The actual working federation logic, MCP-named. Tenants.ts comment: "the gateway IS a registry, not a vault." |
| `packages/beacon-schema/` | working | BeaconV3 schema | Self-declaration contract. |
| `mcp.0xhoneyjar.xyz` domain | reserved | MCP-flavored URL | Pre-commits to MCP-as-the-only-protocol. |
| `identity-api` (Railway) | live | Phase 1 deployed, Phase 2-4 not built | NOT registered in `registry.yaml` yet. |
| operator dashboard | doesn't exist | — | The ask. |

## Decision space

### Option A — Lift-and-shift: `freeside-registry` absorbs federation logic, `mcp-gateway` becomes one consumer

Pull the federation-server logic out of `apps/mcp-gateway/src/app.ts` and into `packages/freeside-registry/src/server.ts` (per ADR-007 §D-5 planned shape). Then:
- `packages/freeside-registry/` = the registry service (serves `/.well-known/federation.json`, hosts the operator dash at `/operator/`, runs probes)
- `apps/mcp-gateway/` = MCP-protocol-specific consumer (path routing `/{tenant}/mcp/*` only)
- Operator dash served at `federation.0xhoneyjar.xyz/operator/` (new subdomain, OR at `0xhoneyjar.xyz/operator/`)

**Pro**: matches ADR-007 plan exactly; clean separation; MCP is one consumer of registry not the registry itself; namespace honest (registry ≠ MCP).
**Con**: real refactor work (move ~600 lines, rewire imports, redeploy gateway, possibly second Railway service); time-to-dash extends.

### Option B — Rename in place: `apps/mcp-gateway/` → `apps/freeside-federation/`, dash co-located

Rename the directory, the package name (`@0xhoneyjar/freeside-mcp-gateway` → `@0xhoneyjar/freeside-federation`), the domain (`mcp.0xhoneyjar.xyz` → `federation.0xhoneyjar.xyz`). Add `/operator` HTML route. Keep `/{tenant}/mcp/*` paths as one of N protocol surfaces inside the federation app.

**Pro**: no logic moves; the existing federation logic stays where it already works; one service deployed; rename reflects reality (internal API registry, MCP is one path-prefix family).
**Con**: rename touches DNS, package deps, workspace refs, deployment configs; some MCP-aware downstream consumers may break; doesn't fix the `freeside-registry/` scaffold (it stays empty).

### Option C — Ship tools/, defer topology (RECOMMENDED FOR THIS SESSION)

Build `tools/operator-dash/` as a static HTML + Node probe script. Lives in repo, runs locally, opens in browser. Zero infra. Zero topology commitment. Use this session to **ship visibility**. Surface the lift/rename question as a follow-up sprint with proper SDD/sprint-plan.

**Pro**: ships today; reversible; operator gets visibility immediately; topology can be decided when the dash's actual needs are clearer (does it need live updates? auth? multi-tenant scoping? — answers emerge from use).
**Con**: doesn't formalize the federation surface; doesn't honor the ADR-007 plan; tools/ is the orphans-shelf and dashes there can rot.

### Option D — Hybrid: tools/ dash now, BUT name the topology decision a P0 follow-up

Same as C operationally, but commit to a hard deadline (e.g., next sprint cycle) to resolve A vs B with full SDD. Dash lives in tools/ for ≤2 weeks, then migrates to its decided home.

**Pro**: ships fast, doesn't kick the can; forces the operator to make the topology call with the dash already informing it.
**Con**: requires discipline to actually run the follow-up sprint.

## What I'd doubt (operator-friendly self-audit)

1. **"FAANG pattern" might be wrong frame for current state.** FAANG operates 10k+ services. THJ operates ~7 freeside-* buildings (most not deployed). The dash needs match the team size (operator + a few collaborators), not the eventual scale. Designing for 10k-service operator concerns now = premature scaling.
2. **Registry vs federation might be the same word for two layers.** registry = list of buildings. federation = the runtime that exposes them. Lifting one out of the other is correct IF both layers warrant separate code paths. They might not yet.
3. **Operator's MCP-as-future framing assumes MCP becomes external.** If MCP stays internal (claude-code tools for the team), then `mcp.0xhoneyjar.xyz` is fine as an internal subdomain and the rename is cosmetic. If MCP becomes a partner-facing surface (other agents consume our APIs via MCP), then the federation/MCP separation is load-bearing.
4. **`identity-api` not being in `registry.yaml`** is a real defect. Whatever topology wins, that must land. The dash will surface this as an immediate red row.

## Recommendation

**Option C for THIS session. Option D as the operator-confirmed path forward.**

Build `tools/operator-dash/` now. Add `identity-api` to `registry.yaml` as a small inline fix while we're here. Open a P0 follow-up issue (or beads epic) to formally resolve A vs B in the next cycle, gated by adversarial review of this brief.

## What I haven't grounded yet

- Whether `mcp.0xhoneyjar.xyz` has external-partner traffic (would change rename cost calculus)
- What's actually deployed at the freeside-* subdomains (sonar / storage / mint / activities / inventory) — registry.yaml lists URLs but they may 404
- Operator's actual on-call cadence (does the dash need alerting? paging? or just at-a-glance?)
- Whether `score-mibera` (live, registered) needs special tiering vs the not-yet-deployed buildings

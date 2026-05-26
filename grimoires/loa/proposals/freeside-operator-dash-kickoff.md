---
title: freeside-operator-dash — inward-facing operator visibility, cluster-meta cycle
status: proposed
date: 2026-05-25
author: soju (via GECKO-embodied claude)
review_requested: operator (zerkereth)
review_kind: synchronous-pair-point (not flatline; operator IS the reviewer per 2026-05-25 session)
anchors:
  - decisions/009-freeside-hexagonal-federation.md (ADR-009 D-5 federation discovery · D-7 cluster-meta cycle · D-8 dashboard composition · D-9 two-persona internal scope · D-13 cluster compliance predicate)
  - grimoires/loa/specs/enhance-freeside-api-surface.md (2026-05-23 kickoff that EXPLICITLY DEFERRED this dashboard as "operator-visibility surface from session 1 — a separate follow-up")
  - grimoires/freeside-network/cluster-harness-audit-2026-05-25/ (adjacent cluster-meta work; this proposal is its sibling)
  - grimoires/loa/proposals/archive/freeside-federation-topology.md (superseded predecessor + bridgebuilder verdict, retained as audit trail)
supersedes: grimoires/loa/proposals/freeside-federation-topology.md
domain: network
cycle_anchor: grimoires/freeside-network/cluster-2026-05-25-operator-dash/ (to be created)
branch: cluster-meta/operator-dash (new, NOT piggybacking on cluster-meta/compliance-gate)
---

# freeside-operator-dash — kickoff

> Build the **inward-facing operator visibility surface** the THJ team needs to operate the
> 8-cell HEXAGONAL FEDERATION as a small team. Lives at `apps/freeside-operator-dash/`,
> sibling to `apps/mcp-gateway/`. Outward-facing federation discovery (mcp-gateway) and
> inward-facing operator awareness (this) are two apps with two audiences in the same
> network scope per [ADR-009 §D-5](../../../decisions/009-freeside-hexagonal-federation.md).

**Date**: 2026-05-25 · **Target**: `loa-freeside` (network scope) · **Cycle type**: cluster-meta per ADR-009 §D-7

## Context

This is the deferred follow-up from `enhance-freeside-api-surface.md` (2026-05-23, §"What NOT to build"):

> *Do NOT build a registry UI / "factory floor" dashboard here (that's the **operator-visibility surface from session 1 — a separate follow-up**; T2 is machine/runtime).*

ADR-009 (2026-05-25) ratified:
- **D-5**: federation discovery (registry + tenants + schema + cli) lives in network scope of loa-freeside
- **D-7**: cluster-meta cycle type runs from `grimoires/freeside-network/cluster-*`
- **D-8**: the *marketplace* dashboard (Freeside Dashboard, currently `score-dashboard` with `(cm-shell)` layout) serves external CMs — that's a DIFFERENT surface, lives in its own repo
- **D-9**: two-persona product model — external CM (community managers) vs **internal operator (THJ team)**. This dashboard serves the INTERNAL operator persona only.
- **D-13**: cluster compliance predicate already runs via `cluster-compliance.yml` workflow — this dash makes the predicate's findings legible

The bridgebuilder adversarial review of the predecessor proposal (archived) caught critical drift:
- F3: every `*.0xhoneyjar.xyz/.well-known/beacon.json` returns Vercel 404 today (gateway HTML serves a list of dead URLs)
- F2: `*-api` rename sweep is overdue (8 cells per D-2: `sonar-api · storage-api · mint-api · activities-api · inventory-api · score-api · identity-api · mediums-api`)
- F3: `apps/mcp-gateway/src/tenants.ts` declares `score: status: "live"` but `score-api-production.up.railway.app/healthz` returns 404
- F5: this dashboard belongs in cluster-meta scope — you're already on `cluster-meta/compliance-gate` branch

Full bridgebuilder findings: see **Appendix A** below.

## Headline decision — inward vs outward, two apps in network scope

| App | Audience | Purpose | Visibility |
|---|---|---|---|
| `apps/mcp-gateway/` (exists) | External partners + agent clients | Federation discovery + MCP path-routing for `*-api` cells | Public — `mcp.0xhoneyjar.xyz` |
| `apps/freeside-operator-dash/` (THIS) | THJ team (internal-operator persona per ADR-009 D-9) | Cluster health + Soju-lens identity reconciliation + compliance-predicate visualization | Internal-only — auth-gated, allowlisted THJ wallets |

The two are sibling apps. Both load from the same SOURCE OF TRUTH (`packages/freeside-registry/registry.yaml` + `apps/mcp-gateway/src/tenants.ts`) but RENDER to different audiences. mcp-gateway exposes the federation; freeside-operator-dash exposes operator awareness over the federation.

## Tracks

### T0 — Naming sweep + lie correction (PRE-REQUISITE, ships first)

**Goal**: registry + tenants in compliance with ADR-009 D-2 before the dash renders anything.

- Rename `packages/freeside-registry/registry.yaml` entries to `*-api` convention (6 modules → 8 modules; add `identity-api`, add `mediums-api`)
- Update `apps/mcp-gateway/src/tenants.ts`: kill the `score: status: "live"` lie (mark `paused` until score-api-production is reachable OR remove until live); audit `codex` similarly
- Update `packages/freeside-registry/README.md` to use `/.well-known/federation.json` (drift fixed in this PR; was missing the `.well-known` prefix)
- Validate via `loa freeside doctor` (stub today; may need real implementation per T2 of enhance-freeside-api-surface)

**Blast radius**: network-scope only (`packages/freeside-registry/` + `apps/mcp-gateway/` + 1 README). CI firewall keeps it clean.
**Estimated effort**: 1-2 hours (15-min PR per bridgebuilder, plus tenant lie reconciliation).

### T1 — `apps/freeside-operator-dash/` scaffold

**Goal**: Hono service mirroring `apps/mcp-gateway/` shape, sibling deployment slot.

- `apps/freeside-operator-dash/` with same structure as `apps/mcp-gateway/`: `bin/http.ts`, `src/app.ts`, `package.json`, `tsconfig.json`
- Effect.Schema for any wire-shape; vendor BeaconV3 schema from `packages/beacon-schema/`
- Reads `packages/freeside-registry/registry.yaml` + `apps/mcp-gateway/src/tenants.ts` server-side (no fetch overhead; in-process import)
- Two routes initially:
  - `GET /` → HTML dashboard (rendered from in-process state)
  - `GET /healthz` → `{ ok: true, generatedAt }` for its own health probe
- Auth: deferred to T4. For v0.1, run behind operator's Tailscale or with a simple `OPERATOR_TOKEN` env (do NOT ship public yet).
- Deploy slot: separate Railway service `freeside-operator-dash-production` (or co-located with mcp-gateway if cheaper).

**Blast radius**: new app in network scope. No existing service modified.

### T2 — Soju-lens (the actually-novel primitive, ships v0.1)

**Goal**: parallel-fetch the operator's identity through every surface that exposes one, surface DISCREPANCIES not just status.

Concrete:
- Input: an operator wallet (env var `OPERATOR_WALLET` or query param)
- Probes in parallel (Promise.allSettled):
  - `identity-api /v1/resolve/wallet/:address` (Phase 1 spine, deployed)
  - `identity-api /v1/profile?wallet=` (Phase 2 compose — currently 400, will show "Phase 2 not built")
  - `identity-api /v1/mibera/dimensions?wallet=` (Phase 3 — currently 400, will show "Phase 3 not built")
  - `mibera.honeyjar.xyz /api/profile?wallet=` (honey-road, currently reads from Alchemy)
  - `score-api /v1/holder/:address/score` (when score-api becomes reachable per T0)
  - `inventory-api /v1/inventory/wallet/:address` (when published per registry.yaml)
- Output: discrepancy table — same field (displayName, primaryWallet, miberaDimensions) across surfaces; flag if values disagree or all-error.
- The G-6 blocker becomes IMMEDIATELY visible: "honey-road shows Alchemy fallback; identity-api compose endpoint is 400."

This is the actually-novel observability primitive. Status display is solved (Datadog, BetterStack, ohdear); cross-surface identity reconciliation isn't.

### T3 — Cluster compliance + tile view (secondary)

**Goal**: render `cluster-compliance.yml` workflow output + per-cell beacon state + Loa harness audit.

- Pull latest run of `cluster-compliance.yml` via `gh run list --workflow=cluster-compliance.yml --limit=1 --json` (server-side, with token)
- For each cell in registry.yaml: tile shows compliance predicate (1-7 from ADR-009 D-13), beacon state (live / 404 / not-registered), last deploy timestamp
- Phase scoreboard for `identity-api` specifically (G-1..G-6 with live evidence) — extends as more cells reach runtime

### T4 — Auth + Privy integration (per ADR-009 D-9 internal operator persona)

**Goal**: ship publicly with auth (after v0.1 is in operator hands and shape is proven).

- Privy JWT verification, allowlist `role: cm-internal` per ADR-009 D-9
- Until identity-api JWT issuance for CMs lands, use Privy with small THJ-team wallet allowlist (per D-9 fallback)
- This unblocks deploying at `operator.freeside.0xhoneyjar.xyz` or similar (TBD)

## Blast radius summary

| Track | Files / Repos | Risk |
|---|---|---|
| T0 | `packages/freeside-registry/registry.yaml` + `apps/mcp-gateway/src/tenants.ts` + 1 README | Low (naming, no logic change). Network-scope CI gate passes. |
| T1 | New `apps/freeside-operator-dash/` (~5-10 files) | Low (new app, no existing surface modified). New Railway slot. |
| T2 | Within T1 — adds probe + render logic | Medium (depends on external surfaces being reachable; degraded behavior must be obvious). |
| T3 | Within T1 — adds gh CLI invocation | Low (read-only; needs GITHUB_TOKEN). |
| T4 | T1 + Privy SDK integration | Medium (auth bugs are real; allowlist mitigates blast). |

## Design rules

- **Soju-lens IS the dash's first job.** Status is secondary; discrepancy is the primitive nobody else ships.
- **Two apps, two audiences.** `apps/mcp-gateway/` outward, `apps/freeside-operator-dash/` inward. Don't merge them. Don't rename `mcp-gateway` (cached discovery cards downstream break per bridgebuilder F4).
- **Read SOURCE OF TRUTH server-side.** No browser fetch from registry.yaml / tenants.ts. CORS-free design.
- **Degraded behavior must be obvious.** A 400 from `/v1/profile` should display "Phase 2 not built" not just "error." A 404 beacon should display "registered but not deployed" with link to deploy runbook.
- **Cluster-meta cycle owns the work.** Cycle anchor at `grimoires/freeside-network/cluster-2026-05-25-operator-dash/`; branch `cluster-meta/operator-dash` (separate from `cluster-meta/compliance-gate` currently in-flight).
- **No commitment beyond v0.1 without operator review.** Each Track ships, surfaces to operator, awaits direction before next.

## What NOT to build (scope discipline)

- NOT the marketplace UI for external CMs — that's `score-dashboard` per ADR-009 D-8, different audience, different repo
- NOT a rename of `apps/mcp-gateway/` → `apps/freeside-federation/` — bridgebuilder F4 (real contract break: 7 in-repo files hardcode mcp.0xhoneyjar.xyz, plus every cached MCP discovery card downstream). Defer indefinitely.
- NOT multi-tenant operator scoping — single THJ-team operator persona only for v0.1-v1.0
- NOT a registry UI for editing — registry.yaml mutations stay PR-driven per ADR-009 D-14
- NOT a replacement for Grafana / CloudWatch — the dash is OPERATOR-CONTEXT awareness, not infrastructure metrics
- NOT mid-stage startup / FAANG-Borgmon-shape — the right reference frame is Stripe/Linear-shape dense, action-oriented, single-page (per bridgebuilder F7)

## Verify

- T0 PR: `cluster-compliance.yml` workflow passes against new registry; `loa freeside doctor` (when implemented) recognizes 8 cells
- T1 ship: `curl localhost:3030/healthz` returns 200; `curl localhost:3030/` returns valid HTML; deploys to Railway slot
- T2 ship: with `OPERATOR_WALLET` set, dashboard surfaces the BERA→Soju discrepancy as a visual diff row; operator confirms by visual inspection
- T3 ship: tile grid renders 8 cells with current compliance status; `identity-api` phase scoreboard shows live Phase 1 / scaffolded Phase 2-3 / not-built Phase 4
- T4 ship: Privy auth blocks non-allowlisted wallets; `cm-internal` role required

## /coord dispatch plan (once this proposal is operator-approved)

- **Sweep coordinator**: throwaway at `~/bonfire/operator-dash-coordinator/`, single-repo target (this repo, cluster-meta/operator-dash branch). T0 lands as one PR.
- **Phase 3 coordinator** (separate, parallel-eligible): throwaway at `~/bonfire/identity-api-phase3-coordinator/`, dispatches to `identity-api` repo (T3.1, T3.2) + `mibera-honeyroad` repo (T3.3). The Soju G-6 blocker unblock — runs INDEPENDENT of this dashboard work.
- Dashboard build (T1-T3) runs in main session (this branch); T4 deferred.

## Reviewer ask (operator)

1. Is the inward/outward two-apps framing correct? (Anything I'm missing that argues for merging or splitting differently?)
2. Soju-lens as the primary v0.1 feature — confirm or redirect.
3. Branch `cluster-meta/operator-dash` — confirm separate from `cluster-meta/compliance-gate` in-flight work.
4. T0 sweep — does it ship as a SEPARATE PR before T1 starts, or bundle T0+T1 into one PR?
5. T4 auth deferral — comfortable with v0.1 behind Tailscale / `OPERATOR_TOKEN` env, or want Privy from day 1?
6. /coord parallelism — sweep coord first (serial) THEN Phase 3 coord, OR both in parallel?

---

## Appendix A — Bridgebuilder verdict (2026-05-25, archived predecessor)

Adversarial review caught 6 findings against `grimoires/loa/proposals/archive/freeside-federation-topology.md`:

| # | Severity | Finding (one-line) |
|---|---|---|
| F1 | CRITICAL | ADR-009 already settled the topology 3 days prior; proposal re-litigated decided ground |
| F2 | CRITICAL | `*-api` naming ratified 2026-05-23; proposal used stale `freeside-*` names |
| F3 | HIGH | Every `*.0xhoneyjar.xyz/.well-known/beacon.json` returns Vercel 404 today; `tenants.ts` declares `score: status: "live"` but upstream 404 |
| F4 | HIGH | `mcp.*` → `federation.*` rename is real contract break (7 in-repo files + cached MCP discovery cards downstream) |
| F5 | HIGH | Operator-visibility belongs in cluster-meta scope (operator already on `cluster-meta/compliance-gate` branch) |
| F6 | MED | Soju-lens (discrepancy detection) is the actually-novel primitive — should be the lede, not the closing aside |

Verdict: Option E — "drop everything in the proposal; do the smaller correct thing." This proposal (the present document) IS that smaller correct thing.

## Appendix B — v0 spike reference

`tools/operator-dash/dash.ts` (created 2026-05-25, pre-bridgebuilder) holds the design direction for the eventual `apps/freeside-operator-dash/src/app.ts` rebuild:
- Server-side probe orchestration (Promise.all over targets)
- Soju-lens implementation (parallel-fetch + discrepancy detection)
- HTML render with phase scoreboard + federation tiles + Soju-lens table
- Known issues: missing `yaml` dependency; uses pre-rename `freeside-*` names; lives in `tools/` (wrong per F5)

The spike is preserved (marked v0-superseded) as design evidence. v1 rebuild starts fresh in `apps/freeside-operator-dash/` per T1.

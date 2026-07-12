---
title: cluster-meta cycle — freeside-operator-dash + BERA→Soju diagnostic
date: 2026-05-25
cycle_type: cluster-meta (per ADR-009 §D-7)
branch: cluster-meta/operator-dash
pr: https://github.com/0xHoneyJar/loa-freeside/pull/223
status: substrate landed; operator-side DNS fix pending
constructs_invoked:
  - gecko (BEAUVOIR) — observation + diagnose
  - construct-freeside (KRANZ) — diagnose-site-down skill applied manually
  - bridgebuilder — adversarial review of architecture brief
  - construct-laboratory-substrate — operator-level lab membership (silent, no labels needed for this surface)
---

# cluster-meta cycle 2026-05-25 — operator-dash + BERA→Soju

> **TL;DR.** Operator asked for an HTML dashboard to show all freeside API health + unblock BERA→Soju on Honey Road. The dashboard work was built (PR #223); the actual Soju visibility bug was a DNS-points-at-Vercel-not-Railway gap on `identity.0xhoneyjar.xyz`, discovered mid-build using the same probing patterns the dashboard would surface. The dashboard remains as durable observability substrate for next time.

## Arc of the cycle

| Phase | What happened |
|---|---|
| Frame | Operator: "embody GECKO, build operator dash, unblock Soju on Honey Road" + broad creative latitude |
| Initial proposal | Wrote `grimoires/loa/proposals/freeside-federation-topology.md` — reasoning about where the dash should live (A: lift to freeside-registry; B: rename mcp-gateway → freeside-federation; C: tools/ ship now; D: hybrid) |
| Bridgebuilder review | **Verdict E — drop everything**. ADR-009 (accepted 2026-05-25, three days prior to the original framing date the operator quoted) already settled topology. The naming convention `*-api` was ratified 2026-05-23 in `grimoires/loa/specs/enhance-freeside-api-surface.md`. The original proposal re-litigated decided ground. |
| Reset | Operator: pause, ground in ADR-009, rewrite proposal, operator-review, THEN sweep → dash → /coord. Dash home = `apps/freeside-operator-dash/` sibling to `apps/mcp-gateway/` (inward vs outward facing). |
| Fresh proposal | `grimoires/loa/proposals/freeside-operator-dash-kickoff.md` — anchored in ADR-009 §D-5/§D-7/§D-8/§D-9, bridgebuilder findings as Appendix A |
| Execution | Branched off main (compliance-gate had merged via PR #222). Committed in order: meta work → T0 registry sweep → T1+T2 app scaffold + Soju-lens → ground-truth-fix |
| Mid-build correction | Cockpit on `~/bonfire/identity-api-coordinator` revealed all Phase 1-4 beads closed except T4.E2E. Original framing "Phase 3 not built" was wrong — bare probes of `/v1/profile` returned 400 (missing `world` param), which I'd misread as "endpoint scaffolded, not built." With proper params, all endpoints respond correctly. |
| Root-cause hunt | Investigated Honey Road production env (Vercel project `mibera-interface`): no `IDENTITY_API_URL` set → falls back to `PRODUCTION_BASE_URL = https://identity.0xhoneyjar.xyz`. That URL 404s. `dig` reveals CNAME → `cname.vercel-dns.com` (pointed at Vercel, not Railway). Railway-side, the identity-api service HAS `identity.0xhoneyjar.xyz` configured as a custom domain. **The DNS is the literal one-line fix.** |
| Wrap | PR #223 opened. Memories saved (project + feedback + reference). This artifact distilled. Operator-side DNS fix pending. |

## Artifacts

| Path | Type |
|---|---|
| [PR #223](https://github.com/0xHoneyJar/loa-freeside/pull/223) | 4 commits, ~2300 LOC, branch `cluster-meta/operator-dash` |
| `grimoires/loa/proposals/freeside-operator-dash-kickoff.md` | the canonical proposal |
| `grimoires/loa/proposals/archive/freeside-federation-topology.md` | superseded predecessor + bridgebuilder verdict as audit trail |
| `apps/freeside-operator-dash/` | the inward-facing Hono service (T1+T2) |
| `tools/operator-dash/dash.ts` | v0 spike preserved as design evidence |
| `packages/freeside-registry/registry.yaml` | T0 sweep: 8 `*-api` cells per ADR-009 D-2 + `deployment_url` + `runtime_state` + accurate notes per cell |
| Memories (auto-memory `~/.claude/projects/.../memory/`) | `project_honey-road-vercel-config.md`, `feedback_probe-with-full-contract.md`, `project_identity-api-substrate-deployed.md`, `reference_freeside-construct-skills.md` |

## Operator-side DNS runbook (the remaining work)

```bash
# 1. Get the Railway CNAME target for identity.0xhoneyjar.xyz
#    via Railway dashboard → identity-api service → Settings → Domains →
#    identity.0xhoneyjar.xyz → "Add DNS Record" reveals the CNAME target.
#    (Typically a *.railway.app or *.up.railway.app host.)
#
# 2. In Gandi DNS for 0xhoneyjar.xyz:
#    Replace existing CNAME identity → cname.vercel-dns.com
#    with new CNAME identity → <railway-provided target>
#
# 3. Wait for propagation (~minutes to ~hours) and Railway cert provisioning.
#
# 4. Verify:
curl -sI https://identity.0xhoneyjar.xyz/health  # expect 200 ok
dig +short CNAME identity.0xhoneyjar.xyz          # expect *.railway.app
#
# 5. Confirm Honey Road now shows Soju (not BERA fallback) for the operator's wallet.
#    Honey Road code already does the right thing — once the URL resolves, the
#    HONEYROAD_PROFILE_SOURCE=identity-api default activates and the alchemy
#    fallback path stays cold.
```

## What this cycle confirmed

1. **The cluster-meta cycle type works** (per ADR-009 §D-7). This is the second cluster-meta cycle (after `cluster-harness-audit-2026-05-25/`); the pattern of dedicated branch + distill-artifact + memory promotion holds.
2. **Bridgebuilder review is high-leverage at the proposal stage.** Verdict E saved ~3-4 hours of work that would have gone into the wrong topology.
3. **The Soju-lens primitive (parallel-fetch + discrepancy detection across surfaces) is the right operator-dash design** — it would have surfaced the IDENTITY_API_URL gap in one screen, even though manual probing also got there. Future bugs of this shape will be N× faster to diagnose with it.
4. **Probe-with-full-contract is now operator-validated rule** (memory `feedback_probe-with-full-contract.md`). Today's miss is tomorrow's reflex.

## Composes / supersedes

- Composes with: [`enhance-freeside-api-surface.md`](../../loa/specs/enhance-freeside-api-surface.md) — this cycle ships the deferred operator-visibility follow-up
- Composes with: ADR-009 §D-5 (federation discovery in network scope), §D-7 (cluster-meta cycle type), §D-9 (two-persona model — this serves the internal operator persona)
- Supersedes for forward-looking work: `project_identity-api-phase1-complete.md` memory framing (Phase 1 only deployed) — replaced by `project_identity-api-substrate-deployed.md` (Phases 1-4 all deployed)
- Does NOT supersede: `enhance-freeside-api-surface.md` T1/T2 (beacon authoring + federation server lift remain follow-up work — separate from this cycle)

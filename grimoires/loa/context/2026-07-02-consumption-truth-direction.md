---
status: candidate
created: 2026-07-02
author: microlight-swarm-2 recon (5 agents) + operator attention focus (indexing · ordering · agent orientation · inventory)
mode: arch
plannable: true
source_construct_affinity: [ordering-service, sonar-api, inventory-api, freeside-dashboard, freeside-characters, freeside-registry]
---

# Next-cycle direction — Consumption truth: fulfill the first real order, relight the dark reads

> Second microlight swarm, 2026-07-02. Operator focus: the parts **being consumed now and
> experiencing pain** — indexing, ordering, agent orientation (Cursor FE/BFF), inventory-api.
> Sibling session (PR #422 + RUNNING simstim) owns the beacon-consumer READ surface; this brief
> routes around it entirely.

## The thesis (one sentence)

The estate's consumption paths share ONE disease — **built substrate, dark consumption, fail-soft
silence** — and one golden thread exposes it end-to-end: the real stuck Azuki order `6ddc06f5`
(sonar-api #111), which the recent PRD's G-1 already names as the settle gate; this cycle drives
that order to `fulfilled` through the just-landed CLI verbs and un-darkens the reads it crossed.

## The five grounded faults (swarm evidence, all verified 2026-07-02)

1. **Indexing — sonar #120 (OPEN, high).** Chain-1 Azuki `TrackedErc721` indexes **0 holders**
   (live-reproduced against `sonar.0xhoneyjar.xyz/v1/graphql`; chain-1 processed to block 25.4M;
   OP chain works). Config fix #119 + full KF-013 reinit already ruled out — root cause is an
   unresolved Envio subscription gap. **This blocks the golden-thread order directly.**
2. **Ordering — shadow_preview probe is a hardcoded stub (#401).**
   `packages/services/ordering/src/kitchen-triage-ports.ts` never overrides `shadow.probe` →
   `StubTriagePorts` returns `blocked` → `canFulfillCommunityOnboarding`
   (`community-onboarding-orchestrator.ts:47`) can never pass autonomously. **Every order stalls
   at shadow_preview waiting for a human curl.** The consumable (`@freeside/shadow-audit-service`,
   already imported in `composition.ts`) is built-but-unconsumed.
3. **Ordering — auto-advance is dark behind two default-off flags.** `ENABLE_REPROBE`
   (`bin/http.ts:52`) and `KITCHEN_PROBE_HTTP_ENABLED` (`http-building-probes.ts:220`); live
   Railway values UNVERIFIED. The entire ReProbeWorker + HttpBuildingProbes machinery (landed,
   tested) may be dormant in production.
4. **Inventory — reads are 100% dark and the failure is silent.** Producer
   `inventory-mcp-production.up.railway.app` 401s on EVERY path including `/health` and the
   beacon (code declares them no-auth → Railway edge wall, observed-vs-claimed contradiction).
   Dashboard consumer default URL `inventory.0xhoneyjar.xyz` is a Vercel 404; client sends no
   auth and fail-softs everything to `null`/`[]`. Registry beacon_url points at the dead host.
   Beacon-serving code (inventory-api #18) unmerged. **Total silent outage, no alert.**
5. **Orientation — Cursor agents land blind and the drift is mechanical.** No `.cursor/rules`,
   no dashboard `AGENTS.md`; `characters/AGENTS.md:1` is a corrupted import (`@.Codex/loa/...`).
   The WHO×WHAT ladder is written down in NEITHER repo. Registry-vs-hardcode URL drift
   (`inventory-api/client.ts:8` → dead host; `identity.0xhoneyjar.xyz` hardcoded 8+ sites vs
   registry-canonical Railway host), an 1827-line hand-mirrored `score-api/types.ts` (churned
   yesterday), and two raw-Postgres ladder violations (`midi-db.ts`, `RAILWAY_MIBERA_DATABASE_URL`).

## Why this is the highest-leverage move

- **It consumes what just landed.** PRs #420/#421 merged TODAY (order/kitchen/fulfill verbs,
  reprobe, evidence-advance, registry zone) — but G-1 (the against-deployed E2E) was never run.
  This is the purest deployed-but-unconsumed cure available: the demo IS the cycle gate.
- **One order exercises three surfaces.** Fulfilling `6ddc06f5` forces the sonar #120 fix
  (indexing), the shadow_preview probe (#401, ordering), and the flag-flip + live verification
  (deploy truth) — no synthetic fixture, settled against a real customer order (fixture-tautology
  cure: differential vs the REAL thing).
- **The dark reads are the same disease at the read plane.** Inventory fail-soft and Cursor URL
  drift are consumption-falsehoods identical in kind to the dormant probes — declaration ≠
  ground-truth. Fixing them in the same cycle makes the cure systemic, not anecdotal.

## Scope shape (candidate FRs)

- **FR-1 (indexing / cross-repo sonar-api):** root-cause + fix #120 (chain-1 Azuki, 0 holders).
  Discovery-heavy; timebox + escalation path (Envio HyperSync source registration is prime suspect).
- **FR-2 (ordering):** wire the real shadow_preview HTTP probe (#401) — add `probeShadow` to
  `HttpBuildingProbes`, un-hardcode `KitchenTriagePorts.shadow`. Smallest cut, kills the
  every-order stall.
- **FR-3 (ordering / deploy):** verify + flip `ENABLE_REPROBE` and `KITCHEN_PROBE_HTTP_ENABLED`
  on the Railway ordering service; observed-not-claimed check that ReProbeWorker runs.
- **FR-4 (the settle gate = G-1):** an agent given ONLY `freeside order/kitchen/fulfill` drives
  `6ddc06f5` to `fulfilled`, zero raw curl. This is the cycle's acceptance test, not a task.
- **FR-5 (inventory):** unbreak the read path — ONE canonical URL agreed across producer, registry,
  consumer (either DNS → Railway + drop edge-wall on public reads, or real URL + key in dashboard
  env); kill the silent fail-soft (surface non-2xx as explicit error state); merge #18 beacon +
  fix registry beacon_url.
- **FR-6 (orientation / Cursor):** keyed `AGENTS.md` orientation stubs in dashboard + characters —
  WHO×WHAT ladder, this repo's rung, canonical building URLs FROM registry.yaml, BFF-read/
  owning-api-write rule; fix `characters/AGENTS.md:1`; centralize building base URLs
  (`buildings.ts` per repo) registry-checked. Additive files only — Cursor's home turf stays hers.

## Non-goals (defer with triggers)

- Beacon-consumer read surface (`inspect`/`loa model`) — **sibling session, PR #422, RUNNING
  simstim.** Do not touch `packages/freeside-cli/{inspect,doctor,bin,harden-beacon-fetch}` or
  `packages/beacon-schema/**`.
- sonar D4 per-chain split + Guardrail-5 `active.json` alias — right structural bets, own cycle;
  trigger: next contract-add reindex event.
- PhaseGateRunner / Bridgebuilder parser (epic #415 Phase A) — spike later; trigger: G-1 proven.
- Typed codegen client for the 1827-line hand-mirror — gated on producers exposing real
  sealed_schemas (score-api's are zero-placeholders).
- discord channel-health gate (#405) + metadata_snapshot (#416) — inherit FR-2's real-probe
  pattern next cycle.

## User-truth hypothesis (settle against revealed behavior)

If the probes are real and the verbs work, the NEXT community-onboarding order after `6ddc06f5`
fulfills with ≤1 operator decision (merge-class only) — measured on the order's event trail, not
asserted. For the read plane: the dashboard renders live inventory PFPs/holdings (non-empty for a
known holder) instead of silently-empty.

## Collision fences (multi-session)

- Shared checkout's `grimoires/loa/{prd,sdd,sprint}.md` belong to the sibling's RUNNING simstim —
  this cycle plans + builds in worktree `cycle-consumption-truth` (this file's home).
- PR #422 file set = do-not-touch (listed above). Our FRs need NO freeside-cli edits (verbs landed).
- FR-1 is cross-repo (sonar-api), FR-5 crosses inventory-api + freeside-dashboard, FR-6 crosses
  dashboard + characters — coordinate via /coord; never admin-merge cross-repo past the operator.

## Related

Epic #415 (Phases C/D), issues sonar-api#120/#111, loa-freeside#401/#405/#416, inventory-api#18/#17,
prd.md (main, "Agent-First Fulfillment Surface") G-1..G-5, memory: [[project_deployed-but-unconsumed-pattern]],
[[feedback_ground-deployed-state-before-asserting]], [[project_fulfillment-surface-cycle]].

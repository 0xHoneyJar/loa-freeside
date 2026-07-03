# Software Design Document — Consumption Truth

> Cycle `consumption-truth` · from prd.md (this worktree, flatline-integrated `6bb1b421`).
> Design is grounded in post-#420/#421 code read 2026-07-02 (file:line below are worktree paths
> off origin/main). Previous cycle SDD archived: sdd.prev-2026-07-01-fulfillment-surface.md.

## 1. Architecture overview

No new services, no new packages. The cycle wires four EXISTING surfaces so consumption becomes
true: (a) the ordering probe mesh gains its missing `shadow` leg, (b) production flags turn the
already-built ReProbeWorker on, (c) the inventory read plane gets one canonical URL + fail-loud
consumers, (d) the FE/BFF repos get keyed orientation files. The settle gate is behavioral: a real
order driven to `fulfilled` by an agent through `freeside order/kitchen/fulfill`.

```
freeside-cli verbs ──HTTP──▶ ordering-service (Railway)
                               ├─ ReProbeWorker (ENABLE_REPROBE)            [FR-3]
                               └─ KitchenTriagePorts ── HttpBuildingProbes
                                    ├─ probeSonar  ──▶ sonar/kitchen-api    [FR-1 unblocks]
                                    ├─ probeScore  ──▶ score-api
                                    ├─ probeWorlds ──▶ worlds-api
                                    └─ probeShadow ──▶ shadow-audit /v1/audit  [FR-2 NEW]
dashboard ──▶ buildings.ts ──▶ inventory-api (un-walled reads)              [FR-5]
Cursor agent ──▶ AGENTS.md (WHO×WHAT + canonical URLs)                      [FR-6]
```

## 2. FR-2 — shadow_preview real probe

**Files** (all `packages/services/ordering/src/`):
- `http-building-probes.ts` — extend `HttpBuildingProbesConfig` with OPTIONAL
  `shadowAuditApiUrl?: string`. Add `probeShadow(chainId, contract): Promise<IngredientStatus>`
  following the exact `probeScore` shape: normalize pair → GET
  `${shadowAuditApiUrl}/v1/audit?chain_id=&contract_address=` with `authHeaders(serviceToken)` →
  map response.
- Status mapping (`mapShadowStatus`, sibling of `mapSonarStatus:29`): HTTP 200 + audit result
  present → `complete`; 404/no-audit-yet → `pending`; 5xx/network/parse → `blocked`; ambiguous
  body (200 but undecodable) → `pending` + structured warn log (fail-loud invariant: never
  fabricate `complete`; PRD Live-Order Safety #4).
- `kitchen-triage-ports.ts:37-39` — un-hardcode: `shadow.probe` delegates to
  `this.http?.probeShadow(...)` when the HTTP adapter exists AND it was configured with
  `shadowAuditApiUrl`; else fallback stub (preserves today's behavior when unset —
  additive, reversible).
- `httpBuildingProbesFromEnv()` (`http-building-probes.ts:203`) — read optional
  `SHADOW_AUDIT_API_URL`; its absence does NOT disable the other probes (unlike the required
  trio), it only leaves shadow on stub. One warn line when enabled-but-missing.

**Contract note**: the audit read endpoint is `GET /v1/audit`
(`packages/services/shadow-audit/src/http/audit-router.ts` — same contract the dashboard's
`access-audit/client.ts` consumes). If the deployed shadow-audit requires an API key
(`SHADOW_AUDIT_API_KEY` per its DEPLOY.md), pass it as its own header — verify the deployed
auth header name BEFORE coding (observed-not-claimed).

**Tests**: mapping table (200-with-result/404/5xx/ambiguous-body), fromEnv with/without
`SHADOW_AUDIT_API_URL`, triage-port delegation vs stub fallback — in the existing ordering test
dir (`__tests__/` pattern from #420). Reuse the existing `fetchImpl` injection seam — no new
mocking machinery.

## 3. FR-3 — production flag truth (deploy, [OPERATOR-BOUNDED])

No code. Railway ordering service env: verify then set `ENABLE_REPROBE=true`
(`bin/http.ts:52`), `KITCHEN_PROBE_HTTP_ENABLED=true` + the four
`SERVICE_TOKEN`/`SONAR_API_URL`/`SCORE_API_URL`/`WORLDS_API_URL` (fromEnv hard-requires all
four, `http-building-probes.ts:206-214`) + new `SHADOW_AUDIT_API_URL`. NOTE: DEPLOY.md says
`SONAR_API_URL` points at kitchen-api-production — confirm the live probe contract
(`/v1/collections/:chain/:contract/status`) resolves on that host before flipping.
**Verification (observed)**: `freeside kitchen probe <order-id>` then `freeside order status
<order-id>` shows fresh `probe_meta` timestamps; Railway logs show ReProbeWorker 15-min cadence
line. Rollback = unset flags (behavior returns to stub/operator-advance).

## 4. FR-4 — the settle gate (G-1 E2E)

Runbook, not code: `grimoires/loa/runbooks/consumption-truth-e2e.md` records each verb call +
`probe_meta`/event-trail output. Sequence: (1) dry-run — place fresh OP-chain test order, drive
via `order place → fulfill watch → kitchen probe/advance` to `fulfilled`; (2) real order
`6ddc06f5` under the PRD's Live-Order Safety Protocol (evidence per advance; ambiguous → halt;
operator gates irreversible seams). Exit codes are the honesty surface (fulfilled→0/failed→6/
timeout→5 per #421) — the runbook quotes them.

## 5. FR-5 — inventory read plane

- **5a (operator, infra)**: Railway edge wall off for `/health`, `/.well-known/beacon.json`,
  `/holdings/:wallet`, `/profile/:address` AFTER the Privacy Gate passes (enumerate LIVE response
  fields first — PRD gate). DNS `inventory.0xhoneyjar.xyz` → Railway service. Rate-limit stays.
- **5b (inventory-api repo)**: merge #18 (beacon serving); registry.yaml `beacon_url` corrected to
  the resolvable host; `src/app.ts` docstring drift fix (routes list omits `/profile`).
- **5c (dashboard repo)**: `src/lib/inventory-api/client.ts` — replace silent `null`/`[]` with a
  typed result `{ ok: true, data } | { ok: false, status, reason }`; callers render an explicit
  error/empty distinction; one structured `console.error` per failure (BR-003 class kill). Default
  URL moves to `buildings.ts` (FR-6) sourced from the registry-canonical deployment URL.
- **Drift test**: a unit test in dashboard asserting `BUILDINGS.inventory` matches the canonical
  URL constant; loa-freeside side asserts registry.yaml `deployment_url`/`beacon_url` for
  inventory resolve (HTTP 200 beacon) in the existing doctor/registry test lane.

## 6. FR-6 — keyed orientation (Cursor surface)

Additive files only, one PR per repo:
- `freeside-dashboard/AGENTS.md` (NEW) + repair `freeside-characters/AGENTS.md:1`
  (`@.Codex/loa/Codex.loa.md` → the repo's real CLAUDE.loa twin, or inline the intro).
  Content contract (same skeleton both repos): (1) WHO×WHAT ladder verbatim (WHO
  person→account→inventory × WHAT L0 sonar→L1 score→L2 member-graph→L3 audit); (2) this repo's
  rung + role (dashboard = projection BFF: client components fetch `/api/*` ONLY; characters =
  L2 consumer backend); (3) buildings-consumed table with CANONICAL URLs from
  `loa-freeside/packages/freeside-registry/registry.yaml` incl. the sonar belt-gateway
  read-plane warning; (4) rules: read via BFF, write to the owning `*-api`, never fan out
  client-side, never hand-mirror another building's schema without a `DO NOT EDIT` + source
  pointer.
- `buildings.ts` per repo: single exported map `{ building: { baseUrl, source: 'registry.yaml' } }`;
  dashboard (~3 call sites), characters (~10 incl. `packages/persona-engine/src/config.ts:47-52`).
  Mechanical, behavior-preserving (same URLs, one home). `// loa:shortcut: registry drift-check is
  manual (snapshot comment); automate when the beacon orientation packet (PR #422 sibling) ships`.

## 7. FR-1 — sonar #120 diagnosis spike (cross-repo, timebox 1 day)

Not designed here beyond the spike protocol: compare chain-1 vs chain-10 Envio `config.yaml`
source blocks (HyperSync endpoint, start_block, address registration for Azuki), inspect
TrackedErc721 registration rows, targeted reinit with debug logging if config diverges. Exit
per PRD: fix PR on sonar-api OR diagnosis doc + /coord lane + G-1 pivots to the OP-chain order.

## 8. Sibling fence (G-6, machine-checked)

`tools/check-sibling-fence.sh` (cycle branch): `git diff --name-only origin/main...HEAD` grepped
against the fence list (`packages/freeside-cli/src/verbs/inspect.ts`, `verbs/doctor.ts`,
`bin/freeside-cli.ts`, `src/lib/harden-beacon-fetch.ts`, `packages/beacon-schema/`) → exit 1 on
hit. Run in the review gate for every sprint of this cycle. Exit code is the verdict — never piped.

## 9. Security

No new authN surfaces. probeShadow reuses the bearer service-token seam. FR-5a exposes only
Privacy-Gate-passed fields; rate-limit retained. SERVICE_TOKEN never logged (existing posture,
#420 token-rotation runbook applies). No secrets in AGENTS.md/buildings.ts (URLs only, public).

## 10. Test strategy

Unit: probe mapping + fromEnv + delegation (FR-2), dashboard client fail-loud (FR-5c), buildings
map (FR-6). Integration (observed, not fixture): kitchen probe against deployed shadow-audit on a
staging order; beacon 200 check post-#18. Settle: the FR-4 runbook with quoted event trail — the
differential vs the REAL thing. Every non-trivial branch above leaves a runnable check.

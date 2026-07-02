# G-1 Acceptance Demo — agent-driven fulfillment (fulfillment-surface cycle)

> Run 2026-07-02 against the DEPLOYED ordering-service (`https://ordering-service-production.up.railway.app`).
> Fixture: order `6ddc06f5-0c6f-42b8-8377-768a4c2a302e` (Azuki, community-onboarding) — the sonar-api #111 E2E order that had been stuck on a manual `advance-ingredient` curl.
> **Result: FULFILLED via CLI verbs only, zero curl. G-1 met.**

## Environment
```
ORDERING_SERVICE_URL=https://ordering-service-production.up.railway.app
ORDERING_SERVICE_TOKEN=<from Railway SERVICE_TOKEN; never printed>
```

## Deploy caveat (recorded honestly)
The deployed service at demo time was the PRE-cycle version (last Railway deploy 2026-06-30; healthz lacked the `write_routes` field). So the **new `reprobe` verb was NOT exercisable** — `kitchen probe` correctly returned `{"error":"non-JSON response (HTTP 404) ...","http_status":404}` exit 3 (clean surface, no crash). The demo drove fulfillment through the **pre-existing `advance-ingredient` route** via `kitchen advance` — the manual/HITL advance path this order was blocked on. Full reprobe-driven flow re-runs once PR-A (#420) deploys.

## Transcript (all via `node dist/bin/freeside-cli.js`)
```
$ freeside-cli order status 6ddc06f5-…
  state=producing  ingredients: sonar=blocked score=pending worlds_manifest=complete shadow_preview=blocked  world_slug=azuki

$ freeside-cli kitchen probe 6ddc06f5-… --ingredient sonar
  {"error":"non-JSON response (HTTP 404) ... /reprobe","http_status":404}   exit 3   # reprobe not deployed yet — surfaced, not swallowed

$ freeside-cli kitchen advance 6ddc06f5-… --ingredient sonar --status complete    → state=producing  sonar=complete            exit 0
$ freeside-cli kitchen advance 6ddc06f5-… --ingredient score --status complete    → state=producing  score=complete, shadow_preview auto-unblocked blocked→pending  exit 0
$ freeside-cli order ingredients 6ddc06f5-…                                        → sonar/score/worlds_manifest=complete, shadow_preview=pending
$ freeside-cli kitchen advance 6ddc06f5-… --ingredient shadow_preview --status complete  → state=FULFILLED  exit 0
$ freeside-cli fulfill watch 6ddc06f5-… --once
  {"order_id":"6ddc06f5-…","state":"fulfilled","ingredients":{...all complete...},"world_slug":"azuki"}   exit 0
```

## What this proves (G-1 + G-5)
- **G-1**: an agent given only the CLI drove the stuck order to `fulfilled` — every hop a verb, zero raw curl.
- **Server auto-unblock** (community-onboarding-orchestrator): shadow_preview flipped blocked→pending automatically once the three required ingredients completed — no client logic.
- **G-5 no-silent-failure**: the undeployed `reprobe` route surfaced as a distinct exit-3 error envelope, not a swallow or crash.
- **E2E differential** (`ORDERING_DIFFERENTIAL=1 pnpm test`): 69/69 green — the CLI's PublicOrder mirror matches the DEPLOYED service shape (anti-fixture-tautology confirmed against live).

## Operator attention on this hop: ≤1 decision (none, actually — fully agent-driven). vs. the ~45-min curl choreography this order was blocked on. Headline metric met.

---

## Full reprobe-driven flow (PR-A DEPLOYED, 2026-07-02)

After deploying merged main to Railway (`railway up` from a clean origin/main clone; healthz now `{"ok":true,...,"write_routes":"token"}` — D8 matrix confirms deployed+token→token-gated writes; migration 002_probe_meta ran on boot), re-ran the FULL flow on a fresh order `e42d5b73-f194-4d9d-b789-16907d914100`:

```
$ freeside-cli order place --preset community-onboarding --inputs {...Azuki...}   → {"order_id":"e42d5b73-…"}
$ freeside-cli kitchen probe e42d5b73-…
  {"order_id":"e42d5b73-…","probes":{"score":{"status":"pending","probed_at_unix":1782969020,"source":"reprobe","freshness":"fresh"}}}   exit 0   # NEW reprobe endpoint LIVE

$ freeside-cli order status e42d5b73-…   → probe_meta populated per-ingredient with source (reprobe|interval), status, probed_at_unix

$ freeside-cli kitchen advance e42d5b73-… --ingredient sonar --status complete --note "g1 reprobe demo"
  audit tail: {"event":"operator.advance","ingredient":"sonar","status":"complete",
               "evidence":{"source":"interval","status":"blocked","probed_at_unix":1782969018},   # SERVER-DERIVED value-copy — honest that sonar was 'blocked' at advance time
               "token_label":"ordering-service-token",                                             # SERVER-DERIVED actor
               "caller_note":"g1 reprobe demo"}                                                     # client, untrusted
$ freeside-cli kitchen advance e42d5b73-… --ingredient score --status complete           → sonar+score complete, shadow_preview auto-unblocked
$ freeside-cli kitchen advance e42d5b73-… --ingredient shadow_preview --status complete   → state=FULFILLED
$ freeside-cli fulfill watch e42d5b73-… --once   → {"state":"fulfilled",...,"world_slug":"azuki"}   exit 0
```

### Negative controls (G-5 + auth, live)
```
$ freeside-cli kitchen probe e42d5b73-…            (order now terminal)  → {"error":"order already terminal","http_status":409}   exit 3
$ ORDERING_SERVICE_TOKEN=wrong freeside-cli kitchen probe e42d5b73-…                       → {"error":"unauthorized","http_status":401}          exit 3
```

**Every SDD design point verified against production:** on-demand reprobe (D1), server-derived unfakeable evidence + token_label (D3), fail-closed→token posture (D4/D8), canonical projection (D7), honest failure semantics (G-5). The evidence chain even recorded the *honest* fact that sonar was `blocked` when the operator advanced it — the audit trail cannot be gamed by the client.

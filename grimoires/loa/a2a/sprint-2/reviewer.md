# Implementation Report — Order System, Sprint 2 (order-tracking frontend)

**Branch**: `cycle/shadow-audit-runtime-ordering` · **Run**: autonomous (goal: finish all sprints) · local-only.
**Domain (ADR-007)**: `platform` only. Traces to `sprint.md` Sprint 2 + SDD §2 / §13 M-9.

## Executive Summary
Built the order-tracking frontend (the /simstim target) into `@freeside/ordering-service` as Hono SSR
(the repo's frontend convention — cf. `apps/freeside-operator-dash`): a placement form and a live
tracking view that polls `GET /v1/orders/:id` and renders the `placed→routing→producing→fulfilled`
timeline + the `AuditOutput` aggregate. A runnable local demo (`bin/demo.ts`) wires the whole loop
in-process. **Gate: tsc clean · 35 tests pass (+5) · live demo smoke-tested end-to-end (placed→fulfilled).**

## AC Verification

### S2-T1 — order-placement form → POST /v1/orders
> "place an order from the UI → order_id shown"

**✓ Met.** `src/frontend.ts` `FORM_PAGE` (GET /) — form `fetch('/v1/orders', POST)` → renders the returned
`order_id` + a track link. Tested: `src/__tests__/frontend.test.ts` ("serves the placement form", "mounts
the intake API → 200 order_id"). Live smoke: `POST /v1/orders → 200 {order_id}`.

### S2-T2 — live order-tracking view
> "place an order, watch it advance to fulfilled, see the audit aggregate render — the demo"

**✓ Met.** `src/frontend.ts` `trackPage()` (GET /track/:id) — polls `GET /v1/orders/:id` every 1s, renders the
4-step timeline (current/done/failed states) and, on `fulfilled`, the `output.aggregate` (rendered generically
so the presentation layer stays decoupled from the audit aggregate's shape — EVANS). Tested:
`frontend.test.ts` ("tracking view polls the order", end-to-end "placed order, once driven, is fulfilled with an
aggregate"). **Live smoke**: placed order advanced to `state=fulfilled` with `result_ref` + all 6 aggregate
fields (`holder_turnover`, `sold_lapsed`, `newly_eligible`, `stale_access`, `whale_concentration`,
`stale_access_risk_band`); `GET /track/:id → 200`.

## Tasks Completed
| Task | Files | Approach |
|------|-------|----------|
| S2-T1 | `src/frontend.ts`, `src/index.ts` | Hono SSR form posting to the same-origin mounted intake |
| S2-T2 | `src/frontend.ts` | Polling tracking view; generic aggregate render; timeline stepper |
| demo | `bin/demo.ts`, `src/intake.ts` (`onPlaced` seam) | In-process place→drive→track loop with a sample-data audit adapter |

## Technical Highlights
- **JetStream stays server-side (M-9):** the browser only polls `GET /v1/orders/:id`; no client NATS subscription.
- **Same-origin mount:** `createFrontendApp` mounts the intake routes (`app.route('/', createIntakeApp(deps))`) so form POST + status poll need no CORS.
- **Decoupled rendering (EVANS):** the tracking view iterates `output.aggregate` generically — the Ordering UI never hard-codes the audit aggregate's fields.
- **`onPlaced` seam:** an optional fire-and-forget intake hook; prod leaves it unset (NATS drives), the demo wires it to drive the orchestrator in-process. Never blocks the 200.

## Testing Summary
`src/__tests__/frontend.test.ts` (5): form page, tracking page, mounted API, e2e place→drive→fulfilled+aggregate, `onPlaced` fires.
Plus the live smoke (`PORT=8097 tsx bin/demo.ts`): form 200 · POST 200 · status `fulfilled` + aggregate · track 200.
Run: `pnpm --dir packages/services/ordering test` (35 pass) · `pnpm --dir packages/services/ordering typecheck` (clean).

## Known Limitations
- **DEMO-ONLY wiring** in `bin/demo.ts` (clearly marked): sample-data audit adapter (real = `DeclaredLocalAuditAdapter`+sonar/score deps, deploy), `onPlaced` driver (real = NATS consumer), any-contract demo community (real = configured registry).
- Frontend as a module in the ordering package; the SDD §8 "separate service" deploy split is a later topology decision.
- No DOM-level unit test of rendering (no jsdom); rendering is verified by the served-HTML assertions + the live smoke.

## Review status
Independent cross-model review still unavailable (OpenAI quota + codex dispatch — see sprint-1 report). Self-review:
frontend is presentation logic (low correctness risk); the order-advancement correctness is S1's tested orchestrator.
Security: no secrets; the only injected value (`order_id`) is `JSON.stringify`-encoded into the script + HTML-escaped in markup.

## Verification Steps
```bash
cd packages/services/ordering && pnpm test && pnpm typecheck
PORT=8097 pnpm exec tsx bin/demo.ts   # open http://localhost:8097 — place an order, watch it fulfill
```

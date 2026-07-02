# Sprint Plan — Agent-First Fulfillment Surface

> Cycle: fulfillment-surface (simstim-20260701-50e41fd7). Implements `sdd.md` §7 delivery plan.
> Two sprints = two PRs (ADR-007: platform and network never mix). Branch base: `cycle/fulfillment-surface` worktree; each sprint cuts its own PR branch.
> Sequencing: Sprint 1 → Railway deploy → Sprint 2 → G-1 demo. This is sequencing, NOT a beads `blocked-by` (ADR-007 rule 5).

## Sprint 1 — ordering-service capabilities (PR-A, `platform/ordering`)

**Goal**: the service exposes everything an agent-driven CLI needs: on-demand fresh probes, evidence-grounded advances, fail-closed auth. (G-4, G-5; enables G-1)

### ✅ S1-T0 — Deployed-truth probe + fixture decision gate (no code) [FLATLINE SKP-001 + IMP-010]
Verify the live ordering-service before building against it: `GET /healthz` + `GET /v1/orders/6ddc06f5` at the DEPLOY.md URL (`kitchen-api-production-1937.up.railway.app`).
**Decision gate — no implementation task starts until this closes**:
- URL wrong/unreachable → correct DEPLOY.md (and later the S2-T5 registry entry) with the observed truth first.
- Fixture lifecycle: if order `6ddc06f5` is terminal/missing/advanced, **place a fresh dedicated demo order** (community-onboarding preset) as the G-1 fixture. The demo fixture is treated as mutable-by-design: its ID + expected starting state are pinned in NOTES.md AND read by S2 tests/demo from that single record (never hardcoded twice). Fallback rule: fixture found terminal at demo time → place a new order, update the pin, rerun.
**Accept**: NOTES.md entry with observed healthz/order responses, the pinned fixture ID + expected state, and the URL truth that S2-T5 will consume.

### ✅ S1-T1 — `probe_meta` shape + single write path
Type `probe_meta: {[ingredient]: {status, probed_at_unix, source}}` in `@freeside/ordering-protocol`; shared merge helper writes it from BOTH `ReProbeWorker` and the new reprobe endpoint (SDD D1/IMP-002). Legacy rows read as `{}`.
**Accept**: unit tests — worker probe run populates probe_meta; legacy record without probe_meta reads clean; monotonic merge preserved (`mergeProbedIngredients` untouched or extended with tests).

### ✅ S1-T2 — `POST /v1/orders/:id/reprobe`
Synchronous on-demand probe per SDD D1: token-gated; body `{ingredient?}`; bounds (30s global timeout, fan-out ≤3, 10s/probe with AbortController, 10s per-order cooldown → 429 + retry_after); failure semantics 401/404/409/429; probe failure/timeout → in-body `ambiguous`, never 5xx; CAS-lost merge retries once (SDD IMP-003).
**Accept**: vitest suite — fresh probe path, timeout→ambiguous, cooldown 429, global-timeout with hung-probe fake, CAS-race retry, 409 on terminal order.

### ✅ S1-T3 — Advance: server-derived evidence + actor (SDD D3)
`AdvanceIngredientBodySchema` + optional `caller_note` (≤120 chars); handler resolves `token_label` from the authenticating credential; audit entry gains `{token_label, evidence: probe_meta[ingredient] ?? null, caller_note?}`. **Evidence immutability** [FLATLINE IMP-006]: the audit `evidence` is a value COPY taken at advance time — later reprobes update `probe_meta` but never mutate past audit entries.
**Accept**: unit tests — audit entry carries token_label regardless of body; evidence == server probe_meta snapshot at advance time; a subsequent reprobe leaves the prior audit entry byte-identical; never-probed → `evidence: null`; legacy body (dashboard shape) still valid; caller_note stored verbatim but never substitutes for token_label.

### ✅ S1-T4 — Fail-closed boot + auth matrix (SDD D4/D8)
Deployed marker (`RAILWAY_ENVIRONMENT` || `NODE_ENV=production`) + unset `SERVICE_TOKEN` → write routes not mounted; `/healthz` reports `write_routes: open_dev|token|disabled_no_token`; loud boot log.
**Accept**: integration test matrix — all 4 D8 rows; deployed-tokenless boot leaves POSTs 404 and healthz shows `disabled_no_token` (FR-10b, G-4). **Read-route posture explicit** [FLATLINE IMP-007]: GET routes + `/healthz` remain unauthenticated BY DESIGN in every row (registry doctor probes healthz tokenless) — one test asserts reads stay open in deployed-tokenless mode.

### ✅ S1-T5 — Canonical projection (SDD D7)
One `toPublicOrder(record)` used by `GET /v1/orders/:id`, advance response, reprobe response; internal fields excluded. **Shape defined up front** [FLATLINE IMP-002]: the public projection TYPE lands in `@freeside/ordering-protocol` in THIS task, before Sprint 2 consumes it — the CLI's S2-T1 schemas import/mirror it, never re-derive it.
**Accept**: projection stability test — all three routes deep-equal on shared fields for the same record; snapshot test pins the public shape; the exported type exists in ordering-protocol.

### ✅ S1-T6 — Preset error support + rotation runbook
Unknown-preset 400 lists available presets in the error body (FR-1). `docs/runbooks/ordering-token-rotation.md` (NFR-8c: issue → update consumers → revoke).
**Accept**: 400-body test; runbook exists and names both consumers (dashboard, CLI).

**Sprint 1 verification**: full ordering-service vitest suite green; commit scope `platform/ordering`; PR contains zero `packages/freeside-cli` or `packages/freeside-registry` paths — **checked mechanically** [FLATLINE IMP-005]: run `tools/check-beacon-domain.sh` (the path-domain pre-commit mirror) before opening the PR, not just eyeballed.

## Sprint 2 — CLI verbs + registry (PR-B, `network/freeside-cli`)

**Goal**: an agent given only env config drives place → probe → advance → watch with schema-stable JSON and exit codes. (G-1, G-2, G-3, G-5)

**Entry gate** [FLATLINE IMP-001, 905]: Sprint 2 implementation of the probe verb starts only after the deployed `/healthz` shows PR-A's `write_routes` field (proof the new service version is live). `place/status/watch` may start against the current deploy; anything touching reprobe waits for the gate. Owner: whoever runs the sprint checks it at sprint start and records the healthz body in NOTES.md.

### S2-T1 — Client + schemas + exit codes
`src/lib/ordering-client.ts` (global fetch; `ORDERING_SERVICE_URL`/`ORDERING_SERVICE_TOKEN`; HTTP/transport errors → exit-code classes; token redaction) and `src/lib/ordering-schemas.ts` (per-verb success/error types + runtime guards). **Single sources** [FLATLINE IMP-003/IMP-008]: the exit-code table is SDD D6 verbatim (one exported const, no per-verb variants); the error envelope is `{error, http_status?, order_id?, hint?}` pinned by its own schema guard — every verb's failure path emits exactly this shape. Zero new deps.
**Accept**: unit tests — error mapping per class; error-envelope schema conformance on every failure path; redaction test (token never in output/errors); schema guards reject shape drift.

### S2-T2 — `order place|status|ingredients`
Three verbs per SDD §3.1 rows 1–3, wired into the `switch(verb)` dispatch. No client preset table — server 400 surfaced verbatim (SDD §3.1 resolution).
**Accept**: contract tests vs fixture server — happy path + unknown-preset error + schema/exit-code conformance per row.

### S2-T3 — `kitchen probe|advance`
Probe verb maps reprobe response (`fresh|ambiguous` per ingredient; any ambiguous → exit 4). Advance verb: client-side bounds (`--status` ∈ enum, `--ingredient` ∈ order's ingredient set — fetched, not hardcoded), `--note` → `caller_note`, CAS-lost → exit 4 with server state in error JSON.
**Accept**: contract tests — bounds rejection happens before any HTTP call (fixture asserts no request); ambiguous → 4; CAS-lost → 4; cooldown 429 surfaced distinctly.

### S2-T4 — `fulfill watch`
Poll loop per SDD §3.1: change-only JSON lines, `--interval`/`--timeout`/`--once`, bounded transient retries → exit 2, terminal exits 0/6, timeout 5. Stateless (safe to interrupt/re-invoke).
**Accept**: contract tests with scripted fixture sequences — change detection (no repeated-state lines), fulfilled→0, failed→6, timeout→5, `--once` snapshot, retry exhaustion→2.

### S2-T5 — Registry entry + doctor probe (FR-9/9a)
`ordering` module in `registry.yaml` (deployment URL from S1-T0 truth, probe `/healthz`); doctor classifies mocked 200 → ok, mocked timeout → error.
**Accept**: doctor probe test; `freeside-cli list` shows ordering; G-3 check: `loa census` sees the node (operator-run, recorded).

### S2-T6 — Differential check + help
Env-gated (`ORDERING_DIFFERENTIAL=1`) fixture-vs-deployed shape comparison on `GET /v1/orders/:id` (anti-fixture-tautology); verb help text. **CI boundary explicit** [FLATLINE IMP-004]: default test run makes ZERO network calls (fixture-only); the differential is the only live-touching test and is opt-in via the env flag; skip is a visible `skipped` in the report, never a silent pass.
**Accept**: differential test passes against live service when enabled, skips visibly in CI; grep-level assertion that no other test file references the live URL; `freeside-cli --help` lists new verbs.

**Sprint 2 verification**: freeside-cli vitest suite green; commit scope `network/freeside-cli`; PR contains zero `packages/services/ordering` paths — checked mechanically via `tools/check-beacon-domain.sh` [FLATLINE IMP-005].

## Post-sprint (not in either PR)

- **G-1 acceptance demo** (PRD §9): after PR-A deploys — drive the pinned fixture order (S1-T0 record; Azuki `6ddc06f5` or its replacement) to `fulfilled` via CLI only. **Repeatable artifact** [FLATLINE IMP-009]: the demo is a written script at `grimoires/loa/demos/g1-fulfillment.md` (commands + expected states), executed and its transcript recorded in the PR-B body — rerunnable, not a one-off.
- **NFR-7 dashboard smoke**: after PR-A deploys — dashboard `POST /api/onboarding/orders/shadow-audit` still succeeds.

## Goal traceability

| Goal | Delivered by |
|------|--------------|
| G-1 | S1-T2/T3 (capabilities) + S2-T2/T3/T4 (verbs) + post-sprint demo |
| G-2 | S2-T2 + NFR-7 smoke |
| G-3 | S2-T5 |
| G-4 | S1-T4 |
| G-5 | S1-T2 failure semantics + S2-T1 exit codes + S2-T4 retry surfacing |

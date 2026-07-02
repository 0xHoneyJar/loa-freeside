# Product Requirements Document — Agent-First Fulfillment Surface

> Cycle: fulfillment-surface (from epic [#415](https://github.com/0xHoneyJar/loa-freeside/issues/415)).
> Produced by `/plan` (discovering-requirements) 2026-07-01: 4-source parallel ingestion (ordering code, Loa post-PR gates, freeside-cli + topology, live issue states) + 4-question operator interview.
> Supersedes the epic's daemon framing — see §2 (The Reframe) and §10 (Corrections to the source epic).

## 1. Problem Statement

Fulfilling an order across Freeside today makes **the operator the integration bus**. The sonar-api Tier-2 ship consumed "~45+ minutes of operator attention for a well-scoped, pre-spec'd re-port with green unit tests" (#415 §Context). The Azuki E2E order (`6ddc06f5`, sonar-api #111) is stuck *right now* on a manual `advance-ingredient` curl (Phase 0 issue sweep, verified 2026-07-01).

The ordering spine itself is **not** the gap. Code grounding found the fulfillment machinery already built and committed (through PR #397):

- Order state machine with CAS transitions [CODE:packages/services/ordering/src/order-state.ts:15, store.ts:180-201]
- In-process orchestration on placement [CODE:packages/services/ordering/bin/http.ts:17] plus a sibling re-probe worker [CODE:src/reprobe-worker.ts:31]
- Ingredient fan-out (GitHub-issue or HTTP enqueue) [CODE:src/ingredient-enqueue.ts:34]
- Real HTTP probes for sonar/score/worlds [CODE:src/http-building-probes.ts:57]
- Transactional outbox with lifecycle event subjects [CODE:src/events.ts:16]

What is missing is a **consumable seam**: no agent- or operator-facing tool can drive it. The only write path is a raw curl with a bare Bearer token [CODE:src/intake.ts:149-155]; ordering is absent from `packages/freeside-registry/registry.yaml` (invisible to `loa census` / doctor); `freeside-cli` has three read-only verbs and no write surface [CODE:packages/freeside-cli/bin/freeside-cli.ts:45-91]. This is the cluster's signature **deployed-but-unconsumed** failure ("one operator move inks the chalk" — `grimoires/loa/the-station/transmission.md`).

> Sources: #415 §Context/§Problem statement; Phase 0 ingestion (ordering, cli-topology, issues); transmission.md.

## 2. The Reframe (Vision)

**No orchestrator daemon this cycle.** The operator's decision (Phase 1 Q1–Q2):

> "I will bear the orchestrator load via this context window with agents or team or external ordering from the UI. We are building for agents first though as the latters are easy to build with this tooling."

The orchestration *intelligence* is the agent session — solo, teamed, or fanned out. The substrate's job is to hand that agent **verified, structured, grant-compatible primitives**: place, status, probe, advance, watch. The existing in-process `onPlaced` + `ReProbeWorker` remain as substrate, untouched.

Layering doctrine (recalled and operator-reconfirmed, Phase 1 Q2):

- CLI vs MCP vs Code Mode is a **false trichotomy** — presentation / composition / execution are three layers, not competitors. The CLI is the execution substrate: "KEEP IT" (`grimoires/loa/context/goals/goal-4-freeside-code-mode.md:7-12`).
- The MCP gateway is the *discovery* organ; the consume hot-path stays typed and deterministic (`grimoires/loa/context/consume-pattern-two-organ.md:44-53`).
- **Future direction (operator, Phase 2 confirmation):** "Long term Code mode should enable Agent to drive and recover from issues in a more intelligent way." The typed SDK later wraps these same verbs (compiles down to the same dispatch — never a second path); intelligent drive-and-recover lives there. This PRD builds the substrate that trajectory requires.

> Sources: Phase 1 Q1–Q2, Phase 2 confirmation; goal-4-freeside-code-mode.md; consume-pattern-two-organ.md.

## 3. Goals

| ID | Goal | Metric |
|----|------|--------|
| G-1 | Agent-driven fulfillment | An agent given only the CLI drives the stuck Azuki order (`6ddc06f5`, sonar-api #111) to `fulfilled` — every hop via `freeside order/kitchen/fulfill` verbs, zero raw curl |
| G-2 | Order intake parity | `freeside order place --preset community-onboarding` succeeds against the deployed Railway service; the existing dashboard consumer is unchanged |
| G-3 | Registry truth | Ordering zone declared in `registry.yaml`; doctor live-probes `/healthz`; node visible to `loa census` |
| G-4 | Auth floor | `advance-ingredient` rejects unauthenticated calls in deployed config (SERVICE_TOKEN mandatory) — regression-tested |
| G-5 | No silent failure | Every verb surfaces non-2xx / ambiguous probe states as explicit exit codes + structured JSON error — never swallows (BR-003 class) |

**Headline metric** (epic, restated for the agent-first frame): operator attention on a routine fulfillment hop drops from ~45 min of choreography to **≤1 decision** (merge-class only).

> Sources: Phase 2 Q4 (operator confirmed verbatim); #415 §Success criteria.

## 4. Users & Stakeholders

| Persona | Relationship | Needs |
|---------|--------------|-------|
| **Agents** (Claude Code sessions — solo, team, workflow fan-out) | PRIMARY | Deterministic verbs with single-line JSON output, explicit exit codes, no interactive prompts; enough state visibility to decide the next hop |
| **Operator** | HITL authority | Retains merge, terraform/DNS, ambiguous-ingredient jury (#415 §Owner lane); needs the escape-hatch verb (`kitchen advance`) and readable watch output |
| **Dashboard UI** (external freeside-dashboard, Vercel) | Existing consumer — MUST NOT break | Continues on `ORDERING_SERVICE_URL`/`ORDERING_SERVICE_TOKEN` [CODE:packages/services/ordering/DEPLOY.md:66-74]; later reuses the same verbs' seam ("the latters are easy to build with this tooling" — Phase 1 Q1) |

> Sources: Phase 1 Q1 (agents-first decision); DEPLOY.md; #415 §Owner lane.

## 5. Functional Requirements

### 5.1 CLI ordering verbs (`freeside-cli`, network domain)

The epic's verb sketch (#415 §3), minus daemon-frame verbs, adapted to code reality:

| FR | Verb | Behavior | Backing endpoint |
|----|------|----------|------------------|
| FR-1 | `freeside order place --preset <p> --inputs <@file\|json>` | Place an order; print `{order_id, state}`. **Preset contract** [FLATLINE IMP-005, 770]: presets are owned by ONE source of truth — `@freeside/ordering-protocol` [CODE:packages/protocol/ordering/src/preset.ts:117,131]; the CLI does not carry its own preset list. Inputs are validated against the preset's input schema (client-side pre-flight or server 400 surfaced verbatim); unknown preset names fail with the available-preset list in the error JSON | `POST /v1/orders` [CODE:DEPLOY.md:8-13] |
| FR-2 | `freeside order status <order_id>` | Full order state + ingredient map | `GET /v1/orders/:id` |
| FR-3 | `freeside order ingredients <order_id>` | Ingredient-status view (status, blocked-on, last-probe) derived from FR-2 payload | `GET /v1/orders/:id` |
| FR-4 | `freeside kitchen probe <order_id> [--ingredient <i>]` | Request a fresh probe of ingredient(s) and report resulting status. **Freshness is a requirement, not an SDD choice** [FLATLINE SKP-002b, integrated 2026-07-01]: `kitchen probe` MUST trigger (or await) a live probe — it never serves interval-worker leftovers older than max-staleness (default 60s; SDD may tune the number, not the requirement). Endpoint mechanics (new `reprobe` route vs. synchronous probe pass-through) remain SDD scope. **Acceptance criteria** [FLATLINE IMP-003, 865]: probe output MUST carry `{probed_at, source, status}` per ingredient; output distinguishes `fresh` (probed within max-staleness) from `stale` (interval-worker leftovers) from `ambiguous` (probe errored/contradictory) — ambiguous maps to exit code 4, never silently coerced to pending/blocked | SDD to decide; probes exist server-side [CODE:src/http-building-probes.ts:57] |
| FR-5 | `freeside kitchen advance <order_id> --ingredient <i> --status <s>` | Advance an ingredient (agent when probes green; operator as HITL escape hatch). Requires token; server CAS + monotonic merge already protect against double-advance [CODE:store.ts:180-201, community-onboarding-orchestrator.ts:180-203]. **Bounded mutation** [FLATLINE IMP-008, 832; IMP-012, 815]: `--status` accepts ONLY the server enum (`pending\|in_progress\|complete\|blocked\|optional` [CODE:src/intake.ts:57]); `--ingredient` accepts ONLY the preset's ingredient set; CLI rejects out-of-range values client-side before any request AND surfaces server-side validation verbatim. `advance` is the sole mutating kitchen verb — the CLI must not grow into a general state editor. **Server-derived evidence** [FLATLINE SKP-011 + SDD-gate SKP-002, operator-approved revision 2026-07-01]: at advance time the SERVER snapshots its own latest probe result (`probe_meta[ingredient]`, see SDD D1/D3) into the `operator_audit` entry — every advance is traceable to unfakeable probe evidence; nothing evidence-shaped is client-supplied. An advance on a never-probed ingredient records `evidence: null` — the HITL escape hatch stays legal and visibly ungrounded | `POST /v1/orders/:id/advance-ingredient` |
| FR-6 | `freeside fulfill watch <order_id> [--interval <s>] [--timeout <s>]` | Poll until terminal (`fulfilled`/`failed`) or watch-timeout; emit one JSON line per state/ingredient **change only** (no repeated-state spam); exit code distinguishes fulfilled / failed / timeout (FR-7b). **Polling-based** — the event publisher is out of scope (§7). **Watch semantics** [FLATLINE IMP-007, 740]: stateless client — safe to interrupt and re-invoke at any point (state lives server-side); a `--once` mode returns the current snapshot and exits (agents can implement their own loop); transient poll failures are retried up to a bounded count then surfaced as exit 2, never silently swallowed (G-5) | `GET /v1/orders/:id` loop |

**FR-7 — Output discipline:** all verbs emit single-line JSON (loa-cli convention — "All output is single-line JSON (agent-friendly)", loa-cli README); error JSON carries `{error, http_status, order_id, hint}`. No prompts, no pagers, no color in JSON mode.

- **FR-7a — Exact output schemas** [FLATLINE IMP-001, 930]: every verb's success and error JSON shape is specified as a schema in the SDD and enforced by contract tests — nominal compliance ("some JSON") is not compliance. Downstream consumers (agents, dashboard, future SDK) program against these schemas.
- **FR-7b — Stable exit-code semantics** [FLATLINE IMP-002, 925]: one documented exit-code table shared by all verbs, stable across versions. Minimum classes: `0` success/fulfilled · `1` usage error · `2` service unreachable · `3` HTTP/API error · `4` ambiguous/blocked state (e.g., probe ambiguous, CAS lost) · `5` watch timeout · `6` order failed. Agents branch on exit codes, never on parsing error prose.

**FR-8 — Veve-ready declaration:** verbs are declared such that `loa` can generate its surface from them when grant-provisioning goes live (AWS-botocore pattern, loa-cli README). Constraint only — no dependency on the currently-inert `loa run` act-verbs (`goal-4:32`).

### 5.2 Registry declaration (network domain)

**FR-9:** `ordering` zone entry in `packages/freeside-registry/registry.yaml` with deployment URL + `/healthz` probe, so `freeside-cli doctor --remote` and `loa census` see it. Closes the "declaration keystone undone" gap (Phase 0: ordering absent from registry; transmission.md).

**FR-9a — Testable health semantics** [FLATLINE IMP-010, accepted 2026-07-01]: the registry entry declares the probe contract — `GET {deployment_url}/healthz` → HTTP 200 = healthy; non-200 / timeout (>5s) / connection-refused = down; doctor maps these to its existing ok/error taxonomy. A probe test asserts doctor classifies a mocked 200 and a mocked timeout correctly. No new health vocabulary — reuse existing registry/doctor conventions.

### 5.3 Service auth hardening (platform domain)

**FR-10:** `advance-ingredient` MUST reject unauthenticated requests in deployed configuration. Today auth is skipped entirely when `SERVICE_TOKEN` is unset [CODE:src/intake.ts:150-155].

- **FR-10a — Fail-closed at boot** [FLATLINE SKP-002a, integrated 2026-07-01]: in non-local environments (`NODE_ENV=production` or equivalent deployed marker), the service MUST refuse to mount write routes when `SERVICE_TOKEN` is unset — misconfiguration cannot produce an open write path. Local/dev in-memory mode may keep the tokenless convenience.
- **FR-10b — Deploy-config regression test** [same finding]: an integration test boots the deployed-mode config WITHOUT `SERVICE_TOKEN` and asserts write routes are absent/403 — pinning FR-10a against regression (G-4).

### Anti-inference note

This verb list was confirmed as the complete v0.3 surface (pre-generation gate, Assumption 1 confirmed). Deliberately absent: `order cancel`/`retry` (no service endpoint exists; add when the endpoint does), `kitchen enqueue` (fan-out is server-side), any orchestrator daemon controls.

> Sources: #415 §3 (verb sketch); Phase 4 Q3 (scope table confirmed); pre-gen gate assumptions 1–3 confirmed; code citations inline.

## 6. Non-Functional Requirements

| NFR | Requirement | Grounding |
|-----|-------------|-----------|
| NFR-1 | **Auth**: CLI reads `ORDERING_SERVICE_URL` + `ORDERING_SERVICE_TOKEN` env — the same seam the dashboard uses. Token never in argv, logs, or error JSON — pinned by a redaction test | DEPLOY.md:66-74; pre-gen Assumption 3 confirmed; FLATLINE SKP-001 |
| NFR-8 | **Minimal auth floor** [FLATLINE SKP-001, integrated 2026-07-01 — full scoped grants stay deferred per accepted tradeoff; veve/grant path open via FR-8]: (a) the ordering write token is **single-purpose** — not shared with any other service surface; (b) every advance records an **actor identity** (token label / caller name) in `operator_audit` server-side; (c) a documented **rotation/revocation runbook** ships with the platform PR (rotate = issue new token, update consumers, revoke old) | Flatline review 2026-07-01 |
| NFR-2 | **ADR-007 firewall**: delivery is ≥2 PRs — `platform/ordering` (FR-10) and `network/freeside-cli` (FR-1..9). No cross-domain PR | CLAUDE.md Hard rules; pre-gen Assumption 4 confirmed |
| NFR-6 | **Per-PR test floor** [FLATLINE IMP-006, 820; IMP-011, 760]: each PR carries its own mapped tests — platform PR: fail-closed auth integration test (G-4) + advance validation cases; network PR: verb contract tests against a fixture service (schemas + exit codes per FR-7a/7b) + registry probe test (FR-9). Manual-only CLI verification does not count as done | Flatline review 2026-07-01 |
| NFR-7 | **Dashboard regression guard** [FLATLINE IMP-004, 830]: the deployed dashboard consumer path (`POST /api/onboarding/orders/shadow-audit` → ordering-service) is smoke-verified after the platform PR (auth hardening) lands — auth changes MUST NOT break the existing `ORDERING_SERVICE_TOKEN`-bearing consumer [CODE:DEPLOY.md:66-85] | Flatline review 2026-07-01 |
| NFR-3 | **Idempotency**: verbs are safe to re-run; server CAS makes advance redelivery-safe — the CLI must not add client-side retry that masks CAS-loss responses; surface them (G-5) | store.ts:180-201 |
| NFR-4 | **Read-only default**: only `order place` and `kitchen advance` mutate; everything else is read-only. Write verbs clearly marked in help output | Karpathy simplicity floor |
| NFR-5 | **No new deps**: follow freeside-cli's existing zero-framework switch-dispatch pattern [CODE:bin/freeside-cli.ts:45] | ingestion: cli-topology |

## 7. Scope & Prioritization

### In scope (this cycle)

1. CLI ordering verbs — FR-1..8 (**the product**)
2. Registry declaration — FR-9 ("inks the chalk")
3. advance-ingredient auth hardening — FR-10

### Deferred (fast-follow, explicitly not this cycle)

| Item | Why deferred | Trigger to pick up |
|------|--------------|--------------------|
| shadow_preview real probe (#401) | Agent can probe-and-judge via `kitchen probe` + `advance`; auto-unblock only matters for zero-agent fulfill | When zero-agent fulfillment becomes the goal (Phase C of #415) |
| Lifecycle publisher (NATS) | Outbox events currently have no live consumer — publishing them is deployed-but-unconsumed by construction; `fulfill watch` polls instead | When a real consumer exists (dashboard live-updates or JetStream `ORDERS`) |
| PhaseGateRunner / bridge-bug-queue consumption | Under agent-first, the agent session runs the post-PR loop in-window; the mechanical pieces (parse/classify/queue) already exist [CODE:.claude/scripts/post-pr-triage.sh:254-281] — the unconsumed queue is a Loa-side follow-up | Separate Loa-side track (close-bridgebuilder-loop P3-P4) |
| Typed SDK / Code Mode surface | Gated behind the goal-4 de-risk spike (`goal-4:29-34`); wraps these verbs later | Spike PASS per goal-4 kill-test |
| MCP tools on mcp-gateway | Discovery organ, not consume hot-path; "still discovering MCP/Code mode... don't think we're there yet" (Phase 1 Q2) | Operator call |

### Non-goals (inherited from #415 §Non-goals, still binding)

- Replacing `/autonomous` full 8-phase meta-orchestrator
- Quest ↔ order unification
- Billing / chef-credits policy
- Multi-tenant external customer onboarding

> Sources: Phase 4 Q3 (confirmed table); #415 §Non-goals; Phase 1 Q2 (MCP quote).

## 8. Risks & Dependencies

| Risk | Impact | Mitigation |
|------|--------|------------|
| **CI red merge gates** (#375/#386 OPEN): every PR inherits red Unit/Integration/Security lanes — "≤1 operator decision" cannot be certified against noise | G-1 demo credibility | Scope PR-level test lanes to changed packages; do NOT count baseline-red as patch signal; flag per `feedback_ci-sensors-must-not-be-numb` |
| **Deployed service drift**: DEPLOY.md cites `kitchen-api-production-1937.up.railway.app` — liveness unverified this session | G-2 blocked if service down/moved | Sprint task 0: probe deployed `/healthz` before building against it (deployed-truth-first) |
| **SERVICE_TOKEN distribution**: agents need the token to advance; no grant model yet (loa grant layer inert) | Any token-holder can advance any order | NFR-8 minimal floor (single-purpose token, actor identity, rotation runbook); FR-8 keeps the veve/grant path open; full scoping deferred — note in SDD threat model |
| **Registry write = network domain, service fix = platform domain** | Accidental cross-domain PR blocked by CI | NFR-2 split enforced at sprint-plan level |
| **FR-4 probe mechanism unknown** | SDD may need a new service endpoint (platform PR grows) | SDD decides mechanics only — the freshness requirement (live probe, max-staleness 60s default) is fixed; serving stale interval-worker state is not a legal fallback |

### Dependencies

- Deployed ordering-service on Railway (own Postgres, port 8090) [CODE:railway.toml, store-factory.ts:6-8]
- freeside-dashboard integration must remain intact (external repo, consumes same endpoints)
- sonar-api #111 (Azuki order) as the G-1 acceptance fixture — real stuck order, not a synthetic

## 9. Acceptance / Demo Script (G-1 walkthrough)

1. `freeside order status 6ddc06f5` → shows `producing`, sonar `in_progress`
2. `freeside kitchen probe 6ddc06f5 --ingredient sonar` → probe returns `complete` (sonar-api #117 merged 2026-07-01)
3. `freeside kitchen advance 6ddc06f5 --ingredient sonar --status complete` → CAS-accepted, `operator_audit` appended
4. Repeat probe/advance for score, worlds_manifest as they complete; shadow_preview auto-unblocks server-side [CODE:community-onboarding-orchestrator.ts:196-203]; advance it (stub probe — #401 deferred)
5. `freeside fulfill watch 6ddc06f5` → emits state changes → exits 0 on `fulfilled` with `world_slug`
6. Zero curl. Operator decisions: 0 (merge already happened at #117).

## 10. Corrections to the source epic (provenance)

Recorded so #415 can be amended; none block this PRD:

1. **FulfillmentOrchestrator is not new** — in-process orchestration + sibling worker + fan-out already committed (see §1). The epic's open question (in-service vs sibling worker) is moot: both exist sharing one composition root [CODE:src/composition.ts:51]; this cycle builds neither.
2. **"loa #1036 DISS-003"** is a likely mislabel — the DEGRADED-convergence hardening is loa **#1025**/sprint-bug-210; #1036 is the exit-code-vs-convergence_state visibility fix (OPEN).
3. **`grimoires/loa/context/harness-upstream-discovery/rfc-issue-draft.md` does not exist**; no "Worldline Harness RFC" found in-repo. `implement-gate.sh` is a PreToolUse compliance hook (`.claude/hooks/compliance/`), not a phase-gate harness.
4. **Registry gap understated**: ordering is entirely absent from registry.yaml — the epic's "Registry truth" criterion requires FR-9 first.
5. **advance-ingredient is unauthenticated when SERVICE_TOKEN is unset** [CODE:src/intake.ts:150-155] — a security gap the epic did not flag; now FR-10/G-4.

---

> **Traceability**: every requirement above cites either a code location ([CODE:file:line], verified by Phase-0 ingestion agents on 2026-07-01), a source document (file:line), or an interview response (Phase N Q N — Q1 reframe, Q2 surface fork, Q3 scope table, Q4 goals, pre-gen gate assumptions 1–4, all operator-confirmed).

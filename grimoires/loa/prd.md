# PRD — Waggle Loop S1: Consumer Conformance + Four Real Surfaces

**Cycle**: waggle-s1
**Date**: 2026-07-09
**Domains touched**: `network/registry` (conformance_ref), `platform/tools` (doctor), external repo `freeside-dashboard` (suites + wiring). Per ADR-007 no single PR crosses platform/network — sprint plan slices by repo/domain.
**Primary source**: `grimoires/loa/context/2026-07-09-consumer-conformance-loop.md` (operator-promoted, grill rounds 1–2)
**Reality**: `grimoires/loa/reality/` (ride 2026-07-06, fresh)

---

## 1. Problem Statement

Every consumer-side failure in the estate renders as a **plausible zero**. The dashboard's 136 fail-soft catch sites collapse API-down and empty-community into identical pixels; `loa doctor` reports healthy with zero discovery; SVM was silently down 5 days; sonar#120 indexes 0 Azuki holders right now and no alarm exists. Requirements live as prose (registry notes, briefs, beads) that nothing executes — one `expectations[]` block exists estate-wide and nothing evaluates it.

In distributed-systems language (§2): the estate's seams have **no acknowledgment protocol** — consumers cannot distinguish "no data" from "message lost" (the Two Generals problem), and no seam declares a **fault model or staleness bound**, so "quiet" and "down" are indistinguishable by construction.

> Sources: 2026-07-09-consumer-conformance-loop.md §1; 2026-07-02-consumption-truth-direction.md:19-64; grill R1.

## 2. Distributed-Systems Framing (the language — Kleppmann → Freeside)

Operator-requested vocabulary (2026-07-09): the loop is a distributed system; name its parts precisely.

| Kleppmann concept | Freeside instance | What it prescribes here |
|---|---|---|
| Two Generals (no common knowledge over lossy channel) | Dashboard ↔ building seams; catch→zero | Explicit ack: every read renders `data \| error \| stale`, never a fabricated zero (FR-6) |
| System models: partially-synchronous + crash-recovery | Buildings on Railway/Vercel; blue-green rotation | Every sensed seam declares timeout + cadence; **a missed cadence IS a violation** (quiet-vs-down becomes decidable) |
| Failure detector (eventually-perfect) | Conformance suites on cron + immune rack | Suspect on timeout, recover on next green; transition-only alerting (matches kalfu constraints) |
| Bounded staleness / consistency SLO | `expectations[]` thresholds: graphql-lag, event-max-age | Consumer contracts assert staleness bounds, not just shape (FR-2) |
| Total-order broadcast / replicated log | `orders.lifecycle.*.v1` durable JetStream (replayable) | The order feed is consumed as a log (offset/replay), not polled state (FR-5) |
| State machine replication | Order saga placed→routing→producing→fulfilled; shadow-mode member-graph ledger | UI order state = deterministic replay of the log; divergence = defect, testable |
| Eventually-consistent derived replica | Registry `runtime_state` (hand-typed) vs live probes; BFO read-models | Derive-flip (S3): replicas follow the log, never hand-edited |
| Quorum | Flatline 2-of-3; FAGAN council; adversarial verify votes | Loop verdicts that gate action need ≥2 independent confirmations |
| Byzantine boundary | Third-party (Executor cloud, Dune) vs sovereign substrate; Legba ed25519 envelopes | Signed/verifiable at trust boundaries; third-party data is evidence, never verdict |
| Graph cut vertex (EULER) | inventory-api (betweenness 8.0), score-api (6.0); belt-DAG has **0 machine-readable edges** | SPOF seams get contract suites FIRST; suites materialize the missing consumer→producer edges |

Gap named as an order: summon a **KLEPPMANN lens** (lab-desk register, via CURATOR) owning fault-model + consistency-bound language for future seam reviews. Reference: Kleppmann Cambridge lecture series + notes (cl.cam.ac.uk/teaching/2122/ConcDisSys/dist-sys-notes.pdf).

> Sources: operator mid-session request 2026-07-09; 2026-06-28-shadow-audit-belt-dag-subway-ordering.md:86-92 (cut vertices); order-system-mvp-brief.md:48-64.

## 3. Goals

| ID | Goal | Metric |
|----|------|--------|
| G-1 | Zero silent zeros on wired operator surfaces | Contract suites assert error/stale states render distinctly; 0 remaining `catch→zero/null` paths on the four S1 surfaces |
| G-2 | Four surfaces REAL for Mibera (badges, access audit, inventories, order events) | Live data renders end-to-end for a known holder/member; each surface's suite green against the live seam |
| G-3 | Requirements executable | `tests/contracts/<building>/` suite per wired building in dashboard CI; coverage matrix with MUST ≥95%; DISCREPANCIES.md exists; registry `expectations[]` gain additive `conformance_ref` |
| G-4 | The pulse breathes | Sink adapter TESTED + first digest durably queued in the conformance ledger; live Discord delivery flips on webhook provision (one rule — S1 is decidable without the webhook; cures SKP-010) |
| G-5 | Backpressure register live | reality-ledger classifies every dashboard surface (`live \| sample(order:<ref>) \| delete-proposed`); every gap discovered during wiring files an order (bead) |

> Sources: grill R1–R2; testing-conformance-harnesses skill (coverage accounting).

## 4. Consumers & Stakeholders

1. **Operator** (primary): needs screens he can quote — a zero must be provably a real zero.
2. **Internal team** (newly named colony, 2026-07-09 correction): requests **world onboardings** — the top-20 are worlds/communities entering Freeside at the first shadow-mode rung. Sonar is only the chain-surfacer fulfilling one onboarding step. Their requests are orders; S3 makes them visible.
3. **End-users of the dashboard**: get graceful degradation, honestly labeled (Live / Sample / Unavailable), never fake data.
4. **Agents** (second colony, R1): consume the same conformance verdicts + registry to navigate; whole-Fable at factory altitude, act within cells.

## 5. Functional Requirements

### FR-1 — Badges real (activities-api)
The dashboard badge surface reads real earned badges from activities-api `/v1/badges` (identity-scoped Bearer minted by identity-api), replacing the stubbed grid and the score-api facade path.
- **AC1**: A Mibera member with granted badges sees them render from live activities-api data.
- **AC2**: When activities-api is unreachable or the Bearer is invalid, the surface renders an explicit error state (never an empty grid) — the silent-401 drift class is caught by the suite.
- **AC3**: Contract suite `tests/contracts/activities/` asserts endpoint shape, auth flow, and staleness bound; runs in dashboard CI.
- Adjacent: bead arrakis-mbs-s2.3 (mibera-dimensions surface) — verify repoint state before scoping overlap.

> Sources: mibera-badge-surface-brief.md:23-32,66-67; architecture-overview.md:60-63; grill R2.

### FR-2 — Access audit live (shadow-audit surface)
The member audit page consumes the real Access-Risk Audit API (in-monolith module `packages/services/shadow-audit/bin/http.ts`); the MOCK_AUDIT fixture path is **deleted** (per silence rule — the config-client precedent).
- **AC1**: A member's audit page shows real access decisions from the shadow spine.
- **AC2**: `SHADOW_AUDIT_API_URL` resolution decided and recorded (expose from monolith edge; no new service extraction — [ASSUMPTION] confirmed at pre-generation gate).
- **AC3**: Contract suite asserts response schema + auth; unavailable renders loud (operator surface).

> Sources: api-surface.md:26-28; consumer-conformance-loop.md:55; pre-gen gate assumption [1] confirmed.

### FR-3 — Inventories real (inventory-api, PUBLIC reads)
**Operator decision (FR-5 fork, 2026-07-09): public reads.** Drop the Railway edge wall on read paths, point canonical DNS at the Railway deploy, dashboard client repoints; writes stay fenced.
- **AC1**: A known holder's PFP/holdings render non-empty from live inventory-api (the read-plane user-truth check).
- **AC2**: ONE canonical URL across producer, registry, consumer; registry `beacon_url` fixed; inventory-api #18 (beacon serving) merged.
- **AC3**: Non-2xx renders as explicit error state; the dead-host-silence class is pinned in the catch-set + suite.
- **AC4**: Suite asserts the Alchemy-shaped read surface the dashboard actually consumes (holdings/:address, metadata/:contract/:tokenId).

> Sources: 2026-07-02-consumption-truth-direction.md:40-45,77-80,103-104; mibera-inventory-sovereignty-brief.md:114-120; fork answer R3-Q1.

### FR-4 — World events via order lifecycle first
**Operator decision (events fork): order-lifecycle-first.** The inbox renders real `orders.lifecycle.{placed,routing,producing,fulfilled}.v1` events **via the SDD D-5 transport: a server-side HTTP log-read of the order outbox (`GET /v1/orders/events`, monotonic `seq` cursor)** — the browser never touches JetStream/NATS and no broker credentials leave the sovereign side (cures SKP-003 CRITICAL). The outbox IS the durable log JetStream drains from; offset/replay semantics are preserved. Worlds-api inbox graduates in S2/S3 once verifiably deployed.

**Consumer log contract (cures SKP-004 CRITICAL, IMP-011):** the versioned order state machine in `packages/protocol/ordering/src/events.ts` is the contract of record (initial `placed`; terminals `fulfilled|refused|failed`; legal transitions per its event union). Cursor is durable per consumer; ordering key = `seq`; dedup key = `order_id + event_type + seq`; unknown event versions render as `unknown-event`, never dropped silently. Suite ships canonical event-sequence fixtures (happy path, duplicate delivery, gap, late event, mid-replay crash) with expected projections — replay of the same log MUST reproduce the same inbox state.
- **AC1**: Real order events render in the Hub inbox with lifecycle state; demo feed becomes labeled `sample`, then dies.
- **AC2**: UI order state reproduces from log replay (state-machine-replication check in the suite).
- **AC3**: Known blocker surfaced honestly: shadow_preview stub (#401) stalls new orders — replay of existing events is in-scope; unsticking #401 is filed as an order, not hidden.

> Sources: order-system-mvp-brief.md:48-64,139-148; 2026-07-02-consumption-truth-direction.md:31-39; fork answer R3-Q2.

### FR-5 — Consumer contract harness + registry pointer
Per `/testing-conformance-harnesses`: `tests/contracts/<building>/` per wired building (Pattern 5), coverage matrix, DISCREPANCIES.md, fixture PROVENANCE. Registry `ModuleEntry.expectations[]` gains **additive** `conformance_ref` (freeside-cli decode stays green; single-prober rule untouched — conformance_ref is data, probing stays in loa-cli's lane).
- **AC1**: Suites run in dashboard CI; a `consumer-conformance` doctor registers in `tools/immune-instruments.yaml` (literal ground-source token; inherits daily cron `17 13 * * *` = 13:17 UTC).
- **AC2**: MUST-coverage ≥95% per wired building or gap documented in COVERAGE.md.

> Sources: registry.ts:59-137,174-176; cadence-ledger-rehomed-brief.md:14-18,35-38; immune-instruments.yaml contract.

### FR-6 — Silence rule codified (per-surface)
Operator/analytics surfaces fail LOUD; end-user surfaces degrade gracefully AND emit a violation event to the conformance ledger. Feature-level honesty labels (Live / Sample / Unavailable) everywhere; reality-ledger (`freeside-dashboard/grimoires/loa/reality-ledger.md`) classifies all surfaces.
- **AC1**: The four S1 surfaces have zero remaining catch→zero paths (grep-assertable).
- **AC2**: Every fabricated community card carries its label + order ref (they are worlds at rung 0 — pre-orders, per §4.2).

### FR-7 — The pulse (Discord)
Daily digest + transition-only alerts (working→broken, broken→fixed) from the conformance ledger via Discord webhook. Includes worlds-onboarding progress + order-log lines.

**S1 acceptance rule (one rule, decidable — cures SKP-010):** S1 ships the sink adapter WITH a test (mock webhook) plus durable digest queueing in the ledger; live delivery activates the moment the operator provides the webhook URL, with no code change. G-4 is met by tested-adapter + queued-digest evidence.

**Alerting state model (cures SKP-009):** per-seam state starts `UNKNOWN` (no alert on first observation); flip to `broken` after 2 consecutive failing observations (hysteresis), back to `working` on 1 green; a missed cadence window IS an observation (`stale`); transitions computed in event-time (`observed_at`) order; sink delivery gets bounded retry/backoff, and undeliverable alerts dead-letter into the ledger (loud in the next digest) — sinks fail soft, the record never lies.

## 6. Non-Functional Requirements

- **NFR-1 Additive-only registry schema** — freeside-cli + probe.mjs must keep decoding (registry.ts:174-176).
- **NFR-2 Truth-path sovereignty** — zero external SaaS in the truth path; sinks fail-soft; runners on owned substrates (kalfu constraints, cadence-ledger-rehomed-brief.md:35-38). Executor/Dune = evidence only, never verdict.
- **NFR-3 Autonomy posture** — loop files beads autonomously; PR-generating fixes operator-pointed; DRAFT PRs only while the merge door is frozen (goal-0/goal-2 constraints). Reviews via local cheval council; fan-out tier-routed (haiku extract / sonnet implement / opus judge), never blanket-Opus.
- **NFR-4 Catch-set discipline** — every real miss becomes a pinned conformance case (SHANNON pattern); seeds: 24-vs-0 parity, Zod-cap swallow, dead-host silence, sonar#120 zero-holders.
- **NFR-5 Process-over-artifact** — a violation recurring twice gets its generator fixed, never a third hand-fix (Bun-rewrite doctrine).

## 7. Scope

**In (S1)**: FR-1..FR-6 + conformance ledger; FR-7 wiring behind webhook availability.
**Out (explicit)**: probe_kind runner (loa-cli, next cycle — producer lane); worlds-api inbox wiring (S2/S3); campaigns persistence API (order-in-waiting, not picked for S1); on-chain badge mint (graduation seam preserved); belt-gateway registration + runtime_state derive-flip + top-20 world onboardings (S3); frames-doctrine dependency (loop runs as plain machinery).

## 8. Risks & Dependencies

| # | Risk / dependency | Mitigation |
|---|---|---|
| R-1 | identity-api Bearer minting for activities reads — secret drift = silent 401s | Suite asserts auth flow explicitly (FR-1 AC2); drift becomes a loud, sensed failure |
| R-2 | Inventory unwall = Railway/DNS infra change (operator-adjacent) | Smallest infra diff: edge-wall off read paths only; keyed fallback documented if public posture fails review |
| R-3 | shadow_preview stub #401 stalls NEW orders → event feed shows only replayed history | AC scoped to replay; #401 filed as order; golden-thread (Azuki order 6ddc06f5) remains the settle target |
| R-4 | sonar#120 (0 Azuki holders) poisons inventory/holdings truth for that collection | Catch-set case; differential check vs Dune (inhale) flags indexer-vs-chain divergence |
| R-5 | Cut vertices: inventory-api / score-api SPOFs (EULER) | Their seams get suites first; failure now visible + attributable, path redundancy = future work |
| R-6 | Merge door frozen (loa-signoff absent → --admin merges) | Accept for S1 (documented); heal via bead qbt0r lane, precondition for unattended ACT |
| R-7 | B1 donation wallet list exists in no repo (badge grants) | Operator/Gumi to deposit list; badge READ surface (FR-1) doesn't block on it |

## 9. S3 Preview — Worlds, not "sonar communities" (operator correction 2026-07-09)

The top-20 are **worlds entering Freeside** at the first shadow-mode rung, ordered by the internal team. Sonar indexing their chains is one fulfillment step of a world-onboarding order. S3 makes the onboarding ladder itself visible (per-world rung + order log), turning the dashboard's fabricated stand-ins into rung-0 worlds with live order refs. Execution doctrine: whole-Fable at factory altitude, act within cells.

## 10. Flatline-Integrated Contracts (2026-07-09 · 3-voice fleet: SOL/codex + grok-4.5/native + composer/cursor)

First fleet review returned 18 blockers + 15 two-voice improvements (800–970). Cures integrated here; each tagged with its finding. These are S1 requirements, not advisories.

### 10.1 Seam contract table — numeric bounds (SKP-001 CRITICAL 930, SKP-006, IMP-006)
All values **PROPOSED tier, observe-only until S2 ratification** (mirrors sonar chain-lag discipline). Machine-readable copy lands beside each contract suite; clock-skew allowance ±30s everywhere.

| Seam (building → dashboard) | Request timeout | Probe cadence | Max data age (stale bound) |
|---|---|---|---|
| activities-api /v1/badges | 5s | 15m | 10m |
| shadow-audit access decisions | 5s | 15m | 15m |
| inventory-api holdings/profile | 8s (Alchemy-backed) | 15m | 30m |
| order-events outbox read | 5s | 5m | 2m (event-max-age from newest `seq`) |

Verdict semantics: response beyond max age renders `stale` (never `live`); missed cadence window = `stale` observation in the ledger (quiet-vs-down becomes decidable per §2).

### 10.2 Acknowledgment/provenance protocol — no fabricated zeros via 200-empty (SKP-002 CRITICAL 925)
A successful seam response MUST carry: `observed_at` (producer clock), a source checkpoint (block number / log `seq` / run marker as fits the seam), and a completeness flag. **An empty collection is authoritative ONLY when fresh (`observed_at` within max age) and `complete`** — otherwise it renders `stale`/`error`, never a zero. Each suite includes a failure-injection case: upstream fault yielding 200-empty MUST NOT render as a real zero. `SeamResult<T>` (SDD) gains these fields.

### 10.3 Producer-side minimal ack + quorum wiring (SKP-002 860, SKP-004 780)
S1 is not consumer-only: each wired building gets one immune-rack live probe (existing `probe.mjs` service-block classify) sharing §10.1 thresholds. **Reality-ledger flips to `live` only on QUORUM: dashboard contract suite green AND rack probe green; disagreement = a violation in the ledger**, not a pass. (Full producer `probe_kind` runner stays next-cycle; this is the minimal symmetric ack.)

### 10.4 Public-read threat model for inventory (SKP-001 920, SKP-005 790, IMP-012)
Before the edge wall drops: per-IP rate limit (PROPOSED 60 req/min) + 429 with Retry-After; pagination caps + address validation at the edge; cache headers on holdings/metadata; upstream circuit breaker + daily provider cost ceiling (Alchemy-backed); CORS allowlist; **rollback trigger** = re-wall + keyed-fallback documented and rehearsable in one step. Consumer suite asserts 429/503 render loud. Reads-only exposure verified (no write-adjacent route reachable) before DNS flips.

### 10.5 Auth contracts (SKP-005 750, SKP-006 785)
- **Shadow-audit (FR-2):** S1 exposure is operator-scoped only (admin reads; member-self deferred to S2); TLS-only; suite cases: unauthenticated → loud 401 render; cross-member access → denial.
- **Activities Bearer (FR-1):** token minted and held server-side ONLY (never reaches the browser); issuer=identity-api, audience=activities-api, TTL + refresh documented in the suite's fixture notes; negative cases: wrong audience, expired, wrong issuer.

### 10.6 CI split — hermetic vs live (SKP-007 755, IMP-010)
Two lanes, never conflated: (a) **hermetic contract tests** (provenance-pinned fixtures) — deterministic, BLOCKING in dashboard CI; (b) **live conformance probes** — scheduled (immune rack + dashboard cron), informational-never-required per rack doctrine, feeding the ledger/pulse. **Coverage denominator (G-3):** enumerated MUST clauses per suite's COVERAGE.md; score = passing MUST / enumerated MUST; XFAIL = documented gap, never a pass.

### 10.7 Conformance ledger schema (SKP-008 750)
Versioned append-only JSONL: `{schema_version, seam_id, observed_at, ingested_at, verdict: live|stale|error|violation, evidence_ref, run_id, idempotency_key}`. One writer per lane (CI runner / rack cron); duplicate `idempotency_key` is a no-op; transition algorithm (§FR-7 state model) computes over per-seam `observed_at` order; ledger unavailable = loud failure in the next pulse, never silent.

### 10.8 Cross-repo rollout invariant (SKP-011 710, IMP-004)
Order: registry schema (additive) → producer changes (unwall/deploy/#18) → consumer wiring (dashboard) → DNS/beacon pointer flips. **Every intermediate state must be safe** (old consumers keep decoding; old pointers keep resolving until the flip). Rollback per step is a single revert. Sprint plan slices along this order; ADR-007 domain isolation per PR.

### 10.9 Decidability + scope pins (IMP-001 970, IMP-003 955, IMP-005 925, IMP-007 875, SKP-015 705)
- **Silence-rule scope (G-1):** "zero remaining catch→zero paths" applies to the four S1 wired surfaces only; the repo-wide sweep is S2+ (deferral list in reality-ledger).
- **conformance_ref shape (registry):** `conformance_ref: "<repo>#<path>@<git-ref>"` — e.g. `freeside-dashboard#tests/contracts/activities@main`; worked example ships with the schema change.
- **Pinned test identity:** one versioned Mibera holder fixture (address + expected collection evidence from TWO independent observations, with block/checkpoint + expiry date) checked into fixtures with PROVENANCE. Third-party evidence (Dune) informs but never settles a verdict alone. sonar#120 divergence classifies as `violation(indexer)`, not suite-weakening.
- **Canonical surface index (IMP-002 850):** the reality-ledger's initial enumeration of ALL dashboard surfaces is an S1 deliverable, not emergent.

---
> **Traceability**: every FR traces to the promoted brief, grill R1/R2 answers, fork answers (R3), or cited context/reality files. Assumptions confirmed at the pre-generation gate 2026-07-09: monolith-exposed audit surface; identity Bearer mintable today; top-20 worlds order real (pin during S1 — verify wording against internal-team request, not sonar issues).

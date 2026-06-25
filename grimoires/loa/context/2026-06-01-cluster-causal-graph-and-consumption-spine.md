---
title: Cluster Consumption Spine + Causal-Graph Wedge
date: 2026-06-01
mode: arch
status: candidate
use_label: background_only
provenance:
  source_type: ai-derived
  session: operator-os ARCH discussion (FREESIDE+GECKO), cluster consumption grounding
boundaries: >
  Candidate brief. Resolves mental models + names a wedge. NOT a sprint plan.
  Application code stays gated (cycle-112 GO → cycle-2 /plan→/run). Do not
  promote to active context without operator approval.
grounded_against:
  - packages/events/src/envelope.ts (acvp-l1-v2 fields)
  - packages/events/src/subscriber.ts:162 (core NATS subscribe)
  - packages/events/src/emit.ts:142 ("NOT the transactional outbox")
  - freeside-sonar/ponder-runtime/src/lib/reorg-safe-emit.ts:80
  - freeside-worlds/packages/config-protocol/surface-config.ts (Effect.Schema)
  - freeside-auth/packages/protocol/src/svc-jwt-claims.ts (first Effect artifact)
  - freeside-auth/packages/sdk/src/client.ts (vendored SDK)
  - bonfire/score-api + @0xhoneyjar/score-api-types (Zod + published npm)
  - freeside-dashboard/src/lib/score-api/types.ts (80+ types re-declared locally)
  - freeside-coherence (validator: static gaps only, Seam A pending)
  - grimoires/loa/cycles/cycle-112-schema-emission-floor/RESUME.md
trust_tier: ai-derived
read_state: skimmed
confidence: 0.6
decay_class: working
last_confirmed: 2026-06-01
operator_signed: self_attested
---

# Cluster Consumption Spine + Causal-Graph Wedge

> The operator's question — "wire the clusters to be consumed by real products
> (dashboard, characters) without crossing wires" — resolved against the *territory*,
> not the map. Verified by an 8-reader grounding pass over the 4 APIs + 2 consumers
> + the ACVP/events substrate (2026-06-01).

---

## 1. The mental model (resolved)

### 1.1 The 4-rung consumability climb

A building is "seamlessly consumable by an agentic consumer" only when all four rungs are present, and the consumer is **bound** to rungs 1–2:

| Rung | What | Failure if absent |
|------|------|-------------------|
| **1. Schema** | a typed contract | consumer guesses the shape |
| **2. SDK (bound)** | a consumer-importable client *bound to* rung 1 | consumer re-types by hand → silent drift |
| **3. Beacon** | a discovery declaration (`beacon.json`/BeaconV3) | consumer hardcodes URLs; can't be found |
| **4. Trace** | a `correlation_id`/`causation_id` that survives the boundary | chains are invisible; can't verify what fired |

### 1.2 The diagnosis, one line

**The cluster has bridges; the consumers refuse to stand on them.** The contracts
*exist* (`@0xhoneyjar/score-api-types` published, the identity-api SDK vendored, the
signed events envelope) — but consumers **re-type by hand**, so a producer change
**drifts silently instead of failing loud**. And **no `trace_id` survives a single
hop**, so when a chain breaks you can't follow it. This is `deployed-but-unconsumed`
applied to *contracts*.

### 1.3 The cure

**Bind + Discover + Trace — NOT rebuild.** The highest-leverage slice makes *one*
consumer import the *real* contract and thread `trace_id` end-to-end.

### 1.4 Contract-readiness scorecard (verified 2026-06-01)

```
                SCHEMA          SDK(bound)        BEACON     TRACE   FAIL-LOUD
identity-api    Effect+Zod ✅   vendored-src ✅   yes ✅      ❌       A ✅
score-api       Zod ✅          npm pkg ⚠*        V2+V3 ✅    ❌       A ✅
worlds-api      Effect ✅       none ❌           none ❌     ❌       B ✅
sonar-api       Ponder/SDL 🟡   none ❌           none ❌     ❌       C- ⚠
events(L1)      Effect ✅       = is the contract aspirational ❌      ✅
```
*\* score-api publishes a typed package; the dashboard imports none of it and
re-declares all 80+ types in `src/lib/score-api/types.ts` (the drift bomb).*

**Consumers:**
- **dashboard** — binds score-api by hand-re-typing; identity partial; worlds via
  silent mock fallback; sonar never. `effect` in package.json, unused in `src/`.
- **characters** — only `@0xhoneyjar/events` is a real shared contract; identity +
  inventory hand-mirrored; the verified-JWT path is **dead code**
  (`setAuthBridgeDeps()` never called at boot).

---

## 2. The decided architecture forks (this session)

| Fork | Decision | Note |
|------|----------|------|
| **Contract north-star** | **Effect.Schema everywhere** | one dialect, max agent-legibility (E/R channels in every signature). score Zod→Effect + sonar Effect read-API are migrations, not rewrites. |
| **First wedge** | **the event seam** (causal graph), not the dashboard seam | the dashboard tangle is synchronous contract-drift; the operator's atomicity question lives on the async NATS spine. |
| **Event durability** | **causal graph first, code-only** | keep NATS-on-Railway as-is; JetStream durability is a separable step taken only per-subject when loss becomes unacceptable. |
| **Gradient compose** | **hold** | run Gygax+Arneson on the *built* slice, so there's real substance to react to. |

### 2.1 Effect.Schema migration map (north-star)
- identity-api: ✅ already (svc-jwt-claims) — finish the Zod→Effect transition (resolve/auth/profile/link still Zod)
- worlds-api: ✅ already (config-protocol)
- events(L1): ✅ already (EventEnvelopeSchema)
- score-api: 🔧 migrate Zod→Effect (it is the A-grade surface; migrate *carefully*, keep the published-types package contract stable)
- sonar-api: 🔧 Effect read-API layer over Ponder (GraphQL stays; add typed error codes)

---

## 3. Event semantics — what the cluster actually guarantees

**You do not get distributed transactions. By design.** The honeycomb choice *is* the
act of giving up atomic cross-cell chains. The load-bearing heuristic:

> **The transaction boundary IS the cell boundary.**
> Must-be-atomic → one building, one DB txn. Can-be-eventually-consistent → two
> buildings + an event. "Event vs sync call" = "atomic or not" = "one cell or two."

### 3.1 Grounded guarantee profile (sonar → NATS → characters)

```
 sonar (PUBLISH)            NATS core (TRANSPORT)      characters (CONSUME)
 stateΔ + outbox row   ──▶  subject nft.mint.*   ──▶   decode+verify+route
  1 PG txn = ATOMIC          no persist/replay/ack       sig + payload-hash +
  relay retry×10 + DLQ       AT-MOST-ONCE                 prev_hash continuity
  AT-LEAST-ONCE              to consumer                  detects loss (chain gap)
  to the BROKER                                           …cannot recover it
```

**Headline: at-least-once to the broker, at-most-once to the consumer, with
cryptographic loss-*detection* (`prev_hash` chain) but no loss-*recovery* (core
NATS has no replay).** Verified: `subscriber.ts:162` uses `nc.subscribe()` (core),
not JetStream; no `.ack()`.

### 3.2 Footguns found
- **at-most-once to consumer** — a mint emitted while characters restarts is *gone*
  (detected via chain gap, not recovered). Survivable for announcements; a loaded
  gun for badges/payments/state.
- **two publish paths, two guarantees** — sonar's outbox (strong) vs the L2 inline
  fire-and-forget on Base/Optimism depth=0 (swallowed failures, no outbox row).
- **no consumer idempotency found** — at-least-once-to-broker means a retry can
  duplicate; no dedup table → double-fire.
- **no causal thread** — envelope has `event_id` + per-publisher `prev_hash`, but
  **no `correlation_id`/`causation_id`** → chains are real but invisible.

### 3.3 The reframe (the call-stack you deleted)

In a synchronous system, **the call stack IS the proof the chain fired** (the return
bubbles up). Events delete the call stack. So you rebuild it as data:
- `correlation_id` = *which flow* (the whole tree)
- `causation_id` = *which event directly caused this one* (the parent edge)

Those two fields ARE a reconstructable distributed call-stack (canonical lineage:
Greg Young / EventStore correlation+causation). Because ACVP already signs +
hash-chains every link, the reconstructed call-stack is **tamper-evident** — a
*cryptographically verifiable distributed call stack*, which an in-process stack
never was. **That is the honeycomb's actual superpower, one field away from existing.**
It is also exactly why `freeside-coherence` is stuck on static gaps (Seam A): no
`correlation_id` ties live instances together.

---

## 4. The wedge: causal-graph layer (cycle-112 cycle-2)

### 4.1 Prerequisite — cycle-112 is DONE + MERGED (corrected 2026-06-01)

⚠ **Map-vs-territory correction.** The cycle-112 `RESUME.md` described the cycle as
"parked at Phase-7 GO, nothing committed." The git history says otherwise: **cycle-112
shipped all 5 sprints and merged to main** as `68f5a89c feat(events): cycle-112
schema-emission coherence floor (#261)` — 1864 lines in `packages/events` with full
tests, incl. T4.5 scoped-recovery (which the RESUME had flagged as an open GO
question). The schema-emission floor is **LIVE on main**.

This means **two of the three operator goals are already shipped**:
- **fail-loud** — `emit()` returns typed `SchemaEmitError` (validation) vs
  `TransportEmitError`/`TimeoutError` (infra); unhandled-`Either` lint forbids
  fire-and-forget.
- **cluster schema enforcement** — soundness floor: every emit validates against its
  declared schema; `no-raw-nats-publish` lint + set-subset shrink gate (now
  fail-block); `freeside-events` beacon `bound`.

The facade `emit(id, payload, specifier?)` (`packages/events/src/emit.ts:177,257`) is
the single emission chokepoint — **but its 3rd parameter is a positional `specifier?:
string`, with no options object and no ambient handling-context.** So cycle-2's causal
threading must **extend the facade** (specifier → opts object, and/or add ambient
context) — a v3 task, not a free seam. Threading is still cleanest *here* (the
chokepoint), just now an extension rather than a greenfield design.

### 4.2 Envelope v3 spec (`acvp-l1-v3`)

Add to `EventEnvelopeSchema` (new versioned subject + ≥30d v2/v3 coexistence per the
package's bump discipline):

```
correlation_id : UUID         -- the flow id. Propagated UNCHANGED down the chain.
                                 Root event mints a fresh one (or reuses its event_id).
causation_id   : UUID | null  -- event_id of the DIRECT parent. Root = null.
```

Signing already covers all non-signature fields → both new fields are tamper-evident
for free. `S.Struct` strictness → v2 and v3 are distinct schemas; consumers run two
`subscribeEnvelope` calls during coexistence.

### 4.3 Propagation rule (threaded through the cycle-112 facade)

- subscriber sets the verified envelope as **ambient handling context**
- `emit(SchemaId, payload)` reads ambient and auto-sets:
  `new.correlation_id = handled.correlation_id`,
  `new.causation_id = handled.event_id`
- root emitters (no ambient, e.g. sonar block-tick) mint a fresh `correlation_id`,
  `causation_id = null`
- mirrors OpenTelemetry context propagation; the facade is the only correct home.

### 4.4 Cross-repo sequence

1. **Keystone (loa-freeside `packages/events`)** — envelope v3 + facade threading +
   ambient context helper. *Gated: sprint in cycle-2.*
2. **sonar (`reorg-safe-emit.ts`)** — root emitters mint `correlation_id`; +
   structured error codes; + `GET /outbox/status`.
3. **characters (`mint-event-subscriber.ts`)** — set ambient on receive; dedup by
   `event_id` (idempotency, now required); propagate on any downstream emit.
4. **coherence** — consume the causal thread → `chain-broken`/`dead-quiet`/
   `discrepancy` go from "uncertain" to LIVE (Seam A closed). Explorer leaves
   fixtures for real traces.

### 4.5 Open questions (for cycle-2 /plan)
- **Per-subject guarantee tiers** — should the topic taxonomy encode a guarantee
  class (at-most-once announcement vs at-least-once-durable state)? Candidate: a
  tier marker in the 3-segment topic or a registry field, so JetStream-vs-core is a
  declared per-subject property, not an accident of which `.subscribe` was used.
- **First saga** — the verify→badge→? chain (the operator's chosen first
  activities-api consumer) is the first 3-hop chain that may need compensation. Design
  the compensating event before it ships.
- **Idempotency substrate** — inbox-table dedup in the events package (shared) vs
  per-consumer? A shared `processedEvents(event_id)` helper keeps it cheap-to-comply.

---

## 5. Immediate next step

cycle-112 is merged — there is nothing to GO. The next build is **cycle-2: the
causal-graph slice**, scoped minimally (the operator's "code-only, NATS-as-is" fork):

1. **envelope v3** (`acvp-l1-v3`) — add `correlation_id` + `causation_id`; new
   versioned subject + ≥30d v2/v3 coexistence.
2. **extend the `emit()` facade** — `specifier` → opts object and/or ambient
   handling-context, so causal fields thread without breaking the v2 call sites.
3. **one producer** (sonar root emitters mint `correlation_id`) → **one consumer**
   (characters: set ambient on receive, propagate, **dedup by `event_id`**) →
   **coherence reads the thread → live** (Seam A closed).

**Deferred to cycle-2+N (do NOT pull in):** sagas/compensations, per-subject
guarantee tiers, JetStream durability, sonar structured-error-codes + `/outbox/status`
(nice-to-have, not on the causal-graph critical path).

This is a net-new cycle (contract change + cross-repo) → it earns a proper
`/plan → /architect → /sprint-plan` (or simstim 8-phase, as cycle-112 used), with a
Flatline pass on the envelope evolution. It is NOT a `/run` of cycle-112's (completed)
plan.

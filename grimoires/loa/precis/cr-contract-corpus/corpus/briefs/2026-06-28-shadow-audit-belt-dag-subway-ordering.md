---
status: shadow-audit
date: 2026-06-28
target: belt-DAG / composition graph ("DAG graph subway ordering")
domain: platform
method: Icebreaker-shaped immune loop (sense → settle → surface) + EULER graph analysis
---

# Shadow Audit — the belt-DAG "subway ordering"

**Target (operator-chosen):** the cluster's **belt-DAG** — buildings composing via belts that run
ONE direction by data-semantic depth (`RAW → DERIVED → INTEGRATED → PRESENTED`, ADR-008). A subway
map IS a DAG with a topological ordering (lines = ordered stops, transfer stations = cut vertices).
The audit: is it acyclic? does a coherent subway ordering exist? where are the bottlenecks? and —
the immune question — does the running system actually *have* this graph, or only the design doc?

## Verdict: the subway map exists only in prose (0 machine-readable edges)

The designed DAG is sound; the **running system declares none of it**. This is
[[map-territory-drift-unifying-failure]] / [[deployed-but-unconsumed-pattern]] at the DAG level — the
cluster's *core composition model* is doctrine + schema-supported, but unpopulated.

| Source | belt edges | note |
|---|---|---|
| ADR-008 §D-3 (design prose) | **5** | sonar/storage→inventory→score→presented |
| BeaconV3 schema | (field exists) | "sibling building composition", ADR-007 §D-4 — declarable per building |
| `registry.yaml` modules | **0** | 10 buildings carry only git_url/beacon_url/deployment_url/visibility/owner — no belt field |
| `loa census --graph` | **0** | 40 nodes, `edges: []` — the living-graph tool aggregates no belts |
| building beacons | **0** | the one inspectable (freeside-mint) declares no belt field |

You cannot compute a topological order, detect a cycle, or find a bottleneck on a graph whose edges
exist nowhere queryable. The immune finding is **the edge set itself** — declarable, designed,
undeclared.

## The DESIGNED subway map (computed from ADR-008 — what the running graph *should* assert)

```
depth 0 [RAW]        sonar-api          → consumes []
depth 0 [RAW]        storage-api        → consumes []
depth 1 [DERIVED]    inventory-api      → consumes [sonar-api, storage-api]
depth 2 [INTEGRATED] score-api          → consumes [inventory-api]
depth 3 [PRESENTED]  score-mibera-ui    → consumes [score-api]
depth 3 [PRESENTED]  discord-embeds     → consumes [score-api]
```
- **Acyclic: YES** — a clean DAG. The data-depth invariant ("closer-to-raw publishes, closer-to-meaning
  consumes") makes a cycle structurally impossible *by design* — a cycle would mean raw events depending
  on a derived holding, which has no meaning. The doctrine is self-protecting; the risk is only that
  nothing *enforces* it (no edges to check).
- **Cut vertices (transfer stations): `score-api` + `inventory-api`.** Every path from a PRESENTED node
  to a RAW source passes through both — their outage disconnects the line. This is precisely ADR-008's
  bottleneck diagnostic ("walk upstream on the belts"); these two are where to look first when something
  presented is slow/wrong. They earn the most failure-isolation + fail-soft attention.

## Coverage gap — 6 of 10 buildings have no place on the map

`activities-api, events-api, identity-api, ledger-api, mediums-api, mint-api` carry **no belt edge**
anywhere — not even in ADR-008. Either they are genuinely independent (leaf services with no upstream/
downstream composition — plausible for identity/ledger), or the DAG is simply under-specified. With zero
declared edges there is no way to tell. An edgeless node on a subway map is a station no line reaches.

## The cure (highest-leverage first — pending EULER's ranking)

The finding is an *aggregation* gap, not a design flaw. Minimal fixes, by leverage:
1. **Populate beacon `consumes`/`publishes`** per building (the schema already supports it; ADR-008
   already mandates it). One field per building turns prose into data.
2. **Have `loa census --graph` aggregate the beacon belts into `edges`** — then the subway map is
   queryable, cycles/ordering/cut-vertices become computable, and `edges: 0` stops being a silent lie.
3. **A `loa belts` verb** (or fold into `loa doctor`) that walks the declared belts, asserts acyclicity,
   prints the topological order, and flags the cut vertices — the immune sensor for the composition graph.

Without (1), the rest is moot — the map needs lines before it can be ridden.

## How this was audited (the Icebreaker-shaped loop)
SENSE (census/registry/beacons/ADR-008) → SETTLE (designed edges = 5, declared = 0 ⇒ CONFIRMED-unbacked,
the same verdict the evidence loop gives a test-less capability) → SURFACE (this report). The same immune
shape, re-aimed from "capability test-backing" to "composition-graph edge-backing."

## EULER's graph-theoretic analysis (networkx-verified)

- **F1 — acyclicity is FORCED, not lucky.** The depth function (RAW=0 → PRESENTED=3) is a topological
  *potential*: every designed edge strictly increases it, so a cycle is impossible — **the data-depth
  invariant and acyclicity are the same statement.** A cycle = a back-edge = an invariant violation.
  ⇒ **cycle-detection is a one-line lint**, not a DFS: `reject belt where depth(consumer) ≤ depth(producer)`.
  **Blind spot:** intra-layer same-depth belts (`score-api ↔ score-mibera`, both depth 2) — the 4-tier
  bucket is too coarse to catch a same-layer cycle; needs strict per-node depth.
- **F2 — TWO cut vertices in series (corrected: inventory > score).** `inventory-api` **betweenness 8.0**
  (the raw-convergence merge — both sources merge here AND it feeds both integrated consumers; its outage
  severs *everything* downstream) — the higher-leverage bottleneck. `score-api` **betweenness 6.0** — the
  minimal vertex cut for the *presented* layer specifically (`min_node_cut(raw→presented) = {score}`,
  size 1). **Vertex-connectivity raw→presented = 1**: a single-thread spine, **zero path redundancy** —
  no alternate route, a single point of failure at *either* station. "No redundancy was a design choice
  nobody made explicitly." (Findings invariant under consumes-vs-publishes orientation — verified.)
- **F3 — the sharpest reframe:** in the *machine-readable* graph, census returns **0 edges for all 40
  nodes**. So the "connected 4-node line" exists ONLY because a human read English in ADR-008.
  **Measurement coverage = 0%. The cluster does not know its own shape.** The 6 edgeless buildings aren't
  genuine islands — degree-0 is observationally identical to "fully belted but undeclared," and the prior
  (a *composition*-doctrine cluster with 60% isolated nodes) says *under-specification*. (Operator check:
  does `identity-api` actually get consumed by score/inventory/mediums in running code?)

## The finding is SYSTEMIC — the construct graph has the identical disease

Re-aimed the same audit at the **construct composition graph** (`composes_with`): the `loa-constructs`
registry declares **0 `composes_with` edges across 19 constructs (0/19 populate the field)**. Same
pattern, different graph: edges are declarable per-node (construct manifests / beacons) but **no registry
or census aggregates them** — so the construct constellation, like the belt-DAG, is edge-invisible at the
queryable level. ([[construct-constellation-declared-orphans]] is this same gap seen from the manifest
side.) **Two independent graphs, one disease: the cluster's composition structure is declared in prose +
per-node fields but never aggregated into a graph anything can query.**

## The cure (EULER-ranked) — the cluster's own standard cure for its own standard disease

1. **KEYSTONE — populate the per-node edge field that ALREADY EXISTS** (BeaconV3 `consumes`/`publishes`
   for buildings; `composes_with` for constructs). Per-node = each owner declares its own belts = no
   cross-domain PR (firewall-compatible). Start with ONE first consumer (the 4 designed belt edges) as
   the shadow, then graduate — the [[deployed-but-unconsumed-pattern]] cure applied to edges.
2. **Make `census --graph` aggregate those per-node fields into `edges`** — turns "40 nodes / 0 edges"
   into the computable subway map. *The entire point of the audit.*
3. **A depth-invariant lint** (`loa belts --lint`, or fold into census/doctor): `reject depth(consumer)
   ≤ depth(producer)` — *simultaneously* the cycle check, the data-depth check, and the isolated-node
   flag. The teeth that keep the graph true once #1+#2 make it data.

Without #1 the rest is moot — **the map needs lines before it can be ridden.**

**Routing (EULER, surface-not-decide):** the-arcade owns cure #1+#2 (composition-belt + census reader);
GECKO owns the deployed-but-unconsumed / 0%-coverage drift framing. The lint (#3) is a network-layer CI
gate alongside `path-domain-check`.

*(EULER's full networkx output + the reproducible `belt_dag.py` are in the session scratchpad.)*

## Third instance — the BEADS work-DAG (`blocked-by`)

Re-aimed the subway-ordering lens at the **work graph** (391 issues, 197 with dependency edges):
- **Acyclic — no deadlocks.** `br dep cycles` → "No dependency cycles detected." The work DAG is
  well-ordered; no issue is transitively blocked on itself (no undeliverable loop). This is the ONE graph
  in the cluster that *is* both edge-populated AND queryable (beads stores + checks its own edges) — the
  proof that the cure works: when edges are data, acyclicity is a one-command check.
- **The work-DAG bottleneck (its cut vertex): `arrakis-cubquests-activities-extraction-b54u` blocks 28
  issues.** It is the single highest-leverage node — closing it cascades the largest unblock (then
  `arrakis-mint-api-factory-s1` blocks 13, the activities-api convergence slice blocks 11, Freeside
  Decomposition C1 blocks 10). This IS the subway-ordering payoff on a populated graph: "what unblocks the
  most" is a `dependent_count` sort, computable precisely *because the edges are data* — the exact thing
  the belt-DAG can't answer about itself.
- **But 138/391 issues (35%) carry NO domain label** — a Hard-Rule-3 gap (CLAUDE.md mandates
  `domain:platform|network|shared`), which *also* makes Hard-Rule-5 ("no cross-domain `blocked-by`")
  unenforceable for every edge touching an unlabeled node. The rule has teeth; 35% of the nodes wear no
  collar for the teeth to grip. Breakdown: **73 legacy `bd-*`** (the old loa prefix — imported, never
  labeled) + 57 current `arrakis-*` (missed at creation). The `bd-*` cohort is a one-shot backfill; the
  `arrakis-*` leak wants a creation-time default (label-or-reject), the same "teeth need the metadata"
  cure as the belt edges.

## ⟐ The convergent meta-finding (why all three graphs rhyme)

Three independent graphs — belt-DAG, construct `composes_with`, beads `blocked-by` — surface **one
disease**:

> **The cluster declares its structural rules but under-populates the metadata that makes them
> machine-checkable.** Belt edges: 0% aggregated. Construct `composes_with`: 0/19 declared. Beads domain
> labels: 65% present. The DAG, the firewall, and the composition contract all *exist as doctrine* and are
> *schema-supported*; what's missing is the populated data a tool can read to enforce them.

This is the cluster's signature disease — [[deployed-but-unconsumed-pattern]] + [[map-territory-drift-unifying-failure]]
— seen at the **structural-metadata** layer. And the beads work-DAG is the **existence proof of the cure**:
it is the only one of the three whose edges live in data (not prose), and it is therefore the only one
where "is it acyclic / well-ordered" is a single command instead of a human reading English. **Make the
other two graphs look like the beads graph** (edges as queryable data) and every structural property —
acyclicity, subway-ordering, bottlenecks, the firewall — becomes a check instead of a hope.

The keystone cure is unchanged and now *triply* motivated: **populate the per-node edge/label metadata
(one first consumer, then graduate) and let a tool aggregate it.** The beads team already did this for the
work-DAG; the belt-DAG and construct-graph are waiting their turn.

## ⟐⟐ The finding generalizes BEYOND graphs — the AUTH layer has the same disease (live-verified)

The cluster's own dogfood immune beads (8 open) cluster around **auth**, and three are the *exact* same
"declared-in-prose, missing-as-data" pattern — I live-probed two and both are **still real today**:

- **`registry-auth-field` (p2):** the cluster auth model is a **registry.yaml COMMENT**, not a structured
  `auth:` field. Prose, not data — the *same* shape as the belt edges (ADR-008 prose, no `consumes`).
- **`identity-beacon-404` (p2):** identity-api (the auth ROOT) **declares** a `beacon_url` but the route
  returns **HTTP 404** (verified `https://identity.0xhoneyjar.xyz/.well-known/beacon.json` → 404). The
  auth root is federation-invisible — declaration ≠ reality, at the most load-bearing node.
- **`es256-svcjwt-ghost` (p2):** identity mints ES256 service-JWTs, but `/.well-known/jwks.json` returns
  **404** (verified) and no cell runs an ES256 verifier — the tokens are **un-spendable**. Textbook
  [[deployed-but-unconsumed-pattern]]: the capability ships, no consumer exists.

So the audit's reach is bigger than the subway map: **the cluster declares its contracts — composition
belts, domain labels, the auth model, federation routes — as prose/aspiration, and under-populates the
machine-readable data + live wiring that would make any of them true.** Composition (belt-DAG 0% edges) and
auth (registry-auth prose, identity beacon 404, es256 ghost) are two faces of one disease. The cure is
identical at both: **declare it as data at the source, wire one real consumer, let a tool/probe verify it.**
That is the cluster's own `deployed-but-unconsumed → one-first-consumer-shadow → graduate` cure, applied to
its own structural and auth metadata. (Auth findings are already tracked as the `arrakis-dogfood-*` beads;
this audit's contribution is the triage — verified still-real 2026-06-28 — and the unification.)

## The audit, made RUNNABLE — `cluster-self-knowledge-probe.py`

The finding shouldn't be a one-off prose report — the disease is *continuous*, so the sensor should be too.
`grimoires/loa/context/cluster-self-knowledge-probe.py` asks, for each structural contract: **does the
cluster know this as DATA (queryable/verifiable) or only as PROSE (declared, dead)?** — reading the
registry + beads and **live-probing** the endpoints. Current reading (2026-06-28):

```
[✗ PROSE] composition: belt edges        0/10 buildings declare belts
[✗ PROSE] governance: beads domain labels 253/391 (64%)
[✗ PROSE] auth: identity beacon route    HTTP 404   (auth root federation-invisible)
[✗ PROSE] auth: ES256 jwks verifier      HTTP 404   (svc-JWTs un-spendable)
[✗ PROSE] auth: registry auth: field     0/10 cells (prose comment only)
SELF-KNOWLEDGE SCORE: 0/5 contracts knowable as data/live.
```

**0/5.** The cluster does not know its own shape on a single one of these. **Re-run it to track the cure:
each `✗ PROSE → ✓ DATA` is one contract the cluster learned about itself.** This is the immune sensor for
the convergent disease — adopt it into `estate-coherence.sh` / the dogfood loop so the score is watched,
not rediscovered. (It generalizes trivially: add a row per contract.)

## ⟐⟐⟐ Third layer — the FEDERATION discovery is ~90% declared-but-unserved (live-probed)

Probed all 10 registry buildings' `beacon_url` (federation discovery) + `deployment_url` (host liveness):

| building | beacon | host | reading |
|---|---|---|---|
| activities-api | **200** | 200 | ✓ federation-discoverable (the ONLY one) |
| identity-api | 404 | 200 | host UP, beacon route 404 — deployed, discovery-invisible |
| inventory-api | 404 | 401 | host UP, beacon 404 |
| sonar-api | 404 | 200 | host UP, beacon 404 |
| storage-api | 404 | 200 | host UP, beacon 404 |
| mint-api | 404 | 404 | host UP, beacon 404 |
| score-api | 503 | 404 | host UP, beacon 503 |
| mediums-api | 404 | — | beacon 404, no deploy |
| events-api | — | — | DARK (no deploy, no beacon) |
| ledger-api | — | — | DARK |

**beacon-live: 1/10.** The `identity-beacon-404` dogfood finding isn't an identity quirk — it's the
**systemic state**: 6 buildings are deployed (host responds) but serve no beacon at their declared URL
(deployed-but-discovery-invisible), 2 are fully dark. The federation — the network layer's *entire point*
(discover-then-reach) — is **declared in the registry (`beacon_url` per cell) and ~90% un-served in
reality.** Same disease, third layer: composition (belt edges 0%), auth (identity/es256 404), and now
**federation discovery (beacons 1/10)** are all *declared-but-not-wired*. The cluster's design doc and its
running system are three layers apart, and every layer rhymes.

> Caveat (verify-don't-assert): a 404 could be a stale `beacon_url` in the registry rather than a missing
> route — but for the host-UP cases that distinction *is* the finding (the registry's discovery pointer is
> wrong OR the route was never shipped; either way discovery fails). The one that works (activities-api)
> proves the pattern is achievable; the other 9 haven't reached it. The self-knowledge probe now carries
> these rows, so the federation-liveness score is watched continuously.

# Five-lens building-factory survey — synthesis

> Composition `factory-survey-20260620a` — **valid_run** (Legba `2cf2cfea`). Five
> constructs surveyed loa-cli + loa-freeside + the freeside-* -api buildings; each from
> its domain lens; SYNTHESIZER folded them. Surface-never-decide held — every flag routes
> to an owner. Recipe: `compositions/discovery/survey-the-building-factory.yaml`.
> (EULER ran genome-carried via general-purpose — its adapter, installed mid-session, was
> invisible to the Workflow runtime's boot-loaded registry; the recipe keeps `construct-euler`
> for future sessions.)

## THE ONE SHAPE — map and territory drifted apart at every layer

Four lenses, four vocabularies, one phenomenon — the declarations got rich faster than the
live substrate caught up, and **nothing joins the two**:

| Lens | Names it |
|------|----------|
| GECKO | declared/earned **scissors** |
| EULER | **internal inconsistency** (belt DAG cyclic as declared) |
| KRANZ | the reader **reads corpses** |
| BEAUVOIR | declared where nothing reads, **read where nothing declares** |

The factory model (ADR-008) is sound *as direction*. The failure is the join.

## Provable conflicts (each routed)

- **S1 — registry undercounts the live set ~25%.** `registry.yaml:55` `version:1`, 9 modules; **ledger-api** (local), **billing-api** (remote, pushed 2026-06-06), **worlds-api** (remote = renamed `freeside-worlds`, same createdAt/desc) are LIVE + unregistered. The registry header (`:53`) even names `freeside-ledger-missing`. → registry/census owner.
- **S2 — the belt-DAG edge feed is dark.** `loa-cli graph.mjs:216 resolveEdges()` is built + security-tested; `graph.mjs:239-242 graduate()` needs a *measured* inbound edge → the **EARNED tier is structurally unreachable cluster-wide** because `census.mjs:20-21` belt consumption is UNMEASURED/blocked (beacons external+404). Reader built, feed empty. → loa-cli census + registry owners.
- **S3 — the naming fix misses the form beacons emit.** `ALIAS_TABLE` folds `sonar→sonar-api` but **not** `freeside-sonar` (EXECUTED: `canonicalId('freeside-sonar')` → unchanged). Beacon edges use the `freeside-` prefix → would land on phantom nodes, silent disconnect. → loa-cli graph owner (extend by explicit PR) + building owners.
- **S4 — the ADR's canonical DAG example is stale.** ADR-008 §D-3 "inventory consumes sonar + storage"; the inventory beacon **removed** the storage edge (`beacon:17-22`). → ADR-008 + inventory owners.

## EULER's headline (the graph lens — artifacts on disk)

**ADR-008 calls the belt structure "the DAG" but `is_directed_acyclic_graph(full) = FALSE`** —
2 directed cycles, both through the back-edge `activities-api → sonar-api`, which the
activities beacon *itself flags wrong-way* (`beacon.yaml:70-71`). The cycle exists only
because ADR-008 collapses data + auth + control edges into one "belt" graph; **type the
edges and the data-plane is a clean DAG** (cut-edge verified). Structural roles: score-api =
pure SINK (in3/out0); sonar = source-broker but in1 (not the true raw root in the data-plane);
storage = source with 0 LIVE consumers; mint + mediums = ISOLATED. LIVE-only graph: 3 edges,
6 components — "the belt DAG is mostly a drawing."
Artifacts: `grimoires/euler/graphs/freeside-factory/{edges.csv,freeside-factory.graphml,build.py}`
(NetworkX-rebuildable; every edge cites `asserted_by`).

## KRANZ + BEAUVOIR (the other live findings)

- **KRANZ** — the audit tool itself reads corpses: `auditing-cluster-cells/.../audit-cells.sh:26`
  hardcodes the legacy `freeside-*` slug→dir map, so 5/8 mount verdicts describe extracted-monolith
  corpses (the trap *inside* the audit). The one honest gate: registry `runtime_state` is 9/9 truthful
  (6 deployed / 1 scaffolded / 2 not-built — it doesn't lie green). ledger = candidate (not "LIVE"),
  billing = phantom (monolith-only), worlds = naming-phantom (`freeside-worlds`).
- **BEAUVOIR** — TWO disconnected edge systems: beacon `composes_with` (richly populated, `freeside-`
  prefix, read by nobody) vs loa-cli `resolveEdges` (built/tested, registry slugs, empty in prod).
  Both ADR §D-5 compound products (`community-management`, `world-hosting`) are non-composable today.

## The deepest synthesis + the operator fork

The cluster has **one working immune cell** (the honest node `runtime_state`, KRANZ K9) and
**none at the edge layer** (the belt DAG has no honest gate — S2 is UNMEASURED). This is the
[[estate-immune-system-pattern]] at building-factory altitude: **replicate the node gate's shape
at the edge.** The convergent move is not to *build* (readers + schema exist) but to **bridge
map↔territory and feed the waiting readers** — gated on one genuine fork:

> **Is cluster truth CURATED-then-derived** (registry.yaml + beacon `composes_with` are authored
> SoT; runtime mirrors them) **or DISCOVERED-then-reconciled** (veve+probe census is SoT;
> declarations are checked against it)? `registry.yaml`'s schema implies the former; `census.mjs:5`
> + the operator's living-building-census thesis imply the latter. Ramps A/B/C all diverge on the
> answer; S1 + S2 can't be cured without prejudicing it.

## Honest inter-lens disagreement (surfaced, not resolved)

EULER: belt DAG **cyclic** (from beacon edges + prose). BEAUVOIR: **acyclic** from `composes_with`
alone. Likely different edge sets (EULER honored the activities prose self-contradiction; BEAUVOIR
read only declared `composes_with`). Routed back to EULER to reconcile — neither lens overruled.

## Mechanical fixes routable now (don't prejudice the fork)
register/discover ledger+billing+worlds (S1) · fold `freeside-` in ALIAS_TABLE by explicit PR (S3) ·
mark ADR §D-3 example aspirational (S4) · EULER↔BEAUVOIR reconcile the cycle (S6).

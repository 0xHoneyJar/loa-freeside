# EULER analysis — the beads "super-hub" is a phantom

> EULER's first move (run euler-applied #1), executed on real data 2026-06-20.
> map-the-graph → structure-vs-random. Graph objects:
> `grimoires/euler/graphs/beads-{blocks,parent-child}.edges.csv`.
> Surface-never-decide: this routes to the `/leverage` owner; it is not a decision.

## Graph before claim

Extracted typed-directed edges from `.beads/issues.jsonl` (770 records).
Edge `A → B` = "A depends on / is blocked by B"; type ∈ {blocks, parent-child}.
- **blocks** (scheduling DAG): 293 edges, 268 endpoints
- **parent-child** (decomposition tree): 241 edges, 275 endpoints
- Closure: **0 dangling edges** — the full edge set is closed. (Refines SYNTHESIZER's
  Σ261≠Σ250 signal: that asymmetry is an *active-329-subset* artifact, not a broken
  graph. The full graph balances.)

## The finding

`/leverage` ranks the swarm by the combined `dependent_count`, which fuses both edge
types. That fusion manufactures a bottleneck that does not exist:

| node | combined | blocks (scheduling) | parent-child (tree) |
|------|----------|---------------------|---------------------|
| `…cubquests-activities-extraction-b54u` (the "28-hub") | 28 | **0** | 28 |
| `…mint-api-factory-s1-7ho2` | 13 | 3 | 10 |
| `…b54u.27.8` | 11 | 0 | 11 |

**The alleged 28-dependent critical-path super-hub blocks _nothing_.** It is a pure
decomposition epic — all 28 are children, zero are scheduling blockers.

### The true scheduling bottlenecks (blocks-only)
| node | blocks | status |
|------|--------|--------|
| `arrakis-oidt` | 7 | closed |
| `arrakis-232n` | 6 | **open** ← the real top live blocker |
| `arrakis-s3-substrate-pin-vercel-cred-r2oc` | 6 | closed |
| `arrakis-vmo4` | 5 | open |

Real max scheduling in-degree = **7** (not 28). Top *open* live blocker = `arrakis-232n` (6) —
exactly GECKO's ≈6 prediction.

### Is even the real hub surprising? (structure-vs-random)
Correct null for a **max-degree** claim = degree-destroying **G(N,E)** random placement
(the configuration model preserves degrees → degenerate for a hub claim; it is the right
null for the *community/modularity* question on the affinity network, not this one).

- G(N=268, E=293), 1000 samples, seed=0: null max-in-degree **5.05 ± 0.80** (range 4–9)
- observed max scheduling in-degree **7** → **z = 2.44** → **borderline / WEAK**

So even the *real* scheduling structure is only weakly concentrated — there is no
dramatic preferential-attachment bottleneck. The "scale-free super-hub" story was
entirely an artifact of fusing the decomposition tree into the scheduling count.

## Routes (surface, never decide)
- **`/leverage` owner + gecko**: re-point swarm ranking off the combined `dependent_count`;
  use blocks-only in-degree, filtered to `status: open`. Current #1 (`b54u`) → should be
  `arrakis-232n`.
- **map-the-graph**: the typed-directed extractor above is the reusable prerequisite — land
  it as the graph object `/leverage` reads, so the fusion can't recur.

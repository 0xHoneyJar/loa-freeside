#!/usr/bin/env python3
"""EULER · map-the-graph · the freeside building-factory belt graph.

Reconstructs the latent graph from edges.csv. A->B means: A publishes a belt
that B consumes (data flows A->B; B depends on A). Verifies the DAG claim
ADR-008 makes, with edge-kind separation (data belts vs auth/control edges).
"""
import csv, os
import networkx as nx

HERE = os.path.dirname(os.path.abspath(__file__))

# --- the building universe (nodes the registry/repos assert exist) ---------
# belt nodes (participate in the DAG) + their registry runtime_state
BELT_NODES = {
    "sonar-api": "deployed", "storage-api": "deployed", "identity-api": "deployed",
    "inventory-api": "deployed", "score-api": "deployed", "activities-api": "deployed",
    "mint-api": "scaffolded", "mediums-api": "not-built", "ledger-api": "candidate(unregistered)",
}
# nodes that exist but carry ZERO grounded belt edges (isolated in this graph)
ISOLATED = {"mint-api": "scaffolded; activities references MintIntentId as forward-compat brand, no runtime call",
            "mediums-api": "L2 presentation registry (npm lib); no grounded consumes/publishes",
            "storage-api": "raw source; both outbound edges are stub/future (0 live)"}
# non-belt nodes (named in scope but NOT belt participants)
NON_BELT = {"events-api": "in-repo protocol DEFINER (contract plane); not a belt node",
            "worlds-api": "local freeside-worlds; no beacon, unregistered; discovery-invisible consumer",
            "billing-api": "PHANTOM: monolith-only (themes/sietch/src/services/billing); no repo, no beacon -> not a building",
            "loa-cli": "discovery/census layer; reads registry+beacons; not a belt node",
            "loa-freeside": "platform substrate; hosts runtimes; not a belt node"}

def load(kinds=None):
    G = nx.DiGraph()
    for n, st in BELT_NODES.items():
        G.add_node(n, runtime_state=st)
    with open(os.path.join(HERE, "edges.csv")) as f:
        for row in csv.DictReader(f):
            if kinds and row["kind"] not in kinds:
                continue
            G.add_edge(row["source"], row["target"],
                       kind=row["kind"], state=row["state"], weight=float(row["weight"]))
    return G

def shape(G, label):
    n, m = G.number_of_nodes(), G.number_of_edges()
    dens = nx.density(G)
    dag = nx.is_directed_acyclic_graph(G)
    wcc = nx.number_weakly_connected_components(G)
    print(f"\n{label}")
    print(f"  |V|={n}  |E|={m}  density={dens:.3f}  acyclic={dag}  weakly-conn-components={wcc}")
    if not dag:
        cycles = list(nx.simple_cycles(G))
        print(f"  *** CYCLES ({len(cycles)}): ***")
        for c in cycles:
            edges = [(c[i], c[(i+1) % len(c)]) for i in range(len(c))]
            lab = " -> ".join(c + [c[0]])
            kinds = [G[u][v]["kind"] for u, v in edges]
            print(f"     {lab}   edge-kinds={kinds}")
    return dag

print("=" * 70)
print("GRAPH: freeside-factory  ·  the building-factory belt graph")
print("=" * 70)

full = load()                       # all edge kinds (data + auth + control)
data = load({"data"})               # data belts only
live = load()                       # live-only filter below
live.remove_edges_from([(u, v) for u, v, d in live.edges(data=True) if d["state"] != "live"])

dag_full = shape(full, "FULL  (data + auth + control belts — ADR-008's single 'belt' graph):")
dag_data = shape(data, "DATA-ONLY  (event/read belts; auth+control removed):")
dag_live = shape(live, "LIVE-ONLY  (state==live edges; aspirational/stub/future/claimed removed):")

print("\nNODE STATES (belt participants):")
for n in sorted(full.nodes()):
    ind, outd = full.in_degree(n), full.out_degree(n)
    iso = "  <- ISOLATED" if (ind + outd) == 0 else ""
    print(f"  {n:16s} in={ind} out={outd}  state={full.nodes[n].get('runtime_state','?')}{iso}")

print("\nNON-BELT / PHANTOM nodes (named in scope, NOT in the belt graph):")
for n, why in NON_BELT.items():
    print(f"  {n:16s} {why}")

nx.write_graphml(full, os.path.join(HERE, "freeside-factory.graphml"))
print(f"\nwrote freeside-factory.graphml ({full.number_of_nodes()} nodes, {full.number_of_edges()} edges)")

# S3-T1 — Declaration Keystone PROPOSAL (OPERATOR-GATED, network plane)

> **Status: PROPOSAL — not applied.** Bead `arrakis-acbc` (domain:network). This edits the **live
> deploy/discovery SoT** (`packages/freeside-registry/registry.yaml`) and the `loa census` aggregation
> — both are network-plane routing/discovery surfaces under the OperatorOS "NO creative latitude for
> runtime routing / discovery" boundary + ADR-007 (network domain). An autonomous local run does NOT
> mutate them. This document is the apply-ready change for operator review.

## Why it's gated (and why it can't just be done locally)

1. **The registry schema has no `consumes`/`publishes` field yet.** Per the `registry.yaml` header the
   schema is `git_url · beacon_url · deployment_url · visibility · owner · added · runtime_state · notes`.
   `consumes:` appears only in free-text notes. So this is a **schema bump** (like the prior
   `registry-auth-field` per-cell `auth:` bump), a deliberate network op.
2. **`loa census --graph` is edgeless today** — the known bug `arrakis-w3h2` ("belt-DAG edges are 0%
   machine-aggregated; census/registry/beacons all edgeless"). The acceptance "census renders the
   order→audit edges" depends on FIXING that aggregation, which is network-plane work, not a local edit.
3. The discovery plane is empty (`loa doctor` → `discovered:0, granted:0`; `loa where shadow-mode-api`
   → `found:false`, re-verified this run) — so even with declarations, grants are needed for resolution.

## The declarations to add (the order-system belt-DAG)

Add a belt field (`consumes`/`publishes`, names TBD by the schema bump) to these modules:

```yaml
# order-intake / ordering-service (NEW module to register — platform building)
ordering-service:
  publishes: [orders.lifecycle.placed.v1, orders.lifecycle.routing.v1,
              orders.lifecycle.producing.v1, orders.lifecycle.fulfilled.v1, orders.lifecycle.failed.v1]
  consumes:  [shadow-mode-api]          # the audit reads the member-graph spine (the LADDER)

# the audit cell (shadow-audit / shadow-mode-api) — the spine it composes
shadow-mode-api:
  consumes:  [sonar-api, score-api, worlds-api]   # ownership (L0) + value (L1) + roles
```

Resulting edges `loa census --graph` should render once aggregation lands (closes `arrakis-w3h2`):

```
order(ordering-service) --orders.lifecycle.*.v1--> consumers
ordering-service --consumes--> shadow-mode-api --consumes--> sonar-api + score-api + worlds-api
```

## Plus: grants (S3-T2 live dependency)

A grant reaching the audit's buildings is required for `loa where` to return `found:true` (the
`LoaWhereCapabilityResolver` built this sprint fails closed until then — honest). Grant scope: the
ordering-service operator identity → `member-graph` (shadow-mode-api) + `roles` (worlds-api).

## What landed this run instead (platform, in-domain, tested)

- **`LoaWhereCapabilityResolver`** (S3-T2) — behind the existing `CapabilityResolver` PORT; queries
  `loa where`, labels `source:'loa-where'`, fail-closed. Swap is config→this, no other change. Ready
  to go live the moment the declarations + grants above exist.
- **`TrustRootedResolver`** (S3-T3 / H-7) — refuses any resolved endpoint without an allowlisted,
  env-matching, allowlisted-trust-root signed declaration. Wraps any resolver.

Apply the registry + grant changes above (operator), then point the orchestrator's resolver at
`new TrustRootedResolver(new LoaWhereCapabilityResolver(map, makeLoaWhereInvoker()), policy)` to close
B-1/B-2/H-7 for real.

# ADR-008: Freeside as a Factory — Buildings, Products, and the Marketplace

**Status**: Proposed (intent-bearing; building extractions + repo consolidation deferred to a future operator-clarity session)
**Date**: 2026-05-19 (third framing iteration — see Framing History below)
**Context**: Post-ADR-007 identity refresh · operator-derived "building/factory" model 2026-05-19 PM · adopts `freeside-as-layered-station` + `freeside-as-subway` vault doctrines as upstream context

## Framing History (honesty note)

This ADR's framing iterated three times in ~24h as the operator's mental model sharpened. Recording the path so future readers understand why the model looks the way it does:

1. **"Dual-concern"** (early 2026-05-19) — platform + network. Too flat; didn't name the relationship.
2. **"Vercel analogy / primitive vs product"** (mid 2026-05-19) — added the modules layer, but split each capability into a *primitive* repo (schemas) + a *product* repo (runtime). Operator flagged: this doubles the repo count, and "the Score API is starting to become the product" — schema and runtime want to live together.
3. **"Building / Factory"** (this version, 2026-05-19 PM) — each capability is ONE building = ONE repo containing schema + runtime + docs. Buildings compose via what they produce/consume. Products are buildings (or building-groups) presented for sale. This is where the model stabilized.

The naturalistic metaphors tried along the way (coral reef, cellular biology, compiler stack, musical layering) did not land for the operator. **Factory-game terminology did.** This ADR uses it as canonical because a model you can hold in your head beats a model that's theoretically elegant.

## Context

[ADR-007](007-loa-freeside-absorption.md) ratified the dual-concern absorption. ADR-008 (this doc) names **how the pieces relate** — and the operator's working concern that drove iteration 3 was concrete:

> "The biggest difficulty is, from the repo sense, that we're creating so many repos, and we want to reduce the number of repos. The Score API itself is starting to become the product. Any of the APIs ends up becoming a potential product … this is developer tooling / agent tooling which serves MCPs and other agent tools for builders." — operator, 2026-05-19 PM

And the model the operator landed on:

> "They are buildings that have capabilities and responsibilities, and composability is based off their responsibilities and what they produce and consume … composing the APIs and the entire essence into a single building per capability. Then the capabilities can be composed together into products." — operator, 2026-05-19 PM

### Doctrine Activation Receipts (per Operator OS v3.1)

```
Activated doctrine: ~/vault/wiki/concepts/freeside-as-layered-station.md
Use: usable (3-plane cognitive diagnostic adopted as repo-canonical — see D-1)
Boundaries: cannot override Loa workflow gates; applies to loa-freeside identity model only
Expiry: until superseded by future ADR

Activated doctrine: ~/vault/wiki/concepts/freeside-as-subway.md
Use: usable (composable-menu / marketplace model adopted — see D-6)
Boundaries: cannot bind module pricing or commercial decisions
Expiry: until superseded

Activated doctrine: ~/vault/wiki/concepts/loa-org-naming-conventions.md
Use: usable (prefix-as-type-signature canon — see D-7)
Boundaries: descriptive of existing canon; introduces no new prefixes
Expiry: stable canon
```

The "building / factory" terminology is **operator-derived in-session**, not vault doctrine. It is repo-local doctrine ratified by this ADR. The vault pages above are its upstream context, not its source.

## Decision

`loa-freeside` is a **factory**. Each capability is a **building**. Buildings compose into **products**. Customers order from a **marketplace**. The factory runs on the **platform substrate**.

### D-1. Three orthogonal planes (the cognitive diagnostic — unchanged, adopted from vault §2)

Independent of the factory model, every change is *also* classified by which plane it touches. This is the daily debugging diagnostic:

| Plane | What it holds | How to think when in it |
|-------|---------------|--------------------------|
| **Contract** | Sealed schemas, BeaconV3, NATS protocols, port interfaces | The only plane where the system touches itself. A building talks to a schema, never to another building directly. |
| **Construct** | Pure logic, state machines, intent generators | Brains in vats. No I/O. Given State A + Context B → does it deterministically compute State C? |
| **Execution** | Runtime, side-effects, RPC, gateways, AWS ECS | The cyberdeck. Catches Intents, fires real-world calls. |

Plane is orthogonal to the factory model — see D-8.

### D-2. The building model — one building per capability, one repo per building

A **building** is a capability with a defined responsibility — a thing that produces certain outputs and consumes certain inputs. Examples: `freeside-sonar` (produces chain events), `freeside-storage` (produces asset metadata), `freeside-score` (produces rankings), `freeside-inventory` (produces holder inventory).

**Each building is exactly ONE repository.** That repository contains everything the capability is:

```
   freeside-<capability>/
   ├── README.md                  ← the building's "wiki page"
   ├── package.json               ← exports @freeside/<capability> (the schema package)
   ├── packages/schema/           ← Contract plane: sealed schemas + state machines
   │                                 (builders import THIS to consume the capability)
   ├── src/
   │   ├── api/                   ← Execution plane: REST + MCP endpoints (the runtime)
   │   ├── consumers/             ← what this building subscribes to (its inputs)
   │   └── publishers/            ← what this building emits (its outputs)
   ├── .well-known/beacon.json    ← the building's broadcast (what it is / consumes / produces)
   └── tests/
```

This **collapses the primitive/product split at the repo level** (the iteration-2 mistake). There is no separate "schema repo" and "runtime repo." The schema is an exported sub-package of the building. The building IS the capability IS — when customer-facing — the product.

**Repo-count consequence**: 9 capabilities = 9 repos, not 18. The operator's stated concern ("we're creating so many repos") is resolved by *not* doubling. Each building holds its whole self.

### D-3. Composition direction follows data semantic depth (the DAG)

The operator's hardest mental-model strain was "composability in any direction." Resolution: **composition has natural direction because data has semantic depth.**

```
   RAW              →    DERIVED          →    INTEGRATED        →    PRESENTED
   (events)              (state)               (meaning)              (UX)
   ──────────            ──────────            ──────────             ─────────
   freeside-sonar        freeside-inventory    freeside-score-mibera  discord embeds
   freeside-storage      (holdings from        (uses inventory +      score-mibera UI
   (chain events,         sonar + storage)      score → "tier 3")
    metadata blobs)
```

A building consumes only buildings **upstream** of it (closer to raw). `freeside-inventory` consumes `freeside-sonar` + `freeside-storage`; the reverse is structurally impossible because raw events have no concept of "current holdings." **When you can't decide which way an arrow points, the answer is: the building closer to raw publishes; the building closer to meaning consumes.** The factory belts only run one way.

This is also the **bottleneck diagnostic**: when something is slow or wrong, walk upstream on the belts. The DAG is the dependency chain.

Buildings communicate via **belts** — event streams (NATS topics) for async, API contracts (REST/MCP) for sync. A building declares its belts in its `beacon.json`: `consumes` (input belts) + `publishes` (output belts).

### D-4. Buildings scale independently; failures isolate

Because each building is its own deploy unit:

- **Scale**: add instances of the bottleneck building without touching others
- **Failure isolation**: `freeside-inventory` degrading does not take down `freeside-sonar`; `inventory` should fail-soft when an upstream belt stalls (serve stale, surface a degraded flag)
- **Debug**: bottleneck identification = "which belt is backing up" = the upstream building is the source

This is the operator's stated reason for the building split: *"we'll need to scale each of these individually, and then maybe there will be points where we're certain that there are bottlenecks in individual APIs, and then that will make it pretty easy for us to actually debug and find the actual source."*

### D-5. Factory view vs Marketplace view (products)

The same factory has **two views**:

```
   FACTORY VIEW                          MARKETPLACE VIEW
   (what's deployed — buildings)         (what's sold — products)
   ─────────────────────────────        ──────────────────────────────
   freeside-sonar       (building)       "sonar API"     — product (single building,
   freeside-storage     (building)                          sold rarely solo)
   freeside-score       (building)       "score API"     — product (single building)
   freeside-mediums     (building)       "mediums API"   — product (single building)
   freeside-inventory   (building)  ───→ "inventory API" — product (single building)
   freeside-mint        (building)       "community-mgmt"— product (COMPOUND:
   freeside-activities  (building)                          mediums + score + inventory)
   …                                     "world hosting" — product (COMPOUND:
                                                             storage + worlds + observ.)
```

A **product** is a building (or set of buildings) **presented for sale**. Three shapes:

- **Single-building product** — one building is useful as-is (`inventory API`, `score API`)
- **Compound product** — an experience that needs several buildings to feel complete (`community-management` = mediums + score + inventory)
- **Infrastructure building** — rarely sold solo; consumed implicitly when a customer buys a downstream product (`sonar` — most customers get it because they bought `inventory`, which needs it)

The customer picks from the marketplace. They do **not** need to know whether they bought one building or five. The platform resolves the building dependency DAG and deploys the subtree. This is the Steam Workshop pattern: a player installs a "modpack" (compound product) or a single "mod" (single-building product) from one marketplace, never needing to know which.

Per the `freeside-as-subway` vault doctrine: the marketplace IS the Subway menu. The factory IS the kitchen. Customers order menu items; the kitchen stocks ingredients (buildings) shared across orders.

### D-6. Bundles + shared buildings (the Workspace layer)

When a customer (a **Workspace**, per vault `workspace-project-model`) orders multiple products, the products **share building instances**:

- Customer A orders `score API` → platform provisions a `freeside-sonar` tenant (sonar is multi-tenant)
- Customer A then adds `inventory API` → near-zero added infra: sonar is already running for them; inventory just tenants onto the same sonar instance
- Data coherence is free: score and inventory read the SAME sonar belt — no double-indexing, no drift

This is **AWS-shaped, not Vercel-shaped**: shared multi-tenant building instances within a customer account, not per-app dedicated deploys. The Vercel analogy holds only for "how one building deploys" (push code, platform handles infra); the multi-tenant sharing within a bundle is the AWS pattern.

Default: shared multi-tenant buildings (low friction, low cost, fast checkout — tenant provisioning is milliseconds). Opt-in: **sovereignty mode** — a customer can request dedicated single-tenant building instances on their own infrastructure, trading the bundle-synergy savings for ownership. Pricing tier above default.

### D-7. The B2B2C fit (the Oregon strategy)

```
   B2B (enterprise customers)    →  Building designers / factory builders.
                                    "My community needs inventory + score +
                                     mediums buildings." Picks from the catalog.
                                     This is the developer / agent tooling layer —
                                     buildings serve MCPs + agent tools for builders.

   FREESIDE PLATFORM             →  The game engine (Roblox Studio / Steam / the
                                    Factorio engine). Hosts buildings multi-tenant.
                                    Ships the building catalog. Serves both audiences.

   B2C (community members)       →  Players in the world. Never see buildings.
                                    Experience the OUTPUTS (Discord roles, scores,
                                    inventory UIs). Consumer products are the visible
                                    UX; white-glove enterprise builds the factory
                                    that powers them.
```

The enterprise products **produce** the consumer products — Freeside builds for communities, so enterprise tooling (buildings) is what consumer community experiences run on. This is the Roblox model exactly: developers build experiences (B2B) using engine primitives; players consume experiences (B2C); the platform serves both.

### D-8. Prefix-as-type-signature + plane orthogonality

| Prefix | Means |
|--------|-------|
| `loa-X` | A member of the Loa stack itself (`loa-freeside` IS the L4 platform) |
| `freeside-X` | A **building** — a capability that deploys onto the freeside platform |
| `construct-X` | An agent-expertise pack about X (Plane 2 by convention) |
| `world-X` | A community-specific deployed factory (a Workspace's building set) |

`freeside-X` = building. No new prefixes. Products do not get their own prefix — a product is a *marketplace presentation* of one or more `freeside-X` buildings, named by what it offers (`inventory API`, `community-management`), not by a repo prefix.

**Plane ≠ factory-role (orthogonal).** The platform/network domain split (ADR-007 §D-3, CI-enforced) and the Contract/Construct/Execution planes (D-1, operator-applied diagnostic) are orthogonal axes. A building spans all three planes inside its single repo (schema = Contract, state machines = Construct, runtime = Execution). Do not try to map plane → domain or plane → building; you will get stuck. Classify along each axis independently.

### D-9. The unified `freeside-cli` (gaib merges in)

Per the operator's framing, `@freeside/cli` (gaib IaC) and `@freeside/freeside-cli` (ecosystem CLI) **merge into one CLI** whose job is *"deploy what people want onto the platform, just like Vercel."* The unified CLI: lists the marketplace, resolves a product's building DAG, deploys the buildings, tenants the customer onto shared instances. **Not done in this ADR** — captured as intent; the merge has coordination cost (Jani co-owns gaib; PR #178 stakes the namespace).

> **Tracking**: this is a cross-owner coordination item with no owner until the operator-clarity session assigns one. A GitHub issue or beads task MUST be opened for the gaib/freeside-cli merge before that session closes — an untracked open item with explicit cross-owner dependency does not survive between sessions. Until then, this D-9 paragraph + the Pending Follow-up entry are the only record.

### D-10. Tenancy + trust boundaries (still open — addresses flatline SKP-004)

The "platform hosts buildings multi-tenant" framing implies a trust model not yet specified. Explicitly named as **open**, to be resolved by future ADRs:

| Boundary | Status |
|----------|--------|
| First-party vs third-party building trust | First-party only today. Third-party building trust model **undefined** — future ADR required before non-first-party buildings deploy. |
| Per-building tenancy isolation | Postgres RLS + per-tenant credentials adequate for first-party; third-party needs additional sandboxing. |
| Per-building / per-product billing | Tied to global billing today; per-product pricing intended, not implemented. |
| Building deployment authorization | gaib requires authenticated THJ-AWS session. Third-party operator deploying onto the shared platform is **out of scope** until a future ADR defines the path. |

## Current State vs Intended State

**The hard truth**: today, `loa-freeside` is a thick monolith. Many buildings are NOT yet their own repos — their code lives inside platform paths. The building model is the **direction**.

| Capability | Today | Intended |
|-----------|-------|----------|
| `freeside-sonar` | external repo (exists) | building repo ✓ |
| `freeside-storage` | external repo (exists) | building repo ✓ |
| `freeside-score` | **external repo exists** (`0xHoneyJar/freeside-score`) | building repo ✓ — extract any score logic still in this monolith into it |
| `freeside-mediums` | **external repo exists** (`0xHoneyJar/freeside-mediums`) | building repo ✓ — extract Discord/Telegram/conviction-edge logic into it |
| `freeside-mint` | external repo (exists) | building repo ✓ |
| `freeside-activities` | external repo (exists) | building repo ✓ |
| `freeside-inventory` | external repo (exists) | building repo ✓ — consumes sonar + storage |
| `freeside-billing` | inside `themes/sietch/` + `packages/adapters/` | extract to building repo (future) |
| `freeside-ledger` | inside `packages/services/` | extract to building repo (future) |
| gaib IaC CLI | `packages/cli/` (`@freeside/cli`) | merge into unified `freeside-cli` (D-9) |
| Platform substrate | mixed with everything above | thin: `apps/{gateway,worker,ingestor,mcp-gateway}/`, `infrastructure/terraform/`, `packages/{core,adapters,sandbox}/` |

The follow-up operator-clarity session sequences the extractions. **No code moves in this ADR.**

## Rationale

### Why "one building = one repo" (the iteration-3 correction)

Iteration 2 split each capability into a primitive repo + a product repo — doubling repo count. The operator flagged this directly. A building holding schema + runtime + docs together: (a) halves the repo count, (b) lets schema and runtime evolve atomically (a schema change and its runtime adoption land in one PR), (c) matches reality — "the Score API is becoming the product." A Factorio mod ships one package, not "fire-recipe.txt" separate from "fire-machine.dll." Capabilities should too.

### Why factory terminology (not the naturalistic metaphors)

The operator explicitly rejected coral-reef / cellular-biology / compiler / musical framings: *"none of the actual framings make any sense to me. Maybe we need to use game terminology."* Factory-game terminology (Factorio buildings + belts, Roblox engine/experiences/players, Steam mods/modpacks) landed because it is **active and builder-coded** — it matches the operator's actual working world. A model held in the head beats a model that is elegant on paper.

### Why composition direction is not a free choice

The operator's "compose in any direction" anxiety dissolves once composition direction is recognized as a *consequence* of data semantics, not a *decision*. Raw → derived → integrated → presented is a total order on data depth. The DAG falls out of it. This is not a constraint the architecture imposes; it is a property the data already has.

## Consequences

### Positive

- Repo count does not double (operator's stated concern resolved)
- Schema + runtime evolve atomically within a building
- Composition direction is unambiguous (data depth → DAG)
- Buildings scale + fail-isolate independently; bottleneck debugging is "walk upstream"
- Marketplace/factory dual-view lets customers order without understanding internals
- B2B2C strategy has a clean architectural home

### Negative

- "Status: Proposed" — the model is load-bearing doc not yet ratified by the operator-clarity session
- Third framing iteration in 24h — readers must accept the model stabilized at iteration 3, not earlier
- Current/intended-state gap is wide (the monolith is real); contributors may misread intent as present

### Migration risks

None directly. Risks attach to the follow-up extraction PRs, which is correct — this ADR is framing, not migration.

## Alternatives Considered

### A1. Keep the primitive/product repo split (iteration-2 model)

Rejected. Doubles repo count; the operator flagged this as the central pain. Schema and runtime want to co-evolve.

### A2. One monorepo for all buildings

Rejected. Buildings must scale + deploy + version independently (D-4). A monorepo couples their release cycles.

### A3. Naturalistic metaphor (coral reef / cellular / compiler / musical)

Rejected. Operator explicitly said these did not land. The metaphor is a thinking tool; a tool the operator can't hold is not a tool.

### A4. Codify specific building extractions in this ADR

Rejected. Operator said *"we should definitely have a session where we're getting clarity on that."* This ADR captures the model; the extraction sequence is the follow-up session's job.

### A5. Drop the Vercel analogy entirely

Partially adopted. Vercel is retained only for "how one building deploys" (push code, platform handles infra). The composition + multi-tenant-sharing model is AWS-shaped (D-6). Using Vercel for everything would mislead — Vercel does not share infrastructure across deployments; the factory does.

## References

### Adopted vault doctrine (activation receipts above)

- `~/vault/wiki/concepts/freeside-as-layered-station.md` — 3-plane diagnostic (D-1)
- `~/vault/wiki/concepts/freeside-as-subway.md` — composable-menu / marketplace model (D-5)
- `~/vault/wiki/concepts/loa-org-naming-conventions.md` — prefix canon (D-8)
- `~/vault/wiki/concepts/workspace-project-model.md` — Workspace-scoped ordering (D-6)

### Repo-local references

- [ADR-007](007-loa-freeside-absorption.md) — the absorption that created the dual-concern (precondition)
- [ADR-007 Appendix A](007-loa-freeside-absorption.md) — BeaconV3 schema (a building's `beacon.json` declares its belts)
- [RFC #207](https://github.com/0xHoneyJar/loa-freeside/issues/207) — the original absorption proposal
- PR #214 BB + flatline review — this ADR addresses BB REFRAME (D-8 orthogonality) + flatline SKP-001 (activation receipts) + SKP-004 (D-10 tenancy)

### Existing building repos (confirmed 2026-05-19)

- `0xHoneyJar/freeside-score` — "Scoring substrate for freeside worlds"
- `0xHoneyJar/freeside-mediums` — "Medium capability registry — Discord, Telegram, CLI"
- `0xHoneyJar/freeside-sonar`, `freeside-storage`, `freeside-mint`, `freeside-activities`, `freeside-inventory`

### Pending follow-up

- **Operator-clarity session** — sequences building extractions (`freeside-billing`, `freeside-ledger`) + repo consolidation + the gaib/freeside-cli merge (D-9)
- **freeside-inventory build** — first consumer is `mibera-honeyroad`; inventory building consumes `freeside-sonar` + `freeside-storage` belts; schema evolves through mibera's production usage

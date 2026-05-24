# Building in Freeside — the mental models

> The durable models to hold when working in the freeside building zone. Distilled from the `*-api` cycle (2026-05-23) + the agent-consumption frontier dig. **Companion to `FREESIDE.md`** (which is *what exists*); this is *how to think*. When a model here and the code disagree, the code wins — update this.

---

## 1 · Three naming layers — never conflate them

| Layer | Convention | Example |
|---|---|---|
| **Repo / product** | `*-api` | `inventory-api` |
| **npm publish scope** | **`@0xhoneyjar`** (the org's npm org — *not* `@freeside`) | `@0xhoneyjar/inventory` |
| **Building identity** | beacon `slug` (= repo name) | `slug: "inventory-api"` |

`@freeside` is a sub-brand, not a publishable npm org. Anything that ships to npm — every typed substrate SDK a consumer imports — is `@0xhoneyjar/*`. (ADR-007's `@arrakis → @freeside` rename diverged from this; see the scope-migration task.)

## 2 · One building = one repo

Substrate (sealed schema/contract) **+** runtime (API · MCP · CLI) **+** docs, together — with an honored substrate↔runtime seam *inside* the repo. No separate schema-repo / runtime-repo split. (ADR-008 §D-2, §D-11.)

## 3 · Two organs — discovery ≠ consumption (the load-bearing model)

| | **Discovery** | **Consumption** |
|---|---|---|
| Question | "what exists / how do I reach it?" | "do the thing" |
| Wants | dynamic · lazy · federated · loosely-coupled | typed · deterministic · verifiable · low-hop |
| Pattern | hypermedia affordances | code-mode against a typed SDK |
| In freeside | beacon + registry + `FREESIDE.md` + `loa freeside catalog` | `import { getProfilePicture } from '@0xhoneyjar/inventory'` |

They want **opposite** properties. Don't build consumption as per-verb tool-calls; don't hardcode discovery as a static import.

## 4 · "Verb-first feels flaky" → it's *LLM-as-orchestrator*, not determinism

The fragility is making the model step through verbs across many probabilistic hops (one hallucination derails the chain). The fix **keeps** determinism: a **typed SDK + the agent writes one script against it** (code-mode), not N JSON tool-calls. **Typed SDKs are the consume hot-path.** MCP / the gateway = discovery + federation, *not* the hot-path. (Your instinct was a true compass — it pointed at the orchestration model.)

## 5 · Trust lives in the substrate (this is ACVP)

Agents reason; the **substrate verifies** — types, schema-validation, content hashes, capability objects, beacon affordances. Design so errors are caught by the *type-checker / schema / sandbox*, not the prompt. The building is the source of truth; the LLM is a text-to-AST generator. The 2026 frontier (Cloudflare Code-Mode, Agoric object-capabilities, St. Gallen hypermedia) is independently reinventing what Loa already calls **ACVP**.

## 6 · Belts run one way; fail soft

Composition direction = data semantic depth: **raw → derived → integrated → presented**. Consume only *upstream*. When an upstream stalls, **degrade — never break the consumer** (pfp → DB → handle; never "an anonymous mibera" from a building stall). Bottleneck debugging = walk upstream on the belts. (ADR-008 §D-3, §D-4.)

## 7 · Two orthogonal axes for every change

- **Domain** (firewall-enforced, CI-blocked if mixed): `platform` · `network`. A PR must not modify both.
- **Plane** (cognitive diagnostic): `Contract` (schema/beacon) · `Construct` (pure logic) · `Execution` (runtime/IO).

Classify on *both*; don't map one to the other. (ADR-008 §D-1, §D-8.)

## 8 · Beacons: discipline first, affordance next

`is_not` (≥2 entries) is the discipline-forcing field — what the building **refuses**. **Ground every claim** — no fabricated tags/hashes; omit `composes_with` until port schemas are sealed rather than invent them. The V4 arc adds `prompt_hint` affordances (HATEOAS-for-agents): the building tells the agent *how to use it*, statefully (a "hallucination firewall" — gate by L4 graduated-trust).

## 9 · Ground before you generate

Read the canonical source before asserting a path / name / contract. (The `@freeside`-vs-`@0xhoneyjar` catch *is* this lesson: a scope asserted from plausibility, corrected only by checking what the org actually publishes.)

---

**Pointers:** `FREESIDE.md` (what exists) · `decisions/008` §D-11 (`*-api`) · `grimoires/loa/context/consume-pattern-two-organ.md` (the dig brief → ADR candidate) · the ACVP doctrine (`loa-as-acvp-infrastructure`).

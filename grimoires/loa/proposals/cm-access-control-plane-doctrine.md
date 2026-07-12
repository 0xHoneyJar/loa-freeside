# The CM / Access Control-Plane Doctrine — and how it PROPAGATES

> Kickoff 2026-06-29 (operator AFK build). Grounds in: Eileen's daily deep-research (Freeside = CM + agent-economy;
> the agentic-commerce / x402 / persistent-agent market shift), the WHO×WHAT ladder (vault `freeside-two-axis-model`),
> the event-driven worldline (the NATS keystone), the AccessDecisionRecord work, ACVP, and the shadow-mode wedge.
> Status: **candidate doctrine** — promote to vault + `/recall` estate on operator sign.

---

## TL;DR — the process question, answered

You asked: *"plan-and-analyze flow or jack-in flow — which process to propagate this?"* **Neither. That's a level
mismatch.** Both flows operate at the BUILDING level (generate/forge a tree for one building or region); a *model*
propagates at the ECOSYSTEM level. Neither flow propagates a model — **they CONSUME one.**

The propagation primitive is a **DOCTRINE** that both flows GROUND in:

```
                       ┌───────────────────────────────────────────────────┐
   THE DOCTRINE  ─────► │  encoded in CONTRACTS (event schemas · ports ·    │ ──► every BUILDING inherits it
   (this frame)         │  WHO×WHAT layering · BeaconV3 manifest)           │
        │               └───────────────────────────────────────────────────┘
        │ grounded-in (the GROUND step)
        ├────────────► jack-in        → forges a tree in an EXISTING region (the buildings, shadow-audit)
        └────────────► plan-and-analyze → generates a PRD for a NEW building
```

So: **build the doctrine once; encode it in the shared contracts; have both flows read it in their GROUND step.**
The doctrine IS the propagation. Then per task: **jack-in** for existing regions, **plan-and-analyze** for a new
building — both grounded in the same frame. (And the doctrine only propagates if it's CONSUMED — an ungrounded
doctrine is deployed-but-unconsumed, the cluster's signature failure. The GROUND step is what consumes it.)

---

## 1. The model — the CM / access control-plane

Freeside is a **community-management control-plane**: it answers *"who is in this community, what do they hold/do,
what access should they have, and is their actual access correct?"* — composably, sovereignly, agent-natively. On
the canonical axes:

- **WHO (identity is a stack):** `PERSON → ACCOUNT (per-world, → ERC-6551 TBA) → INVENTORY (badges/roles/holdings)`.
- **WHAT (the building ladder, raw→composed):** `sonar (L0 on-chain ownership) → score (L1 value) → member-graph
  (L2 the who-has-access SPINE, #316) → access-risk audit (L3 PRODUCT)`; plus `worlds` (role/gate config) +
  `identity` (the WHO substrate) + `mediums` (Discord/Telegram) + `ledger/billing` (the economic sub-belt).
- **The decision:** the **AccessDecisionRecord** — `should-have (qualifies) × has (holds_role) → band (ok/stale/missing)`.
  The policy is pluggable (token-gating, badge/engagement, score) per `AccessDecisionPort`.
- **The truth:** a **signed event worldline** (ACVP — `ownership.changed`, `tier.changed`, `access.recomputed`, …),
  durable in JetStream, projected into account-keyed read-models. Events decouple the buildings; the agent composes
  by ordering events/projections, never by threading the whole synchronous DAG.

This is one coherent thing seen from five angles (WHO, WHAT, decision, truth, composition) — and it's the frame
every building should be placed on.

## 2. The product frontier (Eileen's research + the wedge)

- **The wedge = the access-risk AUDIT** (L3): show a community who holds access they *no longer qualify for* (stale
  access), turnover, whale concentration, and the **migration delta vs an incumbent** (Collab.Land). Run it in
  **shadow mode** (parallel, non-destructive) — the trojan horse for B2B builder-to-builder adoption.
- **Adjacent (the platform):** holder intelligence, wallet CRM, campaign attribution, automated role lifecycle.
- **The shift (Eileen's frontier):** agentic commerce — A2A/MCP, **x402 accountless payments**, persistent community
  agents. Freeside shouldn't only gate *humans*; it should expose access + payment semantics to *agents*. The CM
  control-plane is the substrate that makes that governable + auditable (ACVP).
- **Validate next:** is "access-risk audit" *payable*, by whom, at what price? → the ChatGPT deep-research prompt
  (in your clipboard) + a keeper/POSITION DIG against revealed CM behavior (the Mom test).

## 3. The propagation mechanism — how the model reaches every building

A model propagates through FOUR carriers; the doctrine names all four so none is left to chance:

| Carrier | What propagates | Where it lives |
|---|---|---|
| **Doctrine** | the frame (this doc → vault + `/recall`) | `~/vault` + the memory estate (graduate this) |
| **Contracts** | the encoded model — event schemas (`nft.activity.recorded.v1`, …), `AccessDecisionPort`, the WHO×WHAT layering, BeaconV3 manifest | `@freeside/events`, `packages/protocol/*`, `packages/core/ports` |
| **Grounding** | the GROUND step of both flows reads the doctrine FIRST (the vault-model-first lesson) | `/jack-in` (already), `/plan-and-analyze` (via its codebase-grounding + `/recall`) |
| **Manifest** | a new building DECLARES its place on the ladder + its published/consumed events | BeaconV3 (`packages/beacon-schema`), the registry |

**The propagation test (consumption gradient):** the doctrine propagates iff a NEW building, forged by either flow,
*automatically* (a) declares its WHO×WHAT layer, (b) publishes/consumes the right domain events, (c) implements its
`AccessDecisionPort` policy, and (d) gets audited the same way — *without anyone re-deriving the model.* If a building
can be built that ignores the frame, the doctrine isn't propagating; tighten the contract or the GROUND step.

## 4. The next moves (build order)

1. **Promote this doctrine** to the vault + the `/recall` estate (operator act) — so both flows' GROUND step finds it.
2. **Validate the wedge** — run the deep-research prompt (clipboard) + a keeper/POSITION DIG: is the access-audit
   payable, by whom? (Don't build more until the wedge is validated — the Mom test, not stated preference.)
3. **Finish the event spine** (the keystone, in flight): `sonar → ownership.changed → member-graph → audit reads the
   spine` — grounded against the real `reconstructOwnership` (the open differential test FAGAN flagged). This is the
   reference flow every other building copies.
4. **Encode the manifest contract** — a BeaconV3 field for "WHO×WHAT layer + published/consumed events" so every new
   building inherits the model by declaration (the propagation made structural, not cultural).

## 5. Why this matters (the one line)

The cluster's recurring failure is **deployed-but-unconsumed** — building substrate before a live consumer. A model
is the same: writing a frame nobody grounds in is doctrine-deployed-but-unconsumed. So the doctrine ships WITH its
consumption path (the GROUND step of both flows + the contracts buildings inherit). **The doctrine is the propagation;
the grounding is the proof it propagated.**

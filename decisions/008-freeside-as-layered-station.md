# ADR-008: Freeside as Composable Substrate — Platform / Modules / Network (Vercel Analogy)

**Status**: Proposed (intent-bearing; specific module extractions deferred to a future operator-clarity session)
**Date**: 2026-05-19 (revised mid-session 2026-05-19 PM per operator reframe + Subway doctrine integration)
**Context**: Post-ADR-007 identity refresh · operator-corrected mental model 2026-05-19 PM · adopts both `freeside-as-layered-station` and `freeside-as-subway` vault doctrines into repo-local doctrine

## Context

[ADR-007](007-loa-freeside-absorption.md) ratified the dual-concern absorption: `loa-freeside` became both the vertical platform AND the ecosystem parent for the `freeside-*` module network. It documented WHAT the two concerns are and HOW they're firewalled.

It did not document **how they RELATE** — and crucially, the first draft of this ADR (early 2026-05-19) over-extended the term "platform" to include code paths that are actually module-shaped concerns. The operator corrected this mid-session:

> "What stays as a platform is the ECS, AWS, gateway, worker, and sietch HTTP / DB / queues. Basically, what the freeside-cli will deploy into. We have to think about the freeside-cli just like Vercel.
>
> There's a score module, freeside-score, as well as freeside-mediums, which covers basically the Discord and Telegram surfaces and the conviction scoring. I think the billing and, I believe, ledger as well will be part of the modules side. Honestly, the gaib IaC CLI should merge with the freeside-cli, because it simply should just allow people to deploy what they want onto the platform, just like Vercel. At the backend would be the Terraform AWS, basically how Vercel looks." — operator, 2026-05-19 PM

This is a more disciplined framing than "two concerns share a repo." It names a **Vercel-shaped architecture**: a thin platform substrate + a catalog of installable modules + a deployment CLI that puts modules on the substrate + a discovery/composition layer.

This ADR ratifies that framing by adopting **two** vault doctrines into repo-local doctrine: `freeside-as-layered-station` (the layered identity + 3-plane diagnostic) and `freeside-as-subway` (the composable-menu model). It is **descriptive of intent**, not prescriptive of an immediate refactor — the current codebase still mixes platform substrate with module-shaped concerns. The operator explicitly noted: *"we should definitely have a session where we're getting clarity on that"* — a follow-up cycle will resolve the specific module-extraction sequencing.

### Doctrine Activation Receipts (per Operator OS v3.1 §Doctrine Activation Protocol)

This ADR cites multiple vault doctrines; each gets an explicit activation receipt to satisfy the discipline boundary that vault material is not authority by default. The flatline SKP-001 finding (PR #214 review) flagged that the first draft activated only one doctrine while citing several — this is the correction.

```
Activated doctrine: ~/vault/wiki/concepts/freeside-as-layered-station.md
Operation: ADR-008 (repo-local architectural doctrine)
Use: usable (adopts the 3-plane diagnostic + L1-L5 layer mapping as repo-canonical)
Boundaries: cannot override Loa workflow gates, cannot dictate framework-level changes,
            applies only to loa-freeside's repo-local identity model
Expiry: until superseded by future ADR or until the operator-clarity session amends it

Activated doctrine: ~/vault/wiki/concepts/freeside-as-subway.md
Operation: ADR-008 (repo-local architectural doctrine — module-composition framing)
Use: usable (adopts the composable-menu model + Vercel analogy as repo-canonical)
Boundaries: cannot override actual module extraction sequencing, cannot bind specific
            module-pricing or commercial decisions, applies only to architectural framing
Expiry: until superseded; specific module extractions need their own ADRs

Activated doctrine: ~/vault/wiki/concepts/loa-org-naming-conventions.md
Operation: ADR-008 §D-8 (prefix-as-type-signature)
Use: usable (adopts the loa-X / freeside-X / construct-X / world-X canon)
Boundaries: descriptive of existing naming canon; does not introduce new prefixes
Expiry: stable canon, no expected expiry

Activated doctrine: ~/vault/wiki/concepts/freeside-vision.md
Operation: ADR-008 (background context for L1-L5 stack reference)
Use: background_only (cited for L1-L5 anchoring; does not drive decisions in this ADR)
Boundaries: parent doctrine; this ADR maps to its layers without redefining them
Expiry: stable parent doctrine
```

## Decision

`loa-freeside` adopts the **Vercel-analogy three-part identity**: Platform (substrate) + Modules (deployed-onto) + Network (discovery/composition layer). The repo currently houses **all three** but the long-term direction is extraction of module-shaped concerns into separate `freeside-*` repos.

This ADR locks the **framing**. It does not lock specific extractions; those need a follow-up operator-clarity session per the operator's own note.

### D-1. Three orthogonal planes (the cognitive diagnostic — adopted as-is from vault §2)

| Plane | What it holds | How to think when in it |
|-------|---------------|--------------------------|
| **Contract** | Sealed schemas, BeaconV3, NATS protocols, Zod definitions, integration boundaries | The only plane where the system actually touches itself. A module never talks to the platform directly — it talks to a schema. The platform reads a schema. You steer the whole stack by governing schema evolution. |
| **Construct** | Pure logic, state machines, persona definitions, intent generators | Brains in vats. No concept of Discord, Berachain, AWS, or Bun. Drop all outside-world context. Only concern: given State A + Context B, does the state machine deterministically compute State C? |
| **Execution** | The interpreter, the runtime, side-effects, I/O, blockchain RPC, gateways, AWS ECS, HTTP servers | The cyberdeck. The brute-force engine that catches Intents thrown by Constructs and fires the actual HTTP/RPC/PG calls. |

Daily diagnostic: bug-source classification by plane prevents wasted investigation surface.

### D-2. The three-part identity (platform / modules / network) — the Vercel-shaped architecture

```
   ┌────────────────────────────────────────────────────────────────────┐
   │  MODULES (the catalog — what operators ORDER)                      │
   │                                                                    │
   │  External freeside-* repos (already-extracted):                    │
   │   • freeside-storage  · freeside-mint     · freeside-activities    │
   │   • freeside-sonar    · freeside-inventory                         │
   │                                                                    │
   │  In-repo, intended-for-extraction (current monolithic state):      │
   │   • freeside-score    (currently: packages/services/, themes/      │
   │                        sietch/src/services/)                       │
   │   • freeside-mediums  (Discord + Telegram + conviction;            │
   │                        currently: themes/sietch/src/{discord,      │
   │                        telegram}/ + conviction logic)              │
   │   • freeside-billing  (Paddle + NOWPayments; currently:            │
   │                        themes/sietch/src/api/routes/ +             │
   │                        packages/adapters/)                         │
   │   • freeside-ledger   (currently: packages/services/ledger)        │
   │                                                                    │
   │  Each module: declares BeaconV3 contract · ships its own runtime · │
   │               deploys onto the platform via freeside-cli           │
   └────────────────────────────────┬───────────────────────────────────┘
                                    │ deployed onto / federated through
                                    ▼
   ┌────────────────────────────────────────────────────────────────────┐
   │  NETWORK (the discovery / composition layer)                       │
   │  • packages/beacon-schema/     — module-declaration contract        │
   │  • packages/freeside-registry/ — registry + federation manifest     │
   │  • apps/mcp-gateway/           — MCP federation router              │
   │  • packages/freeside-cli/      — deploy + inspect (Vercel-like)     │
   │                                  (gaib IaC CLI merges in — see D-4) │
   └────────────────────────────────┬───────────────────────────────────┘
                                    │ runs on / hosted by
                                    ▼
   ┌────────────────────────────────────────────────────────────────────┐
   │  PLATFORM (the thin substrate — the "Vercel" layer)                │
   │  • apps/gateway/          — Rust gateway proxy (multi-shard)        │
   │  • apps/worker/           — NATS / RabbitMQ worker                  │
   │  • apps/ingestor/         — event ingestion                         │
   │  • themes/sietch/         — HTTP / API server (substrate only;      │
   │                             route handlers are MODULE-defined)      │
   │  • packages/core/         — port interfaces + domain types          │
   │  • packages/adapters/     — storage/chain/security primitives       │
   │  • packages/sandbox/      — schema provisioning, event routing      │
   │  • infrastructure/terraform/ — AWS ECS + RDS + ElastiCache + ALB    │
   └────────────────────────────────────────────────────────────────────┘
```

**The Vercel analogy made explicit**:

- **Vercel** is the deployment platform · a Next.js app is a module deployed onto Vercel · the Vercel CLI is how you deploy
- **Freeside platform** is ECS + AWS substrate · a `freeside-*` module is what's deployed onto it · `freeside-cli` is how you deploy
- The platform doesn't know what a module *does* — it just hosts the runtime. The network tells operators what modules *exist* and what they *expose*. Modules are responsible for their own logic.

### D-3. Current state vs intended state (the honest split)

**The hard truth**: the current `loa-freeside` codebase is a "thick monolith" — the platform substrate IS comingled with what will be modules. The Subway-style separation is the **direction**, not the present.

| Concern | Current state (what's true today) | Intended state (per operator + Subway doctrine) |
|---------|------------------------------------|--------------------------------------------------|
| Score logic | Lives in `packages/services/` + `themes/sietch/src/services/` | `freeside-score` external repo (per vault §3 mapping) |
| Discord/Telegram + conviction scoring | Lives in `themes/sietch/src/discord/` + `telegram/` + service layer | `freeside-mediums` external repo |
| Billing (Paddle + NOWPayments) | Lives in `themes/sietch/src/api/routes/` + `packages/adapters/` | `freeside-billing` external repo |
| Ledger | Lives in `packages/services/` (per operator: "I believe") | `freeside-ledger` external repo |
| gaib IaC CLI | Lives in `packages/cli/` as `@freeside/cli` | **Merges into `@freeside/freeside-cli`** (D-4) |
| Pure platform substrate | Mixed with everything above in same repo | `apps/{gateway,worker,ingestor}/`, `apps/mcp-gateway/`, `themes/sietch/` (substrate-only after route extraction), `packages/{core,adapters,sandbox}/`, `infrastructure/terraform/` |

**No code moves in this ADR.** Extractions sequence in future cycles. The follow-up operator-clarity session will:

1. Identify what's actually module-shaped vs substrate-shaped per directory
2. Decide extraction order (probably: billing/ledger first since they're shared infrastructure; mediums and score later)
3. Decide whether the existing PR #178 `packages/freeside-cli/` slot becomes the unified CLI (per D-4) or whether gaib stays at `packages/cli/` and adds the deploy verbs

### D-4. The unified `freeside-cli` (gaib + freeside-cli merge intent)

Per the operator's 2026-05-19 framing, `@freeside/cli` (gaib IaC) and `@freeside/freeside-cli` (ecosystem CLI) **should merge into one CLI** whose unified job is *"deploy what people want onto the platform, just like Vercel."*

Today: gaib does IaC orchestration (auth/sandbox/server provisioning). freeside-cli does ecosystem inspection (list/inspect/doctor of registered modules). The Vercel-analogy unification would add a `deploy <module-slug>` verb (or equivalent) that uses gaib's IaC backbone to actually instantiate a module onto the platform.

This merge has its own coordination cost (Jani co-owns gaib; PR #178 stakes the `@freeside/cli` namespace differently). **Not done in this ADR.** Captured as intent so future work can cite the canonical direction.

### D-5. Modules as Subway items (composable-menu doctrine)

Per `freeside-as-subway` vault doctrine — adopted into repo-local doctrine via activation receipt above — `freeside-*` modules are **Components** in an ECS-style architecture:

- An operator deploying a community (a Workspace, in vault `workspace-project-model` terms) **orders** modules from the catalog
- The platform is the **System** that iterates over Workspaces with that Component attached and executes
- The freeside-cli is the **counter** at which operators place orders
- The federation manifest (`/federation.json`) is the **menu** they read

The mental shift: *Freeside is not a feature set. It is a feature catalog.* What loa-freeside ships is the substrate to RUN the catalog, the protocol to DECLARE catalog items, and the CLI to ORDER them. Each catalog item (module) ships its own logic + runtime + pricing in its own repo.

The 21-products SaaS vision (per Subway doctrine §"The 21-products SaaS vision") is downstream of this: each of the 21 envisioned SaaS products is a freeside-* module subscribed-to by operators who want that specific capability.

### D-6. Tenancy + trust + isolation boundaries (addresses flatline SKP-004 from PR #214)

The PR #214 flatline review correctly flagged that the platform-runs-modules framing implies a trust/isolation model that the doctrine doesn't specify. Future ADRs will resolve these boundaries; **this ADR explicitly names them as open**:

| Boundary | Current state | Status |
|----------|---------------|--------|
| **Hosted vs federated** | Modules in this repo are co-deployed via shared platform. External `freeside-*` modules are federated via the MCP gateway. | Mixed — to be clarified by the operator-clarity session |
| **First-party vs third-party trust** | All currently-registered modules (per `packages/freeside-registry/registry.yaml`) are first-party (0xHoneyJar-owned). | Third-party module trust model is **undefined**. Future ADR required before accepting non-first-party modules. |
| **Per-module tenancy** | Per-module isolation handled at the platform substrate level (Postgres RLS, per-tenant credentials in `apps/mcp-gateway/src/tenants.ts`). | Adequate for first-party; third-party would need additional sandboxing model. |
| **Module-level billing** | Tied to the global Freeside billing surface today. | Per-module pricing (Subway doctrine §"Economic framing") is intended; not yet implemented. |
| **Module observability** | Logs go to global CloudWatch; no per-module budgeted observability. | Future ADR needed (per Subway §"Observability" — TBD per ES). |
| **Module deployment authorization** | gaib IaC requires authenticated session against the THJ AWS account. | Third-party operator deploying a third-party module onto the platform is **out of scope until a future ADR** defines the trust path. |

This is a non-goals section in spirit: ADR-008 says "platform RUNS modules" without defining the trust model under which that happens. Sufficient for first-party reasoning today; insufficient for third-party hosting tomorrow.

### D-7. Plane (cognitive diagnostic) and Domain (organizational firewall) are ORTHOGONAL (addresses BB REFRAME from PR #214)

The PR #214 BB review surfaced that contributors may try to map plane→domain and get stuck. They are **orthogonal axes**:

- **Platform/Network/Modules** is the **organizational firewall** — what code touches what. CI-enforced (per ADR-007 §D-3 + .github/workflows/path-domain-check.yml).
- **Contract/Construct/Execution** is the **cognitive diagnostic** — what you're reasoning about. Operator-applied (no CI enforcement).

A single change is classified along **both** axes. Example: extracting the score logic into `freeside-score` is:
- **Domain axis**: starts in PLATFORM (where score lives today), ends in MODULES (where it should live)
- **Plane axis**: spans CONTRACT (BeaconV3 declaration for the new module) + CONSTRUCT (score logic itself) + EXECUTION (how the module gets deployed onto the platform)

The two decompositions don't substitute for each other. Both are required for full classification of a change.

### D-8. Prefix-as-type-signature (adopted from vault canon)

| Prefix | Means | Examples |
|--------|-------|----------|
| `loa-X` | A member of the Loa stack itself; each is a known L1-L5 layer member | `loa-freeside` (L4 platform substrate + module-network host), `loa-constructs` (L1 expertise distribution), `loa-finn` (L3 AI runtime) |
| `freeside-X` | An installable Subway module that deploys onto the freeside platform | `freeside-storage`, `freeside-mint`, `freeside-activities`, `freeside-sonar`, `freeside-inventory`, plus intended-extractions: `freeside-score`, `freeside-mediums`, `freeside-billing`, `freeside-ledger` |
| `construct-X` | An agent-expertise pack about X; Plane 2 (Construct) by convention | `construct-freeside`, `construct-noether`, `construct-protocol` |
| `world-X` | A community-specific deployed module bundle (Workspace-shaped) | `world-mibera`, `world-apdao`, `world-rektdrop`, `world-score-api` |

**The namespace already encodes the layering.** No new prefixes introduced.

## Rationale

### Why adopt the Subway doctrine alongside the layered-station doctrine

The two doctrines are complementary, not redundant:

- **Layered station** (vault page 2026-05-02) names the 3 planes + L1-L5 layers. It's the *steering* tool for individual contributors.
- **Subway** (vault page 2026-04-16, ES's 2026-04-13 framing) names the composable-menu model. It's the *strategic* tool for understanding what Freeside IS at the product layer.

Without Subway: ADR-008 captures the structural identity but misses the *why*. Why does the platform/modules split matter? Because Freeside isn't a feature set — it's a feature catalog. That framing came from ES; it lives in the Subway vault page; it now lives in repo-local doctrine.

### Why "intent-bearing, specific extractions deferred"

The operator explicitly said *"we should definitely have a session where we're getting clarity on that."* That's a clear signal: don't codify extractions in THIS ADR. Capture the **direction** (Vercel-shape, modules-not-features, gaib-merges-into-freeside-cli). Defer the **specifics** (which extraction first, exact dependency chain, refactor strategy) to a future operator-clarity session that produces ADR-009 or successor.

This is the disciplined move: writing down what's clear, marking what's not. The flatline SKP-001 finding on PR #214 reviewed an earlier draft that over-extended into specifics without operator confirmation; this revision pulls back.

### Why mark "Status: Proposed" instead of "Accepted"

Earlier ADRs (001-007) have used Accepted on landing. This ADR is Proposed because it depends on a follow-up operator-clarity session to ratify the specific extraction sequencing. The framing is locked; the timeline is not. Status will move to Accepted when (a) the operator-clarity session produces an updated decision and (b) the first module extraction PR cites this ADR cleanly.

### Why ratify NOW even though extraction work isn't ready

Future contributors otherwise inherit only ADR-007 — which framed loa-freeside as "two concerns shared in a repo" without naming the deeper architectural intent. Without ADR-008, "platform" remains an ambiguous term (does it include themes/sietch's Discord routes? services/score? billing?). The Vercel analogy + Subway doctrine resolve that ambiguity even before extractions happen.

## Consequences

### Positive

- Future contributors have a doctrinal anchor for "is this platform substrate or module logic?"
- The README + CLAUDE.md + BUTTERFREEZONE can teach the Vercel analogy as the canonical mental model
- The 21-products SaaS vision (per Subway doctrine) has a repo-local home it can be cited from
- The gaib + freeside-cli merge intent is captured before either CLI ossifies further
- Plane-vs-domain orthogonality is explicit (closes the BB REFRAME on PR #214)
- Tenancy/trust boundaries are explicitly named as open (closes flatline SKP-004 by not pretending they're solved)

### Negative

- "Status: Proposed" creates load-bearing documentation that isn't yet fully accepted — a contributor citing it might be citing intent that hasn't been ratified by the operator-clarity session
- The current/intended state distinction adds reading friction (contributors may misread intent as current state)
- Multiple vault doctrine activations (per SKP-001 correction) mean this ADR is heavier on receipts than the absorption ADR — readers must accept the activation discipline

### Migration risks

None directly. Risks attach to the follow-up extraction PRs — which is correct: this ADR's job is framing, not migration.

## Alternatives Considered

### A1. Don't adopt the Subway doctrine — keep just the layered station

Rejected. The operator explicitly cited Subway in their 2026-05-19 reframe. Adopting only half the relevant doctrine while citing both would replicate the SKP-001 problem (citing vault sources without proper activation).

### A2. Codify the specific module extractions in this ADR

Rejected. The operator explicitly said *"we should definitely have a session where we're getting clarity on that."* Pre-empting that session would force decisions the operator hasn't made yet.

### A3. Use a different analogy than Vercel

Rejected. The operator named Vercel as the analog. Substituting another (Netlify, Railway, Heroku) would lose the specific shape the operator is signaling: thin substrate + CLI-driven deployment + catalog of installable modules.

### A4. Make this an ADR-007 amendment rather than ADR-008

Rejected. ADR-007 is the absorption-fact decision; ADR-008 is the layered-identity framing. They serve different purposes. Adding an amendment to ADR-007 would blur the line between "what was absorbed" and "how to think about the result."

### A5. Wait for the operator-clarity session before drafting any ADR

Rejected. The framing IS clear enough today (Vercel-shape, Subway catalog, platform/modules/network three-part identity). What's NOT clear is the extraction sequencing. ADR-008 captures the former; the future session resolves the latter.

## References

### Adopted vault doctrine (with activation receipts above)

- `~/vault/wiki/concepts/freeside-as-layered-station.md` — 3-plane diagnostic + L1-L5 layer mapping (operator-authored 2026-05-02, confidence 0.85, load-bearing)
- `~/vault/wiki/concepts/freeside-as-subway.md` — composable-menu model + Vercel analogy (ES's 2026-04-13 framing, vault page 2026-04-16)
- `~/vault/wiki/concepts/loa-org-naming-conventions.md` — prefix-as-type-signature canon (operator-confirmed 2026-04-28)
- `~/vault/wiki/concepts/freeside-vision.md` — L1-L5 stack reference (background)

### Adjacent doctrine (referenced, not adopted)

- `~/vault/wiki/concepts/ecs-architecture-freeside.md` — ECS formalization (Components / Systems / Entities); the Subway menu IS the Component catalog
- `~/vault/wiki/concepts/freeside-modules-as-installables.md` — sealed schemas + typed ports
- `~/vault/wiki/concepts/freeside-as-site-operator.md` — KRANZ runbook discipline
- `~/vault/wiki/concepts/workspace-project-model.md` — Workspace-scoped module ordering (referenced by D-5)
- `~/vault/wiki/concepts/no-handoffs-without-observability.md` — beacon manifests as observable surface

### Repo-local references

- [ADR-007](007-loa-freeside-absorption.md) — the absorption that created the dual-concern (precondition for this ADR)
- [ADR-007 §D-1](007-loa-freeside-absorption.md) — workspace structure this ADR layers an interpretation onto
- [ADR-007 Appendix A](007-loa-freeside-absorption.md) — BeaconV3 schema (lives in Plane 1: Contract)
- [RFC #207](https://github.com/0xHoneyJar/loa-freeside/issues/207) — the original absorption proposal
- PR #214 BB + flatline review findings (this revision addresses BB REFRAME + flatline SKP-001 + SKP-004)

### Pending follow-up

- **Operator-clarity session** (per operator note 2026-05-19) — produces ADR-009 or successor with specific extraction sequencing for `freeside-score`, `freeside-mediums`, `freeside-billing`, `freeside-ledger` + the gaib/freeside-cli merge plan
- PR #178 reconciliation — currently stakes `packages/freeside-cli/` with `@freeside/cli` namespace; needs alignment with the unified-CLI intent (D-4)

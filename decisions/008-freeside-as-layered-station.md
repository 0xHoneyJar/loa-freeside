# ADR-008: Freeside as Layered Station — Platform as Deployment Substrate for the Module Network

**Status**: Proposed
**Date**: 2026-05-19
**Context**: Post-ADR-007 identity refresh · platform-as-substrate framing surfaced during 2026-05-19 docs review · adopts the `freeside-as-layered-station` vault doctrine into repo-local doctrine

## Context

[ADR-007](007-loa-freeside-absorption.md) ratified the dual-concern absorption: `loa-freeside` became both the vertical platform AND the ecosystem parent for the `freeside-*` module network. It documented WHAT the two concerns are and HOW they're firewalled.

It did not document **how the two concerns RELATE**.

The operator's mental model (surfaced 2026-05-19 during docs review):

> "The platform layer contains a lot of what Janny built on the backend in terms of infrastructure, and then there are the other elements that are part of it: the modules that people will be able to deploy onto the platform."

This is a richer framing than "two concerns share a repo." It names a relationship:

- The platform is the **deployment substrate** for the modules
- The modules **run on** the platform's infrastructure
- The network's job is to make the modules **discoverable + composable** at the protocol layer
- The platform's job is to **host the runtimes** that execute the modules

This ADR ratifies that relationship by adopting the `freeside-as-layered-station` doctrine (operator-authored vault page, 2026-05-02, confidence 0.85, load-bearing) into repo-local doctrine.

**Doctrine Activation Receipt** (per Operator OS v3.1 §Doctrine Activation Protocol):

```
Activated doctrine: ~/vault/wiki/concepts/freeside-as-layered-station.md
Operation: ADR-008 (repo-local architectural doctrine)
Use: usable (this ADR adopts the doctrine for repo-canonical reference)
Boundaries: cannot override Loa workflow gates, cannot dictate framework-level changes,
            applies only to loa-freeside's repo-local identity model
Expiry: until superseded by a future ADR or until the dual-concern model evolves
```

## Decision

`loa-freeside` adopts the **3-plane layered station** identity. The repo IS one station with three orthogonal planes; the modules deployed onto it are guests passing through.

### D-1. The three orthogonal planes

| Plane | What it holds | How to think when in it |
|-------|---------------|--------------------------|
| **Contract** | Sealed schemas, BeaconV3, NATS protocols, Zod definitions, integration boundaries | The only plane where the system actually touches itself. A module never talks to the platform directly — it talks to a schema. The platform reads a schema. You steer the whole stack by governing schema evolution. |
| **Construct** | Pure logic, state machines, persona definitions, intent generators (operator-expertise lives here, in `construct-*` packs and module logic) | Brains in vats. No concept of Discord, Berachain, AWS, or Bun. Drop all outside-world context. Only concern: given State A + Context B, does the state machine deterministically compute State C? If yes, the module is complete. |
| **Execution** | The interpreter, the runtime, side-effects, I/O, blockchain RPC, the Discord gateway, the MCP federation gateway, AWS ECS, sietch HTTP server | The cyberdeck. The brute-force engine that catches Intents thrown by Constructs and fires the actual HTTP/RPC/PG calls. Treat constructs as black boxes — only care that the received Intent is mathematically valid. |

At any moment, you're in ONE plane. Switching planes is a deliberate context shift, not an accidental drift. The discipline of naming planes prevents bug-source confusion ("is this a contract mismatch, a construct logic error, or an execution-layer flake?").

### D-2. Where each loa-freeside concern lives

| Concern | Plane(s) | Lives in |
|---------|----------|----------|
| BeaconV3 schema (`@freeside/beacon-schema`) | Contract | `packages/beacon-schema/` |
| Module registry (`@freeside/freeside-registry`) | Contract + Execution | `packages/freeside-registry/` |
| MCP federation gateway (`@freeside/mcp-gateway`) | Execution | `apps/mcp-gateway/` |
| Ecosystem CLI (`@freeside/freeside-cli`) | Execution (operator-facing) | `packages/freeside-cli/` |
| Discord gateway (Rust) | Execution | `apps/gateway/` |
| Worker / ingestor | Execution | `apps/worker/`, `apps/ingestor/` |
| Sietch HTTP server + Discord/Telegram commands | Execution | `themes/sietch/` |
| Agent gateway, budget atomicity, ensemble accounting | Execution + (some) Construct (e.g., pool resolution logic) | `packages/adapters/agent/` |
| Conviction scoring, tier resolution | Construct | `themes/sietch/src/services/`, `packages/core/` |
| Terraform / infrastructure | Execution (the substrate that runs everything) | `infrastructure/terraform/` |
| gaib IaC CLI (`@freeside/cli`) | Execution (operator-facing infrastructure tooling) | `packages/cli/` |

This mapping is descriptive, not prescriptive — it documents where things currently live, so future contributors can ask "which plane does this change belong to?" before opening a PR.

### D-3. Platform vs Network reframed

ADR-007 named the dual-concern split as "platform" and "network." This ADR refines what those terms mean once the layered identity is adopted:

| Term | Means | Examples |
|------|-------|----------|
| **Platform (the substrate)** | The Execution-plane infrastructure that hosts everything: AWS ECS, the gateway services, the HTTP layer, the database, the queues, the IaC, the operator tooling that maintains it (gaib CLI). Hosts BOTH first-party features (Score, ledger, conviction, billing) AND third-party modules (deployed `freeside-*` modules). | `apps/gateway/`, `apps/worker/`, `apps/ingestor/`, `themes/sietch/`, `infrastructure/terraform/`, `packages/cli/` (gaib), `packages/adapters/`, `packages/core/`, `packages/services/` |
| **Network (the module ecosystem)** | The Contract + Construct planes for the `freeside-*` module ecosystem that runs on the platform: the BeaconV3 schema modules use to declare themselves, the registry that aggregates them, the MCP federation gateway that routes between them, the ecosystem CLI operators use to inspect them. | `packages/beacon-schema/`, `packages/freeside-registry/`, `apps/mcp-gateway/`, `packages/freeside-cli/`, `grimoires/freeside-network/` |
| **Modules (the things deployed onto the platform)** | The `freeside-*` repos themselves — `freeside-sonar`, `freeside-storage`, `freeside-mint`, `freeside-activities`, `freeside-inventory`, etc. Each module broadcasts a BeaconV3 declaration, runs on platform infrastructure, and is discoverable via the federation manifest. **Modules live in their own repos — they are not in `loa-freeside`.** | external: `0xHoneyJar/freeside-sonar`, `freeside-storage`, etc. |

**The relationship that ADR-007 didn't name**:

```
   ┌─────────────────────────────────────────────────────────────┐
   │  The MODULES (each in its own freeside-* repo)              │
   │  — freeside-sonar, -storage, -mint, -activities, -inventory  │
   │  — each broadcasts BeaconV3 at /.well-known/beacon.json     │
   └──────────────────────────┬───────────────────────────────────┘
                              │ deployed onto / federated through
                              ▼
   ┌─────────────────────────────────────────────────────────────┐
   │  The NETWORK (loa-freeside's ecosystem-parent surface)      │
   │  — beacon-schema validates module declarations              │
   │  — freeside-registry aggregates them                        │
   │  — mcp-gateway routes between them                          │
   │  — freeside-cli inspects + audits them                      │
   └──────────────────────────┬───────────────────────────────────┘
                              │ runs on / hosted by
                              ▼
   ┌─────────────────────────────────────────────────────────────┐
   │  The PLATFORM (loa-freeside's vertical substrate)           │
   │  — AWS ECS, gateway, worker, ingestor, HTTP, DB, queues    │
   │  — Discord/Telegram surfaces, conviction scoring, billing   │
   │  — Terraform, gaib IaC CLI                                  │
   └─────────────────────────────────────────────────────────────┘
```

### D-4. Prefix-as-type-signature (adopted)

Per the vault doctrine `loa-org-naming-conventions` (operator-confirmed 2026-04-28, canon), the repo prefix encodes the layer membership:

| Prefix | Means | Examples |
|--------|-------|----------|
| `loa-X` | A member of the Loa stack itself; each is a known L1-L5 layer member | `loa-freeside` (L4 platform), `loa-constructs` (L1 expertise distribution), `loa` (the framework) |
| `freeside-X` | An installable module that deploys onto the freeside platform | `freeside-sonar`, `freeside-storage`, `freeside-mint`, `freeside-activities`, `freeside-inventory` |
| `construct-X` | An agent-expertise pack about X; Plane 2 (Construct) by convention | `construct-freeside`, `construct-noether`, `construct-protocol` |
| `world-X` | A world-substrate deployment (a specific community's deployed module bundle) | `world-mibera`, `world-apdao`, `world-rektdrop`, `world-score-api` |

This ADR adopts the prefix-as-type-signature discipline for cross-repo reasoning. **No new prefixes are introduced** — the namespace already encodes the layering correctly.

## Rationale

### Why ratify this NOW (not earlier, not later)

ADR-007 was the absorption-as-fact decision. It documented the structure but stayed silent on the WHY of the structure. Without an explicit layered identity, future contributors will see two concerns sharing a repo without understanding the relationship — and may accidentally collapse them under feature pressure.

The operator surfaced the platform-as-substrate framing during the 2026-05-19 docs review. Ratifying it now (a) captures the framing while the context is fresh, (b) gives the README a doctrinal anchor to cite, and (c) makes the framing available to future ADRs that need to reason about layered concerns.

### Why adopt the vault doctrine vs re-deriving it

`freeside-as-layered-station` is a load-bearing operator-authored vault page (2026-05-02, confidence 0.85, `decay_class: doctrine`). Re-deriving the framing in this ADR would be wasteful and risk subtle divergence. Adopting it via explicit activation receipt is the disciplined move — the vault page is the source-of-truth at the operator level; this ADR is the repo-canonical reference for the repo's contributors.

### Why three planes, not just two layers

A two-layer "platform + network" model captures organizational separation but not cognitive separation. Three orthogonal planes (Contract / Construct / Execution) name **what you're thinking about** at any moment. Bug source classification by plane is the operator's daily diagnostic discipline — adopting it here unlocks that diagnostic for the whole team.

### Why this is descriptive, not prescriptive

This ADR documents where things currently live. It does not propose moving anything. The structural moves were ADR-007's job (the workspace dirs, the absorption, the firewall). ADR-008 is the lens through which to read what's there — adopting it has zero implementation cost beyond updating the README + CLAUDE.md + BUTTERFREEZONE to teach the lens.

## Consequences

### Positive

- Future contributors have a doctrinal anchor for "which plane does this change belong to?"
- The README can teach the dual-concern + layered model in a single section
- Cross-repo agent reasoning (per ADR-007 §D-5) is grounded in the same lens
- ADRs going forward can cite "Plane 1 contract change" or "Plane 3 execution flake" as classified categories
- The vault doctrine becomes repo-canonical, available to non-operator contributors without requiring vault access

### Negative

- One more doctrine page contributors must internalize (mitigated by README teaching it inline)
- Risk of doctrine creep — future ADRs might cite this one prematurely. Mitigation: ADR-008 is descriptive lens, not prescriptive structure; cite it for understanding, not for forcing decisions

### Migration risks

None. This ADR has zero implementation cost. The only downstream change is the README + CLAUDE.md + BUTTERFREEZONE refresh that lands in the same PR.

## Alternatives Considered

### A1. Don't ratify the layered identity — let it stay vault-only

Rejected. The framing IS load-bearing for how contributors should reason about loa-freeside post-absorption. Keeping it vault-only forces every new contributor to either re-derive it or stay confused. The ADR cost is one document; the value is a shared mental model.

### A2. Just add the framing to the README (no ADR)

Rejected. README content is descriptive prose. ADRs are the canonical place for architectural framing — they persist across README rewrites, they're citable, they appear in `decisions/` where contributors look for "why is it this way." Putting the layered identity only in README leaves it homeless if README is restructured.

### A3. Two-layer model only (platform + network), skip the 3-plane refinement

Rejected. Two layers capture organizational separation. Three planes capture cognitive separation — they give contributors a daily-usable diagnostic for classifying changes. The marginal cost of the 3-plane addition is small; the diagnostic value is real.

### A4. Adopt a different layered model (e.g., L1-L5 Loa stack directly)

Rejected. The L1-L5 Loa stack is correct at altitude but heavy at daily-steering scale. The 3-plane model is the operator's daily-steering view per the vault page. Adopting L1-L5 would be more "complete" but less actionable; the 3-plane model is what contributors will actually use.

## References

### Adopted vault doctrine

- `~/vault/wiki/concepts/freeside-as-layered-station.md` — primary source (operator-authored, 2026-05-02)
- `~/vault/wiki/concepts/freeside-vision.md` — L1-L5 stack at altitude (parent)
- `~/vault/wiki/concepts/loa-org-naming-conventions.md` — prefix-as-type-signature canon
- `~/vault/wiki/concepts/freeside-modules-as-installables.md` — sealed schemas + typed ports

### Repo-local references

- [ADR-007](007-loa-freeside-absorption.md) — the absorption that created the dual-concern (precondition for this ADR)
- `decisions/007-loa-freeside-absorption.md` §D-1 — workspace structure this ADR layers an interpretation onto
- `decisions/007-loa-freeside-absorption.md` Appendix A — BeaconV3 schema (lives in Plane 1: Contract)
- [RFC #207](https://github.com/0xHoneyJar/loa-freeside/issues/207) — the original absorption proposal

### Adjacent doctrine (not adopted, referenced for context)

- `~/vault/wiki/concepts/freeside-as-subway.md` — horizontal modular menu (composes with this page's vertical architecture)
- `~/vault/wiki/concepts/agentic-cryptographically-verifiable-protocol.md` — ACVP doctrine (BeaconV3's `acvp_invariants` lives here)
- `~/vault/wiki/concepts/no-handoffs-without-observability.md` — beacon manifests as observable surface for cross-repo handoffs

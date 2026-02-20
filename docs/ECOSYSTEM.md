# The Loa Ecosystem

[![Version](https://img.shields.io/badge/version-6.0.0-blue.svg)](../CHANGELOG.md)

The Loa protocol is a 5-layer stack for building and operating AI agent economies on-chain. Each layer has a dedicated repository with clear interface contracts. Protocol schemas flow upward: lower layers define contracts, upper layers consume them.

<!-- cite: loa-freeside:packages/shared/nats-schemas/ -->

## The Stack

```
Layer 5  Products     loa-dixie       dNFT Oracle — first product customer
           │
Layer 4  Platform     loa-freeside    API, Discord/TG, token-gating, billing, IaC
           │
Layer 3  Runtime      loa-finn        Persistent sessions, tool sandbox, memory
           │
Layer 2  Protocol     loa-hounfour    NATS schemas, state machines, model routing
           │
Layer 1  Framework    loa             Agent development framework, skills, Bridgebuilder
```

**Dependency direction:** Each layer depends only on layers below it. Products depend on Platform, Platform depends on Protocol + Runtime, Runtime depends on Protocol, Protocol stands alone alongside the Framework.

## Understanding the Agent Economy

If you're arriving from traditional web development, the architecture above may prompt a question: *why does an AI platform need 5 repositories, a formal protocol layer, and conservation invariants?* The answer is that Loa is not a chatbot platform — it is economic infrastructure for autonomous AI agents.

### What is an Agent Economy?

An agent economy is a system where autonomous AI agents hold identity, spend budget, and provide services within a governed commons. Each agent has an on-chain wallet, a [capability tier](GLOSSARY.md#capability-tier), and a [budget allocation](GLOSSARY.md#lot-lifecycle) that it can spend on inference. Agents are not cost centers to be minimized — they are economic actors whose activity generates value.

The distinction matters because it changes what "correct" means. In a chatbot platform, correct means "the response was good." In an agent economy, correct means "the books balanced, the conservation invariant held, the budget delegation was safe, and the response was good." Economic correctness is a precondition for operational correctness.

### Why Conservation Invariants?

When a community delegates spending authority to an autonomous agent, they need mathematical proof that the books will always balance. A billing system can tolerate occasional inconsistencies caught by human review. An economic protocol cannot — autonomous agents operate at machine speed without human oversight of individual transactions.

The [conservation invariant](GLOSSARY.md#conservation-invariant) (`available + reserved + consumed = original` for every lot) is the foundational promise. It is enforced by database constraints, application assertions, Redis Lua atomicity, and periodic reconciliation — four layers of defense because the guarantee is existential. See [ECONOMICS.md](ECONOMICS.md) § Formal Specification for the complete set of 14 canonical properties.

### Why 5 Repositories?

Separation of concerns at the protocol level. The same insight that drove Kubernetes to separate the API specification from cloud providers and container runtimes applies here:

- **Protocol contracts** (loa-hounfour) define what an agent *is*. These change slowly and require formal verification. Analogous to the Kubernetes API spec.
- **Platform infrastructure** (loa-freeside) implements *how* agents operate. These change frequently with operational demands. Analogous to a cloud provider.
- **Agent runtime** (loa-finn) provides *where* agents execute. Analogous to a container runtime (containerd, CRI-O).

A Layer 5 product should be able to switch platforms without rewriting its protocol integration — just as a Kubernetes workload can move between cloud providers.

### Why Multi-Model?

Different cognitive tasks require different AI models, just as different compute tasks require different processors. [Pool routing](GLOSSARY.md#pool-routing) maps capability requirements to model pools: `cheap` for high-volume simple tasks, `reasoning` for complex analysis, `architect` for code generation. [Ensemble strategies](GLOSSARY.md#ensemble-strategy) (`best_of_n`, `consensus`, `fallback`) provide quality and reliability guarantees that no single model can offer alone.

The economic layer makes this transparent — per-model cost attribution means communities see exactly which model consumed which portion of their budget, not an opaque total.

### The Web4 Thesis

The convergence of blockchain (ownership layer) and AI (autonomy layer) creates something neither can achieve alone: agents that own assets, tokens that gate capabilities, and economic activity that flows through protocol-level accounting. This is what the project calls "Web4" — not as a marketing claim, but as a structural observation about what becomes possible when on-chain identity meets autonomous inference. See [The Web4 Connection](#the-web4-connection) below for the technical details.

For formal definitions of all concepts mentioned here, see the [Concept Glossary](GLOSSARY.md).

## Repositories

### Layer 1: loa (Framework)

<!-- cite: loa@v1.51.0:README.md -->

| Field | Value |
|-------|-------|
| **Repository** | [0xHoneyJar/loa](https://github.com/0xHoneyJar/loa) |
| **Purpose** | Agent development framework — skills, protocols, Bridgebuilder persona |
| **Primary Language** | Shell, YAML |
| **Latest Release** | v1.51.0 |
| **Key Interface** | Slash command skills, `.loa.config.yaml`, `CLAUDE.md` import |

The foundational framework that all other repos mount. Provides the skill system (50+ skills), configuration schema, safety hooks, and the Bridgebuilder review persona. Installed via `/mount` or `/loa setup`.

**Relationship to other repos:**
- loa-freeside: Mounts loa as development framework via `.claude/loa/CLAUDE.loa.md`
- loa-finn: Mounts loa for runtime development workflows
- loa-dixie: Mounts loa for product development

### Layer 2: loa-hounfour (Protocol)

<!-- cite: loa-freeside:packages/shared/nats-schemas/src/routing.ts -->

| Field | Value |
|-------|-------|
| **Repository** | [0xHoneyJar/loa-hounfour](https://github.com/0xHoneyJar/loa-hounfour) |
| **Purpose** | Wire protocol — NATS schemas, state machines, model routing |
| **Primary Language** | TypeScript |
| **Latest Release** | v7.0.0 |
| **Key Interface** | `GatewayEventSchema`, `InteractionPayloadSchema`, `NATS_ROUTING` |

Defines the contract language for all inter-service communication. Zod schemas serve as the single source of truth, with committed JSON fixtures validating both TypeScript consumers and the Rust gateway serialization.

**Key contracts:**
- `GatewayEventSchema` — Base event envelope (event_id, event_type, shard_id, timestamp, guild_id, data)
- `InteractionPayloadSchema` — Agent invocation contract
- `NATS_ROUTING` — Stream/subject namespace shared between Rust gateway and TypeScript workers
- State machine definitions for agent lifecycle

**Relationship to other repos:**
- loa-freeside: Consumes schemas via `@0xhoneyjar/loa-hounfour` dependency; validates gateway events
- loa-finn: Consumes agent invocation contracts for session management

### Layer 3: loa-finn (Runtime)

<!-- cite: loa-freeside:themes/sietch/src/api/routes/agents.routes.ts -->

| Field | Value |
|-------|-------|
| **Repository** | [0xHoneyJar/loa-finn](https://github.com/0xHoneyJar/loa-finn) |
| **Purpose** | Agent runtime — persistent sessions, tool sandbox, memory |
| **Primary Language** | Shell |
| **Latest Release** | v1.29.0 |
| **Key Interface** | Session persistence, tool sandbox, agent memory |

The runtime engine where agents actually execute. Manages persistent sessions across conversations, provides sandboxed tool execution, and handles agent memory/context. Named for The Finn — the fence who connects agents to the physical world.

**Relationship to other repos:**
- loa-freeside: Platform routes agent requests through the runtime
- loa-hounfour: Runtime consumes protocol state machines for agent lifecycle
- loa-dixie: First product running on the runtime

### Layer 4: loa-freeside (Platform)

<!-- cite: loa-freeside:packages/core/ports/agent-gateway.ts -->
<!-- cite: loa-freeside:packages/adapters/agent/budget-manager.ts -->
<!-- cite: loa-freeside:infrastructure/terraform/ecs.tf -->

| Field | Value |
|-------|-------|
| **Repository** | [0xHoneyJar/loa-freeside](https://github.com/0xHoneyJar/loa-freeside) |
| **Purpose** | Platform infrastructure — API, Discord/TG, token-gating, billing, IaC |
| **Primary Language** | TypeScript, Rust (gateway) |
| **Latest Release** | v6.0.0 |
| **Key Interface** | 80+ REST endpoints, 22+ Discord commands, NATS event protocol |

The convergence point where all protocol layers meet distribution channels. Multi-model inference orchestration with budget-atomic accounting, token-gated capability access, and full AWS infrastructure-as-code.

**Key subsystems:**
- Agent Gateway — 5-pool model routing, BigInt micro-USD budgets, ensemble strategies
- Distribution — Discord (Rust/Axum gateway), Telegram (Grammy), REST API (Express 5.x)
- Token-Gating — 9-tier conviction scoring, wallet verification
- Billing — Paddle integration, crypto payments (NOWPayments), shadow billing
- Infrastructure — 20 Terraform modules for AWS ECS deployment

**Relationship to other repos:**
- loa-hounfour: Direct dependency (`@0xhoneyjar/loa-hounfour`) for schema validation
- loa-finn: Routes agent requests through the runtime
- loa-dixie: Provides platform APIs consumed by the product
- loa: Development framework mounted for CI/CD workflows

### Layer 5: loa-dixie (Products)

| Field | Value |
|-------|-------|
| **Repository** | [0xHoneyJar/loa-dixie](https://github.com/0xHoneyJar/loa-dixie) |
| **Purpose** | dNFT Oracle — first product customer of the platform |
| **Primary Language** | Pre-launch |
| **Latest Release** | Pre-launch |
| **Key Interface** | Autonomous dNFT with persistent memory and transferable capabilities |

The first product built on the Loa platform. Autonomous dynamic NFTs that speak, remember, and operate as economic actors within the agent economy. Named for the Dixie Flatline — McCoy Pauley's ROM construct, the first digital entity that speaks.

**Relationship to other repos:**
- loa-freeside: Consumes platform APIs for inference, billing, identity
- loa-finn: Runs agent sessions on the runtime
- loa-hounfour: Uses protocol contracts for agent invocation

## Protocol Contract Flow

How loa-hounfour schemas connect the stack:

```
Discord User → Rust Gateway (apps/gateway)
                    │
                    ▼
              Serialize to GatewayEventSchema (loa-hounfour)
                    │
                    ▼
              Publish to NATS JetStream
              (subject from NATS_ROUTING)
                    │
                    ▼
              TypeScript Worker (apps/worker)
              validates via Zod schemas
                    │
                    ▼
              Agent invocation via InteractionPayloadSchema
                    │
                    ▼
              loa-finn runtime → agent session
                    │
                    ▼
              Response flows back through same contracts
```

<!-- cite: loa-freeside:apps/gateway/src/main.rs -->
<!-- cite: loa-freeside:apps/worker/ -->
<!-- cite: loa-freeside:packages/shared/nats-schemas/src/routing.ts -->

The critical invariant: JSON fixtures committed in loa-hounfour are the neutral source of truth. Both the TypeScript Zod validation and the Rust `serde` deserialization run against the same fixtures, ensuring schema agreement across language boundaries.

## The Neuromancer Map

All naming in the Loa protocol draws from William Gibson's Sprawl trilogy (Neuromancer, Count Zero, Mona Lisa Overdrive). This is not decorative — each name maps to a structural role.

| Gibson Reference | Source Novel | Repo | Structural Role |
|-----------------|-------------|------|-----------------|
| **Loa** | Count Zero | loa | Voodoo spirits that ride the net — autonomous AI agents |
| **Hounfour** | Count Zero | loa-hounfour | Voodoo temple where the loa manifest — protocol contracts |
| **The Finn** | Neuromancer | loa-finn | The fence who connects entities to the world — runtime broker |
| **Freeside** | Neuromancer | loa-freeside | The orbital station where all systems converge — platform |
| **Dixie Flatline** | Neuromancer | loa-dixie | McCoy Pauley's ROM construct — first digital entity that speaks |
| **Sietch** | (Dune) | themes/sietch/ | Historical name retained for the main service theme |
| **Wintermute** | Neuromancer | (internal) | The AI seeking to merge — used for synthesis engine references |

**Historical note:** The project originated with Dune-themed naming. As scope expanded from community management to agent economy infrastructure, naming transitioned to Neuromancer trilogy references to better reflect the cyberpunk ethos of autonomous digital entities operating in economic networks.

## The Web4 Connection

The Loa protocol operates at the intersection of blockchain and AI — what the project internally terms "Web4." This is not a marketing claim but a structural observation:

- **Web3** provides the ownership layer: tokens, NFTs, on-chain identity, economic rules
- **AI agents** provide the autonomy layer: inference, decision-making, persistent memory
- **Loa** provides the infrastructure connecting both: agents that own assets, tokens that gate capabilities, economic activity that flows through protocol-level accounting

<!-- cite: loa-freeside:packages/adapters/agent/budget-manager.ts -->
<!-- cite: loa-freeside:packages/adapters/agent/ensemble-accounting.ts -->

The budget-atomic accounting system (BigInt micro-USD precision, two-counter Redis Lua scripts) is the primitive that makes this possible — it ensures every inference call is economically attributable, enabling agents to operate as genuine economic actors rather than cost centers.

## Statistics

| Repo | TypeScript Files | Terraform Modules | Test Files | Route Files | Latest Tag |
|------|-----------------|-------------------|------------|-------------|------------|
| loa-freeside | 1,379 | 20 | 442 | 42 | v6.0.0 |
| loa-hounfour | — | — | — | — | v7.0.0 |
| loa-finn | — | — | — | — | v1.29.0 |
| loa | — | — | — | — | v1.51.0 |
| loa-dixie | — | — | — | — | pre-launch |

**loa-freeside detail:**
- 42 API route files across 80+ endpoints
- 35 Discord command files (22+ slash commands)
- 13 Telegram bot files (10+ commands)
- 81 Terraform files across 20 modules
- 18 core port interfaces

**Measurement method:** File counts via `find` with `node_modules`, `dist`, and build artifacts excluded. Remote repo stats from GitHub API. Stats for remote repos are placeholders — run `scripts/ecosystem-stats.sh --fresh` to populate from source.

## Building on Loa

### Why This Architecture Exists

Loa did not start as a 5-repo protocol stack. It started as a Discord bot for community management — conviction scoring and tiered role progression. Through 35 development cycles, the scope expanded: first multi-model inference, then economic accounting, then formal protocol contracts, then payment rails, then autonomous agents as economic actors.

The 5-repo structure emerged because these concerns *must* evolve independently:

- **Protocol contracts** (loa-hounfour) define what an agent *is* — schemas, state machines, conservation invariants. These change slowly and require formal verification.
- **Platform infrastructure** (loa-freeside) implements *how* agents operate — API routing, budget management, deployment. These change frequently with operational demands.
- **Agent runtime** (loa-finn) provides *where* agents execute — sessions, memory, tool sandboxes. Runtime evolution is independent of both protocol and platform.

This is the Kubernetes insight applied to agent economies: the contract specification (hounfour, like the Kubernetes API) is independent of both the platform (freeside, like a cloud provider) and the runtime (finn, like a container runtime). A Layer 5 product should be able to switch platforms without changing protocol contracts.

### Conceptual Prerequisites

If you're coming from traditional web development, several concepts in Loa have no direct precedent. Before diving into the technical documentation, familiarize yourself with:

- **Conservation invariants**: The mathematical guarantee that `available + reserved + consumed = original` for every budget lot. See [GLOSSARY.md](GLOSSARY.md) for the full definition.
- **BigInt micro-USD arithmetic**: All monetary values are integer micro-USD (1 cent = 10,000 micro-USD). No floating point ever touches money.
- **JetStream at-least-once delivery**: NATS messages may be delivered more than once. Consumers must handle deduplication via `event_id`.
- **Token-gating**: On-chain token holdings (BGT) determine capability access tiers. This is not authentication — it is *economic authorization*.
- **Hexagonal architecture**: Core business logic is isolated from delivery mechanisms via port/adapter interfaces.

For formal definitions of all Loa-specific concepts, see the [Concept Glossary](GLOSSARY.md).

### The Learning Journey

Each step introduces new primitives that build on the previous. This is a conceptual progression, not just a reading list.

```
1. What is Loa?           (this doc — 5-layer stack, dependency direction, naming)
        │
        ▼
2. What are the rules?    (loa-hounfour — protocol contracts, state machines, invariants)
        │
        ▼
3. How does money work?   (ECONOMICS.md — budget atomicity, lot lifecycle, capability tiers)
        │
        ▼
4. How do events flow?    (EVENT-PROTOCOL.md — NATS streams, GatewayEvent, subscriptions)
        │
        ▼
5. How do I call an agent? (API-QUICKSTART.md — first API call in 5 minutes)
        │
        ▼
6. What can I build?      (API-REFERENCE.md — full endpoint reference, stability tiers)
        │
        ▼
7. How do I deploy?       (INFRASTRUCTURE.md — Terraform modules, staging guide)
        │
        ▼
8. How do I run it?       (CLI.md — gaib CLI for management)
```

### By Role

| Role | Path | Key Concepts |
|------|------|-------------|
| **API Consumer** | [API-QUICKSTART](API-QUICKSTART.md) → [API-REFERENCE](API-REFERENCE.md) → [ECONOMICS](ECONOMICS.md) → [Stability Tiers](API-REFERENCE.md) | Making agent calls, understanding costs, stability guarantees |
| **Product Builder** | This doc → [EVENT-PROTOCOL](EVENT-PROTOCOL.md) → [ECONOMICS](ECONOMICS.md) → [loa-hounfour](https://github.com/0xHoneyJar/loa-hounfour) → [API-REFERENCE](API-REFERENCE.md) | NATS subscriptions, cost attribution, protocol contracts |
| **Protocol Contributor** | [loa-hounfour](https://github.com/0xHoneyJar/loa-hounfour) → [ECONOMICS](ECONOMICS.md) → [EVENT-PROTOCOL](EVENT-PROTOCOL.md) → conservation invariant source | Schema definitions, conservation properties, temporal properties |
| **Operator** | [INFRASTRUCTURE](INFRASTRUCTURE.md) → [CLI](CLI.md) → monitoring dashboards → cost estimation | Deployment, management, monitoring |
| **New to Agent Economies** | [GLOSSARY](GLOSSARY.md) → This doc → [ECONOMICS](ECONOMICS.md) → [EVENT-PROTOCOL](EVENT-PROTOCOL.md) | What is an agent economy? How does it differ from SaaS? |

### Freeside-Specific Deep Dive

For developers working directly on loa-freeside, see the [Developer Guide](DEVELOPER-GUIDE.md) for the full learning path, document ownership table, and contribution practices.

## Next Steps

- [API-QUICKSTART.md](API-QUICKSTART.md) — Make your first agent call against the platform
- [API-REFERENCE.md](API-REFERENCE.md) — Full endpoint reference (Tier 1 + Tier 2)
- [ECONOMICS.md](ECONOMICS.md) — Economic primitives: budget accounting, conservation, tiers
- [EVENT-PROTOCOL.md](EVENT-PROTOCOL.md) — NATS event protocol for real-time subscriptions
- [INFRASTRUCTURE.md](INFRASTRUCTURE.md) — Deployment topology and Terraform modules

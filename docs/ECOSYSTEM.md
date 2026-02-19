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

The learning path depends on what you're building. Each path moves through the stack from protocol foundations upward to product integration.

### Journey Map

```
1. Ecosystem Overview (this doc)
        │
        ▼
2. Protocol Types (loa-hounfour)
   GatewayEventSchema, InteractionPayloadSchema, NATS_ROUTING
        │
        ▼
3. Platform APIs (loa-freeside)
   HTTP endpoints, economic primitives, event protocol
        │
        ▼
4. Runtime Capabilities (loa-finn)
   Persistent sessions, tool sandbox, agent memory
        │
        ▼
5. Build Your Product (loa-dixie as example)
   dNFT Oracle — first Layer 5 customer
```

### By Role

| Role | Start With | Then Read | Focus On |
|------|-----------|-----------|----------|
| **API Consumer** | [API-QUICKSTART.md](API-QUICKSTART.md) | [API-REFERENCE.md](API-REFERENCE.md) → [ECONOMICS.md](ECONOMICS.md) | Making agent calls, understanding budget model |
| **Product Builder** | This doc → [EVENT-PROTOCOL.md](EVENT-PROTOCOL.md) | [API-REFERENCE.md](API-REFERENCE.md) → [ECONOMICS.md](ECONOMICS.md) | NATS subscription patterns, cost attribution |
| **Protocol Contributor** | [loa-hounfour](https://github.com/0xHoneyJar/loa-hounfour) | [EVENT-PROTOCOL.md](EVENT-PROTOCOL.md) → [ECONOMICS.md](ECONOMICS.md) | Schema definitions, conservation invariants |

### Freeside-Specific Deep Dive

For developers working directly on loa-freeside, see the [Developer Guide](DEVELOPER-GUIDE.md) for the full learning path, document ownership table, and contribution practices.

## Next Steps

- [API-QUICKSTART.md](API-QUICKSTART.md) — Make your first agent call against the platform
- [API-REFERENCE.md](API-REFERENCE.md) — Full endpoint reference (Tier 1 + Tier 2)
- [ECONOMICS.md](ECONOMICS.md) — Economic primitives: budget accounting, conservation, tiers
- [EVENT-PROTOCOL.md](EVENT-PROTOCOL.md) — NATS event protocol for real-time subscriptions
- [INFRASTRUCTURE.md](INFRASTRUCTURE.md) — Deployment topology and Terraform modules

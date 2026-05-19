# Freeside

[![Version](https://img.shields.io/badge/version-7.0.0-blue.svg)](CHANGELOG.md)
[![License](https://img.shields.io/badge/license-AGPL--3.0-green.svg)](LICENSE.md)

Multi-model agent economy infrastructure platform. Token-gated AI capabilities, budget-atomic inference, and cross-chain community management delivered as Discord, Telegram, and REST APIs.

<!-- cite: loa-freeside:themes/sietch/src/api/routes/agents.routes.ts -->
<!-- cite: loa-freeside:packages/adapters/agent/ensemble-accounting.ts -->
<!-- cite: loa-freeside:packages/adapters/agent/budget-manager.ts -->

## What is Freeside?

Freeside is **two things in one repository**: a vertical SaaS platform AND the ecosystem parent for the `freeside-*` module network.

**As a platform**, Freeside is the L4 substrate of the [Loa protocol](https://github.com/0xHoneyJar/loa): multi-tenant infrastructure for AI agent economies on-chain. The platform implements the **Commons Protocol** — a community-governed economic protocol for AI inference with conservation invariants, conviction-gated access, and transparent disagreement resolution. Communities configure conviction-based tiers, each tier unlocks access to different model pools, and all inference runs through budget-atomic accounting with per-model cost attribution.

<!-- cite: loa-freeside:packages/core/ports/ -->

**As an ecosystem parent**, Freeside hosts the registry + beacon protocol + MCP federation gateway + ecosystem CLI for the `freeside-*` module network — installable modules that **deploy onto the platform's infrastructure** and declare themselves via the BeaconV3 sealed schema for cross-repo discovery and composition.

<!-- cite: loa-freeside:packages/beacon-schema/ -->
<!-- cite: loa-freeside:packages/freeside-registry/ -->
<!-- cite: loa-freeside:packages/freeside-cli/ -->
<!-- cite: loa-freeside:apps/mcp-gateway/ -->

The two concerns share a repository but not a release cycle, a beads ledger, or a grimoire. The split is enforced by CI ([ADR-007 §D-3](decisions/007-loa-freeside-absorption.md)) and explained in [ADR-008](decisions/008-freeside-as-layered-station.md). For the relationship between the platform, the network, and the modules — see [§Mental Model](#mental-model) below.

This repo serves four audiences:

- **Community operators** configure token thresholds, model budgets, and channel permissions through Discord slash commands or the admin API
- **Developers** integrate AI agent capabilities via REST endpoints with JWT authentication, or build on the NATS event protocol
- **Module authors** ship `freeside-*` repos with a BeaconV3 declaration; the registry aggregates them; the federation gateway routes between them
- **Infrastructure teams** deploy via Terraform to AWS ECS with full observability

## Capabilities

### Agent Gateway
<!-- cite: loa-freeside:packages/adapters/agent/ -->

Multi-model inference orchestration with production-grade financial controls:

- **5-pool model routing** — cheap, fast-code, reviewer, reasoning, native tiers mapped to provider models
<!-- cite: loa-freeside:packages/adapters/agent/pool-mapping.ts -->
- **Budget atomicity** — BigInt micro-USD precision with two-counter Redis Lua scripts; zero precision loss
<!-- cite: loa-freeside:packages/adapters/agent/budget-manager.ts -->
- **Ensemble strategies** — best_of_n, consensus, fallback with per-model cost attribution
<!-- cite: loa-freeside:packages/adapters/agent/ensemble-accounting.ts -->
- **4-dimension rate limiting** — community, user, channel, burst
- **SSE streaming** — with reconciliation for dropped connections
- **BYOK** — Bring Your Own Key with envelope encryption (AES-256-GCM + KMS wrap), LRU cache, circuit breaker
<!-- cite: loa-freeside:packages/adapters/agent/byok-manager.ts -->

### Token-Gated Access
<!-- cite: loa-freeside:themes/sietch/src/services/ -->

On-chain conviction scoring drives capability access:

- **9-tier progression** — BGT holdings and community rank determine tier placement
- **Conviction scoring** — holding duration, accumulation patterns, trading behavior, on-chain activity
- **Access control** — free, pro, enterprise capability tiers mapped to model pools
- **Wallet verification** — session-based signature verification with rate limiting and timing-safe comparisons
<!-- cite: loa-freeside:themes/sietch/src/api/routes/verify.routes.ts -->

### Distribution Channels
<!-- cite: loa-freeside:themes/sietch/src/discord/ -->
<!-- cite: loa-freeside:themes/sietch/src/telegram/ -->

- **Discord** — 22+ slash commands, Rust/Axum gateway proxy with multi-shard pool via Twilight
<!-- cite: loa-freeside:apps/gateway/src/main.rs -->
- **Telegram** — Grammy bot framework with 10+ commands and throttled streaming edits
- **REST API** — 80+ Express endpoints with Zod validation
<!-- cite: loa-freeside:themes/sietch/src/api/routes/ -->
- **NATS protocol** — Cross-language wire format with Zod schemas and JSON fixtures
<!-- cite: loa-freeside:packages/shared/nats-schemas/ -->

### Billing & Payments
<!-- cite: loa-freeside:themes/sietch/src/api/routes/ -->

- **Paddle integration** — checkout, subscriptions, webhooks, customer portal
- **Crypto payments** — NOWPayments integration (feature-flagged)
- **Shadow billing** — parallel billing tracking for migration testing
- **Entitlements caching** — feature access with audit logging

### Infrastructure-as-Code
<!-- cite: loa-freeside:infrastructure/terraform/ -->

- **20 Terraform modules** — ECS, RDS, ElastiCache, ALB, Route53, CloudWatch, KMS
<!-- cite: loa-freeside:infrastructure/terraform/ecs.tf -->
<!-- cite: loa-freeside:infrastructure/terraform/rds.tf -->
- **Agent monitoring** — CloudWatch dashboards + alarms for gateway metrics
<!-- cite: loa-freeside:infrastructure/terraform/agent-monitoring.tf -->
- **BYOK security** — Least-privilege IAM roles per service
<!-- cite: loa-freeside:infrastructure/terraform/byok-security.tf -->

### Coexistence & Migration
<!-- cite: loa-freeside:packages/adapters/coexistence/ -->

Shadow mode for testing alongside existing verification bots (Collab.Land, Matrica, Guild.xyz):

- 4 transition modes: shadow → parallel → primary → exclusive
- Divergence tracking via shadow ledger
- Incumbent health monitoring with emergency rollback
<!-- cite: loa-freeside:themes/sietch/src/api/routes/coexistence.routes.ts -->

### CLI (gaib — platform IaC)
<!-- cite: loa-freeside:packages/cli/ -->

- `gaib login/logout/whoami` — Authentication
- `gaib sandbox new|ls|rm|env|link|unlink|status` — Sandbox management
- `gaib server` — IaC deployment commands

### Module Network (ecosystem-parent surface)
<!-- cite: loa-freeside:packages/freeside-registry/ -->
<!-- cite: loa-freeside:packages/freeside-cli/ -->
<!-- cite: loa-freeside:packages/beacon-schema/ -->
<!-- cite: loa-freeside:apps/mcp-gateway/ -->

The network concern is the meta-registry for the `freeside-*` module ecosystem:

- **BeaconV3 schema** (`@freeside/beacon-schema`) — sealed module declaration contract with `is` / `is_not` / `composes_with` / `acvp_invariants` fields enforcing module boundaries at the protocol layer
- **Module registry** (`@freeside/freeside-registry`) — L1 canonical list of registered modules + compact federation manifest builder
- **MCP federation gateway** (`apps/mcp-gateway/`) — TS federation router (`mcp.0xhoneyjar.xyz/{slug}`) absorbed from the original `freeside-mcp-gateway` repo per [ADR-007](decisions/007-loa-freeside-absorption.md)
- **Ecosystem CLI** (`@freeside/freeside-cli`) — `freeside-cli list|inspect|doctor` for operators to discover, inspect, and audit registered modules

### CLI (freeside-cli — ecosystem operator surface)
<!-- cite: loa-freeside:packages/freeside-cli/ -->

- `freeside-cli list` — Show all registered `freeside-*` modules with visibility + owner
- `freeside-cli inspect <slug>` — Show beacon details for a specific module
- `freeside-cli doctor` — Audit all modules against BeaconV3 schema; compliance report

## Mental Model

> *This section adopts the doctrine documented in [ADR-008](decisions/008-freeside-as-layered-station.md) — the layered identity for `loa-freeside` post-absorption.*

### The platform RUNS the modules

`loa-freeside` is the L4 platform of the Loa stack. Modules in the `freeside-*` namespace are **deployed onto** the platform's infrastructure (AWS ECS, the gateway services, the database, the queues). The platform doesn't just sit alongside the modules — it hosts their runtimes.

The network concern (registry + beacon + federation gateway + ecosystem CLI) is the protocol layer that makes the deployed modules **discoverable** and **composable** to agents. Without the network, modules are isolated. Without the platform, modules have nothing to run on.

```
   ┌────────────────────────────────────────────────────────────────┐
   │  MODULES (each in its own freeside-* repo)                     │
   │  freeside-sonar · freeside-storage · freeside-mint ·           │
   │  freeside-activities · freeside-inventory · score-mibera ·     │
   │  …each broadcasts BeaconV3 at /.well-known/beacon.json         │
   └────────────────────────────────┬───────────────────────────────┘
                                    │ deployed onto / federated through
                                    ▼
   ┌────────────────────────────────────────────────────────────────┐
   │  NETWORK (loa-freeside's ecosystem-parent surface)             │
   │  • packages/beacon-schema/     — validates module declarations  │
   │  • packages/freeside-registry/ — aggregates module beacons      │
   │  • apps/mcp-gateway/           — routes between modules         │
   │  • packages/freeside-cli/      — operator inspection + audit    │
   └────────────────────────────────┬───────────────────────────────┘
                                    │ runs on / hosted by
                                    ▼
   ┌────────────────────────────────────────────────────────────────┐
   │  PLATFORM (loa-freeside's vertical substrate)                  │
   │  • apps/gateway/, apps/worker/, apps/ingestor/                 │
   │  • themes/sietch/              — HTTP, Discord, Telegram       │
   │  • packages/{core,adapters,services,sandbox,…}                 │
   │  • infrastructure/terraform/   — AWS ECS substrate             │
   │  • packages/cli/ (gaib)        — IaC orchestrator              │
   └────────────────────────────────────────────────────────────────┘
```

### Three orthogonal planes

When working in the repo, you are always operating on **one of three planes**. Naming the plane prevents bug-source confusion and channels attention to the right surface:

| Plane | What it holds | Lives in |
|-------|---------------|----------|
| **Contract** | Sealed schemas, BeaconV3, NATS protocols, Zod definitions, integration boundaries. The only plane where the system touches itself — modules talk to *schemas*, never to the platform directly. | `packages/beacon-schema/`, `packages/shared/nats-schemas/`, `packages/core/ports/` |
| **Construct** | Pure logic, state machines, persona definitions, intent generators. Brains in vats — no concept of Discord, Berachain, AWS, or Bun. | `themes/sietch/src/services/`, `packages/core/`, agent-expertise lives in external `construct-*` packs |
| **Execution** | The interpreter, the runtime, side-effects, I/O, blockchain RPC, gateways, AWS ECS, HTTP servers. The cyberdeck that catches Intents and fires HTTP/RPC/PG calls. | `apps/*`, `themes/sietch/src/api/`, `packages/adapters/agent/`, `infrastructure/terraform/`, `packages/cli/` (gaib) |

**Daily diagnostic**: when something breaks, ask "is this a contract mismatch, a construct logic error, or an execution-layer flake?" The plane classification narrows the surface to inspect.

### Prefix-as-type-signature

The repo prefix encodes layer membership (canon per `loa-org-naming-conventions` vault doctrine):

- **`loa-X`** — a member of the Loa stack itself. `loa-freeside` IS the L4 platform.
- **`freeside-X`** — an **installable module** that deploys onto the freeside platform (e.g., `freeside-sonar`, `freeside-storage`, `freeside-mint`).
- **`construct-X`** — an agent-expertise pack about X. Plane 2 (Construct) by convention.
- **`world-X`** — a world-substrate deployment (a specific community's deployed module bundle).

No new prefixes are introduced by this absorption — the namespace already encoded the layering correctly. [ADR-008 §D-4](decisions/008-freeside-as-layered-station.md) adopts this as repo-canonical.

## Ecosystem

Freeside is Layer 4 in the 5-layer Loa protocol stack:

```
Layer 5  Products     loa-dixie       dNFT Oracle — first customer
Layer 4  Platform     loa-freeside    API, Discord/TG, token-gating, billing, IaC  ← you are here
Layer 3  Runtime      loa-finn        Persistent sessions, tool sandbox, memory
Layer 2  Protocol     loa-hounfour    NATS schemas, state machines, model routing
Layer 1  Framework    loa             Agent dev framework, skills, Bridgebuilder
```

| Repo | Purpose | Key Interface |
|------|---------|---------------|
| [loa](https://github.com/0xHoneyJar/loa) | Agent development framework | Skills, protocols, Bridgebuilder persona |
| [loa-hounfour](https://github.com/0xHoneyJar/loa-hounfour) | Wire protocol + model routing | NATS schemas, agent-invoke contracts |
| [loa-finn](https://github.com/0xHoneyJar/loa-finn) | Agent runtime | Persistent sessions, tool sandbox |
| **loa-freeside** | **Platform infrastructure + ecosystem parent for freeside-* modules** | **REST API, Discord/TG, billing, Terraform, BeaconV3 registry, MCP federation** |
| [loa-dixie](https://github.com/0xHoneyJar/loa-dixie) | dNFT Oracle product | First platform customer (L5) |

The `freeside-*` namespace contains **installable modules** that deploy onto the loa-freeside platform. Currently registered ([packages/freeside-registry/registry.yaml](packages/freeside-registry/registry.yaml)): `freeside-sonar`, `freeside-storage`, `freeside-mint`, `freeside-activities`, `freeside-inventory`, `score-mibera`. Each broadcasts a BeaconV3 declaration at `/.well-known/beacon.json` and is aggregated into the federation manifest at `mcp.0xhoneyjar.xyz/.well-known/federation.json`.

Protocol contracts flow upward: loa-hounfour schemas are consumed by loa-freeside's gateway adapter and validated with the same Zod types used by the Rust gateway.

See [docs/ECOSYSTEM.md](docs/ECOSYSTEM.md) for the full ecosystem map with statistics and dependency analysis.

## Architecture

```
loa-freeside/                  ⟶ Dual-concern monorepo (per ADR-007 + ADR-008)
│
├── packages/                  # PLATFORM (vertical-SaaS substrate)
│   ├── core/                  # Port interfaces + domain types
│   │   └── ports/             # IChainProvider, IStorageProvider, IAgentGateway
│   ├── adapters/              # 8 adapter modules
│   │   ├── agent/             # Gateway, BudgetManager, BYOK, ensemble, audit
│   │   ├── chain/             # RPC, Dune Sim API, hybrid provider
│   │   ├── storage/           # Drizzle ORM + PostgreSQL + RLS
│   │   ├── synthesis/         # BullMQ queue for Discord API
│   │   ├── wizard/            # 8-step onboarding orchestrator
│   │   ├── themes/            # ThemeRegistry, SietchTheme
│   │   ├── security/          # Vault, KillSwitch, MFA
│   │   └── coexistence/       # Shadow mode, migration engine
│   ├── cli/                   # @freeside/cli — gaib IaC CLI (platform tooling)
│   ├── sandbox/               # Schema provisioning, event routing
│   └── shared/nats-schemas/   # Cross-language wire format (Zod + JSON)
│
│                              # NETWORK (ecosystem-parent surface)
│   ├── beacon-schema/         # @freeside/beacon-schema — V2 + BeaconV3 sealed schema
│   ├── freeside-registry/     # @freeside/freeside-registry — L1 registry + manifest builder
│   └── freeside-cli/          # @freeside/freeside-cli — `freeside-cli list|inspect|doctor`
│
├── themes/sietch/             # PLATFORM — Main Discord/Telegram service (v6.0.0)
│   ├── src/api/               # Express REST API (80+ routes)
│   ├── src/discord/           # Slash commands (22+)
│   ├── src/telegram/          # Grammy bot (10+ commands)
│   ├── src/trigger/           # Scheduled tasks (7 cron jobs)
│   └── drizzle/               # Database migrations
│
├── apps/                      # Execution-plane services
│   ├── gateway/               # PLATFORM — Rust/Axum Discord gateway proxy (multi-shard)
│   ├── ingestor/              # PLATFORM — Event ingestion service
│   ├── worker/                # PLATFORM — Background job worker (NATS + RabbitMQ)
│   └── mcp-gateway/           # NETWORK — TS MCP federation router (absorbed from freeside-mcp-gateway)
│
├── grimoires/
│   ├── freeside-platform/     # PLATFORM — vertical-platform cycle artifacts
│   └── freeside-network/      # NETWORK — ecosystem-registry cycle artifacts
│
├── infrastructure/
│   └── terraform/             # PLATFORM — AWS ECS deployment (20 modules)
│
├── decisions/                 # ADRs — repo-canonical architectural decisions
│   ├── 007-loa-freeside-absorption.md       # Dual-concern workspace + BeaconV3 + firewall
│   └── 008-freeside-as-layered-station.md   # Platform-as-substrate + 3-plane identity
│
├── evals/                     # Evaluation framework + test suites
└── docs/                      # Developer documentation
```

CI enforces the platform/network firewall: PRs touching paths in both domains are blocked by `.github/workflows/path-domain-check.yml`. See [ADR-007 §D-3](decisions/007-loa-freeside-absorption.md) for the full enforcement model.

## Technology Stack

| Layer | Technology |
|-------|------------|
| Runtime | Node.js 22+, Rust (gateway) |
| Language | TypeScript (strict), Rust |
| Bot Frameworks | discord.js v14, Grammy (Telegram), Twilight 0.17 (Rust gateway) |
| API | Express 5.x, Zod validation |
| Database | PostgreSQL 15 + Drizzle ORM + Row-Level Security |
| Cache | Redis 7 (ioredis) |
| Queue | BullMQ (synthesis, reaper), NATS JetStream (gateway events) |
| Blockchain | viem 2.x (RPC), Dune Sim API (hybrid mode) |
| Infrastructure | Terraform, AWS ECS (Fargate), Docker |
| Monitoring | CloudWatch, OTEL/X-Ray tracing, Prometheus metrics |
| Testing | Vitest, fast-check (property-based) |
| Secrets | AWS KMS (BYOK envelope encryption), optional HashiCorp Vault |

## Quick Start

### For Developers (API integration)

```bash
git clone https://github.com/0xHoneyJar/loa-freeside.git
cd loa-freeside
pnpm install

# Set up environment
cp .env.example .env
# Fill: DATABASE_URL, REDIS_URL, JWT_SECRET

# Start backing services
docker-compose up -d  # PostgreSQL + Redis

# Run database migrations
cd themes/sietch && npx drizzle-kit push && cd ../..

# Start development server
pnpm run dev
# → http://localhost:3000

# Verify
curl http://localhost:3000/api/agents/health
```

See [docs/API-QUICKSTART.md](docs/API-QUICKSTART.md) for the "First agent call in 5 minutes" tutorial.

### For Operators (deployment)

See [INSTALLATION.md](INSTALLATION.md) for full deployment guide including Docker, database, Redis, and infrastructure configuration.

See [docs/INFRASTRUCTURE.md](docs/INFRASTRUCTURE.md) for the Terraform deployment topology, module inventory, and staging guide.

## Configuration

Key environment variables (see [INSTALLATION.md](INSTALLATION.md) for full list):

| Variable | Required | Description |
|----------|----------|-------------|
| DATABASE_URL | Yes | PostgreSQL connection URL |
| REDIS_URL | Yes | Redis connection URL |
| DISCORD_BOT_TOKEN | Yes | Discord bot token |
| DISCORD_GUILD_ID | Yes | Discord server ID |
| BERACHAIN_RPC_URLS | Yes | Comma-separated RPC endpoints |
| JWT_SECRET | Yes | JWT signing secret |

Feature flags control optional subsystems:

| Flag | Default | Enables |
|------|---------|---------|
| AGENT_ENABLED | false | Agent gateway routes |
| FEATURE_BILLING_ENABLED | false | Paddle billing |
| FEATURE_REDIS_ENABLED | false | Redis caching layer |
| FEATURE_TELEGRAM_ENABLED | false | Telegram bot bridge |
| FEATURE_CRYPTO_PAYMENTS_ENABLED | false | NOWPayments crypto billing |
| CHAIN_PROVIDER | rpc | Provider mode: rpc, dune_sim, hybrid |

## Documentation

| Document | Audience | Description |
|----------|----------|-------------|
| [BUTTERFREEZONE.md](BUTTERFREEZONE.md) | AI agents | Machine-readable project overview with source citations |
| [decisions/007-loa-freeside-absorption.md](decisions/007-loa-freeside-absorption.md) | Architects | Dual-concern absorption doctrine + BeaconV3 normative schema (Appendix A) |
| [decisions/008-freeside-as-layered-station.md](decisions/008-freeside-as-layered-station.md) | Architects | Platform-as-substrate identity + 3-plane mental model |
| [INSTALLATION.md](INSTALLATION.md) | Operators | Setup, deployment, and configuration guide |
| [docs/ECOSYSTEM.md](docs/ECOSYSTEM.md) | Everyone | 5-repo Loa ecosystem map with layer diagram |
| [docs/API-QUICKSTART.md](docs/API-QUICKSTART.md) | Developers | First agent call in 5 minutes |
| [docs/API-REFERENCE.md](docs/API-REFERENCE.md) | Developers | Full API reference (stable + unstable tiers) |
| [docs/INFRASTRUCTURE.md](docs/INFRASTRUCTURE.md) | Operators | Terraform topology, modules, staging guide |
| [docs/CLI.md](docs/CLI.md) | Developers | gaib CLI reference (platform IaC) |
| [packages/freeside-cli/README.md](packages/freeside-cli/README.md) | Module operators | `freeside-cli` ecosystem CLI reference (network) |
| [packages/beacon-schema/README.md](packages/beacon-schema/README.md) | Module authors | BeaconV3 schema reference for declaring a `freeside-*` module |
| [packages/freeside-registry/README.md](packages/freeside-registry/README.md) | Module authors | Registry shape + federation manifest contract |
| [docs/DEVELOPER-GUIDE.md](docs/DEVELOPER-GUIDE.md) | Contributors | Onboarding path and ownership table |
| [CHANGELOG.md](CHANGELOG.md) | Everyone | Version history and release notes |

## Development

```bash
pnpm run build      # Build all packages
pnpm test           # Run tests
pnpm run typecheck  # Type checking
pnpm run dev        # Start with hot reload
```

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit with conventional commit messages — scope should be `platform/<x>`, `network/<x>`, or `shared/<x>` per [ADR-007 §D-3](decisions/007-loa-freeside-absorption.md)
4. Push and open a Pull Request — CI enforces the workspace firewall (cross-domain PRs are rejected)

Before opening a PR touching paths in `apps/`, `packages/`, or `grimoires/`, run `tools/check-beacon-domain.sh` locally to verify your changes don't cross the platform/network boundary.

## Historical Note

This repository evolved from a single-purpose engagement bot with Dune-themed naming to a multi-model agent economy infrastructure. Naming transitioned to Neuromancer trilogy references (Freeside, Sietch, Wintermute, etc.) to reflect the expanded scope. Some internal package prefixes remain from the original naming for backwards compatibility.

## Next Steps

- [docs/ECOSYSTEM.md](docs/ECOSYSTEM.md) — How Freeside fits into the 5-repo Loa protocol
- [docs/API-QUICKSTART.md](docs/API-QUICKSTART.md) — Make your first agent call in 5 minutes
- [docs/DEVELOPER-GUIDE.md](docs/DEVELOPER-GUIDE.md) — Full learning path and document index

## License

[AGPL-3.0](LICENSE.md)

## Links

- [Discord](https://discord.gg/thehoneyjar)
- [The HoneyJar](https://thehoneyjar.xyz)
- [Loa Protocol](https://github.com/0xHoneyJar/loa)

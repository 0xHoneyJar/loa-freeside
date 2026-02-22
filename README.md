# Freeside

[![Version](https://img.shields.io/badge/version-6.0.0-blue.svg)](CHANGELOG.md)
[![License](https://img.shields.io/badge/license-AGPL--3.0-green.svg)](LICENSE.md)

Multi-model agent economy infrastructure platform. Token-gated AI capabilities, budget-atomic inference, and cross-chain community management delivered as Discord, Telegram, and REST APIs.

<!-- cite: loa-freeside:themes/sietch/src/api/routes/agents.routes.ts -->
<!-- cite: loa-freeside:packages/adapters/agent/ensemble-accounting.ts -->
<!-- cite: loa-freeside:packages/adapters/agent/budget-manager.ts -->

## What is Freeside?

Freeside is the platform layer of the [Loa protocol](https://github.com/0xHoneyJar/loa) — a multi-tenant infrastructure for building and operating AI agent economies on-chain. It connects on-chain token holdings to AI capabilities: communities configure conviction-based tiers, each tier unlocks access to different model pools, and all inference runs through budget-atomic accounting with per-model cost attribution.

<!-- cite: loa-freeside:packages/core/ports/ -->

The platform serves three audiences:

- **Community operators** configure token thresholds, model budgets, and channel permissions through Discord slash commands or the admin API
- **Developers** integrate AI agent capabilities via REST endpoints with JWT authentication, or build on the NATS event protocol
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

### CLI (gaib)
<!-- cite: loa-freeside:packages/cli/ -->

- `gaib login/logout/whoami` — Authentication
- `gaib sandbox new|ls|rm|env|link|unlink|status` — Sandbox management
- `gaib server` — IaC deployment commands

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
| **loa-freeside** | **Platform infrastructure** | **REST API, Discord/TG, billing, Terraform** |
| [loa-dixie](https://github.com/0xHoneyJar/loa-dixie) | dNFT Oracle product | First platform customer |

Protocol contracts flow upward: loa-hounfour schemas are consumed by loa-freeside's gateway adapter and validated with the same Zod types used by the Rust gateway.

See [docs/ECOSYSTEM.md](docs/ECOSYSTEM.md) for the full ecosystem map with statistics and dependency analysis.

## Architecture

```
loa-freeside/
├── packages/
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
│   ├── cli/                   # gaib CLI (auth, sandbox, server)
│   ├── sandbox/               # Schema provisioning, event routing
│   └── shared/nats-schemas/   # Cross-language wire format (Zod + JSON)
├── themes/sietch/             # Main Discord/Telegram service (v6.0.0)
│   ├── src/api/               # Express REST API (80+ routes)
│   ├── src/discord/           # Slash commands (22+)
│   ├── src/telegram/          # Grammy bot (10+ commands)
│   ├── src/trigger/           # Scheduled tasks (7 cron jobs)
│   └── drizzle/               # Database migrations
├── apps/
│   ├── gateway/               # Rust/Axum Discord gateway proxy (multi-shard)
│   ├── ingestor/              # Event ingestion service
│   └── worker/                # Background job worker (NATS + RabbitMQ)
├── infrastructure/
│   └── terraform/             # AWS ECS deployment (20 modules)
├── evals/                     # Evaluation framework + test suites
└── docs/                      # Developer documentation
```

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
| [INSTALLATION.md](INSTALLATION.md) | Operators | Setup, deployment, and configuration guide |
| [docs/ECOSYSTEM.md](docs/ECOSYSTEM.md) | Everyone | 5-repo ecosystem map with layer diagram |
| [docs/API-QUICKSTART.md](docs/API-QUICKSTART.md) | Developers | First agent call in 5 minutes |
| [docs/API-REFERENCE.md](docs/API-REFERENCE.md) | Developers | Full API reference (stable + unstable tiers) |
| [docs/INFRASTRUCTURE.md](docs/INFRASTRUCTURE.md) | Operators | Terraform topology, modules, staging guide |
| [docs/CLI.md](docs/CLI.md) | Developers | gaib CLI reference |
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
3. Commit with conventional commit messages
4. Push and open a Pull Request

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

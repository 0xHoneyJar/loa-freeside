# Directory Structure

> Generated: 2026-02-13 | Git SHA: 39be5b7

```
arrakis/
├── packages/                    # Monorepo workspace packages
│   ├── core/                    # Domain models + port interfaces
│   │   ├── domain/              # Entity types (wizard, coexistence, tiers, migration)
│   │   └── ports/               # Interface contracts (13 ports)
│   ├── adapters/                # Concrete implementations
│   │   ├── agent/               # Agent gateway (budget, auth, JWT, BYOK, rate limiting)
│   │   ├── chain/               # Blockchain providers (RPC, Dune Sim, hybrid)
│   │   ├── coexistence/         # Shadow system (feature gate, migration, parallel mode)
│   │   ├── storage/             # Drizzle ORM + PostgreSQL + RLS
│   │   ├── security/            # Vault, MFA, wallet verification, kill switch
│   │   ├── synthesis/           # Discord manifest execution engine
│   │   ├── themes/              # Theme registry + badge evaluators
│   │   └── wizard/              # 8-step onboarding wizard engine
│   ├── cli/                     # Gaib CLI (auth, user, sandbox, server IaC)
│   └── sandbox/                 # QA sandbox isolation
├── themes/sietch/               # Main Discord bot application
│   ├── src/
│   │   ├── index.ts             # Entry point
│   │   ├── config.ts            # Zod env validation (1,737 lines)
│   │   ├── api/                 # Express REST API (80+ routes)
│   │   ├── discord/             # Discord.js bot (commands, events, interactions)
│   │   ├── telegram/            # Grammy Telegram bot
│   │   ├── services/            # Business logic layer
│   │   ├── jobs/                # Background job handlers
│   │   ├── trigger/             # Trigger.dev scheduled tasks (7 tasks)
│   │   └── packages/            # Logger, metrics, errors
│   └── drizzle/                 # Database migrations
├── apps/
│   ├── gateway/                 # Rust Discord gateway (Axum, sharding)
│   └── ingestor/                # Event ingestion to RabbitMQ
├── infrastructure/
│   ├── terraform/               # AWS IaC (ECS, RDS, ElastiCache, ALB, VPC)
│   └── observability/           # Prometheus, Grafana, Tempo
├── sites/
│   ├── docs/                    # Next.js documentation site
│   └── web/                     # Next.js marketing site
├── docker-compose.dev.yml       # Dev stack (sietch + postgres + redis)
├── Dockerfile.base              # Pre-built base image
├── Dockerfile.dev               # Dev container with hot-reload
└── Makefile                     # Build commands
```

## Dependency Graph

```
@arrakis/core (ports + domain)
    ↑
    ├── @arrakis/adapters (implementations)
    ├── @arrakis/sandbox (QA isolation)
    └── @arrakis/cli (gaib)
         ↓
    themes/sietch (application, depends on adapters + core)
```

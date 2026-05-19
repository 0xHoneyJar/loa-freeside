# loa-freeside Reality Index

> Generated: 2026-05-18 by /ride | Branch: feat/mature-freeside-operator
> Token-optimized routing hub. Use `/reality <topic>` to fetch specific files.

## Stats

- **Source files**: ~2,800+ TypeScript + Rust + Lua + SQL
- **Lines of code**: ~360K (themes/sietch 182K + apps 44K + packages 116K + infra/tests)
- **Workspace packages**: 10 (`packages/{adapters,auth-module,cli,core,gaib-cli,routes,sandbox,services,shared}` + `themes/sietch`)
- **Adapters**: 9 subdomains (agent, chain, coexistence, security, storage, synthesis, telemetry, themes, wizard)
- **API endpoints**: 80+ REST routes in sietch
- **Discord commands**: 20+ slash commands
- **Telegram commands**: present (grammy framework)
- **CLI commands**: 40+ subcommands (gaib)
- **Database tables**: 8 top-level in sietch schema + 12+ re-exported feature schemas
- **Drizzle migrations**: 30+ SQL files (latest: 0018_admin_audit_log.sql) + JS-format migrations
- **Tests**: 528 test files
- **Env vars**: 181+ unique (Zod-validated)
- **ADRs**: 8 in `decisions/`
- **Worlds in production**: 4 (rektdrop, mibera, apdao, score-api)

## Spokes

| Surface | File | Status |
|---------|------|--------|
| Structure | [structure.md](structure.md) | Required (regenerated 2026-05-18) |
| API surface | [api-surface.md](api-surface.md) | Required |
| Types | [types.md](types.md) | Required |
| Interfaces | [interfaces.md](interfaces.md) | Required |
| Entry points | [entry-points.md](entry-points.md) | Required |
| Architecture overview | [architecture-overview.md](architecture-overview.md) | Required |
| Hygiene flags | [hygiene-report.md](hygiene-report.md) | Required |
| Legacy reality (Feb 13) | [api.md](api.md), [services.md](services.md), [database.md](database.md), [commands.md](commands.md), [environment.md](environment.md), [triggers.md](triggers.md) | Preserved |

## Tech Stack

- **Runtime**: Node.js >=22 (root, sietch), Node.js >=20 (worker), Rust (gateway)
- **Language**: TypeScript (strict, ES modules), Rust 2021
- **Database**: PostgreSQL + Drizzle ORM + RLS; SQLite for sietch eligibility/world per-instance storage
- **Cache**: Redis 7 (ioredis), atomic Lua scripts for budget ops
- **Queue**: NATS (primary, Rust gateway → TS worker), RabbitMQ (legacy/coexistence), Trigger.dev (scheduled)
- **Discord**: discord.js (sietch), Twilight 0.17 (Rust gateway), @discordjs/rest (worker + cli)
- **Telegram**: Grammy
- **Blockchain**: viem 2.46, Dune Sim API, multi-tier hybrid provider
- **AI**: agent gateway with ensemble routing, BYOK support, ES256 JWT
- **Infrastructure**: Terraform on AWS (ECS, RDS, ElastiCache, ALB, EFS, S3, DynamoDB)
- **Observability**: Prometheus + Grafana + AWS embedded metrics + CloudWatch
- **Testing**: Vitest, fast-check (property), supertest (HTTP)

## Naming Surfaces (See consistency-report.md)

| Surface | Name |
|---------|------|
| Git repo | `loa-freeside` |
| npm namespace | `@arrakis/*` |
| Rust crate | `arrakis-gateway` |
| sietch service | `sietch-service` v6.0.0 |
| Platform / infra | "Freeside" |

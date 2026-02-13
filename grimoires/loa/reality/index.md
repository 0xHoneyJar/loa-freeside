# Arrakis Reality Index

> Generated: 2026-02-13 | Git SHA: 39be5b7 | Branch: main

## Stats

- **Source files:** ~2,795 TypeScript/Rust
- **Lines of code:** ~236K
- **Packages:** 4 workspace packages (core, adapters, cli, sandbox)
- **Services:** 40+ adapter services across 9 modules
- **API endpoints:** 80+ REST routes
- **Discord commands:** 22+ slash commands
- **Telegram commands:** 9 bot commands
- **CLI commands:** 40+ subcommands (gaib)
- **Database tables:** 5 (Drizzle ORM + PostgreSQL)
- **Scheduled tasks:** 7 (Trigger.dev)
- **Environment vars:** 100+ (Zod-validated)

## Spokes

| Surface | File | Status |
|---------|------|--------|
| Structure | [structure.md](structure.md) | Required |
| API | [api.md](api.md) | Required |
| Services | [services.md](services.md) | Required |
| Database | [database.md](database.md) | Required |
| Commands | [commands.md](commands.md) | Required |
| Environment | [environment.md](environment.md) | Required |
| Triggers | [triggers.md](triggers.md) | Optional |

## Tech Stack

- **Runtime:** Node.js 20, Rust (gateway)
- **Language:** TypeScript (strict), Rust
- **Database:** PostgreSQL 15 + Drizzle ORM + RLS
- **Cache:** Redis 7 (ioredis)
- **Queue:** BullMQ, Trigger.dev
- **Discord:** discord.js v14
- **Telegram:** Grammy
- **Blockchain:** viem, Dune Sim API
- **Infrastructure:** Terraform (AWS ECS), Docker

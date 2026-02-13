# Arrakis Ground Truth

> SHA: 39be5b7 | Generated: 2026-02-13

Multi-tenant community infrastructure platform. Discord/Telegram bots, conviction scoring, 9-tier BGT-based progression, agent gateway, CLI tooling.

## Stats

- **Packages:** core, adapters (9 modules), cli, sandbox
- **Tables:** 5 (communities, profiles, badges, community_agent_config, agent_usage_log)
- **API:** 80+ Express routes, 22 Discord commands, 9 Telegram commands, 40+ CLI subcommands
- **Scheduled:** 7 Trigger.dev cron tasks, 2 BullMQ jobs
- **Env vars:** 100+ (Zod-validated)

## Spokes

| Surface | File | Contents |
|---------|------|----------|
| API | [api-surface.md](api-surface.md) | REST routes, Discord/Telegram/CLI commands, webhooks |
| Architecture | [architecture.md](architecture.md) | Hexagonal ports/adapters, package structure, service graph |
| Contracts | [contracts.md](contracts.md) | DB schema, TypeScript types, Zod config, tier system |
| Behaviors | [behaviors.md](behaviors.md) | Cron tasks, event handlers, feature flags, RLS |

## Tech

Node.js 20 + TypeScript (strict), Rust (gateway), PostgreSQL 15 + Drizzle ORM + RLS, Redis 7, BullMQ, Trigger.dev, discord.js v14, Grammy, viem, Terraform (AWS ECS).

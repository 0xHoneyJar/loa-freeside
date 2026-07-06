# loa-freeside Ground Truth

> Refreshed: 2026-07-06 by /ride | supersedes 2026-02-13 (SHA 39be5b7)

**Freeside** — multi-community infra platform, now a **hexagonal federation**: in-repo L1 registry + incumbent monolith (`sietch-service`) + in-repo services, federating 8 external `*-api` cells.

## Stats

- **Packages:** 30 (18 `@freeside/*` platform + 3 `@0xhoneyjar/*` network + `sietch-service` + protocols). Namespace migrated `@arrakis/*` → `@freeside/*`.
- **Apps:** 5 (Rust gateway, worker, ingestor, mcp-gateway, operator-dash).
- **Cells:** 11 registered (`packages/freeside-registry/registry.yaml`); 8 canonical external; 7 deployed / 2 scaffolded / 2 not-built.
- **DB:** 9 PostgreSQL tables (Drizzle + RLS) + 8 legacy SQLite; 68 TS + 19 SQL migrations.
- **API:** 48 route modules (300+ endpoints), 23 Discord + 12 Telegram commands, 2 CLIs, 2 MCP tenants, 6 webhooks.
- **Scheduled:** 9 Trigger.dev tasks; 39 CI workflows. **Env:** 100+ (Zod). **Tests:** 200+ (Vitest + fast-check).

## Spokes

| Surface | File | Contents |
|---|---|---|
| API | [api-surface.md](api-surface.md) | REST, Discord/Telegram/CLI, MCP, webhooks |
| Architecture | [architecture.md](architecture.md) | Federation, hexagonal ports/adapters, WHO×WHAT + L0–L3 stack |
| Contracts | [contracts.md](contracts.md) | DB schema, ports, tier system, beacon/registry/event schemas |
| Behaviors | [behaviors.md](behaviors.md) | Cron, event handlers, feature flags, RLS, cluster auth |

## Tech

Node ≥22 + TS 5.3–5.7 (strict, ESM), Rust 2021. PostgreSQL + Drizzle + RLS, SQLite (sietch v1), Redis 7. NATS JetStream + RabbitMQ + Trigger.dev. Express 5 / Hono. discord.js + Grammy, viem + Dune Sim. Effect + Zod + Ajv. Terraform/AWS ECS. pnpm@9.15.4.

## Live truth

Reality is a snapshot; for cell runtime state probe `packages/freeside-registry/registry.yaml` + `freeside-cli doctor --remote`. `*.0xhoneyjar.xyz` beacon subdomains 404 cluster-wide (DNS gap).

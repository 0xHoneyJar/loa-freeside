# loa-freeside Ground Truth

> Refreshed: 2026-07-19 by /ride --ground-truth (HEAD b5df718a) | supersedes 2026-07-06 (SHA 9b0f4a12)

**Freeside** — multi-community infra platform, a **hexagonal federation**: in-repo L1 registry + incumbent monolith (`sietch-service` v6.0.0 — frozen: 2 files changed in the 287-commit delta) + in-repo services, federating external `*-api` cells.

## Stats

- **Packages:** 30 workspace package.json (25 `@freeside/*` platform + 3 `@0xhoneyjar/*` network + `sietch-service` + dashboard) + 1 Rust crate (`arrakis-gateway`).
- **Protocol packages:** **10** under `packages/protocol/` (was 4 on 07-06) — 6 NEW v1.0.0 from the collection-report cycle; + NEW `@freeside/collection-report-gates` (CR-019).
- **Apps:** 5 (Rust gateway, worker, ingestor, mcp-gateway, operator-dash).
- **Cells:** 11 registered (`packages/freeside-registry/registry.yaml`); 7 deployed — incl. in-repo `ordering`, newly registered — / 2 scaffolded / 2 not-built.
- **DB:** 9 PostgreSQL tables (Drizzle + RLS) + 10 sietch pgTable + 8 legacy SQLite; 68 TS + 19 SQL migrations.
- **API:** 48 sietch route modules (300+ endpoints) + 130 Hono route registrations across in-repo services; 23 Discord + 12 Telegram commands; 2 CLIs; 2 MCP tenants; 6 webhooks; 6 package bins.
- **Scheduled:** 9 Trigger.dev tasks; 40 CI workflows. **Env:** 334 `process.env` refs (Zod core). **Tests:** 620 files (Vitest 3.2.4 + fast-check). **Tags:** 369, latest `v7.77.0`.

## Spokes

| Surface | File | Contents |
|---|---|---|
| API | [api-surface.md](api-surface.md) | REST, Discord/Telegram/CLI, MCP, webhooks |
| Architecture | [architecture.md](architecture.md) | Federation, hexagonal ports/adapters, WHO×WHAT + L0–L3 stack |
| Contracts | [contracts.md](contracts.md) | DB schema, ports, tier system, beacon/registry/protocol/event schemas |
| Behaviors | [behaviors.md](behaviors.md) | Cron, event handlers, feature flags, RLS, cluster auth |

## Tech

Node ≥22 + TS 5.3–5.7 (strict, ESM), Rust 2021. PostgreSQL + Drizzle + RLS, SQLite (sietch v1), Redis 7. NATS JetStream + RabbitMQ + Trigger.dev. Express 5 / Hono. discord.js + Grammy, viem + Dune Sim. Effect + Zod + Ajv. Terraform/AWS ECS. pnpm@9.15.4.

## Live truth

Reality is a snapshot; for cell runtime state probe `packages/freeside-registry/registry.yaml` + `freeside-cli doctor --remote`. `*.0xhoneyjar.xyz` beacon subdomains 404 cluster-wide as of last probe 2026-06-19 (DNS gap).

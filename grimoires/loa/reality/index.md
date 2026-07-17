---
source_type: ai-autogen
use_label: usable
read_state: read
as_of: 2026-07-06
generated_by: /ride reality+ground-truth refresh
supersedes:
  previous_generated_at: 2026-05-18
  previous_status: CORPSE (monolith capture, quarantined by governance-doctor.sh)
note: >-
  Refreshed to current federation truth. For LIVE cell runtime state, still probe
  packages/freeside-registry/registry.yaml + `freeside-cli doctor --remote`.
---

# loa-freeside Reality Index

> Generated 2026-07-06 by /ride | Branch: feat/spiral-spiral-20260706-359e28-cycle-1
> Token-optimized routing hub. A **dual-concern hexagonal federation** (ADR-007/009).

## Stats (current)

- **Workspace packages**: 30 package.json — **18 `@freeside/*`** (platform) + **3 `@0xhoneyjar/*`** (network) + `sietch-service` + protocol/theme pkgs
- **Namespace**: migrated **`@arrakis/*` → `@freeside/*`** (0 `@arrakis` refs remain) — AGENTS.md still stale
- **Apps**: 5 — gateway (Rust `arrakis-gateway`), worker, ingestor, mcp-gateway, freeside-operator-dash
- **Incumbent monolith**: `themes/sietch` `sietch-service` v6.0.0
- **Federation cells**: 11 registered (`packages/freeside-registry/registry.yaml`); 8 canonical `*-api` external; 7 deployed / 2 scaffolded / 2 not-built (probe 2026-06-19)
- **REST**: 48 route modules → 300+ endpoints (sietch) + in-repo Hono services + `/federation.json`
- **Discord**: 23 commands · **Telegram**: 12 (Grammy) · **CLIs**: 2 (freeside-cli 6 verbs, gaib 4 groups) · **MCP**: 2 tenants
- **DB**: 9 PostgreSQL tables (Drizzle, RLS) + 8 legacy SQLite tables · migrations: 68 TS + 19 SQL (latest `0018_admin_audit_log.sql`)
- **Env vars**: 100+ (Zod, `themes/sietch/src/config.ts` ~1850 lines) · **Feature flags**: 9
- **Scheduled**: 9 Trigger.dev tasks · **CI**: 39 GitHub Actions workflows
- **Tests**: 200+ files (Vitest 3.2.4 + fast-check) · **Debt**: 36+ TODO, 27 `@ts-nocheck`
- **ADRs**: root `decisions/` (federation 007/009/012) + `grimoires/loa/decisions/` (billing 008–015)

## Spokes

| Surface | File | Status |
|---|---|---|
| Structure & workspace | [structure.md](structure.md) | Refreshed 2026-07-06 |
| Architecture overview | [architecture-overview.md](architecture-overview.md) | Refreshed 2026-07-06 |
| API & command surface | [api-surface.md](api-surface.md) | Refreshed 2026-07-06 |
| Types, models & contracts | [types.md](types.md) | Refreshed 2026-07-06 |
| Entry points & behaviors | [entry-points.md](entry-points.md) | Refreshed 2026-07-06 |
| Hygiene flags (Phase 2b) | [hygiene-report.md](hygiene-report.md) | Refreshed 2026-07-06 |
| Three-way drift | ../drift-report.md | Local analysis (gitignored; regenerate via /ride, summarized in NOTES.md) |
| Legacy (Feb–May) | api.md, services.md, database.md, commands.md, environment.md, triggers.md, interfaces.md | Preserved (older) |

## Tech Stack

- **Runtime**: Node ≥22, Rust 2021. **Lang**: TypeScript 5.3–5.7 (strict, ESM).
- **HTTP**: Express 5 (sietch), Hono (services + mcp-gateway), Twilight (Rust gateway).
- **DB**: PostgreSQL + Drizzle + RLS; SQLite (sietch v1). **Cache**: Redis 7 (Lua atomic).
- **Messaging**: NATS JetStream (primary), RabbitMQ (ingestor), Trigger.dev (cron).
- **Chat**: discord.js, Grammy. **Chain**: viem, Dune Sim (hybrid provider).
- **Schema**: Effect Schema (registry/beacon) + Zod (config/wire) + Ajv. **Infra**: Terraform/AWS ECS. **Test**: Vitest + fast-check.

## Naming Surfaces

| Surface | Name |
|---|---|
| Git repo | `loa-freeside` |
| npm — platform | `@freeside/*` (was `@arrakis/*`) |
| npm — network | `@0xhoneyjar/*` |
| Rust crate | `arrakis-gateway` |
| Incumbent service | `sietch-service` v6.0.0 |
| Platform / infra | "Freeside" |

## Live truth

Reality docs are a snapshot. For cell runtime state, probe:
`packages/freeside-registry/registry.yaml` + `freeside-cli doctor --remote`.

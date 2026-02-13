# Arrakis — BUTTERFREEZONE

<!-- AGENT-CONTEXT: name=arrakis, type=overview, purpose=Multi-tenant engagement intelligence for Web3 communities, key_files=[themes/sietch/src/api/server.ts, packages/core/ports/index.ts, packages/adapters/agent/agent-gateway.ts, packages/adapters/storage/drizzle-storage-adapter.ts], interfaces=[IChainProvider, IStorageProvider, IAgentGateway, ISynthesisEngine, IWizardEngine], dependencies=[discord.js, grammy, drizzle-orm, ioredis, bullmq, viem], trust_level=low, model_hints=[fast,summary] -->

> SHA: 39be5b7 | Generated: 2026-02-13

Multi-tenant community infrastructure for Discord and Telegram — conviction scoring, 9-tier progression (2 rank-based + 7 BGT-based), agent gateway, CLI tooling (src: packages/core/ports/index.ts:L1). Hexagonal architecture (ports & adapters) with PostgreSQL + RLS multi-tenancy (src: packages/adapters/storage/tenant-context.ts:L120).

## Project Overview

Monorepo: 4 workspace packages, ~236K LoC TypeScript + Rust (src: packages/core/ports/index.ts:L1).

| Package | Purpose | Entry |
|---------|---------|-------|
| core | Port interfaces (15 files) + domain types | (src: packages/core/ports/index.ts:L1) |
| adapters | 8 modules implementing core ports | (src: packages/adapters/agent/index.ts:L1) |
| cli | Gaib CLI: auth, user, sandbox, server IaC | (src: packages/cli/src/commands/index.ts:L24) |
| sandbox | Schema provisioning, event routing, cleanup | (src: packages/adapters/storage/schema.ts:L47) |

Application entry: `startServer()` (src: themes/sietch/src/api/server.ts:L556).

## Architecture (Summary)

Hexagonal pattern: ports in `packages/core/ports/`, adapters in `packages/adapters/` (src: packages/core/ports/index.ts:L1).

| Port | Adapter | Ref |
|------|---------|-----|
| IChainProvider | NativeBlockchainReader / HybridChainProvider | (src: packages/core/ports/chain-provider.ts:L144) |
| IStorageProvider | DrizzleStorageAdapter (PostgreSQL + RLS) | (src: packages/core/ports/storage-provider.ts:L203) |
| IAgentGateway | AgentGateway (budget + rate limiting + streaming) | (src: packages/core/ports/agent-gateway.ts:L181) |
| ISynthesisEngine | SynthesisEngine (BullMQ for Discord API) | (src: packages/core/ports/synthesis-engine.ts:L242) |
| IWizardEngine | WizardEngine (8-step onboarding) | (src: packages/core/ports/wizard-engine.ts:L199) |

Chain provider modes: `rpc` (default), `dune_sim`, `hybrid` — factory at (src: packages/adapters/chain/provider-factory.ts:L103).
DI pattern: constructors receive typed interfaces (src: packages/adapters/agent/agent-gateway.ts:L79).

## API Surface (Index)

**REST:** 80+ Express routes — public `/`, member `/api`, billing `/api/billing`, admin `/admin` (src: themes/sietch/src/api/server.ts:L242).
**Webhooks:** Paddle, NOWPayments, Telegram — all signature-verified (src: themes/sietch/src/api/billing.routes.ts:L438).
**Discord:** 22+ slash commands — registry at (src: themes/sietch/src/discord/commands/index.ts:L30).
**Telegram:** 10 commands via Grammy — registration at (src: themes/sietch/src/telegram/commands/index.ts:L23).
**CLI:** `gaib auth|user|sandbox|server` — 40+ subcommands (src: packages/cli/src/commands/index.ts:L24).
See [api-surface.md](grimoires/loa/ground-truth/api-surface.md) for full route map and handler references (src: themes/sietch/src/api/routes/index.ts:L26).

## Types & Contracts (Index)

**Database:** 5 tables via Drizzle ORM — communities, profiles, badges, community_agent_config, agent_usage_log (src: packages/adapters/storage/schema.ts:L47).
**Core types:** Community (src: packages/core/ports/storage-provider.ts:L25), Profile (src: packages/core/ports/storage-provider.ts:L57), Badge (src: packages/core/ports/storage-provider.ts:L109).
**Tier system:** 9 tiers (Naib, Fedaykin rank-based + Usul→Hajra BGT-based) with rank boundaries (src: themes/sietch/src/packages/adapters/themes/SietchTheme.ts:L47).
**Agent types:** ModelAlias (cheap/fast-code/reviewer/reasoning/native), AccessLevel (free/pro/enterprise) (src: packages/core/ports/agent-gateway.ts:L24).
**RLS:** All tenant tables scoped by `app.current_tenant` (src: packages/adapters/storage/tenant-context.ts:L120).
See [contracts.md](grimoires/loa/ground-truth/contracts.md) for full schema, type definitions, and Zod validation (src: packages/adapters/storage/schema.ts:L47).

## Configuration

Zod schema: 1,736 lines at (src: themes/sietch/src/config.ts:L120). Feature flags at (src: themes/sietch/src/config.ts:L217).

| Category | Key Variables | Ref |
|----------|--------------|-----|
| Required | DISCORD_BOT_TOKEN, DISCORD_GUILD_ID, DATABASE_URL, BERACHAIN_RPC_URLS, BGT_ADDRESS | (src: themes/sietch/src/config.ts:L120) |
| Feature Flags | FEATURE_BILLING_ENABLED, FEATURE_REDIS_ENABLED, FEATURE_TELEGRAM_ENABLED + 4 more | (src: themes/sietch/src/config.ts:L217) |
| Chain Provider | CHAIN_PROVIDER (rpc/dune_sim/hybrid), DUNE_SIM_API_KEY | (src: packages/adapters/chain/config.ts:L98) |
| Conditional | API_KEY_PEPPER (prod), PADDLE_WEBHOOK_SECRET (billing), VAULT_ADDR (vault) | (src: themes/sietch/src/config.ts:L120) |

See [behaviors.md](grimoires/loa/ground-truth/behaviors.md) for env var details and feature flag behavior (src: themes/sietch/src/config.ts:L505).

## Behaviors (Index)

**Scheduled:** 7 Trigger.dev cron tasks + 1 on-demand migration task — eligibility sync (6h), activity decay (6h), weekly digest, badge check, boost expiry, weekly reset, session cleanup (src: themes/sietch/src/trigger/syncEligibility.ts:L41).
**Events:** Discord ready/interactionCreate/guildMemberUpdate/messageCreate/messageReactionAdd (src: themes/sietch/src/services/discord/handlers/EventHandler.ts:L44).
**Jobs:** BudgetReaperJob (60s), StreamReconciliationWorker (on-demand) via BullMQ (src: packages/adapters/agent/budget-reaper-job.ts:L46).
See [behaviors.md](grimoires/loa/ground-truth/behaviors.md) for cron schedules, handler details, and lifecycle flows (src: packages/adapters/agent/agent-gateway.ts:L65).

## Navigation

See [ground-truth/index.md](grimoires/loa/ground-truth/index.md) for spoke overview. Spokes: [api-surface](grimoires/loa/ground-truth/api-surface.md), [architecture](grimoires/loa/ground-truth/architecture.md), [contracts](grimoires/loa/ground-truth/contracts.md), [behaviors](grimoires/loa/ground-truth/behaviors.md). Source checksums: [checksums.json](grimoires/loa/ground-truth/checksums.json).

SHA: `39be5b729639791cbc9cb9cd8347c6f516095ea3` | Generated: 2026-02-13T14:00:00Z (src: packages/core/ports/index.ts:L1)

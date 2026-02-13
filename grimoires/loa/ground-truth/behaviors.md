# Behaviors

> SHA: 39be5b7 | Generated: 2026-02-13

## Trigger.dev Scheduled Tasks

| Task | Cron | Description | Ref |
|------|------|-------------|-----|
| sync-eligibility | `0 */6 * * *` | Syncs BGT eligibility via RLS proxy | (src: themes/sietch/src/trigger/syncEligibility.ts:L41) |
| activity-decay | `30 */6 * * *` | 10% demurrage decay (30min offset from sync) | (src: themes/sietch/src/trigger/activityDecay.ts:L19) |
| weekly-digest | `0 0 * * 1` | Posts community digest to Discord (Monday 00:00) | (src: themes/sietch/src/trigger/weeklyDigest.ts:L23) |
| boost-expiry | `5 0 * * *` | Deactivates expired boosts (daily 00:05) | (src: themes/sietch/src/trigger/boostExpiry.ts:L18) |
| badge-check | `0 0 * * *` | Awards automatic badges — tenure, activity | (src: themes/sietch/src/trigger/badgeCheck.ts:L20) |
| weekly-reset | `0 0 * * 1` | Resets weekly notification counters (Monday) | (src: themes/sietch/src/trigger/weeklyReset.ts:L18) |
| session-cleanup | `15 * * * *` | Cleans expired Telegram verification sessions | (src: themes/sietch/src/trigger/sessionCleanup.ts:L19) |

## Discord Event Handlers

| Event | Behavior | Ref |
|-------|----------|-----|
| ready | Fetches guild, caches it, registers slash commands, sets isReady | (src: themes/sietch/src/services/discord/handlers/EventHandler.ts:L44) |
| interactionCreate | Routes: ChatInput→slash, Button→button, Modal→modal, Select→select | (src: themes/sietch/src/services/discord/handlers/InteractionHandler.ts:L50) |
| guildMemberUpdate | Detects Naib/Fedaykin role additions, triggers auto-onboarding | (src: themes/sietch/src/services/discord/handlers/EventHandler.ts:L88) |
| messageCreate | Ignores bots, checks guild+onboarding, records activity via recordMessage() | (src: themes/sietch/src/services/discord/handlers/EventHandler.ts:L102) |
| messageReactionAdd | Records both reactionGiven and reactionReceived points | (src: themes/sietch/src/services/discord/handlers/EventHandler.ts:L107) |

## BullMQ Jobs

| Job | Schedule | Config | Ref |
|-----|----------|--------|-----|
| BudgetReaperJob | Every 60s (repeat) | 10s timeout/community, 50% circuit breaker | (src: packages/adapters/agent/budget-reaper-job.ts:L46) |
| StreamReconciliationWorker | On-demand (queue) | 30s usage query timeout, 10s finalize timeout | (src: packages/adapters/agent/stream-reconciliation-worker.ts:L47) |

Reaper config at (src: packages/adapters/agent/budget-reaper-job.ts:L141).

## Chain Provider Mode Switching

Config loader reads `CHAIN_PROVIDER` env var (src: packages/adapters/chain/config.ts:L98). Factory switches on mode (src: packages/adapters/chain/provider-factory.ts:L103):

| Mode | Provider | Behavior | Ref |
|------|----------|----------|-----|
| `rpc` (default) | NativeBlockchainReader | Direct viem RPC | (src: packages/adapters/chain/provider-factory.ts:L127) |
| `dune_sim` | DuneSimClient | Dune Sim API only | (src: packages/adapters/chain/provider-factory.ts:L108) |
| `hybrid` | HybridChainProvider | Dune Sim + RPC fallback | (src: packages/adapters/chain/provider-factory.ts:L116) |

## Feature Flags

Schema at (src: themes/sietch/src/config.ts:L217). Runtime parsing at (src: themes/sietch/src/config.ts:L505).

| Flag | Env Var | Default | Ref |
|------|---------|---------|-----|
| billingEnabled | FEATURE_BILLING_ENABLED | false | (src: themes/sietch/src/config.ts:L217) |
| gatekeeperEnabled | FEATURE_GATEKEEPER_ENABLED | false | (src: themes/sietch/src/config.ts:L217) |
| redisEnabled | FEATURE_REDIS_ENABLED | false | (src: themes/sietch/src/config.ts:L217) |
| telegramEnabled | FEATURE_TELEGRAM_ENABLED | false | (src: themes/sietch/src/config.ts:L217) |
| vaultEnabled | FEATURE_VAULT_ENABLED | false | (src: themes/sietch/src/config.ts:L217) |
| gatewayProxyEnabled | USE_GATEWAY_PROXY | false | (src: themes/sietch/src/config.ts:L217) |
| cryptoPaymentsEnabled | FEATURE_CRYPTO_PAYMENTS_ENABLED | false | (src: themes/sietch/src/config.ts:L217) |

## Required Environment Variables

Validated at startup (src: themes/sietch/src/config.ts:L893):

| Variable | Service | Ref |
|----------|---------|-----|
| DISCORD_BOT_TOKEN | Sietch — Discord bot token | (src: themes/sietch/src/config.ts:L120) |
| DISCORD_GUILD_ID | Sietch — Discord server ID | (src: themes/sietch/src/config.ts:L120) |
| BERACHAIN_RPC_URLS | Sietch — Comma-separated RPC URLs | (src: themes/sietch/src/config.ts:L122) |
| BGT_ADDRESS | Sietch — BGT token contract | (src: themes/sietch/src/config.ts:L122) |
| TRIGGER_PROJECT_ID | Sietch — Trigger.dev project ID | (src: themes/sietch/src/config.ts:L120) |
| DATABASE_URL | Sietch (prod) — PostgreSQL URL | (src: themes/sietch/src/config.ts:L120) |

Conditional: API_KEY_PEPPER (production, min 32 chars), PADDLE_WEBHOOK_SECRET (billing), NOWPAYMENTS_API_KEY (crypto), VAULT_ADDR/VAULT_TOKEN (vault) (src: themes/sietch/src/config.ts:L120).

## Multi-Tenancy (RLS)

All queries scoped by `app.current_tenant` session variable (src: packages/adapters/storage/tenant-context.ts:L120). Set: `setTenant(tenantId)` → `SELECT set_tenant_context(...)` (src: packages/adapters/storage/tenant-context.ts:L132). Clear: `clearTenant()` (src: packages/adapters/storage/tenant-context.ts:L146). Scoped: `withTenant<T>(tenantId, fn)` (src: packages/adapters/storage/tenant-context.ts:L198).

## Agent Request Lifecycle

AgentGateway orchestrates RECEIVED→RESERVED→EXECUTING→FINALIZED (src: packages/adapters/agent/agent-gateway.ts:L65). BudgetManager.reserve() does atomic Lua two-counter check (src: packages/adapters/agent/budget-manager.ts:L89). BudgetReaperJob reclaims expired reservations every 60s (src: packages/adapters/agent/budget-reaper-job.ts:L141).

## Synthesis Engine (Discord API)

BullMQ queue for Discord operations (src: packages/adapters/synthesis/engine.ts:L156). Job types: create_role, delete_role, assign_role, remove_role, create_channel, delete_channel, update_permissions (src: packages/core/ports/synthesis-engine.ts:L23). Token bucket: max 50, refill 50/sec (src: packages/core/ports/synthesis-engine.ts:L425). Queue: 3 retries, exponential backoff, 5 concurrency (src: packages/core/ports/synthesis-engine.ts:L401).

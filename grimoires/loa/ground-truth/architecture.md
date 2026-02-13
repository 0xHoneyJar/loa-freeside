# Architecture

> SHA: 39be5b7 | Generated: 2026-02-13

## Hexagonal (Ports & Adapters)

Core defines interfaces in `packages/core/ports/` (src: packages/core/ports/index.ts:L1). Adapters implement them in `packages/adapters/`. Dependencies flow inward: adapters→core, never reverse.

### Port → Adapter Map

| Port | Port Location | Adapter | Adapter Location |
|------|--------------|---------|-----------------|
| IChainProvider | (src: packages/core/ports/chain-provider.ts:L144) | NativeBlockchainReader | (src: packages/adapters/chain/native-reader.ts:L185) |
| IChainProvider | (src: packages/core/ports/chain-provider.ts:L144) | HybridChainProvider | (src: packages/adapters/chain/hybrid-provider.ts) |
| IChainProvider | (src: packages/core/ports/chain-provider.ts:L144) | TwoTierChainProvider | (src: packages/adapters/chain/two-tier-provider.ts) |
| IStorageProvider | (src: packages/core/ports/storage-provider.ts:L203) | DrizzleStorageAdapter | (src: packages/adapters/storage/drizzle-storage-adapter.ts:L69) |
| IAgentGateway | (src: packages/core/ports/agent-gateway.ts:L181) | AgentGateway | (src: packages/adapters/agent/agent-gateway.ts:L65) |
| ISynthesisEngine | (src: packages/core/ports/synthesis-engine.ts:L242) | SynthesisEngine | (src: packages/adapters/synthesis/engine.ts:L156) |
| IWizardEngine | (src: packages/core/ports/wizard-engine.ts:L199) | WizardEngine | (src: packages/adapters/wizard/engine.ts:L84) |
| IShadowLedger | (src: packages/core/ports/shadow-ledger.ts) | ScyllaDBShadowLedger | (src: packages/adapters/coexistence/shadow-ledger.ts) |
| IFeatureGate | (src: packages/core/ports/feature-gate.ts) | FeatureGate | (src: packages/adapters/coexistence/feature-gate.ts) |

### Package Structure

Monorepo with 4 workspace packages (src: packages/core/ports/index.ts:L1):

| Package | Contents | Ref |
|---------|----------|-----|
| core/ports/ | 12 port interface files | (src: packages/core/ports/index.ts:L1) |
| adapters/agent/ | AgentGateway, BudgetManager, rate limiting, BYOK | (src: packages/adapters/agent/index.ts:L1) |
| adapters/chain/ | RPC, Dune Sim, hybrid, two-tier provider | (src: packages/adapters/chain/index.ts:L1) |
| adapters/storage/ | Drizzle ORM + PostgreSQL + RLS | (src: packages/adapters/storage/index.ts:L1) |
| adapters/synthesis/ | BullMQ job processor for Discord API | (src: packages/adapters/synthesis/engine.ts:L156) |
| adapters/wizard/ | 8-step onboarding orchestrator | (src: packages/adapters/wizard/engine.ts:L84) |
| adapters/themes/ | ThemeRegistry, BasicTheme, SietchTheme | (src: packages/adapters/themes/theme-registry.ts:L96) |
| adapters/security/ | Vault, KillSwitch, MFA, wallet verification | (src: packages/adapters/coexistence/shadow-ledger.ts) |
| adapters/coexistence/ | Shadow mode, parallel mode, migration | (src: packages/adapters/coexistence/feature-gate.ts) |
| cli/ | Auth, user, sandbox, server IaC commands | (src: packages/cli/src/commands/index.ts:L24) |

### Key Services

| Service | Responsibilities | Ref |
|---------|-----------------|-----|
| AgentGateway | Request lifecycle: RECEIVED→RESERVED→EXECUTING→FINALIZED | (src: packages/adapters/agent/agent-gateway.ts:L65) |
| BudgetManager | Two-counter (committed+reserved), Lua atomicity | (src: packages/adapters/agent/budget-manager.ts:L89) |
| BudgetReaperJob | Reclaims expired reservations every 60s | (src: packages/adapters/agent/budget-reaper-job.ts:L46) |
| StreamReconciliation | Finalizes dropped SSE streams | (src: packages/adapters/agent/stream-reconciliation-worker.ts:L47) |
| ThemeRegistry | Theme registration, tier filtering, hot-reload | (src: packages/adapters/themes/theme-registry.ts:L96) |
| TenantContext | Multi-tenancy RLS via set_tenant_context() | (src: packages/adapters/storage/tenant-context.ts:L120) |

### Dependency Injection

AgentGateway ← BudgetManager, AgentRateLimiter, LoaFinnClient, TierAccessMapper, Redis, Logger (src: packages/adapters/agent/agent-gateway.ts:L79).
DrizzleStorageAdapter ← PostgresJsDatabase, postgres.Sql, tenantId, options (src: packages/adapters/storage/drizzle-storage-adapter.ts:L84).
WizardEngine ← sessionStore, synthesisEngine, stepHandlers, analyticsRedis, logger (src: packages/adapters/wizard/engine.ts:L92).

### Chain Provider Modes

Factory: `createChainProvider(logger)` (src: packages/adapters/chain/provider-factory.ts:L103). Config: `loadChainProviderConfig()` (src: packages/adapters/chain/config.ts:L98).

| Mode | Provider | Ref |
|------|----------|-----|
| `rpc` (default) | NativeBlockchainReader — direct viem RPC | (src: packages/adapters/chain/provider-factory.ts:L127) |
| `dune_sim` | DuneSimClient — Dune Sim API only | (src: packages/adapters/chain/provider-factory.ts:L108) |
| `hybrid` | HybridChainProvider — Dune Sim + RPC fallback | (src: packages/adapters/chain/provider-factory.ts:L116) |

### Application Entry

Main: `await startServer()` (src: themes/sietch/src/index.ts:L22). Server module: (src: themes/sietch/src/api/index.ts:L5).

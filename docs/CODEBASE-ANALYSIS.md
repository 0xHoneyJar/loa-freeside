# Arrakis Codebase Analysis Report

> Generated: 2026-02-04
> Commit: 3212b41 (chore: remove simstim telegram bridge)
> Branch: chore/remove-simstim-bridge

## Project Overview

**Project**: Arrakis - Blockchain-based onboarding and verification system for Web3 communities
**Status**: Active development (Cycle 008 - Stillsuit Rapid Development Flow)

---

## Technology Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js + TypeScript |
| Framework | Express.js (Discord bot) |
| Database | PostgreSQL + Drizzle ORM |
| Cache | Redis |
| Container | Docker + Docker Compose |
| API Integration | Dune Sim API, Score Service gRPC |
| Messaging | Discord API, Telegram API |

---

## Package Structure

| Package | Purpose |
|---------|---------|
| `packages/core` | Domain models & ports (interfaces) |
| `packages/adapters` | External integrations (chain, security, storage, themes) |
| `packages/cli` | Command-line interface |
| `packages/sandbox` | Testing/experimentation |
| `themes/sietch` | Primary Discord bot application |
| `apps/gateway` | API gateway microservice |
| `apps/worker` | Background job processor |
| `apps/ingestor` | Data ingestion service |
| `sites/web` | Public website |
| `sites/docs` | Documentation site |

---

## Chain Provider Architecture

The chain provider system (`packages/adapters/chain/`) supports three modes:

### Provider Modes

| Mode | File | Description |
|------|------|-------------|
| `rpc` | `native-reader.ts` | Direct RPC calls via viem. No API key required. Default fallback. |
| `dune_sim` | `dune-sim-client.ts` | Dune Sim API exclusively. Requires `DUNE_SIM_API_KEY`. |
| `hybrid` | `hybrid-provider.ts` | Dune Sim with RPC fallback. Production recommended. |

### Environment Variables

```bash
# Provider mode selection (default: rpc)
CHAIN_PROVIDER=hybrid  # Options: rpc, dune_sim, hybrid

# Dune Sim API key (required for dune_sim/hybrid modes)
DUNE_SIM_API_KEY=your_api_key

# RPC fallback settings (hybrid mode only)
CHAIN_PROVIDER_FALLBACK_ENABLED=true

# Chains that should always use RPC (comma-separated)
CHAIN_PROVIDER_RPC_ONLY_CHAINS=80094
```

### IChainProvider Interface

Core port defined at `packages/core/ports/chain-provider.ts`

**Tier 1 Methods** (Always Available):
- `hasBalance(chainId, address, token, minAmount): Promise<boolean>`
- `ownsNFT(chainId, address, collection, tokenId?): Promise<boolean>`
- `getBalance(chainId, address, token): Promise<bigint>`
- `getNativeBalance(chainId, address): Promise<bigint>`

**Tier 2 Methods** (May Be Unavailable):
- `getRankedHolders(asset, limit, offset): Promise<RankedHolder[]>`
- `getAddressRank(address, asset): Promise<number | null>`
- `checkActionHistory(address, config): Promise<boolean>`
- `getCrossChainScore(address, chains): Promise<CrossChainScore>`
- `isScoreServiceAvailable(): Promise<boolean>`

**Optional Methods** (Dune Sim Exclusive):
- `getBalanceWithUSD()` - Balance with USD pricing
- `getCollectibles()` - NFT enumeration with spam filtering
- `getActivity()` - Transaction history with categorization

### Supported Chains

| Chain | Chain ID |
|-------|----------|
| Berachain | 80094 |
| Ethereum | 1 |
| Polygon | 137 |
| Arbitrum One | 42161 |
| Base | 8453 |

---

## Core Domain Models

Located in `packages/core/domain/`:

| File | Purpose |
|------|---------|
| `coexistence.ts` | Parallel execution modes |
| `parallel-mode.ts` | Parallel feature gate logic |
| `verification-tiers.ts` | Multi-tier verification system |
| `wizard.ts` | Onboarding wizard state machine |
| `glimpse-mode.ts` | Lightweight preview mode |
| `migration.ts` | Schema/data migration logic |

---

## Theme System

Adapter-based theme implementation in `packages/adapters/themes/`:

- Core interface: `IThemeProvider` port
- Theme implementations: `BasicTheme`, `SietchTheme`
- Badge evaluator system: `BadgeEvaluator`, `ThemeRegistry`

---

## API Surface

### Discord Integration (Primary)

Location: `themes/sietch/src/discord/`

**Commands**:
- `/badges` - View and claim badges
- `/stats` - Community statistics
- `/profile` - User profile display
- `/admin-badge` - Admin badge management
- `/admin-water-share` - Admin water share management

**Embeds**: Badge display, profile, alerts, stats, directory, threshold

**Interactions**: Onboarding flow, alert management

### Telegram Integration (Secondary)

Location: `themes/sietch/src/telegram/`

**Commands**:
- `/score` - Check score
- `/refresh` - Refresh data
- `/status` - Connection status
- `/unlink` - Unlink account
- `/leaderboard` - View leaderboard
- `/alerts` - Manage alerts

**Features**: Inline queries with token-based search

---

## Infrastructure

### Stillsuit Rapid Development Flow

| Environment | Target |
|-------------|--------|
| Local iteration | <5 seconds (tsx watch + hot-reload) |
| Staging deployment | <5 minutes (Docker + ECS) |

**Components**:
- `docker-compose.dev.yml` - PostgreSQL, Redis
- `Dockerfile.base` - Dependency caching
- `Dockerfile.dev` - File watcher with `entr -r`

### Production Infrastructure

- **Compute**: ECS Fargate
- **Database**: PostgreSQL (RDS)
- **Cache**: Redis (ElastiCache)
- **Jobs**: Trigger.dev

---

## Testing

### Test Locations

| Directory | Coverage |
|-----------|----------|
| `packages/adapters/chain/__tests__/` | Chain provider tests (7 files) |
| `packages/adapters/security/__tests__/` | Security tests (6 files) |
| `packages/adapters/themes/__tests__/` | Theme tests (3 files) |

### Test Files

- `dune-sim-integration.test.ts` - End-to-end Dune Sim tests
- `two-tier-provider.test.ts` - Hybrid provider validation
- `native-reader.test.ts` - RPC fallback testing
- `metrics.test.ts` - Provider metrics
- `score-service-client.test.ts` - Score service integration

---

## Code Quality

### Tech Debt Markers

| Metric | Count |
|--------|-------|
| Total TODO/FIXME/HACK/BUG | 381 comments |
| Distribution | 52% adapters, 28% themes |

**Critical Areas**:
- Chain provider fallback logic
- Theme evaluation
- Score service integration

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `packages/core/ports/chain-provider.ts` | IChainProvider interface definition |
| `packages/adapters/chain/dune-sim-client.ts` | Dune Sim API client |
| `packages/adapters/chain/hybrid-provider.ts` | Hybrid provider with fallback |
| `packages/adapters/chain/provider-factory.ts` | Factory for provider creation |
| `packages/adapters/chain/config.ts` | Configuration loader |
| `themes/sietch/src/discord/` | Discord bot commands |
| `themes/sietch/src/telegram/` | Telegram bot commands |
| `infrastructure/terraform/` | AWS IaC definitions |

---

## Documentation Artifacts

| File | Purpose |
|------|---------|
| `grimoires/loa/prd.md` | Product Requirements Document |
| `grimoires/loa/sdd.md` | Software Design Document |
| `grimoires/loa/sprint.md` | Sprint planning |
| `docs/STILLSUIT.md` | Development workflow |
| `grimoires/loa/deployment/` | Deployment runbooks |

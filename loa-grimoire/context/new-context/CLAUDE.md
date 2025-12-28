# CLAUDE.md — Arrakis SaaS Implementation

## Project Overview

Arrakis is being refactored from a bespoke Berachain Discord bot to a multi-tenant, chain-agnostic SaaS platform. This follows the **v5.5.1 Architecture** which has been validated through 15 adversarial audit rounds.

## Key Architecture Documents

- `docs/arrakis-saas-architecture.md` — Full 3800+ line specification
- `docs/arrakis-implementation-prompt.md` — Implementation guide

## Architecture Principles

### Two-Tier Chain Provider (Resilience)

```
TIER 1: Native Reader (Always Available)
  └── Binary checks: hasBalance(), ownsNFT()
  └── Direct viem RPC, no external dependencies

TIER 2: Score Service (Complex Queries)
  └── Ranking, history, cross-chain aggregation
  └── Circuit Breaker with cached fallback
```

**Key Insight**: Most token-gating only needs binary checks. Core features survive Score outages.

### Themes System (Configuration)

```typescript
interface IThemeProvider {
  getTierConfig(): TierDefinition[];
  getBadgeConfig(): BadgeDefinition[];
  evaluateTier(rank: number): TierResult;
}
```

- `BasicTheme`: 3 tiers, 5 badges (free)
- `SietchTheme`: 9 tiers, 10+ badges (premium, Dune-inspired)

### Hexagonal Architecture

```
┌─────────────────────────────────────────────┐
│              Domain Layer                    │
│   Asset | Community | Role | Eligibility    │
├─────────────────────────────────────────────┤
│              Service Layer                   │
│   WizardEngine | SyncService | ThemeEngine  │
├─────────────────────────────────────────────┤
│           Infrastructure Layer               │
│   TwoTierChainProvider | DiscordAdapter     │
│   DrizzleStorageAdapter | VaultAdapter      │
└─────────────────────────────────────────────┘
```

## Implementation Phases

| Phase | Focus | Status |
|-------|-------|--------|
| 0 | Two-Tier Chain Provider | Ready |
| 1 | Themes System | Ready |
| 2 | PostgreSQL + RLS | Ready |
| 3 | Redis + Hybrid State | Ready |
| 4 | BullMQ + Global Token Bucket | Ready |
| 5 | Vault Transit + Kill Switch | Ready |
| 6 | OPA Pre-Gate + HITL | Ready |

## Package Structure

```
packages/
├── core/
│   ├── domain/         # Pure entities
│   ├── ports/          # Interfaces
│   └── services/       # Business logic
├── adapters/
│   ├── chain/          # TwoTierChainProvider
│   ├── storage/        # Drizzle + Hybrid State
│   ├── platform/       # Discord + Rate Limiting
│   └── themes/         # Basic + Sietch
├── wizard/             # 8-step onboarding
└── synthesis/          # BullMQ + Global Token Bucket
```

## Critical Patterns

### Circuit Breaker for Score Service

```typescript
const breaker = new CircuitBreaker(scoreClient.call, {
  errorThresholdPercentage: 50,
  resetTimeout: 30000,
});
breaker.fallback(() => getCachedEligibility());
```

### Global Distributed Token Bucket

```typescript
// Redis-based, shared across all workers
// Prevents 100 concurrent tenants from triggering Discord 429
class GlobalDiscordTokenBucket {
  async acquireWithWait(tokens: number): Promise<void>;
}
```

### RLS-Only Multi-Tenancy

```sql
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON profiles
  USING (community_id = current_setting('app.current_tenant')::UUID);
```

### Policy-as-Code Pre-Gate

```rego
# OPA Policy: Block dangerous Terraform BEFORE human review
deny[msg] {
  input.plan[_].action == "delete"
  input.plan[_].type == "kubernetes_persistent_volume"
  msg := "delete_persistent_volume"
}
```

## Testing Requirements

- All 141 existing tests must pass
- SietchTheme must produce identical results to v3.0 hardcoded logic
- RLS regression tests must verify tenant isolation
- Circuit breaker must trigger on Score timeout

## Environment Variables

```bash
# Score Service (replaces BERACHAIN_RPC_URL, DUNE_API_KEY)
SCORE_API_URL=
SCORE_API_KEY=

# PostgreSQL (replaces SQLite)
DATABASE_URL=

# Redis (sessions + token bucket)
REDIS_URL=

# Vault (cryptographic operations)
VAULT_ADDR=
VAULT_TOKEN=
```

## Files to Delete After Migration

```bash
# After Phase 0:
rm src/services/chain.ts  # → TwoTierChainProvider

# After Phase 2:
rm profiles.db  # → PostgreSQL
```

## Loa Framework Patterns

This project follows Loa's enterprise patterns:
- Hexagonal architecture with ports/adapters
- Drizzle ORM for type-safe database access
- BullMQ for distributed task queues
- Circuit Breaker for external service resilience

## Quick Start

```bash
# Phase 0: Two-Tier Chain Provider
cd packages/adapters/chain
# Implement: NativeBlockchainReader.ts, ScoreServiceAdapter.ts, TwoTierChainProvider.ts

# Phase 1: Themes
cd packages/adapters/themes
# Implement: BasicTheme.ts, SietchTheme.ts

# Validate each phase before proceeding
npm test
```

## Reference

Full architecture specification: `docs/arrakis-saas-architecture.md`

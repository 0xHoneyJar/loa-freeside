# Arrakis SaaS Architecture Implementation Prompt

## Context

You are implementing the **Arrakis SaaS Architecture v5.5.1** — a token-gated community management platform that transforms a bespoke Berachain Discord bot into a multi-tenant, chain-agnostic SaaS platform.

This implementation uses the **Loa Framework** (https://github.com/0xHoneyJar/loa) patterns for enterprise-grade development.

## Architecture Document Reference

The full architecture specification is in `arrakis-saas-architecture.md`. Key architectural decisions:

### Core Abstractions (Phases 0-1 — COMPLETE architecturally)

1. **Two-Tier Chain Provider** — Resilience architecture for blockchain queries:
   - **Tier 1 (Native Reader)**: Direct viem RPC for binary checks (hasBalance, ownsNFT)
   - **Tier 2 (Score Service)**: External API for complex queries (ranking, history)
   - Graceful degradation: Core features work even if Score Service is down

2. **Themes System** — Injectable progression configurations:
   - `IThemeProvider` interface for tier/badge/naming configuration
   - `BasicTheme` (free): 3 tiers, 5 badges, generic naming
   - `SietchTheme` (premium): 9 tiers, 10+ badges, Dune-inspired naming
   - Theme selection per community, no code changes required

3. **Hexagonal Architecture**:
   - **Domain Layer**: Pure business logic (Asset, Community, Role, Eligibility entities)
   - **Service Layer**: Orchestration (WizardEngine, SyncService, ThemeEngine)
   - **Infrastructure Layer**: Adapters (ScoreServiceAdapter, DiscordAdapter, PostgresAdapter)

### Infrastructure Phases (2-6 — TO IMPLEMENT)

| Phase | Focus | Key Components |
|-------|-------|----------------|
| 2 | PostgreSQL + RLS | Drizzle ORM, tenant isolation, regression testing |
| 3 | Redis + Hybrid State | WizardSessionStore, S3 shadow repository |
| 4 | BullMQ + Global Token Bucket | Synthesis queue, platform-level rate limiting |
| 5 | Vault Transit + Kill Switch | HCP Vault, MFA, policy revocation |
| 6 | OPA Pre-Gate + HITL | Policy-as-Code, Terraform approval workflow |

## Implementation Instructions

### Step 1: Repository Setup

Clone and examine the existing Arrakis codebase:

```bash
# Clone the Loa framework for patterns
git clone https://github.com/0xHoneyJar/loa

# The existing sietch-service codebase should be in the workspace
# Key files to understand:
# - src/services/chain.ts (TO BE DELETED - replaced by Two-Tier Provider)
# - src/services/eligibility.ts (TO BE REFACTORED)
# - src/services/profile.ts (TO BE MIGRATED to PostgreSQL)
# - src/bot/commands/*.ts (TO USE Theme configs)
```

### Step 2: Create Package Structure

Following Loa's monorepo patterns, create:

```
packages/
├── core/
│   ├── domain/           # Pure domain entities
│   │   ├── Asset.ts
│   │   ├── Community.ts
│   │   ├── Role.ts
│   │   └── Eligibility.ts
│   ├── ports/            # Interface definitions
│   │   ├── IChainProvider.ts
│   │   ├── IThemeProvider.ts
│   │   ├── IStorageProvider.ts
│   │   └── IPlatformProvider.ts
│   └── services/         # Business logic orchestration
│       ├── EligibilityOrchestrator.ts
│       ├── TierEvaluator.ts
│       └── BadgeEvaluator.ts
├── adapters/
│   ├── chain/
│   │   ├── NativeBlockchainReader.ts    # Tier 1: Binary checks
│   │   ├── ScoreServiceAdapter.ts       # Tier 2: Complex queries
│   │   └── TwoTierChainProvider.ts      # Orchestrates both tiers
│   ├── storage/
│   │   ├── DrizzleStorageAdapter.ts
│   │   └── HybridManifestRepository.ts
│   ├── platform/
│   │   ├── DiscordAdapter.ts
│   │   └── GlobalRateLimiter.ts
│   └── themes/
│       ├── BasicTheme.ts
│       └── SietchTheme.ts
├── wizard/
│   ├── WizardEngine.ts
│   ├── WizardSessionStore.ts
│   └── states/           # 8 wizard steps
└── synthesis/
    ├── SynthesisQueue.ts
    ├── GlobalTokenBucket.ts
    └── ReconciliationController.ts
```

### Step 3: Implement Two-Tier Chain Provider (Phase 0)

This is the most critical component. Create:

```typescript
// packages/adapters/chain/TwoTierChainProvider.ts

import { INativeReader, IScoreService, IChainProvider } from '@arrakis/core/ports';
import CircuitBreaker from 'opossum';

export class TwoTierChainProvider implements IChainProvider {
  private nativeReader: INativeReader;      // Always available
  private scoreService: IScoreService;      // May fail
  private scoreBreaker: CircuitBreaker;
  
  // Tier 1: Binary checks - ALWAYS work
  async checkBasicEligibility(address: string, criteria: BasicCriteria): Promise<EligibilityResult> {
    // Direct viem RPC calls, no Score dependency
  }
  
  // Tier 2: Complex queries - graceful degradation
  async checkAdvancedEligibility(address: string, criteria: AdvancedCriteria): Promise<EligibilityResult> {
    // Try Score Service via circuit breaker
    // Fall back to cached/degraded mode if unavailable
  }
}
```

### Step 4: Implement Themes System (Phase 1)

```typescript
// packages/core/ports/IThemeProvider.ts

export interface IThemeProvider {
  getTierConfig(): TierDefinition[];
  getBadgeConfig(): BadgeDefinition[];
  getNamingConfig(): NamingConfig;
  evaluateTier(rank: number): TierResult;
  evaluateBadges(member: MemberContext): EarnedBadge[];
}

// packages/adapters/themes/SietchTheme.ts

export class SietchTheme implements IThemeProvider {
  getTierConfig(): TierDefinition[] {
    return [
      { name: 'naib', minRank: 1, maxRank: 7, color: '#FFD700' },
      { name: 'fedaykin_elite', minRank: 8, maxRank: 15, color: '#C0C0C0' },
      // ... all 9 tiers from v3.0
    ];
  }
  
  // ... implement all methods
}
```

### Step 5: PostgreSQL Migration (Phase 2)

```typescript
// packages/adapters/storage/schema.ts (Drizzle)

import { pgTable, uuid, text, timestamp, jsonb } from 'drizzle-orm/pg-core';

export const communities = pgTable('communities', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  themeId: text('theme_id').notNull().default('basic'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const profiles = pgTable('profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  communityId: uuid('community_id').references(() => communities.id),
  discordId: text('discord_id').notNull(),
  walletAddress: text('wallet_address'),
  tier: text('tier'),
  activityScore: integer('activity_score').default(0),
});

// RLS Policy (apply via migration)
// ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
// CREATE POLICY tenant_isolation ON profiles
//   USING (community_id = current_setting('app.current_tenant')::UUID);
```

### Step 6: Global Token Bucket (Phase 4)

```typescript
// packages/synthesis/GlobalTokenBucket.ts

export class GlobalDiscordTokenBucket {
  private redis: Redis;
  private readonly MAX_TOKENS = 50;  // Discord ~50 req/sec
  
  async acquire(tokens: number = 1): Promise<boolean> {
    // Atomic Lua script for distributed token acquisition
    // See architecture doc §5.2 for full implementation
  }
  
  async acquireWithWait(tokens: number, timeoutMs: number): Promise<void> {
    // Wait with exponential backoff until tokens available
  }
}
```

### Step 7: Policy-as-Code Pre-Gate (Phase 6)

```typescript
// packages/infrastructure/PolicyAsCodePreGate.ts

export class PolicyAsCodePreGate {
  private opa: OPAClient;
  private infracost: InfracostClient;
  
  async validateBeforeHITL(plan: TerraformPlan): Promise<PolicyValidationResult> {
    // Stage 1: OPA hard blocks (delete PV, delete DB, disable RLS)
    // Stage 2: Infracost budget check (>$5k auto-reject)
    // Stage 3: Risk scoring for human context
  }
}
```

## Testing Strategy

Following Loa's testing patterns:

```typescript
// packages/core/__tests__/TierEvaluator.test.ts

describe('TierEvaluator', () => {
  it('should evaluate rank to correct tier using SietchTheme', () => {
    const theme = new SietchTheme();
    const evaluator = new TierEvaluator(theme);
    
    expect(evaluator.evaluate(1).tierName).toBe('naib');
    expect(evaluator.evaluate(8).tierName).toBe('fedaykin_elite');
    expect(evaluator.evaluate(70).tierName).toBe('outsider');
  });
  
  it('should produce identical results to v3.0 hardcoded logic', () => {
    // Regression test against existing implementation
  });
});
```

## Migration Validation Checklist

For each phase, validate:

- [ ] All existing tests pass (141 tests in v3.0)
- [ ] Sietch theme produces identical results to hardcoded v3.0 logic
- [ ] RLS prevents cross-tenant data access
- [ ] Circuit breaker triggers correctly on Score outage
- [ ] Global token bucket limits aggregate Discord API calls
- [ ] OPA blocks dangerous Terraform operations

## Files to Delete After Migration

Once each phase is validated:

```bash
# Phase 0 complete:
rm src/services/chain.ts  # Replaced by TwoTierChainProvider

# Phase 1 complete:
# (No deletions - tier configs extracted but original still works)

# Phase 2 complete:
rm profiles.db  # SQLite file replaced by PostgreSQL
```

## Environment Variables

Update from v3.0 to v5.5:

```bash
# REMOVE (now in Score Service):
# BERACHAIN_RPC_URL
# DUNE_API_KEY

# ADD:
SCORE_API_URL=https://score.honeyjar.xyz/api
SCORE_API_KEY=sk_...

# ADD (PostgreSQL):
DATABASE_URL=postgresql://...

# ADD (Redis):
REDIS_URL=redis://...

# ADD (Vault):
VAULT_ADDR=https://vault.honeyjar.xyz
VAULT_TOKEN=...
```

## Loa Framework Integration Points

Use Loa's agent patterns for:

1. **validating-architecture** agent: Validate hexagonal structure
2. **implementing-feature** agent: Implement each phase
3. **reviewing-code** agent: Review PRs for FAANG quality
4. **deploying-infrastructure** agent: Terraform with OPA pre-gate

## Success Criteria

The implementation is complete when:

1. ✅ Two-Tier Chain Provider handles Score outages gracefully
2. ✅ BasicTheme and SietchTheme produce correct tier evaluations
3. ✅ PostgreSQL with RLS isolates tenant data
4. ✅ WizardEngine survives Discord 3s timeout via Redis
5. ✅ Global Token Bucket prevents Discord 429 bans
6. ✅ Vault Transit handles all cryptographic operations
7. ✅ OPA Pre-Gate blocks dangerous Terraform before HITL

## Start Here

Begin with Phase 0 (Two-Tier Chain Provider):

```bash
# 1. Create the package structure
mkdir -p packages/{core,adapters,wizard,synthesis}

# 2. Implement INativeReader interface
# 3. Implement IScoreService interface  
# 4. Implement TwoTierChainProvider with Circuit Breaker
# 5. Write tests validating graceful degradation
# 6. Delete src/services/chain.ts when tests pass
```

Then proceed to Phase 1 (Themes), Phase 2 (PostgreSQL), etc.

---

**Reference the full architecture document (`arrakis-saas-architecture.md`) for detailed specifications, code examples, and diagrams.**

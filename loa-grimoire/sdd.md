# Software Design Document: Arrakis SaaS Platform v5.0

**Version:** 5.2 "The Transformation"
**Date:** 2025-12-30
**Author:** Architecture Designer Agent
**Status:** Approved - Coexistence Architecture Added
**PRD Reference:** loa-grimoire/prd.md (v5.2)
**Architecture Reference:** loa-grimoire/context/new-context/arrakis-saas-architecture.md
**Coexistence Reference:** loa-grimoire/context/ARRAKIS_COEXISTENCE_ARCHITECTURE.md
**Code Review Reference:** loa-grimoire/context/arrakis-v5-code-review.md

---

## Table of Contents

1. [Project Architecture](#1-project-architecture)
2. [Software Stack](#2-software-stack)
3. [Database Design](#3-database-design)
4. [Component Design](#4-component-design)
5. [API Specifications](#5-api-specifications)
6. [Error Handling Strategy](#6-error-handling-strategy)
7. [Testing Strategy](#7-testing-strategy)
8. [Development Phases](#8-development-phases)
9. [Known Risks and Mitigation](#9-known-risks-and-mitigation)
10. [Hardening Architecture (Post-Audit)](#10-hardening-architecture-post-audit)
11. [Coexistence Architecture](#11-coexistence-architecture)
12. [Open Questions](#12-open-questions)
13. [Appendix](#13-appendix)

---

## 1. Project Architecture

### 1.1 System Overview

Arrakis v5.0 is a **multi-tenant, chain-agnostic SaaS platform** for token-gated community management. The system transforms the existing Sietch bot (a bespoke Berachain Discord bot) into an enterprise-grade platform supporting 100+ concurrent communities.

**Core Capabilities:**
- Token-gated access with configurable eligibility rules
- 9-tier progression system with Dune-inspired theming
- Real-time role management via Discord/Telegram
- Self-service onboarding wizard
- Asynchronous channel/role synthesis with rate limiting

### 1.2 Architectural Pattern

**Pattern:** Hexagonal Architecture (Ports and Adapters) + Event-Driven Synthesis

**Justification:**
- **Domain Isolation:** Core business logic (eligibility, tiers, badges) is decoupled from external systems
- **Chain Agnosticism:** Two-Tier Chain Provider abstracts blockchain interactions behind Score Service
- **Platform Independence:** Same domain logic works for Discord, Telegram, or future platforms
- **Testability:** Ports enable complete unit testing without external dependencies

### 1.3 System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        ARRAKIS SAAS PLATFORM v5.0                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         DOMAIN LAYER                                 │   │
│  │  ┌──────────┐  ┌──────────────┐  ┌─────────┐  ┌───────────────┐    │   │
│  │  │  Asset   │  │  Community   │  │  Role   │  │  Eligibility  │    │   │
│  │  └──────────┘  └──────────────┘  └─────────┘  └───────────────┘    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│                                    ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                        SERVICE LAYER                                 │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐  ┌──────────┐ │   │
│  │  │ WizardEngine │  │ SyncService  │  │ ThemeEngine │  │ TierEval │ │   │
│  │  └──────────────┘  └──────────────┘  └─────────────┘  └──────────┘ │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│                    ┌───────────────┼───────────────┐                       │
│                    ▼               ▼               ▼                       │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                     INFRASTRUCTURE LAYER                             │   │
│  │                                                                      │   │
│  │  ┌────────────────────────────────────────────────────────────────┐ │   │
│  │  │              TWO-TIER CHAIN PROVIDER                            │ │   │
│  │  │  ┌─────────────────┐    ┌────────────────────────────────────┐ │ │   │
│  │  │  │  Tier 1: Native │    │  Tier 2: Score Service             │ │ │   │
│  │  │  │  (Binary checks)│    │  (Complex queries + Circuit Breaker)│ │ │   │
│  │  │  │  • hasBalance   │    │  • getRankedHolders                │ │ │   │
│  │  │  │  • ownsNFT      │    │  • getAddressRank                  │ │ │   │
│  │  │  │  Direct viem    │    │  • getActivityScore                │ │ │   │
│  │  │  └─────────────────┘    └────────────────────────────────────┘ │ │   │
│  │  └────────────────────────────────────────────────────────────────┘ │   │
│  │                                                                      │   │
│  │  ┌──────────────┐  ┌───────────────┐  ┌──────────────────────────┐ │   │
│  │  │ Discord      │  │ PostgreSQL    │  │ Redis                    │ │   │
│  │  │ Adapter      │  │ + RLS         │  │ (Sessions + TokenBucket) │ │   │
│  │  └──────────────┘  └───────────────┘  └──────────────────────────┘ │   │
│  │                                                                      │   │
│  │  ┌──────────────┐  ┌───────────────┐  ┌──────────────────────────┐ │   │
│  │  │ BullMQ       │  │ Vault Transit │  │ S3 Shadow                │ │   │
│  │  │ Synthesis    │  │ (Signing)     │  │ (Manifest Versions)      │ │   │
│  │  └──────────────┘  └───────────────┘  └──────────────────────────┘ │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.4 System Components

#### Two-Tier Chain Provider
- **Purpose:** Resilient blockchain data access with graceful degradation
- **Responsibilities:**
  - Tier 1: Binary eligibility checks via native RPC (always available)
  - Tier 2: Complex queries via Score Service with circuit breaker
  - Automatic fallback when Score Service is unavailable
- **Interfaces:** `IChainProvider`, `INativeReader`, `IScoreService`
- **Dependencies:** viem (Tier 1), Score API (Tier 2), opossum (circuit breaker)

#### Theme Engine
- **Purpose:** Injectable progression configurations for community customization
- **Responsibilities:**
  - Tier evaluation (rank → tier mapping)
  - Badge evaluation (member context → earned badges)
  - Naming/branding resolution
- **Interfaces:** `IThemeProvider`
- **Dependencies:** None (pure configuration)

#### WizardEngine
- **Purpose:** State-driven self-service onboarding via Discord interactions
- **Responsibilities:**
  - 8-step wizard state machine
  - Session persistence with Redis
  - Idempotency-keyed resumption
- **Interfaces:** `ISessionStore`, `IWizardStep`
- **Dependencies:** Redis, Discord.js

#### Synthesis Engine
- **Purpose:** Asynchronous Discord operations with rate limiting
- **Responsibilities:**
  - BullMQ job queue for channel/role creation
  - Global token bucket (50 req/sec across all tenants)
  - Reconciliation controller (desired → actual state)
- **Interfaces:** `ISynthesisQueue`, `IRateLimiter`
- **Dependencies:** BullMQ, Redis

### 1.5 Data Flow

```
User Request → Discord/Telegram → Platform Adapter
                                        │
                                        ▼
                              ┌─────────────────┐
                              │  Service Layer  │
                              │  (Orchestration)│
                              └────────┬────────┘
                                       │
           ┌───────────────────────────┼───────────────────────────┐
           ▼                           ▼                           ▼
    ┌──────────────┐          ┌──────────────┐          ┌──────────────┐
    │ Theme Engine │          │ Chain        │          │ Storage      │
    │ (Config)     │          │ Provider     │          │ (PostgreSQL) │
    └──────────────┘          └──────────────┘          └──────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
             ┌──────────────┐              ┌──────────────┐
             │ Tier 1       │              │ Tier 2       │
             │ Native Reader│              │ Score Service│
             │ (viem RPC)   │              │ (+ Breaker)  │
             └──────────────┘              └──────────────┘
```

### 1.6 External Integrations

| Service | Purpose | API Type | Documentation |
|---------|---------|----------|---------------|
| Score Service | Blockchain data aggregation | REST | Internal API |
| Discord | Community platform | REST + Gateway | discord.js |
| Telegram | Alternative platform | REST | node-telegram-bot-api |
| Collab.Land | Token gating rules | REST | Collab.Land TGR API |
| Stripe | Subscription billing | REST | Stripe SDK |
| HCP Vault | Cryptographic operations | REST | HashiCorp Vault |

### 1.7 Deployment Architecture

**Target Environment:** Kubernetes on AWS (EKS)

```
┌─────────────────────────────────────────────────────────────────┐
│                        AWS INFRASTRUCTURE                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                    EKS CLUSTER                           │    │
│  │                                                          │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │    │
│  │  │ API Pods     │  │ Worker Pods  │  │ Bot Pods     │   │    │
│  │  │ (Hono)       │  │ (BullMQ)     │  │ (Discord.js) │   │    │
│  │  │ Replicas: 3  │  │ Replicas: 5  │  │ Replicas: 2  │   │    │
│  │  └──────────────┘  └──────────────┘  └──────────────┘   │    │
│  │                                                          │    │
│  │  HPA: Scale on CPU/Memory + Queue Depth                  │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │ RDS          │  │ ElastiCache  │  │ S3           │           │
│  │ PostgreSQL   │  │ Redis        │  │ Manifests    │           │
│  │ (Multi-AZ)   │  │ (Cluster)    │  │ (Versioned)  │           │
│  └──────────────┘  └──────────────┘  └──────────────┘           │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 1.8 Scalability Strategy

- **Horizontal Scaling:**
  - API pods scale based on request rate (HPA)
  - Worker pods scale based on BullMQ queue depth
  - Bot pods scale based on guild count per shard

- **Vertical Scaling:**
  - PostgreSQL: Read replicas for query distribution
  - Redis: Cluster mode for session distribution

- **Auto-scaling Triggers:**
  - CPU > 70%: Scale up
  - Queue depth > 1000: Add workers
  - Memory > 80%: Scale up

- **Load Balancing:**
  - ALB for API traffic
  - Redis Cluster for session distribution
  - BullMQ for job distribution

### 1.9 Security Architecture

- **Authentication:**
  - Discord OAuth2 for user identity
  - API keys for service-to-service
  - JWT tokens for session management

- **Authorization:**
  - Role-Based Access Control (RBAC)
  - Naib Council (Top 7) for admin operations
  - MFA required for destructive operations

- **Data Protection:**
  - PostgreSQL RLS for tenant isolation
  - Vault Transit for cryptographic operations
  - TLS 1.3 for all external communication

- **Kill Switch Protocol:**
  - Instant session revocation
  - Vault policy revocation
  - Community freeze capability

---

## 2. Software Stack

### 2.1 Backend Technologies

| Category | Technology | Version | Justification |
|----------|------------|---------|---------------|
| Runtime | Node.js | 20.x LTS | TypeScript support, async performance |
| Language | TypeScript | 5.x | Type safety, better IDE support |
| Framework | Hono | 4.x | Lightweight, edge-compatible |
| ORM | Drizzle | 0.30.x | Type-safe, lightweight, PostgreSQL RLS support |
| Queue | BullMQ | 5.x | Redis-backed, distributed, rate limiting |
| Discord | discord.js | 14.x | Official SDK, sharding support |
| Circuit Breaker | opossum | 8.x | Mature, well-documented |
| Testing | Vitest | 1.x | Fast, ESM-native |

**Key Libraries:**
- `viem`: Tier 1 blockchain RPC calls
- `ioredis`: Redis client for sessions and token bucket
- `@hono/node-server`: HTTP server
- `zod`: Runtime validation
- `pino`: Structured logging

### 2.2 Infrastructure & DevOps

| Category | Technology | Purpose |
|----------|------------|---------|
| Cloud Provider | AWS | Primary infrastructure |
| Container Registry | ECR | Docker image storage |
| Orchestration | EKS | Kubernetes management |
| CI/CD | GitHub Actions | Build, test, deploy |
| IaC | Terraform | Infrastructure provisioning |
| Secrets | HCP Vault | Cryptographic operations |
| Monitoring | Datadog | APM, logs, metrics |
| Logging | CloudWatch | Log aggregation |

### 2.3 Data Stores

| Store | Technology | Purpose |
|-------|------------|---------|
| Primary DB | PostgreSQL 15 | Tenant data with RLS |
| Session Store | Redis 7 | Wizard sessions, token bucket |
| Queue Backend | Redis 7 | BullMQ job persistence |
| Object Storage | S3 | Manifest version history |
| Cache | Redis 7 | Query result caching |

---

## 3. Database Design

### 3.1 Database Technology

**Primary Database:** PostgreSQL 15
**Version:** 15.x (AWS RDS)

**Justification:**
- Row-Level Security (RLS) for multi-tenant isolation
- JSONB for flexible manifest storage
- Recursive CTEs for badge lineage queries
- Mature ecosystem, proven at scale

### 3.2 Schema Design

#### Communities Table

```sql
CREATE TABLE communities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    theme_id TEXT NOT NULL DEFAULT 'basic',
    subscription_tier TEXT NOT NULL DEFAULT 'free',
    discord_guild_id TEXT UNIQUE,
    telegram_chat_id TEXT UNIQUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_communities_theme ON communities(theme_id);
```

#### Profiles Table

```sql
CREATE TABLE profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    community_id UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
    discord_id TEXT,
    telegram_id TEXT,
    wallet_address TEXT,
    tier TEXT,
    current_rank INTEGER,
    activity_score INTEGER DEFAULT 0,
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(community_id, discord_id),
    UNIQUE(community_id, telegram_id)
);

CREATE INDEX idx_profiles_community ON profiles(community_id);
CREATE INDEX idx_profiles_wallet ON profiles(wallet_address);
CREATE INDEX idx_profiles_tier ON profiles(community_id, tier);

-- Row-Level Security
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON profiles
    USING (community_id = current_setting('app.current_tenant')::UUID);
```

#### Badges Table

```sql
CREATE TABLE badges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    community_id UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
    profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    badge_type TEXT NOT NULL,
    awarded_at TIMESTAMPTZ DEFAULT NOW(),
    awarded_by UUID REFERENCES profiles(id),  -- For lineage badges
    metadata JSONB DEFAULT '{}'::jsonb,

    UNIQUE(community_id, profile_id, badge_type)
);

CREATE INDEX idx_badges_profile ON badges(profile_id);
CREATE INDEX idx_badges_type ON badges(community_id, badge_type);

-- RLS for badges
ALTER TABLE badges ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON badges
    USING (community_id = current_setting('app.current_tenant')::UUID);
```

#### Manifests Table (Hybrid State)

```sql
CREATE TABLE manifests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    community_id UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    content JSONB NOT NULL,
    checksum TEXT NOT NULL,
    synthesized_at TIMESTAMPTZ DEFAULT NOW(),
    synthesized_by TEXT,

    UNIQUE(community_id, version)
);

CREATE INDEX idx_manifests_community ON manifests(community_id);

-- RLS for manifests
ALTER TABLE manifests ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON manifests
    USING (community_id = current_setting('app.current_tenant')::UUID);
```

#### Shadow State Table

```sql
CREATE TABLE shadow_states (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    community_id UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
    applied_at TIMESTAMPTZ DEFAULT NOW(),
    applied_by TEXT,
    resources JSONB NOT NULL,  -- Discord IDs mapped to manifest IDs
    checksum TEXT NOT NULL
);

CREATE INDEX idx_shadow_community ON shadow_states(community_id);
```

#### Entity Relationships

```
communities ──1:N──▶ profiles
communities ──1:N──▶ manifests
communities ──1:N──▶ shadow_states
profiles ──1:N──▶ badges
profiles ──1:N──▶ badges (awarded_by - lineage)
```

### 3.3 Data Modeling Approach

- **Normalization Level:** 3NF with strategic denormalization
- **Denormalization Strategy:**
  - `current_rank` on profiles (frequently queried)
  - `activity_score` on profiles (avoid joins)
  - `content` as JSONB in manifests (flexibility)

### 3.4 Migration Strategy

All migrations managed via Drizzle migrations:

```typescript
// drizzle/migrations/001_initial.sql
// Generated by Drizzle Kit
```

Migration workflow:
1. Generate migration: `npm run db:generate`
2. Review SQL in `drizzle/migrations/`
3. Apply migration: `npm run db:migrate`
4. Verify RLS policies in place

### 3.5 Data Access Patterns

| Query | Frequency | Optimization |
|-------|-----------|--------------|
| Get profile by discord_id | Very High | Unique index + RLS |
| Get community profiles | High | community_id index |
| Get badge lineage | Medium | Recursive CTE |
| Get manifest history | Low | community_id index |
| Tier distribution stats | Medium | tier index |

### 3.6 Caching Strategy

- **Cache Provider:** Redis 7
- **Cached Data:**
  - Profile lookups (5 min TTL)
  - Tier configurations (1 hour TTL)
  - Community settings (15 min TTL)
- **Invalidation:** Event-driven (on profile/manifest update)
- **TTL:** Varies by data volatility

### 3.7 Backup and Recovery

- **Backup Frequency:** Continuous via RDS automated backups
- **Retention Period:** 30 days
- **Recovery Time Objective (RTO):** < 1 hour
- **Recovery Point Objective (RPO):** < 5 minutes
- **Shadow Repository:** S3 versioned bucket for manifest disaster recovery

---

## 4. Component Design

### 4.1 Two-Tier Chain Provider

```typescript
// packages/core/ports/IChainProvider.ts

export interface INativeReader {
  hasBalance(address: string, token: string, minAmount: bigint): Promise<boolean>;
  ownsNFT(address: string, collection: string): Promise<boolean>;
  getBalance(address: string, token: string): Promise<bigint>;
}

export interface IScoreService {
  getRankedHolders(asset: string, limit: number): Promise<RankedHolder[]>;
  getAddressRank(address: string, asset: string): Promise<number | null>;
  getActivityScore(address: string): Promise<number>;
  checkActionHistory(address: string, action: string): Promise<boolean>;
}

export interface IChainProvider extends INativeReader {
  checkBasicEligibility(address: string, criteria: BasicCriteria): Promise<EligibilityResult>;
  checkAdvancedEligibility(address: string, criteria: AdvancedCriteria): Promise<EligibilityResult>;
}
```

```typescript
// packages/adapters/chain/TwoTierChainProvider.ts

export class TwoTierChainProvider implements IChainProvider {
  private nativeReader: INativeReader;
  private scoreService: IScoreService;
  private scoreBreaker: CircuitBreaker;

  constructor(
    nativeReader: INativeReader,
    scoreService: IScoreService,
    breakerOptions: CircuitBreakerOptions
  ) {
    this.nativeReader = nativeReader;
    this.scoreService = scoreService;
    this.scoreBreaker = new CircuitBreaker(
      (fn: () => Promise<any>) => fn(),
      {
        errorThresholdPercentage: 50,
        resetTimeout: 30000,
        ...breakerOptions
      }
    );

    this.scoreBreaker.fallback(() => this.getCachedOrDegraded());
  }

  // Tier 1: Always available - direct RPC
  async checkBasicEligibility(
    address: string,
    criteria: BasicCriteria
  ): Promise<EligibilityResult> {
    if (criteria.type === 'TOKEN_BALANCE') {
      const hasBalance = await this.nativeReader.hasBalance(
        address,
        criteria.token,
        criteria.minAmount
      );
      return { eligible: hasBalance, source: 'native' };
    }

    if (criteria.type === 'NFT_OWNERSHIP') {
      const ownsNFT = await this.nativeReader.ownsNFT(
        address,
        criteria.collection
      );
      return { eligible: ownsNFT, source: 'native' };
    }

    throw new Error(`Unknown basic criteria type: ${criteria.type}`);
  }

  // Tier 2: Complex queries with circuit breaker
  async checkAdvancedEligibility(
    address: string,
    criteria: AdvancedCriteria
  ): Promise<EligibilityResult> {
    return this.scoreBreaker.fire(async () => {
      if (criteria.type === 'RANK_THRESHOLD') {
        const rank = await this.scoreService.getAddressRank(
          address,
          criteria.asset
        );
        return {
          eligible: rank !== null && rank <= criteria.maxRank,
          source: 'score',
          rank
        };
      }

      if (criteria.type === 'ACTIVITY_SCORE') {
        const score = await this.scoreService.getActivityScore(address);
        return {
          eligible: score >= criteria.minScore,
          source: 'score',
          score
        };
      }

      throw new Error(`Unknown advanced criteria type: ${criteria.type}`);
    });
  }

  private async getCachedOrDegraded(): Promise<EligibilityResult> {
    // Return cached data or degraded response
    return { eligible: false, source: 'degraded', reason: 'Score service unavailable' };
  }
}
```

### 4.2 Theme System

```typescript
// packages/core/ports/IThemeProvider.ts

export interface IThemeProvider {
  readonly themeId: string;
  readonly themeName: string;
  readonly tier: 'free' | 'premium' | 'enterprise';

  getTierConfig(): TierConfig;
  getBadgeConfig(): BadgeConfig;
  getNamingConfig(): NamingConfig;
  getChannelTemplate(): ChannelTemplate;

  evaluateTier(rank: number, totalHolders: number): TierResult;
  evaluateBadges(member: MemberContext): EarnedBadge[];
}

export interface TierConfig {
  tiers: TierDefinition[];
  rankingStrategy: 'absolute' | 'percentage' | 'threshold';
  demotionGracePeriod?: number;
}

export interface TierDefinition {
  id: string;
  name: string;
  displayName: string;
  minRank?: number;
  maxRank?: number;
  roleColor: string;
  permissions: string[];
}
```

```typescript
// packages/adapters/themes/SietchTheme.ts

export const SietchTheme: IThemeProvider = {
  themeId: 'sietch',
  themeName: 'Sietch (Dune)',
  tier: 'premium',

  getTierConfig: () => ({
    tiers: [
      { id: 'naib', displayName: 'Naib', minRank: 1, maxRank: 7, roleColor: '#FFD700' },
      { id: 'fedaykin_elite', displayName: 'Fedaykin Elite', minRank: 8, maxRank: 15, roleColor: '#E6BE8A' },
      { id: 'fedaykin', displayName: 'Fedaykin', minRank: 16, maxRank: 30, roleColor: '#C4A35A' },
      { id: 'fremen', displayName: 'Fremen', minRank: 31, maxRank: 45, roleColor: '#A67C52' },
      { id: 'wanderer', displayName: 'Wanderer', minRank: 46, maxRank: 55, roleColor: '#8B7355' },
      { id: 'initiate', displayName: 'Initiate', minRank: 56, maxRank: 62, roleColor: '#6B5344' },
      { id: 'aspirant', displayName: 'Aspirant', minRank: 63, maxRank: 66, roleColor: '#5D4E37' },
      { id: 'observer', displayName: 'Observer', minRank: 67, maxRank: 69, roleColor: '#4A3728' },
      { id: 'outsider', displayName: 'Outsider', minRank: 70, maxRank: null, roleColor: '#333333' },
    ],
    rankingStrategy: 'absolute',
    demotionGracePeriod: 24
  }),

  evaluateTier(rank: number): TierResult {
    const config = this.getTierConfig();
    const tier = config.tiers.find(t =>
      rank >= (t.minRank || 0) &&
      (t.maxRank === null || rank <= t.maxRank)
    );

    return {
      tierId: tier?.id || 'outsider',
      tierName: tier?.displayName || 'Outsider',
      roleColor: tier?.roleColor || '#333333'
    };
  },

  getBadgeConfig: () => ({
    categories: ['tenure', 'achievement', 'activity', 'special'],
    badges: [
      { id: 'first_wave', displayName: 'First Wave', emoji: '🌊', category: 'tenure',
        criteria: { type: 'tenure', threshold: 30 } },
      { id: 'veteran', displayName: 'Veteran', emoji: '⚔️', category: 'tenure',
        criteria: { type: 'tenure', threshold: 90 } },
      { id: 'diamond_hands', displayName: 'Diamond Hands', emoji: '💎', category: 'tenure',
        criteria: { type: 'tenure', threshold: 180 } },
      { id: 'council', displayName: 'Council', emoji: '👑', category: 'achievement',
        criteria: { type: 'tier_reached', tierRequired: 'naib' } },
      { id: 'water_sharer', displayName: 'Water Sharer', emoji: '💧', category: 'special',
        criteria: { type: 'custom', customEvaluator: 'waterSharerLineage' } },
    ]
  }),

  evaluateBadges(member: MemberContext): EarnedBadge[] {
    const config = this.getBadgeConfig();
    const earned: EarnedBadge[] = [];

    for (const badge of config.badges) {
      if (this.evaluateBadgeCriteria(badge.criteria, member)) {
        earned.push({
          badgeId: badge.id,
          badgeName: badge.displayName,
          emoji: badge.emoji,
          earnedAt: new Date()
        });
      }
    }

    return earned;
  },

  getNamingConfig: () => ({
    serverNameTemplate: 'Sietch {community}',
    categoryNames: {
      info: 'STILLSUIT',
      council: 'NAIB COUNCIL',
      general: 'SIETCH-COMMONS',
      operations: 'WINDTRAP'
    },
    terminology: {
      member: 'Fremen',
      holder: 'Water Bearer',
      admin: 'Naib'
    }
  }),

  getChannelTemplate: () => ({
    categories: [
      {
        id: 'stillsuit',
        name: 'STILLSUIT',
        channels: [
          { name: 'water-discipline', type: 'text', readonly: true },
          { name: 'census', type: 'text', readonly: true }
        ]
      },
      {
        id: 'council',
        name: 'NAIB COUNCIL',
        tierRestriction: 'naib',
        channels: [
          { name: 'council-rock', type: 'text' }
        ]
      }
    ]
  })
};
```

### 4.3 WizardEngine

```typescript
// packages/wizard/WizardEngine.ts

export enum WizardState {
  INIT = 'init',
  CHAIN_SELECT = 'chain_select',
  ASSET_CONFIG = 'asset_config',
  ELIGIBILITY_RULES = 'eligibility_rules',
  ROLE_MAPPING = 'role_mapping',
  CHANNEL_STRUCTURE = 'channel_structure',
  REVIEW = 'review',
  DEPLOY = 'deploy',
  COMPLETE = 'complete'
}

export interface WizardSession {
  id: string;
  userId: string;
  guildId: string;
  currentStep: WizardState;
  stepData: Record<string, any>;
  idempotencyKey: string;
  startedAt: Date;
  lastInteractionAt: Date;
}

export class WizardEngine {
  constructor(
    private sessionStore: ISessionStore,
    private synthesisQueue: ISynthesisQueue
  ) {}

  async handleInteraction(interaction: Interaction): Promise<void> {
    // CRITICAL: Defer within 3 seconds
    await interaction.deferReply({ ephemeral: true });

    const sessionKey = `wizard:${interaction.user.id}:${interaction.guildId}`;
    let session = await this.sessionStore.get(sessionKey);

    if (!session) {
      session = this.createSession(interaction.user.id, interaction.guildId!);
    }

    // Process current step
    const handler = this.getStepHandler(session.currentStep);
    const result = await handler.process(interaction, session);

    if (result.advance) {
      session.currentStep = this.getNextStep(session.currentStep);
    }

    session.stepData[session.currentStep] = result.data;
    session.lastInteractionAt = new Date();

    // Save with 15-minute TTL (Discord followup window)
    await this.sessionStore.save(sessionKey, session, 900);

    await interaction.editReply(result.response);
  }

  async resume(interaction: CommandInteraction): Promise<void> {
    const sessionKey = `wizard:${interaction.user.id}:${interaction.guildId}`;
    const session = await this.sessionStore.get(sessionKey);

    if (!session) {
      await interaction.reply({
        content: 'No active onboarding session found. Start with `/onboard`.',
        ephemeral: true
      });
      return;
    }

    await this.continueFromStep(interaction, session);
  }

  private createSession(userId: string, guildId: string): WizardSession {
    return {
      id: crypto.randomUUID(),
      userId,
      guildId,
      currentStep: WizardState.INIT,
      stepData: {},
      idempotencyKey: crypto.randomUUID(),
      startedAt: new Date(),
      lastInteractionAt: new Date()
    };
  }
}
```

### 4.4 Global Token Bucket

```typescript
// packages/synthesis/GlobalTokenBucket.ts

export class GlobalDiscordTokenBucket {
  private redis: Redis;
  private readonly BUCKET_KEY = 'discord:global:tokens';
  private readonly MAX_TOKENS = 50;        // Discord ~50 req/sec
  private readonly REFILL_RATE = 50;       // Refill 50 tokens per second

  constructor(redis: Redis) {
    this.redis = redis;
    this.startRefillLoop();
  }

  // Atomic token acquisition using Lua script
  async acquire(tokens: number = 1): Promise<boolean> {
    const script = `
      local current = tonumber(redis.call('GET', KEYS[1]) or ARGV[1])
      if current >= tonumber(ARGV[2]) then
        redis.call('DECRBY', KEYS[1], ARGV[2])
        return 1
      end
      return 0
    `;

    const result = await this.redis.eval(
      script, 1, this.BUCKET_KEY, this.MAX_TOKENS.toString(), tokens.toString()
    );

    return result === 1;
  }

  // Wait until tokens are available (with timeout)
  async acquireWithWait(tokens: number = 1, timeoutMs: number = 30000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let backoff = 100;

    while (Date.now() < deadline) {
      if (await this.acquire(tokens)) {
        return;
      }

      // Exponential backoff with jitter
      await this.sleep(backoff + Math.random() * 100);
      backoff = Math.min(backoff * 2, 1000);
    }

    throw new RateLimitExceededError('Global Discord rate limit timeout');
  }

  private startRefillLoop(): void {
    setInterval(async () => {
      const script = `
        local current = tonumber(redis.call('GET', KEYS[1]) or 0)
        local newVal = math.min(current + tonumber(ARGV[1]), tonumber(ARGV[2]))
        redis.call('SET', KEYS[1], newVal)
        return newVal
      `;
      await this.redis.eval(
        script, 1, this.BUCKET_KEY,
        this.REFILL_RATE.toString(), this.MAX_TOKENS.toString()
      );
    }, 1000);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

### 4.5 Synthesis Engine

```typescript
// packages/synthesis/SynthesisQueue.ts

export class SynthesisQueue {
  private queue: Queue;
  private globalBucket: GlobalDiscordTokenBucket;

  constructor(redis: Redis) {
    this.queue = new Queue('discord-synthesis', {
      connection: redis,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 }
      }
    });

    this.globalBucket = new GlobalDiscordTokenBucket(redis);
  }

  async enqueueSynthesis(manifest: CommunityManifest): Promise<string> {
    const job = await this.queue.add('synthesize', {
      manifestId: manifest.community.id,
      channels: manifest.channels,
      roles: manifest.roles
    });

    return job.id!;
  }

  createWorker(): Worker {
    return new Worker('discord-synthesis', async (job) => {
      const { manifestId, channels, roles } = job.data;

      // Create roles first (channels may reference them)
      for (const role of roles) {
        await this.globalBucket.acquireWithWait(1);
        await this.createRole(manifestId, role);
        await job.updateProgress((roles.indexOf(role) / roles.length) * 50);
      }

      // Create channels
      for (const channel of channels) {
        await this.globalBucket.acquireWithWait(1);
        await this.createChannel(manifestId, channel);
        await job.updateProgress(50 + (channels.indexOf(channel) / channels.length) * 50);
      }

      // Update shadow state
      await this.updateShadowState(manifestId);
    }, {
      connection: this.queue.opts.connection,
      concurrency: 5,
      limiter: { max: 10, duration: 1000 }
    });
  }
}
```

---

## 5. API Specifications

### 5.1 API Design Principles

- **Style:** REST with JSON
- **Versioning:** URL path (`/api/v1/...`)
- **Authentication:** Bearer token (JWT) or API key
- **Rate Limiting:** 100 req/min per tenant

### 5.2 Community Endpoints

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | /api/v1/communities | List communities for user | JWT |
| GET | /api/v1/communities/:id | Get community details | JWT |
| POST | /api/v1/communities | Create community | JWT |
| PUT | /api/v1/communities/:id | Update community | JWT + Admin |
| DELETE | /api/v1/communities/:id | Delete community | JWT + Admin + MFA |

### 5.3 Profile Endpoints

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | /api/v1/profiles/me | Get current user profile | JWT |
| GET | /api/v1/profiles/:id | Get profile by ID | JWT |
| PUT | /api/v1/profiles/me/wallet | Link wallet address | JWT |
| GET | /api/v1/profiles/:id/badges | Get profile badges | JWT |

### 5.4 Eligibility Endpoints

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | /api/v1/eligibility/check | Check eligibility for criteria | JWT |
| GET | /api/v1/eligibility/status | Get current eligibility status | JWT |

### 5.5 Example: POST /api/v1/eligibility/check

**Request:**
```http
POST /api/v1/eligibility/check
Authorization: Bearer {token}
Content-Type: application/json

{
  "walletAddress": "0x1234...",
  "criteria": {
    "type": "RANK_THRESHOLD",
    "asset": "bgt",
    "maxRank": 69
  }
}
```

**Response (200 OK):**
```json
{
  "eligible": true,
  "source": "score",
  "rank": 42,
  "tier": {
    "id": "fremen",
    "name": "Fremen",
    "color": "#A67C52"
  }
}
```

**Error Response (503 Service Unavailable):**
```json
{
  "error": {
    "code": "SCORE_SERVICE_UNAVAILABLE",
    "message": "Score service is temporarily unavailable",
    "degraded": true,
    "fallback": {
      "eligible": false,
      "source": "degraded"
    }
  }
}
```

---

## 6. Error Handling Strategy

### 6.1 Error Categories

| Category | HTTP Status | Example |
|----------|-------------|---------|
| Validation | 400 | Invalid wallet address format |
| Authentication | 401 | Expired or invalid token |
| Authorization | 403 | Not a Naib, cannot access council |
| Not Found | 404 | Community not found |
| Rate Limited | 429 | Too many requests |
| Service Degraded | 503 | Score service unavailable |
| Server Error | 500 | Unexpected error |

### 6.2 Error Response Format

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable message",
    "details": {},
    "requestId": "uuid",
    "degraded": false
  }
}
```

### 6.3 Circuit Breaker States

| State | Behavior |
|-------|----------|
| CLOSED | Normal operation, requests pass through |
| OPEN | All requests fail fast, return cached/degraded |
| HALF_OPEN | Allow single test request to check recovery |

### 6.4 Logging Strategy

- **Log Levels:** ERROR, WARN, INFO, DEBUG
- **Structured Logging:** JSON format via pino
- **Correlation IDs:** Request ID propagated through all services
- **Sensitive Data:** Wallet addresses truncated, no private keys logged

---

## 7. Testing Strategy

### 7.1 Testing Pyramid

| Level | Coverage Target | Tools |
|-------|-----------------|-------|
| Unit | 80% | Vitest |
| Integration | Key flows | Vitest + testcontainers |
| E2E | Critical paths | Playwright (web dashboard) |

### 7.2 Testing Guidelines

**Unit Tests:**
- Test domain logic in isolation
- Mock all external dependencies
- Focus on edge cases and error paths

**Integration Tests:**
- Test adapter implementations
- Use testcontainers for PostgreSQL/Redis
- Verify RLS tenant isolation

**Theme Regression Tests:**
- Sietch theme must produce identical results to v3.0 hardcoded logic
- Property-based testing for tier evaluation

### 7.3 Critical Test Cases

```typescript
// Theme regression test
describe('SietchTheme', () => {
  it('should produce identical tier results to v3.0', () => {
    const theme = SietchTheme;

    expect(theme.evaluateTier(1).tierId).toBe('naib');
    expect(theme.evaluateTier(7).tierId).toBe('naib');
    expect(theme.evaluateTier(8).tierId).toBe('fedaykin_elite');
    expect(theme.evaluateTier(70).tierId).toBe('outsider');
  });
});

// RLS isolation test
describe('TenantIsolation', () => {
  it('should prevent cross-tenant data access', async () => {
    await db.execute("SET app.current_tenant = 'tenant-a'");
    await db.insert(profiles).values({ discord_id: '123', community_id: 'tenant-a' });

    await db.execute("SET app.current_tenant = 'tenant-b'");
    const result = await db.select().from(profiles);

    expect(result).toHaveLength(0); // tenant-b cannot see tenant-a data
  });
});

// Circuit breaker test
describe('TwoTierChainProvider', () => {
  it('should fall back to native reader when score service fails', async () => {
    const scoreService = mockScoreService({ fail: true });
    const provider = new TwoTierChainProvider(nativeReader, scoreService);

    const result = await provider.checkAdvancedEligibility(address, criteria);

    expect(result.source).toBe('degraded');
    expect(result.eligible).toBe(false);
  });
});
```

### 7.4 CI/CD Integration

- Tests run on every PR
- Coverage reporting via Codecov
- Required checks: lint, typecheck, test
- Deployment blocked if tests fail

---

## 8. Development Phases

### Phase 0: Two-Tier Chain Provider (Weeks 1-2)
- [x] Design INativeReader, IScoreService interfaces
- [ ] Implement NativeBlockchainReader (viem)
- [ ] Implement ScoreServiceAdapter with circuit breaker
- [ ] Implement TwoTierChainProvider orchestration
- [ ] Write degradation matrix tests
- [ ] Delete `src/services/chain.ts` when tests pass

### Phase 1: Themes System (Weeks 3-4)
- [ ] Implement IThemeProvider interface
- [ ] Create BasicTheme (free tier)
- [ ] Create SietchTheme (premium tier)
- [ ] Implement TierEvaluator and BadgeEvaluator services
- [ ] Regression test: Sietch identical to v3.0
- [ ] Implement ThemeRegistry

### Phase 2: PostgreSQL + RLS (Weeks 5-8)
- [ ] Create Drizzle schema with tenant isolation
- [ ] Enable RLS on all tables
- [ ] Implement DrizzleStorageAdapter
- [ ] Write RLS regression tests
- [ ] Migrate data from SQLite
- [ ] Delete `profiles.db`

### Phase 3: Redis + Hybrid State (Weeks 9-10)
- [ ] Implement WizardSessionStore (Redis)
- [ ] Implement WizardEngine state machine
- [ ] Create HybridManifestRepository
- [ ] Set up S3 shadow bucket
- [ ] Test wizard survives Discord timeout
- [ ] Test session resumption

### Phase 4: BullMQ + Global Token Bucket (Weeks 11-12)
- [ ] Implement SynthesisQueue (BullMQ)
- [ ] Implement GlobalDiscordTokenBucket
- [ ] Create GlobalRateLimitedSynthesisWorker
- [ ] Implement ReconciliationController
- [ ] Load test: 100 concurrent tenants
- [ ] Verify no Discord 429 errors

### Phase 5: Vault Transit + Kill Switch (Weeks 13-14)
- [ ] Set up HCP Vault Transit
- [ ] Implement VaultSigningAdapter
- [ ] Implement KillSwitchProtocol
- [ ] Add MFA for destructive operations
- [ ] Remove all PRIVATE_KEY from .env
- [ ] Audit: verify all signing via Vault

### Phase 6: OPA Pre-Gate + HITL (Weeks 15-16)
- [ ] Create OPA policies (Rego)
- [ ] Implement PolicyAsCodePreGate
- [ ] Integrate Infracost budget check
- [ ] Create Enhanced HITL Approval Gate
- [ ] Test: delete PV auto-rejected
- [ ] Deploy full infrastructure

---

## 9. Known Risks and Mitigation

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Score Service outage | Medium | High | Two-Tier architecture with native fallback |
| Discord 429 ban | Medium | Critical | Global token bucket (50 req/sec) |
| Cross-tenant data leak | Low | Critical | PostgreSQL RLS + automated regression tests |
| Naib credential compromise | Low | High | Kill switch + MFA + Vault revocation |
| Terraform human error | Medium | High | OPA pre-gate + auto-reject dangerous ops |
| Migration data loss | Low | High | Hybrid state + S3 shadow backup |
| Theme regression | Medium | Medium | Property-based testing + v3.0 comparison |

---

## 10. Hardening Architecture (Post-Audit)

> Reference: PRD v5.1 Section 10 - Hardening Requirements (arrakis-v5-code-review.md)

This section details the technical architecture for addressing critical findings from the December 2025 external code review.

### 10.1 Audit Log Persistence Architecture

**Problem:** In-memory audit logs in `KillSwitchProtocol.ts` are lost after 1000 entries.

**Solution:** Asynchronous database persistence with write-ahead buffer.

```
┌─────────────────────────────────────────────────────────────────┐
│                  AUDIT LOG PERSISTENCE                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐       │
│  │ KillSwitch   │    │ Write-Ahead  │    │ PostgreSQL   │       │
│  │ Protocol     │───▶│ Buffer       │───▶│ audit_logs   │       │
│  │ (in-memory)  │    │ (Redis)      │    │ (persisted)  │       │
│  └──────────────┘    └──────────────┘    └──────────────┘       │
│         │                                        │               │
│         │                                        ▼               │
│         │                               ┌──────────────┐         │
│         │                               │ S3 Archive   │         │
│         └──────────────────────────────▶│ (cold)       │         │
│                failover                  └──────────────┘         │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Database Schema:**

```sql
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES communities(id),
    event_type TEXT NOT NULL,  -- 'KILL_SWITCH_ACTIVATED', 'MFA_VERIFIED', etc.
    actor_id TEXT NOT NULL,    -- User/service that triggered event
    target_scope TEXT,         -- 'GLOBAL', 'COMMUNITY', 'USER'
    target_id TEXT,            -- Affected entity ID
    payload JSONB NOT NULL,    -- Event-specific data
    hmac_signature TEXT NOT NULL,  -- Integrity verification
    created_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT valid_event_type CHECK (event_type IN (
        'KILL_SWITCH_ACTIVATED', 'KILL_SWITCH_DEACTIVATED',
        'MFA_VERIFIED', 'MFA_FAILED', 'SESSION_REVOKED',
        'VAULT_POLICY_REVOKED', 'API_KEY_ROTATED'
    ))
);

CREATE INDEX idx_audit_logs_tenant ON audit_logs(tenant_id);
CREATE INDEX idx_audit_logs_type ON audit_logs(event_type);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at);

-- RLS for tenant-scoped audit logs
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON audit_logs
    USING (tenant_id = current_setting('app.current_tenant')::UUID
           OR tenant_id IS NULL);  -- Global events visible to all

-- Retention: Partition by month for efficient archival
CREATE TABLE audit_logs_y2025m12 PARTITION OF audit_logs
    FOR VALUES FROM ('2025-12-01') TO ('2026-01-01');
```

**Implementation:**

```typescript
// packages/security/AuditLogPersistence.ts

export class AuditLogPersistence {
  private writeBuffer: Redis;
  private db: DrizzleClient;
  private flushIntervalMs = 1000;  // Flush every second

  constructor(redis: Redis, db: DrizzleClient) {
    this.writeBuffer = redis;
    this.db = db;
    this.startFlushLoop();
  }

  async log(entry: AuditLogEntry): Promise<void> {
    // Sign entry for integrity
    const signature = this.signEntry(entry);
    const signedEntry = { ...entry, hmac_signature: signature };

    // Write to Redis buffer first (fast path)
    await this.writeBuffer.rpush('audit:buffer', JSON.stringify(signedEntry));
  }

  private async flushToDB(): Promise<void> {
    const entries = await this.writeBuffer.lrange('audit:buffer', 0, 99);
    if (entries.length === 0) return;

    const parsed = entries.map(e => JSON.parse(e));

    await this.db.insert(auditLogs).values(parsed);
    await this.writeBuffer.ltrim('audit:buffer', entries.length, -1);
  }

  private signEntry(entry: AuditLogEntry): string {
    const payload = JSON.stringify(entry);
    return crypto.createHmac('sha256', process.env.AUDIT_HMAC_KEY!)
      .update(payload)
      .digest('hex');
  }
}
```

### 10.2 Circuit Breaker Observability

**Problem:** No metrics for circuit breaker state changes in ScoreServiceAdapter.

**Solution:** Prometheus metrics + alerting integration.

```typescript
// packages/adapters/chain/ScoreServiceAdapter.ts (enhanced)

import { Counter, Gauge, Histogram } from 'prom-client';

export class ScoreServiceAdapterMetrics {
  // Circuit state gauge (0=closed, 1=half-open, 2=open)
  static circuitState = new Gauge({
    name: 'score_service_circuit_state',
    help: 'Circuit breaker state (0=closed, 1=half-open, 2=open)',
  });

  // State transition counter
  static stateTransitions = new Counter({
    name: 'score_service_circuit_transitions_total',
    help: 'Circuit breaker state transitions',
    labelNames: ['from_state', 'to_state'],
  });

  // Request latency histogram
  static requestLatency = new Histogram({
    name: 'score_service_request_duration_seconds',
    help: 'Score service request latency',
    buckets: [0.1, 0.25, 0.5, 1, 2.5, 5],
  });

  // Fallback counter
  static fallbackInvocations = new Counter({
    name: 'score_service_fallback_total',
    help: 'Number of times fallback was invoked',
    labelNames: ['reason'],
  });
}

// Register circuit breaker events
this.scoreBreaker.on('open', () => {
  ScoreServiceAdapterMetrics.circuitState.set(2);
  ScoreServiceAdapterMetrics.stateTransitions.inc({
    from_state: 'half_open', to_state: 'open'
  });
  logger.warn({ event: 'circuit_open' }, 'Score service circuit opened');
});

this.scoreBreaker.on('halfOpen', () => {
  ScoreServiceAdapterMetrics.circuitState.set(1);
  ScoreServiceAdapterMetrics.stateTransitions.inc({
    from_state: 'open', to_state: 'half_open'
  });
});

this.scoreBreaker.on('close', () => {
  ScoreServiceAdapterMetrics.circuitState.set(0);
  ScoreServiceAdapterMetrics.stateTransitions.inc({
    from_state: 'half_open', to_state: 'closed'
  });
  logger.info({ event: 'circuit_closed' }, 'Score service circuit recovered');
});

this.scoreBreaker.on('fallback', () => {
  ScoreServiceAdapterMetrics.fallbackInvocations.inc({ reason: 'circuit_open' });
});
```

**Alerting Rules (Prometheus):**

```yaml
groups:
  - name: score_service_alerts
    rules:
      - alert: ScoreServiceCircuitOpen
        expr: score_service_circuit_state == 2
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Score service circuit breaker open for >5 minutes"
          description: "The circuit breaker has been open, indicating Score Service degradation"

      - alert: ScoreServiceHighLatency
        expr: histogram_quantile(0.95, score_service_request_duration_seconds_bucket) > 2
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Score service p95 latency >2s"
```

### 10.3 Session Security Enhancement

**Problem:** Wizard sessions lack IP binding or device fingerprinting.

**Solution:** Enhanced session with security context.

```typescript
// packages/wizard/SecureSession.ts

export interface SecureSessionContext {
  sessionId: string;
  userId: string;
  guildId: string;

  // Security context
  originIp: string;
  deviceFingerprint: string;
  userAgent: string;
  createdAt: Date;
  lastVerifiedAt: Date;
}

export class SecureSessionStore {
  private redis: Redis;
  private rateLimiter: RateLimiter;

  async createSession(
    interaction: Interaction,
    request: Request
  ): Promise<SecureSessionContext> {
    const ip = this.extractClientIp(request);

    // Rate limit: max 5 sessions per IP per hour
    const rateKey = `session:rate:${ip}`;
    const count = await this.redis.incr(rateKey);
    if (count === 1) await this.redis.expire(rateKey, 3600);
    if (count > 5) {
      throw new RateLimitError('Too many session creations from this IP');
    }

    const session: SecureSessionContext = {
      sessionId: crypto.randomUUID(),
      userId: interaction.user.id,
      guildId: interaction.guildId!,
      originIp: ip,
      deviceFingerprint: this.generateFingerprint(request),
      userAgent: request.headers.get('user-agent') || 'unknown',
      createdAt: new Date(),
      lastVerifiedAt: new Date(),
    };

    await this.redis.set(
      `session:${session.sessionId}`,
      JSON.stringify(session),
      'EX', 900  // 15 min TTL
    );

    return session;
  }

  async validateSession(
    sessionId: string,
    request: Request
  ): Promise<SecureSessionContext> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new SessionNotFoundError('Session expired or not found');
    }

    const currentIp = this.extractClientIp(request);
    const currentFingerprint = this.generateFingerprint(request);

    // IP mismatch - suspicious activity
    if (session.originIp !== currentIp) {
      await this.logSecurityEvent('IP_MISMATCH', session, { currentIp });
      throw new SessionSecurityError('Session IP mismatch - please restart wizard');
    }

    // Fingerprint mismatch - possible hijack attempt
    if (session.deviceFingerprint !== currentFingerprint) {
      await this.logSecurityEvent('FINGERPRINT_MISMATCH', session, { currentFingerprint });
      throw new SessionSecurityError('Session device mismatch - please restart wizard');
    }

    // Update last verified timestamp
    session.lastVerifiedAt = new Date();
    await this.redis.set(
      `session:${sessionId}`,
      JSON.stringify(session),
      'KEEPTTL'
    );

    return session;
  }

  private generateFingerprint(request: Request): string {
    const components = [
      request.headers.get('user-agent'),
      request.headers.get('accept-language'),
      request.headers.get('accept-encoding'),
    ].filter(Boolean).join('|');

    return crypto.createHash('sha256').update(components).digest('hex').slice(0, 16);
  }
}
```

### 10.4 API Key Rotation Mechanism

**Problem:** API keys have no rotation mechanism.

**Solution:** Key versioning with grace period.

```typescript
// packages/security/ApiKeyRotation.ts

export interface ApiKeyRecord {
  keyId: string;
  keyHash: string;  // Never store plaintext
  version: number;
  tenantId: string;
  createdAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
}

export class ApiKeyManager {
  private db: DrizzleClient;
  private gracePeriodHours = 24;

  async rotateKey(tenantId: string): Promise<{ newKey: string; expiresOldAt: Date }> {
    // Generate new key
    const newKeyPlaintext = this.generateSecureKey();
    const newKeyHash = await this.hashKey(newKeyPlaintext);
    const keyId = `key_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;

    // Get current key version
    const currentKey = await this.getCurrentKey(tenantId);
    const newVersion = currentKey ? currentKey.version + 1 : 1;

    // Set expiration on old key (grace period)
    const oldExpiresAt = new Date(Date.now() + this.gracePeriodHours * 60 * 60 * 1000);

    await this.db.transaction(async (tx) => {
      // Mark old key as expiring
      if (currentKey) {
        await tx.update(apiKeys)
          .set({ expiresAt: oldExpiresAt })
          .where(eq(apiKeys.keyId, currentKey.keyId));
      }

      // Insert new key
      await tx.insert(apiKeys).values({
        keyId,
        keyHash: newKeyHash,
        version: newVersion,
        tenantId,
        createdAt: new Date(),
        expiresAt: null,
        revokedAt: null,
      });
    });

    // Log rotation event
    await this.auditLog.log({
      event_type: 'API_KEY_ROTATED',
      tenant_id: tenantId,
      payload: { keyId, version: newVersion, oldExpiresAt },
    });

    // Notify tenant of rotation
    await this.notifyKeyRotation(tenantId, oldExpiresAt);

    return {
      newKey: `${keyId}.${newKeyPlaintext}`,
      expiresOldAt: oldExpiresAt,
    };
  }

  async validateKey(apiKey: string): Promise<ApiKeyRecord | null> {
    const [keyId, keyPlaintext] = apiKey.split('.');
    if (!keyId || !keyPlaintext) return null;

    const keyHash = await this.hashKey(keyPlaintext);

    const record = await this.db.select()
      .from(apiKeys)
      .where(and(
        eq(apiKeys.keyId, keyId),
        eq(apiKeys.keyHash, keyHash),
        isNull(apiKeys.revokedAt),
        or(
          isNull(apiKeys.expiresAt),
          gt(apiKeys.expiresAt, new Date())
        )
      ))
      .limit(1);

    if (record.length === 0) return null;

    // Update last used timestamp
    await this.db.update(apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiKeys.keyId, keyId));

    return record[0];
  }

  async revokeKey(keyId: string, reason: string): Promise<void> {
    await this.db.update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(eq(apiKeys.keyId, keyId));

    await this.auditLog.log({
      event_type: 'API_KEY_REVOKED',
      payload: { keyId, reason },
    });
  }
}
```

### 10.5 Error Response Standardization

**Problem:** Inconsistent error response formats across endpoints.

**Solution:** Unified `ApiError` schema with correlation IDs.

```typescript
// packages/core/errors/ApiError.ts

export enum ErrorCode {
  // Validation errors (400)
  INVALID_INPUT = 'INVALID_INPUT',
  INVALID_WALLET_ADDRESS = 'INVALID_WALLET_ADDRESS',
  INVALID_CRITERIA = 'INVALID_CRITERIA',

  // Auth errors (401)
  UNAUTHORIZED = 'UNAUTHORIZED',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',

  // Permission errors (403)
  FORBIDDEN = 'FORBIDDEN',
  INSUFFICIENT_TIER = 'INSUFFICIENT_TIER',
  MFA_REQUIRED = 'MFA_REQUIRED',

  // Not found errors (404)
  COMMUNITY_NOT_FOUND = 'COMMUNITY_NOT_FOUND',
  PROFILE_NOT_FOUND = 'PROFILE_NOT_FOUND',

  // Rate limit errors (429)
  RATE_LIMITED = 'RATE_LIMITED',
  GLOBAL_RATE_LIMITED = 'GLOBAL_RATE_LIMITED',

  // Service errors (503)
  SCORE_SERVICE_UNAVAILABLE = 'SCORE_SERVICE_UNAVAILABLE',
  CIRCUIT_BREAKER_OPEN = 'CIRCUIT_BREAKER_OPEN',

  // Server errors (500)
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

export interface ApiErrorResponse {
  error: {
    code: ErrorCode;
    message: string;
    correlationId: string;
    timestamp: string;
    details?: Record<string, unknown>;
    // Only in non-production
    stack?: string;
  };
}

export class ApiError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public statusCode: number,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ApiError';
  }

  toResponse(correlationId: string, includeStack = false): ApiErrorResponse {
    return {
      error: {
        code: this.code,
        message: this.message,
        correlationId,
        timestamp: new Date().toISOString(),
        details: this.details,
        ...(includeStack && { stack: this.stack }),
      },
    };
  }
}

// Middleware: Global error handler
export function errorHandler(err: Error, c: Context): Response {
  const correlationId = c.get('correlationId') || crypto.randomUUID();
  const isProduction = process.env.NODE_ENV === 'production';

  if (err instanceof ApiError) {
    return c.json(err.toResponse(correlationId, !isProduction), err.statusCode);
  }

  // Unknown error - sanitize in production
  logger.error({ err, correlationId }, 'Unhandled error');

  return c.json({
    error: {
      code: ErrorCode.INTERNAL_ERROR,
      message: isProduction ? 'An unexpected error occurred' : err.message,
      correlationId,
      timestamp: new Date().toISOString(),
      ...(!isProduction && { stack: err.stack }),
    },
  }, 500);
}
```

### 10.6 Hardening Validation Tests

```typescript
// tests/hardening/audit-log-persistence.test.ts
describe('Audit Log Persistence', () => {
  it('should persist logs to PostgreSQL within 1 second', async () => {
    const persistence = new AuditLogPersistence(redis, db);

    await persistence.log({
      event_type: 'KILL_SWITCH_ACTIVATED',
      actor_id: 'user-123',
      target_scope: 'COMMUNITY',
      target_id: 'community-456',
      payload: { reason: 'test' },
    });

    // Wait for flush
    await new Promise(r => setTimeout(r, 1500));

    const logs = await db.select().from(auditLogs);
    expect(logs.length).toBe(1);
    expect(logs[0].event_type).toBe('KILL_SWITCH_ACTIVATED');
  });

  it('should verify HMAC signature on retrieval', async () => {
    // Insert log directly (simulating tampering)
    await db.insert(auditLogs).values({
      event_type: 'KILL_SWITCH_ACTIVATED',
      actor_id: 'user-123',
      payload: { reason: 'test' },
      hmac_signature: 'invalid_signature',
    });

    const verifier = new AuditLogVerifier(db);
    const result = await verifier.verifyIntegrity();

    expect(result.valid).toBe(false);
    expect(result.tamperedEntries.length).toBe(1);
  });
});

// tests/hardening/session-security.test.ts
describe('Session Security', () => {
  it('should reject session from different IP', async () => {
    const store = new SecureSessionStore(redis);

    const session = await store.createSession(mockInteraction, mockRequest('1.2.3.4'));

    await expect(
      store.validateSession(session.sessionId, mockRequest('5.6.7.8'))
    ).rejects.toThrow('Session IP mismatch');
  });

  it('should rate limit session creation per IP', async () => {
    const store = new SecureSessionStore(redis);
    const ip = '1.2.3.4';

    // Create 5 sessions (limit)
    for (let i = 0; i < 5; i++) {
      await store.createSession(mockInteraction, mockRequest(ip));
    }

    // 6th should fail
    await expect(
      store.createSession(mockInteraction, mockRequest(ip))
    ).rejects.toThrow('Too many session creations');
  });
});
```

---

## 11. Coexistence Architecture

> Implements PRD v5.2 Section 11: Shadow Mode & Incumbent Migration System

This section defines the technical architecture for Arrakis to coexist alongside incumbent token-gating solutions (Collab.Land, Matrica, Guild.xyz) with progressive migration capabilities.

### 11.1 System Mode State Machine

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         COEXISTENCE STATE MACHINE                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────┐   enableParallel()   ┌──────────┐   setPrimary()   ┌───────┐ │
│  │  SHADOW  │─────────────────────▶│ PARALLEL │─────────────────▶│PRIMARY│ │
│  │          │◀─────────────────────│          │◀─────────────────│       │ │
│  └──────────┘    rollback()        └──────────┘    rollback()    └───────┘ │
│       │                                  │                            │     │
│       │                                  │    takeover()              │     │
│       │                                  ▼                            │     │
│       │                           ┌───────────┐◀──────────────────────┘     │
│       │                           │ EXCLUSIVE │  (irreversible)             │
│       └──────────────────────────▶│           │                             │
│           directTakeover()        └───────────┘                             │
│           (admin override)                                                  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

```typescript
// packages/core/domain/CoexistenceMode.ts

export enum CoexistenceMode {
  SHADOW = 'shadow',      // Observe only, no Discord mutations
  PARALLEL = 'parallel',  // Namespaced roles alongside incumbent
  PRIMARY = 'primary',    // Arrakis authoritative, incumbent backup
  EXCLUSIVE = 'exclusive' // Full takeover, incumbent removed
}

export interface CoexistenceState {
  mode: CoexistenceMode;
  incumbentProvider: IncumbentProvider | null;
  shadowStartedAt: Date | null;
  parallelEnabledAt: Date | null;
  primaryEnabledAt: Date | null;
  exclusiveEnabledAt: Date | null;
  lastRollbackAt: Date | null;
  rollbackCount: number;
}

export type IncumbentProvider = 'collabland' | 'matrica' | 'guild.xyz' | 'other';
```

### 11.2 Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    COEXISTENCE ARCHITECTURE OVERVIEW                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                        COEXISTENCE LAYER                              │  │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐   │  │
│  │  │ IncumbentDetector│  │ ShadowLedger    │  │ MigrationEngine     │   │  │
│  │  │ • Bot detection  │  │ • State tracking │  │ • Strategy exec    │   │  │
│  │  │ • Role mapping   │  │ • Divergence log │  │ • Rollback system  │   │  │
│  │  │ • Health monitor │  │ • Predictions    │  │ • Takeover flow    │   │  │
│  │  └─────────────────┘  └─────────────────┘  └─────────────────────┘   │  │
│  │                                                                       │  │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐   │  │
│  │  │ VerificationTiers│  │ GlimpseMode     │  │ ParallelRoleManager │   │  │
│  │  │ • Feature gating │  │ • Blurred views │  │ • Namespace roles   │   │  │
│  │  │ • Tier migration │  │ • Upgrade CTAs  │  │ • Position mgmt    │   │  │
│  │  └─────────────────┘  └─────────────────┘  └─────────────────────┘   │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                    │                                        │
│                                    ▼                                        │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                    EXISTING SERVICE LAYER                             │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐  ┌──────────┐   │  │
│  │  │ WizardEngine │  │ SyncService  │  │ ThemeEngine │  │ TierEval │   │  │
│  │  └──────────────┘  └──────────────┘  └─────────────┘  └──────────┘   │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 11.3 Database Schema (Shadow Ledger)

```sql
-- Shadow Ledger Tables for Coexistence

-- Incumbent tracking per guild
CREATE TABLE incumbent_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    community_id UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,  -- 'collabland', 'matrica', 'guild.xyz', 'other'
    bot_id TEXT,
    bot_username TEXT,
    verification_channel_id TEXT,
    detected_at TIMESTAMPTZ DEFAULT NOW(),
    confidence DECIMAL(3,2) NOT NULL DEFAULT 0.00,  -- 0.00-1.00
    manual_override BOOLEAN DEFAULT FALSE,
    last_health_check TIMESTAMPTZ,
    health_status TEXT DEFAULT 'unknown',  -- 'healthy', 'degraded', 'offline'

    UNIQUE(community_id)
);

CREATE INDEX idx_incumbent_community ON incumbent_configs(community_id);
ALTER TABLE incumbent_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON incumbent_configs
    USING (community_id = current_setting('app.current_tenant')::UUID);

-- Shadow member state (what Arrakis would do)
CREATE TABLE shadow_member_states (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    community_id UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
    discord_id TEXT NOT NULL,

    -- Incumbent observation
    incumbent_roles TEXT[] DEFAULT '{}',
    incumbent_last_change TIMESTAMPTZ,

    -- Arrakis calculation
    arrakis_wallet TEXT,
    arrakis_eligibility TEXT,  -- tier name or 'none'
    arrakis_conviction INTEGER DEFAULT 0,  -- 0-100
    arrakis_would_assign TEXT[] DEFAULT '{}',
    arrakis_would_revoke TEXT[] DEFAULT '{}',

    -- Comparison
    divergence_status TEXT DEFAULT 'unknown',  -- 'match', 'arrakis_higher', 'arrakis_lower', 'unknown'
    verification_tier TEXT DEFAULT 'incumbent_only',  -- 'incumbent_only', 'arrakis_basic', 'arrakis_full'

    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(community_id, discord_id)
);

CREATE INDEX idx_shadow_member_community ON shadow_member_states(community_id);
CREATE INDEX idx_shadow_member_divergence ON shadow_member_states(community_id, divergence_status);
ALTER TABLE shadow_member_states ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON shadow_member_states
    USING (community_id = current_setting('app.current_tenant')::UUID);

-- Divergence history tracking
CREATE TABLE shadow_divergences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    community_id UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
    discord_id TEXT NOT NULL,

    divergence_type TEXT NOT NULL,  -- 'promotion', 'demotion', 'addition', 'removal'
    incumbent_state TEXT NOT NULL,
    arrakis_state TEXT NOT NULL,
    reason TEXT,

    detected_at TIMESTAMPTZ DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    resolution TEXT  -- 'incumbent_matched', 'arrakis_wrong', 'still_divergent'
);

CREATE INDEX idx_divergence_community ON shadow_divergences(community_id);
CREATE INDEX idx_divergence_detected ON shadow_divergences(detected_at);
ALTER TABLE shadow_divergences ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON shadow_divergences
    USING (community_id = current_setting('app.current_tenant')::UUID);

-- Prediction accuracy tracking
CREATE TABLE shadow_predictions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    community_id UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
    discord_id TEXT NOT NULL,

    prediction_type TEXT NOT NULL,  -- 'will_lose_role', 'will_gain_role', 'will_be_promoted'
    predicted_at TIMESTAMPTZ DEFAULT NOW(),
    prediction_details JSONB DEFAULT '{}',

    outcome TEXT DEFAULT 'pending',  -- 'correct', 'incorrect', 'pending'
    outcome_at TIMESTAMPTZ
);

CREATE INDEX idx_prediction_community ON shadow_predictions(community_id);
CREATE INDEX idx_prediction_outcome ON shadow_predictions(outcome);
ALTER TABLE shadow_predictions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON shadow_predictions
    USING (community_id = current_setting('app.current_tenant')::UUID);

-- Migration state tracking
CREATE TABLE migration_states (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    community_id UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,

    current_mode TEXT NOT NULL DEFAULT 'shadow',  -- CoexistenceMode enum
    target_mode TEXT,  -- For gradual migrations
    strategy TEXT,  -- 'instant', 'gradual', 'parallel_forever', 'arrakis_primary'

    shadow_started_at TIMESTAMPTZ,
    parallel_enabled_at TIMESTAMPTZ,
    primary_enabled_at TIMESTAMPTZ,
    exclusive_enabled_at TIMESTAMPTZ,

    rollback_count INTEGER DEFAULT 0,
    last_rollback_at TIMESTAMPTZ,
    last_rollback_reason TEXT,

    readiness_check_passed BOOLEAN DEFAULT FALSE,
    accuracy_percent DECIMAL(5,2),  -- 0.00-100.00
    shadow_days INTEGER DEFAULT 0,

    UNIQUE(community_id)
);

CREATE INDEX idx_migration_community ON migration_states(community_id);
ALTER TABLE migration_states ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON migration_states
    USING (community_id = current_setting('app.current_tenant')::UUID);

-- Incumbent health check history
CREATE TABLE incumbent_health_checks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    community_id UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,

    checked_at TIMESTAMPTZ DEFAULT NOW(),
    bot_online BOOLEAN,
    last_role_update TIMESTAMPTZ,
    hours_since_role_update INTEGER,
    verification_channel_active BOOLEAN,

    status TEXT NOT NULL,  -- 'healthy', 'warning', 'critical'
    issues JSONB DEFAULT '[]'  -- Array of detected issues
);

CREATE INDEX idx_health_community ON incumbent_health_checks(community_id);
CREATE INDEX idx_health_checked ON incumbent_health_checks(checked_at);
ALTER TABLE incumbent_health_checks ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON incumbent_health_checks
    USING (community_id = current_setting('app.current_tenant')::UUID);
```

### 11.4 Component Design

#### 11.4.1 IncumbentDetector

```typescript
// packages/adapters/coexistence/IncumbentDetector.ts

export interface IncumbentInfo {
  provider: IncumbentProvider;
  confidence: number;
  bot: { id: string; username: string; joinedAt: Date } | null;
  channels: {
    verification: string | null;
    config: string | null;
  };
  roles: Array<{
    id: string;
    name: string;
    memberCount: number;
    likelyTokenGated: boolean;
    confidence: number;
  }>;
  capabilities: {
    hasBalanceCheck: boolean;
    hasConvictionScoring: boolean;
    hasTierSystem: boolean;
    hasSocialLayer: boolean;
  };
}

const KNOWN_INCUMBENTS = {
  collabland: {
    botIds: ['704521096837464076'],
    channelPatterns: ['collabland-join', 'collabland-config', 'verify'],
    rolePatterns: ['holder', 'verified', 'whale', 'member'],
  },
  matrica: {
    botIds: [''], // Add known IDs
    channelPatterns: ['matrica-verify', 'matrica'],
    rolePatterns: ['verified', 'holder'],
  },
  'guild.xyz': {
    botIds: [''], // Add known IDs
    channelPatterns: ['guild-join', 'guild-verify'],
    rolePatterns: ['guild-member', 'verified'],
  },
} as const;

export class IncumbentDetector {
  constructor(
    private readonly storage: ICoexistenceStorage,
    private readonly discordClient: Client
  ) {}

  async detectIncumbent(guildId: string): Promise<IncumbentInfo | null> {
    const guild = await this.discordClient.guilds.fetch(guildId);

    // 1. Check for known bot IDs
    for (const [provider, config] of Object.entries(KNOWN_INCUMBENTS)) {
      for (const botId of config.botIds) {
        if (!botId) continue;
        const member = guild.members.cache.get(botId);
        if (member) {
          return this.buildIncumbentInfo(guild, provider as IncumbentProvider, member);
        }
      }
    }

    // 2. Check for verification channels
    for (const [provider, config] of Object.entries(KNOWN_INCUMBENTS)) {
      for (const pattern of config.channelPatterns) {
        const channel = guild.channels.cache.find(
          c => c.name.toLowerCase().includes(pattern)
        );
        if (channel) {
          return this.buildIncumbentInfo(guild, provider as IncumbentProvider, null);
        }
      }
    }

    // 3. Check for bot with "verify" or "token-gate" in name
    const suspectBot = guild.members.cache.find(
      m => m.user.bot &&
           (m.user.username.toLowerCase().includes('verify') ||
            m.user.username.toLowerCase().includes('token'))
    );
    if (suspectBot) {
      return this.buildIncumbentInfo(guild, 'other', suspectBot);
    }

    return null;
  }

  private async buildIncumbentInfo(
    guild: Guild,
    provider: IncumbentProvider,
    botMember: GuildMember | null
  ): Promise<IncumbentInfo> {
    const config = KNOWN_INCUMBENTS[provider] || KNOWN_INCUMBENTS.collabland;

    // Find verification channel
    const verificationChannel = guild.channels.cache.find(
      c => config.channelPatterns.some(p => c.name.toLowerCase().includes(p))
    );

    // Find likely token-gated roles
    const roles = guild.roles.cache
      .filter(r => !r.managed && r.name !== '@everyone')
      .map(r => ({
        id: r.id,
        name: r.name,
        memberCount: r.members.size,
        likelyTokenGated: config.rolePatterns.some(
          p => r.name.toLowerCase().includes(p)
        ),
        confidence: config.rolePatterns.some(
          p => r.name.toLowerCase().includes(p)
        ) ? 0.8 : 0.3,
      }));

    return {
      provider,
      confidence: botMember ? 0.95 : 0.7,
      bot: botMember ? {
        id: botMember.id,
        username: botMember.user.username,
        joinedAt: botMember.joinedAt || new Date(),
      } : null,
      channels: {
        verification: verificationChannel?.id || null,
        config: null,
      },
      roles,
      capabilities: {
        hasBalanceCheck: true,
        hasConvictionScoring: false,  // Incumbents don't have this
        hasTierSystem: provider === 'collabland',
        hasSocialLayer: false,
      },
    };
  }
}
```

#### 11.4.2 ShadowLedger

```typescript
// packages/adapters/coexistence/ShadowLedger.ts

export interface ShadowSyncResult {
  processed: number;
  divergences: number;
  predictions: number;
  accuracy: number;
}

export class ShadowLedger {
  constructor(
    private readonly storage: ICoexistenceStorage,
    private readonly chainProvider: IChainProvider,
    private readonly themeEngine: IThemeProvider,
    private readonly walletRegistry: IWalletRegistry
  ) {}

  async syncGuild(guildId: string): Promise<ShadowSyncResult> {
    const config = await this.storage.getMigrationState(guildId);

    // CRITICAL: Verify we're in shadow mode
    if (config.current_mode !== 'shadow') {
      throw new Error('Shadow sync only runs in shadow mode');
    }

    const guild = await this.discordClient.guilds.fetch(guildId);
    const incumbent = await this.storage.getIncumbentConfig(guildId);
    const members = await guild.members.fetch();

    let processed = 0;
    let divergences = 0;

    for (const [memberId, member] of members) {
      if (member.user.bot) continue;

      // 1. Snapshot incumbent state
      const incumbentRoles = member.roles.cache
        .filter(r => incumbent.roles?.some(ir => ir.id === r.id))
        .map(r => r.id);

      // 2. Calculate Arrakis state (if wallet connected)
      const wallet = await this.walletRegistry.getWalletForDiscord(memberId);
      let arrakisState = {
        eligibility: 'unknown',
        conviction: 0,
        wouldAssign: [] as string[],
        wouldRevoke: [] as string[],
      };

      if (wallet) {
        const eligibility = await this.chainProvider.evaluateEligibility(
          wallet,
          guildId
        );
        const tier = this.themeEngine.evaluateTier(eligibility.rank);

        arrakisState = {
          eligibility: tier.name,
          conviction: eligibility.conviction || 0,
          wouldAssign: [tier.roleId],
          wouldRevoke: incumbentRoles.filter(r => !tier.roleId),
        };
      }

      // 3. Detect divergence
      const divergence = this.detectDivergence(incumbentRoles, arrakisState);
      if (divergence) {
        await this.storage.recordDivergence(guildId, memberId, divergence);
        divergences++;
      }

      // 4. Update shadow state (NO DISCORD CHANGES)
      await this.storage.updateShadowMemberState(guildId, memberId, {
        incumbent_roles: incumbentRoles,
        arrakis_wallet: wallet,
        arrakis_eligibility: arrakisState.eligibility,
        arrakis_conviction: arrakisState.conviction,
        arrakis_would_assign: arrakisState.wouldAssign,
        arrakis_would_revoke: arrakisState.wouldRevoke,
        divergence_status: divergence?.type || 'match',
      });

      processed++;
    }

    // 5. Validate previous predictions
    const predictions = await this.validatePredictions(guildId);

    // 6. Calculate accuracy
    const accuracy = await this.calculateAccuracy(guildId);

    return { processed, divergences, predictions, accuracy };
  }

  private detectDivergence(
    incumbentRoles: string[],
    arrakisState: { eligibility: string; wouldAssign: string[] }
  ): { type: string; details: string } | null {
    if (arrakisState.eligibility === 'unknown') return null;

    const hasIncumbentRole = incumbentRoles.length > 0;
    const wouldHaveArrakisRole = arrakisState.wouldAssign.length > 0;

    if (!hasIncumbentRole && wouldHaveArrakisRole) {
      return { type: 'arrakis_higher', details: 'User qualifies but incumbent missed' };
    }
    if (hasIncumbentRole && !wouldHaveArrakisRole) {
      return { type: 'arrakis_lower', details: 'Incumbent granted but user no longer qualifies' };
    }
    return null;
  }

  private async calculateAccuracy(guildId: string): Promise<number> {
    const states = await this.storage.getShadowMemberStates(guildId);
    const total = states.length;
    const matches = states.filter(s => s.divergence_status === 'match').length;
    return total > 0 ? (matches / total) * 100 : 100;
  }
}
```

#### 11.4.3 ParallelRoleManager

```typescript
// packages/adapters/coexistence/ParallelRoleManager.ts

export interface ParallelRoleConfig {
  namespace: string;  // Default: 'arrakis'
  positioning: 'below_incumbent' | 'custom';
  roles: Array<{
    name: string;
    color: string;
    grantCondition: string;
  }>;
}

export class ParallelRoleManager {
  private readonly NAMESPACE = 'arrakis';

  constructor(
    private readonly storage: ICoexistenceStorage,
    private readonly discordClient: Client
  ) {}

  async setupParallelRoles(guildId: string): Promise<void> {
    const guild = await this.discordClient.guilds.fetch(guildId);
    const incumbent = await this.storage.getIncumbentConfig(guildId);
    const config = await this.getParallelConfig(guildId);

    // Find incumbent's highest role for positioning
    const incumbentHighestRole = guild.roles.cache
      .filter(r => incumbent.roles?.some(ir => ir.id === r.id))
      .sort((a, b) => b.position - a.position)
      .first();

    const targetPosition = incumbentHighestRole
      ? incumbentHighestRole.position - 1
      : 1;

    for (const roleDef of config.roles) {
      const roleName = `${this.NAMESPACE}-${roleDef.name}`;
      const existing = guild.roles.cache.find(r => r.name === roleName);

      if (!existing) {
        await guild.roles.create({
          name: roleName,
          color: roleDef.color as ColorResolvable,
          reason: 'Arrakis parallel mode setup',
          position: targetPosition,
          permissions: [],  // No special permissions (security)
          hoist: false,
          mentionable: false,
        });
      }
    }
  }

  async syncParallelRoles(guildId: string): Promise<{ added: number; removed: number }> {
    const guild = await this.discordClient.guilds.fetch(guildId);
    const shadowStates = await this.storage.getShadowMemberStates(guildId);

    let added = 0;
    let removed = 0;

    for (const state of shadowStates) {
      if (state.verification_tier === 'incumbent_only') continue;

      const member = await guild.members.fetch(state.discord_id).catch(() => null);
      if (!member) continue;

      // Add roles user should have
      for (const roleName of state.arrakis_would_assign) {
        const role = guild.roles.cache.find(
          r => r.name === `${this.NAMESPACE}-${roleName}`
        );
        if (role && !member.roles.cache.has(role.id)) {
          await member.roles.add(role, 'Arrakis parallel sync');
          added++;
        }
      }

      // Remove roles user shouldn't have
      for (const role of member.roles.cache.values()) {
        if (!role.name.startsWith(`${this.NAMESPACE}-`)) continue;

        const baseName = role.name.replace(`${this.NAMESPACE}-`, '');
        if (!state.arrakis_would_assign.includes(baseName)) {
          await member.roles.remove(role, 'Arrakis parallel sync');
          removed++;
        }
      }
    }

    return { added, removed };
  }

  private async getParallelConfig(guildId: string): Promise<ParallelRoleConfig> {
    // Default configuration - could be customized per guild
    return {
      namespace: this.NAMESPACE,
      positioning: 'below_incumbent',
      roles: [
        { name: 'verified', color: '#808080', grantCondition: 'wallet_connected' },
        { name: 'naib', color: '#FFD700', grantCondition: 'tier >= naib' },
        { name: 'fedaykin', color: '#C0C0C0', grantCondition: 'tier >= fedaykin' },
        { name: 'diamond', color: '#00FFFF', grantCondition: 'conviction >= 90' },
      ],
    };
  }
}
```

#### 11.4.4 MigrationEngine

```typescript
// packages/adapters/coexistence/MigrationEngine.ts

export type MigrationStrategy = 'instant' | 'gradual' | 'parallel_forever' | 'arrakis_primary';

export interface MigrationPlan {
  strategy: MigrationStrategy;
  readinessChecks: {
    minShadowDays: number;
    minAccuracyPercent: number;
    adminApproval: boolean;
  };
  rollback: {
    enabled: boolean;
    autoTrigger: boolean;
    thresholds: {
      accessLossPercent: number;
      errorRatePercent: number;
      windowMinutes: number;
    };
  };
}

export class MigrationEngine {
  constructor(
    private readonly storage: ICoexistenceStorage,
    private readonly parallelRoleManager: ParallelRoleManager,
    private readonly alertService: IAlertService
  ) {}

  async checkReadiness(guildId: string): Promise<{
    ready: boolean;
    checks: Record<string, { passed: boolean; value: any; required: any }>;
  }> {
    const state = await this.storage.getMigrationState(guildId);
    const plan = await this.getMigrationPlan(guildId);

    const shadowDays = state.shadow_started_at
      ? Math.floor((Date.now() - state.shadow_started_at.getTime()) / (1000 * 60 * 60 * 24))
      : 0;

    const accuracy = state.accuracy_percent || 0;

    const checks = {
      shadowDuration: {
        passed: shadowDays >= plan.readinessChecks.minShadowDays,
        value: shadowDays,
        required: plan.readinessChecks.minShadowDays,
      },
      accuracy: {
        passed: accuracy >= plan.readinessChecks.minAccuracyPercent,
        value: accuracy,
        required: plan.readinessChecks.minAccuracyPercent,
      },
      zeroDivergencesRecent: {
        passed: await this.checkRecentDivergences(guildId) === 0,
        value: await this.checkRecentDivergences(guildId),
        required: 0,
      },
    };

    return {
      ready: Object.values(checks).every(c => c.passed),
      checks,
    };
  }

  async executeMigration(
    guildId: string,
    strategy: MigrationStrategy,
    adminId: string
  ): Promise<void> {
    const readiness = await this.checkReadiness(guildId);
    if (!readiness.ready) {
      throw new Error('Migration readiness checks not passed');
    }

    await this.storage.updateMigrationState(guildId, {
      strategy,
      target_mode: strategy === 'instant' ? 'exclusive' : 'parallel',
    });

    switch (strategy) {
      case 'instant':
        await this.executeInstantMigration(guildId, adminId);
        break;
      case 'gradual':
        await this.executeGradualMigration(guildId, adminId);
        break;
      case 'parallel_forever':
        await this.enableParallelMode(guildId, adminId);
        break;
      case 'arrakis_primary':
        await this.enablePrimaryMode(guildId, adminId);
        break;
    }
  }

  async rollback(guildId: string, reason: string): Promise<void> {
    const state = await this.storage.getMigrationState(guildId);

    // Can't rollback from exclusive
    if (state.current_mode === 'exclusive') {
      throw new Error('Cannot rollback from exclusive mode');
    }

    // Determine target mode
    const targetMode = state.current_mode === 'primary'
      ? 'parallel'
      : 'shadow';

    await this.storage.updateMigrationState(guildId, {
      current_mode: targetMode,
      rollback_count: state.rollback_count + 1,
      last_rollback_at: new Date(),
      last_rollback_reason: reason,
    });

    // Notify admin
    await this.alertService.sendAdminAlert(guildId, {
      type: 'rollback_executed',
      message: `Migration rolled back to ${targetMode} mode. Reason: ${reason}`,
    });
  }

  private async checkRecentDivergences(guildId: string): Promise<number> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const divergences = await this.storage.getDivergences(guildId, sevenDaysAgo);
    return divergences.length;
  }
}
```

#### 11.4.5 IncumbentHealthMonitor

```typescript
// packages/adapters/coexistence/IncumbentHealthMonitor.ts

export interface HealthCheckResult {
  guildId: string;
  status: 'healthy' | 'warning' | 'critical';
  issues: Array<{
    severity: 'warning' | 'critical';
    issue: string;
    message: string;
    detectedAt: Date;
  }>;
  checkedAt: Date;
}

const THRESHOLDS = {
  roleUpdateFreshness: {
    warning: 48 * 60 * 60 * 1000,   // 48 hours
    critical: 72 * 60 * 60 * 1000,  // 72 hours
  },
  botOffline: {
    warning: 60 * 60 * 1000,        // 1 hour
    critical: 4 * 60 * 60 * 1000,   // 4 hours
  },
  verificationActivity: {
    warning: 168 * 60 * 60 * 1000,  // 7 days
  },
};

export class IncumbentHealthMonitor {
  constructor(
    private readonly storage: ICoexistenceStorage,
    private readonly discordClient: Client,
    private readonly alertService: IAlertService
  ) {}

  async checkHealth(guildId: string): Promise<HealthCheckResult> {
    const guild = await this.discordClient.guilds.fetch(guildId);
    const incumbent = await this.storage.getIncumbentConfig(guildId);
    const issues: HealthCheckResult['issues'] = [];

    if (!incumbent.bot_id) {
      return { guildId, status: 'healthy', issues: [], checkedAt: new Date() };
    }

    // Check 1: Bot online
    const botMember = guild.members.cache.get(incumbent.bot_id);
    if (!botMember || botMember.presence?.status === 'offline') {
      issues.push({
        severity: 'warning',
        issue: 'incumbent_bot_offline',
        message: `${incumbent.provider} bot appears offline`,
        detectedAt: new Date(),
      });
    }

    // Check 2: Role update freshness
    const lastRoleChange = await this.storage.getLastRoleChange(guildId);
    if (lastRoleChange) {
      const hoursSince = (Date.now() - lastRoleChange.getTime()) / (1000 * 60 * 60);

      if (Date.now() - lastRoleChange.getTime() > THRESHOLDS.roleUpdateFreshness.critical) {
        issues.push({
          severity: 'critical',
          issue: 'incumbent_stale',
          message: `${incumbent.provider} hasn't updated roles in ${Math.floor(hoursSince)} hours`,
          detectedAt: new Date(),
        });
      } else if (Date.now() - lastRoleChange.getTime() > THRESHOLDS.roleUpdateFreshness.warning) {
        issues.push({
          severity: 'warning',
          issue: 'incumbent_slow',
          message: `${incumbent.provider} role updates appear delayed`,
          detectedAt: new Date(),
        });
      }
    }

    // Determine overall status
    const status = issues.some(i => i.severity === 'critical') ? 'critical'
      : issues.length > 0 ? 'warning'
      : 'healthy';

    // Store health check
    await this.storage.recordHealthCheck(guildId, {
      status,
      issues,
      bot_online: !!botMember?.presence?.status !== 'offline',
      last_role_update: lastRoleChange,
    });

    // Alert admin if issues found
    if (status !== 'healthy') {
      await this.sendHealthAlert(guildId, { status, issues });
    }

    return { guildId, status, issues, checkedAt: new Date() };
  }

  private async sendHealthAlert(
    guildId: string,
    result: Pick<HealthCheckResult, 'status' | 'issues'>
  ): Promise<void> {
    const config = await this.storage.getMigrationState(guildId);

    // Check throttle
    const lastAlert = await this.storage.getLastHealthAlert(guildId);
    if (lastAlert && Date.now() - lastAlert.getTime() < 4 * 60 * 60 * 1000) {
      return; // 4 hour throttle
    }

    await this.alertService.sendAdminAlert(guildId, {
      type: 'incumbent_health_issue',
      status: result.status,
      issues: result.issues,
      arrakisReady: config.current_mode !== 'shadow' || config.readiness_check_passed,
      actions: [
        { label: 'Activate Arrakis Backup', action: 'activate_backup' },
        { label: 'Dismiss', action: 'dismiss' },
        { label: 'Check Incumbent Status', action: 'check_status' },
      ],
    });
  }
}
```

### 11.5 Verification Tiers Service

```typescript
// packages/core/services/VerificationTiersService.ts

export type VerificationTier = 'incumbent_only' | 'arrakis_basic' | 'arrakis_full';

export interface TierFeatures {
  shadowTracking: boolean;
  publicLeaderboard: boolean;
  profileView: boolean;
  badgesEarn: boolean;
  convictionScore: boolean;
  tierProgression: boolean | 'preview';
}

const TIER_FEATURES: Record<VerificationTier, TierFeatures> = {
  incumbent_only: {
    shadowTracking: true,
    publicLeaderboard: true,  // Wallet hidden
    profileView: false,
    badgesEarn: false,
    convictionScore: false,
    tierProgression: false,
  },
  arrakis_basic: {
    shadowTracking: true,
    publicLeaderboard: true,
    profileView: true,
    badgesEarn: false,
    convictionScore: true,
    tierProgression: 'preview',
  },
  arrakis_full: {
    shadowTracking: false,
    publicLeaderboard: true,
    profileView: true,
    badgesEarn: true,
    convictionScore: true,
    tierProgression: true,
  },
};

export class VerificationTiersService {
  constructor(
    private readonly storage: ICoexistenceStorage,
    private readonly walletRegistry: IWalletRegistry
  ) {}

  async getMemberTier(guildId: string, discordId: string): Promise<VerificationTier> {
    const state = await this.storage.getMigrationState(guildId);

    // Full features if in primary or exclusive mode
    if (state.current_mode === 'primary' || state.current_mode === 'exclusive') {
      return 'arrakis_full';
    }

    // Check if wallet connected
    const wallet = await this.walletRegistry.getWalletForDiscord(discordId);
    if (wallet) {
      return 'arrakis_basic';
    }

    return 'incumbent_only';
  }

  getFeatures(tier: VerificationTier): TierFeatures {
    return TIER_FEATURES[tier];
  }

  async canAccess(
    guildId: string,
    discordId: string,
    feature: keyof TierFeatures
  ): Promise<boolean> {
    const tier = await this.getMemberTier(guildId, discordId);
    const features = this.getFeatures(tier);
    return !!features[feature];
  }
}
```

### 11.6 Coexistence API Endpoints

```typescript
// packages/api/routes/coexistence.ts

// GET /api/v1/coexistence/:guildId/status
interface CoexistenceStatusResponse {
  mode: CoexistenceMode;
  incumbent: {
    provider: string | null;
    healthy: boolean;
    lastCheck: string | null;
  };
  shadow: {
    membersTracked: number;
    accuracy: number;
    divergences: number;
  };
  readiness: {
    ready: boolean;
    checks: Record<string, { passed: boolean; value: any; required: any }>;
  };
}

// POST /api/v1/coexistence/:guildId/mode
interface SetModeRequest {
  mode: CoexistenceMode;
  strategy?: MigrationStrategy;
  confirmation?: {
    communityName: string;
    acknowledgeRollback: boolean;
    adminId: string;
  };
}

// POST /api/v1/coexistence/:guildId/rollback
interface RollbackRequest {
  reason: string;
  adminId: string;
}

// GET /api/v1/coexistence/:guildId/shadow/divergences
interface DivergencesResponse {
  divergences: Array<{
    discordId: string;
    type: string;
    incumbentState: string;
    arrakisState: string;
    detectedAt: string;
  }>;
  total: number;
  accuracy: number;
}

// POST /api/v1/coexistence/:guildId/emergency-backup
interface EmergencyBackupRequest {
  adminId: string;
  confirmation: boolean;
}
```

### 11.7 Scheduled Jobs

```typescript
// packages/jobs/coexistence/ShadowSyncJob.ts

// Runs every 6 hours via trigger.dev
export const shadowSyncJob = task({
  id: 'shadow-sync',
  run: async (payload: { guildId: string }) => {
    const shadowLedger = container.get(ShadowLedger);
    const migrationState = await storage.getMigrationState(payload.guildId);

    // Only run in shadow mode
    if (migrationState.current_mode !== 'shadow') {
      return { skipped: true, reason: 'Not in shadow mode' };
    }

    return shadowLedger.syncGuild(payload.guildId);
  },
  retry: {
    maxAttempts: 3,
    factor: 2,
    minTimeout: 5000,
  },
});

// Runs every hour
export const incumbentHealthJob = task({
  id: 'incumbent-health',
  run: async (payload: { guildId: string }) => {
    const healthMonitor = container.get(IncumbentHealthMonitor);
    return healthMonitor.checkHealth(payload.guildId);
  },
  retry: {
    maxAttempts: 2,
    factor: 2,
    minTimeout: 2000,
  },
});

// Runs every hour - check for auto-rollback conditions
export const rollbackWatcherJob = task({
  id: 'rollback-watcher',
  run: async (payload: { guildId: string }) => {
    const migrationEngine = container.get(MigrationEngine);
    const state = await storage.getMigrationState(payload.guildId);

    // Only monitor during active migrations
    if (state.current_mode === 'shadow' || state.current_mode === 'exclusive') {
      return { skipped: true };
    }

    // Check for auto-rollback conditions
    const metrics = await getRecentMigrationMetrics(payload.guildId);

    if (metrics.accessLossPercent > 5 || metrics.errorRatePercent > 10) {
      await migrationEngine.rollback(
        payload.guildId,
        `Auto-rollback triggered: access loss ${metrics.accessLossPercent}%, error rate ${metrics.errorRatePercent}%`
      );
      return { rolledBack: true, reason: 'threshold_exceeded' };
    }

    return { rolledBack: false };
  },
});
```

### 11.8 Coexistence Testing Strategy

```typescript
// tests/coexistence/shadow-ledger.test.ts
describe('ShadowLedger', () => {
  it('should never mutate Discord in shadow mode', async () => {
    const discordSpy = vi.spyOn(discordClient.guilds, 'fetch');
    const ledger = new ShadowLedger(storage, chainProvider, themeEngine, walletRegistry);

    await ledger.syncGuild(testGuildId);

    // Verify no role modifications were made
    expect(discordSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ method: 'PATCH' })
    );
  });

  it('should detect divergence when arrakis would grant higher tier', async () => {
    // Setup: User has @Holder from incumbent
    // Arrakis calculates they should be Fedaykin

    const result = await ledger.syncGuild(testGuildId);

    expect(result.divergences).toBe(1);
    const divergence = await storage.getDivergences(testGuildId);
    expect(divergence[0].divergence_type).toBe('arrakis_higher');
  });
});

// tests/coexistence/migration-engine.test.ts
describe('MigrationEngine', () => {
  it('should block migration if readiness checks fail', async () => {
    const engine = new MigrationEngine(storage, parallelRoleManager, alertService);

    // Setup: Only 5 days in shadow mode (need 14)
    await storage.updateMigrationState(testGuildId, {
      shadow_started_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
    });

    await expect(
      engine.executeMigration(testGuildId, 'instant', 'admin-123')
    ).rejects.toThrow('readiness checks not passed');
  });

  it('should auto-rollback when access loss exceeds threshold', async () => {
    // Setup: 10% access loss in last hour
    await simulateAccessLoss(testGuildId, 0.10);

    await rollbackWatcherJob.trigger({ guildId: testGuildId });

    const state = await storage.getMigrationState(testGuildId);
    expect(state.current_mode).toBe('shadow');
    expect(state.rollback_count).toBe(1);
  });
});
```

### 11.9 Coexistence Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `coexistence_mode` | gauge | Current mode per guild (0=shadow, 1=parallel, 2=primary, 3=exclusive) |
| `shadow_sync_duration_seconds` | histogram | Time to complete shadow sync |
| `shadow_divergences_total` | counter | Total divergences detected |
| `shadow_accuracy_percent` | gauge | Current accuracy vs incumbent |
| `migration_rollbacks_total` | counter | Number of rollbacks executed |
| `incumbent_health_status` | gauge | Incumbent health (0=healthy, 1=warning, 2=critical) |
| `verification_tier_distribution` | gauge | Members per verification tier |

---

## 12. Open Questions

| Question | Owner | Due Date | Status |
|----------|-------|----------|--------|
| Score Service API contract finalization | Backend Team | TBD | Open |
| Collab.Land integration scope | Product | TBD | Addressed (Section 11) |
| Enterprise theme customization limits | Product | TBD | Open |
| Telegram feature parity timeline | Product | TBD | Open |
| Multi-incumbent handling (CL + Matrica) | Product | TBD | Open |
| Conviction calculation scope (per-community vs global) | Product | TBD | Open |

---

## 13. Appendix

### A. Glossary

| Term | Definition |
|------|------------|
| Naib | Top 7 ranked holders, community administrators |
| Fedaykin | Ranks 8-30, trusted community members |
| Sietch | Dune-inspired community space |
| Water Sharer | Badge lineage system for member referrals |
| RLS | Row-Level Security in PostgreSQL |
| Circuit Breaker | Pattern to prevent cascade failures |
| Shadow State | Record of last successfully applied Discord state |

### B. References

- [PRD v5.2](loa-grimoire/prd.md) - Includes Coexistence Architecture requirements
- [Architecture Spec v5.5.1](loa-grimoire/context/new-context/arrakis-saas-architecture.md)
- [Coexistence Architecture Spec](loa-grimoire/context/ARRAKIS_COEXISTENCE_ARCHITECTURE.md) - Shadow Mode & Incumbent Migration
- [Discord.js Documentation](https://discord.js.org/)
- [Drizzle ORM](https://orm.drizzle.team/)
- [BullMQ](https://docs.bullmq.io/)
- [opossum Circuit Breaker](https://nodeshift.dev/opossum/)
- [HashiCorp Vault Transit](https://developer.hashicorp.com/vault/docs/secrets/transit)

### C. Change Log

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 4.1 | 2025-12-27 | Telegram integration | Architecture Designer |
| 5.0 | 2025-12-28 | SaaS transformation - complete redesign | Architecture Designer |
| 5.1 | 2025-12-29 | Added Section 10: Hardening Architecture from external code review | Architecture Designer |
| 5.2 | 2025-12-30 | Added Section 11: Coexistence Architecture (Shadow Mode, Migration Engine, Incumbent Monitoring) | Architecture Designer |

---

*Generated by Architecture Designer Agent*
*Next Steps:*
1. *Complete hardening requirements (Section 10) sprints 51-55*
2. *Implement Coexistence Architecture (Section 11) sprints 56-65*

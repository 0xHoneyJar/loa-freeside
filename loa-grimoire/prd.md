# Product Requirements Document: Arrakis v5.0

**Version**: 5.0
**Date**: December 28, 2025
**Status**: DRAFT
**Codename**: The Transformation

---

## Document Traceability

| Section | Primary Source | Secondary Sources |
|---------|---------------|-------------------|
| Problem Statement | arrakis-saas-architecture.md §1-2 | v4.1 PRD, CHANGELOG |
| Two-Tier Chain Provider | arrakis-saas-architecture.md §3.7 | 15 audit rounds |
| Themes System | arrakis-saas-architecture.md §4 | SietchTheme, BasicTheme |
| Hexagonal Architecture | arrakis-saas-architecture.md §5 | Loa framework patterns |
| Infrastructure Phases | arrakis-saas-architecture.md §10 | Implementation prompt |
| WizardEngine | arrakis-saas-architecture.md §7 | Discord API constraints |

---

## 1. Executive Summary

### 1.1 Product Overview

**Arrakis v5.0 "The Transformation"** refactors the Sietch codebase from a bespoke Berachain Discord bot into a **multi-tenant, chain-agnostic SaaS platform**. This architectural transformation enables any community to deploy token-gated infrastructure through a guided wizard interface—similar to how Shopify enables merchants to launch stores without code.

### 1.2 Problem Statement

**Current State (v4.1):**
- Single-tenant Discord bot for BGT holders
- Hardcoded 9-tier Dune-themed progression
- SQLite database (no multi-tenancy)
- Direct viem/RPC coupling to Berachain
- Manual onboarding process

**Target State (v5.0):**
- Multi-tenant SaaS platform (1000+ communities)
- Configurable themes (BasicTheme free, SietchTheme premium)
- PostgreSQL with Row-Level Security
- Chain-agnostic via Score Service API
- Self-service WizardEngine onboarding
- FAANG-tier infrastructure (Vault, BullMQ, Redis)

**Why Now:**
- v4.1 infrastructure is stable (33 sprints completed)
- Score Service enables chain abstraction (closed-source)
- Theme System enables product differentiation
- Market demand for token-gated community tooling
- 15 adversarial audit rounds validated the architecture

### 1.3 Vision

Arrakis becomes a **"Shopify for token-gated communities"**:

- **For community operators**: Self-service wizard deploys full infrastructure
- **For developers**: Hexagonal architecture enables clean extensibility
- **For enterprises**: Multi-tenant with RLS, Vault encryption, audit trails
- **For the ecosystem**: Chain-agnostic support (EVM, Solana, future chains)

### 1.4 Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Communities onboarded | 100 in 6 months | Database count |
| Onboarding completion rate | >80% | Wizard funnel analytics |
| SietchTheme parity | 100% identical to v4.1 | Regression test suite |
| Score Service resilience | <1% degraded requests | Circuit breaker metrics |
| Discord 429 rate | 0 global bans | API error logs |
| Tenant isolation | 100% RLS coverage | Security audit |

### 1.5 Preserved v4.1 Capabilities

**CRITICAL**: All v4.1 features MUST continue working with SietchTheme:

| Feature | Sprint | Preservation Strategy |
|---------|--------|----------------------|
| 9-tier progression | 15-18 | Extract to SietchTheme |
| Badge system (10 types) | 16-17 | Extract to theme badges |
| Weekly digest | 20 | Per-tenant scheduling |
| Telegram bot | 30-33 | Platform adapter |
| Stripe billing | 23-29 | Theme subscription tiers |
| Cross-platform identity | 30 | IdentityService unchanged |

---

## 2. User Personas

### 2.1 Primary: Community Operator

**Profile:**
- Token project founder or community lead
- Has Discord/Telegram server, wants token-gating
- Non-technical (cannot deploy code)
- Wants quick setup without developer dependency

**Pain Points:**
- Complex Collab.Land configuration
- No tiered progression systems available
- Manual eligibility management
- No badge/gamification options

**Goals:**
- 15-minute self-service deployment
- Configurable tiers and badges
- Automatic role management
- Analytics dashboard

### 2.2 Secondary: Enterprise Admin

**Profile:**
- Multi-community operator (DAO, NFT collective)
- Needs multi-tenant management
- Compliance requirements (audit trails)
- Custom theme requirements

**Pain Points:**
- Managing multiple Discord servers manually
- No unified member view across communities
- Compliance burden for audit trails
- Vendor lock-in to single chain

**Goals:**
- Single dashboard for all communities
- Custom enterprise themes
- Full audit trail and compliance
- Chain-agnostic flexibility

### 2.3 Tertiary: Platform Developer

**Profile:**
- Building integrations on Arrakis
- Needs API access and extensibility
- Wants to contribute themes/adapters

**Pain Points:**
- Tightly coupled codebase
- No extension points
- Limited documentation

**Goals:**
- Clean hexagonal architecture
- Port/adapter extensibility
- Theme marketplace participation

---

## 3. Architecture Overview

### 3.1 Two-Tier Chain Provider (Resilience Architecture)

> Source: arrakis-saas-architecture.md §3.7

**Critical Decision**: Separate blockchain queries into two tiers for resilience:

```
TIER 1: Native Reader (Always Available)
  └── Binary checks: hasBalance(), ownsNFT()
  └── Direct viem RPC, minimal dependencies
  └── Core token-gating survives Score outages

TIER 2: Score Service (Complex Queries)
  └── Ranking, history, cross-chain aggregation
  └── Circuit Breaker with cached fallback
  └── Graceful degradation when unavailable
```

**Degradation Matrix:**

| Query Type | Score DOWN | Fallback Behavior |
|------------|------------|-------------------|
| Token Balance | ✅ Works | Native Reader |
| NFT Ownership | ✅ Works | Native Reader |
| Rank Threshold | ⚠️ Degraded | Balance check (permissive) |
| Never Redeemed | ⚠️ Degraded | Cached or deny (safe) |
| Activity Score | ❌ Unavailable | Return 0 or cached |

### 3.2 Themes System (Configuration Abstraction)

> Source: arrakis-saas-architecture.md §4

**Critical Decision**: Abstract tier/badge/naming into injectable themes:

```typescript
interface IThemeProvider {
  getTierConfig(): TierDefinition[];
  getBadgeConfig(): BadgeDefinition[];
  getNamingConfig(): NamingConfig;
  evaluateTier(rank: number): TierResult;
  evaluateBadges(member: MemberContext): EarnedBadge[];
}
```

**Built-in Themes:**

| Theme | Tiers | Badges | Pricing |
|-------|-------|--------|---------|
| BasicTheme | 3 (Gold/Silver/Bronze) | 5 | Free |
| SietchTheme | 9 (Naib→Outsider) | 10+ | Premium |
| Custom | Unlimited | Unlimited | Enterprise |

### 3.3 Hexagonal Architecture

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

---

## 4. Functional Requirements

### Phase 0: Two-Tier Chain Provider (Foundation)

#### FR-5.0.1: Native Blockchain Reader

**Description**: Lightweight viem client for binary checks.

**Acceptance Criteria**:
- [ ] `hasBalance(address, token, minAmount)` returns boolean
- [ ] `ownsNFT(address, collection, tokenId?)` returns boolean
- [ ] `getBalance(address, token)` returns bigint
- [ ] No Score Service dependency
- [ ] <100ms response time

#### FR-5.0.2: Score Service Adapter

**Description**: HTTP client for complex Score API queries.

**Acceptance Criteria**:
- [ ] Implements `IChainProvider` interface
- [ ] `getRankedHolders(asset, limit)` returns ranked list
- [ ] `getAddressRank(address, asset)` returns rank or null
- [ ] `checkActionHistory(address, action)` returns boolean
- [ ] Circuit breaker with 50% error threshold
- [ ] Cached fallback on circuit open

#### FR-5.0.3: Two-Tier Orchestration

**Description**: Coordinate Native Reader and Score Service.

**Acceptance Criteria**:
- [ ] `checkBasicEligibility()` uses Native Reader only
- [ ] `checkAdvancedEligibility()` uses Score with fallback
- [ ] Degraded mode returns `source: 'native_degraded'`
- [ ] Metrics track circuit state changes
- [ ] All 141 existing tests pass

### Phase 1: Themes System

#### FR-5.1.1: Theme Interface

**Description**: Port definition for theme providers.

**Acceptance Criteria**:
- [ ] `IThemeProvider` interface defined in `packages/core/ports/`
- [ ] Methods: `getTierConfig()`, `getBadgeConfig()`, `getNamingConfig()`
- [ ] Methods: `evaluateTier()`, `evaluateBadges()`
- [ ] Subscription tier enforcement (free/premium/enterprise)

#### FR-5.1.2: BasicTheme Implementation

**Description**: Free tier theme with 3 tiers and 5 badges.

**Acceptance Criteria**:
- [ ] 3 tiers: Gold (1-10), Silver (11-50), Bronze (51-100)
- [ ] 5 badges: Early Adopter, Veteran, Top Tier, Active, Contributor
- [ ] Generic naming (no themed language)
- [ ] Available to all subscription tiers

#### FR-5.1.3: SietchTheme Implementation

**Description**: Premium Dune-themed progression (v4.1 parity).

**Acceptance Criteria**:
- [ ] 9 tiers: Naib, Fedaykin Elite, Fedaykin, Fremen, Wanderer, Initiate, Aspirant, Observer, Outsider
- [ ] 10+ badges: First Wave, Veteran, Diamond Hands, Council, Survivor, Streak Master, Engaged, Contributor, Pillar, Water Sharer
- [ ] Dune naming conventions (STILLSUIT, NAIB COUNCIL, etc.)
- [ ] **REGRESSION**: Identical tier/badge results to v4.1 hardcoded logic
- [ ] Premium subscription required

#### FR-5.1.4: Theme Registry

**Description**: Runtime theme selection per community.

**Acceptance Criteria**:
- [ ] `ThemeRegistry.get(themeId)` returns theme instance
- [ ] `getAvailableThemes(subscriptionTier)` filters by tier
- [ ] Theme overrides supported for enterprise
- [ ] Hot-reload themes without restart

### Phase 2: PostgreSQL + RLS

#### FR-5.2.1: Database Migration

**Description**: Migrate from SQLite to PostgreSQL.

**Acceptance Criteria**:
- [ ] Drizzle ORM schema defined
- [ ] All tables have `community_id` column
- [ ] Migration script preserves existing data
- [ ] Delete `profiles.db` after validation

#### FR-5.2.2: Row-Level Security

**Description**: Tenant isolation via RLS policies.

**Acceptance Criteria**:
- [ ] RLS enabled on all tenant tables
- [ ] Policy: `community_id = current_setting('app.current_tenant')::UUID`
- [ ] Tenant context set per request
- [ ] **SECURITY**: Cross-tenant access returns empty result
- [ ] RLS regression test suite

#### FR-5.2.3: Drizzle Storage Adapter

**Description**: Type-safe database access with tenant context.

**Acceptance Criteria**:
- [ ] Implements `IStorageProvider` interface
- [ ] Constructor receives `tenantId`
- [ ] All queries scoped to tenant
- [ ] Badge lineage recursive queries work
- [ ] All 141 tests pass with PostgreSQL

### Phase 3: Redis + Hybrid State

#### FR-5.3.1: Wizard Session Store

**Description**: Redis-backed session persistence.

**Acceptance Criteria**:
- [ ] Session saved with 15-minute TTL
- [ ] Session ID is idempotency key
- [ ] Wizard survives Discord 3s timeout
- [ ] `/resume` command retrieves session
- [ ] Container restart doesn't lose session

#### FR-5.3.2: Hybrid State Model

**Description**: PostgreSQL runtime + S3 shadow for audit history.

**Acceptance Criteria**:
- [ ] Shadow state stored after each apply
- [ ] S3 backup of manifest history
- [ ] Git-style versioning of configs
- [ ] Drift detection compares 3 states (desired/shadow/actual)

### Phase 4: BullMQ + Global Token Bucket

#### FR-5.4.1: Synthesis Queue

**Description**: Async Discord operations via BullMQ.

**Acceptance Criteria**:
- [ ] Queue: `discord-synthesis`
- [ ] 3 retry attempts with exponential backoff
- [ ] Rate limiter: 5 concurrent, 10 jobs/sec
- [ ] Dead letter queue for failed jobs

#### FR-5.4.2: Global Distributed Token Bucket

**Description**: Platform-wide Discord rate limiting.

**Acceptance Criteria**:
- [ ] Redis-based token bucket (50 tokens/sec)
- [ ] Shared across all workers/tenants
- [ ] `acquireWithWait()` for blocking acquisition
- [ ] **CRITICAL**: 0 global 429 bans
- [ ] Metrics for bucket exhaustion

#### FR-5.4.3: Reconciliation Controller

**Description**: Kubernetes-style drift reconciliation.

**Acceptance Criteria**:
- [ ] Compares desired vs shadow vs actual state
- [ ] Generates minimal diff operations
- [ ] Scheduled every 6 hours via trigger.dev
- [ ] On-demand via `/reconcile` command
- [ ] Admin notification for detected drift

### Phase 5: Vault Transit + Kill Switch

#### FR-5.5.1: Vault Transit Integration

**Description**: HSM-backed cryptographic operations.

**Acceptance Criteria**:
- [ ] No `PRIVATE_KEY` in environment variables
- [ ] All signing via Vault Transit API
- [ ] Audit log of signing operations
- [ ] Key rotation capability

#### FR-5.5.2: Kill Switch

**Description**: Emergency policy revocation.

**Acceptance Criteria**:
- [ ] MFA-protected kill switch endpoint
- [ ] Revokes all agent signing permissions
- [ ] Freezes synthesis operations
- [ ] Admin notification on activation

### Phase 6: OPA Pre-Gate + HITL

#### FR-5.6.1: Policy-as-Code Pre-Gate

**Description**: OPA validates Terraform before human review.

**Acceptance Criteria**:
- [ ] OPA policies for hard blocks:
  - Delete PersistentVolume → AUTO-REJECT
  - Delete Database → AUTO-REJECT
  - Disable RLS → AUTO-REJECT
- [ ] Infracost budget check (>$5k → AUTO-REJECT)
- [ ] Risk scoring for human context

#### FR-5.6.2: Human-in-the-Loop Gate

**Description**: Human approval for infrastructure changes.

**Acceptance Criteria**:
- [ ] Terraform plan displayed in Slack/Discord
- [ ] Approval required for apply
- [ ] MFA for high-risk approvals
- [ ] 24-hour timeout with auto-reject
- [ ] Audit trail of all approvals

---

## 5. WizardEngine

### FR-5.7.1: Wizard State Machine

**Description**: 8-step onboarding flow.

**States:**
1. `INIT` - Welcome, community name
2. `CHAIN_SELECT` - Select blockchain(s)
3. `ASSET_CONFIG` - Enter contract address
4. `ELIGIBILITY_RULES` - Configure thresholds
5. `ROLE_MAPPING` - Define tier roles
6. `CHANNEL_STRUCTURE` - Select template or customize
7. `REVIEW` - Preview manifest
8. `DEPLOY` - Execute synthesis

**Acceptance Criteria**:
- [ ] State persisted in Redis (15-min TTL)
- [ ] Each step is a separate Discord modal
- [ ] `deferReply()` called within 3 seconds
- [ ] `/resume {session_id}` recovers state
- [ ] Analytics track funnel completion

---

## 6. Non-Functional Requirements

### NFR-5.1: Performance

| Metric | Target |
|--------|--------|
| Basic eligibility check | <100ms |
| Advanced eligibility check | <500ms |
| Wizard step response | <3s (Discord limit) |
| Synthesis completion | <5 minutes |

### NFR-5.2: Security

- [ ] RLS enforced on all tenant tables
- [ ] No secrets in environment variables (Vault)
- [ ] All signing operations audited
- [ ] Kill switch tested quarterly
- [ ] SOC 2 Type II compliance roadmap

### NFR-5.3: Reliability

| Metric | Target |
|--------|--------|
| Uptime | 99.9% |
| Score Service degradation | <1% requests |
| Data durability | 99.999999999% (S3) |
| Recovery Time Objective | <15 minutes |

### NFR-5.4: Scalability

| Metric | Target |
|--------|--------|
| Concurrent tenants | 1,000+ |
| Communities per tenant | 100 |
| Members per community | 100,000 |
| Synthesis throughput | 10 ops/sec |

---

## 7. Migration Strategy

### 7.1 Phase Sequence

| Phase | Weeks | Focus | Blocking Dependency |
|-------|-------|-------|---------------------|
| 0 | 1-2 | Two-Tier Chain Provider | None (foundation) |
| 1 | 3-4 | Themes System | Phase 0 |
| 2 | 5-8 | PostgreSQL + RLS | Phase 1 |
| 3 | 9-10 | Redis + Hybrid State | Phase 2 |
| 4 | 11-12 | BullMQ + Token Bucket | Phase 3 |
| 5 | 13-14 | Vault Transit | Phase 4 |
| 6 | 15-16 | OPA + HITL | Phase 5 |

### 7.2 Validation Checkpoints

**After each phase:**
- [ ] All 141 existing tests pass
- [ ] SietchTheme produces identical results to v4.1
- [ ] No regression in Telegram bot functionality
- [ ] Security audit of new components

### 7.3 Files to Delete After Migration

```bash
# Phase 0 complete:
rm src/services/chain.ts  # → TwoTierChainProvider

# Phase 2 complete:
rm profiles.db  # → PostgreSQL
```

---

## 8. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Score Service outage | Medium | High | Two-Tier Provider with Native fallback |
| Discord global 429 | Medium | Critical | Global Token Bucket |
| RLS bypass | Low | Critical | Automated regression tests |
| Theme regression | Medium | High | SietchTheme parity test suite |
| Wizard timeout | High | Medium | Redis session + /resume command |
| Vault unavailable | Low | High | Circuit breaker + cached signatures |

---

## 9. Out of Scope (v5.0)

- Mobile app
- Web dashboard (Phase 7+)
- Custom theme builder UI
- Fiat payments (crypto-only)
- On-premise deployment
- White-label branding

---

## 10. Appendices

### Appendix A: Package Structure

```
packages/
├── core/
│   ├── domain/         # Pure entities
│   ├── ports/          # Interface definitions
│   └── services/       # Business logic
├── adapters/
│   ├── chain/          # TwoTierChainProvider
│   ├── storage/        # Drizzle + Hybrid State
│   ├── platform/       # Discord + Rate Limiting
│   └── themes/         # Basic + Sietch
├── wizard/             # 8-step onboarding
└── synthesis/          # BullMQ + Token Bucket
```

### Appendix B: Environment Variables

```bash
# Score Service (replaces BERACHAIN_RPC_URL, DUNE_API_KEY)
SCORE_API_URL=https://score.honeyjar.xyz/api
SCORE_API_KEY=sk_...

# PostgreSQL (replaces SQLite)
DATABASE_URL=postgresql://...

# Redis (sessions + token bucket)
REDIS_URL=redis://...

# Vault (cryptographic operations)
VAULT_ADDR=https://vault.honeyjar.xyz
VAULT_TOKEN=...
```

### Appendix C: Reference Documents

| Document | Location |
|----------|----------|
| Architecture Specification | `loa-grimoire/context/new-context/arrakis-saas-architecture.md` |
| Implementation Prompt | `loa-grimoire/context/new-context/arrakis-implementation-prompt.md` |
| v4.1 PRD | `loa-grimoire/prd-v4.0-completed.md` |
| v4.1 SDD | `loa-grimoire/sdd-v4.0-completed.md` |

---

**Document Status**: DRAFT - Pending stakeholder review

**Next Step**: `/architect` to create Software Design Document v5.0

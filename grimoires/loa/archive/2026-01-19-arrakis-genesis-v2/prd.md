# Product Requirements Document: Arrakis Genesis

**Version**: 2.0
**Date**: January 16, 2026
**Status**: DRAFT - Pending Approval
**Codename**: Arrakis Genesis

---

## Document Traceability

| Section | Primary Source | Secondary Sources |
|---------|---------------|-------------------|
| Part I: Infrastructure | arrakis-scaling-roadmap-reviews.md v1.7 | Gateway Proxy implementation (GW-1 to GW-5) |
| Part II: SaaS Platform | archive/v5-saas/prd.md v5.2 | arrakis-saas-architecture.md |
| Part III: Coexistence | archive/v5-saas/prd.md §11 | ARRAKIS_COEXISTENCE_ARCHITECTURE.md |
| Technical Reviews | arrakis-scaling-roadmap-reviews.md v1.4-v1.7 | 4 rounds of Gemini review feedback |

**Supersedes**:
- `grimoires/loa/prd.md` v1.0 (Sietch Unified - Infrastructure Only)
- `grimoires/loa/archive/pre-scaling-2026-01-15/v5-saas/prd.md` v5.2 (The Transformation - SaaS Only)

---

## 1. Executive Summary

### 1.1 Product Overview

**Arrakis Genesis** is a unified product initiative that transforms Arrakis from a single-community Discord bot into a **multi-tenant, chain-agnostic SaaS platform** capable of serving **10,000+ Discord communities** with infrastructure designed to scale to 100k+.

This initiative combines:
1. **Infrastructure Scaling** (Phases 1-4) - Rust gateway, hybrid data layer, NATS messaging
2. **SaaS Platform** (Phases 5-10) - Multi-tenancy, themes, wizard onboarding
3. **Coexistence & Migration** (Phases 11-13) - Shadow mode, incumbent migration

### 1.2 Problem Statement

**Current State (Post-Gateway Proxy):**
- Single Discord gateway process (Node.js/discord.js)
- RabbitMQ for message passing (functional but limited scale)
- SQLite single-store approach
- Single-tenant for BGT holders only
- Hardcoded 9-tier Dune-themed progression
- Manual onboarding process

**Target State (Arrakis Genesis):**
- Rust gateway (Twilight) with 5x memory efficiency
- Hybrid data layer (PostgreSQL + ScyllaDB Serverless)
- NATS JetStream for low-latency message passing
- Multi-tenant SaaS platform (10,000+ communities)
- Configurable themes (BasicTheme free, SietchTheme premium)
- Self-service WizardEngine onboarding
- Coexistence with Collab.Land/Matrica/Guild.xyz

**Why Now:**
- Zero current production users = zero migration risk
- Gateway Proxy pattern (GW-1 to GW-5) validates event-driven architecture
- Claude Code enables Rust adoption without traditional expertise barriers
- ~$100/month premium for hybrid data layer is cheap insurance vs migration under load
- Market demand for token-gated community tooling

### 1.3 Vision

Arrakis becomes **"Shopify for token-gated communities"** with **infrastructure for the Web3 community tooling ecosystem**:

- **For communities**: Sub-second response times, 99.9% uptime, self-service setup
- **For operators**: Self-healing infrastructure, zero-downtime deployments
- **For developers**: Clean separation (Rust gateway + TypeScript workers), hexagonal architecture
- **For enterprises**: Multi-tenant with RLS, Vault encryption, audit trails
- **For the ecosystem**: Chain-agnostic support (EVM, Solana, future chains)
- **For growth**: 10k servers today, 100k+ tomorrow without re-architecture

### 1.4 Success Metrics

| Category | Metric | Target | Measurement |
|----------|--------|--------|-------------|
| **Scale** | Discord servers supported | 10,000+ | Gateway capacity |
| **Scale** | Concurrent tenants | 1,000+ | Database count |
| **Performance** | Gateway memory per 1k guilds | <40 MB | Twilight metrics |
| **Performance** | Event routing latency | <50ms p99 | NATS message delivery |
| **Performance** | Eligibility check (cached) | <100ms p99 | End-to-end latency |
| **Performance** | Slash command response | <500ms p99 | User-perceived latency |
| **Reliability** | Uptime | 99.9% | CloudWatch monitoring |
| **Reliability** | Score Service degradation | <1% requests | Circuit breaker metrics |
| **Cost** | Infrastructure | ~$250/month at scale | AWS + ScyllaDB billing |
| **Adoption** | Onboarding completion rate | >80% | Wizard funnel analytics |
| **Adoption** | SietchTheme parity | 100% identical to v4.1 | Regression test suite |
| **Security** | Discord 429 rate | 0 global bans | API error logs |
| **Security** | Tenant isolation | 100% RLS coverage | Security audit |

### 1.5 Timeline Overview

| Part | Phases | Duration | Focus |
|------|--------|----------|-------|
| **I: Infrastructure** | 1-4 | 28 weeks | Rust gateway, hybrid data, NATS, scaling |
| **II: SaaS Platform** | 5-10 | 16 weeks | Two-tier provider, themes, PostgreSQL, Redis, BullMQ, Vault |
| **III: Coexistence** | 11-13 | 10 weeks | Shadow mode, parallel mode, migration engine |
| **Total** | 1-13 | **54 weeks** | Complete Arrakis Genesis |

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

### 3.1 Target State Architecture

```
                                   ┌─────────────────────────────────────┐
                                   │         Control Plane               │
                                   │  ┌───────────┐  ┌───────────────┐   │
                                   │  │  Admin    │  │  Tenant       │   │
                                   │  │  Portal   │  │  Config Store │   │
                                   │  └───────────┘  └───────────────┘   │
                                   └──────────────────┬──────────────────┘
                                                      │
┌──────────────┐    ┌──────────────────────────────────────────────────────────────┐
│   Discord    │    │                      Data Plane                              │
│   Gateway    │◄──►│  ┌────────────────────────────────────────────────────────┐  │
│   (API)      │    │  │           Twilight Gateway (Rust)                      │  │
└──────────────┘    │  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐   │  │
                    │  │  │ Shard   │  │ Shard   │  │ Shard   │  │ Shard   │   │  │
                    │  │  │ 0-9     │  │ 10-19   │  │ 20-29   │  │ 30-39   │   │  │
                    │  │  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘   │  │
                    │  └───────┼────────────┼────────────┼────────────┼────────┘  │
                    │          └────────────┴─────┬──────┴────────────┘           │
                    │                             ▼                                │
                    │  ┌──────────────────────────────────────────────────────┐   │
                    │  │              Message Broker (NATS JetStream)         │   │
                    │  │   events.shard.N.*  │  commands.*  │  eligibility.*  │   │
                    │  └─────────┬─────────────────┬─────────────────┬────────┘   │
                    │            │                 │                 │            │
                    │            ▼                 ▼                 ▼            │
                    │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐   │
                    │  │   Event      │  │   Command    │  │   Eligibility    │   │
                    │  │   Workers    │  │   Workers    │  │   Workers        │   │
                    │  │  (TS/Node)   │  │  (TS/Node)   │  │   (TS/Node)      │   │
                    │  └──────┬───────┘  └──────┬───────┘  └────────┬─────────┘   │
                    │         │                 │                   │             │
                    │         └─────────────────┼───────────────────┘             │
                    │                           │                                 │
                    │         ┌─────────────────┴─────────────────┐               │
                    │         │           Shared Services         │               │
                    │         │  ┌─────────┐  ┌───────────────┐   │               │
                    │         │  │  Redis  │  │  RPC Pool     │   │               │
                    │         │  │ Cluster │  │  (Multi-chain)│   │               │
                    │         │  └─────────┘  └───────────────┘   │               │
                    │         └───────────────────────────────────┘               │
                    │                           │                                 │
                    └───────────────────────────┼─────────────────────────────────┘
                                                │
                    ┌───────────────────────────┴───────────────────────────┐
                    │                  Hybrid Data Layer                    │
                    │                                                       │
                    │  ┌─────────────────────┐  ┌─────────────────────┐    │
                    │  │     PostgreSQL      │  │  ScyllaDB Cloud     │    │
                    │  │     + PgBouncer     │  │    (Serverless)     │    │
                    │  │                     │  │                     │    │
                    │  │  • Communities      │  │  • Scores           │    │
                    │  │  • Rules            │  │  • Score history    │    │
                    │  │  • Profiles         │  │  • Leaderboards     │    │
                    │  │  • Audit logs       │  │  • Chain events     │    │
                    │  │                     │  │                     │    │
                    │  │  Transactional      │  │  High-velocity      │    │
                    │  │  ~$150/mo           │  │  ~$100/mo           │    │
                    │  └─────────────────────┘  └─────────────────────┘    │
                    │                                                       │
                    └───────────────────────────────────────────────────────┘
```

### 3.2 Technology Choices

| Layer | Technology | Rationale |
|-------|------------|-----------|
| Gateway | **Twilight (Rust)** | 5x memory efficiency, sub-ms routing, battle-tested at scale |
| Workers | **TypeScript/Node.js** | Business logic stays in familiar territory, rapid iteration |
| Broker | **NATS JetStream** | Simple ops, low latency, persistent streams, request-reply |
| Config/Profiles | **PostgreSQL** | Transactional integrity, complex queries, GDPR compliance |
| Scores/Analytics | **ScyllaDB Serverless** | Future-proof for real-time, scales to 1M writes/sec |
| Cache | **Redis Cluster** | Distributed state, rate limiting, session data, L1 invalidation |
| Secrets | **HashiCorp Vault** | HSM-backed signing, no secrets in env vars |

### 3.3 Hybrid Data Layer Rationale

| Data Type | Store | Why |
|-----------|-------|-----|
| Community config | PostgreSQL | Rarely changes, needs transactions |
| Eligibility rules | PostgreSQL | Complex queries, rule composition |
| User profiles | PostgreSQL | GDPR compliance, transactional |
| Audit logs | PostgreSQL | Compliance, queryable, 7-year retention |
| **Scores** | **ScyllaDB** | Hot path, future real-time capability |
| **Score history** | **ScyllaDB** | Time-series, append-only, high volume |
| **Leaderboards** | **ScyllaDB** | Frequent reads, sorted access patterns |
| **Members (Phase 2.5+)** | **ScyllaDB** | When exceeds 10M rows with RLS overhead |
| Session state | Redis | Ephemeral, sub-ms access |

**Cost Comparison:**

| Approach | Initial Cost | Scale Ceiling | Migration Risk |
|----------|--------------|---------------|----------------|
| PostgreSQL only | $150/mo | ~10k writes/sec | High (migrate under load) |
| **Hybrid** | **$250/mo** | **1M+ writes/sec** | **None (already scaled)** |

### 3.4 Two-Tier Chain Provider (Resilience Architecture)

> Source: v5.0 PRD §3.1

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

---

## 4. Critical Failure Modes

### 4.1 Gateway Zombification (The Silent Killer)

**Problem**: Web3 RPC calls (200ms-2s) block the event loop → Bot fails to send Discord heartbeats → 5 missed heartbeats = Discord disconnects → Bot appears online but is unresponsive ("zombie")

**Current risk**: HIGH - RPC calls in main event loop

**Solution**: Rust gateway (Phase 2) + async RPC in workers + DB connection release pattern

### 4.2 Memory Exhaustion

**Problem**: discord.js caches all guilds, members, messages by default → Memory grows to ~500MB+ at scale → OOM kills or severe GC pauses

**Current risk**: HIGH without cache config

**Solution**: Twilight (zero-cache) + Redis for state

### 4.3 Connection Pool Exhaustion

**Problem**: PostgreSQL connections limited (~100 default) → RLS adds per-query overhead → Workers multiply during load spikes → Timeouts cascade through system

**Current risk**: MEDIUM - depends on traffic patterns

**Solution**: PgBouncer (Phase 1) + connection discipline + DB connection release during RPC waits

### 4.4 Shard Fragmentation

**Problem**: Local memory state (cooldowns, XP) fragmented across shards → Shard #1 can't see Shard #2's memory → Inconsistent behavior, data loss

**Current risk**: LOW (single process now) → HIGH at scale

**Solution**: Redis SETNX for all shared state (Phase 2) + shard-aware NATS subjects

### 4.5 Discord Interaction Timeout (v1.6 Review)

**Problem**: Discord gives only 3 seconds to acknowledge interactions → Workers backed up can't respond in time → Users see generic timeout error

**Solution**: NATS Request-Reply with 2s timeout for load shedding → Send "try again" message before Discord timeout

### 4.6 Community Sync OOM (v1.5 Review)

**Problem**: `getAllMembers()` in large communities loads 100k+ rows into memory → OOM crash during sync

**Solution**: Cursor-based pagination with streaming → Never load full result set

---

## 5. Functional Requirements - Part I: Infrastructure (Phases 1-4)

### Phase 1: Foundation Hardening (Weeks 1-6)

**Goal:** Stabilize current architecture, eliminate single points of failure, establish observability baseline, prepare for Rust gateway.

#### FR-G1.1: Rust Toolchain Setup

**Description**: Establish Rust development environment and Twilight familiarity.

**Acceptance Criteria**:
- [ ] Rust toolchain installed (rustup, cargo)
- [ ] Basic Twilight "hello world" gateway running locally
- [ ] Team can build and run Twilight examples
- [ ] Cargo workspace structure for gateway project

#### FR-G1.2: RPC Failover with Circuit Breaker + Bulkhead (v1.4 Review)

**Description**: Multi-provider RPC pool with automatic failover and concurrency control.

**Acceptance Criteria**:
- [ ] 3 RPC providers configured (Alchemy, Infura, QuickNode)
- [ ] Circuit breaker per provider (opossum)
- [ ] **Bulkhead pattern** (Bottleneck with max 50 concurrent, `highWater` for load shedding)
- [ ] **viem retries disabled** (let opossum handle failover)
- [ ] Graceful degradation with cached fallback
- [ ] Metrics for circuit state changes
- [ ] <30s failover time on provider outage

#### FR-G1.3: PostgreSQL Migration

**Description**: Migrate transactional data from SQLite to PostgreSQL.

**Acceptance Criteria**:
- [ ] PostgreSQL provisioned with PgBouncer (mandatory for RLS overhead)
- [ ] Schema migrated (communities, eligibility_rules, members, audit_logs)
- [ ] Row-Level Security policies configured
- [ ] **RLS bypass role** for trusted services (`arrakis_service BYPASSRLS`)
- [ ] All existing data migrated
- [ ] <10ms p99 query latency
- [ ] SQLite deprecated after validation

#### FR-G1.4: ScyllaDB Serverless Setup (v1.4 Review)

**Description**: Deploy ScyllaDB for high-velocity data with secondary tables.

**Acceptance Criteria**:
- [ ] ScyllaDB Cloud Serverless account created
- [ ] Primary tables: scores, score_history, leaderboards, eligibility_snapshots
- [ ] **Secondary tables**: scores_by_community, members_by_community (for batch operations)
- [ ] **Dual-write pattern** for table consistency
- [ ] TypeScript client (cassandra-driver) integrated
- [ ] <5ms p99 read latency
- [ ] Cost tracking dashboard

#### FR-G1.5: Observability Foundation

**Description**: Comprehensive monitoring and alerting.

**Acceptance Criteria**:
- [ ] Prometheus metrics collecting
- [ ] Grafana dashboards (Discord health, RPC status, eligibility pipeline, database saturation, ScyllaDB metrics)
- [ ] Alerting rules for critical metrics
- [ ] PagerDuty/Slack integration

### Phase 2: Rust Gateway & Multi-Tenancy (Weeks 7-14)

**Goal:** Deploy Twilight gateway for maximum efficiency, establish tenant isolation.

#### FR-G2.1: Twilight Gateway Implementation

**Description**: Production-ready Rust gateway using Twilight.

**Acceptance Criteria**:
- [ ] Twilight gateway handling all Discord intents
- [ ] **Intent filtering** (GUILDS, GUILD_MEMBERS only - NO GUILD_MESSAGES) (v1.7 Review)
- [ ] Shard management (auto-scale based on guild count)
- [ ] Event routing to NATS
- [ ] <200MB memory at 5,000 guilds
- [ ] Metrics (events received, route failures, shard status)
- [ ] Docker image building and deploying

#### FR-G2.2: NATS JetStream with Shard Awareness (v1.5/v1.6 Review)

**Description**: Replace RabbitMQ with NATS for message passing with shard-aware subjects.

**Acceptance Criteria**:
- [ ] 3-node NATS cluster deployed
- [ ] **Shard-aware subjects**: `events.shard.N.*`, `commands.shard.N.*`
- [ ] **Shard registry** for failover coordination (`internal.shard.registry`)
- [ ] Streams configured (COMMANDS, ELIGIBILITY, EVENTS)
- [ ] **Request-Reply** for interactions with 2s timeout (load shedding)
- [ ] <50ms p99 message delivery latency
- [ ] Message persistence for eligibility stream
- [ ] Migration bridge from RabbitMQ (if applicable)

#### FR-G2.3: Stateless Workers with Patterns (v1.5/v1.6 Review)

**Description**: TypeScript workers consuming from NATS with resilience patterns.

**Acceptance Criteria**:
- [ ] Command workers (verify, check, profile)
- [ ] Eligibility workers (check, sync)
- [ ] **Event workers with sub-task pattern** (v1.7 Review)
- [ ] **DB connection release** during RPC waits (v1.6 Review)
- [ ] **Cursor-based pagination** for community syncs (v1.5 Review)
- [ ] Workers scale 1-20 pods based on queue depth
- [ ] No local state (all state in Redis/database)

#### FR-G2.4: Multi-Tenant Configuration

**Description**: Per-community configuration with tier enforcement.

**Acceptance Criteria**:
- [ ] Community config schema (branding, features, eligibility, limits)
- [ ] Tier defaults (free, pro, enterprise)
- [ ] Tenant context middleware
- [ ] Rate limits per tenant/tier
- [ ] **Tier-based NATS queue separation** (v1.7 Review)
- [ ] Configuration hot-reload without restart

### Phase 3: Production Hardening (Weeks 15-20)

**Goal:** Achieve production-grade reliability, zero-downtime deployments.

#### FR-G3.1: Blue-Green Deployment

**Description**: Zero-downtime deployment strategy.

**Acceptance Criteria**:
- [ ] Argo Rollouts configured
- [ ] Pre-promotion analysis (success rate check)
- [ ] Graceful shutdown implemented (30s drain)
- [ ] <5min deployment time
- [ ] Automatic rollback on failure

#### FR-G3.2: Rate Limiting & Tenant Isolation (v1.7 Review)

**Description**: Prevent cascade failures from noisy neighbors.

**Acceptance Criteria**:
- [ ] Per-tenant rate limiting (rate-limiter-flexible)
- [ ] Bulkhead pattern (Bottleneck) for isolation
- [ ] **Bottleneck `highWater`** load shedding configured (v1.5 Review)
- [ ] **Redis SETNX cooldowns** (no local memory) (v1.7 Review)
- [ ] Discord API rate limit respect
- [ ] Metrics for rate limit violations
- [ ] No cascade failures under load

#### FR-G3.3: Chaos Testing

**Description**: Validate resilience under failure conditions.

**Acceptance Criteria**:
- [ ] RPC provider outage test passing
- [ ] Database failover test passing
- [ ] Shard death recovery test passing
- [ ] NATS partition test passing
- [ ] Worker crash recovery test passing
- [ ] All chaos scenarios documented in runbooks

#### FR-G3.4: Load Testing

**Description**: Validate performance targets under load.

**Acceptance Criteria**:
- [ ] k6 test suite for eligibility checks
- [ ] k6 test suite for slash commands
- [ ] p95 <500ms at 200 concurrent communities
- [ ] <1% error rate under sustained load
- [ ] **RPC Batching with Multicall** implemented (v1.4 Review)
- [ ] Test results documented

### Phase 4: Scale & Optimization (Weeks 21-28)

**Goal:** Optimize for 10k+ servers, implement auto-scaling, advanced monitoring.

#### FR-G4.1: Auto-Scaling

**Description**: Dynamic scaling based on load.

**Acceptance Criteria**:
- [ ] HPA configured for workers (3-30 pods)
- [ ] KEDA for gateway shards
- [ ] Scale-up in <60s
- [ ] Scale-down after 5min stabilization
- [ ] Cost-efficient scaling (not over-provisioned)

#### FR-G4.2: Multi-Layer Cache with L1 Security (v1.4/v1.6 Review)

**Description**: Optimize cache hit rate with secure L1 caching.

**Acceptance Criteria**:
- [ ] L1 cache (in-memory, per-process) - **immutable data only**
- [ ] L2 cache (Redis, shared) - mutable data
- [ ] L3 cache (PostgreSQL, persistent for critical data)
- [ ] **L1 instant invalidation via Redis pub/sub** (v1.6 Review - security critical)
- [ ] **Cross-worker cache invalidation** via Redis pub/sub
- [ ] **Mutable data NEVER in L1** (permissions, cooldowns, rate limits)
- [ ] >90% cache hit rate
- [ ] Cache key design documented

#### FR-G4.3: Distributed Tracing

**Description**: Full trace visibility for debugging.

**Acceptance Criteria**:
- [ ] OpenTelemetry SDK integrated
- [ ] Custom spans for eligibility flow
- [ ] Tempo/Grafana trace visualization
- [ ] Correlation IDs in logs
- [ ] <5% tracing overhead

#### FR-G4.4: Performance Validation

**Description**: Confirm all performance targets met.

**Acceptance Criteria**:
- [ ] Gateway → Worker latency <50ms p99
- [ ] Eligibility check (cached) <100ms p99
- [ ] Eligibility check (RPC) <2s p99
- [ ] Slash command response <500ms p99
- [ ] Database query <10ms p99
- [ ] 10k server capacity confirmed

---

## 6. Functional Requirements - Part II: SaaS Platform (Phases 5-10)

### Phase 5: Two-Tier Chain Provider (Weeks 29-30)

**Goal:** Foundation for chain-agnostic eligibility checking.

#### FR-G5.1: Native Blockchain Reader

**Description**: Lightweight viem client for binary checks.

**Acceptance Criteria**:
- [ ] `hasBalance(address, token, minAmount)` returns boolean
- [ ] `ownsNFT(address, collection, tokenId?)` returns boolean
- [ ] `getBalance(address, token)` returns bigint
- [ ] No Score Service dependency
- [ ] <100ms response time

#### FR-G5.2: Score Service Adapter

**Description**: HTTP client for complex Score API queries.

**Acceptance Criteria**:
- [ ] Implements `IChainProvider` interface
- [ ] `getRankedHolders(asset, limit)` returns ranked list
- [ ] `getAddressRank(address, asset)` returns rank or null
- [ ] `checkActionHistory(address, action)` returns boolean
- [ ] Circuit breaker with 50% error threshold
- [ ] Cached fallback on circuit open
- [ ] **Prometheus metrics for circuit breaker state** (Hardening HR-5.10.4)

#### FR-G5.3: Two-Tier Orchestration

**Description**: Coordinate Native Reader and Score Service.

**Acceptance Criteria**:
- [ ] `checkBasicEligibility()` uses Native Reader only
- [ ] `checkAdvancedEligibility()` uses Score with fallback
- [ ] Degraded mode returns `source: 'native_degraded'`
- [ ] Metrics track circuit state changes
- [ ] All existing tests pass

### Phase 6: Themes System (Weeks 31-32)

**Goal:** Configurable tier/badge systems for multi-tenancy.

#### FR-G6.1: Theme Interface

**Description**: Port definition for theme providers.

**Acceptance Criteria**:
- [ ] `IThemeProvider` interface defined in `packages/core/ports/`
- [ ] Methods: `getTierConfig()`, `getBadgeConfig()`, `getNamingConfig()`
- [ ] Methods: `evaluateTier()`, `evaluateBadges()`
- [ ] Subscription tier enforcement (free/premium/enterprise)

#### FR-G6.2: BasicTheme Implementation

**Description**: Free tier theme with 3 tiers and 5 badges.

**Acceptance Criteria**:
- [ ] 3 tiers: Gold (1-10), Silver (11-50), Bronze (51-100)
- [ ] 5 badges: Early Adopter, Veteran, Top Tier, Active, Contributor
- [ ] Generic naming (no themed language)
- [ ] Available to all subscription tiers

#### FR-G6.3: SietchTheme Implementation

**Description**: Premium Dune-themed progression (v4.1 parity).

**Acceptance Criteria**:
- [ ] 9 tiers: Naib, Fedaykin Elite, Fedaykin, Fremen, Wanderer, Initiate, Aspirant, Observer, Outsider
- [ ] 10+ badges: First Wave, Veteran, Diamond Hands, Council, Survivor, Streak Master, Engaged, Contributor, Pillar, Water Sharer
- [ ] Dune naming conventions (STILLSUIT, NAIB COUNCIL, etc.)
- [ ] **REGRESSION**: Identical tier/badge results to v4.1 hardcoded logic
- [ ] Premium subscription required

#### FR-G6.4: Theme Registry

**Description**: Runtime theme selection per community.

**Acceptance Criteria**:
- [ ] `ThemeRegistry.get(themeId)` returns theme instance
- [ ] `getAvailableThemes(subscriptionTier)` filters by tier
- [ ] Theme overrides supported for enterprise
- [ ] Hot-reload themes without restart

### Phase 7: PostgreSQL Multi-Tenant (Weeks 33-36)

**Goal:** Full multi-tenant isolation with RLS.

#### FR-G7.1: Database Migration Enhancement

**Description**: Enhance PostgreSQL for full multi-tenancy.

**Acceptance Criteria**:
- [ ] Drizzle ORM schema defined
- [ ] All tables have `community_id` column
- [ ] Migration script preserves existing data

#### FR-G7.2: Row-Level Security

**Description**: Tenant isolation via RLS policies.

**Acceptance Criteria**:
- [ ] RLS enabled on all tenant tables
- [ ] Policy: `community_id = current_setting('app.current_tenant')::UUID`
- [ ] Tenant context set per request
- [ ] **SECURITY**: Cross-tenant access returns empty result
- [ ] **RLS penetration test** validated (Hardening HR-5.10.2)
- [ ] RLS regression test coverage >95%

#### FR-G7.3: Drizzle Storage Adapter

**Description**: Type-safe database access with tenant context.

**Acceptance Criteria**:
- [ ] Implements `IStorageProvider` interface
- [ ] Constructor receives `tenantId`
- [ ] All queries scoped to tenant
- [ ] Badge lineage recursive queries work
- [ ] All tests pass with PostgreSQL

### Phase 8: Redis + Hybrid State (Weeks 37-38)

**Goal:** Session management and state orchestration.

#### FR-G8.1: Wizard Session Store

**Description**: Redis-backed session persistence.

**Acceptance Criteria**:
- [ ] Session saved with 15-minute TTL
- [ ] Session ID is idempotency key
- [ ] Wizard survives Discord 3s timeout
- [ ] `/resume` command retrieves session
- [ ] Container restart doesn't lose session
- [ ] **Session IP binding** (Hardening HR-5.10.5)

#### FR-G8.2: Hybrid State Model

**Description**: PostgreSQL runtime + S3 shadow for audit history.

**Acceptance Criteria**:
- [ ] Shadow state stored after each apply
- [ ] S3 backup of manifest history
- [ ] Git-style versioning of configs
- [ ] Drift detection compares 3 states (desired/shadow/actual)

### Phase 9: BullMQ + Global Token Bucket (Weeks 39-40)

**Goal:** Async operations with Discord rate limiting.

#### FR-G9.1: Synthesis Queue

**Description**: Async Discord operations via BullMQ.

**Acceptance Criteria**:
- [ ] Queue: `discord-synthesis`
- [ ] 3 retry attempts with exponential backoff
- [ ] Rate limiter: 5 concurrent, 10 jobs/sec
- [ ] Dead letter queue for failed jobs

#### FR-G9.2: Global Distributed Token Bucket

**Description**: Platform-wide Discord rate limiting.

**Acceptance Criteria**:
- [ ] Redis-based token bucket (50 tokens/sec)
- [ ] Shared across all workers/tenants
- [ ] `acquireWithWait()` for blocking acquisition
- [ ] **CRITICAL**: 0 global 429 bans
- [ ] Metrics for bucket exhaustion

#### FR-G9.3: Reconciliation Controller

**Description**: Kubernetes-style drift reconciliation.

**Acceptance Criteria**:
- [ ] Compares desired vs shadow vs actual state
- [ ] Generates minimal diff operations
- [ ] Scheduled every 6 hours via trigger.dev
- [ ] On-demand via `/reconcile` command
- [ ] Admin notification for detected drift

### Phase 10: Vault Transit + Security (Weeks 41-44)

**Goal:** Enterprise-grade security with HSM-backed operations.

#### FR-G10.1: Vault Transit Integration

**Description**: HSM-backed cryptographic operations.

**Acceptance Criteria**:
- [ ] No `PRIVATE_KEY` in environment variables
- [ ] All signing via Vault Transit API
- [ ] Audit log of signing operations
- [ ] Key rotation capability

#### FR-G10.2: Kill Switch

**Description**: Emergency policy revocation.

**Acceptance Criteria**:
- [ ] MFA-protected kill switch endpoint
- [ ] Revokes all agent signing permissions
- [ ] Freezes synthesis operations
- [ ] Admin notification on activation

#### FR-G10.3: Audit Log Persistence (Hardening HR-5.10.1)

**Description**: Persistent audit logging for compliance.

**Acceptance Criteria**:
- [ ] Audit logs persisted to PostgreSQL `audit_logs` table
- [ ] Row-Level Security applied to audit logs
- [ ] Retention policy: 7 years minimum for compliance
- [ ] No in-memory limit on audit entries
- [ ] Async persistence with write-ahead buffer

#### FR-G10.4: API Key Rotation (Hardening HR-5.10.3)

**Description**: Secure API key lifecycle management.

**Acceptance Criteria**:
- [ ] API key rotation via admin endpoint
- [ ] Grace period for old keys (24 hours)
- [ ] Automatic notification of impending expiration
- [ ] Key usage audit trail
- [ ] Emergency immediate revocation capability

#### FR-G10.5: WizardEngine

**Description**: 8-step self-service onboarding flow.

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

## 7. Functional Requirements - Part III: Coexistence (Phases 11-13)

### Phase 11: Shadow Mode (Weeks 45-48)

**Goal:** Prove Arrakis accuracy without touching incumbent systems.

#### FR-G11.1: Incumbent Detection

**Description**: Auto-detect existing token-gating bots on installation.

**Acceptance Criteria**:
- [ ] Detect Collab.Land, Matrica, Guild.xyz by bot ID patterns
- [ ] Detect verification channels (`#collabland-join`, `#matrica-verify`)
- [ ] Identify token-gated roles by naming patterns and membership
- [ ] Confidence score (0-1) for detection accuracy
- [ ] Manual override for `other` incumbents

#### FR-G11.2: Shadow Ledger

**Description**: Track "what Arrakis would do" without executing any Discord changes.

**Acceptance Criteria**:
- [ ] `shadow_member_state` table with incumbent roles, Arrakis eligibility, conviction score
- [ ] `shadow_divergences` table tracking differences between incumbent and Arrakis
- [ ] `shadow_predictions` table for accuracy tracking
- [ ] RLS policies scoped by `guild_id`
- [ ] **No Discord role mutations in shadow mode**

#### FR-G11.3: Shadow Sync Job

**Description**: Periodic comparison of incumbent state vs Arrakis calculations.

**Acceptance Criteria**:
- [ ] Runs every 6 hours (matching typical incumbent balance check interval)
- [ ] Snapshots current Discord role state
- [ ] Calculates Arrakis eligibility for verified wallets
- [ ] Detects and records divergences
- [ ] Validates previous predictions
- [ ] Admin digest notification (opt-in)
- [ ] **CRITICAL**: Zero Discord mutations in shadow mode

#### FR-G11.4: Verification Tiers

**Description**: Gate features based on verification status.

**Acceptance Criteria**:
- [ ] Tier 1 (`incumbent_only`): Shadow tracking, public leaderboard (wallet hidden)
- [ ] Tier 2 (`arrakis_basic`): Tier 1 + profile view, conviction score preview
- [ ] Tier 3 (`arrakis_full`): Full badges, tier progression, all social features
- [ ] Tier migration on wallet connection
- [ ] Feature gating enforced at service layer

### Phase 12: Parallel Mode (Weeks 49-52)

**Goal:** Arrakis operates alongside incumbents with namespaced resources.

#### FR-G12.1: Namespaced Role Management

**Description**: Create Arrakis roles that coexist with incumbent roles.

**Acceptance Criteria**:
- [ ] All Arrakis roles prefixed with `@arrakis-*`
- [ ] Roles positioned below incumbent roles in hierarchy
- [ ] Role sync independent of incumbent
- [ ] No permissions granted to namespaced roles (security)
- [ ] Admin can customize role names while preserving namespace

#### FR-G12.2: Parallel Channel Strategy

**Description**: Admin-configurable channel creation strategy.

**Acceptance Criteria**:
- [ ] Strategy options: `none`, `additive_only`, `parallel_mirror`, `custom`
- [ ] `additive_only` creates conviction-gated channels (incumbents can't offer)
- [ ] Default additive channels: `#conviction-lounge` (80+), `#diamond-hands` (95+)
- [ ] `parallel_mirror` creates Arrakis versions of incumbent channels
- [ ] Channel permissions tied to Arrakis roles

#### FR-G12.3: Glimpse Mode (Social Layer Preview)

**Description**: Show social features exist without full access.

**Acceptance Criteria**:
- [ ] Leaderboard visible, others' conviction scores hidden
- [ ] Profile directory shows blurred profile cards
- [ ] Badge showcase shows locked badge icons
- [ ] "Your Preview Profile" shows own stats
- [ ] Unlock messaging: "Full profiles unlock when your community completes migration"

### Phase 13: Migration Engine (Weeks 53-54)

**Goal:** Graceful transition from shadow/parallel to primary/exclusive.

#### FR-G13.1: Migration Strategy Selection

**Description**: Admin chooses migration approach.

**Acceptance Criteria**:
- [ ] Strategies: `instant`, `gradual`, `parallel_forever`, `arrakis_primary`
- [ ] Readiness checks: min shadow days (14), min accuracy (95%)
- [ ] `gradual` migrates new members immediately, existing over N days
- [ ] `parallel_forever` keeps both systems indefinitely
- [ ] Strategy selection via admin dashboard

#### FR-G13.2: Rollback System

**Description**: Emergency revert capability.

**Acceptance Criteria**:
- [ ] One-click rollback to previous mode
- [ ] Auto-trigger on: >5% access loss in 1 hour, error rate >10% in 15 min
- [ ] Preserve incumbent roles during rollback
- [ ] Admin notification on auto-rollback
- [ ] Audit log of all rollback events

#### FR-G13.3: Incumbent Health Monitoring

**Description**: Monitor incumbent bot health and enable backup activation.

**Acceptance Criteria**:
- [ ] Check: Role update freshness (alert: 48h, critical: 72h)
- [ ] Check: Bot online presence (alert: 1h)
- [ ] Check: Verification channel activity (alert: 168h)
- [ ] "Activate Arrakis as Backup" button (non-automatic)
- [ ] Admin notification on incumbent issues

---

## 8. Non-Functional Requirements

### NFR-G1: Performance

| Metric | Target |
|--------|--------|
| Gateway memory (1k guilds) | <40 MB |
| Gateway memory (10k guilds) | <200 MB |
| Event routing (NATS) | <50ms p99 |
| Eligibility check (cached) | <100ms p99 |
| Eligibility check (RPC) | <2s p99 |
| Slash command response | <500ms p99 |
| Database query | <10ms p99 |
| Basic eligibility check | <100ms |
| Advanced eligibility check | <500ms |
| Wizard step response | <3s (Discord limit) |
| Synthesis completion | <5 minutes |

### NFR-G2: Reliability

| Metric | Target |
|--------|--------|
| Uptime | 99.9% |
| RPC failover time | <30s |
| Shard recovery time | <60s |
| Deployment time | <5min |
| Rollback time | <2min |
| Score Service degradation | <1% requests |
| Data durability | 99.999999999% (S3) |
| Recovery Time Objective | <15 minutes |

### NFR-G3: Scalability

| Metric | Target |
|--------|--------|
| Discord servers | 10,000+ |
| Expandable to | 100,000+ |
| Worker pod range | 3-30 |
| ScyllaDB write capacity | 1M+ writes/sec |
| Concurrent eligibility checks | 200+ |
| Concurrent tenants | 1,000+ |
| Communities per tenant | 100 |
| Members per community | 100,000 |
| Synthesis throughput | 10 ops/sec |

### NFR-G4: Cost

| Component | Target |
|-----------|--------|
| PostgreSQL + PgBouncer | ~$150/month |
| ScyllaDB Serverless | ~$100/month |
| Total infrastructure | ~$250/month (at initial scale) |
| Cost per 1k servers | <$25/month |

### NFR-G5: Security

- [ ] RLS enforced on all tenant tables
- [ ] No secrets in environment variables (Vault)
- [ ] All signing operations audited
- [ ] Kill switch tested quarterly
- [ ] SOC 2 Type II compliance roadmap
- [ ] API key rotation mechanism
- [ ] Session hijacking prevention
- [ ] Error responses sanitized (no internal details)

---

## 9. Migration Strategy

### 9.1 Phase Sequence

| Part | Phase | Weeks | Focus | Blocking Dependency |
|------|-------|-------|-------|---------------------|
| I | 1 | 1-6 | Foundation Hardening | None (foundation) |
| I | 2 | 7-14 | Rust Gateway & Multi-Tenancy | Phase 1 |
| I | 3 | 15-20 | Production Hardening | Phase 2 |
| I | 4 | 21-28 | Scale & Optimization | Phase 3 |
| II | 5 | 29-30 | Two-Tier Chain Provider | Phase 4 |
| II | 6 | 31-32 | Themes System | Phase 5 |
| II | 7 | 33-36 | PostgreSQL Multi-Tenant | Phase 6 |
| II | 8 | 37-38 | Redis + Hybrid State | Phase 7 |
| II | 9 | 39-40 | BullMQ + Token Bucket | Phase 8 |
| II | 10 | 41-44 | Vault + Security + Wizard | Phase 9 |
| III | 11 | 45-48 | Shadow Mode | Phase 10 |
| III | 12 | 49-52 | Parallel Mode | Phase 11 |
| III | 13 | 53-54 | Migration Engine | Phase 12 |

### 9.2 Key Migrations

**RabbitMQ → NATS:**
```
Phase 2a: Deploy NATS alongside RabbitMQ
Phase 2b: New gateway publishes to NATS
Phase 2c: Workers consume from both RabbitMQ and NATS (bridge period)
Phase 2d: Deprecate RabbitMQ, remove dependency
```

**Gateway (discord.js → Twilight):**
```
Phase 2a: Deploy Twilight gateway in shadow mode (parallel to discord.js)
Phase 2b: Validate event parity between gateways
Phase 2c: Route traffic to Twilight, keep discord.js as fallback
Phase 2d: Deprecate discord.js gateway
```

### 9.3 Validation Checkpoints

**After each phase:**
- [ ] All existing tests pass
- [ ] Performance targets met
- [ ] No regression in functionality
- [ ] Security audit of new components
- [ ] Runbooks updated

---

## 10. Risks and Mitigations

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Rust learning curve | Medium | Medium | Claude Code assistance, team training, TypeScript workers for business logic |
| Discord API rate limits during growth | High | High | Smart sharding, request queuing, global token bucket |
| RPC provider cost explosion | Medium | High | Aggressive caching, batch requests (Multicall), negotiate enterprise rates |
| ScyllaDB serverless cost spike | Low | Medium | Monitor usage, migrate to dedicated at crossover (~10k writes/sec) |
| NATS cluster failure | Low | Critical | Multi-AZ deployment, persistent storage, auto-recovery |
| Security breach (wallet data) | Low | Critical | Encrypt at rest, minimal data retention, audit logging, Vault |
| Tenant "noisy neighbor" | High | Medium | Strict rate limiting, bulkhead per tenant, tier-based queues |
| Score Service outage | Medium | High | Two-Tier Provider with Native fallback |
| Discord global 429 | Medium | Critical | Global Token Bucket |
| RLS bypass | Low | Critical | Automated regression tests, penetration testing |
| Theme regression | Medium | High | SietchTheme parity test suite |
| Wizard timeout | High | Medium | Redis session + /resume command |
| Incumbent legal action | Low | Medium | Namespaced roles, no role touching in shadow mode |
| User confusion (two systems) | Medium | Medium | Clear messaging, visual differentiation, glimpse mode |

---

## 11. Out of Scope (Genesis)

- Mobile app
- Web dashboard (Phase 14+)
- Custom theme builder UI
- Fiat payments (crypto-only)
- On-premise deployment
- White-label branding
- Real-time chain event streaming (Phase 14+)
- Global multi-region deployment (Phase 14+)
- Custom shard pools per enterprise customer (Phase 14+)

---

## 12. Future Considerations (Post-Genesis)

### 12.1 ScyllaDB Serverless → Dedicated Migration

**When to consider**: Sustained >10,000 writes/sec (crossover point)

| Volume | Serverless Cost | Dedicated (3-node) | Action |
|--------|-----------------|-------------------|--------|
| 30 writes/sec | $100/mo | $500/mo | Stay serverless |
| 5,000 writes/sec | $300/mo | $500/mo | Stay serverless |
| 10,000 writes/sec | $700/mo | $500/mo | **Migrate to dedicated** |
| 50,000 writes/sec | $2,500/mo | $800/mo | Dedicated required |

### 12.2 Members Table → ScyllaDB (Phase 2.5+)

**When to consider**: PostgreSQL `members` table exceeds 10M rows with active RLS

### 12.3 Real-Time Chain Event Streaming

Required additions when moving from batch scoring to real-time:
- Event ingester service (Rust)
- Alchemy/QuickNode webhook subscriptions (~$500-1,000/mo)
- Score computation engine (Rust)

### 12.4 Global Deployment

For <200ms response times globally:
- Multi-region gateway deployment
- Regional NATS clusters with cross-region sync
- ScyllaDB multi-region (built-in support)
- CDN for static assets

---

## 13. Appendices

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
├── gateway/            # Rust Twilight gateway
├── workers/            # TypeScript NATS consumers
├── wizard/             # 8-step onboarding
└── synthesis/          # BullMQ + Token Bucket
```

### Appendix B: Technology Comparison

#### Gateway Options

| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| **Twilight (Rust)** | Lowest memory (5x), fastest, no GC pauses | Rust learning curve | **Selected** |
| discord.js + ShardingManager | Team knows it, mature | Higher memory, GC pauses | Rejected |
| Discordeno (Deno) | Middle ground | Smaller ecosystem | Rejected |

#### Database Options

| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| **PostgreSQL + ScyllaDB** | Best of both, future-proof | Two systems | **Selected** |
| PostgreSQL only | Simple, cheap | Can't scale to real-time | Rejected |
| ScyllaDB only | Maximum scale | No transactions | Rejected |

#### Message Broker Options

| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| **NATS JetStream** | Simple, fast, built-in persistence, request-reply | Less mature than RabbitMQ | **Selected** |
| RabbitMQ | Battle-tested | Heavier ops, higher latency | Current (deprecated) |
| Kafka | Highest throughput | Overkill for this scale | Rejected |

### Appendix C: Reference Documents

| Document | Location |
|----------|----------|
| Scaling Roadmap v1.7 | `grimoires/loa/context/arrakis-scaling-roadmap-reviews.md` |
| v5.0 PRD | `grimoires/loa/archive/pre-scaling-2026-01-15/v5-saas/prd.md` |
| Gateway Proxy Research | `grimoires/loa/context/gateway-proxy-pattern-research.md` |
| Coexistence Architecture | `grimoires/loa/archive/ARRAKIS_COEXISTENCE_ARCHITECTURE.md` |

---

**Document Status**: DRAFT - Pending Approval

**Revision History**:
| Version | Date | Changes |
|---------|------|---------|
| 2.0 | Jan 16, 2026 | Unified PRD "Arrakis Genesis" combining Infrastructure Scaling (v1.7) + SaaS Platform (v5.2) + Coexistence. Incorporates 4 rounds of Gemini technical review feedback (v1.4-v1.7). |
| 1.0 | Jan 15, 2026 | Initial scaling PRD "Sietch Unified" (infrastructure only, based on roadmap v1.3) |

**Technical Review Feedback Incorporated**:
| Review | Key Changes |
|--------|-------------|
| v1.4 | RPC bulkhead (Bottleneck), viem/opossum sync, ScyllaDB secondary tables, RPC Multicall batching |
| v1.5 | Cursor-based pagination (OOM fix), Bottleneck `highWater` load shedding, Shard-aware NATS subjects |
| v1.6 | L1 cache instant invalidation (security fix), DB connection release pattern, NATS Request-Reply load shedding |
| v1.7 | Tier-based NATS queue separation, Redis SETNX cooldowns, Sub-task pattern for events, Intent filtering fix |

**Next Steps**:
1. Review and approve this PRD
2. Create SDD for Genesis architecture
3. Plan sprints for Phase 1 (Foundation Hardening)

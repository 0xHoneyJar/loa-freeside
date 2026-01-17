# Software Design Document: Arrakis Genesis

**Version:** 2.0 "Arrakis Genesis"
**Date:** 2026-01-16
**Author:** Architecture Designer Agent
**Status:** DRAFT - Pending Approval
**PRD Reference:** grimoires/loa/prd.md (v2.0)
**Supersedes:** SDD v1.0 "Sietch Unified" (Infrastructure Only)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current State Architecture](#2-current-state-architecture)
3. [Target State Architecture](#3-target-state-architecture)
4. [Technology Stack](#4-technology-stack)
5. [Part I: Infrastructure Components](#5-part-i-infrastructure-components)
6. [Part II: SaaS Platform Components](#6-part-ii-saas-platform-components)
7. [Part III: Coexistence Components](#7-part-iii-coexistence-components)
8. [Data Architecture](#8-data-architecture)
9. [Message Broker Design](#9-message-broker-design)
10. [API Design](#10-api-design)
11. [Security Architecture](#11-security-architecture)
12. [Observability Architecture](#12-observability-architecture)
13. [Deployment Architecture](#13-deployment-architecture)
14. [Migration Strategy](#14-migration-strategy)
15. [Testing Strategy](#15-testing-strategy)
16. [Performance Engineering](#16-performance-engineering)
17. [Development Phases](#17-development-phases)
18. [Technical Risks & Mitigation](#18-technical-risks--mitigation)
19. [Appendix](#19-appendix)

---

## 1. Executive Summary

### 1.1 Document Purpose

This Software Design Document specifies the complete technical architecture for **Arrakis Genesis**, transforming Arrakis from a single-community Discord bot into a **multi-tenant SaaS platform** supporting **10,000+ Discord servers** with architecture designed for 100k+.

### 1.2 Scope

This SDD covers three major parts:

| Part | Phases | Focus | Key Components |
|------|--------|-------|----------------|
| **I: Infrastructure** | 1-4 | Foundation & Scale | Rust Gateway, NATS, Hybrid Data Layer |
| **II: SaaS Platform** | 5-10 | Multi-Tenancy & Features | Two-Tier Provider, Themes, WizardEngine, Vault |
| **III: Coexistence** | 11-13 | Market Entry | Shadow Mode, Parallel Mode, Migration Engine |

### 1.3 Key Decisions Summary

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Gateway Language | **Rust (Twilight)** | 5x memory reduction, no GC pauses |
| Message Broker | **NATS JetStream** | Simpler ops, lower latency than RabbitMQ |
| High-Velocity Data | **ScyllaDB Serverless** | Pay-per-op, 1M+ writes/sec headroom |
| Score Service | **Internal Microservice (Rust)** | Control, scale, no external dependencies |
| Secrets Management | **HashiCorp Vault Transit** | HSM-backed, comprehensive crypto |
| Wizard Approach | **Hybrid Web + Discord** | Complex config on web, simple steps in Discord |
| Coexistence Strategy | **Shadow → Parallel → Migration** | Zero-risk proving, gradual transition |

### 1.4 Architecture Philosophy

```
"Shopify for Token-Gated Communities"

┌─────────────────────────────────────────────────────────────────────┐
│                        DESIGN PRINCIPLES                             │
├─────────────────────────────────────────────────────────────────────┤
│  1. RESILIENCE FIRST: Two-tier providers, circuit breakers          │
│  2. TENANT ISOLATION: RLS, bulkhead, rate limiting per community    │
│  3. GRACEFUL DEGRADATION: Native fallbacks when Score Service down  │
│  4. ZERO-DOWNTIME COEXISTENCE: Shadow mode proves accuracy first    │
│  5. HORIZONTAL SCALE: Stateless workers, sharded gateway            │
│  6. COST-CONSCIOUS: Pay-per-op ScyllaDB, serverless where possible │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. Current State Architecture

### 2.1 Implemented Gateway Proxy Pattern (GW-1 to GW-5)

The existing architecture from sprints GW-1 through GW-5 and S-1 through S-14:

```
┌──────────────┐    ┌───────────────────────────────────────────────────────────────┐
│   Discord    │    │                    Current Implementation                      │
│   Gateway    │◄──►│  ┌────────────────────────────────────────────────────────┐   │
│   (API)      │    │  │         Twilight Gateway (Rust) - apps/gateway/        │   │
└──────────────┘    │  │  • Shard pools (25 shards/pod)                         │   │
                    │  │  • Event serialization to JSON                          │   │
                    │  │  • NATS publishing                                      │   │
                    │  │  • Health/metrics endpoints                             │   │
                    │  └────────────────────────┬───────────────────────────────┘   │
                    │                           │                                    │
                    │  ┌────────────────────────▼───────────────────────────────┐   │
                    │  │         NATS JetStream (3-node) - infrastructure/       │   │
                    │  │  • COMMANDS stream (memory, 60s)                        │   │
                    │  │  • EVENTS stream (memory, 5min)                         │   │
                    │  │  • ELIGIBILITY stream (file, 7 days)                    │   │
                    │  └────────────────────────┬───────────────────────────────┘   │
                    │                           │                                    │
                    │  ┌────────────────────────▼───────────────────────────────┐   │
                    │  │       TypeScript Workers - apps/worker/                 │   │
                    │  │  • CommandNatsConsumer                                  │   │
                    │  │  • EventNatsConsumer                                    │   │
                    │  │  • EligibilityNatsConsumer                              │   │
                    │  │  • 12+ command handlers                                 │   │
                    │  │  • Multi-layer caching (L1 + L2)                        │   │
                    │  │  • Rate limiting (rate-limiter-flexible)                │   │
                    │  │  • RPC pool with circuit breakers                       │   │
                    │  └────────────────────────┬───────────────────────────────┘   │
                    │                           │                                    │
                    │         ┌─────────────────┼─────────────────┐                  │
                    │         │                 │                 │                  │
                    │         ▼                 ▼                 ▼                  │
                    │  ┌────────────┐   ┌────────────┐   ┌────────────────┐          │
                    │  │ PostgreSQL │   │  ScyllaDB  │   │     Redis      │          │
                    │  │ + PgBouncer│   │ Serverless │   │   ElastiCache  │          │
                    │  │            │   │            │   │                │          │
                    │  │ • profiles │   │ • scores   │   │ • sessions     │          │
                    │  │ • rules    │   │ • leaders  │   │ • rate limits  │          │
                    │  │ • audit    │   │ • history  │   │ • L2 cache     │          │
                    │  └────────────┘   └────────────┘   └────────────────┘          │
                    └───────────────────────────────────────────────────────────────┘
```

### 2.2 What's Missing for Genesis

| Gap | Current State | Genesis Requirement |
|-----|---------------|---------------------|
| Chain Provider | Direct RPC only | Two-tier with Score Service |
| Themes | Hardcoded Dune | Configurable BasicTheme/SietchTheme |
| Onboarding | Manual | Self-service WizardEngine |
| Multi-tenancy | Basic TenantContext | Full RLS, tier enforcement |
| Secrets | Environment variables | HashiCorp Vault Transit |
| Coexistence | N/A | Shadow/Parallel/Migration modes |
| Web UI | None | Hybrid wizard interface |

---

## 3. Target State Architecture

### 3.1 Full Genesis Architecture

```
                                   ┌─────────────────────────────────────┐
                                   │           Control Plane             │
                                   │  ┌───────────────────────────────┐  │
                                   │  │       Admin Portal (Web)      │  │
                                   │  │  • Community management        │  │
                                   │  │  • Theme configuration         │  │
                                   │  │  • Analytics dashboard         │  │
                                   │  │  • Coexistence controls        │  │
                                   │  └───────────────┬───────────────┘  │
                                   │                  │                  │
                                   │  ┌───────────────▼───────────────┐  │
                                   │  │     Tenant Config Store       │  │
                                   │  │  • Community settings (PG)    │  │
                                   │  │  • Theme assignments          │  │
                                   │  │  • Subscription tiers         │  │
                                   │  │  • Coexistence mode           │  │
                                   │  └───────────────────────────────┘  │
                                   └──────────────────┬──────────────────┘
                                                      │
┌──────────────┐    ┌──────────────────────────────────────────────────────────────────────────┐
│   Discord    │    │                             Data Plane                                   │
│   Gateway    │◄──►│  ┌────────────────────────────────────────────────────────────────────┐  │
│   (API)      │    │  │              Twilight Gateway (Rust) - Sharded                     │  │
└──────────────┘    │  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐   │  │
                    │  │  │ Pool 0  │  │ Pool 1  │  │ Pool 2  │  │ Pool 3  │  │ Pool N  │   │  │
                    │  │  │ 0-24    │  │ 25-49   │  │ 50-74   │  │ 75-99   │  │ ...     │   │  │
                    │  │  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘   │  │
                    │  └───────┼────────────┼────────────┼────────────┼────────────┼────────┘  │
                    │          └────────────┴─────┬──────┴────────────┴────────────┘           │
                    │                             ▼                                            │
                    │  ┌──────────────────────────────────────────────────────────────────┐   │
                    │  │               NATS JetStream Cluster (3 nodes)                   │   │
                    │  │                                                                  │   │
                    │  │   ┌────────────────┐  ┌────────────────┐  ┌────────────────┐    │   │
                    │  │   │ COMMANDS       │  │ EVENTS         │  │ ELIGIBILITY    │    │   │
                    │  │   │ commands.*     │  │ events.*       │  │ eligibility.*  │    │   │
                    │  │   │ (memory, 60s)  │  │ (memory, 5min) │  │ (file, 7 days) │    │   │
                    │  │   └────────────────┘  └────────────────┘  └────────────────┘    │   │
                    │  │                                                                  │   │
                    │  │   ┌────────────────┐  ┌────────────────┐  ┌────────────────┐    │   │
                    │  │   │ SYNTHESIS      │  │ COEXISTENCE    │  │ INTERNAL       │    │   │
                    │  │   │ synthesis.*    │  │ coexist.*      │  │ internal.*     │    │   │
                    │  │   │ (file, 24h)    │  │ (file, 7 days) │  │ (memory, 1min) │    │   │
                    │  │   └────────────────┘  └────────────────┘  └────────────────┘    │   │
                    │  └─────────┬─────────────────┬─────────────────┬─────────────────┬───┘   │
                    │            │                 │                 │                 │       │
                    │            ▼                 ▼                 ▼                 ▼       │
                    │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
                    │  │   Command    │  │    Event     │  │ Eligibility  │  │ Coexistence  │  │
                    │  │   Workers    │  │   Workers    │  │   Workers    │  │   Workers    │  │
                    │  │  (3-10 pods) │  │  (2-5 pods)  │  │  (3-15 pods) │  │  (2-5 pods)  │  │
                    │  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  │
                    │         │                 │                 │                 │         │
                    │         └─────────────────┴────────┬────────┴─────────────────┘         │
                    │                                    │                                    │
                    │         ┌──────────────────────────┴──────────────────────────┐         │
                    │         │                 Shared Services                     │         │
                    │         │                                                     │         │
                    │         │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │         │
                    │         │  │ Two-Tier    │  │  Theme      │  │  Synthesis  │  │         │
                    │         │  │ Chain       │  │  Registry   │  │  Engine     │  │         │
                    │         │  │ Provider    │  │             │  │  (BullMQ)   │  │         │
                    │         │  └──────┬──────┘  └─────────────┘  └─────────────┘  │         │
                    │         │         │                                           │         │
                    │         │  ┌──────▼──────────────────────────────────────┐   │         │
                    │         │  │           Score Service (Rust)              │   │         │
                    │         │  │  • Real-time blockchain event ingestion     │   │         │
                    │         │  │  • Score computation engine                  │   │         │
                    │         │  │  • Ranking & leaderboard calculation        │   │         │
                    │         │  │  • Cross-chain aggregation                   │   │         │
                    │         │  └─────────────────────────────────────────────┘   │         │
                    │         │                                                     │         │
                    │         │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │         │
                    │         │  │   Redis     │  │   Vault     │  │    RPC      │  │         │
                    │         │  │   Cluster   │  │   Transit   │  │    Pool     │  │         │
                    │         │  │   (3 nodes) │  │   (HSM)     │  │  (3 provs)  │  │         │
                    │         │  └─────────────┘  └─────────────┘  └─────────────┘  │         │
                    │         └─────────────────────────────────────────────────────┘         │
                    │                                    │                                    │
                    └────────────────────────────────────┼────────────────────────────────────┘
                                                         │
                    ┌────────────────────────────────────┴────────────────────────────────────┐
                    │                         Hybrid Data Layer                               │
                    │                                                                         │
                    │  ┌─────────────────────────┐      ┌─────────────────────────┐          │
                    │  │   PostgreSQL + PgBouncer│      │   ScyllaDB Serverless   │          │
                    │  │                         │      │                         │          │
                    │  │  • communities          │      │  • scores               │          │
                    │  │  • profiles             │      │  • score_history        │          │
                    │  │  • eligibility_rules    │      │  • leaderboards         │          │
                    │  │  • themes               │      │  • eligibility_snapshots│          │
                    │  │  • wizard_sessions      │      │  • chain_events         │          │
                    │  │  • audit_logs           │      │  • shadow_ledger        │          │
                    │  │  • coexistence_config   │      │                         │          │
                    │  │                         │      │  High-velocity data     │          │
                    │  │  Transactional data     │      │  ~$100/mo serverless    │          │
                    │  │  ~$150/mo               │      │                         │          │
                    │  └─────────────────────────┘      └─────────────────────────┘          │
                    │                                                                         │
                    │  ┌─────────────────────────────────────────────────────────────────┐   │
                    │  │                       S3 (Shadow State)                         │   │
                    │  │  • Manifest history (git-style versioning)                      │   │
                    │  │  • Audit trail archives                                          │   │
                    │  │  • Wizard session backups                                        │   │
                    │  └─────────────────────────────────────────────────────────────────┘   │
                    └─────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Component Responsibilities

| Component | Responsibility | Scaling Strategy |
|-----------|----------------|------------------|
| **Twilight Gateway** | Discord WebSocket, event serialization | Shard pools (25/pod), KEDA |
| **NATS JetStream** | Message persistence, consumer groups | 3-node cluster, multi-AZ |
| **Command Workers** | Slash commands, Discord responses | HPA: 3-10 pods |
| **Event Workers** | Guild/member lifecycle | HPA: 2-5 pods |
| **Eligibility Workers** | Token checks, RPC calls | HPA: 3-15 pods |
| **Coexistence Workers** | Shadow sync, comparison | HPA: 2-5 pods |
| **Score Service** | Blockchain indexing, rankings | Stateless, HPA: 3-10 pods |
| **Synthesis Engine** | Discord role mutations | BullMQ, rate-limited |
| **Theme Registry** | Theme resolution, validation | In-memory + Redis |
| **Vault Transit** | HSM-backed cryptography | HA cluster |

---

## 4. Technology Stack

### 4.1 Runtime Technologies

| Layer | Technology | Version | Justification |
|-------|------------|---------|---------------|
| **Gateway** | Rust + Twilight | 1.75 / 0.15 | 5x memory efficiency |
| **Workers** | TypeScript + Node.js | 5.3 / 20 LTS | Existing codebase |
| **Score Service** | Rust | 1.75 | Performance for indexing |
| **Web UI** | Next.js | 14+ | SSR, API routes |
| **Orchestration** | Kubernetes (EKS) | 1.28+ | HPA/KEDA |

### 4.2 Data Technologies

| Layer | Technology | Version | Justification |
|-------|------------|---------|---------------|
| **Config DB** | PostgreSQL | 15.x | Transactions, RLS |
| **Connection Pool** | PgBouncer | 1.21 | Connection management |
| **ORM** | Drizzle | 0.35+ | Type-safe queries |
| **Score DB** | ScyllaDB Cloud | Serverless | 1M+ writes/sec |
| **Cache** | Redis Cluster | 7.0 | Distributed state |
| **Object Store** | S3 | - | Shadow state, archives |

### 4.3 Messaging Technologies

| Layer | Technology | Version | Justification |
|-------|------------|---------|---------------|
| **Broker** | NATS JetStream | 2.10+ | Low latency, persistence |
| **Task Queue** | BullMQ | 5.x | Rate-limited synthesis |
| **Client (Rust)** | async-nats | 0.33 | Native async |
| **Client (TS)** | nats.js | 2.x | Official client |

### 4.4 Security Technologies

| Layer | Technology | Version | Justification |
|-------|------------|---------|---------------|
| **Secrets** | HashiCorp Vault | 1.15+ | HSM-backed Transit |
| **Auth** | Discord OAuth2 | - | Native integration |
| **API Auth** | JWT | - | Stateless tokens |
| **TLS** | cert-manager | 1.13+ | Automatic certificates |

### 4.5 Observability Technologies

| Layer | Technology | Version | Justification |
|-------|------------|---------|---------------|
| **Metrics** | Prometheus | 2.x | Industry standard |
| **Dashboards** | Grafana | 10.x | Visualization |
| **Tracing** | OpenTelemetry | 1.x | Distributed tracing |
| **Trace Backend** | Tempo | 2.x | Grafana-native |
| **Logging** | Pino/tracing | - | Structured JSON |

---

## 5. Part I: Infrastructure Components

### 5.1 Twilight Gateway (Rust)

> Reference: SDD v1.0 §5.1 - Preserved and enhanced

#### 5.1.1 Project Structure (Existing)

```
apps/gateway/
├── Cargo.toml
├── src/
│   ├── main.rs              # Entry point with pool orchestration
│   ├── config.rs            # GatewayConfig
│   ├── shard/
│   │   ├── mod.rs
│   │   ├── pool.rs          # ShardPool (25 shards/pod)
│   │   └── state.rs         # ShardHealth tracking
│   ├── events/
│   │   ├── mod.rs
│   │   └── serialize.rs     # Event → NATS payload
│   ├── nats/
│   │   ├── mod.rs
│   │   └── publisher.rs     # NatsPublisher
│   ├── metrics/mod.rs       # Prometheus
│   └── health/mod.rs        # K8s probes
└── Dockerfile
```

#### 5.1.2 Memory Budget (Validated S-14)

| Component | Memory (per 1k guilds) |
|-----------|------------------------|
| Shard state | ~5 MB |
| Event buffers | ~10 MB |
| NATS client | ~5 MB |
| Metrics | ~2 MB |
| Misc | ~8 MB |
| **Total** | **<40 MB** ✓ |

### 5.2 TypeScript Workers

> Reference: SDD v1.0 §5.2 - Preserved and enhanced

#### 5.2.1 Project Structure (Current)

```
apps/worker/
├── src/
│   ├── index.ts
│   ├── main-nats.ts         # NATS entry point
│   ├── consumers/
│   │   ├── BaseNatsConsumer.ts
│   │   ├── CommandNatsConsumer.ts
│   │   ├── EventNatsConsumer.ts
│   │   └── EligibilityNatsConsumer.ts
│   ├── handlers/
│   │   └── commands/        # 12+ handlers
│   ├── services/
│   │   ├── NatsClient.ts
│   │   ├── DiscordRest.ts
│   │   ├── StateManager.ts
│   │   ├── TenantContext.ts
│   │   ├── HotPathService.ts
│   │   ├── WriteBehindCache.ts
│   │   └── RateLimiterService.ts
│   ├── repositories/
│   │   ├── ScoreRepository.ts
│   │   ├── LeaderboardRepository.ts
│   │   └── EligibilityRepository.ts
│   └── infrastructure/
│       ├── cache/           # Multi-layer (L1+L2)
│       ├── scylla/          # ScyllaDB client
│       ├── rpc/             # viem pool
│       └── tracing/         # OTLP
└── tests/
```

### 5.3 RPC Pool with Circuit Breakers

> Reference: SDD v1.0 §5.3 - Implemented in apps/worker/src/infrastructure/rpc/

```typescript
// Current implementation: apps/worker/src/infrastructure/rpc/rpc-pool.ts
// Features:
// - 3 providers (Alchemy, Infura, QuickNode)
// - Circuit breakers via opossum
// - Bulkhead pattern via Bottleneck
// - viem retries disabled (opossum handles)
// - Prometheus metrics for circuit state
```

---

## 6. Part II: SaaS Platform Components

### 6.1 Two-Tier Chain Provider

#### 6.1.1 Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Two-Tier Chain Provider                           │
│                                                                      │
│  ┌─────────────────────────┐    ┌─────────────────────────────────┐ │
│  │   TIER 1: Native Reader │    │   TIER 2: Score Service         │ │
│  │   (Always Available)    │    │   (Complex Queries)             │ │
│  │                         │    │                                  │ │
│  │  • hasBalance()         │    │  • getRankedHolders()           │ │
│  │  • ownsNFT()            │    │  • getAddressRank()             │ │
│  │  • getBalance()         │    │  • checkActionHistory()         │ │
│  │                         │    │  • getCrossChainScore()         │ │
│  │  Direct viem RPC        │    │  Internal gRPC service          │ │
│  │  <100ms response        │    │  Circuit breaker protected      │ │
│  └──────────┬──────────────┘    └──────────┬──────────────────────┘ │
│             │                               │                        │
│             │    ┌──────────────────────────┘                        │
│             │    │                                                   │
│             ▼    ▼                                                   │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │              TwoTierChainProvider Orchestrator                  ││
│  │                                                                 ││
│  │  checkBasicEligibility()  → Tier 1 only (Native Reader)        ││
│  │  checkAdvancedEligibility() → Tier 2 + Tier 1 fallback         ││
│  │                                                                 ││
│  │  Degradation: { source: 'native_degraded' } when Tier 2 down   ││
│  └─────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
```

#### 6.1.2 Interface Definitions

```typescript
// packages/core/ports/chain-provider.ts

export interface IChainProvider {
  // Tier 1: Native Reader (always available)
  hasBalance(address: Address, token: Address, minAmount: bigint): Promise<boolean>;
  ownsNFT(address: Address, collection: Address, tokenId?: bigint): Promise<boolean>;
  getBalance(address: Address, token: Address): Promise<bigint>;

  // Tier 2: Score Service (may be unavailable)
  getRankedHolders(asset: AssetConfig, limit: number): Promise<RankedHolder[]>;
  getAddressRank(address: Address, asset: AssetConfig): Promise<number | null>;
  checkActionHistory(address: Address, action: ActionType): Promise<boolean>;
  getCrossChainScore(address: Address, chains: ChainId[]): Promise<CrossChainScore>;
}

export interface EligibilityResult {
  eligible: boolean;
  source: 'native' | 'score_service' | 'native_degraded';
  confidence: number;
  details: {
    tierMatched?: string;
    score?: number;
    rank?: number;
  };
}
```

#### 6.1.3 Native Blockchain Reader

```typescript
// packages/adapters/chain/native-reader.ts

import { createPublicClient, http, fallback, PublicClient } from 'viem';
import type { Logger } from 'pino';

export class NativeBlockchainReader {
  private clients: Map<ChainId, PublicClient> = new Map();

  constructor(
    private readonly rpcPool: RPCPool,
    private readonly cache: MultiLayerCache,
    private readonly log: Logger,
  ) {}

  async hasBalance(
    chainId: ChainId,
    address: Address,
    token: Address,
    minAmount: bigint,
  ): Promise<boolean> {
    const cacheKey = `balance:${chainId}:${address}:${token}`;

    // Check cache first (5 minute TTL)
    const cached = await this.cache.get<bigint>(cacheKey);
    if (cached !== null) {
      return cached >= minAmount;
    }

    // Direct RPC call
    const balance = await this.rpcPool.getBalance(address, token);

    // Cache result
    await this.cache.set(cacheKey, balance, { ttl: 300 });

    return balance >= minAmount;
  }

  async ownsNFT(
    chainId: ChainId,
    address: Address,
    collection: Address,
    tokenId?: bigint,
  ): Promise<boolean> {
    const cacheKey = tokenId
      ? `nft:${chainId}:${collection}:${tokenId}:${address}`
      : `nft:${chainId}:${collection}:${address}`;

    const cached = await this.cache.get<boolean>(cacheKey);
    if (cached !== null) return cached;

    const client = this.getClient(chainId);

    if (tokenId !== undefined) {
      // ERC721 ownerOf
      const owner = await client.readContract({
        address: collection,
        abi: ERC721_ABI,
        functionName: 'ownerOf',
        args: [tokenId],
      });
      const owns = owner.toLowerCase() === address.toLowerCase();
      await this.cache.set(cacheKey, owns, { ttl: 300 });
      return owns;
    } else {
      // ERC721 balanceOf > 0
      const balance = await client.readContract({
        address: collection,
        abi: ERC721_ABI,
        functionName: 'balanceOf',
        args: [address],
      });
      const owns = balance > 0n;
      await this.cache.set(cacheKey, owns, { ttl: 300 });
      return owns;
    }
  }
}
```

#### 6.1.4 Score Service (Rust Microservice)

```
apps/score-service/
├── Cargo.toml
├── src/
│   ├── main.rs                 # Entry point, gRPC server
│   ├── config.rs               # Configuration
│   ├── indexer/
│   │   ├── mod.rs
│   │   ├── evm.rs              # EVM chain indexer
│   │   ├── solana.rs           # Solana indexer (future)
│   │   └── webhook.rs          # Alchemy/QuickNode webhooks
│   ├── scoring/
│   │   ├── mod.rs
│   │   ├── engine.rs           # Score computation
│   │   ├── conviction.rs       # Conviction score algorithm
│   │   └── activity.rs         # Activity score algorithm
│   ├── ranking/
│   │   ├── mod.rs
│   │   └── leaderboard.rs      # Ranking computation
│   ├── storage/
│   │   ├── mod.rs
│   │   ├── scylla.rs           # ScyllaDB client
│   │   └── cache.rs            # Redis cache
│   ├── grpc/
│   │   ├── mod.rs
│   │   ├── server.rs           # gRPC server
│   │   └── score.proto         # Protocol definitions
│   └── metrics/mod.rs          # Prometheus
├── proto/
│   └── score.proto             # gRPC definitions
└── Dockerfile
```

**Score Service gRPC Protocol:**

```protobuf
// apps/score-service/proto/score.proto

syntax = "proto3";
package arrakis.score;

service ScoreService {
  // Get ranked holders for an asset
  rpc GetRankedHolders(RankedHoldersRequest) returns (RankedHoldersResponse);

  // Get rank for a specific address
  rpc GetAddressRank(AddressRankRequest) returns (AddressRankResponse);

  // Check action history
  rpc CheckActionHistory(ActionHistoryRequest) returns (ActionHistoryResponse);

  // Get cross-chain aggregated score
  rpc GetCrossChainScore(CrossChainScoreRequest) returns (CrossChainScoreResponse);

  // Health check
  rpc HealthCheck(HealthCheckRequest) returns (HealthCheckResponse);
}

message RankedHoldersRequest {
  string community_id = 1;
  string asset_type = 2;      // "token" | "nft"
  string contract_address = 3;
  string chain_id = 4;
  int32 limit = 5;
  int32 offset = 6;
}

message RankedHolder {
  string address = 1;
  int32 rank = 2;
  string score = 3;           // Decimal as string
  string balance = 4;         // BigInt as string
}

message RankedHoldersResponse {
  repeated RankedHolder holders = 1;
  int32 total_count = 2;
  int64 computed_at = 3;      // Unix timestamp
}

message AddressRankRequest {
  string community_id = 1;
  string address = 2;
  string asset_type = 3;
  string contract_address = 4;
  string chain_id = 5;
}

message AddressRankResponse {
  int32 rank = 1;             // 0 if not ranked
  string score = 2;
  int32 total_holders = 3;
  bool found = 4;
}
```

#### 6.1.5 Two-Tier Orchestrator

```typescript
// packages/adapters/chain/two-tier-provider.ts

import CircuitBreaker from 'opossum';
import type { Logger } from 'pino';

export class TwoTierChainProvider implements IChainProvider {
  private scoreServiceBreaker: CircuitBreaker;

  constructor(
    private readonly nativeReader: NativeBlockchainReader,
    private readonly scoreServiceClient: ScoreServiceClient,
    private readonly cache: MultiLayerCache,
    private readonly metrics: PrometheusClient,
    private readonly log: Logger,
  ) {
    // Circuit breaker for Score Service
    this.scoreServiceBreaker = new CircuitBreaker(
      async (fn: () => Promise<unknown>) => fn(),
      {
        timeout: 5000,              // 5s timeout
        errorThresholdPercentage: 50,
        resetTimeout: 30000,        // 30s reset
        volumeThreshold: 10,
      },
    );

    this.scoreServiceBreaker.on('open', () => {
      this.log.warn('Score Service circuit breaker OPEN');
      this.metrics.circuitState.set({ service: 'score' }, 2);
    });

    this.scoreServiceBreaker.on('close', () => {
      this.log.info('Score Service circuit breaker CLOSED');
      this.metrics.circuitState.set({ service: 'score' }, 0);
    });
  }

  /**
   * Basic eligibility check - Tier 1 only (always available)
   */
  async checkBasicEligibility(
    rule: EligibilityRule,
    address: Address,
  ): Promise<EligibilityResult> {
    switch (rule.ruleType) {
      case 'token_balance':
        const hasBalance = await this.nativeReader.hasBalance(
          rule.chainId,
          address,
          rule.contractAddress,
          BigInt(rule.parameters.minAmount),
        );
        return {
          eligible: hasBalance,
          source: 'native',
          confidence: 1.0,
          details: {},
        };

      case 'nft_ownership':
        const ownsNFT = await this.nativeReader.ownsNFT(
          rule.chainId,
          address,
          rule.contractAddress,
          rule.parameters.tokenId ? BigInt(rule.parameters.tokenId) : undefined,
        );
        return {
          eligible: ownsNFT,
          source: 'native',
          confidence: 1.0,
          details: {},
        };

      default:
        throw new Error(`Basic eligibility doesn't support rule type: ${rule.ruleType}`);
    }
  }

  /**
   * Advanced eligibility check - Tier 2 with Tier 1 fallback
   */
  async checkAdvancedEligibility(
    rule: EligibilityRule,
    address: Address,
  ): Promise<EligibilityResult> {
    // Try Score Service first
    try {
      const result = await this.scoreServiceBreaker.fire(async () => {
        return this.checkViaScoreService(rule, address);
      });
      return result as EligibilityResult;
    } catch (error) {
      this.log.warn({ error, rule: rule.id }, 'Score Service unavailable, using fallback');

      // Fallback to native reader with degraded result
      return this.degradedFallback(rule, address);
    }
  }

  private async checkViaScoreService(
    rule: EligibilityRule,
    address: Address,
  ): Promise<EligibilityResult> {
    switch (rule.ruleType) {
      case 'score_threshold':
        const rankResponse = await this.scoreServiceClient.getAddressRank({
          communityId: rule.communityId,
          address,
          assetType: rule.parameters.assetType,
          contractAddress: rule.contractAddress,
          chainId: rule.chainId,
        });

        if (!rankResponse.found) {
          return {
            eligible: false,
            source: 'score_service',
            confidence: 1.0,
            details: { rank: null },
          };
        }

        const eligible = rankResponse.rank <= rule.parameters.maxRank;
        return {
          eligible,
          source: 'score_service',
          confidence: 1.0,
          details: {
            rank: rankResponse.rank,
            score: rankResponse.score,
          },
        };

      case 'activity_check':
        const actionResult = await this.scoreServiceClient.checkActionHistory({
          address,
          action: rule.parameters.actionType,
        });
        return {
          eligible: actionResult.hasPerformed,
          source: 'score_service',
          confidence: 1.0,
          details: {},
        };

      default:
        throw new Error(`Score Service doesn't support rule type: ${rule.ruleType}`);
    }
  }

  private async degradedFallback(
    rule: EligibilityRule,
    address: Address,
  ): Promise<EligibilityResult> {
    // For rank-based rules, fall back to balance check (permissive)
    if (rule.ruleType === 'score_threshold') {
      const hasAnyBalance = await this.nativeReader.hasBalance(
        rule.chainId,
        address,
        rule.contractAddress,
        1n, // Any balance
      );
      return {
        eligible: hasAnyBalance, // Permissive when degraded
        source: 'native_degraded',
        confidence: 0.5, // Low confidence
        details: {
          degradedReason: 'Score Service unavailable',
        },
      };
    }

    // For activity checks, return cached or deny (safe)
    if (rule.ruleType === 'activity_check') {
      const cached = await this.cache.get<boolean>(`activity:${address}:${rule.parameters.actionType}`);
      return {
        eligible: cached ?? false, // Deny if no cache (safe)
        source: 'native_degraded',
        confidence: cached ? 0.8 : 0.0,
        details: {
          degradedReason: 'Score Service unavailable, using cache',
        },
      };
    }

    throw new Error(`No fallback available for rule type: ${rule.ruleType}`);
  }

  // Tier 1 methods (delegate to native reader)
  async hasBalance(address: Address, token: Address, minAmount: bigint): Promise<boolean> {
    return this.nativeReader.hasBalance('berachain', address, token, minAmount);
  }

  async ownsNFT(address: Address, collection: Address, tokenId?: bigint): Promise<boolean> {
    return this.nativeReader.ownsNFT('berachain', address, collection, tokenId);
  }

  async getBalance(address: Address, token: Address): Promise<bigint> {
    return this.nativeReader.getBalance('berachain', address, token);
  }
}
```

#### 6.1.6 Degradation Matrix

| Query Type | Score DOWN | Fallback Behavior | Confidence |
|------------|------------|-------------------|------------|
| Token Balance | ✅ Works | Native Reader | 1.0 |
| NFT Ownership | ✅ Works | Native Reader | 1.0 |
| Rank Threshold | ⚠️ Degraded | Balance check (permissive) | 0.5 |
| Never Redeemed | ⚠️ Degraded | Cached or deny (safe) | 0.0-0.8 |
| Activity Score | ❌ Unavailable | Return 0 or cached | 0.0-0.8 |

### 6.2 Themes System

#### 6.2.1 Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                          Themes System                               │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │                    IThemeProvider Interface                      ││
│  │                                                                  ││
│  │  • getTierConfig(): TierConfig[]                                ││
│  │  • getBadgeConfig(): BadgeConfig[]                              ││
│  │  • getNamingConfig(): NamingConfig                              ││
│  │  • evaluateTier(score: number): TierResult                      ││
│  │  • evaluateBadges(profile: Profile): Badge[]                    ││
│  └──────────────────────────┬──────────────────────────────────────┘│
│                             │                                        │
│            ┌────────────────┼────────────────┐                       │
│            │                │                │                       │
│            ▼                ▼                ▼                       │
│  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐        │
│  │   BasicTheme    │ │  SietchTheme    │ │ CustomTheme     │        │
│  │   (Free)        │ │  (Premium)      │ │ (Enterprise)    │        │
│  │                 │ │                 │ │                 │        │
│  │  3 tiers        │ │  9 tiers        │ │  N tiers        │        │
│  │  5 badges       │ │  10+ badges     │ │  N badges       │        │
│  │  Generic naming │ │  Dune naming    │ │  Custom naming  │        │
│  └─────────────────┘ └─────────────────┘ └─────────────────┘        │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │                      ThemeRegistry                               ││
│  │                                                                  ││
│  │  • get(themeId: string): IThemeProvider                         ││
│  │  • getAvailableThemes(tier: SubscriptionTier): ThemeInfo[]      ││
│  │  • registerTheme(theme: IThemeProvider): void                   ││
│  │  • validateTheme(theme: IThemeProvider): ValidationResult       ││
│  └─────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
```

#### 6.2.2 Interface Definitions

```typescript
// packages/core/ports/theme-provider.ts

export interface TierConfig {
  id: string;
  name: string;
  displayName: string;
  minRank: number;
  maxRank: number;
  roleColor: number;          // Discord role color
  permissions: string[];
  emoji?: string;
}

export interface BadgeConfig {
  id: string;
  name: string;
  displayName: string;
  description: string;
  emoji: string;
  evaluator: BadgeEvaluatorType;
  parameters: Record<string, unknown>;
  rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
}

export interface NamingConfig {
  tierPrefix: string;         // e.g., "Rank" or "Tier"
  tierSuffix: string;         // e.g., "" or "Member"
  communityNoun: string;      // e.g., "Members" or "Fremen"
  leaderboardTitle: string;   // e.g., "Top Holders" or "Conviction Rankings"
  scoreLabel: string;         // e.g., "Score" or "Conviction"
}

export interface TierResult {
  tier: TierConfig;
  score: number;
  rank: number;
  percentile: number;
}

export interface IThemeProvider {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly subscriptionTier: 'free' | 'pro' | 'enterprise';

  getTierConfig(): TierConfig[];
  getBadgeConfig(): BadgeConfig[];
  getNamingConfig(): NamingConfig;

  evaluateTier(score: number, totalMembers: number, rank: number): TierResult;
  evaluateBadges(profile: Profile, history: ProfileHistory): Badge[];
}
```

#### 6.2.3 BasicTheme Implementation

```typescript
// packages/adapters/themes/basic-theme.ts

export class BasicTheme implements IThemeProvider {
  readonly id = 'basic';
  readonly name = 'Basic Theme';
  readonly description = 'Simple 3-tier progression with 5 badges';
  readonly subscriptionTier = 'free' as const;

  private readonly tiers: TierConfig[] = [
    {
      id: 'gold',
      name: 'gold',
      displayName: 'Gold',
      minRank: 1,
      maxRank: 10,
      roleColor: 0xFFD700,
      permissions: ['view_analytics', 'priority_support'],
      emoji: '🥇',
    },
    {
      id: 'silver',
      name: 'silver',
      displayName: 'Silver',
      minRank: 11,
      maxRank: 50,
      roleColor: 0xC0C0C0,
      permissions: ['view_analytics'],
      emoji: '🥈',
    },
    {
      id: 'bronze',
      name: 'bronze',
      displayName: 'Bronze',
      minRank: 51,
      maxRank: 100,
      roleColor: 0xCD7F32,
      permissions: [],
      emoji: '🥉',
    },
  ];

  private readonly badges: BadgeConfig[] = [
    {
      id: 'early_adopter',
      name: 'early_adopter',
      displayName: 'Early Adopter',
      description: 'Joined in the first 100 members',
      emoji: '🌟',
      evaluator: 'join_order',
      parameters: { maxPosition: 100 },
      rarity: 'rare',
    },
    {
      id: 'veteran',
      name: 'veteran',
      displayName: 'Veteran',
      description: 'Member for over 6 months',
      emoji: '🎖️',
      evaluator: 'tenure',
      parameters: { minDays: 180 },
      rarity: 'uncommon',
    },
    {
      id: 'top_tier',
      name: 'top_tier',
      displayName: 'Top Tier',
      description: 'Reached Gold tier',
      emoji: '👑',
      evaluator: 'tier_reached',
      parameters: { tierId: 'gold' },
      rarity: 'rare',
    },
    {
      id: 'active',
      name: 'active',
      displayName: 'Active Member',
      description: 'Active in the last 30 days',
      emoji: '⚡',
      evaluator: 'recent_activity',
      parameters: { maxDays: 30 },
      rarity: 'common',
    },
    {
      id: 'contributor',
      name: 'contributor',
      displayName: 'Contributor',
      description: 'Made significant contributions',
      emoji: '🤝',
      evaluator: 'manual_grant',
      parameters: {},
      rarity: 'epic',
    },
  ];

  private readonly naming: NamingConfig = {
    tierPrefix: 'Rank',
    tierSuffix: '',
    communityNoun: 'Members',
    leaderboardTitle: 'Top Holders',
    scoreLabel: 'Score',
  };

  getTierConfig(): TierConfig[] {
    return this.tiers;
  }

  getBadgeConfig(): BadgeConfig[] {
    return this.badges;
  }

  getNamingConfig(): NamingConfig {
    return this.naming;
  }

  evaluateTier(score: number, totalMembers: number, rank: number): TierResult {
    const tier = this.tiers.find(t => rank >= t.minRank && rank <= t.maxRank);

    if (!tier) {
      // Beyond configured tiers, return lowest
      return {
        tier: this.tiers[this.tiers.length - 1],
        score,
        rank,
        percentile: (rank / totalMembers) * 100,
      };
    }

    return {
      tier,
      score,
      rank,
      percentile: (rank / totalMembers) * 100,
    };
  }

  evaluateBadges(profile: Profile, history: ProfileHistory): Badge[] {
    const badges: Badge[] = [];

    for (const config of this.badges) {
      const earned = this.evaluateBadge(config, profile, history);
      if (earned) {
        badges.push({
          id: config.id,
          name: config.displayName,
          emoji: config.emoji,
          earnedAt: earned.earnedAt,
          rarity: config.rarity,
        });
      }
    }

    return badges;
  }

  private evaluateBadge(
    config: BadgeConfig,
    profile: Profile,
    history: ProfileHistory,
  ): { earnedAt: Date } | null {
    switch (config.evaluator) {
      case 'join_order':
        if (profile.joinPosition <= config.parameters.maxPosition) {
          return { earnedAt: profile.createdAt };
        }
        break;

      case 'tenure':
        const daysSinceJoin = Math.floor(
          (Date.now() - profile.createdAt.getTime()) / (1000 * 60 * 60 * 24)
        );
        if (daysSinceJoin >= config.parameters.minDays) {
          const earnedAt = new Date(
            profile.createdAt.getTime() + config.parameters.minDays * 24 * 60 * 60 * 1000
          );
          return { earnedAt };
        }
        break;

      case 'tier_reached':
        if (history.tierHistory.some(h => h.tierId === config.parameters.tierId)) {
          const tierEvent = history.tierHistory.find(h => h.tierId === config.parameters.tierId);
          return { earnedAt: tierEvent!.achievedAt };
        }
        break;

      case 'recent_activity':
        const daysSinceActive = Math.floor(
          (Date.now() - profile.lastActiveAt.getTime()) / (1000 * 60 * 60 * 24)
        );
        if (daysSinceActive <= config.parameters.maxDays) {
          return { earnedAt: profile.lastActiveAt };
        }
        break;

      case 'manual_grant':
        // Check manual grants in profile
        const grant = profile.manualBadges?.find(b => b.badgeId === config.id);
        if (grant) {
          return { earnedAt: grant.grantedAt };
        }
        break;
    }

    return null;
  }
}
```

#### 6.2.4 SietchTheme Implementation (Premium)

```typescript
// packages/adapters/themes/sietch-theme.ts

export class SietchTheme implements IThemeProvider {
  readonly id = 'sietch';
  readonly name = 'Sietch Theme';
  readonly description = 'Dune-themed 9-tier progression (v4.1 parity)';
  readonly subscriptionTier = 'pro' as const;

  private readonly tiers: TierConfig[] = [
    {
      id: 'naib',
      name: 'naib',
      displayName: 'Naib',
      minRank: 1,
      maxRank: 1,
      roleColor: 0xFFD700,      // Gold
      permissions: ['naib_council', 'view_analytics', 'priority_support'],
      emoji: '👑',
    },
    {
      id: 'fedaykin_elite',
      name: 'fedaykin_elite',
      displayName: 'Fedaykin Elite',
      minRank: 2,
      maxRank: 5,
      roleColor: 0x9400D3,      // Dark Violet
      permissions: ['view_analytics', 'priority_support'],
      emoji: '⚔️',
    },
    {
      id: 'fedaykin',
      name: 'fedaykin',
      displayName: 'Fedaykin',
      minRank: 6,
      maxRank: 15,
      roleColor: 0x800080,      // Purple
      permissions: ['view_analytics'],
      emoji: '🗡️',
    },
    {
      id: 'fremen',
      name: 'fremen',
      displayName: 'Fremen',
      minRank: 16,
      maxRank: 30,
      roleColor: 0x1E90FF,      // Dodger Blue
      permissions: [],
      emoji: '🏜️',
    },
    {
      id: 'wanderer',
      name: 'wanderer',
      displayName: 'Wanderer',
      minRank: 31,
      maxRank: 50,
      roleColor: 0x32CD32,      // Lime Green
      permissions: [],
      emoji: '🚶',
    },
    {
      id: 'initiate',
      name: 'initiate',
      displayName: 'Initiate',
      minRank: 51,
      maxRank: 75,
      roleColor: 0xFFFF00,      // Yellow
      permissions: [],
      emoji: '📚',
    },
    {
      id: 'aspirant',
      name: 'aspirant',
      displayName: 'Aspirant',
      minRank: 76,
      maxRank: 100,
      roleColor: 0xFFA500,      // Orange
      permissions: [],
      emoji: '🌱',
    },
    {
      id: 'observer',
      name: 'observer',
      displayName: 'Observer',
      minRank: 101,
      maxRank: 200,
      roleColor: 0x808080,      // Gray
      permissions: [],
      emoji: '👁️',
    },
    {
      id: 'outsider',
      name: 'outsider',
      displayName: 'Outsider',
      minRank: 201,
      maxRank: Number.MAX_SAFE_INTEGER,
      roleColor: 0x696969,      // Dim Gray
      permissions: [],
      emoji: '🌍',
    },
  ];

  private readonly badges: BadgeConfig[] = [
    {
      id: 'first_wave',
      name: 'first_wave',
      displayName: 'First Wave',
      description: 'Among the first 50 members to join',
      emoji: '🌊',
      evaluator: 'join_order',
      parameters: { maxPosition: 50 },
      rarity: 'legendary',
    },
    {
      id: 'veteran',
      name: 'veteran',
      displayName: 'Veteran',
      description: 'Member for over 1 year',
      emoji: '🎖️',
      evaluator: 'tenure',
      parameters: { minDays: 365 },
      rarity: 'rare',
    },
    {
      id: 'diamond_hands',
      name: 'diamond_hands',
      displayName: 'Diamond Hands',
      description: 'Never dropped below starting balance',
      emoji: '💎',
      evaluator: 'balance_stability',
      parameters: { minRetention: 1.0 },
      rarity: 'epic',
    },
    {
      id: 'council',
      name: 'council',
      displayName: 'Council Member',
      description: 'Reached Naib tier',
      emoji: '🏛️',
      evaluator: 'tier_reached',
      parameters: { tierId: 'naib' },
      rarity: 'legendary',
    },
    {
      id: 'survivor',
      name: 'survivor',
      displayName: 'Survivor',
      description: 'Survived 3+ market downturns',
      emoji: '🛡️',
      evaluator: 'market_survival',
      parameters: { minEvents: 3 },
      rarity: 'epic',
    },
    {
      id: 'streak_master',
      name: 'streak_master',
      displayName: 'Streak Master',
      description: '30-day activity streak',
      emoji: '🔥',
      evaluator: 'activity_streak',
      parameters: { minStreak: 30 },
      rarity: 'rare',
    },
    {
      id: 'engaged',
      name: 'engaged',
      displayName: 'Engaged',
      description: 'Participated in 10+ community events',
      emoji: '🎯',
      evaluator: 'event_participation',
      parameters: { minEvents: 10 },
      rarity: 'uncommon',
    },
    {
      id: 'contributor',
      name: 'contributor',
      displayName: 'Contributor',
      description: 'Recognized community contributor',
      emoji: '🤝',
      evaluator: 'manual_grant',
      parameters: {},
      rarity: 'epic',
    },
    {
      id: 'pillar',
      name: 'pillar',
      displayName: 'Pillar',
      description: 'Top 10 holder for 90+ days',
      emoji: '🏆',
      evaluator: 'rank_tenure',
      parameters: { maxRank: 10, minDays: 90 },
      rarity: 'legendary',
    },
    {
      id: 'water_sharer',
      name: 'water_sharer',
      displayName: 'Water Sharer',
      description: 'Referred 5+ new verified members',
      emoji: '💧',
      evaluator: 'referrals',
      parameters: { minReferrals: 5 },
      rarity: 'rare',
    },
  ];

  private readonly naming: NamingConfig = {
    tierPrefix: '',
    tierSuffix: '',
    communityNoun: 'Sietch',
    leaderboardTitle: 'Conviction Rankings',
    scoreLabel: 'Conviction',
  };

  // ... implementation similar to BasicTheme but with Dune-specific logic
}
```

#### 6.2.5 Theme Registry

```typescript
// packages/adapters/themes/registry.ts

export class ThemeRegistry {
  private themes: Map<string, IThemeProvider> = new Map();
  private cache: MultiLayerCache;
  private log: Logger;

  constructor(cache: MultiLayerCache, logger: Logger) {
    this.cache = cache;
    this.log = logger.child({ component: 'ThemeRegistry' });

    // Register built-in themes
    this.registerTheme(new BasicTheme());
    this.registerTheme(new SietchTheme());
  }

  registerTheme(theme: IThemeProvider): void {
    const validation = this.validateTheme(theme);
    if (!validation.valid) {
      throw new Error(`Invalid theme ${theme.id}: ${validation.errors.join(', ')}`);
    }

    this.themes.set(theme.id, theme);
    this.log.info({ themeId: theme.id }, 'Theme registered');
  }

  get(themeId: string): IThemeProvider {
    const theme = this.themes.get(themeId);
    if (!theme) {
      this.log.warn({ themeId }, 'Theme not found, falling back to basic');
      return this.themes.get('basic')!;
    }
    return theme;
  }

  getAvailableThemes(subscriptionTier: SubscriptionTier): ThemeInfo[] {
    const tierOrder = { free: 0, pro: 1, enterprise: 2 };
    const userTierLevel = tierOrder[subscriptionTier];

    return Array.from(this.themes.values())
      .filter(t => tierOrder[t.subscriptionTier] <= userTierLevel)
      .map(t => ({
        id: t.id,
        name: t.name,
        description: t.description,
        subscriptionTier: t.subscriptionTier,
        tierCount: t.getTierConfig().length,
        badgeCount: t.getBadgeConfig().length,
      }));
  }

  validateTheme(theme: IThemeProvider): ValidationResult {
    const errors: string[] = [];

    // Validate tiers
    const tiers = theme.getTierConfig();
    if (tiers.length < 2) {
      errors.push('Theme must have at least 2 tiers');
    }

    // Validate tier rank ranges don't overlap
    const sortedTiers = [...tiers].sort((a, b) => a.minRank - b.minRank);
    for (let i = 1; i < sortedTiers.length; i++) {
      if (sortedTiers[i].minRank <= sortedTiers[i - 1].maxRank) {
        errors.push(`Tier rank overlap: ${sortedTiers[i - 1].id} and ${sortedTiers[i].id}`);
      }
    }

    // Validate badges
    const badges = theme.getBadgeConfig();
    const badgeIds = new Set<string>();
    for (const badge of badges) {
      if (badgeIds.has(badge.id)) {
        errors.push(`Duplicate badge ID: ${badge.id}`);
      }
      badgeIds.add(badge.id);
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Load custom theme from enterprise config
   */
  async loadCustomTheme(communityId: string, config: CustomThemeConfig): Promise<void> {
    const theme = new CustomTheme(communityId, config);
    const validation = this.validateTheme(theme);

    if (!validation.valid) {
      throw new Error(`Invalid custom theme: ${validation.errors.join(', ')}`);
    }

    this.themes.set(theme.id, theme);

    // Cache the custom theme config
    await this.cache.set(
      `theme:custom:${communityId}`,
      config,
      { ttl: 3600 }, // 1 hour
    );
  }
}
```

### 6.3 WizardEngine

#### 6.3.1 Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        WizardEngine                                  │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │                    Hybrid Web + Discord                         ││
│  │                                                                 ││
│  │  Discord Commands:           Web Dashboard:                     ││
│  │  • /setup (start)            • Complex config forms            ││
│  │  • /resume {session_id}      • Real-time preview               ││
│  │  • Simple confirmations      • Full rule builder               ││
│  │                              • Batch operations                 ││
│  │                                                                 ││
│  │  Flow: Discord → Web URL → Config → Discord confirmation       ││
│  └─────────────────────────────────────────────────────────────────┘│
│                                                                      │
│  ┌──────────────────────────────┐  ┌──────────────────────────────┐ │
│  │     Session Management       │  │     State Machine            │ │
│  │                              │  │                              │ │
│  │  • Redis-backed (15min TTL)  │  │  INIT → CHAIN_SELECT →       │ │
│  │  • Session ID = idempotency  │  │  ASSET_CONFIG → RULES →      │ │
│  │  • IP binding for security   │  │  ROLE_MAPPING → CHANNELS →   │ │
│  │  • Cross-device recovery     │  │  REVIEW → DEPLOY             │ │
│  └──────────────────────────────┘  └──────────────────────────────┘ │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │                    Synthesis Engine                             ││
│  │                                                                 ││
│  │  • BullMQ job queue for Discord operations                     ││
│  │  • Global token bucket (50 tokens/sec)                         ││
│  │  • Rate limiter: 5 concurrent, 10 jobs/sec                     ││
│  │  • Idempotent operations with deduplication                    ││
│  └─────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
```

#### 6.3.2 Wizard States

```typescript
// packages/core/domain/wizard.ts

export enum WizardState {
  INIT = 'INIT',                     // Welcome, community name
  CHAIN_SELECT = 'CHAIN_SELECT',     // Select blockchain(s)
  ASSET_CONFIG = 'ASSET_CONFIG',     // Enter contract address
  ELIGIBILITY_RULES = 'ELIGIBILITY_RULES', // Configure thresholds
  ROLE_MAPPING = 'ROLE_MAPPING',     // Define tier roles
  CHANNEL_STRUCTURE = 'CHANNEL_STRUCTURE', // Select template
  REVIEW = 'REVIEW',                 // Preview manifest
  DEPLOY = 'DEPLOY',                 // Execute synthesis
}

export interface WizardSession {
  id: string;                        // UUID
  communityId: string;
  guildId: string;
  userId: string;
  state: WizardState;
  data: WizardSessionData;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
  ipAddress?: string;                // For session binding
}

export interface WizardSessionData {
  // INIT
  communityName?: string;

  // CHAIN_SELECT
  chains?: ChainConfig[];

  // ASSET_CONFIG
  assets?: AssetConfig[];

  // ELIGIBILITY_RULES
  rules?: EligibilityRuleConfig[];

  // ROLE_MAPPING
  tierRoles?: TierRoleMapping[];

  // CHANNEL_STRUCTURE
  channelTemplate?: string;
  customChannels?: ChannelConfig[];

  // REVIEW
  manifest?: CommunityManifest;
  validated?: boolean;

  // DEPLOY
  deploymentStatus?: DeploymentStatus;
  synthesisJobId?: string;
}
```

#### 6.3.3 Session Store (Redis)

```typescript
// packages/adapters/wizard/session-store.ts

export class WizardSessionStore {
  private readonly redis: Redis;
  private readonly ttlSeconds = 15 * 60; // 15 minutes
  private readonly log: Logger;

  constructor(redis: Redis, logger: Logger) {
    this.redis = redis;
    this.log = logger.child({ component: 'WizardSessionStore' });
  }

  async create(session: Omit<WizardSession, 'id' | 'createdAt' | 'updatedAt' | 'expiresAt'>): Promise<WizardSession> {
    const id = crypto.randomUUID();
    const now = new Date();

    const fullSession: WizardSession = {
      ...session,
      id,
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(now.getTime() + this.ttlSeconds * 1000),
    };

    await this.redis.setex(
      `wizard:session:${id}`,
      this.ttlSeconds,
      JSON.stringify(fullSession),
    );

    // Index by guild for lookup
    await this.redis.setex(
      `wizard:guild:${session.guildId}`,
      this.ttlSeconds,
      id,
    );

    this.log.info({ sessionId: id, guildId: session.guildId }, 'Wizard session created');

    return fullSession;
  }

  async get(sessionId: string): Promise<WizardSession | null> {
    const data = await this.redis.get(`wizard:session:${sessionId}`);
    if (!data) return null;

    return JSON.parse(data);
  }

  async getByGuild(guildId: string): Promise<WizardSession | null> {
    const sessionId = await this.redis.get(`wizard:guild:${guildId}`);
    if (!sessionId) return null;

    return this.get(sessionId);
  }

  async update(sessionId: string, updates: Partial<WizardSession>): Promise<WizardSession | null> {
    const session = await this.get(sessionId);
    if (!session) return null;

    const updatedSession: WizardSession = {
      ...session,
      ...updates,
      updatedAt: new Date(),
    };

    await this.redis.setex(
      `wizard:session:${sessionId}`,
      this.ttlSeconds,
      JSON.stringify(updatedSession),
    );

    return updatedSession;
  }

  async transition(
    sessionId: string,
    newState: WizardState,
    data: Partial<WizardSessionData>,
  ): Promise<WizardSession | null> {
    const session = await this.get(sessionId);
    if (!session) return null;

    // Validate state transition
    if (!this.isValidTransition(session.state, newState)) {
      throw new Error(`Invalid state transition: ${session.state} → ${newState}`);
    }

    return this.update(sessionId, {
      state: newState,
      data: { ...session.data, ...data },
    });
  }

  private isValidTransition(from: WizardState, to: WizardState): boolean {
    const transitions: Record<WizardState, WizardState[]> = {
      [WizardState.INIT]: [WizardState.CHAIN_SELECT],
      [WizardState.CHAIN_SELECT]: [WizardState.ASSET_CONFIG, WizardState.INIT],
      [WizardState.ASSET_CONFIG]: [WizardState.ELIGIBILITY_RULES, WizardState.CHAIN_SELECT],
      [WizardState.ELIGIBILITY_RULES]: [WizardState.ROLE_MAPPING, WizardState.ASSET_CONFIG],
      [WizardState.ROLE_MAPPING]: [WizardState.CHANNEL_STRUCTURE, WizardState.ELIGIBILITY_RULES],
      [WizardState.CHANNEL_STRUCTURE]: [WizardState.REVIEW, WizardState.ROLE_MAPPING],
      [WizardState.REVIEW]: [WizardState.DEPLOY, WizardState.CHANNEL_STRUCTURE],
      [WizardState.DEPLOY]: [], // Terminal state
    };

    return transitions[from]?.includes(to) ?? false;
  }

  async validateSession(sessionId: string, ipAddress: string): Promise<boolean> {
    const session = await this.get(sessionId);
    if (!session) return false;

    // IP binding check (if configured)
    if (session.ipAddress && session.ipAddress !== ipAddress) {
      this.log.warn({ sessionId, expected: session.ipAddress, actual: ipAddress }, 'IP mismatch');
      return false;
    }

    return true;
  }
}
```

#### 6.3.4 Synthesis Engine (BullMQ)

```typescript
// packages/adapters/synthesis/engine.ts

import { Queue, Worker, Job } from 'bullmq';

export interface SynthesisJob {
  type: 'create_role' | 'delete_role' | 'assign_role' | 'remove_role' |
        'create_channel' | 'delete_channel' | 'update_permissions';
  guildId: string;
  communityId: string;
  payload: SynthesisPayload;
  idempotencyKey: string;
}

export class SynthesisEngine {
  private readonly queue: Queue;
  private readonly worker: Worker;
  private readonly tokenBucket: GlobalTokenBucket;
  private readonly discordRest: DiscordRestService;
  private readonly log: Logger;

  constructor(
    redis: Redis,
    tokenBucket: GlobalTokenBucket,
    discordRest: DiscordRestService,
    logger: Logger,
  ) {
    this.tokenBucket = tokenBucket;
    this.discordRest = discordRest;
    this.log = logger.child({ component: 'SynthesisEngine' });

    // BullMQ queue with rate limiting
    this.queue = new Queue('discord-synthesis', {
      connection: redis,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
        removeOnComplete: { age: 3600 },
        removeOnFail: { age: 86400 },
      },
    });

    // Worker with concurrency limits
    this.worker = new Worker(
      'discord-synthesis',
      async (job: Job<SynthesisJob>) => this.processJob(job),
      {
        connection: redis,
        concurrency: 5,              // Max 5 concurrent Discord ops
        limiter: {
          max: 10,                   // 10 jobs
          duration: 1000,            // per second
        },
      },
    );

    this.worker.on('completed', (job) => {
      this.log.info({ jobId: job.id, type: job.data.type }, 'Synthesis job completed');
    });

    this.worker.on('failed', (job, error) => {
      this.log.error({ jobId: job?.id, error }, 'Synthesis job failed');
    });
  }

  async processJob(job: Job<SynthesisJob>): Promise<void> {
    const { type, guildId, payload, idempotencyKey } = job.data;

    // Acquire token from global bucket
    await this.tokenBucket.acquireWithWait();

    // Check idempotency
    const alreadyProcessed = await this.checkIdempotency(idempotencyKey);
    if (alreadyProcessed) {
      this.log.info({ idempotencyKey }, 'Job already processed, skipping');
      return;
    }

    try {
      switch (type) {
        case 'create_role':
          await this.discordRest.createRole(guildId, payload as CreateRolePayload);
          break;
        case 'assign_role':
          await this.discordRest.assignRole(
            guildId,
            (payload as AssignRolePayload).userId,
            (payload as AssignRolePayload).roleId,
          );
          break;
        case 'create_channel':
          await this.discordRest.createChannel(guildId, payload as CreateChannelPayload);
          break;
        // ... other operations
      }

      // Mark as processed
      await this.markProcessed(idempotencyKey);
    } catch (error) {
      if (this.isRateLimitError(error)) {
        // Re-queue with delay
        throw error; // BullMQ will retry
      }
      throw error;
    }
  }

  async enqueueSynthesis(
    communityId: string,
    guildId: string,
    manifest: CommunityManifest,
  ): Promise<string> {
    const jobs: SynthesisJob[] = [];

    // Generate jobs for roles
    for (const tier of manifest.tiers) {
      jobs.push({
        type: 'create_role',
        guildId,
        communityId,
        payload: {
          name: tier.roleName,
          color: tier.roleColor,
          permissions: tier.permissions,
        },
        idempotencyKey: `role:${communityId}:${tier.id}`,
      });
    }

    // Generate jobs for channels
    for (const channel of manifest.channels) {
      jobs.push({
        type: 'create_channel',
        guildId,
        communityId,
        payload: {
          name: channel.name,
          type: channel.type,
          permissions: channel.permissions,
        },
        idempotencyKey: `channel:${communityId}:${channel.id}`,
      });
    }

    // Add all jobs to queue
    const bulkJobs = jobs.map((job, index) => ({
      name: `synthesis-${communityId}-${index}`,
      data: job,
      opts: {
        priority: index,
        delay: index * 100, // Stagger by 100ms
      },
    }));

    await this.queue.addBulk(bulkJobs);

    return communityId;
  }

  private isRateLimitError(error: unknown): boolean {
    return (error as Error)?.message?.includes('429');
  }

  private async checkIdempotency(key: string): Promise<boolean> {
    const exists = await this.redis.exists(`synthesis:idempotency:${key}`);
    return exists === 1;
  }

  private async markProcessed(key: string): Promise<void> {
    await this.redis.setex(`synthesis:idempotency:${key}`, 86400, '1'); // 24h
  }
}
```

#### 6.3.5 Global Token Bucket

```typescript
// packages/adapters/synthesis/token-bucket.ts

export class GlobalTokenBucket {
  private readonly redis: Redis;
  private readonly key = 'synthesis:token_bucket';
  private readonly maxTokens = 50;
  private readonly refillRate = 50;  // tokens per second
  private readonly metrics: PrometheusClient;
  private readonly log: Logger;

  constructor(redis: Redis, metrics: PrometheusClient, logger: Logger) {
    this.redis = redis;
    this.metrics = metrics;
    this.log = logger.child({ component: 'GlobalTokenBucket' });
  }

  /**
   * Acquire a token, blocking until available
   */
  async acquireWithWait(maxWaitMs: number = 5000): Promise<void> {
    const start = Date.now();

    while (Date.now() - start < maxWaitMs) {
      const acquired = await this.tryAcquire();
      if (acquired) {
        return;
      }

      // Wait and retry
      await this.sleep(100);
    }

    this.metrics.tokenBucketExhausted.inc();
    throw new Error('Token bucket exhausted, max wait exceeded');
  }

  /**
   * Try to acquire a token, return false if unavailable
   */
  async tryAcquire(): Promise<boolean> {
    const script = `
      local key = KEYS[1]
      local maxTokens = tonumber(ARGV[1])
      local refillRate = tonumber(ARGV[2])
      local now = tonumber(ARGV[3])

      local bucket = redis.call('HMGET', key, 'tokens', 'lastRefill')
      local tokens = tonumber(bucket[1]) or maxTokens
      local lastRefill = tonumber(bucket[2]) or now

      -- Refill tokens
      local elapsed = (now - lastRefill) / 1000
      local tokensToAdd = elapsed * refillRate
      tokens = math.min(maxTokens, tokens + tokensToAdd)

      if tokens >= 1 then
        -- Consume token
        tokens = tokens - 1
        redis.call('HMSET', key, 'tokens', tokens, 'lastRefill', now)
        return 1
      else
        redis.call('HSET', key, 'lastRefill', now)
        return 0
      end
    `;

    const result = await this.redis.eval(
      script,
      1,
      this.key,
      this.maxTokens.toString(),
      this.refillRate.toString(),
      Date.now().toString(),
    );

    const acquired = result === 1;

    if (!acquired) {
      this.metrics.tokenBucketWaits.inc();
    }

    return acquired;
  }

  async getStatus(): Promise<{ tokens: number; maxTokens: number }> {
    const bucket = await this.redis.hgetall(this.key);
    return {
      tokens: parseFloat(bucket.tokens ?? this.maxTokens.toString()),
      maxTokens: this.maxTokens,
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

### 6.4 Vault Transit Integration

#### 6.4.1 Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                      Vault Transit Integration                       │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │                     HashiCorp Vault (HA)                        ││
│  │                                                                 ││
│  │  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐       ││
│  │  │  Transit      │  │   KV v2       │  │   PKI         │       ││
│  │  │  Engine       │  │   Engine      │  │   Engine      │       ││
│  │  │               │  │               │  │               │       ││
│  │  │  • sign       │  │  • api_keys   │  │  • tls_certs  │       ││
│  │  │  • verify     │  │  • oauth      │  │               │       ││
│  │  │  • encrypt    │  │  • secrets    │  │               │       ││
│  │  │  • decrypt    │  │               │  │               │       ││
│  │  └───────────────┘  └───────────────┘  └───────────────┘       ││
│  └─────────────────────────────────────────────────────────────────┘│
│                                                                      │
│  Use Cases:                                                          │
│  1. Discord OAuth token encryption/decryption                        │
│  2. Wallet verification challenge signing                            │
│  3. Service-to-service API request signing                           │
│  4. Sensitive config encryption at rest                              │
│                                                                      │
│  Kill Switch: MFA-protected endpoint to revoke all signing perms     │
└─────────────────────────────────────────────────────────────────────┘
```

#### 6.4.2 Vault Client

```typescript
// packages/adapters/security/vault-client.ts

import Vault from 'node-vault';

export interface VaultConfig {
  endpoint: string;
  token?: string;             // For dev, use roleId/secretId in prod
  roleId?: string;
  secretId?: string;
  namespace?: string;
}

export class VaultClient {
  private client: Vault.client;
  private readonly transitPath = 'transit';
  private readonly kvPath = 'secret';
  private readonly log: Logger;
  private readonly metrics: PrometheusClient;

  constructor(config: VaultConfig, logger: Logger, metrics: PrometheusClient) {
    this.log = logger.child({ component: 'VaultClient' });
    this.metrics = metrics;

    this.client = Vault({
      endpoint: config.endpoint,
      token: config.token,
      namespace: config.namespace,
    });

    // AppRole auth for production
    if (config.roleId && config.secretId) {
      this.authenticateAppRole(config.roleId, config.secretId);
    }
  }

  private async authenticateAppRole(roleId: string, secretId: string): Promise<void> {
    const result = await this.client.approleLogin({
      role_id: roleId,
      secret_id: secretId,
    });
    this.client.token = result.auth.client_token;
    this.log.info('Authenticated with Vault via AppRole');
  }

  /**
   * Sign data using Transit engine (HSM-backed)
   */
  async sign(keyName: string, data: string): Promise<string> {
    const start = Date.now();

    try {
      const input = Buffer.from(data).toString('base64');

      const result = await this.client.write(
        `${this.transitPath}/sign/${keyName}`,
        { input },
      );

      this.metrics.vaultOperations.inc({ operation: 'sign', status: 'success' });
      this.metrics.vaultLatency.observe(
        { operation: 'sign' },
        (Date.now() - start) / 1000,
      );

      return result.data.signature;
    } catch (error) {
      this.metrics.vaultOperations.inc({ operation: 'sign', status: 'error' });
      this.log.error({ error, keyName }, 'Vault sign failed');
      throw error;
    }
  }

  /**
   * Verify signature using Transit engine
   */
  async verify(keyName: string, data: string, signature: string): Promise<boolean> {
    const start = Date.now();

    try {
      const input = Buffer.from(data).toString('base64');

      const result = await this.client.write(
        `${this.transitPath}/verify/${keyName}`,
        { input, signature },
      );

      this.metrics.vaultOperations.inc({ operation: 'verify', status: 'success' });
      this.metrics.vaultLatency.observe(
        { operation: 'verify' },
        (Date.now() - start) / 1000,
      );

      return result.data.valid;
    } catch (error) {
      this.metrics.vaultOperations.inc({ operation: 'verify', status: 'error' });
      this.log.error({ error, keyName }, 'Vault verify failed');
      throw error;
    }
  }

  /**
   * Encrypt sensitive data using Transit engine
   */
  async encrypt(keyName: string, plaintext: string): Promise<string> {
    const start = Date.now();

    try {
      const plaintextBase64 = Buffer.from(plaintext).toString('base64');

      const result = await this.client.write(
        `${this.transitPath}/encrypt/${keyName}`,
        { plaintext: plaintextBase64 },
      );

      this.metrics.vaultOperations.inc({ operation: 'encrypt', status: 'success' });
      this.metrics.vaultLatency.observe(
        { operation: 'encrypt' },
        (Date.now() - start) / 1000,
      );

      return result.data.ciphertext;
    } catch (error) {
      this.metrics.vaultOperations.inc({ operation: 'encrypt', status: 'error' });
      this.log.error({ error, keyName }, 'Vault encrypt failed');
      throw error;
    }
  }

  /**
   * Decrypt sensitive data using Transit engine
   */
  async decrypt(keyName: string, ciphertext: string): Promise<string> {
    const start = Date.now();

    try {
      const result = await this.client.write(
        `${this.transitPath}/decrypt/${keyName}`,
        { ciphertext },
      );

      const plaintext = Buffer.from(result.data.plaintext, 'base64').toString('utf8');

      this.metrics.vaultOperations.inc({ operation: 'decrypt', status: 'success' });
      this.metrics.vaultLatency.observe(
        { operation: 'decrypt' },
        (Date.now() - start) / 1000,
      );

      return plaintext;
    } catch (error) {
      this.metrics.vaultOperations.inc({ operation: 'decrypt', status: 'error' });
      this.log.error({ error, keyName }, 'Vault decrypt failed');
      throw error;
    }
  }

  /**
   * Get secret from KV v2
   */
  async getSecret(path: string): Promise<Record<string, string>> {
    const result = await this.client.read(`${this.kvPath}/data/${path}`);
    return result.data.data;
  }

  /**
   * Store secret in KV v2
   */
  async putSecret(path: string, data: Record<string, string>): Promise<void> {
    await this.client.write(`${this.kvPath}/data/${path}`, { data });
  }

  /**
   * Rotate encryption key
   */
  async rotateKey(keyName: string): Promise<void> {
    await this.client.write(`${this.transitPath}/keys/${keyName}/rotate`, {});
    this.log.info({ keyName }, 'Transit key rotated');
  }

  /**
   * Health check
   */
  async health(): Promise<{ sealed: boolean; initialized: boolean }> {
    const result = await this.client.health();
    return {
      sealed: result.sealed,
      initialized: result.initialized,
    };
  }
}
```

#### 6.4.3 Kill Switch Implementation

```typescript
// packages/adapters/security/kill-switch.ts

export class KillSwitch {
  private readonly vault: VaultClient;
  private readonly redis: Redis;
  private readonly nats: NatsClient;
  private readonly log: Logger;

  // Kill switch state key
  private readonly stateKey = 'arrakis:killswitch:active';

  constructor(
    vault: VaultClient,
    redis: Redis,
    nats: NatsClient,
    logger: Logger,
  ) {
    this.vault = vault;
    this.redis = redis;
    this.nats = nats;
    this.log = logger.child({ component: 'KillSwitch' });
  }

  /**
   * Activate kill switch (requires MFA verification)
   */
  async activate(
    adminId: string,
    mfaToken: string,
    reason: string,
  ): Promise<void> {
    // Verify MFA
    const mfaValid = await this.verifyMFA(adminId, mfaToken);
    if (!mfaValid) {
      throw new Error('Invalid MFA token');
    }

    this.log.warn({ adminId, reason }, 'KILL SWITCH ACTIVATED');

    // Set kill switch state
    await this.redis.set(this.stateKey, JSON.stringify({
      activatedBy: adminId,
      activatedAt: new Date().toISOString(),
      reason,
    }));

    // Broadcast kill switch to all workers
    await this.nats.publish('internal.killswitch', {
      action: 'ACTIVATE',
      adminId,
      reason,
      timestamp: Date.now(),
    });

    // Revoke Vault tokens (emergency)
    // Note: This would need elevated permissions
    await this.revokeAgentPermissions();

    // Pause all synthesis jobs
    await this.pauseSynthesis();

    // Send admin notification
    await this.notifyAdmins('KILL_SWITCH_ACTIVATED', { adminId, reason });
  }

  /**
   * Deactivate kill switch (requires MFA verification)
   */
  async deactivate(
    adminId: string,
    mfaToken: string,
  ): Promise<void> {
    const mfaValid = await this.verifyMFA(adminId, mfaToken);
    if (!mfaValid) {
      throw new Error('Invalid MFA token');
    }

    this.log.info({ adminId }, 'Kill switch deactivated');

    await this.redis.del(this.stateKey);

    await this.nats.publish('internal.killswitch', {
      action: 'DEACTIVATE',
      adminId,
      timestamp: Date.now(),
    });

    await this.resumeSynthesis();
    await this.notifyAdmins('KILL_SWITCH_DEACTIVATED', { adminId });
  }

  /**
   * Check if kill switch is active
   */
  async isActive(): Promise<boolean> {
    const state = await this.redis.get(this.stateKey);
    return state !== null;
  }

  private async verifyMFA(adminId: string, token: string): Promise<boolean> {
    // Implement TOTP verification via Vault or external provider
    // This is a placeholder
    return true;
  }

  private async revokeAgentPermissions(): Promise<void> {
    // Revoke Vault token permissions for synthesis operations
    this.log.warn('Revoking agent signing permissions');
  }

  private async pauseSynthesis(): Promise<void> {
    await this.redis.set('synthesis:paused', '1');
    this.log.warn('Synthesis operations paused');
  }

  private async resumeSynthesis(): Promise<void> {
    await this.redis.del('synthesis:paused');
    this.log.info('Synthesis operations resumed');
  }

  private async notifyAdmins(event: string, data: Record<string, unknown>): Promise<void> {
    // Send Discord DM, Slack, PagerDuty, etc.
    this.log.info({ event, data }, 'Admin notification sent');
  }
}
```

---

## 7. Part III: Coexistence Components

### 7.1 Shadow Mode Architecture

#### 7.1.1 Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Shadow Mode                                  │
│                                                                      │
│  Purpose: Prove Arrakis accuracy WITHOUT touching incumbent roles    │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │                 Incumbent Detection                              ││
│  │                                                                  ││
│  │  Auto-detect: Collab.Land, Matrica, Guild.xyz                   ││
│  │  By: Bot ID patterns, channel names, role patterns              ││
│  │  Output: Confidence score (0-1)                                  ││
│  └─────────────────────────────────────────────────────────────────┘│
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │                 Shadow Ledger (ScyllaDB)                        ││
│  │                                                                  ││
│  │  shadow_member_state:                                           ││
│  │    • guild_id, user_id                                          ││
│  │    • incumbent_roles (snapshot)                                 ││
│  │    • arrakis_eligibility (calculated)                           ││
│  │    • conviction_score                                           ││
│  │    • divergence_flag                                            ││
│  │                                                                  ││
│  │  shadow_divergences:                                            ││
│  │    • guild_id, user_id, timestamp                               ││
│  │    • incumbent_state, arrakis_state                             ││
│  │    • divergence_type (false_positive, false_negative)           ││
│  │                                                                  ││
│  │  shadow_predictions:                                            ││
│  │    • prediction_id, guild_id, user_id                           ││
│  │    • predicted_at, verified_at                                   ││
│  │    • prediction, actual, correct                                 ││
│  └─────────────────────────────────────────────────────────────────┘│
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │                 Shadow Sync Job (6h interval)                   ││
│  │                                                                  ││
│  │  1. Snapshot current Discord role state                         ││
│  │  2. Calculate Arrakis eligibility for verified wallets          ││
│  │  3. Compare & record divergences                                ││
│  │  4. Validate previous predictions                               ││
│  │  5. Generate accuracy report                                    ││
│  │                                                                  ││
│  │  CRITICAL: Zero Discord mutations in shadow mode                ││
│  └─────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
```

#### 7.1.2 Incumbent Detection

```typescript
// packages/adapters/coexistence/incumbent-detector.ts

export interface IncumbentInfo {
  type: 'collabland' | 'matrica' | 'guild_xyz' | 'other' | 'none';
  confidence: number;
  evidence: Evidence[];
}

export interface Evidence {
  type: 'bot_id' | 'channel_name' | 'role_name' | 'role_membership';
  value: string;
  confidence: number;
}

const KNOWN_BOTS = {
  collabland: ['703886990948565003', '704521096837464076'],
  matrica: ['879673158287544361'],
  guild_xyz: ['868172385000509460'],
};

const CHANNEL_PATTERNS = {
  collabland: /collabland-join|collab-land|cl-verify/i,
  matrica: /matrica-verify|matrica-join/i,
  guild_xyz: /guild-verify|guild-join/i,
};

const ROLE_PATTERNS = {
  collabland: /collab|holder|verified/i,
  matrica: /matrica|verified/i,
  guild_xyz: /guild|member/i,
};

export class IncumbentDetector {
  private readonly discordRest: DiscordRestService;
  private readonly log: Logger;

  constructor(discordRest: DiscordRestService, logger: Logger) {
    this.discordRest = discordRest;
    this.log = logger.child({ component: 'IncumbentDetector' });
  }

  async detect(guildId: string): Promise<IncumbentInfo> {
    const evidence: Evidence[] = [];

    // Check for known bot IDs
    const members = await this.discordRest.getGuildMembers(guildId, { limit: 1000 });
    const botMembers = members.filter(m => m.user.bot);

    for (const [incumbentType, botIds] of Object.entries(KNOWN_BOTS)) {
      for (const bot of botMembers) {
        if (botIds.includes(bot.user.id)) {
          evidence.push({
            type: 'bot_id',
            value: `${incumbentType}:${bot.user.id}`,
            confidence: 0.95,
          });
        }
      }
    }

    // Check for verification channels
    const channels = await this.discordRest.getGuildChannels(guildId);
    for (const channel of channels) {
      for (const [incumbentType, pattern] of Object.entries(CHANNEL_PATTERNS)) {
        if (pattern.test(channel.name)) {
          evidence.push({
            type: 'channel_name',
            value: `${incumbentType}:${channel.name}`,
            confidence: 0.7,
          });
        }
      }
    }

    // Check for token-gated role patterns
    const roles = await this.discordRest.getGuildRoles(guildId);
    for (const role of roles) {
      for (const [incumbentType, pattern] of Object.entries(ROLE_PATTERNS)) {
        if (pattern.test(role.name)) {
          evidence.push({
            type: 'role_name',
            value: `${incumbentType}:${role.name}`,
            confidence: 0.5,
          });
        }
      }
    }

    // Calculate overall confidence and type
    const typeScores = this.aggregateEvidence(evidence);
    const topType = this.findTopType(typeScores);

    this.log.info({ guildId, topType, evidenceCount: evidence.length }, 'Incumbent detection complete');

    return {
      type: topType.type,
      confidence: topType.confidence,
      evidence,
    };
  }

  private aggregateEvidence(evidence: Evidence[]): Map<string, number> {
    const scores = new Map<string, number>();

    for (const e of evidence) {
      const type = e.value.split(':')[0];
      const current = scores.get(type) ?? 0;
      scores.set(type, current + e.confidence);
    }

    return scores;
  }

  private findTopType(scores: Map<string, number>): { type: IncumbentInfo['type']; confidence: number } {
    let topType: IncumbentInfo['type'] = 'none';
    let topScore = 0;

    for (const [type, score] of scores.entries()) {
      if (score > topScore) {
        topType = type as IncumbentInfo['type'];
        topScore = score;
      }
    }

    // Normalize confidence to 0-1
    const confidence = Math.min(topScore / 3, 1); // 3 strong evidences = 100%

    return { type: topType, confidence };
  }
}
```

#### 7.1.3 Shadow Ledger Schema (ScyllaDB)

```cql
-- Shadow mode tables in ScyllaDB

-- Current shadow state per member
CREATE TABLE arrakis.shadow_member_state (
    guild_id TEXT,
    user_id TEXT,
    incumbent_roles SET<TEXT>,      -- Snapshot of current roles
    arrakis_eligible BOOLEAN,       -- Would Arrakis grant access?
    arrakis_tier TEXT,              -- What tier would Arrakis assign?
    conviction_score DECIMAL,
    divergence_flag BOOLEAN,        -- Does incumbent != Arrakis?
    last_sync_at TIMESTAMP,
    PRIMARY KEY ((guild_id), user_id)
);

-- Divergence tracking
CREATE TABLE arrakis.shadow_divergences (
    guild_id TEXT,
    user_id TEXT,
    detected_at TIMESTAMP,
    incumbent_state TEXT,           -- JSON: roles, permissions
    arrakis_state TEXT,             -- JSON: tier, badges
    divergence_type TEXT,           -- 'false_positive' | 'false_negative'
    resolved BOOLEAN,
    resolved_at TIMESTAMP,
    PRIMARY KEY ((guild_id, user_id), detected_at)
) WITH CLUSTERING ORDER BY (detected_at DESC)
  AND default_time_to_live = 7776000; -- 90 days

-- Prediction tracking for accuracy validation
CREATE TABLE arrakis.shadow_predictions (
    prediction_id UUID,
    guild_id TEXT,
    user_id TEXT,
    predicted_at TIMESTAMP,
    prediction_type TEXT,           -- 'role_grant' | 'role_revoke' | 'tier_change'
    predicted_value TEXT,
    verified_at TIMESTAMP,
    actual_value TEXT,
    correct BOOLEAN,
    PRIMARY KEY ((guild_id), prediction_id)
) WITH default_time_to_live = 7776000; -- 90 days
```

#### 7.1.4 Shadow Sync Job

```typescript
// packages/adapters/coexistence/shadow-sync.ts

export class ShadowSyncJob {
  private readonly discordRest: DiscordRestService;
  private readonly twoTierProvider: TwoTierChainProvider;
  private readonly scylla: ScyllaClient;
  private readonly nats: NatsClient;
  private readonly log: Logger;
  private readonly metrics: PrometheusClient;

  constructor(
    discordRest: DiscordRestService,
    twoTierProvider: TwoTierChainProvider,
    scylla: ScyllaClient,
    nats: NatsClient,
    logger: Logger,
    metrics: PrometheusClient,
  ) {
    this.discordRest = discordRest;
    this.twoTierProvider = twoTierProvider;
    this.scylla = scylla;
    this.nats = nats;
    this.log = logger.child({ component: 'ShadowSyncJob' });
    this.metrics = metrics;
  }

  /**
   * Run shadow sync for a community
   * CRITICAL: This job MUST NOT mutate any Discord state
   */
  async sync(communityId: string, guildId: string): Promise<ShadowSyncResult> {
    const startTime = Date.now();
    this.log.info({ communityId, guildId }, 'Starting shadow sync');

    const result: ShadowSyncResult = {
      communityId,
      guildId,
      syncedAt: new Date(),
      membersProcessed: 0,
      divergencesFound: 0,
      predictionsValidated: 0,
      accuracy: 0,
    };

    try {
      // Step 1: Snapshot current Discord state (READ ONLY)
      const members = await this.fetchAllMembers(guildId);

      // Step 2: Get community eligibility rules
      const rules = await this.getEligibilityRules(communityId);

      // Step 3: Get incumbent role mappings
      const incumbentRoles = await this.getIncumbentRoleIds(communityId, guildId);

      // Step 4: Process each member with verified wallet
      for (const member of members) {
        const walletAddress = await this.getVerifiedWallet(communityId, member.user.id);
        if (!walletAddress) continue;

        result.membersProcessed++;

        // Calculate Arrakis eligibility
        const arrakisResult = await this.calculateEligibility(rules, walletAddress);

        // Snapshot incumbent state
        const incumbentState = {
          hasRole: member.roles.some(r => incumbentRoles.includes(r)),
          roles: member.roles,
        };

        // Compare and record
        const divergent = incumbentState.hasRole !== arrakisResult.eligible;

        await this.scylla.execute(
          `INSERT INTO shadow_member_state
           (guild_id, user_id, incumbent_roles, arrakis_eligible, arrakis_tier,
            conviction_score, divergence_flag, last_sync_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, toTimestamp(now()))`,
          [
            guildId,
            member.user.id,
            new Set(member.roles),
            arrakisResult.eligible,
            arrakisResult.details.tierMatched,
            arrakisResult.details.score,
            divergent,
          ],
          { prepare: true },
        );

        if (divergent) {
          result.divergencesFound++;
          await this.recordDivergence(guildId, member.user.id, incumbentState, arrakisResult);
        }
      }

      // Step 5: Validate previous predictions
      result.predictionsValidated = await this.validatePredictions(guildId);
      result.accuracy = await this.calculateAccuracy(guildId);

      // Step 6: Publish sync complete event
      await this.nats.publish('coexist.shadow.sync.complete', {
        communityId,
        guildId,
        result,
      });

      this.metrics.shadowSyncDuration.observe(
        { community_id: communityId },
        (Date.now() - startTime) / 1000,
      );
      this.metrics.shadowSyncAccuracy.set({ community_id: communityId }, result.accuracy);

      this.log.info({ communityId, guildId, result }, 'Shadow sync completed');

      return result;
    } catch (error) {
      this.log.error({ error, communityId, guildId }, 'Shadow sync failed');
      throw error;
    }
  }

  private async fetchAllMembers(guildId: string): Promise<GuildMember[]> {
    // Use cursor-based pagination to avoid OOM
    const members: GuildMember[] = [];
    let after: string | undefined;

    do {
      const batch = await this.discordRest.getGuildMembers(guildId, {
        limit: 1000,
        after,
      });

      members.push(...batch);
      after = batch.length > 0 ? batch[batch.length - 1].user.id : undefined;

    } while (after);

    return members;
  }

  private async recordDivergence(
    guildId: string,
    userId: string,
    incumbentState: IncumbentState,
    arrakisResult: EligibilityResult,
  ): Promise<void> {
    const divergenceType = incumbentState.hasRole && !arrakisResult.eligible
      ? 'false_positive'  // Incumbent grants access, Arrakis wouldn't
      : 'false_negative'; // Incumbent denies access, Arrakis would grant

    await this.scylla.execute(
      `INSERT INTO shadow_divergences
       (guild_id, user_id, detected_at, incumbent_state, arrakis_state,
        divergence_type, resolved)
       VALUES (?, ?, toTimestamp(now()), ?, ?, ?, false)`,
      [
        guildId,
        userId,
        JSON.stringify(incumbentState),
        JSON.stringify(arrakisResult),
        divergenceType,
      ],
      { prepare: true },
    );
  }

  private async validatePredictions(guildId: string): Promise<number> {
    // Fetch unverified predictions and compare with current state
    // Implementation details omitted for brevity
    return 0;
  }

  private async calculateAccuracy(guildId: string): Promise<number> {
    const result = await this.scylla.execute(
      `SELECT correct, COUNT(*) as count FROM shadow_predictions
       WHERE guild_id = ? AND verified_at IS NOT NULL
       GROUP BY correct ALLOW FILTERING`,
      [guildId],
      { prepare: true },
    );

    let correct = 0;
    let total = 0;

    for (const row of result.rows) {
      if (row.correct) {
        correct = row.count;
      }
      total += row.count;
    }

    return total > 0 ? correct / total : 1.0;
  }
}
```

### 7.2 Parallel Mode Architecture

#### 7.2.1 Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Parallel Mode                                 │
│                                                                      │
│  Purpose: Arrakis operates ALONGSIDE incumbents with isolation       │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │              Namespaced Role Management                         ││
│  │                                                                 ││
│  │  All Arrakis roles prefixed: @arrakis-*                        ││
│  │  Positioned BELOW incumbent roles in hierarchy                  ││
│  │  No permissions granted (security)                              ││
│  │                                                                 ││
│  │  Example:                                                       ││
│  │    @collabland-holder (incumbent) → HAS permissions             ││
│  │    @arrakis-fremen (Arrakis) → NO permissions (parallel)        ││
│  └─────────────────────────────────────────────────────────────────┘│
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │              Channel Strategy                                   ││
│  │                                                                 ││
│  │  Options:                                                       ││
│  │  • none: No Arrakis channels                                   ││
│  │  • additive_only: New channels incumbents can't offer          ││
│  │    - #conviction-lounge (80+ score)                            ││
│  │    - #diamond-hands (95+ score)                                ││
│  │  • parallel_mirror: Arrakis versions of incumbent channels     ││
│  │  • custom: Admin-defined                                       ││
│  └─────────────────────────────────────────────────────────────────┘│
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │              Glimpse Mode (Social Preview)                      ││
│  │                                                                 ││
│  │  Show features exist WITHOUT full access:                       ││
│  │  • Leaderboard visible, others' scores hidden                  ││
│  │  • Profile directory shows blurred cards                       ││
│  │  • Badge showcase shows locked icons                           ││
│  │  • "Your Preview Profile" shows own stats                      ││
│  │                                                                 ││
│  │  CTA: "Full profiles unlock when your community migrates"       ││
│  └─────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
```

#### 7.2.2 Namespaced Role Manager

```typescript
// packages/adapters/coexistence/namespaced-roles.ts

export interface NamespacedRoleConfig {
  prefix: string;                    // Default: 'arrakis-'
  positionStrategy: 'below_incumbent' | 'bottom' | 'custom';
  permissionsMode: 'none' | 'view_only' | 'inherit';
}

export class NamespacedRoleManager {
  private readonly discordRest: DiscordRestService;
  private readonly synthesis: SynthesisEngine;
  private readonly log: Logger;

  private readonly defaultConfig: NamespacedRoleConfig = {
    prefix: 'arrakis-',
    positionStrategy: 'below_incumbent',
    permissionsMode: 'none',
  };

  constructor(
    discordRest: DiscordRestService,
    synthesis: SynthesisEngine,
    logger: Logger,
  ) {
    this.discordRest = discordRest;
    this.synthesis = synthesis;
    this.log = logger.child({ component: 'NamespacedRoleManager' });
  }

  /**
   * Create Arrakis role that coexists with incumbent
   */
  async createNamespacedRole(
    guildId: string,
    communityId: string,
    tierConfig: TierConfig,
    config: Partial<NamespacedRoleConfig> = {},
  ): Promise<string> {
    const fullConfig = { ...this.defaultConfig, ...config };

    const roleName = `${fullConfig.prefix}${tierConfig.name}`;

    // Get incumbent role position for placement
    const incumbentPosition = await this.findIncumbentRolePosition(guildId);

    const position = fullConfig.positionStrategy === 'below_incumbent'
      ? Math.max(incumbentPosition - 1, 1)
      : 1;

    // Create role via synthesis engine (rate-limited)
    await this.synthesis.enqueueSynthesis(communityId, guildId, {
      tiers: [{
        id: tierConfig.id,
        roleName,
        roleColor: tierConfig.roleColor,
        permissions: fullConfig.permissionsMode === 'none' ? 0n : tierConfig.permissions,
        position,
      }],
      channels: [],
    });

    this.log.info({ guildId, roleName, position }, 'Namespaced role created');

    return roleName;
  }

  /**
   * Sync Arrakis roles without touching incumbent roles
   */
  async syncRoles(
    guildId: string,
    communityId: string,
    members: MemberEligibility[],
  ): Promise<RoleSyncResult> {
    const result: RoleSyncResult = {
      assigned: 0,
      removed: 0,
      unchanged: 0,
    };

    const arrakisRoles = await this.getArrakisRoles(guildId);

    for (const member of members) {
      const currentArrakisRoles = member.roles.filter(r =>
        arrakisRoles.some(ar => ar.id === r)
      );

      const targetRole = arrakisRoles.find(r =>
        r.name === `${this.defaultConfig.prefix}${member.tier}`
      );

      if (!targetRole) continue;

      const hasTargetRole = currentArrakisRoles.includes(targetRole.id);

      if (member.eligible && !hasTargetRole) {
        // Assign via synthesis (rate-limited)
        await this.synthesis.queue.add(`assign-${member.userId}`, {
          type: 'assign_role',
          guildId,
          communityId,
          payload: { userId: member.userId, roleId: targetRole.id },
          idempotencyKey: `assign:${communityId}:${member.userId}:${targetRole.id}`,
        });
        result.assigned++;
      } else if (!member.eligible && hasTargetRole) {
        // Remove via synthesis (rate-limited)
        await this.synthesis.queue.add(`remove-${member.userId}`, {
          type: 'remove_role',
          guildId,
          communityId,
          payload: { userId: member.userId, roleId: targetRole.id },
          idempotencyKey: `remove:${communityId}:${member.userId}:${targetRole.id}`,
        });
        result.removed++;
      } else {
        result.unchanged++;
      }
    }

    return result;
  }

  private async getArrakisRoles(guildId: string): Promise<Role[]> {
    const roles = await this.discordRest.getGuildRoles(guildId);
    return roles.filter(r => r.name.startsWith(this.defaultConfig.prefix));
  }

  private async findIncumbentRolePosition(guildId: string): Promise<number> {
    const roles = await this.discordRest.getGuildRoles(guildId);

    // Find any known incumbent role patterns
    const incumbentPatterns = [/holder/i, /verified/i, /member/i];

    for (const role of roles) {
      if (incumbentPatterns.some(p => p.test(role.name))) {
        return role.position;
      }
    }

    // Default to middle of role hierarchy
    return Math.floor(roles.length / 2);
  }
}
```

### 7.3 Migration Engine

#### 7.3.1 Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                       Migration Engine                               │
│                                                                      │
│  Strategies:                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │  instant: Immediate full migration                              ││
│  │  • Removes incumbent roles                                       ││
│  │  • Assigns Arrakis roles                                         ││
│  │  • Updates channel permissions                                   ││
│  │  • Risk: High (sudden change)                                    ││
│  └─────────────────────────────────────────────────────────────────┘│
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │  gradual: Progressive migration over N days                     ││
│  │  • New members: Arrakis immediately                              ││
│  │  • Existing members: Batched over time                           ││
│  │  • Risk: Low (controlled rollout)                                ││
│  └─────────────────────────────────────────────────────────────────┘│
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │  parallel_forever: Keep both systems indefinitely               ││
│  │  • No migration, continuous coexistence                          ││
│  │  • Users choose which system to use                              ││
│  │  • Risk: None (no changes)                                       ││
│  └─────────────────────────────────────────────────────────────────┘│
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │  arrakis_primary: Arrakis becomes primary, incumbent backup     ││
│  │  • Arrakis manages all token-gating                              ││
│  │  • Incumbent roles preserved but inactive                        ││
│  │  • Risk: Medium (primary responsibility shift)                   ││
│  └─────────────────────────────────────────────────────────────────┘│
│                                                                      │
│  Readiness Checks:                                                   │
│  • min_shadow_days: 14 (proven accuracy)                            │
│  • min_accuracy: 95% (divergence-free)                              │
│                                                                      │
│  Rollback System:                                                    │
│  • One-click rollback to previous mode                              │
│  • Auto-trigger on: >5% access loss in 1h, >10% error in 15m        │
│  • Preserve incumbent roles during rollback                         │
└─────────────────────────────────────────────────────────────────────┘
```

#### 7.3.2 Migration Engine Implementation

```typescript
// packages/adapters/coexistence/migration-engine.ts

export type MigrationStrategy = 'instant' | 'gradual' | 'parallel_forever' | 'arrakis_primary';

export interface MigrationConfig {
  strategy: MigrationStrategy;
  gradualDays?: number;              // For gradual strategy
  batchSize?: number;                // Members per batch
  rollbackThresholds: {
    accessLossPercent: number;       // Trigger rollback
    accessLossWindowMinutes: number;
    errorRatePercent: number;
    errorRateWindowMinutes: number;
  };
}

export interface MigrationReadiness {
  ready: boolean;
  checks: {
    shadowDays: { current: number; required: number; passed: boolean };
    accuracy: { current: number; required: number; passed: boolean };
    divergences: { current: number; maxAllowed: number; passed: boolean };
  };
}

export class MigrationEngine {
  private readonly shadowLedger: ShadowLedger;
  private readonly namespacedRoles: NamespacedRoleManager;
  private readonly synthesis: SynthesisEngine;
  private readonly redis: Redis;
  private readonly nats: NatsClient;
  private readonly log: Logger;
  private readonly metrics: PrometheusClient;

  constructor(
    shadowLedger: ShadowLedger,
    namespacedRoles: NamespacedRoleManager,
    synthesis: SynthesisEngine,
    redis: Redis,
    nats: NatsClient,
    logger: Logger,
    metrics: PrometheusClient,
  ) {
    this.shadowLedger = shadowLedger;
    this.namespacedRoles = namespacedRoles;
    this.synthesis = synthesis;
    this.redis = redis;
    this.nats = nats;
    this.log = logger.child({ component: 'MigrationEngine' });
    this.metrics = metrics;
  }

  /**
   * Check if community is ready for migration
   */
  async checkReadiness(communityId: string): Promise<MigrationReadiness> {
    const shadowStats = await this.shadowLedger.getStats(communityId);

    const checks = {
      shadowDays: {
        current: shadowStats.daysSinceFirstSync,
        required: 14,
        passed: shadowStats.daysSinceFirstSync >= 14,
      },
      accuracy: {
        current: shadowStats.accuracy,
        required: 0.95,
        passed: shadowStats.accuracy >= 0.95,
      },
      divergences: {
        current: shadowStats.unresolvedDivergences,
        maxAllowed: 10,
        passed: shadowStats.unresolvedDivergences <= 10,
      },
    };

    return {
      ready: Object.values(checks).every(c => c.passed),
      checks,
    };
  }

  /**
   * Start migration with selected strategy
   */
  async startMigration(
    communityId: string,
    guildId: string,
    config: MigrationConfig,
  ): Promise<string> {
    // Verify readiness
    const readiness = await this.checkReadiness(communityId);
    if (!readiness.ready) {
      throw new Error(`Community not ready for migration: ${JSON.stringify(readiness.checks)}`);
    }

    const migrationId = crypto.randomUUID();

    // Store migration state
    await this.redis.hset(`migration:${migrationId}`, {
      communityId,
      guildId,
      strategy: config.strategy,
      status: 'in_progress',
      startedAt: new Date().toISOString(),
      config: JSON.stringify(config),
    });

    this.log.info({ migrationId, communityId, strategy: config.strategy }, 'Starting migration');

    // Execute strategy
    switch (config.strategy) {
      case 'instant':
        await this.executeInstantMigration(migrationId, communityId, guildId);
        break;
      case 'gradual':
        await this.executeGradualMigration(migrationId, communityId, guildId, config);
        break;
      case 'arrakis_primary':
        await this.executeArrakisPrimaryMigration(migrationId, communityId, guildId);
        break;
      case 'parallel_forever':
        // No migration needed, just update config
        await this.setParallelForever(communityId);
        break;
    }

    // Start rollback monitoring
    await this.startRollbackMonitoring(migrationId, communityId, guildId, config);

    return migrationId;
  }

  /**
   * Execute instant migration
   */
  private async executeInstantMigration(
    migrationId: string,
    communityId: string,
    guildId: string,
  ): Promise<void> {
    const members = await this.shadowLedger.getAllMemberStates(guildId);

    for (const member of members) {
      // Remove incumbent roles
      if (member.incumbentRoles.size > 0) {
        for (const roleId of member.incumbentRoles) {
          await this.synthesis.queue.add(`remove-incumbent-${member.userId}`, {
            type: 'remove_role',
            guildId,
            communityId,
            payload: { userId: member.userId, roleId },
            idempotencyKey: `migrate:remove:${migrationId}:${member.userId}:${roleId}`,
          });
        }
      }

      // Assign Arrakis role if eligible
      if (member.arrakisEligible && member.arrakisTier) {
        await this.namespacedRoles.syncRoles(guildId, communityId, [{
          userId: member.userId,
          eligible: true,
          tier: member.arrakisTier,
          roles: [],
        }]);
      }
    }

    await this.updateMigrationStatus(migrationId, 'completed');
  }

  /**
   * Execute gradual migration over N days
   */
  private async executeGradualMigration(
    migrationId: string,
    communityId: string,
    guildId: string,
    config: MigrationConfig,
  ): Promise<void> {
    const days = config.gradualDays ?? 14;
    const members = await this.shadowLedger.getAllMemberStates(guildId);
    const batchSize = Math.ceil(members.length / days);

    // Schedule daily batches
    for (let day = 0; day < days; day++) {
      const batchStart = day * batchSize;
      const batchEnd = Math.min((day + 1) * batchSize, members.length);
      const batch = members.slice(batchStart, batchEnd);

      // Schedule for future execution
      await this.nats.publish('coexist.migration.batch', {
        migrationId,
        communityId,
        guildId,
        batchNumber: day + 1,
        totalBatches: days,
        memberIds: batch.map(m => m.userId),
        scheduledFor: new Date(Date.now() + day * 24 * 60 * 60 * 1000).toISOString(),
      });
    }

    await this.updateMigrationStatus(migrationId, 'in_progress_gradual');
  }

  /**
   * Rollback migration to previous state
   */
  async rollback(
    migrationId: string,
    reason: string,
    automatic: boolean,
  ): Promise<void> {
    const migration = await this.redis.hgetall(`migration:${migrationId}`);
    if (!migration) throw new Error(`Migration not found: ${migrationId}`);

    this.log.warn({ migrationId, reason, automatic }, 'ROLLBACK INITIATED');

    const { communityId, guildId } = migration;

    // Get snapshot from before migration
    const snapshot = await this.shadowLedger.getPreMigrationSnapshot(migrationId);

    // Restore incumbent roles
    for (const member of snapshot.members) {
      for (const roleId of member.incumbentRoles) {
        await this.synthesis.queue.add(`restore-${member.userId}-${roleId}`, {
          type: 'assign_role',
          guildId,
          communityId,
          payload: { userId: member.userId, roleId },
          idempotencyKey: `rollback:restore:${migrationId}:${member.userId}:${roleId}`,
        });
      }
    }

    // Remove Arrakis roles (keep for visibility but inactive)
    // Actually, keep Arrakis roles as they're namespaced and harmless

    await this.updateMigrationStatus(migrationId, 'rolled_back');

    // Notify admins
    await this.nats.publish('coexist.migration.rollback', {
      migrationId,
      communityId,
      reason,
      automatic,
      timestamp: Date.now(),
    });

    // Record audit
    this.metrics.migrationRollbacks.inc({
      community_id: communityId,
      automatic: automatic.toString(),
    });
  }

  /**
   * Start monitoring for auto-rollback triggers
   */
  private async startRollbackMonitoring(
    migrationId: string,
    communityId: string,
    guildId: string,
    config: MigrationConfig,
  ): Promise<void> {
    // Publish monitoring job
    await this.nats.publish('coexist.migration.monitor.start', {
      migrationId,
      communityId,
      guildId,
      thresholds: config.rollbackThresholds,
    });
  }

  private async updateMigrationStatus(migrationId: string, status: string): Promise<void> {
    await this.redis.hset(`migration:${migrationId}`, {
      status,
      updatedAt: new Date().toISOString(),
    });
  }

  private async setParallelForever(communityId: string): Promise<void> {
    // Update community config to parallel_forever mode
    this.log.info({ communityId }, 'Set to parallel_forever mode');
  }
}
```

---

## 8. Data Architecture

### 8.1 Data Ownership Split

| Data Type | Store | Access Pattern | Rationale |
|-----------|-------|----------------|-----------|
| communities | PostgreSQL | Read-heavy, rare writes | Transactional, config |
| profiles | PostgreSQL | Read-heavy, moderate writes | GDPR, foreign keys |
| badges | PostgreSQL | Read-heavy, rare writes | Relational |
| eligibility_rules | PostgreSQL | Read-heavy, admin writes | Complex queries |
| themes | PostgreSQL | Read-heavy, rare writes | Config |
| wizard_sessions | Redis | Read/write, TTL | Ephemeral |
| coexistence_config | PostgreSQL | Read-heavy, rare writes | Config |
| audit_logs | PostgreSQL | Append-only | Compliance |
| **scores** | **ScyllaDB** | Write-heavy, frequent reads | Hot path |
| **score_history** | **ScyllaDB** | Append-only, time-series | High volume |
| **leaderboards** | **ScyllaDB** | Read-heavy, sorted | Sorted access |
| **eligibility_snapshots** | **ScyllaDB** | Read/write per check | Caching |
| **chain_events** | **ScyllaDB** | Append-only, time-series | Indexing |
| **shadow_ledger** | **ScyllaDB** | Write-heavy, queries | Coexistence |

### 8.2 PostgreSQL Schema (Enhanced)

```sql
-- migrations/003_genesis_schema.sql

-- Themes table
CREATE TABLE IF NOT EXISTS themes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  subscription_tier TEXT NOT NULL DEFAULT 'free',
  tier_config JSONB NOT NULL,
  badge_config JSONB NOT NULL,
  naming_config JSONB NOT NULL,
  is_builtin BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Custom themes per community (enterprise)
CREATE TABLE IF NOT EXISTS community_themes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  theme_config JSONB NOT NULL,
  validated BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(community_id)
);

-- Coexistence configuration
CREATE TABLE IF NOT EXISTS coexistence_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'shadow' CHECK (mode IN ('shadow', 'parallel', 'primary', 'exclusive')),
  incumbent_type TEXT,                -- 'collabland', 'matrica', 'guild_xyz', 'other'
  incumbent_detection_confidence DECIMAL,
  incumbent_role_ids TEXT[],
  channel_strategy TEXT DEFAULT 'none',
  migration_strategy TEXT,
  migration_started_at TIMESTAMPTZ,
  migration_completed_at TIMESTAMPTZ,
  settings JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(community_id)
);

-- Wizard session snapshots (for recovery)
CREATE TABLE IF NOT EXISTS wizard_session_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT NOT NULL,
  community_id UUID REFERENCES communities(id),
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  state TEXT NOT NULL,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wizard_snapshots_session ON wizard_session_snapshots(session_id);

-- RLS policies for new tables
ALTER TABLE themes ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_themes ENABLE ROW LEVEL SECURITY;
ALTER TABLE coexistence_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY community_themes_tenant ON community_themes
  FOR ALL USING (community_id = current_setting('app.current_tenant')::UUID);

CREATE POLICY coexistence_config_tenant ON coexistence_config
  FOR ALL USING (community_id = current_setting('app.current_tenant')::UUID);
```

### 8.3 ScyllaDB Schema (Enhanced)

```cql
-- Chain events from Score Service indexer
CREATE TABLE arrakis.chain_events (
    community_id UUID,
    chain_id TEXT,
    contract_address TEXT,
    event_type TEXT,           -- 'Transfer', 'Approval', etc.
    block_number BIGINT,
    tx_hash TEXT,
    log_index INT,
    from_address TEXT,
    to_address TEXT,
    amount TEXT,               -- BigInt as string
    token_id TEXT,             -- For NFTs
    timestamp TIMESTAMP,
    processed BOOLEAN,
    PRIMARY KEY ((community_id, chain_id, contract_address), block_number, log_index)
) WITH CLUSTERING ORDER BY (block_number DESC, log_index DESC)
  AND default_time_to_live = 2592000; -- 30 days

-- Secondary index for address lookups
CREATE TABLE arrakis.chain_events_by_address (
    address TEXT,
    community_id UUID,
    chain_id TEXT,
    event_type TEXT,
    block_number BIGINT,
    tx_hash TEXT,
    amount TEXT,
    timestamp TIMESTAMP,
    PRIMARY KEY ((address, community_id), block_number)
) WITH CLUSTERING ORDER BY (block_number DESC)
  AND default_time_to_live = 2592000;
```

---

## 9. Message Broker Design

### 9.1 NATS Streams (Enhanced)

```typescript
// Additional streams for Genesis

export const GENESIS_STREAMS: StreamConfig[] = [
  // Existing streams from v1.0...

  // NEW: Synthesis operations
  {
    name: 'SYNTHESIS',
    subjects: ['synthesis.>'],
    retention: 'limits',
    storage: 'file',
    maxAge: 24 * 60 * 60 * 1_000_000_000, // 24 hours
    maxBytes: 500_000_000, // 500MB
    replicas: 3,
  },

  // NEW: Coexistence operations
  {
    name: 'COEXISTENCE',
    subjects: ['coexist.>'],
    retention: 'limits',
    storage: 'file',
    maxAge: 7 * 24 * 60 * 60 * 1_000_000_000, // 7 days
    maxBytes: 1_000_000_000, // 1GB
    replicas: 3,
  },

  // NEW: Score Service events
  {
    name: 'SCORES',
    subjects: ['scores.>'],
    retention: 'limits',
    storage: 'file',
    maxAge: 24 * 60 * 60 * 1_000_000_000, // 24 hours
    maxBytes: 500_000_000,
    replicas: 3,
  },
];
```

### 9.2 Subject Hierarchy (Enhanced)

```
arrakis.
├── commands.*                  # (existing)
├── events.*                    # (existing)
├── eligibility.*               # (existing)
├── internal.*                  # (existing)
│
├── synthesis.
│   ├── job.queued              # New synthesis job
│   ├── job.completed           # Job finished
│   ├── job.failed              # Job failed
│   ├── job.retry               # Job retrying
│   └── rate.exhausted          # Token bucket exhausted
│
├── coexist.
│   ├── shadow.
│   │   ├── sync.start          # Shadow sync started
│   │   ├── sync.complete       # Shadow sync finished
│   │   └── divergence.detected # Divergence found
│   ├── parallel.
│   │   ├── role.created        # Namespaced role created
│   │   └── role.synced         # Roles synchronized
│   └── migration.
│       ├── started             # Migration began
│       ├── batch               # Batch processed
│       ├── completed           # Migration finished
│       └── rollback            # Rollback triggered
│
└── scores.
    ├── update                  # Score updated
    ├── recalculate             # Full recalculation
    └── rank.changed            # Rank position changed
```

---

## 10. API Design

### 10.1 Web API (Next.js)

```typescript
// apps/web/app/api/wizard/[sessionId]/route.ts

export async function GET(
  request: Request,
  { params }: { params: { sessionId: string } },
) {
  const session = await wizardStore.get(params.sessionId);

  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  // Validate session ownership
  const userId = await getUserFromSession(request);
  if (session.userId !== userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  return NextResponse.json({
    state: session.state,
    data: session.data,
    expiresAt: session.expiresAt,
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: { sessionId: string } },
) {
  const body = await request.json();
  const { action, data } = body;

  const session = await wizardStore.get(params.sessionId);
  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  // Validate transition
  const nextState = getNextState(session.state, action);
  if (!nextState) {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }

  // Update session
  const updated = await wizardStore.transition(params.sessionId, nextState, data);

  return NextResponse.json({
    state: updated.state,
    data: updated.data,
  });
}
```

### 10.2 gRPC APIs (Score Service)

See §6.1.4 for Score Service gRPC protocol definitions.

---

## 11. Security Architecture

### 11.1 Security Layers

```
┌─────────────────────────────────────────────────────────────────────┐
│                      Security Architecture                           │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │ Layer 1: Network                                                ││
│  │ • VPC isolation                                                 ││
│  │ • Security groups (least privilege)                             ││
│  │ • TLS everywhere (cert-manager)                                 ││
│  └─────────────────────────────────────────────────────────────────┘│
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │ Layer 2: Authentication                                         ││
│  │ • Discord OAuth2 (users)                                        ││
│  │ • Vault AppRole (services)                                      ││
│  │ • NATS token auth                                               ││
│  └─────────────────────────────────────────────────────────────────┘│
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │ Layer 3: Authorization                                          ││
│  │ • PostgreSQL RLS (tenant isolation)                             ││
│  │ • Discord permission checks (ADMINISTRATOR)                     ││
│  │ • Subscription tier enforcement                                 ││
│  └─────────────────────────────────────────────────────────────────┘│
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │ Layer 4: Data Protection                                        ││
│  │ • Vault Transit (encryption at rest)                            ││
│  │ • No secrets in env vars                                        ││
│  │ • Audit logging (7-year retention)                              ││
│  └─────────────────────────────────────────────────────────────────┘│
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │ Layer 5: Operational Security                                   ││
│  │ • Kill switch (MFA-protected)                                   ││
│  │ • API key rotation                                              ││
│  │ • Rate limiting (per tenant)                                    ││
│  │ • Bulkhead isolation                                            ││
│  └─────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
```

### 11.2 Vault Configuration

```hcl
# vault/policies/arrakis-worker.hcl

path "transit/sign/arrakis-signing" {
  capabilities = ["update"]
}

path "transit/verify/arrakis-signing" {
  capabilities = ["update"]
}

path "transit/encrypt/arrakis-data" {
  capabilities = ["update"]
}

path "transit/decrypt/arrakis-data" {
  capabilities = ["update"]
}

path "secret/data/arrakis/*" {
  capabilities = ["read"]
}

# Deny key management (for kill switch)
path "transit/keys/*" {
  capabilities = ["deny"]
}
```

---

## 12. Observability Architecture

### 12.1 Metrics (Enhanced)

```typescript
// New metrics for Genesis

// Two-Tier Provider
export const twoTierMetrics = {
  scoreServiceLatency: new Histogram({
    name: 'arrakis_score_service_latency_seconds',
    help: 'Score Service request latency',
    labelNames: ['method', 'status'],
    buckets: [0.1, 0.5, 1, 2, 5, 10],
  }),

  circuitBreakerState: new Gauge({
    name: 'arrakis_circuit_breaker_state',
    help: 'Circuit breaker state (0=closed, 1=half-open, 2=open)',
    labelNames: ['service'],
  }),

  degradedResponses: new Counter({
    name: 'arrakis_degraded_responses_total',
    help: 'Total degraded responses (fallback used)',
    labelNames: ['rule_type'],
  }),
};

// Synthesis Engine
export const synthesisMetrics = {
  jobsQueued: new Counter({
    name: 'arrakis_synthesis_jobs_queued_total',
    help: 'Total synthesis jobs queued',
    labelNames: ['type'],
  }),

  jobsCompleted: new Counter({
    name: 'arrakis_synthesis_jobs_completed_total',
    help: 'Total synthesis jobs completed',
    labelNames: ['type', 'status'],
  }),

  tokenBucketTokens: new Gauge({
    name: 'arrakis_token_bucket_tokens',
    help: 'Current tokens in global token bucket',
  }),

  tokenBucketWaits: new Counter({
    name: 'arrakis_token_bucket_waits_total',
    help: 'Total times waiting for token bucket',
  }),
};

// Coexistence
export const coexistenceMetrics = {
  shadowSyncDuration: new Histogram({
    name: 'arrakis_shadow_sync_duration_seconds',
    help: 'Shadow sync job duration',
    labelNames: ['community_id'],
    buckets: [10, 30, 60, 120, 300, 600],
  }),

  shadowSyncAccuracy: new Gauge({
    name: 'arrakis_shadow_sync_accuracy',
    help: 'Shadow sync accuracy (0-1)',
    labelNames: ['community_id'],
  }),

  divergencesDetected: new Counter({
    name: 'arrakis_divergences_detected_total',
    help: 'Total divergences detected in shadow mode',
    labelNames: ['community_id', 'type'],
  }),

  migrationRollbacks: new Counter({
    name: 'arrakis_migration_rollbacks_total',
    help: 'Total migration rollbacks',
    labelNames: ['community_id', 'automatic'],
  }),
};

// Vault
export const vaultMetrics = {
  operations: new Counter({
    name: 'arrakis_vault_operations_total',
    help: 'Total Vault operations',
    labelNames: ['operation', 'status'],
  }),

  latency: new Histogram({
    name: 'arrakis_vault_latency_seconds',
    help: 'Vault operation latency',
    labelNames: ['operation'],
    buckets: [0.01, 0.05, 0.1, 0.5, 1],
  }),
};
```

### 12.2 Dashboards (Enhanced)

| Dashboard | Panels |
|-----------|--------|
| **Two-Tier Provider** | Score Service latency p50/p99, Circuit breaker states, Degraded response rate |
| **Synthesis Engine** | Jobs/sec, Queue depth, Token bucket utilization, Discord 429 rate |
| **Coexistence** | Shadow sync frequency, Accuracy over time, Divergence trends, Migration progress |
| **Vault** | Operations/sec, Latency, Error rate, Kill switch status |
| **WizardEngine** | Sessions active, Completion funnel, Timeout rate |

---

## 13. Deployment Architecture

### 13.1 Kubernetes Resources (Enhanced)

```yaml
# kubernetes/score-service/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: arrakis-score-service
spec:
  replicas: 3
  selector:
    matchLabels:
      app: arrakis-score-service
  template:
    metadata:
      labels:
        app: arrakis-score-service
    spec:
      containers:
        - name: score-service
          image: arrakis/score-service:latest
          resources:
            requests:
              memory: "256Mi"
              cpu: "500m"
            limits:
              memory: "512Mi"
              cpu: "1000m"
          env:
            - name: RUST_LOG
              value: "info"
            - name: SCYLLA_BUNDLE_PATH
              value: "/secrets/scylla-bundle.zip"
          ports:
            - containerPort: 50051
              name: grpc
            - containerPort: 9090
              name: metrics
          volumeMounts:
            - name: secrets
              mountPath: /secrets
              readOnly: true
      volumes:
        - name: secrets
          secret:
            secretName: arrakis-scylla-secrets
---
# kubernetes/coexistence-worker/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: arrakis-coexistence-worker
spec:
  replicas: 2
  selector:
    matchLabels:
      app: arrakis-coexistence-worker
  template:
    metadata:
      labels:
        app: arrakis-coexistence-worker
    spec:
      containers:
        - name: worker
          image: arrakis/worker:latest
          args: ["--mode", "coexistence"]
          resources:
            requests:
              memory: "256Mi"
              cpu: "250m"
            limits:
              memory: "512Mi"
              cpu: "500m"
```

### 13.2 Vault Deployment

```yaml
# kubernetes/vault/values.yaml
server:
  ha:
    enabled: true
    replicas: 3
    raft:
      enabled: true

  extraEnvironmentVars:
    VAULT_SEAL_TYPE: awskms
    VAULT_AWSKMS_SEAL_KEY_ID: alias/vault-unseal

  auditStorage:
    enabled: true
    size: 10Gi

injector:
  enabled: true
```

---

## 14. Migration Strategy

### 14.1 Phase Overview

| Part | Phases | Duration | Focus |
|------|--------|----------|-------|
| **I: Infrastructure** | 1-4 | 28 weeks | Foundation (existing SDD v1.0) |
| **II: SaaS Platform** | 5-10 | 16 weeks | Multi-tenancy, features |
| **III: Coexistence** | 11-13 | 10 weeks | Market entry |
| **Total** | 1-13 | **54 weeks** | Complete Genesis |

### 14.2 Phase Dependencies

```
Part I (Phases 1-4) - IMPLEMENTED (Sprints S-1 to S-14)
├── Phase 1: Foundation ✓
├── Phase 2: Gateway & NATS ✓
├── Phase 3: Hardening ✓
└── Phase 4: Optimization ✓

Part II (Phases 5-10) - NEW
├── Phase 5: Two-Tier Provider
│   └── Depends on: Phase 4 (RPC pool, caching)
├── Phase 6: Themes System
│   └── Depends on: Phase 5 (chain provider for badges)
├── Phase 7: PostgreSQL Multi-Tenant
│   └── Depends on: Phase 6 (theme storage)
├── Phase 8: Redis + Hybrid State
│   └── Depends on: Phase 7 (wizard sessions)
├── Phase 9: BullMQ + Token Bucket
│   └── Depends on: Phase 8 (synthesis engine)
└── Phase 10: Vault + Security + Wizard
    └── Depends on: Phase 9 (full platform)

Part III (Phases 11-13) - NEW
├── Phase 11: Shadow Mode
│   └── Depends on: Phase 10 (full platform ready)
├── Phase 12: Parallel Mode
│   └── Depends on: Phase 11 (proven accuracy)
└── Phase 13: Migration Engine
    └── Depends on: Phase 12 (parallel operations)
```

---

## 15. Testing Strategy

### 15.1 Test Categories (Enhanced)

| Category | Scope | Tools |
|----------|-------|-------|
| Unit Tests | Component logic | Vitest |
| Integration Tests | Multi-component | Vitest + Testcontainers |
| E2E Tests | Full flow | Playwright (web), Discord mock |
| Load Tests | Performance | k6 |
| Chaos Tests | Resilience | Litmus Chaos |
| Security Tests | Vulnerabilities | OWASP ZAP, npm audit |
| Theme Regression | SietchTheme parity | Custom test suite |
| Coexistence Tests | Shadow accuracy | Custom validators |

### 15.2 SietchTheme Parity Tests

```typescript
// tests/theme-regression/sietch-parity.test.ts

describe('SietchTheme v4.1 Parity', () => {
  const theme = new SietchTheme();
  const legacyResults = loadLegacyTestCases('./fixtures/v4.1-tier-results.json');

  for (const testCase of legacyResults) {
    it(`should match v4.1 tier for score=${testCase.score}, rank=${testCase.rank}`, () => {
      const result = theme.evaluateTier(testCase.score, testCase.totalMembers, testCase.rank);

      expect(result.tier.id).toBe(testCase.expectedTier);
      expect(result.tier.displayName).toBe(testCase.expectedDisplayName);
    });
  }

  for (const testCase of legacyResults) {
    it(`should match v4.1 badges for profile ${testCase.profileId}`, () => {
      const badges = theme.evaluateBadges(testCase.profile, testCase.history);
      const badgeIds = badges.map(b => b.id).sort();

      expect(badgeIds).toEqual(testCase.expectedBadges.sort());
    });
  }
});
```

---

## 16. Performance Engineering

### 16.1 Performance Targets

| Metric | Target | Part |
|--------|--------|------|
| Gateway memory (10k guilds) | <200 MB | I |
| Event routing (NATS) | <50ms p99 | I |
| Eligibility check (cached) | <100ms p99 | I |
| Eligibility check (RPC) | <2s p99 | I |
| Slash command response | <500ms p99 | I |
| Score Service query | <200ms p99 | II |
| Wizard step response | <3s (Discord limit) | II |
| Synthesis throughput | 10 ops/sec | II |
| Shadow sync (1000 members) | <5 min | III |
| Migration rollback | <2 min | III |

### 16.2 Scale Targets

| Metric | Target |
|--------|--------|
| Discord servers | 10,000+ |
| Expandable to | 100,000+ |
| Concurrent tenants | 1,000+ |
| Members per community | 100,000 |
| Score Service writes/sec | 1,000+ |
| Shadow sync accuracy | >95% |

---

## 17. Development Phases

### 17.1 Phase Summary (Updated)

| Phase | Duration | Focus | Status |
|-------|----------|-------|--------|
| 1-4 | 28 weeks | Infrastructure | ✓ IMPLEMENTED |
| 5 | 2 weeks | Two-Tier Provider | PLANNED |
| 6 | 2 weeks | Themes System | PLANNED |
| 7 | 4 weeks | PostgreSQL Multi-Tenant | PLANNED |
| 8 | 2 weeks | Redis + Hybrid State | PLANNED |
| 9 | 2 weeks | BullMQ + Token Bucket | PLANNED |
| 10 | 4 weeks | Vault + Security + Wizard | PLANNED |
| 11 | 4 weeks | Shadow Mode | PLANNED |
| 12 | 4 weeks | Parallel Mode | PLANNED |
| 13 | 2 weeks | Migration Engine | PLANNED |

### 17.2 Sprint Planning Notes

Sprint planning for Part II and Part III will be generated via `/sprint-plan` after SDD approval.

---

## 18. Technical Risks & Mitigation

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Score Service complexity | Medium | High | Start with simple scoring, iterate |
| Vault operational overhead | Medium | Medium | Use managed Vault (HCP) if needed |
| Theme regression | Medium | High | Comprehensive parity test suite |
| Shadow mode false positives | Medium | Medium | Manual override capability |
| Migration rollback failures | Low | Critical | Extensive chaos testing |
| Discord global 429 | Medium | Critical | Global token bucket |
| Incumbent legal concerns | Low | Medium | Namespaced roles, no touching |
| User confusion | Medium | Medium | Clear UX, glimpse mode |

---

## 19. Appendix

### 19.1 Technology Decision Records

| Decision | Date | Choice | Rationale |
|----------|------|--------|-----------|
| Score Service | 2026-01-16 | Internal Rust microservice | Control, scale, no external dependencies |
| Vault scope | 2026-01-16 | Comprehensive (OAuth + wallet + API) | Enterprise security requirement |
| Wizard UX | 2026-01-16 | Hybrid Web + Discord | MEE6-style for complex, Discord for simple |
| Coexistence strategy | 2026-01-16 | Shadow → Parallel → Migration | Zero-risk proving approach |

### 19.2 Reference Documents

| Document | Location |
|----------|----------|
| PRD v2.0 | `grimoires/loa/prd.md` |
| SDD v1.0 | `grimoires/loa/archive/pre-genesis/sdd.md` |
| Sprint Plan | `grimoires/loa/sprint.md` |
| Scaling Roadmap | `grimoires/loa/context/arrakis-scaling-roadmap-reviews.md` |
| Gateway Proxy Sprints | `grimoires/loa/a2a/sprint-gw-*` |
| Scaling Sprints | `grimoires/loa/a2a/sprint-s-*` |

### 19.3 Glossary

| Term | Definition |
|------|------------|
| Two-Tier Provider | Architecture separating Native Reader (always available) from Score Service (complex queries) |
| Shadow Mode | Coexistence mode where Arrakis tracks but doesn't mutate Discord |
| Parallel Mode | Coexistence mode where Arrakis roles exist alongside incumbents |
| Synthesis | Discord mutation operations (role create/assign, channel create) |
| Token Bucket | Global rate limiter for Discord API calls |
| Kill Switch | Emergency shutdown mechanism for synthesis operations |
| WizardEngine | Self-service community onboarding flow |
| SietchTheme | Premium Dune-themed progression system |

---

**Document Status:** DRAFT - Pending Approval

**Revision History:**
| Version | Date | Changes |
|---------|------|---------|
| 2.0 | Jan 16, 2026 | Complete Genesis SDD covering all 13 phases |
| 1.0 | Jan 15, 2026 | Initial SDD for infrastructure scaling (Phases 1-4) |

**Next Steps:**
1. Review and approve this SDD
2. Create sprint plan for Part II (`/sprint-plan`)
3. Begin Phase 5 implementation

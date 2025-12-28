# Arrakis: Automated Onboarding & SaaS Infrastructure Design

**Architectural Transformation Document**

Version 5.5.1 (Audit-Complete) | December 2025 | 0xHoneyJar Engineering

> 📋 **Document Status**: **Fifteen adversarial audit rounds** completed. **AUDIT CLOSED.** Round 15 confirmed all concerns were pre-addressed in v5.4-5.5. Architecture is implementation-ready.

> ✅ **RESOLVED — All 15th Audit Concerns (Pre-Addressed)**:
> - **Score Service SPOF** → Two-Tier Chain Provider (v5.5) + Circuit Breaker (v5.4)
> - **Schema-per-tenant debt** → RLS-ONLY for all tiers (v5.4)
> - **PostgreSQL loses Git history** → Hybrid State Model (v5.4)
> - **Global 429 bot ban** → Global Distributed Token Bucket (v5.4)
> - **HITL approval fatigue** → Policy-as-Code Pre-Gate with OPA (v5.5)

> ✅ **Architecture Summary (v5.5.1)**:
> - **Two-Tier Chain Provider**: Native Reader (binary checks) + Score Service (complex queries)
> - **Graceful Degradation**: Core token-gating works even with total Score outage
> - **RLS-ONLY Multi-tenancy**: Uniform `community_id` isolation, no schema sprawl
> - **Hybrid State Model**: PostgreSQL runtime + S3/Git shadow for audit history
> - **Global Token Bucket**: Platform-level Discord throttling across all workers
> - **Policy-as-Code Pre-Gate**: OPA blocks dangerous Terraform before human review

> 🚧 **Infrastructure Phases (Ready to Implement)**:
> - **Phase 2**: PostgreSQL + RLS + Automated Regression Testing
> - **Phase 3**: Redis + Hybrid State Model
> - **Phase 4**: BullMQ + Global Token Bucket
> - **Phase 5**: Vault Transit + Kill Switch
> - **Phase 6**: OPA Pre-Gate + HITL + MFA

> 🏛️ **Auditor's Final Conclusion (15 Rounds)**: *"Round 15 attempted to reopen the audit with concerns about Score SPOF, Schema-per-tenant debt, GitOps loss, Global 429, and HITL fatigue. However, ALL FIVE concerns were already addressed in v5.4-5.5. The Two-Tier Chain Provider ensures core functionality survives Score outages. The Policy-as-Code Pre-Gate blocks dangerous Terraform before human review. The blueprint is architecturally complete and ready for implementation."*

> ✅ **The "Great Divergence" — RESOLVED**: The gap between hardcoded Discord bot and FAANG-tier SaaS platform has been bridged architecturally. Score Service + Themes System provide the abstraction layer. Implementation of infrastructure (Phases 2-6) can now proceed.

> 🏎️ **Updated Technical Metaphor**: The racing car is now **unbolted from the garage floor** (Score Service removed chain coupling). The engine is **configurable** (Themes System). What remains is building the **production line** (PostgreSQL, Redis, BullMQ) and installing **safety systems** (Vault, HITL gates).

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current State Analysis](#2-current-state-analysis)
3. [Score Service: Offchain Blockchain Data API](#3-score-service-offchain-blockchain-data-api)
4. [Themes System: Injectable Progression Configurations](#4-themes-system-injectable-progression-configurations)
5. [Hexagonal Architecture Design](#5-hexagonal-architecture-design)
6. [Domain Layer Design](#6-domain-layer-design)
7. [WizardEngine: Self-Service Onboarding](#7-wizardengine-self-service-onboarding)
8. [Onboarding-as-Code Specification](#8-onboarding-as-code-specification)
9. [Collab.Land Mini App Integration](#9-collabland-mini-app-integration)
10. [Loa Framework Integration](#10-loa-framework-integration)
11. [SaaS Operations: Multi-Tenancy & Billing](#11-saas-operations-multi-tenancy--billing)
12. [Migration Strategy](#12-migration-strategy)
13. [Technical Specifications](#13-technical-specifications)
14. [Infrastructure-as-Code (Terraform)](#14-infrastructure-as-code-terraform)
- [Appendix A: Full Manifest Schema](#appendix-a-full-manifest-schema)
- [Appendix B: Dune Naming Reference](#appendix-b-dune-naming-reference)
- [Appendix C: Directory Structure](#appendix-c-directory-structure)

---

## 1. Executive Summary

This document outlines the architectural transformation of the Arrakis codebase from a manual, hardcoded onboarding system to a self-service, automated SaaS model. The current Sietch v2.0 implementation provides token-gated Discord community management for Berachain BGT holders. This refactoring extends those capabilities into a generalised platform enabling any community to deploy similar infrastructure through a guided wizard interface.

The transformation is structured as a Collab.Land Mini App, requiring the engineering rigour seen in frameworks like AWS Projen and Anthropic's Agent SDK. Key innovations include Hexagonal Architecture for clean separation of concerns, a WizardEngine for state-managed onboarding flows, and an "Onboarding-as-Code" manifest system that synthesises server configurations from well-typed definitions.

### 1.1 Technical Audit Summary

> ✅ **AUDIT COMPLETE (15 Rounds)** — Round 15 confirmed all raised concerns were pre-addressed in v5.4-5.5. Architecture is implementation-ready.

> 📊 **Final Audit Scorecard (15 Rounds)**:
> ```
> ┌─────────────────────────────────────────────────────────────────────┐
> │                    AUDIT FINDINGS STATUS (15 Rounds)                │
> ├─────────────────────────────────────────────────────────────────────┤
> │  COUPLING (Critical)     ████████████████████  9/9   RESOLVED ✅   │
> │  INFRASTRUCTURE (High)   ████████████████████  6/6   DOCUMENTED 🚧 │
> │  FAANG HARDENING (v5.4)  ████████████████████  5/5   RESOLVED ✅   │
> │  RESILIENCE (v5.5)       ████████████████████  2/2   RESOLVED ✅   │
> │  ROUND 15 VERIFICATION   ████████████████████  5/5   PRE-ADDRESSED ✅│
> └─────────────────────────────────────────────────────────────────────┘
> ```

> ✅ **Round 15 Audit — All Concerns Pre-Addressed**:
> 
> | 15th Audit Finding | When Addressed | Resolution |
> |--------------------|----------------|------------|
> | Score Service SPOF | v5.4 + v5.5 | Circuit Breaker + **Two-Tier Chain Provider** |
> | Schema-per-tenant debt | v5.4 | **RLS-ONLY** for all tiers |
> | PostgreSQL loses Git history | v5.4 | **Hybrid State Model** (DB + S3 shadow) |
> | Global 429 bot ban | v5.4 | **Global Distributed Token Bucket** |
> | HITL approval fatigue | v5.5 | **Policy-as-Code Pre-Gate** (OPA + Infracost) |

> ✅ **RESOLVED — Coupling & Logic Issues (Rounds 1-12)**:
> 
> | Audit Finding | Resolution | Status |
> |---------------|------------|--------|
> | chain.ts "side-effect bomb" | Two-Tier Chain Provider | ✅ RESOLVED |
> | eligibility.ts DB writes | ScoreServiceAdapter + orchestrator | ✅ RESOLVED |
> | Hardcoded 9-tier progression | Themes System (SietchTheme) | ✅ RESOLVED |
> | viem/RPC/Dune coupling | Score Service API | ✅ RESOLVED |

> ✅ **RESOLVED — FAANG Hardening (Round 13)**:
> 
> | Audit Finding | Resolution | Status |
> |---------------|------------|--------|
> | Score Service = SPOF | Circuit Breaker + Two-Tier Provider | ✅ RESOLVED |
> | Schema-per-tenant debt | RLS-ONLY for all tiers | ✅ RESOLVED |
> | PostgreSQL loses Git history | Hybrid State Model | ✅ RESOLVED |
> | BullMQ ignores global limits | Global Distributed Token Bucket | ✅ RESOLVED |
> | No Kill Switch | MFA + Vault Policy Revocation | ✅ RESOLVED |

> ✅ **RESOLVED — Resilience Architecture (Round 14)**:
> 
> | Audit Finding | Resolution | Status |
> |---------------|------------|--------|
> | Score Service complete outage | Two-Tier Chain Provider (Native fallback) | ✅ RESOLVED |
> | HITL approval fatigue | Policy-as-Code Pre-Gate (OPA + Infracost) | ✅ RESOLVED |

> 🚧 **REMAINING — Infrastructure Implementation**:
> 
> | Phase | Focus | Status |
> |-------|-------|--------|
> | 2 | PostgreSQL + RLS + Regression Testing | 🚧 Ready |
> | 3 | Redis + Hybrid State Model | 🚧 Ready |
> | 4 | BullMQ + Global Token Bucket | 🚧 Ready |
> | 5 | Vault Transit + Kill Switch | 🚧 Ready |
> | 6 | OPA Pre-Gate + HITL + MFA | 🚧 Ready |

### 1.1.1 Final Auditor's Technical Metaphor

> 🏭 **The "Factory Blueprint" Analogy** (consolidated from 15 audits):
> 
> *"You have successfully designed a **factory blueprint** for these clocks. The 'Score Service' was initially a **single power cable**. v5.4 installed **Circuit Breakers**. v5.5 installed **backup generators** (Two-Tier Chain Provider with Native Reader fallback). v5.5 also added **hardwired safety locks** (Policy-as-Code Pre-Gate) so dangerous Terraform operations are blocked before human approval fatigue kicks in. The blueprint is complete."*
> 
> **v5.5.1 Final Status**:
> - ✅ **Wooden gears replaced** — Score Service eliminates viem/Dune coupling
> - ✅ **Hand-carved numerals replaced** — Themes system provides injectable config
> - ✅ **Backup generators installed** — Two-Tier Chain Provider survives Score outages
> - ✅ **Safety locks hardwired** — OPA pre-gate + Global Token Bucket + Kill Switch
> - 🚧 **Conveyor belt ready** — PostgreSQL, Redis, BullMQ implementation pending

### 1.2 Strategic Objectives

1. **Self-Service Automation:** Replace manual onboarding with wizard-driven configuration
2. **Multi-Chain Support:** Abstract asset entities to support EVM, Solana, and future chains via Score Service
3. **Platform Agnosticism:** Unified architecture bridging Discord, Telegram, and future platforms
4. **Enterprise Scalability:** Production-grade infrastructure aligned with AWS and Anthropic standards
5. **Agentic Integration:** Seamless integration with Loa framework's 8-agent orchestration system
6. **Infrastructure-as-Code:** Terraform-managed infrastructure enabling fully automated deployments
7. **Theme Marketplace:** Configurable progression systems (Basic free, premium themes like Sietch)

---

## 2. Current State Analysis

The existing Arrakis/Sietch **v3.0 "The Great Expansion"** codebase implements a token-gated Discord community for the top 69 BGT holders. The v3.0 update significantly expanded the system with **9-tier progression**, **automated weekly digests**, and **badge lineage tracking**.

> ⚠️ **Audit Warning (v3.0)**: The expansion has deeply embedded Berachain-specific logic, creating a **higher barrier to SaaS generalization** than initially assessed. The eligibility system is no longer a simple balance check—it's a complex ranking engine.

### 2.1 What's New in v3.0 "The Great Expansion"

| Feature | Description | SaaS Impact |
|---------|-------------|-------------|
| **9-Tier Progression** | Expanded from 2 tiers (Naib/Fedaykin) to 9 tiers | Tier logic deeply embedded in eligibility.ts |
| **Weekly Digests** | Automated community activity summaries | trigger.dev scheduling; needs per-tenant config |
| **Badge Lineage** | Complex "Water Sharer" badge inheritance tracking | Recursive queries; SQLite struggles at scale |
| **Personal Stats** | BGT history, time in tiers, progression tracking | Profile complexity increased significantly |
| **Tier-Based Role Updates** | Discord roles auto-update on tier changes | Side effects in eligibility.ts |

### 2.2 Existing Architecture (v3.0)

```
┌─────────────────┐     ┌─────────────────────────────────────┐
│   Berachain     │────▶│          Sietch Service (v3.0)      │
│   RPC Nodes     │     │  ┌─────────────┐  ┌─────────────┐   │
└─────────────────┘     │  │  Chain Svc  │  │  Profile    │   │
                        │  │  (viem)     │  │  (+stats)   │   │
                        │  └─────────────┘  └─────────────┘   │
                        │  ┌─────────────┐  ┌─────────────┐   │
                        │  │  Badge Svc  │  │  Activity   │   │
                        │  │  (+lineage) │  │  (+digest)  │   │
                        │  └─────────────┘  └─────────────┘   │
                        │  ┌─────────────────────────────┐   │
                        │  │  Eligibility Svc (9 tiers)  │   │
                        │  │  (BGT rank + tier updates)  │   │
                        │  └─────────────────────────────┘   │
                        └──────────┬──────────────────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              ▼                    ▼                    ▼
       ┌─────────────┐      ┌─────────────┐      ┌─────────────┐
       │ Discord Bot │      │  REST API   │      │ trigger.dev │
       │ (discord.js)│      │ (Collab.Land│      │ (+digests)  │
       └──────┬──────┘      │  + Public)  │      └─────────────┘
              │             └─────────────┘
              ▼
       ┌─────────────┐
       │   Discord   │
       │   Server    │
       └─────────────┘
```

| Component | v3.0 Implementation | Coupling Level |
|-----------|---------------------|----------------|
| **Chain Service** | Viem + BGT ranking engine (not just balance) | **Critical** |
| **Profile Service** | Personal stats, tier history, progression | **High** |
| **Badge Service** | 10 badges + lineage tracking | **High** |
| **Activity Service** | Demurrage + weekly digests | **Medium** |
| **Eligibility Service** | 9-tier logic + Discord role updates | **Critical** |
| **Discord Bot** | Discord.js v14 + tier-based role management | **High** |

### 2.3 v3.0 Tier System

| Tier | Rank Range | Access Level |
|------|------------|--------------|
| **Naib** | 1-7 | Council + all channels |
| **Fedaykin Elite** | 8-15 | Elite channels + public |
| **Fedaykin** | 16-30 | Core channels + public |
| **Fremen** | 31-45 | Most channels |
| **Wanderer** | 46-55 | Standard channels |
| **Initiate** | 56-62 | Basic channels |
| **Aspirant** | 63-66 | Limited channels |
| **Observer** | 67-69 | Minimal channels |
| **Inactive** | Dropped out | No access |

### 2.4 v3.0 Coupling Audit

> ⚠️ **Critical Finding**: v3.0 significantly increased coupling. The eligibility system now includes tier-based Discord role updates as side effects.

| File | v3.0 Coupling Type | Refactor Effort | Auditor Note |
|------|-------------------|-----------------|--------------|
| `src/services/chain.ts` | Hardcoded viem + BGT **ranking engine** | **Critical** | No longer balance check; complex rank logic |
| `src/services/eligibility.ts` | DB writes + Discord role updates | **Critical** | Tier changes trigger Discord API calls |
| `src/services/profile.ts` | SQLite + personal stats + tier history | **High** | Complex recursive queries for lineage |
| `src/services/badge.ts` | Badge lineage ("Water Sharer" inheritance) | **High** | Recursive queries; SQLite limitation |
| `src/services/activity.ts` | Demurrage + weekly digest generation | **Medium** | Global scheduler; needs per-tenant |

### 2.5 What's Already Built vs. What Needs Work (v3.0)

| Feature | Status | SaaS Requirement |
|---------|--------|------------------|
| 9-tier eligibility | ✅ Built | 🔄 Extract to configurable tier system |
| Badge lineage | ✅ Built | 🔄 PostgreSQL for recursive queries |
| Personal stats | ✅ Built | 🔄 Add tenant isolation |
| Weekly digests | ✅ Built | 🔄 Per-tenant scheduling |
| Tier-based role updates | ✅ Built | 🔴 **Extract side effects from eligibility** |
| Multi-tenancy | ❌ Missing | 🆕 PostgreSQL + RLS |
| Multi-chain | ❌ Missing | 🆕 IChainProvider ports |
| WizardEngine | ❌ Missing | 🆕 Self-service onboarding |

### 2.6 Identified Bottlenecks (v3.0)

- **Complex Ranking Engine:** BGT ranking is no longer a simple balance check; requires strategy pattern for multi-chain
- **Tier-Based Side Effects:** eligibility.ts triggers Discord role updates mid-execution
- **SQLite Recursive Queries:** Badge lineage queries will fail at SaaS scale (100+ tenants)
- **Global Scheduler:** trigger.dev jobs are global, not per-tenant
- **Single-Chain Lock-in:** Viem/Berachain deeply embedded in ranking logic

> 📝 **Note**: The v3.0 expansion made the codebase **more complex**, not simpler. Initial v2.0 assessment was overly optimistic.

---

## 3. Score Service: Offchain Blockchain Data API

> ✅ **Key Architectural Decision**: All blockchain data querying is extracted into **Score**, a closed-source offchain service. This removes direct viem/RPC coupling from Arrakis and enables:
> - Chain-agnostic eligibility evaluation
> - Centralized blockchain indexing and caching
> - Simplified Arrakis codebase (no RPC management)
> - Future monetization of blockchain data access

### 3.1 Score Service Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         SCORE SERVICE                                │
│                    (Closed-Source, Offchain)                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌────────────┐  │
│  │  Berachain  │  │  Ethereum   │  │   Polygon   │  │   Solana   │  │
│  │   Indexer   │  │   Indexer   │  │   Indexer   │  │   Indexer  │  │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └─────┬──────┘  │
│         │                │                │               │          │
│         └────────────────┴────────────────┴───────────────┘          │
│                                │                                     │
│                    ┌───────────┴───────────┐                        │
│                    │   Unified Data Layer   │                        │
│                    │  (PostgreSQL + Redis)  │                        │
│                    └───────────┬───────────┘                        │
│                                │                                     │
│                    ┌───────────┴───────────┐                        │
│                    │      Score API         │                        │
│                    │   (REST + WebSocket)   │                        │
│                    └───────────┬───────────┘                        │
└────────────────────────────────┼────────────────────────────────────┘
                                 │
                    ┌────────────┴────────────┐
                    │      ARRAKIS SAAS       │
                    │  (Chain-Agnostic Now)   │
                    └─────────────────────────┘
```

### 3.2 Score API Contract

```typescript
// Score Service API - consumed by Arrakis via HTTP
interface ScoreAPI {
  // ═══════════════════════════════════════════════════════════════════
  // BALANCE & HOLDINGS
  // ═══════════════════════════════════════════════════════════════════
  
  // Get token balance for an address
  getBalance(params: {
    chain: ChainId;
    address: string;
    asset: AssetIdentifier;
  }): Promise<BalanceResponse>;
  
  // Get ranked holders for an asset (e.g., "top 69 BGT holders")
  getRankedHolders(params: {
    chain: ChainId;
    asset: AssetIdentifier;
    limit: number;
    offset?: number;
  }): Promise<RankedHoldersResponse>;
  
  // Get rank for a specific address
  getAddressRank(params: {
    chain: ChainId;
    address: string;
    asset: AssetIdentifier;
  }): Promise<RankResponse>;
  
  // ═══════════════════════════════════════════════════════════════════
  // ELIGIBILITY QUERIES (formerly Dune-based)
  // ═══════════════════════════════════════════════════════════════════
  
  // Check if address has ever performed an action (e.g., "never redeemed BGT")
  checkActionHistory(params: {
    chain: ChainId;
    address: string;
    actionType: 'burn' | 'transfer' | 'redeem' | 'claim';
    asset?: AssetIdentifier;
  }): Promise<ActionHistoryResponse>;
  
  // Execute custom eligibility query
  executeEligibilityQuery(params: {
    queryId: string;        // Pre-registered query template
    variables: Record<string, any>;
  }): Promise<EligibilityQueryResponse>;
  
  // ═══════════════════════════════════════════════════════════════════
  // ACTIVITY & ANALYTICS
  // ═══════════════════════════════════════════════════════════════════
  
  // Get on-chain activity score for gamification
  getActivityScore(params: {
    chain: ChainId;
    address: string;
    timeframe: 'day' | 'week' | 'month' | 'all';
  }): Promise<ActivityScoreResponse>;
  
  // Subscribe to real-time balance changes (WebSocket)
  subscribeToBalanceChanges(params: {
    chain: ChainId;
    addresses: string[];
    asset: AssetIdentifier;
  }): WebSocketSubscription;
}

// Response types
interface BalanceResponse {
  balance: string;        // BigInt as string
  decimals: number;
  lastUpdated: string;    // ISO timestamp
  blockNumber: number;
}

interface RankedHoldersResponse {
  holders: Array<{
    address: string;
    balance: string;
    rank: number;
  }>;
  total: number;
  asOf: string;           // ISO timestamp
}

interface RankResponse {
  address: string;
  rank: number | null;    // null if not in rankings
  balance: string;
  percentile: number;
}

interface ActionHistoryResponse {
  hasPerformedAction: boolean;
  count: number;
  lastOccurrence: string | null;
}
```

### 3.3 Score Service Adapter (Arrakis Side)

```typescript
// packages/adapters/score/ScoreServiceAdapter.ts
// 
// This adapter implements IChainProvider by calling Score API
// Arrakis no longer needs viem, RPC URLs, or blockchain knowledge

import { IChainProvider } from '@arrakis/core/ports';

class ScoreServiceAdapter implements IChainProvider {
  private apiClient: ScoreAPIClient;
  private cache: Redis;
  
  constructor(config: ScoreServiceConfig) {
    this.apiClient = new ScoreAPIClient({
      baseUrl: config.scoreApiUrl,
      apiKey: config.scoreApiKey,
      timeout: 30000
    });
    this.cache = new Redis(config.redisUrl);
  }
  
  async getBalance(address: string, asset: Asset): Promise<bigint> {
    const cacheKey = `balance:${asset.chain}:${address}:${asset.address}`;
    
    // Check cache first (Score handles blockchain polling)
    const cached = await this.cache.get(cacheKey);
    if (cached) return BigInt(cached);
    
    // Call Score API
    const response = await this.apiClient.getBalance({
      chain: asset.chain,
      address,
      asset: { address: asset.address, type: asset.type }
    });
    
    // Cache for 5 minutes (Score maintains fresher data)
    await this.cache.setex(cacheKey, 300, response.balance);
    
    return BigInt(response.balance);
  }
  
  async getRankedHolders(asset: Asset, limit: number): Promise<Holder[]> {
    const response = await this.apiClient.getRankedHolders({
      chain: asset.chain,
      asset: { address: asset.address, type: asset.type },
      limit
    });
    
    return response.holders.map(h => ({
      address: h.address,
      balance: BigInt(h.balance),
      rank: h.rank
    }));
  }
  
  async checkNeverRedeemed(address: string, asset: Asset): Promise<boolean> {
    const response = await this.apiClient.checkActionHistory({
      chain: asset.chain,
      address,
      actionType: 'redeem',
      asset: { address: asset.address, type: asset.type }
    });
    
    return !response.hasPerformedAction;
  }
}
```

### 3.4 Migration: Removing Direct Blockchain Code

```
BEFORE (v3.0 - Direct viem coupling):
──────────────────────────────────────
sietch-service/
├── src/services/
│   ├── chain.ts           # Direct viem calls, RPC management
│   ├── eligibility.ts     # Dune Analytics queries inline
│   └── ...
├── .env
│   ├── BERACHAIN_RPC_URL  # RPC endpoint management
│   ├── DUNE_API_KEY       # Dune credentials in app
│   └── BGT_CONTRACT_ADDR  # Hardcoded contract addresses

AFTER (v5.0 - Score Service):
─────────────────────────────
arrakis/
├── packages/adapters/score/
│   └── ScoreServiceAdapter.ts    # Single adapter, no blockchain code
├── .env
│   ├── SCORE_API_URL             # Just the Score service URL
│   └── SCORE_API_KEY             # API key for Score

score-service/ (separate repo, closed-source)
├── src/indexers/
│   ├── berachain/
│   ├── ethereum/
│   └── ...
├── src/api/
│   └── routes/
└── .env
    ├── BERACHAIN_RPC_URL         # All RPC config lives here
    ├── DUNE_API_KEY              # All external API keys here
    └── ...
```

### 3.5 Benefits of Score Service Extraction

| Benefit | Description |
|---------|-------------|
| **Decoupling** | Arrakis is now chain-agnostic; adding new chains = Score update only |
| **Caching** | Score handles blockchain indexing, caching, and polling centrally |
| **Security** | RPC URLs, Dune keys, contract addresses isolated from Arrakis |
| **Scaling** | Score can scale independently; multiple Arrakis instances share one Score |
| **Monetization** | Score API access can be tiered/metered separately |
| **Audit Surface** | Arrakis audit scope reduced; blockchain security concentrated in Score |

### 3.6 FAANG Hardening: Circuit Breaker & Fallback (v5.4)

> 🆕 **13th Audit Finding**: Score Service as SPOF (Single Point of Failure). If Score API experiences latency or outage, Arrakis becomes "a brick."

> ✅ **Resolution**: Implement Circuit Breaker pattern with cached fallback.

```typescript
// packages/adapters/score/ResilientScoreAdapter.ts
//
// FAANG-tier Score Service adapter with Circuit Breaker and Fallback

import CircuitBreaker from 'opossum';

class ResilientScoreAdapter implements IChainProvider {
  private scoreClient: ScoreAPIClient;
  private cache: Redis;
  private breaker: CircuitBreaker;
  
  constructor(config: ScoreServiceConfig) {
    this.scoreClient = new ScoreAPIClient(config);
    this.cache = new Redis(config.redisUrl);
    
    // Circuit Breaker configuration
    this.breaker = new CircuitBreaker(
      (params) => this.scoreClient.call(params),
      {
        timeout: 10000,           // 10s timeout
        errorThresholdPercentage: 50,  // Open after 50% failures
        resetTimeout: 30000,      // Try again after 30s
        volumeThreshold: 10       // Minimum 10 requests before tripping
      }
    );
    
    // Fallback to cache when circuit is open
    this.breaker.fallback(async (params) => {
      console.warn('[Score] Circuit OPEN - using cached data');
      return this.getCachedFallback(params);
    });
    
    // Metrics for observability
    this.breaker.on('open', () => this.metrics.increment('score.circuit.open'));
    this.breaker.on('halfOpen', () => this.metrics.increment('score.circuit.halfOpen'));
    this.breaker.on('close', () => this.metrics.increment('score.circuit.close'));
  }
  
  async getBalance(address: string, asset: Asset): Promise<bigint> {
    const cacheKey = `balance:${asset.chain}:${address}:${asset.address}`;
    
    try {
      // Try Score API via circuit breaker
      const response = await this.breaker.fire({
        method: 'getBalance',
        params: { chain: asset.chain, address, asset }
      });
      
      // Cache successful response for fallback
      await this.cache.setex(cacheKey, 3600, response.balance); // 1hr cache
      return BigInt(response.balance);
      
    } catch (error) {
      // Circuit breaker fallback already triggered if available
      throw new ScoreServiceUnavailableError(error);
    }
  }
  
  private async getCachedFallback(params: any): Promise<any> {
    const cacheKey = this.buildCacheKey(params);
    const cached = await this.cache.get(cacheKey);
    
    if (!cached) {
      throw new NoFallbackAvailableError(
        'Score Service unavailable and no cached data exists'
      );
    }
    
    return { balance: cached, fromCache: true, staleAfter: '1h' };
  }
}
```

```
┌─────────────────────────────────────────────────────────────────────┐
│                    SCORE SERVICE RESILIENCE                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   Arrakis ──► Circuit Breaker ──► Score API                        │
│                    │                   │                            │
│                    │ (if open)         │ (if healthy)               │
│                    ▼                   ▼                            │
│              Redis Cache          Live Response                     │
│           (stale but safe)       (fresh data)                       │
│                                                                     │
│   States:                                                           │
│   • CLOSED: Normal operation, requests go to Score                  │
│   • OPEN: Score failing, all requests use cache                     │
│   • HALF-OPEN: Testing if Score recovered                           │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

> 📊 **Graceful Degradation Modes**:
> 
> | Score Status | Eligibility Checks | Tier Updates | User Experience |
> |--------------|-------------------|--------------|-----------------|
> | **Healthy** | Real-time | Immediate | Full functionality |
> | **Degraded** | Cached (1hr stale) | Delayed | "Data may be delayed" banner |
> | **Outage** | Last known state | Suspended | "Maintenance mode" |

### 3.7 Two-Tier Chain Provider Architecture (v5.5)

> 🆕 **14th Audit Finding**: Score Service as SPOF means if Score is down, Arrakis is "a brick." Circuit Breaker with cached fallback only provides stale data.

> ✅ **Resolution: Two-Tier Chain Provider** — Native Reader handles binary checks (real-time), Score handles complex queries. If Score fails, basic eligibility still works.

```typescript
// ═══════════════════════════════════════════════════════════════════════════
// TWO-TIER CHAIN PROVIDER (v5.5 - 14th Audit)
// ═══════════════════════════════════════════════════════════════════════════
//
// TIER 1: Native Reader (Simple, Resilient)
//   - Binary checks: "Does address hold token X?" "Does address own NFT Y?"
//   - Direct viem calls to RPC (minimal, focused)
//   - Always available (no Score dependency)
//   - Handles: Token gating, NFT ownership, basic balance checks
//
// TIER 2: Score Service (Complex, Feature-rich)
//   - Ranking: "What rank is this address among all holders?"
//   - History: "Has this address ever redeemed BGT?"
//   - Cross-chain: Aggregate balances across multiple chains
//   - Analytics: Activity scores, lineage queries
//
// DEGRADATION: If Score is down, Tier 1 still provides core functionality

interface INativeReader {
  // Binary checks - ALWAYS available
  hasBalance(address: string, token: string, minAmount: bigint): Promise<boolean>;
  ownsNFT(address: string, collection: string, tokenId?: string): Promise<boolean>;
  getBalance(address: string, token: string): Promise<bigint>;
}

interface IScoreService {
  // Complex queries - MAY be unavailable
  getRankedHolders(asset: Asset, limit: number): Promise<RankedHolder[]>;
  getAddressRank(address: string, asset: Asset): Promise<number | null>;
  checkActionHistory(address: string, action: string): Promise<boolean>;
  getActivityScore(address: string): Promise<number>;
}

class TwoTierChainProvider implements IChainProvider {
  private nativeReader: INativeReader;      // Tier 1: Always available
  private scoreService: IScoreService;      // Tier 2: May fail
  private scoreBreaker: CircuitBreaker;
  private cache: Redis;
  
  constructor(config: ChainProviderConfig) {
    // Tier 1: Lightweight viem client for binary checks
    this.nativeReader = new NativeBlockchainReader({
      rpcUrl: config.rpcUrl,  // Single RPC for basic checks
      timeout: 5000
    });
    
    // Tier 2: Score Service with Circuit Breaker
    this.scoreService = new ScoreServiceClient(config.scoreApiUrl);
    this.scoreBreaker = new CircuitBreaker(this.scoreService, {
      errorThresholdPercentage: 50,
      resetTimeout: 30000
    });
  }
  
  // ═══════════════════════════════════════════════════════════════════════
  // TIER 1: Binary Eligibility (ALWAYS WORKS)
  // ═══════════════════════════════════════════════════════════════════════
  
  async checkBasicEligibility(
    address: string, 
    criteria: BasicCriteria
  ): Promise<EligibilityResult> {
    // This NEVER fails (unless blockchain itself is down)
    // Used for: Token gating, NFT access, minimum balance checks
    
    if (criteria.type === 'TOKEN_BALANCE') {
      const hasBalance = await this.nativeReader.hasBalance(
        address, 
        criteria.tokenAddress, 
        criteria.minAmount
      );
      return { eligible: hasBalance, source: 'native' };
    }
    
    if (criteria.type === 'NFT_OWNERSHIP') {
      const ownsNFT = await this.nativeReader.ownsNFT(
        address,
        criteria.collectionAddress,
        criteria.tokenId
      );
      return { eligible: ownsNFT, source: 'native' };
    }
    
    throw new Error(`Unknown basic criteria type: ${criteria.type}`);
  }
  
  // ═══════════════════════════════════════════════════════════════════════
  // TIER 2: Complex Queries (GRACEFUL DEGRADATION)
  // ═══════════════════════════════════════════════════════════════════════
  
  async checkAdvancedEligibility(
    address: string,
    criteria: AdvancedCriteria
  ): Promise<EligibilityResult> {
    // Try Score Service first
    try {
      const result = await this.scoreBreaker.fire(async () => {
        if (criteria.type === 'RANK_THRESHOLD') {
          const rank = await this.scoreService.getAddressRank(address, criteria.asset);
          return { eligible: rank !== null && rank <= criteria.maxRank, source: 'score' };
        }
        
        if (criteria.type === 'NEVER_REDEEMED') {
          const hasRedeemed = await this.scoreService.checkActionHistory(
            address, 'redeem_bgt'
          );
          return { eligible: !hasRedeemed, source: 'score' };
        }
        
        // ... other complex criteria
      });
      
      // Cache successful result for fallback
      await this.cache.setex(`eligibility:${address}:${criteria.id}`, 3600, result);
      return result;
      
    } catch (error) {
      // Score Service unavailable - check if we can degrade
      console.warn('[ChainProvider] Score unavailable, attempting degradation');
      
      return this.degradedEligibility(address, criteria);
    }
  }
  
  private async degradedEligibility(
    address: string,
    criteria: AdvancedCriteria
  ): Promise<EligibilityResult> {
    // DEGRADATION STRATEGY:
    // 1. For RANK_THRESHOLD: Fall back to binary balance check (less precise)
    // 2. For NEVER_REDEEMED: Use cached result or deny (safe default)
    
    if (criteria.type === 'RANK_THRESHOLD') {
      // Can't compute rank without Score, but CAN check if they hold ANY tokens
      // This is less precise but keeps core functionality working
      const balance = await this.nativeReader.getBalance(address, criteria.asset.address);
      const hasAnyBalance = balance > 0n;
      
      return {
        eligible: hasAnyBalance,  // Permissive fallback
        source: 'native_degraded',
        warning: 'Rank verification unavailable; using balance-only check'
      };
    }
    
    if (criteria.type === 'NEVER_REDEEMED') {
      // Check cache for last known state
      const cached = await this.cache.get(`eligibility:${address}:${criteria.id}`);
      if (cached) {
        return { ...cached, source: 'cached', stale: true };
      }
      
      // Safe default: deny access when we can't verify
      return {
        eligible: false,
        source: 'unavailable',
        warning: 'History verification unavailable; access denied for safety'
      };
    }
    
    throw new DegradedModeUnsupportedError(criteria.type);
  }
}
```

```
┌─────────────────────────────────────────────────────────────────────┐
│                 TWO-TIER CHAIN PROVIDER                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   TIER 1: Native Reader (Always Available)                          │
│   ┌──────────────────────────────────────────────────────────────┐ │
│   │  • hasBalance(address, token, minAmount) → boolean           │ │
│   │  • ownsNFT(address, collection) → boolean                    │ │
│   │  • getBalance(address, token) → bigint                       │ │
│   │                                                              │ │
│   │  Implementation: Direct viem RPC calls                       │ │
│   │  Dependency: Single RPC endpoint only                        │ │
│   │  Failure mode: Only fails if blockchain is down              │ │
│   └──────────────────────────────────────────────────────────────┘ │
│                           │                                         │
│                           ▼                                         │
│   TIER 2: Score Service (Complex Queries)                           │
│   ┌──────────────────────────────────────────────────────────────┐ │
│   │  • getRankedHolders(asset, limit) → RankedHolder[]           │ │
│   │  • getAddressRank(address, asset) → number                   │ │
│   │  • checkActionHistory(address, action) → boolean             │ │
│   │  • getActivityScore(address) → number                        │ │
│   │                                                              │ │
│   │  Implementation: Score API + Circuit Breaker                 │ │
│   │  Dependency: Score Service availability                      │ │
│   │  Failure mode: Degrades to Tier 1 + cached data              │ │
│   └──────────────────────────────────────────────────────────────┘ │
│                                                                     │
│   DEGRADATION MATRIX:                                               │
│   ┌────────────────────┬──────────────┬──────────────────────────┐ │
│   │ Query Type         │ Score DOWN   │ Fallback Behavior        │ │
│   ├────────────────────┼──────────────┼──────────────────────────┤ │
│   │ Token Balance      │ ✅ Works     │ Native Reader            │ │
│   │ NFT Ownership      │ ✅ Works     │ Native Reader            │ │
│   │ Rank Threshold     │ ⚠️ Degraded  │ Balance check (permissive)│ │
│   │ Never Redeemed     │ ⚠️ Degraded  │ Cached or deny (safe)    │ │
│   │ Activity Score     │ ❌ Unavail.  │ Return 0 or cached       │ │
│   │ Cross-chain Agg.   │ ❌ Unavail.  │ Single-chain only        │ │
│   └────────────────────┴──────────────┴──────────────────────────┘ │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

> 📊 **Resilience Comparison**:
> 
> | Architecture | Score Outage Impact | User Experience |
> |--------------|---------------------|-----------------|
> | **v5.3 (Score-only)** | Complete failure | "Bot is down" |
> | **v5.4 (Circuit Breaker)** | Stale cached data | "Data may be outdated" |
> | **v5.5 (Two-Tier)** | Basic features work | "Advanced features unavailable" |

> 🎯 **Key Insight**: Most token-gating use cases only need **binary checks** (do you hold the token?). Ranking and history are "nice to have" features. Two-Tier ensures core functionality survives Score outages.

---

## 4. Themes System: Injectable Progression Configurations

> ✅ **Key Architectural Decision**: The Berachain BGT "game" (9-tier progression, Dune naming, specific badges) is abstracted into **Themes**—injectable configurations that customize community progression without code changes. This makes the base platform generic and chain-agnostic.

### 4.1 Theme Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                      ARRAKIS SAAS PLATFORM                          │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    THEME ENGINE                              │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │   │
│  │  │  Tier       │  │  Badge      │  │  Naming/Branding    │  │   │
│  │  │  Evaluator  │  │  Evaluator  │  │  Resolver           │  │   │
│  │  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘  │   │
│  │         │                │                    │              │   │
│  │         └────────────────┴────────────────────┘              │   │
│  │                          │                                   │   │
│  │              ┌───────────┴───────────┐                      │   │
│  │              │    IThemeProvider     │                      │   │
│  │              │      (Interface)      │                      │   │
│  │              └───────────┬───────────┘                      │   │
│  └──────────────────────────┼──────────────────────────────────┘   │
│                             │                                       │
│     ┌───────────────────────┼───────────────────────┐              │
│     │                       │                       │              │
│     ▼                       ▼                       ▼              │
│ ┌─────────┐          ┌─────────────┐         ┌─────────────┐      │
│ │ BASIC   │          │   SIETCH    │         │  CUSTOM     │      │
│ │ (Free)  │          │  (Premium)  │         │ (Enterprise)│      │
│ └─────────┘          └─────────────┘         └─────────────┘      │
└─────────────────────────────────────────────────────────────────────┘
```

### 4.2 Theme Interface Definition

```typescript
// packages/core/ports/IThemeProvider.ts
//
// Themes define the "game" mechanics for a community:
// - How many tiers exist and what they're called
// - What badges are available and how they're earned
// - Naming conventions and branding
// - Channel structure templates

interface IThemeProvider {
  // Theme metadata
  readonly themeId: string;
  readonly themeName: string;
  readonly tier: 'free' | 'premium' | 'enterprise';
  
  // Tier configuration
  getTierConfig(): TierConfig;
  evaluateTier(rank: number, totalHolders: number): TierResult;
  
  // Badge configuration  
  getBadgeConfig(): BadgeConfig;
  evaluateBadges(member: MemberContext): EarnedBadge[];
  
  // Naming/branding
  getNamingConfig(): NamingConfig;
  resolveDisplayName(tier: string): string;
  resolveChannelName(channelType: string): string;
  
  // Channel structure template
  getChannelTemplate(): ChannelTemplate;
  
  // Eligibility rules (what makes someone eligible)
  getEligibilityConfig(): EligibilityConfig;
}

// ═══════════════════════════════════════════════════════════════════
// TIER CONFIGURATION
// ═══════════════════════════════════════════════════════════════════

interface TierConfig {
  tiers: TierDefinition[];
  rankingStrategy: 'absolute' | 'percentage' | 'threshold';
  demotionGracePeriod?: number;  // Hours before demotion takes effect
}

interface TierDefinition {
  id: string;
  name: string;
  displayName: string;        // Themed name (e.g., "Naib" vs "Tier 1")
  minRank?: number;           // For absolute ranking
  maxRank?: number;
  minPercentile?: number;     // For percentage-based
  maxPercentile?: number;
  minBalance?: string;        // For threshold-based
  roleColor: string;          // Discord role color
  permissions: string[];      // Discord permissions
  channels: string[];         // Accessible channel IDs
}

// ═══════════════════════════════════════════════════════════════════
// BADGE CONFIGURATION
// ═══════════════════════════════════════════════════════════════════

interface BadgeConfig {
  badges: BadgeDefinition[];
  categories: BadgeCategory[];
}

interface BadgeDefinition {
  id: string;
  name: string;
  displayName: string;        // Themed name
  description: string;
  emoji: string;
  category: 'tenure' | 'achievement' | 'activity' | 'special';
  criteria: BadgeCriteria;
  tier: 'free' | 'premium';   // Which theme tier includes this badge
}

interface BadgeCriteria {
  type: 'tenure' | 'tier_reached' | 'activity_score' | 'streak' | 'custom';
  threshold?: number;
  tierRequired?: string;
  customEvaluator?: string;   // Reference to custom evaluation function
}

// ═══════════════════════════════════════════════════════════════════
// NAMING/BRANDING CONFIGURATION
// ═══════════════════════════════════════════════════════════════════

interface NamingConfig {
  serverNameTemplate: string;   // e.g., "Sietch {community}"
  categoryNames: Record<string, string>;
  channelNameTemplates: Record<string, string>;
  roleNameTemplates: Record<string, string>;
  terminology: Record<string, string>;  // e.g., { "member": "Fremen" }
}

// ═══════════════════════════════════════════════════════════════════
// CHANNEL TEMPLATE
// ═══════════════════════════════════════════════════════════════════

interface ChannelTemplate {
  categories: CategoryTemplate[];
}

interface CategoryTemplate {
  id: string;
  name: string;               // Uses naming config
  channels: ChannelDefinition[];
  tierRestriction?: string;   // Which tier(s) can access
}
```

### 4.3 Built-in Themes

#### Basic Theme (Free Tier)

```typescript
// packages/themes/basic/BasicTheme.ts
//
// Simple, generic theme included with all accounts
// 3 tiers, 5 basic badges, neutral naming

const BasicTheme: IThemeProvider = {
  themeId: 'basic',
  themeName: 'Basic',
  tier: 'free',
  
  getTierConfig: () => ({
    tiers: [
      { id: 'gold', name: 'gold', displayName: 'Gold', minRank: 1, maxRank: 10, roleColor: '#FFD700' },
      { id: 'silver', name: 'silver', displayName: 'Silver', minRank: 11, maxRank: 50, roleColor: '#C0C0C0' },
      { id: 'bronze', name: 'bronze', displayName: 'Bronze', minRank: 51, maxRank: 100, roleColor: '#CD7F32' },
    ],
    rankingStrategy: 'absolute'
  }),
  
  getBadgeConfig: () => ({
    categories: ['tenure', 'achievement', 'activity'],
    badges: [
      { id: 'early_adopter', displayName: 'Early Adopter', category: 'tenure', criteria: { type: 'tenure', threshold: 30 } },
      { id: 'veteran', displayName: 'Veteran', category: 'tenure', criteria: { type: 'tenure', threshold: 90 } },
      { id: 'top_tier', displayName: 'Top Tier', category: 'achievement', criteria: { type: 'tier_reached', tierRequired: 'gold' } },
      { id: 'active', displayName: 'Active', category: 'activity', criteria: { type: 'activity_score', threshold: 100 } },
      { id: 'contributor', displayName: 'Contributor', category: 'activity', criteria: { type: 'activity_score', threshold: 500 } },
    ]
  }),
  
  getNamingConfig: () => ({
    serverNameTemplate: '{community} Token Community',
    categoryNames: {
      info: 'Information',
      general: 'General',
      premium: 'Premium'
    },
    channelNameTemplates: {
      rules: 'rules',
      announcements: 'announcements',
      general: 'general-chat',
      premium: 'holders-only'
    },
    terminology: {
      member: 'Member',
      holder: 'Holder'
    }
  }),
  
  getChannelTemplate: () => ({
    categories: [
      {
        id: 'info',
        name: 'Information',
        channels: [
          { name: 'rules', type: 'text', readonly: true },
          { name: 'announcements', type: 'text', readonly: true }
        ]
      },
      {
        id: 'general',
        name: 'General',
        channels: [
          { name: 'general-chat', type: 'text' },
          { name: 'introductions', type: 'text' }
        ]
      }
    ]
  })
};
```

#### Sietch Theme (Premium Tier — Dune-Inspired)

```typescript
// packages/themes/sietch/SietchTheme.ts
//
// The original Arrakis/Sietch theme with Dune naming and 9-tier progression
// Premium feature - requires upgraded subscription

const SietchTheme: IThemeProvider = {
  themeId: 'sietch',
  themeName: 'Sietch (Dune)',
  tier: 'premium',
  
  getTierConfig: () => ({
    tiers: [
      { id: 'naib', name: 'naib', displayName: 'Naib', minRank: 1, maxRank: 7, roleColor: '#FFD700', permissions: ['MANAGE_CHANNELS'] },
      { id: 'fedaykin_elite', name: 'fedaykin_elite', displayName: 'Fedaykin Elite', minRank: 8, maxRank: 15, roleColor: '#E6BE8A' },
      { id: 'fedaykin', name: 'fedaykin', displayName: 'Fedaykin', minRank: 16, maxRank: 30, roleColor: '#C4A35A' },
      { id: 'fremen', name: 'fremen', displayName: 'Fremen', minRank: 31, maxRank: 45, roleColor: '#A67C52' },
      { id: 'wanderer', name: 'wanderer', displayName: 'Wanderer', minRank: 46, maxRank: 55, roleColor: '#8B7355' },
      { id: 'initiate', name: 'initiate', displayName: 'Initiate', minRank: 56, maxRank: 62, roleColor: '#6B5344' },
      { id: 'aspirant', name: 'aspirant', displayName: 'Aspirant', minRank: 63, maxRank: 66, roleColor: '#5D4E37' },
      { id: 'observer', name: 'observer', displayName: 'Observer', minRank: 67, maxRank: 69, roleColor: '#4A3728' },
      { id: 'outsider', name: 'outsider', displayName: 'Outsider', minRank: 70, maxRank: null, roleColor: '#333333' },
    ],
    rankingStrategy: 'absolute',
    demotionGracePeriod: 24
  }),
  
  getBadgeConfig: () => ({
    categories: ['tenure', 'achievement', 'activity', 'special'],
    badges: [
      // Tenure badges
      { id: 'first_wave', displayName: 'First Wave', emoji: '🌊', category: 'tenure', criteria: { type: 'tenure', threshold: 30 } },
      { id: 'veteran', displayName: 'Veteran', emoji: '⚔️', category: 'tenure', criteria: { type: 'tenure', threshold: 90 } },
      { id: 'diamond_hands', displayName: 'Diamond Hands', emoji: '💎', category: 'tenure', criteria: { type: 'tenure', threshold: 180 } },
      
      // Achievement badges
      { id: 'council', displayName: 'Council', emoji: '👑', category: 'achievement', criteria: { type: 'tier_reached', tierRequired: 'naib' } },
      { id: 'survivor', displayName: 'Survivor', emoji: '🔥', category: 'achievement', criteria: { type: 'custom', customEvaluator: 'survivorCheck' } },
      { id: 'streak_master', displayName: 'Streak Master', emoji: '📈', category: 'achievement', criteria: { type: 'streak', threshold: 30 } },
      
      // Activity badges
      { id: 'engaged', displayName: 'Engaged', emoji: '💬', category: 'activity', criteria: { type: 'activity_score', threshold: 100 } },
      { id: 'contributor', displayName: 'Contributor', emoji: '🤝', category: 'activity', criteria: { type: 'activity_score', threshold: 500 } },
      { id: 'pillar', displayName: 'Pillar', emoji: '🏛️', category: 'activity', criteria: { type: 'activity_score', threshold: 1000 } },
      
      // Special badges (Sietch-specific)
      { id: 'water_sharer', displayName: 'Water Sharer', emoji: '💧', category: 'special', criteria: { type: 'custom', customEvaluator: 'waterSharerLineage' } },
    ]
  }),
  
  getNamingConfig: () => ({
    serverNameTemplate: 'Sietch {community}',
    categoryNames: {
      info: 'STILLSUIT',
      council: 'NAIB COUNCIL',
      general: 'SIETCH-COMMONS',
      operations: 'WINDTRAP'
    },
    channelNameTemplates: {
      rules: 'water-discipline',
      leaderboard: 'census',
      joinLog: 'the-door',
      council: 'council-rock',
      general: 'general',
      alpha: 'spice',
      ideas: 'water-shares',
      support: 'support'
    },
    terminology: {
      member: 'Fremen',
      holder: 'Water Bearer',
      admin: 'Naib',
      moderator: 'Fedaykin'
    }
  }),
  
  getChannelTemplate: () => ({
    categories: [
      {
        id: 'stillsuit',
        name: 'STILLSUIT',
        channels: [
          { name: 'water-discipline', type: 'text', readonly: true },
          { name: 'census', type: 'text', readonly: true },
          { name: 'the-door', type: 'text', readonly: true }
        ]
      },
      {
        id: 'council',
        name: 'NAIB COUNCIL',
        tierRestriction: 'naib',
        channels: [
          { name: 'council-rock', type: 'text' }
        ]
      },
      {
        id: 'commons',
        name: 'SIETCH-COMMONS',
        channels: [
          { name: 'general', type: 'text' },
          { name: 'spice', type: 'text' },
          { name: 'water-shares', type: 'text' }
        ]
      },
      {
        id: 'windtrap',
        name: 'WINDTRAP',
        channels: [
          { name: 'support', type: 'text' }
        ]
      }
    ]
  })
};
```

### 4.4 Theme Selection & Configuration

```typescript
// Theme selection during community onboarding
interface CommunityConfig {
  communityId: string;
  themeId: string;              // 'basic' | 'sietch' | 'custom-xxx'
  themeOverrides?: ThemeOverrides;  // Optional customizations
  subscription: SubscriptionTier;
}

interface ThemeOverrides {
  // Override specific tier names
  tierNameOverrides?: Record<string, string>;
  
  // Override channel names
  channelNameOverrides?: Record<string, string>;
  
  // Add custom badges (enterprise only)
  customBadges?: BadgeDefinition[];
  
  // Custom eligibility rules
  eligibilityOverrides?: Partial<EligibilityConfig>;
}

// Theme registry
class ThemeRegistry {
  private themes: Map<string, IThemeProvider> = new Map();
  
  constructor() {
    // Register built-in themes
    this.register(BasicTheme);
    this.register(SietchTheme);
  }
  
  register(theme: IThemeProvider): void {
    this.themes.set(theme.themeId, theme);
  }
  
  get(themeId: string): IThemeProvider {
    const theme = this.themes.get(themeId);
    if (!theme) throw new Error(`Theme not found: ${themeId}`);
    return theme;
  }
  
  getAvailableThemes(subscriptionTier: SubscriptionTier): IThemeProvider[] {
    return Array.from(this.themes.values()).filter(theme => {
      if (theme.tier === 'free') return true;
      if (theme.tier === 'premium') return subscriptionTier >= 'pro';
      if (theme.tier === 'enterprise') return subscriptionTier === 'enterprise';
      return false;
    });
  }
}
```

### 4.5 Theme-Aware Services

```typescript
// Services use theme configuration instead of hardcoded values
class TierEvaluator {
  constructor(private theme: IThemeProvider) {}
  
  evaluate(rank: number, totalHolders: number): TierResult {
    const config = this.theme.getTierConfig();
    return this.theme.evaluateTier(rank, totalHolders);
  }
}

class BadgeEvaluator {
  constructor(private theme: IThemeProvider) {}
  
  evaluate(member: MemberContext): EarnedBadge[] {
    return this.theme.evaluateBadges(member);
  }
}

class ChannelSynthesizer {
  constructor(private theme: IThemeProvider) {}
  
  generateManifest(community: Community): ChannelManifest {
    const template = this.theme.getChannelTemplate();
    const naming = this.theme.getNamingConfig();
    
    // Apply naming conventions to template
    return this.applyNaming(template, naming, community);
  }
}
```

### 4.6 Theme Subscription Tiers

| Feature | Free (Basic) | Pro (Premium Themes) | Enterprise |
|---------|--------------|---------------------|------------|
| **Themes Available** | Basic only | Basic + Premium (Sietch, etc.) | All + Custom |
| **Tiers** | 3 tiers | Up to 9 tiers | Unlimited |
| **Badges** | 5 basic | 10+ themed | Unlimited custom |
| **Naming** | Generic | Themed (Dune, etc.) | Fully custom |
| **Channel Templates** | Standard | Themed templates | Custom templates |
| **Theme Customization** | None | Name overrides | Full override + custom code |

---

## 5. Hexagonal Architecture Design

The refactoring adopts Hexagonal Architecture (Ports and Adapters) to ensure core business logic is isolated from external systems. With the Score Service extraction, Arrakis is now **chain-agnostic**—all blockchain data flows through the Score API.

### 5.1 Three-Layer Model (Updated for Score + Themes)

| Layer | Responsibility | Components |
|-------|---------------|------------|
| **Domain** | Pure business logic, zero external dependencies | Asset, Community, Role, Eligibility entities |
| **Service** | Orchestration, workflows, use case coordination | WizardEngine, OnboardingFlow, SyncService, **ThemeEngine** |
| **Infrastructure** | External integrations via adapters | **ScoreServiceAdapter**, DiscordAdapter, TGRAdapter |

### 5.2 Ports (Interfaces)

```typescript
// Core Domain Ports - Note: IChainProvider now implemented by ScoreServiceAdapter
interface IChainProvider {
  getBalance(address: string, asset: Asset): Promise<bigint>;
  getHolders(asset: Asset, limit: number): Promise<Holder[]>;
  getRank(address: string, asset: Asset): Promise<number | null>;
  checkActionHistory(address: string, actionType: string): Promise<boolean>;
}

interface IThemeProvider {
  getTierConfig(): TierConfig;
  getBadgeConfig(): BadgeConfig;
  evaluateTier(rank: number): TierResult;
  evaluateBadges(member: MemberContext): EarnedBadge[];
}

interface IPlatformProvider {
  sendMessage(channel: string, content: Message): Promise<void>;
  createChannel(config: ChannelConfig): Promise<Channel>;
  assignRole(userId: string, role: Role): Promise<void>;
}
```

### 5.3 Adapters (Updated)

| Adapter | Implements | Description |
|---------|------------|-------------|
| **ScoreServiceAdapter** | IChainProvider | Calls Score API for all blockchain data (replaces viem) |
| **BasicThemeAdapter** | IThemeProvider | Generic 3-tier progression (free) |
| **SietchThemeAdapter** | IThemeProvider | Dune-themed 9-tier progression (premium) |
| **DiscordPlatformAdapter** | IPlatformProvider | Discord server management |
| **TelegramPlatformAdapter** | IPlatformProvider | Telegram group management |
| **CollabLandTGRAdapter** | ITGRProvider | Token gating rules via Collab.Land |

---

## 6. Domain Layer Design

The Domain Layer contains pure business logic with zero dependencies on external systems. All entities are framework-agnostic and blockchain-neutral, using abstract types that adapters convert to/from specific implementations.

### 6.1 Core Entities

#### Asset Entity

The Asset entity abstracts blockchain-specific tokens into a unified model. This enables the same eligibility logic to work across EVM tokens, Solana SPL tokens, or NFT collections.

```typescript
interface Asset {
  id: string;                    // Unique identifier
  type: 'FUNGIBLE' | 'NFT' | 'SBT';
  chain: ChainIdentifier;        // Abstract chain reference
  address: string;               // Contract/mint address
  decimals?: number;             // For fungible tokens
  metadata?: AssetMetadata;      // Name, symbol, image
}
```

#### Community Entity

Communities represent the logical grouping of members, roles, and eligibility rules—independent of any specific platform. **Now includes theme reference.**

```typescript
interface Community {
  id: string;
  name: string;
  themeId: string;                // Reference to selected theme
  eligibilityCriteria: EligibilityCriteria[];
  roles: RoleDefinition[];
  channels: ChannelDefinition[];
  platforms: PlatformBinding[];   // Discord, Telegram bindings
  manifest: CommunityManifest;    // Synthesized config
}
```

### 6.2 Eligibility Criteria DSL

A domain-specific language for expressing eligibility rules that can be serialised to the Onboarding-as-Code manifest and evaluated at runtime.

```typescript
interface EligibilityCriteria {
  type: 'TOKEN_BALANCE' | 'NFT_OWNERSHIP' | 'DUNE_QUERY' | 'COMPOSITE';
  asset?: Asset;
  threshold?: bigint;             // Minimum balance
  rank?: { min: number; max: number }; // Top N holders
  duneQueryId?: string;           // External data source
  operator?: 'AND' | 'OR';        // For composite rules
  children?: EligibilityCriteria[]; // Nested rules
}
```

---

## 5. WizardEngine: Self-Service Onboarding

The WizardEngine manages state-driven onboarding flows through Discord Modals and Interactions. This "Wizard" provides a step-by-step automated guide, similar to a merchant setting up a shop with various themes on Shopify—users configure their community without touching code.

### 5.1 State Machine Architecture

The wizard operates as a finite state machine, persisting progress between interactions and handling timeout/resumption gracefully.

```typescript
enum WizardState {
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
```

### 5.2 Wizard Flow Steps

| Step | User Action | System Output |
|------|-------------|---------------|
| **1. Init** | /onboard command invoked | Welcome modal with community name input |
| **2. Chain** | Select blockchain(s) from dropdown | Chain adapter instantiation |
| **3. Asset** | Enter contract address, verify metadata | Asset entity creation with on-chain validation |
| **4. Rules** | Configure thresholds, ranks, composites | EligibilityCriteria DSL construction |
| **5. Roles** | Define role tiers, names, permissions | RoleDefinition array with eligibility bindings |
| **6. Channels** | Select template or customise structure | ChannelDefinition tree generation |
| **7. Review** | Preview manifest, make adjustments | Full CommunityManifest YAML preview |
| **8. Deploy** | Confirm deployment | Synthesise server structure, register TGRs |

### 5.3 Discord API Constraints

> ⚠️ **Audit Finding**: Claude's original WizardEngine oversimplified Discord's interaction model.

The Wizard must accommodate these hard Discord.js constraints:

| Constraint | Limit | Mitigation |
|------------|-------|------------|
| **Initial Response** | 3 seconds | Must `deferReply()` immediately, then `editReply()` |
| **Followup Window** | 15 minutes | Store state in Redis; allow `/resume` command |
| **Modal Timeout** | 5 minutes | Break complex steps into multiple modals |
| **Rate Limits** | 50 requests/second | Queue channel/role creation with exponential backoff |
| **Channel Creation** | 10/min soft limit | Token-bucket queue for synthesis operations |

> ⚠️ **Audit Finding (v2)**: Programmatically creating 10+ channels and roles during a single "synthesis" event will trigger 429 errors. The synthesis engine must include a token-bucket queue.

```typescript
// Token-bucket rate limiter for Discord API operations
class DiscordRateLimiter {
  private bucket: number = 10;       // Max tokens
  private tokens: number = 10;       // Current tokens
  private refillRate: number = 1;    // Tokens per second
  private lastRefill: number = Date.now();
  private queue: Array<() => Promise<void>> = [];

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    await this.waitForToken();
    return operation();
  }

  private async waitForToken(): Promise<void> {
    this.refill();
    if (this.tokens > 0) {
      this.tokens--;
      return;
    }
    // Wait and retry
    await new Promise(resolve => setTimeout(resolve, 1000));
    return this.waitForToken();
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.bucket, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }
}

// ❌ BAD: Synchronous synthesis will DOS the SaaS with Global 429 errors
// when 100 concurrent onboardings each create 10 channels + 5 roles.

// ✅ GOOD: BullMQ distributed task queue for async synthesis
import { Queue, Worker } from 'bullmq';

const synthesisQueue = new Queue('discord-synthesis', {
  connection: { host: 'redis', port: 6379 }
});

// Producer: Wizard enqueues synthesis tasks
class SynthesisEngine {
  async enqueueSynthesis(manifest: CommunityManifest): Promise<string> {
    const job = await synthesisQueue.add('synthesize', {
      manifestId: manifest.community.id,
      channels: manifest.channels,
      roles: manifest.roles
    }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 }
    });
    return job.id;
  }
}

// Consumer: Worker processes synthesis with rate limiting
const synthesisWorker = new Worker('discord-synthesis', async (job) => {
  const rateLimiter = new DiscordRateLimiter();
  
  for (const channel of job.data.channels) {
    await rateLimiter.execute(async () => {
      await guild.channels.create({
        name: channel.name,
        type: channel.type,
        permissionOverwrites: channel.permissions
      });
    });
  }
  
  // Update manifest status
  await db.update('manifests', { 
    id: job.data.manifestId, 
    synthesisStatus: 'complete' 
  });
}, {
  connection: { host: 'redis', port: 6379 },
  concurrency: 5,  // Max 5 concurrent syntheses
  limiter: { max: 10, duration: 1000 }  // 10 jobs per second globally
});
```

> 🆕 **13th Audit Finding**: BullMQ per-tenant queues don't account for **Global Discord Rate Limits**. If 100 tenants click "Deploy" simultaneously, the global bot token will be banned.

> ✅ **Resolution: Global Distributed Token Bucket** — Platform-level throttling across ALL synthesis workers.

```typescript
// ═══════════════════════════════════════════════════════════════════════════
// GLOBAL DISTRIBUTED TOKEN BUCKET (v5.4 - 13th Audit)
// ═══════════════════════════════════════════════════════════════════════════

// The problem: Each BullMQ worker has its own rate limiter, but Discord
// rate limits are GLOBAL across the entire bot token. 100 tenants = 100
// workers = 100x the intended rate = instant 429 ban.

class GlobalDiscordTokenBucket {
  private redis: Redis;
  private readonly BUCKET_KEY = 'discord:global:tokens';
  private readonly MAX_TOKENS = 50;        // Discord allows ~50 req/sec
  private readonly REFILL_RATE = 50;       // Refill 50 tokens per second
  private readonly REFILL_INTERVAL = 1000; // Refill every second
  
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
      script, 1, this.BUCKET_KEY, this.MAX_TOKENS, tokens
    );
    
    return result === 1;
  }
  
  // Wait until tokens are available (with timeout)
  async acquireWithWait(tokens: number = 1, timeoutMs: number = 30000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    
    while (Date.now() < deadline) {
      if (await this.acquire(tokens)) {
        return;
      }
      // Exponential backoff: 100ms, 200ms, 400ms...
      await this.sleep(Math.min(100 * Math.pow(2, Math.random() * 3), 1000));
    }
    
    throw new RateLimitExceededError('Global Discord rate limit timeout');
  }
  
  private startRefillLoop(): void {
    setInterval(async () => {
      // Atomic refill up to MAX_TOKENS
      const script = `
        local current = tonumber(redis.call('GET', KEYS[1]) or 0)
        local newVal = math.min(current + tonumber(ARGV[1]), tonumber(ARGV[2]))
        redis.call('SET', KEYS[1], newVal)
        return newVal
      `;
      await this.redis.eval(
        script, 1, this.BUCKET_KEY, this.REFILL_RATE, this.MAX_TOKENS
      );
    }, this.REFILL_INTERVAL);
  }
}

// Updated synthesis worker with GLOBAL rate limiting
class GlobalRateLimitedSynthesisWorker {
  private globalBucket: GlobalDiscordTokenBucket;
  
  constructor(redis: Redis) {
    this.globalBucket = new GlobalDiscordTokenBucket(redis);
  }
  
  async createChannel(guild: Guild, config: ChannelConfig): Promise<Channel> {
    // Acquire from GLOBAL bucket (shared across all workers/tenants)
    await this.globalBucket.acquireWithWait(1, 30000);
    
    // Now safe to call Discord API
    return guild.channels.create(config);
  }
  
  async synthesize(manifest: CommunityManifest): Promise<void> {
    // Each operation consumes 1 token from the global bucket
    for (const role of manifest.roles) {
      await this.globalBucket.acquireWithWait(1);
      await this.createRole(manifest.guildId, role);
    }
    
    for (const channel of manifest.channels) {
      await this.globalBucket.acquireWithWait(1);
      await this.createChannel(manifest.guildId, channel);
    }
  }
}
```

```
┌─────────────────────────────────────────────────────────────────────┐
│               GLOBAL DISTRIBUTED TOKEN BUCKET                       │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   Worker 1 ─┐                                                       │
│             │      ┌──────────────────────┐                         │
│   Worker 2 ─┼─────►│  Redis Global Bucket │────► Discord API        │
│             │      │  (50 tokens/sec)     │                         │
│   Worker N ─┘      └──────────────────────┘                         │
│                              │                                      │
│                              │ Refill: 50 tokens/sec                │
│                              │                                      │
│   ┌──────────────────────────┴──────────────────────────┐          │
│   │ Tenant A: "Deploy" ──► Acquire 1 token ──► Create   │          │
│   │ Tenant B: "Deploy" ──► Wait... ──► Acquire ──► OK   │          │
│   │ Tenant C: "Deploy" ──► Wait... ──► Timeout          │          │
│   └─────────────────────────────────────────────────────┘          │
│                                                                     │
│   Result: Max 50 Discord API calls/sec GLOBALLY                     │
│   (regardless of concurrent tenant count)                           │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

```typescript
// WizardEngine must handle session interruption
// 
// FAILURE SCENARIOS (without Redis):
// 1. Container restart at Step 5 → Total loss of onboarding progress
// 2. User "drop-off" mid-flow (e.g., leaves to look up contract address) → No way to resume
// 3. Discord interaction expires → Session state lost
//
// The current bot is STATELESS - this is fatal for an 8-step wizard.

// ═══════════════════════════════════════════════════════════════════════════
// RESUMPTION PROTOCOL: Idempotency-keyed session recovery
// ═══════════════════════════════════════════════════════════════════════════

interface WizardSession {
  userId: string;
  guildId: string;
  currentStep: number;
  stepData: Record<number, StepData>;
  idempotencyKey: string;        // Unique key per wizard attempt
  startedAt: Date;
  lastInteractionAt: Date;
}

interface StepData {
  stepNumber: number;
  completed: boolean;
  data: Record<string, any>;
  idempotencyKey: string;        // Unique key per step execution
}

class WizardEngine {
  private redis: Redis;
  
  async handleInteraction(interaction: Interaction): Promise<void> {
    // CRITICAL: Defer within 3 seconds
    await interaction.deferReply({ ephemeral: true });
    
    // Load or create session with idempotency
    const sessionKey = `wizard:${interaction.user.id}:${interaction.guildId}`;
    let session = await this.redis.get(sessionKey);
    
    if (!session) {
      session = this.createSession(interaction.user.id, interaction.guildId);
    }
    
    // Generate idempotency key for this step to prevent duplicate processing
    const stepIdempotencyKey = `${session.idempotencyKey}:step${session.currentStep}`;
    const alreadyProcessed = await this.redis.get(`idempotency:${stepIdempotencyKey}`);
    
    if (alreadyProcessed) {
      // Step already completed - skip to next
      session.currentStep++;
    }
    
    // Set 15-minute TTL for Discord followup window
    await this.redis.setex(sessionKey, 900, JSON.stringify(session));
    
    // Process step...
  }
  
  // RESUMPTION PROTOCOL: Allow users to resume interrupted sessions
  @SlashCommand('onboard')
  async onboardCommand(
    interaction: CommandInteraction,
    @Option('resume') resume?: boolean
  ): Promise<void> {
    const sessionKey = `wizard:${interaction.user.id}:${interaction.guildId}`;
    const existingSession = await this.redis.get(sessionKey);
    
    if (existingSession && !resume) {
      // Found existing session - ask user what to do
      await interaction.reply({
        content: `You have an onboarding in progress (Step ${JSON.parse(existingSession).currentStep}/8). ` +
                 `Use \`/onboard resume:true\` to continue or start fresh.`,
        ephemeral: true
      });
      return;
    }
    
    if (resume && existingSession) {
      await this.continueFromState(interaction, JSON.parse(existingSession));
    } else {
      await this.startFreshWizard(interaction);
    }
  }
  
  // Mark step as complete with idempotency
  private async completeStep(session: WizardSession, stepData: any): Promise<void> {
    const stepKey = `idempotency:${session.idempotencyKey}:step${session.currentStep}`;
    
    // Store step completion with 24-hour TTL (prevents replay attacks)
    await this.redis.setex(stepKey, 86400, JSON.stringify({
      completedAt: new Date(),
      data: stepData
    }));
    
    session.stepData[session.currentStep] = {
      stepNumber: session.currentStep,
      completed: true,
      data: stepData,
      idempotencyKey: stepKey
    };
    
    session.currentStep++;
    session.lastInteractionAt = new Date();
  }
}
```

---

## 6. Onboarding-as-Code Specification

Following Projen's synthesis model, the Wizard outputs a declarative YAML manifest that defines the final state of the server. This "Onboarding-as-Code" approach enforces that configuration files are never manually edited—the manifest is the source of truth, and any drift triggers reconciliation.

> ⚠️ **Audit Warning: GitOps Scaling Nightmare**: Using file-based manifests for **1,000+ tenants** creates a scaling problem that will choke the Loa Framework's State Zone.

> 🆕 **13th Audit Finding**: Storing manifests in PostgreSQL loses the primary benefit of "As-Code": **Version Control, PR-based Auditing, and Rollback History**.

> ✅ **Resolution: Hybrid State Model** — PostgreSQL for runtime + Git/S3 shadow repository for audit history.

```typescript
// ═══════════════════════════════════════════════════════════════════════════
// HYBRID STATE MODEL (v5.4 - 13th Audit)
// ═══════════════════════════════════════════════════════════════════════════

interface HybridManifestStore {
  // PostgreSQL: Fast runtime access
  runtime: PostgresManifestRepository;
  
  // S3 + Git: Version control, audit trail, disaster recovery
  shadow: ShadowManifestRepository;
}

class HybridManifestRepository {
  constructor(
    private postgres: PostgresManifestRepository,
    private shadow: S3ShadowRepository
  ) {}
  
  async save(manifest: CommunityManifest): Promise<StoredManifest> {
    // 1. Save to PostgreSQL for runtime performance
    const stored = await this.postgres.save(manifest);
    
    // 2. Write to S3 shadow repository (versioned bucket)
    await this.shadow.archive({
      key: `manifests/${manifest.community.id}/v${stored.version}.json`,
      content: manifest,
      metadata: {
        version: stored.version,
        synthesizedAt: stored.synthesizedAt,
        synthesizedBy: stored.synthesizedBy,
        checksum: stored.checksum
      }
    });
    
    // 3. Optionally trigger Git commit for PR-based audit
    if (manifest.community.tier === 'enterprise') {
      await this.gitOps.commit({
        repo: `tenant-configs/${manifest.community.id}`,
        file: 'manifest.json',
        content: manifest,
        message: `Manifest v${stored.version} by ${stored.synthesizedBy}`
      });
    }
    
    return stored;
  }
  
  // Disaster recovery: Restore from shadow
  async recoverFromShadow(communityId: string, version?: number): Promise<void> {
    const shadowManifest = version 
      ? await this.shadow.get(`manifests/${communityId}/v${version}.json`)
      : await this.shadow.getLatest(`manifests/${communityId}/`);
    
    await this.postgres.save(shadowManifest);
    console.log(`Recovered manifest for ${communityId} from shadow repository`);
  }
  
  // Audit trail: Get full history from shadow
  async getAuditHistory(communityId: string): Promise<ManifestVersion[]> {
    return this.shadow.listVersions(`manifests/${communityId}/`);
  }
}
```

```
┌─────────────────────────────────────────────────────────────────────┐
│                    HYBRID STATE MODEL                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   WizardEngine ──► Manifest                                         │
│                       │                                             │
│         ┌─────────────┴─────────────┐                              │
│         │                           │                              │
│         ▼                           ▼                              │
│   ┌──────────────┐           ┌──────────────┐                      │
│   │  PostgreSQL  │           │  S3 Shadow   │                      │
│   │  (Runtime)   │           │  (Versioned) │                      │
│   │              │           │              │                      │
│   │ • Fast reads │           │ • Full hist. │                      │
│   │ • RLS        │           │ • DR backup  │                      │
│   │ • Latest     │           │ • Audit log  │                      │
│   └──────────────┘           └──────────────┘                      │
│         │                           │                              │
│         ▼                           ▼                              │
│   Synthesis Engine           Disaster Recovery                      │
│                              Compliance Audit                       │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

> **Original Mitigation (still valid)**: Store active manifests in **PostgreSQL** with a `manifests` table for runtime performance. The shadow repository provides FAANG-tier disaster recovery.

```typescript
// ❌ BAD: File-per-tenant GitOps (won't scale)
// /manifests/tenant-001.yaml
// /manifests/tenant-002.yaml
// ... 1,000+ files triggering Git commits

// ✅ GOOD: Database-backed manifests with version control
interface StoredManifest {
  id: string;
  communityId: string;
  version: number;           // Incrementing version for history
  content: CommunityManifest; // JSONB column
  synthesizedAt: Date;
  synthesizedBy: string;     // Agent or user ID
  checksum: string;          // SHA256 for drift detection
}

class ManifestRepository {
  async save(manifest: CommunityManifest): Promise<StoredManifest> {
    const version = await this.getLatestVersion(manifest.community.id) + 1;
    return this.db.insert('manifests', {
      communityId: manifest.community.id,
      version,
      content: manifest,
      synthesizedAt: new Date(),
      checksum: this.computeChecksum(manifest)
    });
  }
  
  // Retrieve manifest history for audit trail
  async getHistory(communityId: string): Promise<StoredManifest[]> {
    return this.db.query(
      'SELECT * FROM manifests WHERE community_id = ? ORDER BY version DESC',
      [communityId]
    );
  }
}
```

### 6.1 Manifest Schema

```yaml
# community-manifest.yaml
version: '3.0'
community:
  id: sietch-arrakis
  name: 'Sietch Arrakis'
  description: 'Top BGT holders community'

chains:
  - id: berachain
    type: evm
    rpcUrl: ${BERACHAIN_RPC_URL}

assets:
  - id: bgt
    chain: berachain
    address: '0x...'
    type: FUNGIBLE
    decimals: 18

eligibility:
  - id: top-69-never-redeemed
    type: COMPOSITE
    operator: AND
    children:
      - type: TOKEN_BALANCE
        asset: bgt
        rank: { min: 1, max: 69 }
      - type: DUNE_QUERY
        queryId: '4521789'
        condition: 'redemptions == 0'

roles:
  - id: naib
    name: 'Naib'
    eligibility: top-69-never-redeemed
    rank: { min: 1, max: 7 }
    permissions: [MANAGE_CHANNELS, KICK_MEMBERS]
  - id: fedaykin
    name: 'Fedaykin'
    eligibility: top-69-never-redeemed
    rank: { min: 8, max: 69 }
    permissions: [SEND_MESSAGES, VIEW_CHANNELS]

channels:
  - category: STILLSUIT
    children:
      - name: water-discipline
        type: TEXT
        access: [fedaykin, naib]
      - name: census
        type: TEXT
        access: [fedaykin, naib]
  - category: NAIB_COUNCIL
    children:
      - name: council-rock
        type: TEXT
        access: [naib]

platforms:
  - type: discord
    guildId: ${DISCORD_GUILD_ID}
    botToken: ${DISCORD_BOT_TOKEN}
```

### 6.2 Synthesis Engine

The synthesis engine reads the manifest and applies it to the target platform(s). Like Projen, files generated from synthesis are marked as read-only and include headers warning against manual modification.

1. **Parse:** Validate manifest against JSON Schema, resolve environment variables
2. **Diff:** Compare manifest state with current platform state (drift detection)
3. **Plan:** Generate execution plan showing create/update/delete operations
4. **Apply:** Execute plan via platform adapters with rollback capability
5. **Lock:** Write lock file recording applied state for future diffs

---

## 7. Collab.Land Mini App Integration

The refactored system integrates with Collab.Land as a Mini App, leveraging their Token Gating Rules (TGR) API and AccountKit SDK for wallet management across multiple blockchains.

### 7.1 TGR API Integration

The CollabLandTGRAdapter translates domain EligibilityCriteria into Collab.Land's native TGR format and registers rules via their API.

```typescript
class CollabLandTGRAdapter implements ITGRProvider {
  async registerRule(criteria: EligibilityCriteria, role: Role): Promise<TGRRule> {
    const tgrPayload = this.translateToTGR(criteria);
    return this.client.createRule({
      guildId: this.guildId,
      roleId: role.platformId,
      ...tgrPayload
    });
  }
  
  private translateToTGR(criteria: EligibilityCriteria): TGRPayload {
    switch (criteria.type) {
      case 'TOKEN_BALANCE':
        return {
          type: 'ERC20',
          chain: this.mapChain(criteria.asset.chain),
          address: criteria.asset.address,
          minBalance: criteria.threshold?.toString()
        };
      case 'NFT_OWNERSHIP':
        return {
          type: 'ERC721',
          chain: this.mapChain(criteria.asset.chain),
          address: criteria.asset.address,
          minBalance: '1'
        };
      // ... other criteria types
    }
  }
}
```

### 7.2 AccountKit SDK Usage

Collab.Land's AccountKit provides wallet verification and management. The system uses this for signature-based ownership verification during onboarding.

- **Wallet Connection:** Multi-chain wallet linking via AccountKit connect flow
- **Signature Verification:** EIP-712 typed data signing for ownership proof
- **Smart Account Support:** ERC-4337 account abstraction compatibility

---

## 8. Loa Framework Integration

The system can integrate with the Loa framework, which uses eight specialised AI agents to orchestrate the product development lifecycle. This enables agentic assistance during community setup and ongoing maintenance.

### 8.1 Agent Orchestration Model

| Loa Agent | Role | Arrakis Integration |
|-----------|------|---------------------|
| **Software Architect** | System design, pattern selection | Manifest schema design, adapter architecture |
| **Lead Developer** | Implementation, code quality | WizardEngine implementation, synthesis engine |
| **Security Auditor** | Vulnerability assessment | TGR rule validation, wallet verification audit |
| **DevOps Engineer** | Infrastructure, deployment | Terraform modules, CI/CD pipelines, `terraform plan/apply` orchestration |
| **QA Engineer** | Testing, validation | Wizard flow testing, manifest validation |
| **Technical Writer** | Documentation | API docs, user guides |
| **Product Manager** | Requirements, prioritisation | Feature roadmap, user feedback integration |
| **Project Coordinator** | Sprint planning, tracking | Milestone tracking, dependency management |

### 8.2 Agentic Workflows

Loa agents can assist with ongoing community management through automated workflows:

1. **Eligibility Drift Detection:** Monitor on-chain state changes and suggest rule updates
2. **Manifest Evolution:** Propose manifest changes based on community feedback
3. **Security Monitoring:** Alert on suspicious wallet patterns or rule bypass attempts
4. **Performance Optimisation:** Suggest RPC endpoint changes based on latency metrics

### 8.3 Observability Trajectories

> ⚠️ **Audit Finding**: Every time a Loa agent modifies the infrastructure (Terraform) or the server manifest, it must log its **reasoning trajectory** to BigQuery Agent Analytics.

```typescript
// Agent SDK observability wrapper
import { Agent } from '@anthropic/agent-sdk';
import { BigQuery } from '@google-cloud/bigquery';

class ObservableAgent extends Agent {
  private bigquery = new BigQuery();
  
  async execute(task: AgentTask): Promise<AgentResult> {
    const trajectory: ReasoningStep[] = [];
    
    // Wrap all tool calls to capture reasoning
    const result = await super.execute(task, {
      onToolCall: (tool, args, reasoning) => {
        trajectory.push({
          timestamp: new Date().toISOString(),
          tool: tool.name,
          args: JSON.stringify(args),
          reasoning: reasoning,
          agentId: this.id
        });
      }
    });
    
    // Log trajectory to BigQuery
    await this.bigquery.dataset('agent_analytics').table('trajectories').insert([{
      taskId: task.id,
      agentType: this.type,
      trajectory: JSON.stringify(trajectory),
      outcome: result.status,
      duration_ms: result.durationMs,
      tenant_id: task.context.tenantId,
      timestamp: new Date().toISOString()
    }]);
    
    return result;
  }
}

// Usage: Track infrastructure changes
const devopsAgent = new ObservableAgent({
  type: 'devops-engineer',
  tools: [terraformPlan, terraformApply, vaultRotate]
});

await devopsAgent.execute({
  id: 'deploy-123',
  description: 'Deploy community manifest changes',
  context: { tenantId: 'sietch-arrakis' }
});
```

**Analytics queries available:**

- Agent decision patterns by task type
- Tool usage frequency and failure rates
- Reasoning trajectory replay for debugging
- Cost attribution per tenant/agent

---

## 9. SaaS Operations: Multi-Tenancy & Billing

> ⚠️ **Audit Finding**: The original plan lacked strategies for multi-tenant data isolation, billing hooks, and drift detection—all FAANG-tier requirements for production SaaS.

### 9.1 Multi-Tenant Data Isolation

> 🚨 **Critical Audit Finding**: SQLite is a **liability** for multi-tenant SaaS. For 100+ tenants, a single SQLite file will suffer from locking contention. File-per-tenant is a management nightmare for backups and migrations.

> 🚨 **PostgreSQL-ONLY Architecture Mandatory**: The proposal to use "PostgreSQL + SQLite (embedded)" is **architecturally incoherent** for a FAANG-tier SaaS. v3.0 tracks complex stats (BGT history, time in tiers, badge lineage). Maintaining this in SQLite-per-tenant while using PostgreSQL for a central registry creates a **distributed state synchronization nightmare**. The "Water Sharer" badge lineage requires recursive CTEs that SQLite handles poorly.

With 100+ communities sharing infrastructure, strict data isolation is mandatory:

```typescript
// ❌ CURRENT STATE: SQLite single-file (profiles.db)
// - Locking contention under concurrent writes
// - No tenant isolation
// - Backup/restore nightmare at scale
// - Cannot handle v3.0 badge lineage recursive queries

// ❌ REJECTED: Hybrid PostgreSQL + SQLite
// - Distributed state synchronization nightmare
// - Complex failover scenarios
// - Two databases to manage, backup, migrate

// ✅ MANDATED: PostgreSQL-ONLY with tenant isolation
// All database queries must be tenant-scoped
interface TenantContext {
  communityId: string;
  organizationId: string;
}

class TenantScopedRepository<T> {
  constructor(
    private db: Database,
    private tableName: string,
    private tenant: TenantContext
  ) {}
  
  async findAll(): Promise<T[]> {
    // CRITICAL: Always filter by tenant
    return this.db.query(
      `SELECT * FROM ${this.tableName} WHERE community_id = ?`,
      [this.tenant.communityId]
    );
  }
  
  async create(data: Partial<T>): Promise<T> {
    // CRITICAL: Always inject tenant ID
    return this.db.insert(this.tableName, {
      ...data,
      community_id: this.tenant.communityId
    });
  }
}
```

**Isolation strategies by tier:**

> 🆕 **13th Audit Correction**: Schema-per-tenant is a maintenance nightmare at FAANG scale. Managing migrations for 1,000+ schemas causes "state drift." **Standardize on RLS-ONLY.**

| Tier | Isolation Level | Implementation |
|------|-----------------|----------------|
| **Free** | Row-level (RLS) | Shared database, `community_id` column on all tables |
| **Pro** | Row-level (RLS) | Same as Free + priority support, no schema isolation |
| **Enterprise** | Row-level (RLS) + VPC | Same schema, but dedicated VPC for network isolation |

> ⚠️ **FAANG Requirement**: Use schema isolation **ONLY** for regulatory compliance (e.g., EU data residency), not as a standard feature. All tiers use the same migration path.

```typescript
// FAANG-tier RLS enforcement with automated regression testing
class TenantIsolationGuard {
  // Every query MUST include tenant context
  async executeQuery<T>(sql: string, tenantId: string): Promise<T> {
    await this.db.execute(`SET app.current_tenant = '${tenantId}'`);
    
    const result = await this.db.execute(sql);
    
    // Regression test: verify no cross-tenant data leaked
    if (process.env.NODE_ENV === 'test') {
      await this.assertNoTenantLeakage(result, tenantId);
    }
    
    return result;
  }
  
  // Automated RLS regression testing (runs in CI)
  async assertNoTenantLeakage(result: any[], tenantId: string): Promise<void> {
    for (const row of result) {
      if (row.community_id && row.community_id !== tenantId) {
        throw new TenantLeakageError(
          `CRITICAL: Query returned data from tenant ${row.community_id} ` +
          `when requesting tenant ${tenantId}`
        );
      }
    }
  }
}
```

> 🚨 **Data Leakage Risk**: A bug in a shared query could allow **"Tenant A"** to view the `water-shares` or `activity` logs of **"Tenant B"**. This is unacceptable for communities with alpha-sharing channels.

### 9.1.1 Naib Council Security + Kill Switch (v5.4)

> ⚠️ **Audit Finding**: The "Naib Council" (Top 7) permission logic must be enforced via **HCP Vault-managed policies**, not just application-level `if` statements.

> 🆕 **13th Audit Finding**: No Kill Switch for compromised accounts. If a Naib's credentials are compromised, synthesis can drain "Water Shares."

```typescript
// ═══════════════════════════════════════════════════════════════════════════
// KILL SWITCH PROTOCOL (v5.4 - 13th Audit)
// ═══════════════════════════════════════════════════════════════════════════

interface KillSwitchProtocol {
  // Immediately revoke all active sessions for a user
  revokeAllSessions(userId: string): Promise<void>;
  
  // Revoke Vault policies for compromised account
  revokeVaultPolicies(userId: string): Promise<void>;
  
  // Suspend all pending synthesis operations for a community
  suspendSynthesis(communityId: string): Promise<void>;
  
  // Emergency freeze: no changes allowed until manual review
  freezeCommunity(communityId: string, reason: string): Promise<void>;
}

class NaibSecurityGuard {
  constructor(
    private vault: VaultClient,
    private killSwitch: KillSwitchProtocol,
    private mfa: MFAProvider
  ) {}
  
  // MFA required for destructive operations (13th audit requirement)
  async authorizeDestructiveAction(
    userId: string,
    action: 'DELETE_CHANNEL' | 'DELETE_ROLE' | 'REVOKE_ACCESS'
  ): Promise<AuthorizationResult> {
    // Step 1: Verify Vault policy allows this action
    const policyAllowed = await this.vault.checkAccess(userId, `synthesis:${action}`);
    if (!policyAllowed) {
      return { authorized: false, reason: 'Policy denied' };
    }
    
    // Step 2: Require MFA for destructive actions
    const mfaVerified = await this.mfa.verifyChallenge(userId, {
      action,
      expiresIn: 300  // 5 minute window
    });
    
    if (!mfaVerified) {
      await this.auditLog('mfa_failed', { userId, action });
      return { authorized: false, reason: 'MFA verification failed' };
    }
    
    return { authorized: true };
  }
  
  // Emergency kill switch triggered by auditing-security agent
  async triggerKillSwitch(compromisedUserId: string, reporter: string): Promise<void> {
    console.error(`[KILL SWITCH] Triggered for ${compromisedUserId} by ${reporter}`);
    
    // 1. Revoke all sessions immediately
    await this.killSwitch.revokeAllSessions(compromisedUserId);
    
    // 2. Revoke Vault policies (cryptographic lockout)
    await this.killSwitch.revokeVaultPolicies(compromisedUserId);
    
    // 3. Find all communities where user is Naib
    const communities = await this.findCommunitiesWhereNaib(compromisedUserId);
    
    // 4. Suspend synthesis for affected communities
    for (const community of communities) {
      await this.killSwitch.suspendSynthesis(community.id);
      await this.killSwitch.freezeCommunity(community.id, 
        `Kill switch triggered for Naib ${compromisedUserId}`);
    }
    
    // 5. Alert all other Naibs in affected communities
    await this.alertNaibs(communities, 'SECURITY_INCIDENT');
  }
}
```

```
┌─────────────────────────────────────────────────────────────────────┐
│                    KILL SWITCH PROTOCOL                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   Compromised Account Detected                                      │
│            │                                                        │
│            ▼                                                        │
│   ┌────────────────┐   ┌────────────────┐   ┌────────────────┐     │
│   │ Revoke Sessions│──►│ Revoke Vault   │──►│ Suspend        │     │
│   │ (Redis)        │   │ Policies (HCP) │   │ Synthesis      │     │
│   └────────────────┘   └────────────────┘   └────────────────┘     │
│            │                                        │               │
│            ▼                                        ▼               │
│   ┌────────────────┐                       ┌────────────────┐      │
│   │ Freeze         │◄──────────────────────│ Alert Naibs    │      │
│   │ Community      │                       │ (Discord DM)   │      │
│   └────────────────┘                       └────────────────┘      │
│                                                                     │
│   Recovery: Manual review by remaining Naibs + support ticket       │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

> ⚠️ **Original Audit Finding (Vault Policies)**:

```typescript
// ❌ CURRENT: Application-level permission check
function canAccessCouncil(user: User): boolean {
  return user.tier === 'naib';  // Easily bypassed if app is compromised
}

// ✅ REQUIRED: Vault-managed policy enforcement
interface VaultPolicyEnforcer {
  // Policy stored in Vault, not application code
  async checkAccess(userId: string, resource: string): Promise<boolean>;
}

class NaibCouncilGuard {
  constructor(private vault: VaultPolicyEnforcer) {}
  
  async enforceCouncilAccess(userId: string): Promise<void> {
    // Policy definition lives in Vault, cryptographically signed
    const allowed = await this.vault.checkAccess(userId, 'council:naib');
    
    if (!allowed) {
      // Audit log stored in Vault for compliance
      await this.vault.auditLog('council_access_denied', { userId });
      throw new ForbiddenError('Council access denied');
    }
  }
}

// Vault policy definition (HCL)
// path "secret/data/council/*" {
//   capabilities = ["read"]
//   required_parameters = ["tier"]
//   allowed_parameters = {
//     "tier" = ["naib"]
//   }
// }
```

**Security Invariant**: A tenant admin must be **cryptographically isolated**. Council access is verified against Vault policies, not application state that could be tampered with.

> ⚠️ **Audit Recommendation**: Migrate from `better-sqlite3` to a multi-tenant PostgreSQL instance using an ORM (Drizzle or Prisma) with a **global `tenant_id` filter** to prevent data leakage between communities:

```typescript
// Drizzle ORM with global tenant filter
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';

function createTenantDb(pool: Pool, tenantId: string) {
  const db = drizzle(pool);
  
  // Inject tenant filter into all queries via RLS policy
  return {
    ...db,
    async query<T>(query: SQL): Promise<T[]> {
      // Prepend tenant context to every query
      await pool.query(`SET app.current_tenant = '${tenantId}'`);
      return db.execute(query);
    }
  };
}

// PostgreSQL Row-Level Security policy
// CREATE POLICY tenant_isolation ON profiles
//   USING (community_id = current_setting('app.current_tenant'));
```

### 9.2 Billing & Metering

Usage tracking hooks for subscription management:

```typescript
interface UsageMetrics {
  communityId: string;
  period: string; // YYYY-MM
  
  // Metered dimensions
  eligibilitySyncs: number;      // Cron job runs
  activeMembers: number;         // Peak MAU
  tgrEvaluations: number;        // Collab.Land API calls
  storageBytes: number;          // Profile/badge data
}

class MeteringService {
  async recordUsage(event: UsageEvent): Promise<void> {
    await this.db.query(`
      INSERT INTO usage_metrics (community_id, period, dimension, value)
      VALUES (?, ?, ?, ?)
      ON CONFLICT (community_id, period, dimension)
      DO UPDATE SET value = usage_metrics.value + EXCLUDED.value
    `, [event.communityId, event.period, event.dimension, event.value]);
  }
  
  async checkQuota(communityId: string, dimension: string): Promise<boolean> {
    const usage = await this.getCurrentUsage(communityId, dimension);
    const plan = await this.getPlan(communityId);
    return usage < plan.limits[dimension];
  }
}
```

**Billing integration points:**

- **Stripe** for subscription management and invoicing
- **Usage webhooks** fired on each metered event
- **Quota enforcement** before expensive operations (TGR registration, node provisioning)
- **Collab.Land Premier Subscription** hooks for BGT-rank sync billing

> ⚠️ **Audit Finding**: A SaaS requires a "Metering Adapter" in the infrastructure layer to track BGT-rank syncs and trigger billing via Collab.Land's Premier Subscription hooks.

```typescript
// Metering Adapter for Collab.Land billing integration
class CollabLandMeteringAdapter implements IMeteringProvider {
  async reportUsage(metrics: UsageMetrics): Promise<void> {
    // Report to Collab.Land for premier subscription billing
    await this.collabLandClient.reportUsage({
      guildId: metrics.communityId,
      metric: 'eligibility_syncs',
      value: metrics.eligibilitySyncs,
      period: metrics.period
    });
    
    // Also report to Stripe for custom billing
    await this.stripe.subscriptionItems.createUsageRecord(
      metrics.subscriptionItemId,
      { quantity: metrics.eligibilitySyncs, timestamp: Date.now() }
    );
  }
}
```

### 9.3 Drift Detection & Reconciliation

> ⚠️ **Audit Finding**: The system needs to detect if Discord server state has been manually tampered with.

> 🚨 **Shadow State Requirement**: Synthesis requires a **"Shadow State"** to compare YAML manifest vs Live Discord API. Without this, Drift Detection is impossible because the system has no memory of what it previously applied.

The manifest is declarative, but Discord is imperative. Drift detection requires three states:

```typescript
// ═══════════════════════════════════════════════════════════════════════════
// SHADOW STATE PATTERN: Required for Drift Detection
// ═══════════════════════════════════════════════════════════════════════════

// Three states that must be compared:
// 1. DESIRED STATE: What the manifest says should exist (YAML/DB)
// 2. SHADOW STATE: What we last successfully applied (PostgreSQL)  
// 3. ACTUAL STATE: What Discord API currently reports (live query)

interface ShadowState {
  communityId: string;
  appliedAt: Date;
  appliedBy: string;  // Agent or user ID
  resources: ShadowResource[];
  checksum: string;   // Hash of applied state for quick comparison
}

interface ShadowResource {
  type: 'role' | 'channel' | 'permission';
  discordId: string;  // Actual Discord snowflake ID after creation
  manifestId: string; // Reference to manifest definition
  properties: Record<string, any>;
}

// Shadow state is stored in PostgreSQL (not Discord or manifest)
class ShadowStateRepository {
  async save(state: ShadowState): Promise<void> {
    await this.db.insert('shadow_states', {
      community_id: state.communityId,
      applied_at: state.appliedAt,
      resources: JSON.stringify(state.resources),
      checksum: state.checksum
    });
  }
  
  async getLatest(communityId: string): Promise<ShadowState | null> {
    return this.db.query(
      'SELECT * FROM shadow_states WHERE community_id = ? ORDER BY applied_at DESC LIMIT 1',
      [communityId]
    );
  }
}

interface DriftReport {
  communityId: string;
  timestamp: Date;
  drifts: Drift[];
}

interface Drift {
  resource: 'role' | 'channel' | 'permission';
  expected: any;   // From manifest (desired)
  shadow: any;     // From shadow state (last applied)
  actual: any;     // From Discord API (current)
  action: 'create' | 'update' | 'delete' | 'none';
  driftType: 'manifest_change' | 'external_tampering' | 'both';
}

class DriftDetector {
  private shadowRepo: ShadowStateRepository;
  
  async detect(manifest: CommunityManifest): Promise<DriftReport> {
    const guild = await this.discord.guilds.fetch(manifest.platforms.discord.guildId);
    const shadow = await this.shadowRepo.getLatest(manifest.community.id);
    const drifts: Drift[] = [];
    
    // Check roles - compare all three states
    for (const expectedRole of manifest.roles) {
      const shadowRole = shadow?.resources.find(r => r.manifestId === expectedRole.id);
      const actualRole = shadowRole 
        ? guild.roles.cache.get(shadowRole.discordId)
        : guild.roles.cache.find(r => r.name === expectedRole.name);
      
      if (!actualRole) {
        drifts.push({ 
          resource: 'role', 
          expected: expectedRole, 
          shadow: shadowRole,
          actual: null, 
          action: 'create',
          driftType: shadowRole ? 'external_tampering' : 'manifest_change'
        });
      } else if (!this.permissionsMatch(expectedRole, actualRole)) {
        drifts.push({ 
          resource: 'role', 
          expected: expectedRole, 
          shadow: shadowRole,
          actual: actualRole, 
          action: 'update',
          driftType: this.classifyDrift(expectedRole, shadowRole, actualRole)
        });
      }
    }
    
    // Check for orphaned roles (in Discord but not manifest)
    for (const actualRole of guild.roles.cache.values()) {
      if (actualRole.name.startsWith('sietch-') && !manifest.roles.find(r => r.name === actualRole.name)) {
        drifts.push({ 
          resource: 'role', 
          expected: null, 
          shadow: shadow?.resources.find(r => r.discordId === actualRole.id),
          actual: actualRole, 
          action: 'delete',
          driftType: 'manifest_change'
        });
      }
    }
    
    return { communityId: manifest.community.id, timestamp: new Date(), drifts };
  }
  
  private classifyDrift(expected: any, shadow: any, actual: any): Drift['driftType'] {
    const manifestChanged = !this.deepEqual(expected, shadow);
    const externallyTampered = !this.deepEqual(shadow, actual);
    
    if (manifestChanged && externallyTampered) return 'both';
    if (manifestChanged) return 'manifest_change';
    return 'external_tampering';
  }
  
  async reconcile(report: DriftReport, mode: 'plan' | 'apply'): Promise<void> {
    if (mode === 'plan') {
      console.log('Drift detected:', report.drifts);
      return;
    }
    
    for (const drift of report.drifts) {
      await this.applyDriftFix(drift);
    }
  }
}
```

**Drift detection schedule (The "Reconciliation Loop"):**

> ⚠️ **Audit Finding**: The plan mentions drift but doesn't explain how to handle a Naib (admin) manually deleting a channel in Discord. A background job must compare the **CommunityManifest** against the **Discord API state** every 6 hours.

- **Continuous**: Webhook listener for Discord audit log events (real-time alerts)
- **Periodic**: Full reconciliation every 6 hours via trigger.dev (catch missed webhooks)
- **On-demand**: Admin command `/reconcile` for immediate sync

```typescript
// trigger.dev scheduled job for drift reconciliation
export const driftReconciliationJob = schedules.task({
  id: 'drift-reconciliation',
  cron: '0 */6 * * *', // Every 6 hours
  run: async () => {
    const communities = await db.getAllCommunities();
    
    for (const community of communities) {
      const manifest = await loadManifest(community.id);
      const detector = new DriftDetector(discord);
      const report = await detector.detect(manifest);
      
      if (report.drifts.length > 0) {
        // Alert community admin via DM
        await alertAdmin(community.adminDiscordId, report);
        
        // Log drift event for analytics
        await analytics.track('drift_detected', {
          communityId: community.id,
          driftCount: report.drifts.length,
          driftTypes: report.drifts.map(d => d.resource)
        });
        
        // Auto-reconcile if enabled (default: plan-only)
        if (community.autoReconcile) {
          await detector.reconcile(report, 'apply');
        }
      }
    }
  }
});
```

---

## 10. Migration Strategy

> ⚠️ **Audit Recommendation**: This design requires a pivot from "refactoring" to a **"decoupled migration"** strategy. The original plan assumed eligibility logic could be easily extracted into pure functions—but the source code reveals that `src/services/chain.ts` performs side-effects including direct SQLite writes and Dune Analytics bridging.

Migrating from the current Sietch v2.0 to the SaaS architecture requires careful planning to maintain service continuity for existing communities while enabling new capabilities.

### 10.1 Coupling Audit Results (v5.5.1 Audit-Complete — 15 Rounds)

> ✅ **AUDIT COMPLETE**: All 15 rounds of concerns addressed. Architecture is implementation-ready.

| Component | Original Issue | Resolution | Rounds | Status |
|-----------|----------------|------------|--------|--------|
| `chain.ts` | viem + BGT ranking | Two-Tier Chain Provider | 1,7,10-15 | ✅ RESOLVED |
| `eligibility.ts` | Discord side effects | Theme-aware orchestrator | 1,7,10-12 | ✅ RESOLVED |
| `profile.ts` | SQLite + personal stats | PostgreSQL + RLS | 1,8,10-15 | 🚧 Phase 2 |
| `badge.ts` | Hardcoded lineage | Themes System | 7,8,10-12 | ✅ RESOLVED |
| Score Service | SPOF risk | Circuit Breaker + Two-Tier | 13,14,15 | ✅ RESOLVED |
| Multi-tenancy | Schema-per-tenant | RLS-ONLY | 13,15 | ✅ RESOLVED |
| Manifests | No Git history | Hybrid State Model | 13,15 | ✅ RESOLVED |
| Discord | Global 429 | Global Token Bucket | 8,13,15 | ✅ RESOLVED |
| Security | No Kill Switch | MFA + Vault Revocation | 13 | ✅ RESOLVED |
| Terraform | Approval fatigue | OPA Pre-Gate | 14,15 | ✅ RESOLVED |

> 📊 **Resolution Summary (15 Rounds)**:
> ```
> COUPLING (R1-12):           ████████████████████ 100% RESOLVED ✅
> FAANG HARDENING (R13):      ████████████████████ 100% RESOLVED ✅
> RESILIENCE (R14):           ████████████████████ 100% RESOLVED ✅
> VERIFICATION (R15):         ████████████████████ 100% PRE-ADDRESSED ✅
> INFRASTRUCTURE (R1-15):     ████████████████████ 100% DOCUMENTED 🚧
> ```

### 10.2 File-Specific Migration Path (Updated for Score/Themes)

#### Phase 0: Score Service Integration (Weeks 0-2)

> ✅ **Simplified**: Instead of purging side effects from chain.ts, we now **replace it entirely** with ScoreServiceAdapter.

```
Step 0.1: Delete chain.ts, Create ScoreServiceAdapter
──────────────────────────────────────────────────────
DELETE: src/services/chain.ts (all viem code)

CREATE: packages/adapters/score/ScoreServiceAdapter.ts
        - Implements IChainProvider
        - Calls Score API for all blockchain data
        - No viem, no RPC URLs, no contract addresses

Step 0.2: Update Environment Configuration
──────────────────────────────────────────
BEFORE (.env):
  BERACHAIN_RPC_URL=https://...
  DUNE_API_KEY=xxx
  BGT_CONTRACT_ADDRESS=0x...

AFTER (.env):
  SCORE_API_URL=https://score.honeyjar.xyz
  SCORE_API_KEY=xxx

Step 0.3: Update Eligibility Service
────────────────────────────────────
REFACTOR: src/services/eligibility.ts

- Remove direct viem imports
- Inject IChainProvider (ScoreServiceAdapter)
- Replace hardcoded rank logic with Score API calls

VALIDATION: All eligibility checks work via Score API
```

#### Phase 1: Theme System Implementation (Weeks 3-4)

```
Step 1.1: Implement Theme Interface
───────────────────────────────────
CREATE: packages/core/ports/IThemeProvider.ts
CREATE: packages/themes/basic/BasicTheme.ts
CREATE: packages/themes/sietch/SietchTheme.ts

Step 1.2: Extract Hardcoded Tier/Badge Config
─────────────────────────────────────────────
BEFORE: Hardcoded in eligibility.ts
  const TIERS = [
    { name: 'naib', minRank: 1, maxRank: 7 },
    // ... 9 tiers hardcoded
  ];

AFTER: Loaded from Theme
  const theme = this.themeRegistry.get(community.themeId);
  const tierConfig = theme.getTierConfig();

Step 1.3: Theme-Aware Services
──────────────────────────────
REFACTOR: All services receive IThemeProvider

class TierEvaluator {
  constructor(private theme: IThemeProvider) {}
  
  evaluate(rank: number): TierResult {
    return this.theme.evaluateTier(rank);
  }
}

class BadgeEvaluator {
  constructor(private theme: IThemeProvider) {}
  
  evaluate(member: MemberContext): EarnedBadge[] {
    return this.theme.evaluateBadges(member);
  }
}

VALIDATION: Sietch theme produces identical results to v3.0 hardcoded logic
```

#### Phase 2: PostgreSQL Migration (Weeks 5-8)

> 🚨 **Critical**: This is the "conveyor belt" — must be complete before WizardEngine or Synthesis.

```
Step 2.1: Replace SQLite with PostgreSQL + Drizzle ORM
──────────────────────────────────────────────────────
DELETE: profiles.db (SQLite file)

CREATE: PostgreSQL schema with tenant isolation

-- All tables have tenant_id for RLS
CREATE TABLE communities (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  theme_id TEXT NOT NULL DEFAULT 'basic',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE profiles (
  id UUID PRIMARY KEY,
  community_id UUID REFERENCES communities(id),
  discord_id TEXT NOT NULL,
  wallet_address TEXT,
  tier TEXT,
  activity_score INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Row-Level Security
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON profiles
  USING (community_id = current_setting('app.current_tenant')::UUID);

Step 2.2: Implement Drizzle ORM with Tenant Context
───────────────────────────────────────────────────
CREATE: packages/adapters/postgres/DrizzleStorageAdapter.ts

class DrizzleStorageAdapter implements IStorageProvider {
  constructor(private db: DrizzleClient, private tenantId: string) {}
  
  async findProfiles(): Promise<Profile[]> {
    // Tenant context automatically applied via RLS
    return this.db.select().from(profiles)
      .where(eq(profiles.communityId, this.tenantId));
  }
}

VALIDATION: 
  - All 141 existing tests pass with PostgreSQL
  - RLS prevents cross-tenant data access
  - Badge lineage recursive queries work
```

#### Phase 3: Redis WizardEngine (Weeks 9-10)

> 🚨 **Discord Physical Wall**: Bot interactions expire in 3 seconds. Without Redis, the wizard is impossible.

```
Step 3.1: Redis Session Store
─────────────────────────────
CREATE: packages/services/WizardSessionStore.ts

class RedisWizardSessionStore implements ISessionStore {
  constructor(private redis: Redis) {}
  
  async save(session: WizardSession): Promise<void> {
    await this.redis.setex(
      `wizard:${session.id}`,
      900, // 15 minute TTL
      JSON.stringify(session)
    );
  }
  
  async get(sessionId: string): Promise<WizardSession | null> {
    const data = await this.redis.get(`wizard:${sessionId}`);
    return data ? JSON.parse(data) : null;
  }
}

Step 3.2: Idempotency-Keyed Resume Command
──────────────────────────────────────────
CREATE: /resume slash command

// Discord expires in 3s, but we can resume later
client.on('interactionCreate', async (interaction) => {
  if (interaction.commandName === 'resume') {
    const sessionId = interaction.options.getString('session_id');
    const session = await sessionStore.get(sessionId);
    
    if (session) {
      // Resume from last checkpoint
      await wizard.resumeFromStep(session, session.currentStep);
    }
  }
});

VALIDATION:
  - Wizard survives Discord timeout
  - Wizard survives container restart
  - User can resume with /resume command
```

#### Phase 4: BullMQ Async Synthesis (Weeks 11-12)

> 🚨 **Discord 429 Physical Wall**: Synthesizing 9 tiers + 10 channels = 90+ API calls. Must be async.

```
Step 4.1: BullMQ Queue for Discord Operations
─────────────────────────────────────────────
CREATE: packages/services/SynthesisQueue.ts

const synthesisQueue = new Queue('discord-synthesis', {
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 }
  }
});

// Rate limiter: 5 concurrent, 10 jobs/sec
const rateLimiter = new RateLimiter({
  max: 5,
  duration: 1000
});

Step 4.2: Reconciliation Controller Pattern
───────────────────────────────────────────
// Kubernetes-style reconciliation loop
class SynthesisController {
  async reconcile(manifest: CommunityManifest): Promise<void> {
    const desired = manifest;
    const actual = await this.fetchDiscordState(manifest.guildId);
    const shadow = await this.shadowRepo.getLatest(manifest.communityId);
    
    const operations = this.calculateDiff(desired, actual, shadow);
    
    for (const op of operations) {
      await this.synthesisQueue.add('synthesis-op', op);
    }
  }
}

VALIDATION:
  - No Discord 429 errors during synthesis
  - Synthesis can be resumed if interrupted
  - Drift detection works with shadow state
```

#### Phase 5: Vault Transit Engine (Weeks 13-14)

> 🚨 **Security Critical**: Private keys must NEVER be in memory. Use Vault for all signing.

```
Step 5.1: HCP Vault Transit Setup
─────────────────────────────────
# Vault policy for signing operations
path "transit/sign/arrakis-signer" {
  capabilities = ["update"]
}

path "transit/verify/arrakis-signer" {
  capabilities = ["update"]
}

Step 5.2: Vault Signing Adapter
───────────────────────────────
CREATE: packages/adapters/vault/VaultSigningAdapter.ts

class VaultSigningAdapter implements ISigningProvider {
  constructor(private vault: VaultClient) {}
  
  async signTransaction(tx: UnsignedTransaction): Promise<SignedTransaction> {
    // Key NEVER leaves Vault
    const signature = await this.vault.transit.sign({
      name: 'arrakis-signer',
      input: Buffer.from(tx.hash).toString('base64')
    });
    
    return { ...tx, signature: signature.data.signature };
  }
}

VALIDATION:
  - No PRIVATE_KEY in .env files
  - All signing goes through Vault Transit
  - Audit log of all signing operations
```

#### Phase 6: HITL Gate for Terraform (Weeks 15-16)

> 🚨 **Extreme Risk Mitigation**: AI agents running `terraform apply` could delete 100+ production volumes.

> 🆕 **14th Audit Finding**: "Lazy Human" approval fatigue. Humans rubber-stamp approvals after seeing 50+ plans. Agent hallucination in `.tfvars` could slip through.

> ✅ **Resolution: Policy-as-Code Pre-Gate** — OPA/Sentinel validates plan BEFORE human sees it. Dangerous operations auto-rejected.

```typescript
// ═══════════════════════════════════════════════════════════════════════════
// POLICY-AS-CODE PRE-GATE (v5.5 - 14th Audit)
// ═══════════════════════════════════════════════════════════════════════════
//
// PROBLEM: Humans get "approval fatigue" after reviewing 50+ Terraform plans.
// A subtle `terraform destroy` on a PersistentVolume might slip through.
//
// SOLUTION: Three-stage validation BEFORE human approval:
// 1. OPA Policy Check: Block dangerous operations automatically
// 2. Infracost Budget Check: Reject plans exceeding cost threshold
// 3. Risk Scoring: Flag high-risk changes for extra scrutiny

interface PolicyValidationResult {
  passed: boolean;
  violations: PolicyViolation[];
  riskScore: number;        // 0-100, higher = more dangerous
  estimatedCost: CostDelta; // From Infracost
}

class PolicyAsCodePreGate {
  private opa: OPAClient;
  private infracost: InfracostClient;
  
  async validateBeforeHITL(plan: TerraformPlan): Promise<PolicyValidationResult> {
    const violations: PolicyViolation[] = [];
    
    // ═══════════════════════════════════════════════════════════════════════
    // STAGE 1: OPA Policy Enforcement (Auto-reject dangerous operations)
    // ═══════════════════════════════════════════════════════════════════════
    
    const opaResult = await this.opa.evaluate('arrakis/terraform', {
      plan: plan.resourceChanges
    });
    
    // Hard blocks - NEVER allow these, regardless of human approval
    const hardBlocks = [
      'delete_persistent_volume',
      'delete_database',
      'modify_rls_policy',
      'disable_encryption',
      'expose_to_public'
    ];
    
    for (const block of hardBlocks) {
      if (opaResult.violations.includes(block)) {
        violations.push({
          type: 'HARD_BLOCK',
          policy: block,
          message: `Operation "${block}" is prohibited by policy`,
          autoReject: true  // Human CANNOT override this
        });
      }
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // STAGE 2: Infracost Budget Check
    // ═══════════════════════════════════════════════════════════════════════
    
    const costDelta = await this.infracost.diff(plan);
    
    if (costDelta.monthlyIncrease > 1000) {  // $1000/mo threshold
      violations.push({
        type: 'BUDGET_EXCEEDED',
        policy: 'cost_threshold',
        message: `Plan increases monthly cost by $${costDelta.monthlyIncrease}`,
        autoReject: costDelta.monthlyIncrease > 5000  // Auto-reject >$5k
      });
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // STAGE 3: Risk Scoring
    // ═══════════════════════════════════════════════════════════════════════
    
    const riskScore = this.calculateRiskScore(plan, opaResult, costDelta);
    
    return {
      passed: violations.filter(v => v.autoReject).length === 0,
      violations,
      riskScore,
      estimatedCost: costDelta
    };
  }
  
  private calculateRiskScore(plan: TerraformPlan, opa: any, cost: any): number {
    let score = 0;
    
    // Resource deletions are high risk
    score += plan.resourceChanges.filter(r => r.action === 'delete').length * 20;
    
    // Database changes are high risk
    score += plan.resourceChanges.filter(r => 
      r.type.includes('database') || r.type.includes('rds')
    ).length * 30;
    
    // Cost increases are moderate risk
    score += Math.min(cost.monthlyIncrease / 100, 20);
    
    // Policy warnings (non-blocking) are low risk
    score += opa.warnings.length * 5;
    
    return Math.min(score, 100);
  }
}

// OPA Policy Definition (Rego)
const ARRAKIS_TERRAFORM_POLICY = `
package arrakis.terraform

# HARD BLOCK: Never allow deletion of persistent volumes
deny[msg] {
  input.plan[_].action == "delete"
  input.plan[_].type == "kubernetes_persistent_volume"
  msg := "delete_persistent_volume"
}

# HARD BLOCK: Never allow deletion of databases
deny[msg] {
  input.plan[_].action == "delete"
  contains(input.plan[_].type, "database")
  msg := "delete_database"
}

# HARD BLOCK: Never disable RLS policies
deny[msg] {
  input.plan[_].action == "update"
  input.plan[_].type == "postgresql_policy"
  input.plan[_].change.after.enabled == false
  msg := "modify_rls_policy"
}

# WARNING: Flag large-scale changes for extra review
warn[msg] {
  count([r | r := input.plan[_]; r.action == "create"]) > 10
  msg := "large_scale_creation"
}
`;

class EnhancedHITLApprovalGate {
  private policyGate: PolicyAsCodePreGate;
  private slack: SlackClient;
  
  async requestApproval(plan: TerraformPlan): Promise<ApprovalResult> {
    // STAGE 1: Policy validation BEFORE human sees anything
    const policyResult = await this.policyGate.validateBeforeHITL(plan);
    
    // Auto-reject if hard policy violations
    if (!policyResult.passed) {
      const hardBlocks = policyResult.violations.filter(v => v.autoReject);
      await this.slack.postMessage({
        channel: '#infrastructure-alerts',
        text: `🚫 Terraform plan AUTO-REJECTED by policy:\n${
          hardBlocks.map(v => `• ${v.message}`).join('\n')
        }`
      });
      return { approved: false, reason: 'policy_violation', violations: hardBlocks };
    }
    
    // STAGE 2: Human approval with risk context
    const riskEmoji = policyResult.riskScore > 70 ? '🔴' : 
                      policyResult.riskScore > 40 ? '🟡' : '🟢';
    
    const message = await this.slack.postMessage({
      channel: '#infrastructure-approvals',
      blocks: [
        { type: 'section', text: { text: `🔧 Terraform Plan Request` } },
        { type: 'section', text: { text: 
          `${riskEmoji} **Risk Score: ${policyResult.riskScore}/100**\n` +
          `💰 Cost Delta: +$${policyResult.estimatedCost.monthlyIncrease}/mo`
        }},
        { type: 'section', text: { text: plan.summary } },
        // Show any warnings (non-blocking violations)
        ...policyResult.violations.filter(v => !v.autoReject).map(v => ({
          type: 'section', text: { text: `⚠️ Warning: ${v.message}` }
        })),
        {
          type: 'actions',
          elements: [
            { type: 'button', text: 'Approve', action_id: 'approve', style: 'primary' },
            { type: 'button', text: 'Reject', action_id: 'reject', style: 'danger' }
          ]
        }
      ]
    });
    
    return this.waitForApproval(message.ts, 3600000);
  }
}
```

```
┌─────────────────────────────────────────────────────────────────────┐
│               POLICY-AS-CODE PRE-GATE                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   Loa Agent generates Terraform plan                                │
│                     │                                               │
│                     ▼                                               │
│   ┌─────────────────────────────────────┐                          │
│   │  STAGE 1: OPA Policy Check          │                          │
│   │  • Delete PV? → AUTO-REJECT         │                          │
│   │  • Delete DB? → AUTO-REJECT         │                          │
│   │  • Disable RLS? → AUTO-REJECT       │                          │
│   └─────────────────────────────────────┘                          │
│                     │                                               │
│              (if passed)                                            │
│                     ▼                                               │
│   ┌─────────────────────────────────────┐                          │
│   │  STAGE 2: Infracost Budget          │                          │
│   │  • >$5k/mo? → AUTO-REJECT           │                          │
│   │  • >$1k/mo? → FLAG for review       │                          │
│   └─────────────────────────────────────┘                          │
│                     │                                               │
│              (if passed)                                            │
│                     ▼                                               │
│   ┌─────────────────────────────────────┐                          │
│   │  STAGE 3: Risk Scoring              │                          │
│   │  • Calculate risk score 0-100       │                          │
│   │  • Add context for human review     │                          │
│   └─────────────────────────────────────┘                          │
│                     │                                               │
│                     ▼                                               │
│   ┌─────────────────────────────────────┐                          │
│   │  HITL: Human Approval               │                          │
│   │  (with risk context + warnings)     │                          │
│   │  🔴 High risk plans get extra       │                          │
│   │     scrutiny prompts                │                          │
│   └─────────────────────────────────────┘                          │
│                                                                     │
│   Result: Dangerous ops blocked BEFORE human fatigue kicks in       │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

VALIDATION:
  - No `terraform apply -auto-approve` in production
  - Dangerous operations blocked by OPA BEFORE human review
  - All infrastructure changes require human approval (for non-blocked ops)
  - Audit trail of approvals + policy decisions in Slack
```

### 10.3 Migration Timeline (v5.5.1 Audit-Complete)

> ✅ **15 Audit Rounds Complete** — All architectural concerns resolved. Infrastructure implementation ready.

| Phase | Weeks | Focus | Status | Audit Finding |
|-------|-------|-------|--------|---------------|
| **0** | 0-2 | Two-Tier Chain Provider + Circuit Breaker | ✅ **COMPLETE** | Score SPOF (R13, R14, R15) |
| **1** | 3-4 | Theme System + Validation | ✅ **COMPLETE** | Logic drift (R7, R8) |
| **2** | 5-8 | PostgreSQL + RLS + Regression Testing | 🚧 **READY** | SQLite + Schema debt (R1, R13, R15) |
| **3** | 9-10 | Redis + Hybrid State Model | 🚧 **READY** | Session + GitOps (R8, R13, R15) |
| **4** | 11-12 | BullMQ + Global Token Bucket | 🚧 **READY** | Discord 429 (R8, R13, R15) |
| **5** | 13-14 | Vault Transit + Kill Switch | 🚧 **READY** | Security (R8, R13) |
| **6** | 15-16 | OPA Pre-Gate + HITL + MFA | 🚧 **READY** | Approval fatigue (R14, R15) |

> 📊 **Implementation Readiness (15 Audit Rounds Complete)**:
> ```
> Architecture (Phases 0-1):   ████████████████████ 100% COMPLETE ✅
> FAANG Hardening (v5.4):      ████████████████████ 100% RESOLVED ✅
> Resilience (v5.5):           ████████████████████ 100% RESOLVED ✅
> Round 15 Verification:       ████████████████████ 100% PRE-ADDRESSED ✅
> Infrastructure (Phases 2-6): ░░░░░░░░░░░░░░░░░░░░   0% Ready to start 🚧
> ```

### 10.4 Recommended Cuts for MVP

> ⚠️ **v5.1 Reality Check**: Focus on core SaaS before features.

| Feature | Verdict | Rationale | v5.1 Status |
|---------|---------|-----------|-------------|
| **Self-hosted RPC Nodes** | 🔴 **CUT** | Score Service handles all blockchain data | ✅ Not needed |
| **Telegram Adapter** | 🔴 **CUT** | Discord-first until WizardEngine works | ❌ Not started |
| **Solana Adapter** | 🔴 **CUT** | Score Service can add later | ❌ Not started |
| **Custom Theme Builder** | 🟡 **DEFER** | Basic + Sietch themes sufficient for MVP | ✅ Basic + Sietch defined |
| **Weekly Digests (SaaS)** | 🟡 **DEFER** | Per-tenant scheduling adds complexity | ✅ Works for single tenant |
| **Full Agentic Terraform** | 🟡 **DEFER** | Start with HITL-gated changes only | 🚧 After HITL gate |

### 10.5 Anti-Patterns to Avoid

> 🚩 **Premature Abstraction**: Don't implement Ports/Adapters for services with only one implementation. Create the interface, but keep implementation simple until a second adapter is actually needed.

> 🚩 **Missing Idempotency**: Discord API operations (create channel, assign role) are not inherently idempotent. The Wizard must track operation IDs and handle partial failures:

```typescript
// BAD: No idempotency handling
await guild.channels.create({ name: 'general', type: ChannelType.GuildText });

// GOOD: Idempotent with existence check
const existing = guild.channels.cache.find(c => c.name === 'general');
if (!existing) {
  await guild.channels.create({ name: 'general', type: ChannelType.GuildText });
}
```

> 🚩 **Security Bypass Risk**: The Wizard must NOT bypass existing security checks:

```typescript
// CRITICAL: Preserve these checks from current implementation
class WizardSecurityGuard {
  async validateWizardInitiation(interaction: CommandInteraction): Promise<void> {
    // 1. Check Discord permissions (must be server admin)
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      throw new UnauthorizedError('Only server administrators can run the wizard');
    }
    
    // 2. Verify wallet ownership via Collab.Land signature
    // DO NOT skip this step even for "convenience"
    const walletVerified = await this.collabLand.verifyWallet(interaction.user.id);
    if (!walletVerified) {
      throw new UnauthorizedError('Wallet verification required before configuring token gating');
    }
  }
}
```

> 🚩 **Optimistic Concurrency**: Database operations during Wizard flow must use transactions:

```typescript
// BAD: Race condition if user clicks twice
await db.insert('communities', communityData);
await db.insert('roles', roleData);

// GOOD: Atomic transaction
await db.transaction(async (tx) => {
  await tx.insert('communities', communityData);
  await tx.insert('roles', roleData);
});
```

### 10.5 Backward Compatibility

The existing Sietch community must continue operating unchanged during migration. A compatibility layer wraps the new architecture to present the same API surface to existing integrations.

```typescript
// Compatibility shim for existing /eligibility/:address endpoint
app.get('/eligibility/:address', async (req, res) => {
  const manifest = await loadManifest('sietch-arrakis');
  const evaluator = new EligibilityEvaluator(manifest);
  const result = await evaluator.check(req.params.address);
  
  // Transform to legacy response format
  res.json({
    eligible: result.eligible,
    tier: result.role?.name,
    rank: result.rank
  });
});
```

---

## 11. Technical Specifications

### 11.1 Technology Stack

| Category | Current | Target (MVP) | Target (Post-MVP) |
|----------|---------|--------------|-------------------|
| Runtime | Node.js 20 | Node.js 22 LTS | Node.js 22 LTS |
| Language | TypeScript 5.x | TypeScript 5.x (strict) | TypeScript 5.x (strict) |
| Database | SQLite | SQLite + PostgreSQL | PostgreSQL (primary) |
| EVM Client | viem | viem (via IChainProvider) | viem + multi-chain adapters |
| Discord | discord.js v14 | discord.js v14 (via adapter) | discord.js + Telegram |
| Scheduler | trigger.dev | trigger.dev | trigger.dev + Temporal |
| Testing | 141 tests (Vitest) | 200+ tests (Vitest) | 250+ tests (Vitest + Playwright E2E) |

### 11.2 API Surface

The SaaS platform exposes APIs at multiple levels:

- **Public API:** Health, eligibility checks (rate-limited, no auth)
- **Authenticated API:** Directory, profiles, activity (JWT auth)
- **Admin API:** Sync triggers, badge evaluation, manifest deployment (API key)
- **Internal API:** Inter-service communication (mTLS)

> ⚠️ **Audit Finding**: The REST API needs global rate limiting to prevent one "malicious" tenant from exhausting the shared RPC node pool.

```typescript
// Hono-based rate limiting middleware
import { Hono } from 'hono';
import { rateLimiter } from 'hono-rate-limiter';

const app = new Hono();

// Global rate limit: 100 requests per minute per IP
app.use('*', rateLimiter({
  windowMs: 60 * 1000,
  limit: 100,
  keyGenerator: (c) => c.req.header('x-forwarded-for') || 'unknown',
  handler: (c) => c.json({ error: 'Rate limit exceeded' }, 429)
}));

// Tenant-specific rate limit: 1000 requests per hour
app.use('/api/*', rateLimiter({
  windowMs: 60 * 60 * 1000,
  limit: 1000,
  keyGenerator: (c) => c.get('tenantId') || 'unknown',
  handler: (c) => c.json({ error: 'Tenant quota exceeded' }, 429)
}));

// Expensive operations: 10 per minute (eligibility syncs, TGR registrations)
app.use('/admin/sync', rateLimiter({
  windowMs: 60 * 1000,
  limit: 10,
  keyGenerator: (c) => c.get('tenantId') || 'unknown'
}));
```

### 11.3 Infrastructure Requirements

**MVP (Recommended by Audit):**
- **Compute:** 2× VPS (primary + hot standby), 4 vCPU, 8GB RAM each
- **Database:** Managed PostgreSQL with point-in-time recovery
- **Cache:** Redis for session state, wizard progress, rate limiting
- **RPC:** Hosted providers (Alchemy/Infura) — self-hosting deferred post-MVP
- **Secrets:** 1Password or Doppler for initial secret management
- **CDN:** Cloudflare for API edge caching and DDoS protection

**Post-MVP Scale (Phase 5+):**
- **Compute:** Kubernetes cluster (GKE/EKS) with auto-scaling node pools
- **RPC Nodes:** Self-hosted with 2TB+ SSDs (Ethereum ×3, Polygon ×2, Arbitrum ×2, Berachain ×2)
- **Secrets:** HCP Vault for credential management with dynamic rotation
- **IaC:** Terraform with remote state locking (GCS/S3 + DynamoDB)
- **Monitoring:** Cloud Trace, BigQuery Agent Analytics, Alertmanager

---

## 12. Infrastructure-as-Code (Terraform)

To ensure Arrakis SaaS can be fully operated as code, the architecture transitions from manual cloud configurations to **Terraform-managed Infrastructure-as-Code (IaC)**. This allows the system to define not only its business logic but also its underlying hardware, networking, and scaling rules through versioned scripts.

### 12.1 IaC Module Requirements

To support high-traffic demands and custom RPC requirements, the Terraform configuration must include:

| Module | Purpose | Specification |
|--------|---------|---------------|
| **Kubernetes Orchestration** | Primary compute layer for Sapphire bot and Sietch Service | Dedicated GKE (Google) or EKS (AWS) cluster |
| **Persistent Volume Management** | Blockchain node storage | High-performance SSDs, ≥2TB per Ethereum/Polygon node |
| **Networking & Load Balancing** | Traffic distribution and redundancy | 3x Ethereum nodes, 2x each for Polygon/Arbitrum/Optimism |
| **Secret Management** | Credential security | HCP Vault integration for `PRIVATE_KEY`, `BUNDLER_URL` |

### 12.2 Terraform Module Structure

```hcl
# terraform/main.tf
module "kubernetes" {
  source       = "./modules/kubernetes"
  cluster_name = var.cluster_name
  node_pools   = var.node_pools
  region       = var.region
}

module "blockchain_nodes" {
  source = "./modules/blockchain-nodes"
  
  chains = {
    ethereum = {
      node_count   = 3
      disk_size_gb = 2048
      disk_type    = "pd-ssd"
    }
    polygon = {
      node_count   = 2
      disk_size_gb = 2048
      disk_type    = "pd-ssd"
      depends_on   = ["ethereum"]  # Requires synced Eth node
    }
    arbitrum = {
      node_count   = 2
      disk_size_gb = 1024
      disk_type    = "pd-ssd"
    }
    berachain = {
      node_count   = 2
      disk_size_gb = 512
      disk_type    = "pd-ssd"
    }
  }
}

module "vault" {
  source = "./modules/vault"
  
  secrets = [
    "discord-bot-token",
    "collab-land-api-key",
    "bundler-private-key",
    "rpc-endpoints"
  ]
  
  # Transit engine for wallet private key encryption at rest
  transit_keys = [
    "tenant-wallet-keys",
    "bundler-signing-keys"
  ]
  
  # Dynamic secrets - bot never holds long-lived keys
  dynamic_secrets = {
    enabled = true
    ttl     = "1h"  # Secrets expire and rotate automatically
    max_ttl = "24h"
  }
}

# > 🚨 **Critical Audit Finding**: Move `PRIVATE_KEY` and `BUNDLER_URL` from `.env` 
# > to **HCP Vault** with **dynamic secrets**. The bot should NEVER hold a decrypted 
# > private key in memory—it should send payloads to Vault to be signed.
# >
# > **Implementation Requirements:**
# > - Transit engine for signing operations (key never leaves Vault)
# > - Dynamic secrets with 1-hour TTL for runtime credentials
# > - Auto-rotation on every deployment
# > - Audit logging of all signing operations

# Example: Vault Transit signing (key never exposed to application)
# vault write transit/sign/bundler-key input=$(base64 <<< "transaction_payload")
```

```typescript
// Vault Transit integration - bot never sees the private key
import { VaultClient } from '@hashicorp/vault-client';

class VaultTransitSigner implements ITransactionSigner {
  private vault: VaultClient;
  private keyName: string;
  
  constructor(vaultAddr: string, keyName: string) {
    this.vault = new VaultClient({ address: vaultAddr });
    this.keyName = keyName;
  }
  
  async signTransaction(txPayload: Uint8Array): Promise<Uint8Array> {
    // Send payload to Vault - private key NEVER leaves Vault
    const response = await this.vault.write(`transit/sign/${this.keyName}`, {
      input: Buffer.from(txPayload).toString('base64'),
      signature_algorithm: 'ecdsa-p256'
    });
    
    return Buffer.from(response.data.signature, 'base64');
  }
  
  // For ERC-4337 UserOperations
  async signUserOp(userOp: UserOperation): Promise<string> {
    const hash = this.hashUserOp(userOp);
    const signature = await this.signTransaction(hash);
    return `0x${Buffer.from(signature).toString('hex')}`;
  }
}

// Usage: Bot never handles private keys directly
const signer = new VaultTransitSigner(
  process.env.VAULT_ADDR,
  'bundler-signing-key'
);
const signedTx = await signer.signTransaction(txPayload);
```

```hcl
module "monitoring" {
  source = "./modules/monitoring"
  
  enable_cloud_trace    = true
  enable_bigquery_agent = true
  alert_channels        = var.alert_channels
}
```

### 12.3 Loa Framework Integration

The "as-code" operation is completed by automating the Terraform lifecycle using Loa framework's specialised agents.

> ⚠️ **Audit Finding**: High blast radius. Without a mandatory **Human-in-the-loop (HITL)** gate, an AI hallucination could delete production volumes. The agent must NOT use `-auto-approve` for production deployments.

```typescript
// .claude/commands/deploy-production.md integration
interface TerraformDeploymentHook {
  // Triggered after SDD validation by architect agent
  async onManifestSynthesized(manifest: CommunityManifest): Promise<void> {
    // 1. Generate Terraform variables from manifest
    const tfvars = this.generateTfVars(manifest);
    await fs.writeFile('terraform/tenant.auto.tfvars', tfvars);
    
    // 2. Run Terraform plan via Claude Agent SDK bash tool
    const plan = await this.agent.bash('terraform plan -out=tfplan');
    
    // 3. Validate cost estimation
    const cost = await this.agent.bash('infracost breakdown --path=tfplan');
    if (cost.monthlyCost > manifest.budget.maxMonthly) {
      throw new BudgetExceededError(cost, manifest.budget);
    }
    
    // 4. CRITICAL: Human-in-the-loop approval for production
    if (manifest.environment === 'production') {
      const approval = await this.requestHumanApproval({
        plan: plan.stdout,
        cost: cost.monthlyCost,
        changes: this.parsePlanChanges(plan.stdout)
      });
      
      if (!approval.approved) {
        throw new DeploymentRejectedError(approval.reason);
      }
    }
    
    // 5. Apply infrastructure changes (auto-approve only for non-prod)
    const autoApprove = manifest.environment !== 'production' ? '-auto-approve' : '';
    await this.agent.bash(`terraform apply ${autoApprove} tfplan`);
  }
  
  private async requestHumanApproval(context: ApprovalContext): Promise<ApprovalResult> {
    // Post to Slack #infrastructure-approvals channel
    const message = await this.slack.postMessage({
      channel: '#infrastructure-approvals',
      blocks: [
        { type: 'header', text: { type: 'plain_text', text: '🚀 Terraform Deployment Approval Required' }},
        { type: 'section', text: { type: 'mrkdwn', text: `*Changes:* ${context.changes.summary}` }},
        { type: 'section', text: { type: 'mrkdwn', text: `*Estimated Cost:* $${context.cost}/month` }},
        { type: 'actions', elements: [
          { type: 'button', text: { type: 'plain_text', text: '✅ Approve' }, action_id: 'approve', style: 'primary' },
          { type: 'button', text: { type: 'plain_text', text: '❌ Reject' }, action_id: 'reject', style: 'danger' }
        ]}
      ]
    });
    
    // Wait for human response (timeout: 1 hour)
    return this.waitForApproval(message.ts, 3600000);
  }
}
```

**Agent Responsibilities:**

1. **DevOps Engineer Agent:** Orchestrates `terraform plan` and `terraform apply` commands
2. **Security Auditor Agent:** Validates Vault secret configurations before deployment
3. **Software Architect Agent:** Reviews Terraform module changes for architectural compliance

### 12.4 Implementation Risk Assessment

| Component | Difficulty | Auditor Notes |
|-----------|------------|---------------|
| **Multi-chain RPC Pools** | **Extreme Toil** | **"Death trap"** — Disk-full events require full node rebuilds. ~10 hrs/week operational overhead. **Use hosted providers for MVP.** |
| **Elastic Bot Scaling** | Medium | Bot logic must be stateless (Redis-backed) for horizontal Kubernetes scaling |
| **Automated Secret Rotation** | Low | Terraform provisions Vault secrets; Sietch Service refactored for dynamic key retrieval |
| **Synthesis-Triggered IaC** | Medium | Wizard must output valid `.tfvars` for Loa agent interpretation |
| **Agentic Terraform Apply** | **High** | Without HITL gate, AI hallucination could delete production volumes. Mandatory human approval added. |

### 12.5 Required Operational Components

#### State Locking

> ⚠️ **Audit Finding**: If two Loa agents attempt a deployment simultaneously, you will corrupt the infrastructure state. Terraform must use a remote backend with **State Locking** via DynamoDB.

Terraform requires a remote backend with state locking to prevent concurrent deployments:

```hcl
# terraform/backend.tf
terraform {
  backend "gcs" {
    bucket = "arrakis-terraform-state"
    prefix = "saas/production"
  }
}

# Or for AWS
terraform {
  backend "s3" {
    bucket         = "arrakis-terraform-state"
    key            = "saas/production/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "arrakis-terraform-locks"
    encrypt        = true
  }
}
```

#### Cost Guardrails

For SaaS multi-tenancy, Terraform includes cost estimation hooks:

```hcl
# Infracost policy check in CI/CD
resource "null_resource" "cost_check" {
  triggers = {
    always_run = timestamp()
  }
  
  provisioner "local-exec" {
    command = <<-EOT
      infracost breakdown --path . --format json > /tmp/cost.json
      MONTHLY_COST=$(jq '.totalMonthlyCost' /tmp/cost.json)
      if (( $(echo "$MONTHLY_COST > ${var.tenant_budget}" | bc -l) )); then
        echo "ERROR: Estimated cost $MONTHLY_COST exceeds tenant budget ${var.tenant_budget}"
        exit 1
      fi
    EOT
  }
}
```

#### Disaster Recovery Module

Dormant node set in alternate region for rapid failover:

```hcl
module "disaster_recovery" {
  source = "./modules/dr"
  
  enabled        = var.dr_enabled
  primary_region = var.region
  dr_region      = var.dr_region
  
  # Maintain synced but dormant nodes
  node_state = "stopped"
  
  # Sync configuration
  snapshot_schedule = "0 */6 * * *"  # Every 6 hours
  retention_days    = 7
}
```

### 12.6 Migration Path (File Specific)

| Step | Action | Files Affected |
|------|--------|----------------|
| **1** | Create Terraform directory structure | `terraform/`, `terraform/modules/` |
| **2** | Move hardcoded RPC URLs from `.env` to Terraform variables | `.env` → `terraform/variables.tf` |
| **3** | Containerise Sietch Service | `sietch-service/Dockerfile`, `docker-compose.yml` |
| **4** | Implement Loa Infrastructure Hook | `.claude/commands/deploy-production.md` |
| **5** | Provision monitoring stack | `terraform/modules/monitoring/` |
| **6** | Configure remote state backend | `terraform/backend.tf` |

---

## Appendix A: Full Manifest Schema

Complete JSON Schema for community manifests is available in the repository at `/schemas/community-manifest.schema.json`. Key validation rules include:

- Asset addresses must be valid for their declared chain type
- Eligibility criteria must reference defined assets
- Role permissions must be subsets of parent category permissions
- Channel access lists must reference defined roles

---

## Appendix B: Dune Naming Reference

Following the existing codebase's Dune-inspired naming convention:

| Term | Dune Meaning | System Usage |
|------|--------------|--------------|
| **Arrakis** | Desert planet, source of spice | Platform name, root namespace |
| **Sietch** | Hidden Fremen community | Community instance, server |
| **Naib** | Sietch leader | Top-tier admin role |
| **Fedaykin** | Elite Fremen warriors | Standard member role |
| **Stillsuit** | Water-preserving garment | Info/rules category |
| **Spice** | Most valuable substance | Alpha/insights channel |
| **Windtrap** | Device for extracting water | Operations/support category |
| **Water-discipline** | Fremen conservation practice | Rules channel |

---

## Appendix C: Directory Structure

```
arrakis/
├── packages/
│   ├── core/                    # Domain layer
│   │   ├── entities/
│   │   │   ├── Asset.ts
│   │   │   ├── Community.ts
│   │   │   ├── Role.ts
│   │   │   └── EligibilityCriteria.ts
│   │   ├── ports/
│   │   │   ├── IChainProvider.ts
│   │   │   ├── IPlatformProvider.ts
│   │   │   └── ITGRProvider.ts
│   │   └── services/
│   │       ├── EligibilityEvaluator.ts
│   │       └── ManifestSynthesizer.ts
│   │
│   ├── adapters/                # Infrastructure layer
│   │   ├── chains/
│   │   │   ├── EVMChainAdapter.ts
│   │   │   └── SolanaChainAdapter.ts
│   │   ├── platforms/
│   │   │   ├── DiscordPlatformAdapter.ts
│   │   │   └── TelegramPlatformAdapter.ts
│   │   └── integrations/
│   │       └── CollabLandTGRAdapter.ts
│   │
│   ├── wizard/                  # Service layer
│   │   ├── WizardEngine.ts
│   │   ├── states/
│   │   │   ├── InitState.ts
│   │   │   ├── ChainSelectState.ts
│   │   │   └── ...
│   │   └── templates/
│   │       ├── sietch.yaml
│   │       ├── standard.yaml
│   │       └── minimal.yaml
│   │
│   └── api/                     # REST endpoints
│       ├── public/
│       ├── authenticated/
│       └── admin/
│
├── schemas/
│   └── community-manifest.schema.json
│
├── manifests/                   # Deployed community configs
│   └── sietch-arrakis.yaml
│
├── terraform/                   # Infrastructure-as-Code
│   ├── main.tf                  # Root module
│   ├── variables.tf             # Input variables
│   ├── outputs.tf               # Output values
│   ├── backend.tf               # Remote state config
│   ├── versions.tf              # Provider versions
│   │
│   ├── modules/
│   │   ├── kubernetes/          # GKE/EKS cluster
│   │   │   ├── main.tf
│   │   │   ├── variables.tf
│   │   │   └── outputs.tf
│   │   │
│   │   ├── blockchain-nodes/    # Self-hosted RPC nodes
│   │   │   ├── main.tf
│   │   │   ├── ethereum.tf
│   │   │   ├── polygon.tf
│   │   │   ├── arbitrum.tf
│   │   │   └── berachain.tf
│   │   │
│   │   ├── vault/               # HCP Vault secrets
│   │   │   ├── main.tf
│   │   │   └── policies.tf
│   │   │
│   │   ├── monitoring/          # Observability stack
│   │   │   ├── cloud-trace.tf
│   │   │   ├── bigquery.tf
│   │   │   └── alerting.tf
│   │   │
│   │   └── dr/                  # Disaster recovery
│   │       ├── main.tf
│   │       └── snapshots.tf
│   │
│   └── environments/
│       ├── dev.tfvars
│       ├── staging.tfvars
│       └── production.tfvars
│
├── docker/
│   ├── sietch-service/
│   │   └── Dockerfile
│   ├── sapphire-bot/
│   │   └── Dockerfile
│   └── docker-compose.yml
│
└── .claude/
    └── commands/
        ├── deploy-production.md  # Loa agent deployment hook
        └── validate-terraform.md # IaC validation command
```

---

*— End of Document —*

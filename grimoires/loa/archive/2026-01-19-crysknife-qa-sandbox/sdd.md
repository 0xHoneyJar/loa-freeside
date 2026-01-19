# Software Design Document: QA Sandbox Testing System

**Version:** 1.0 "Crysknife"
**Date:** 2026-01-19
**Author:** Architecture Designer Agent
**Status:** DRAFT - Pending Approval
**PRD Reference:** grimoires/loa/prd.md (QA Sandbox Testing System v1.0)
**Cycle:** cycle-003

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current State Architecture](#2-current-state-architecture)
3. [Target State Architecture](#3-target-state-architecture)
4. [New Components](#4-new-components)
5. [Data Architecture](#5-data-architecture)
6. [API Design](#6-api-design)
7. [Integration Points](#7-integration-points)
8. [Security Considerations](#8-security-considerations)
9. [Observability](#9-observability)
10. [Development Phases](#10-development-phases)
11. [Technical Risks & Mitigation](#11-technical-risks--mitigation)
12. [Appendix](#12-appendix)

---

## 1. Executive Summary

### 1.1 Document Purpose

This SDD specifies the technical architecture for the **QA Sandbox Testing System** (Codename: Crysknife), a testing and simulation framework that enables QA engineers, theme developers, and automated agents to verify permission logic within sandbox environments.

### 1.2 Scope

| Feature | Description |
|---------|-------------|
| **Role Assumption** | Assume any tier (naib through hajra) for permission testing |
| **State Configuration** | Override BGT, rank, engagement, activity values |
| **Permission Verification** | Check channel/feature access, tier computation, badges |
| **Threshold Override** | Configure tier/BGT thresholds for edge case testing |
| **Dual Interface** | Discord slash commands for humans, REST API for agents |

### 1.3 Design Principles

1. **Production Parity** - Use identical evaluation logic (TierEvaluator, ProgressiveGate)
2. **Isolation First** - All simulation state scoped to sandbox, no cross-contamination
3. **Stateless Core** - SimulationContext held in Redis, evaluators remain stateless
4. **Theme Agnostic** - Support current SietchTheme and future themes via IThemeProvider
5. **API First** - Design for agents, then wrap with Discord UI

### 1.4 Key Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Permission Check Latency | <100ms p95 | API response time |
| State Update Latency | <50ms p95 | Redis write + validation |
| Production Parity | 100% | Integration test suite |
| API Coverage | 100% FR-1 through FR-4 | Feature parity audit |

---

## 2. Current State Architecture

### 2.1 Existing Components

The following components exist and will be leveraged:

```
themes/sietch/src/
├── packages/
│   ├── core/
│   │   ├── ports/
│   │   │   └── IThemeProvider.ts       # Theme interface (TierConfig, BadgeConfig, etc.)
│   │   └── services/
│   │       └── TierEvaluator.ts        # Stateless tier evaluation
│   └── adapters/
│       └── themes/
│           └── SietchTheme.ts          # 9-tier Dune-themed implementation
├── services/
│   └── discord/
│       └── progressive-gate/
│           └── ProgressiveGate.ts      # 3-stage engagement system
└── config.ts                           # Configuration with thresholds

packages/sandbox/src/
├── services/
│   └── sandbox-manager.ts              # Sandbox lifecycle management
└── routes/
    └── sandbox.routes.ts               # Existing sandbox API routes
```

### 2.2 TierEvaluator (Existing)

```typescript
// themes/sietch/src/packages/core/services/TierEvaluator.ts
export class TierEvaluator {
  /**
   * Evaluate tier for a single rank using a theme
   */
  evaluate(
    theme: IThemeProvider,
    rank: number,
    totalHolders?: number,
    options?: TierEvaluationOptions
  ): TierResult;

  /**
   * Evaluate using a specific strategy (without theme)
   */
  evaluateWithConfig(
    config: TierConfig,
    rank: number,
    totalHolders?: number
  ): TierResult;
}
```

### 2.3 ProgressiveGate (Existing)

```typescript
// themes/sietch/src/services/discord/progressive-gate/ProgressiveGate.ts
export const STAGES = {
  FREE: 'free',
  ENGAGED: 'engaged',
  VERIFIED: 'verified',
} as const;

export const STAGE_THRESHOLDS = {
  FREE_MIN: 0,
  ENGAGED_MIN: 50,
} as const;

export const BLUR_LEVELS = {
  FREE: 0.8,
  ENGAGED: 0.3,
  VERIFIED: 0,
} as const;
```

### 2.4 SietchTheme (Existing)

```typescript
// themes/sietch/src/packages/adapters/themes/SietchTheme.ts
export const BGT_THRESHOLDS = {
  hajra: 6.9,
  ichwan: 69,
  qanat: 222,
  sihaya: 420,
  mushtamal: 690,
  sayyadina: 888,
  usul: 1111,
} as const;

export const RANK_BOUNDARIES = {
  naib: { min: 1, max: 7 },
  fedaykin: { min: 8, max: 69 },
} as const;

// 9 tiers with permissions:
// naib: ['view_all', 'council_access', 'vote', 'govern', 'naib_ceremony']
// fedaykin: ['view_all', 'vote', 'elite_access', 'water_share']
// ... etc
```

### 2.5 Sandbox Infrastructure (Existing)

```typescript
// packages/sandbox/src/services/sandbox-manager.ts
export interface SandboxManagerConfig {
  sql: postgres.Sql;
  logger: Logger;
  defaultTtlHours?: number;
  maxTtlHours?: number;
}

export class SandboxManager {
  async create(options: CreateSandboxOptions): Promise<SandboxCreateResult>;
  async getById(id: string): Promise<Sandbox | null>;
  async destroy(sandboxId: string, actor: string): Promise<void>;
}
```

---

## 3. Target State Architecture

### 3.1 Component Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                    QA Sandbox Testing Layer                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────────┐    ┌──────────────────┐   ┌────────────────┐  │
│  │ Discord Commands │    │    REST API      │   │  Agent SDK     │  │
│  │ /simulation ...  │    │  /sandbox/:id/   │   │  Interface     │  │
│  └────────┬─────────┘    └────────┬─────────┘   └───────┬────────┘  │
│           │                       │                      │           │
│           └───────────────────────┼──────────────────────┘           │
│                                   ▼                                  │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │                    SimulationService (NEW)                      │ │
│  │  - assumeRole(sandboxId, tierId)                               │ │
│  │  - setState(sandboxId, state)                                  │ │
│  │  - checkPermission(sandboxId, type, target)                    │ │
│  │  - configureThresholds(sandboxId, overrides)                   │ │
│  └─────────────────────────────┬──────────────────────────────────┘ │
│                                │                                     │
│           ┌────────────────────┼────────────────────┐               │
│           ▼                    ▼                    ▼               │
│  ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐    │
│  │SimulationContext │ │  TierEvaluator   │ │ ProgressiveGate  │    │
│  │   (NEW - Redis)  │ │   (EXISTING)     │ │   (EXISTING)     │    │
│  └──────────────────┘ └──────────────────┘ └──────────────────┘    │
│                                                                      │
│  ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐    │
│  │   SietchTheme    │ │  ChannelTemplate │ │  BadgeEvaluator  │    │
│  │   (EXISTING)     │ │   (EXISTING)     │ │   (EXISTING)     │    │
│  └──────────────────┘ └──────────────────┘ └──────────────────┘    │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Existing Sandbox Infrastructure                   │
│  - Redis namespace: sandbox:{id}:simulation                         │
│  - TTL matches sandbox TTL (auto-cleanup)                           │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2 Data Flow: Permission Check

```
User Request: "/simulation check access #war-room"
       │
       ▼
┌──────────────────┐
│ SimulationService│
│ checkPermission()│
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Load Context     │ ─── Redis: sandbox:{id}:simulation
│ from Redis       │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐     ┌──────────────────┐
│ Determine Tier   │────▶│ TierEvaluator    │
│ IF assumedRole:  │     │ .evaluate()      │
│   use directly   │     └──────────────────┘
│ ELSE:            │
│   compute from   │
│   simulatedState │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐     ┌──────────────────┐
│ Load Channel     │────▶│ SietchTheme      │
│ Definition       │     │ .getChannelTemplate() │
└────────┬─────────┘     └──────────────────┘
         │
         ▼
┌──────────────────┐
│ Compare Tier     │
│ vs Required Tier │
│ + Blur Level     │
└────────┬─────────┘
         │
         ▼
┌──────────────────────────────────────────┐
│ AccessCheckResult                        │
│ {                                        │
│   allowed: true,                         │
│   effectiveTier: "fedaykin",             │
│   requiredTier: "fedaykin",              │
│   blurLevel: 0,                          │
│   permissions: ["view_all", "vote", ...] │
│ }                                        │
└──────────────────────────────────────────┘
```

### 3.3 Data Flow: State Configuration

```
User Request: "/simulation set bgt 500"
       │
       ▼
┌──────────────────┐
│ SimulationService│
│ setState()       │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Validate Input   │ ─── bgt >= 0, rank >= 1, stage ∈ {free,engaged,verified}
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Load Context     │ ─── Redis GET sandbox:{id}:simulation
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Merge Updates    │ ─── { ...existing, bgtBalance: 500 }
│ Update timestamp │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Save Context     │ ─── Redis SET with TTL
└────────┬─────────┘
         │
         ▼
┌──────────────────────────────────────────┐
│ StateUpdateResult                        │
│ {                                        │
│   updated: ["bgtBalance"],               │
│   newState: { bgtBalance: 500, ... },    │
│   computedTier: "sihaya"                 │
│ }                                        │
└──────────────────────────────────────────┘
```

---

## 4. New Components

### 4.1 SimulationContext Interface

**Location:** `themes/sietch/src/services/sandbox/simulation-context.ts`

**Purpose:** Core data structure for maintaining simulated state within a sandbox.

```typescript
/**
 * SimulationContext - Core Simulation State
 *
 * Sprint S-QA-1: SimulationContext Data Model
 *
 * Represents the complete simulation state for a sandbox session.
 * Stored in Redis with sandbox namespace, TTL matches sandbox TTL.
 *
 * @see PRD §4.2 SimulationContext
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Assumed role state
 */
export interface AssumedRole {
  /** Tier ID (e.g., "fedaykin") */
  tierId: string;
  /** Display name (e.g., "Fedaykin") */
  tierName: string;
  /** Permissions inherited from tier */
  permissions: string[];
  /** When role was assumed */
  assumedAt: Date;
}

/**
 * Simulated member state
 */
export interface SimulatedMemberState {
  // Core attributes
  /** Simulated wallet address */
  address: string;
  /** Simulated leaderboard position (1 = top) */
  rank: number;
  /** Simulated BGT holdings */
  bgtBalance: number;

  // Engagement system
  /** Current engagement stage */
  engagementStage: 'free' | 'engaged' | 'verified';
  /** Engagement points (for stage progression) */
  engagementPoints: number;

  // Activity/tenure
  /** Activity score */
  activityScore: number;
  /** Conviction score */
  convictionScore: number;
  /** Days since first claim */
  tenureDays: number;

  // Timestamps
  /** Simulated first claim date */
  firstClaimAt: Date | null;
  /** Simulated last activity date */
  lastActivityAt: Date | null;
}

/**
 * Threshold overrides for testing edge cases
 */
export interface ThresholdOverrides {
  /** Tier definition overrides (partial) */
  tiers: Map<string, Partial<TierOverride>>;
  /** BGT threshold overrides */
  bgt: Map<string, number>;
  /** Engagement threshold overrides */
  engagement: {
    engagedMin?: number;
    rateLimit?: number;
  };
}

/**
 * Partial tier override
 */
export interface TierOverride {
  minRank?: number;
  maxRank?: number | null;
  permissions?: string[];
}

/**
 * Complete simulation context
 */
export interface SimulationContext {
  /** Sandbox ID this context belongs to */
  sandboxId: string;

  /** Assumed role (null = use computed tier from state) */
  assumedRole: AssumedRole | null;

  /** Simulated member state */
  simulatedState: SimulatedMemberState;

  /** Threshold overrides */
  thresholdOverrides: ThresholdOverrides;

  /** Active theme ID */
  themeId: string;

  /** Session metadata */
  createdAt: Date;
  lastAccessedAt: Date;
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create default simulated member state
 */
export function createDefaultMemberState(): SimulatedMemberState {
  return {
    address: '0x' + '0'.repeat(40),
    rank: 1000,
    bgtBalance: 0,
    engagementStage: 'free',
    engagementPoints: 0,
    activityScore: 0,
    convictionScore: 0,
    tenureDays: 0,
    firstClaimAt: null,
    lastActivityAt: null,
  };
}

/**
 * Create default threshold overrides (empty)
 */
export function createDefaultThresholdOverrides(): ThresholdOverrides {
  return {
    tiers: new Map(),
    bgt: new Map(),
    engagement: {},
  };
}

/**
 * Create new simulation context for a sandbox
 */
export function createSimulationContext(sandboxId: string): SimulationContext {
  const now = new Date();
  return {
    sandboxId,
    assumedRole: null,
    simulatedState: createDefaultMemberState(),
    thresholdOverrides: createDefaultThresholdOverrides(),
    themeId: 'sietch',
    createdAt: now,
    lastAccessedAt: now,
  };
}
```

### 4.2 SimulationService

**Location:** `themes/sietch/src/services/sandbox/simulation-service.ts`

**Purpose:** Core service orchestrating all simulation operations.

```typescript
/**
 * SimulationService - QA Sandbox Testing Service
 *
 * Sprint S-QA-2 through S-QA-4: Core Simulation Operations
 *
 * Provides the unified interface for role assumption, state configuration,
 * and permission checking within sandbox environments.
 *
 * @see PRD §3.1 Core Features (MVP)
 */
import { createLogger, type ILogger } from '../../packages/infrastructure/logging/index.js';
import type { MinimalRedis } from '../../packages/adapters/redis/minimal-redis.js';
import type { IThemeProvider, TierConfig, TierResult } from '../../packages/core/ports/IThemeProvider.js';
import { TierEvaluator, createTierEvaluator } from '../../packages/core/services/TierEvaluator.js';
import { sietchTheme, SIETCH_TIERS } from '../../packages/adapters/themes/SietchTheme.js';
import {
  type SimulationContext,
  type SimulatedMemberState,
  type ThresholdOverrides,
  type AssumedRole,
  createSimulationContext,
} from './simulation-context.js';

// =============================================================================
// Configuration
// =============================================================================

export interface SimulationServiceConfig {
  redis: MinimalRedis;
  logger?: ILogger;
  /** Default theme provider */
  defaultTheme?: IThemeProvider;
  /** Context TTL in seconds (default: matches sandbox TTL) */
  contextTtlSeconds?: number;
}

const REDIS_KEY_PREFIX = 'sandbox:simulation:';
const DEFAULT_TTL_SECONDS = 24 * 60 * 60; // 24 hours

// =============================================================================
// Result Types
// =============================================================================

export interface AccessCheckResult {
  /** Whether access is allowed */
  allowed: boolean;
  /** User's effective tier */
  effectiveTier: string;
  /** Tier display name */
  effectiveTierName: string;
  /** Required tier for access */
  requiredTier: string | null;
  /** Blur level (0 = none, 0.3 = light, 0.8 = heavy) */
  blurLevel: number;
  /** Reason for denial (if denied) */
  reason?: string;
  /** Permissions at effective tier */
  permissions: string[];
  /** Current engagement stage */
  engagementStage: string;
}

export interface TierCheckResult {
  /** Computed tier ID */
  tierId: string;
  /** Tier display name */
  tierName: string;
  /** Tier color */
  roleColor: string;
  /** Rank within tier */
  rankInTier?: number;
  /** How tier was determined */
  source: 'assumed' | 'computed';
  /** State values used for computation */
  computedFrom: {
    rank: number;
    bgtBalance: number;
  };
}

export interface StateUpdateResult {
  /** Fields that were updated */
  updated: string[];
  /** New complete state */
  newState: SimulatedMemberState;
  /** Computed tier after update */
  computedTier: TierCheckResult;
}

export interface BadgeCheckResult {
  /** Badge ID */
  badgeId: string;
  /** Badge display name */
  badgeName: string;
  /** Badge emoji */
  emoji: string;
  /** Whether badge is earned */
  eligible: boolean;
  /** Reason for eligibility */
  reason: string;
}

// =============================================================================
// Implementation
// =============================================================================

export class SimulationService {
  private readonly logger: ILogger;
  private readonly redis: MinimalRedis;
  private readonly tierEvaluator: TierEvaluator;
  private readonly defaultTheme: IThemeProvider;
  private readonly contextTtlSeconds: number;

  constructor(config: SimulationServiceConfig) {
    this.redis = config.redis;
    this.logger = config.logger ?? createLogger({ service: 'SimulationService' });
    this.tierEvaluator = createTierEvaluator();
    this.defaultTheme = config.defaultTheme ?? sietchTheme;
    this.contextTtlSeconds = config.contextTtlSeconds ?? DEFAULT_TTL_SECONDS;
  }

  // ===========================================================================
  // Context Management
  // ===========================================================================

  /**
   * Get or create simulation context for a sandbox
   */
  async getContext(sandboxId: string): Promise<SimulationContext> {
    const key = this.getRedisKey(sandboxId);
    const cached = await this.redis.get(key);

    if (cached) {
      const context = this.deserializeContext(cached);
      context.lastAccessedAt = new Date();
      await this.saveContext(context);
      return context;
    }

    // Create new context
    const context = createSimulationContext(sandboxId);
    await this.saveContext(context);
    return context;
  }

  /**
   * Save simulation context to Redis
   */
  private async saveContext(context: SimulationContext): Promise<void> {
    const key = this.getRedisKey(context.sandboxId);
    const serialized = this.serializeContext(context);
    await this.redis.set(key, serialized, 'EX', this.contextTtlSeconds);
  }

  /**
   * Reset simulation context to defaults
   */
  async resetContext(sandboxId: string): Promise<SimulationContext> {
    const context = createSimulationContext(sandboxId);
    await this.saveContext(context);
    this.logger.info({ sandboxId }, 'Simulation context reset');
    return context;
  }

  // ===========================================================================
  // Role Assumption (FR-1)
  // ===========================================================================

  /**
   * Assume a role (tier) for testing
   *
   * @param sandboxId - Sandbox ID
   * @param tierId - Tier ID to assume (e.g., "fedaykin")
   * @returns Updated context
   */
  async assumeRole(sandboxId: string, tierId: string): Promise<SimulationContext> {
    const context = await this.getContext(sandboxId);
    const theme = this.getTheme(context.themeId);
    const tierConfig = theme.getTierConfig();

    // Validate tier exists
    const tierDef = tierConfig.tiers.find(t => t.id === tierId);
    if (!tierDef) {
      throw new SimulationError(
        SimulationErrorCode.INVALID_TIER,
        `Unknown tier: ${tierId}. Valid tiers: ${tierConfig.tiers.map(t => t.id).join(', ')}`
      );
    }

    context.assumedRole = {
      tierId: tierDef.id,
      tierName: tierDef.displayName,
      permissions: tierDef.permissions,
      assumedAt: new Date(),
    };

    await this.saveContext(context);
    this.logger.info({ sandboxId, tierId }, 'Role assumed');
    return context;
  }

  /**
   * Clear assumed role, return to computed tier
   */
  async clearAssumedRole(sandboxId: string): Promise<SimulationContext> {
    const context = await this.getContext(sandboxId);
    context.assumedRole = null;
    await this.saveContext(context);
    this.logger.info({ sandboxId }, 'Assumed role cleared');
    return context;
  }

  /**
   * Get current "whoami" state
   */
  async whoami(sandboxId: string): Promise<{
    assumedRole: AssumedRole | null;
    computedTier: TierCheckResult;
    state: SimulatedMemberState;
  }> {
    const context = await this.getContext(sandboxId);
    const computedTier = this.computeTier(context);

    return {
      assumedRole: context.assumedRole,
      computedTier,
      state: context.simulatedState,
    };
  }

  // ===========================================================================
  // State Configuration (FR-2)
  // ===========================================================================

  /**
   * Update simulated state
   *
   * @param sandboxId - Sandbox ID
   * @param updates - Partial state updates
   * @returns Update result with new computed tier
   */
  async setState(
    sandboxId: string,
    updates: Partial<SimulatedMemberState>
  ): Promise<StateUpdateResult> {
    const context = await this.getContext(sandboxId);
    const updatedFields: string[] = [];

    // Validate and apply updates
    if (updates.rank !== undefined) {
      this.validateRank(updates.rank);
      context.simulatedState.rank = updates.rank;
      updatedFields.push('rank');
    }

    if (updates.bgtBalance !== undefined) {
      this.validateBgtBalance(updates.bgtBalance);
      context.simulatedState.bgtBalance = updates.bgtBalance;
      updatedFields.push('bgtBalance');
    }

    if (updates.engagementStage !== undefined) {
      this.validateEngagementStage(updates.engagementStage);
      context.simulatedState.engagementStage = updates.engagementStage;
      updatedFields.push('engagementStage');
    }

    if (updates.engagementPoints !== undefined) {
      this.validateEngagementPoints(updates.engagementPoints);
      context.simulatedState.engagementPoints = updates.engagementPoints;
      updatedFields.push('engagementPoints');
    }

    if (updates.activityScore !== undefined) {
      context.simulatedState.activityScore = Math.max(0, updates.activityScore);
      updatedFields.push('activityScore');
    }

    if (updates.convictionScore !== undefined) {
      context.simulatedState.convictionScore = Math.max(0, updates.convictionScore);
      updatedFields.push('convictionScore');
    }

    if (updates.tenureDays !== undefined) {
      context.simulatedState.tenureDays = Math.max(0, Math.floor(updates.tenureDays));
      updatedFields.push('tenureDays');
    }

    if (updates.address !== undefined) {
      this.validateAddress(updates.address);
      context.simulatedState.address = updates.address;
      updatedFields.push('address');
    }

    await this.saveContext(context);
    this.logger.info({ sandboxId, updatedFields }, 'State updated');

    return {
      updated: updatedFields,
      newState: context.simulatedState,
      computedTier: this.computeTier(context),
    };
  }

  /**
   * Get current simulated state
   */
  async getState(sandboxId: string): Promise<SimulatedMemberState> {
    const context = await this.getContext(sandboxId);
    return context.simulatedState;
  }

  // ===========================================================================
  // Permission Verification (FR-3)
  // ===========================================================================

  /**
   * Check channel access
   *
   * @param sandboxId - Sandbox ID
   * @param channelName - Channel name (e.g., "war-room")
   * @returns Access check result
   */
  async checkChannelAccess(
    sandboxId: string,
    channelName: string
  ): Promise<AccessCheckResult> {
    const context = await this.getContext(sandboxId);
    const theme = this.getTheme(context.themeId);
    const channelTemplate = theme.getChannelTemplate();

    // Find channel definition
    let requiredTier: string | null = null;
    for (const category of channelTemplate.categories) {
      const channel = category.channels.find(c =>
        c.name.toLowerCase() === channelName.toLowerCase()
      );
      if (channel) {
        requiredTier = channel.tierRestriction ?? category.tierRestriction ?? null;
        break;
      }
    }

    // Get effective tier
    const effectiveTier = this.getEffectiveTier(context);
    const tierConfig = theme.getTierConfig();
    const effectiveTierDef = tierConfig.tiers.find(t => t.id === effectiveTier.tierId);

    // Determine access
    let allowed = true;
    let reason: string | undefined;

    if (requiredTier) {
      const tierOrder = tierConfig.tiers.map(t => t.id);
      const effectiveIndex = tierOrder.indexOf(effectiveTier.tierId);
      const requiredIndex = tierOrder.indexOf(requiredTier);

      // Lower index = higher tier (tiers ordered highest first)
      if (effectiveIndex > requiredIndex) {
        allowed = false;
        const requiredTierDef = tierConfig.tiers.find(t => t.id === requiredTier);
        reason = `Requires ${requiredTierDef?.displayName ?? requiredTier} tier (current: ${effectiveTier.tierName})`;
      }
    }

    // Determine blur level based on engagement stage
    const blurLevel = this.getBlurLevel(context.simulatedState.engagementStage);

    return {
      allowed,
      effectiveTier: effectiveTier.tierId,
      effectiveTierName: effectiveTier.tierName,
      requiredTier,
      blurLevel: allowed ? blurLevel : 1.0,
      reason,
      permissions: effectiveTierDef?.permissions ?? [],
      engagementStage: context.simulatedState.engagementStage,
    };
  }

  /**
   * Check feature access
   *
   * @param sandboxId - Sandbox ID
   * @param featureId - Feature ID (permission string)
   * @returns Access check result
   */
  async checkFeatureAccess(
    sandboxId: string,
    featureId: string
  ): Promise<AccessCheckResult> {
    const context = await this.getContext(sandboxId);
    const theme = this.getTheme(context.themeId);
    const tierConfig = theme.getTierConfig();

    const effectiveTier = this.getEffectiveTier(context);
    const effectiveTierDef = tierConfig.tiers.find(t => t.id === effectiveTier.tierId);
    const permissions = effectiveTierDef?.permissions ?? [];

    const allowed = permissions.includes(featureId);
    const blurLevel = this.getBlurLevel(context.simulatedState.engagementStage);

    // Find which tier grants this permission
    let requiredTier: string | null = null;
    for (const tier of tierConfig.tiers) {
      if (tier.permissions.includes(featureId)) {
        requiredTier = tier.id;
        break;
      }
    }

    return {
      allowed,
      effectiveTier: effectiveTier.tierId,
      effectiveTierName: effectiveTier.tierName,
      requiredTier,
      blurLevel: allowed ? blurLevel : 1.0,
      reason: allowed ? undefined : `Permission '${featureId}' not granted to ${effectiveTier.tierName}`,
      permissions,
      engagementStage: context.simulatedState.engagementStage,
    };
  }

  /**
   * Check tier computation
   */
  async checkTier(sandboxId: string): Promise<TierCheckResult> {
    const context = await this.getContext(sandboxId);
    return this.computeTier(context);
  }

  /**
   * Check badge eligibility
   */
  async checkBadges(sandboxId: string): Promise<BadgeCheckResult[]> {
    const context = await this.getContext(sandboxId);
    const theme = this.getTheme(context.themeId);
    const badgeConfig = theme.getBadgeConfig();

    const results: BadgeCheckResult[] = [];
    const { simulatedState } = context;

    for (const badge of badgeConfig.badges) {
      let eligible = false;
      let reason = '';

      switch (badge.criteria.type) {
        case 'tenure':
          eligible = simulatedState.tenureDays >= (badge.criteria.threshold ?? 0);
          reason = eligible
            ? `Tenure ${simulatedState.tenureDays} >= ${badge.criteria.threshold}`
            : `Tenure ${simulatedState.tenureDays} < ${badge.criteria.threshold}`;
          break;

        case 'tier_reached':
          const currentTier = this.computeTier(context);
          const tierOrder = theme.getTierConfig().tiers.map(t => t.id);
          const currentIndex = tierOrder.indexOf(currentTier.tierId);
          const requiredIndex = tierOrder.indexOf(badge.criteria.tierRequired ?? '');
          eligible = currentIndex <= requiredIndex && currentIndex >= 0;
          reason = eligible
            ? `Current tier ${currentTier.tierName} meets requirement`
            : `Current tier ${currentTier.tierName} below ${badge.criteria.tierRequired}`;
          break;

        case 'activity':
          eligible = simulatedState.activityScore >= (badge.criteria.threshold ?? 0);
          reason = eligible
            ? `Activity ${simulatedState.activityScore} >= ${badge.criteria.threshold}`
            : `Activity ${simulatedState.activityScore} < ${badge.criteria.threshold}`;
          break;

        case 'conviction':
          eligible = simulatedState.convictionScore >= (badge.criteria.threshold ?? 0);
          reason = eligible
            ? `Conviction ${simulatedState.convictionScore} >= ${badge.criteria.threshold}`
            : `Conviction ${simulatedState.convictionScore} < ${badge.criteria.threshold}`;
          break;

        default:
          reason = `Custom criteria (${badge.criteria.type}) - requires external evaluation`;
      }

      results.push({
        badgeId: badge.id,
        badgeName: badge.displayName,
        emoji: badge.emoji,
        eligible,
        reason,
      });
    }

    return results;
  }

  // ===========================================================================
  // Threshold Configuration (FR-4)
  // ===========================================================================

  /**
   * Override thresholds for testing
   *
   * @param sandboxId - Sandbox ID
   * @param overrides - Threshold overrides
   */
  async setThresholdOverrides(
    sandboxId: string,
    overrides: Partial<{
      tiers: Record<string, Partial<TierOverride>>;
      bgt: Record<string, number>;
      engagement: { engagedMin?: number; rateLimit?: number };
    }>
  ): Promise<ThresholdOverrides> {
    const context = await this.getContext(sandboxId);

    if (overrides.tiers) {
      for (const [tierId, tierOverride] of Object.entries(overrides.tiers)) {
        context.thresholdOverrides.tiers.set(tierId, tierOverride);
      }
    }

    if (overrides.bgt) {
      for (const [tierId, threshold] of Object.entries(overrides.bgt)) {
        context.thresholdOverrides.bgt.set(tierId, threshold);
      }
    }

    if (overrides.engagement) {
      context.thresholdOverrides.engagement = {
        ...context.thresholdOverrides.engagement,
        ...overrides.engagement,
      };
    }

    await this.saveContext(context);
    this.logger.info({ sandboxId, overrides }, 'Thresholds overridden');

    return context.thresholdOverrides;
  }

  /**
   * Get current threshold overrides
   */
  async getThresholdOverrides(sandboxId: string): Promise<ThresholdOverrides> {
    const context = await this.getContext(sandboxId);
    return context.thresholdOverrides;
  }

  /**
   * Clear all threshold overrides
   */
  async clearThresholdOverrides(sandboxId: string): Promise<void> {
    const context = await this.getContext(sandboxId);
    context.thresholdOverrides = {
      tiers: new Map(),
      bgt: new Map(),
      engagement: {},
    };
    await this.saveContext(context);
    this.logger.info({ sandboxId }, 'Thresholds reset to defaults');
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  private getRedisKey(sandboxId: string): string {
    return `${REDIS_KEY_PREFIX}${sandboxId}`;
  }

  private getTheme(themeId: string): IThemeProvider {
    // Currently only sietch theme is supported
    if (themeId === 'sietch') {
      return this.defaultTheme;
    }
    return this.defaultTheme;
  }

  private getEffectiveTier(context: SimulationContext): TierResult {
    if (context.assumedRole) {
      return {
        tierId: context.assumedRole.tierId,
        tierName: context.assumedRole.tierName,
        roleColor: '#888888', // Color not stored in assumed role
      };
    }

    const theme = this.getTheme(context.themeId);
    return theme.evaluateTier(context.simulatedState.rank);
  }

  private computeTier(context: SimulationContext): TierCheckResult {
    if (context.assumedRole) {
      return {
        tierId: context.assumedRole.tierId,
        tierName: context.assumedRole.tierName,
        roleColor: '#888888',
        source: 'assumed',
        computedFrom: {
          rank: context.simulatedState.rank,
          bgtBalance: context.simulatedState.bgtBalance,
        },
      };
    }

    const theme = this.getTheme(context.themeId);
    const result = theme.evaluateTier(context.simulatedState.rank);

    return {
      tierId: result.tierId,
      tierName: result.tierName,
      roleColor: result.roleColor,
      rankInTier: result.rankInTier,
      source: 'computed',
      computedFrom: {
        rank: context.simulatedState.rank,
        bgtBalance: context.simulatedState.bgtBalance,
      },
    };
  }

  private getBlurLevel(stage: string): number {
    switch (stage) {
      case 'free': return 0.8;
      case 'engaged': return 0.3;
      case 'verified': return 0;
      default: return 0.8;
    }
  }

  private serializeContext(context: SimulationContext): string {
    return JSON.stringify({
      ...context,
      thresholdOverrides: {
        tiers: Array.from(context.thresholdOverrides.tiers.entries()),
        bgt: Array.from(context.thresholdOverrides.bgt.entries()),
        engagement: context.thresholdOverrides.engagement,
      },
    });
  }

  private deserializeContext(json: string): SimulationContext {
    const parsed = JSON.parse(json);
    return {
      ...parsed,
      createdAt: new Date(parsed.createdAt),
      lastAccessedAt: new Date(parsed.lastAccessedAt),
      assumedRole: parsed.assumedRole ? {
        ...parsed.assumedRole,
        assumedAt: new Date(parsed.assumedRole.assumedAt),
      } : null,
      simulatedState: {
        ...parsed.simulatedState,
        firstClaimAt: parsed.simulatedState.firstClaimAt
          ? new Date(parsed.simulatedState.firstClaimAt)
          : null,
        lastActivityAt: parsed.simulatedState.lastActivityAt
          ? new Date(parsed.simulatedState.lastActivityAt)
          : null,
      },
      thresholdOverrides: {
        tiers: new Map(parsed.thresholdOverrides.tiers),
        bgt: new Map(parsed.thresholdOverrides.bgt),
        engagement: parsed.thresholdOverrides.engagement,
      },
    };
  }

  // Validation helpers
  private validateRank(rank: number): void {
    if (rank < 1 || !Number.isInteger(rank)) {
      throw new SimulationError(
        SimulationErrorCode.INVALID_VALUE,
        `Rank must be a positive integer, got: ${rank}`
      );
    }
  }

  private validateBgtBalance(balance: number): void {
    if (balance < 0 || !Number.isFinite(balance)) {
      throw new SimulationError(
        SimulationErrorCode.INVALID_VALUE,
        `BGT balance must be non-negative, got: ${balance}`
      );
    }
  }

  private validateEngagementStage(stage: string): void {
    if (!['free', 'engaged', 'verified'].includes(stage)) {
      throw new SimulationError(
        SimulationErrorCode.INVALID_VALUE,
        `Engagement stage must be free, engaged, or verified, got: ${stage}`
      );
    }
  }

  private validateEngagementPoints(points: number): void {
    if (points < 0 || !Number.isInteger(points)) {
      throw new SimulationError(
        SimulationErrorCode.INVALID_VALUE,
        `Engagement points must be a non-negative integer, got: ${points}`
      );
    }
  }

  private validateAddress(address: string): void {
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      throw new SimulationError(
        SimulationErrorCode.INVALID_VALUE,
        `Address must be a valid Ethereum address, got: ${address}`
      );
    }
  }
}

// =============================================================================
// Error Types
// =============================================================================

export enum SimulationErrorCode {
  INVALID_TIER = 'INVALID_TIER',
  INVALID_VALUE = 'INVALID_VALUE',
  CONTEXT_NOT_FOUND = 'CONTEXT_NOT_FOUND',
  STORAGE_ERROR = 'STORAGE_ERROR',
}

export class SimulationError extends Error {
  constructor(
    public readonly code: SimulationErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'SimulationError';
  }
}

// =============================================================================
// Factory Function
// =============================================================================

export function createSimulationService(
  config: SimulationServiceConfig
): SimulationService {
  return new SimulationService(config);
}
```

### 4.3 Discord Slash Commands

**Location:** `themes/sietch/src/discord/commands/simulation.ts`

**Purpose:** Discord interface for simulation operations.

```typescript
/**
 * Simulation Slash Commands
 *
 * Sprint S-QA-2 through S-QA-4: Discord Interface
 *
 * Commands:
 * - /simulation assume <tier> - Assume a role
 * - /simulation set <attribute> <value> - Configure state
 * - /simulation check <type> [target] - Verify permissions
 * - /simulation config <action> [args] - Configure thresholds
 * - /simulation whoami - Show current state
 * - /simulation reset - Reset to defaults
 */
import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
} from 'discord.js';
import { SimulationService } from '../../services/sandbox/simulation-service.js';

// Tier choices for autocomplete
const TIER_CHOICES = [
  { name: 'Naib (Top 7)', value: 'naib' },
  { name: 'Fedaykin (Top 8-69)', value: 'fedaykin' },
  { name: 'Usul (1111+ BGT)', value: 'usul' },
  { name: 'Sayyadina (888+ BGT)', value: 'sayyadina' },
  { name: 'Mushtamal (690+ BGT)', value: 'mushtamal' },
  { name: 'Sihaya (420+ BGT)', value: 'sihaya' },
  { name: 'Qanat (222+ BGT)', value: 'qanat' },
  { name: 'Ichwan (69+ BGT)', value: 'ichwan' },
  { name: 'Hajra (6.9+ BGT)', value: 'hajra' },
];

export const simulationCommand = new SlashCommandBuilder()
  .setName('simulation')
  .setDescription('QA sandbox testing commands')
  .addSubcommand(sub =>
    sub
      .setName('assume')
      .setDescription('Assume a tier role for testing')
      .addStringOption(opt =>
        opt
          .setName('tier')
          .setDescription('Tier to assume')
          .setRequired(true)
          .addChoices(...TIER_CHOICES, { name: 'Reset (use computed)', value: 'reset' })
      )
  )
  .addSubcommand(sub =>
    sub
      .setName('set')
      .setDescription('Set a simulated state value')
      .addStringOption(opt =>
        opt
          .setName('attribute')
          .setDescription('Attribute to set')
          .setRequired(true)
          .addChoices(
            { name: 'BGT Balance', value: 'bgt' },
            { name: 'Rank', value: 'rank' },
            { name: 'Engagement Stage', value: 'stage' },
            { name: 'Activity Score', value: 'activity' },
            { name: 'Tenure Days', value: 'tenure' },
            { name: 'Conviction Score', value: 'conviction' }
          )
      )
      .addStringOption(opt =>
        opt
          .setName('value')
          .setDescription('Value to set')
          .setRequired(true)
      )
  )
  .addSubcommand(sub =>
    sub
      .setName('check')
      .setDescription('Check permission or tier')
      .addStringOption(opt =>
        opt
          .setName('type')
          .setDescription('What to check')
          .setRequired(true)
          .addChoices(
            { name: 'Channel Access', value: 'access' },
            { name: 'Feature/Permission', value: 'feature' },
            { name: 'Current Tier', value: 'tier' },
            { name: 'Badge Eligibility', value: 'badges' }
          )
      )
      .addStringOption(opt =>
        opt
          .setName('target')
          .setDescription('Channel name or feature ID (for access/feature checks)')
          .setRequired(false)
      )
  )
  .addSubcommand(sub =>
    sub
      .setName('whoami')
      .setDescription('Show current assumed role and state')
  )
  .addSubcommand(sub =>
    sub
      .setName('reset')
      .setDescription('Reset simulation to defaults')
  );

export async function handleSimulationCommand(
  interaction: ChatInputCommandInteraction,
  simulationService: SimulationService,
  sandboxId: string
): Promise<void> {
  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case 'assume':
      await handleAssume(interaction, simulationService, sandboxId);
      break;
    case 'set':
      await handleSet(interaction, simulationService, sandboxId);
      break;
    case 'check':
      await handleCheck(interaction, simulationService, sandboxId);
      break;
    case 'whoami':
      await handleWhoami(interaction, simulationService, sandboxId);
      break;
    case 'reset':
      await handleReset(interaction, simulationService, sandboxId);
      break;
  }
}

async function handleAssume(
  interaction: ChatInputCommandInteraction,
  service: SimulationService,
  sandboxId: string
): Promise<void> {
  const tier = interaction.options.getString('tier', true);

  if (tier === 'reset') {
    await service.clearAssumedRole(sandboxId);
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('🔄 Role Reset')
          .setDescription('Assumed role cleared. Now using computed tier from state.')
          .setColor(0x00ff00),
      ],
    });
    return;
  }

  const context = await service.assumeRole(sandboxId, tier);
  const role = context.assumedRole!;

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setTitle(`👤 Role Assumed: ${role.tierName}`)
        .setDescription(`You are now testing as **${role.tierName}** tier.`)
        .addFields(
          { name: 'Tier ID', value: role.tierId, inline: true },
          { name: 'Permissions', value: role.permissions.join(', ') || 'None', inline: false }
        )
        .setColor(0x4169e1),
    ],
  });
}

async function handleSet(
  interaction: ChatInputCommandInteraction,
  service: SimulationService,
  sandboxId: string
): Promise<void> {
  const attribute = interaction.options.getString('attribute', true);
  const valueStr = interaction.options.getString('value', true);

  const updates: Record<string, unknown> = {};

  switch (attribute) {
    case 'bgt':
      updates.bgtBalance = parseFloat(valueStr);
      break;
    case 'rank':
      updates.rank = parseInt(valueStr, 10);
      break;
    case 'stage':
      updates.engagementStage = valueStr.toLowerCase();
      break;
    case 'activity':
      updates.activityScore = parseInt(valueStr, 10);
      break;
    case 'tenure':
      updates.tenureDays = parseInt(valueStr, 10);
      break;
    case 'conviction':
      updates.convictionScore = parseInt(valueStr, 10);
      break;
  }

  const result = await service.setState(sandboxId, updates);

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setTitle('✅ State Updated')
        .setDescription(`Updated: ${result.updated.join(', ')}`)
        .addFields(
          { name: 'Computed Tier', value: result.computedTier.tierName, inline: true },
          { name: 'Source', value: result.computedTier.source, inline: true }
        )
        .setColor(0x00ff00),
    ],
  });
}

async function handleCheck(
  interaction: ChatInputCommandInteraction,
  service: SimulationService,
  sandboxId: string
): Promise<void> {
  const type = interaction.options.getString('type', true);
  const target = interaction.options.getString('target');

  switch (type) {
    case 'access': {
      if (!target) {
        await interaction.reply('Please specify a channel name with the `target` option.');
        return;
      }
      const result = await service.checkChannelAccess(sandboxId, target);
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle(result.allowed ? `✅ ACCESS GRANTED: #${target}` : `❌ ACCESS DENIED: #${target}`)
            .addFields(
              { name: 'Effective Tier', value: result.effectiveTierName, inline: true },
              { name: 'Required Tier', value: result.requiredTier ?? 'None', inline: true },
              { name: 'Blur Level', value: `${Math.round(result.blurLevel * 100)}%`, inline: true },
              { name: 'Engagement', value: result.engagementStage.toUpperCase(), inline: true }
            )
            .setDescription(result.reason ?? '')
            .setColor(result.allowed ? 0x00ff00 : 0xff0000),
        ],
      });
      break;
    }

    case 'feature': {
      if (!target) {
        await interaction.reply('Please specify a feature/permission ID with the `target` option.');
        return;
      }
      const result = await service.checkFeatureAccess(sandboxId, target);
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle(result.allowed ? `✅ PERMISSION GRANTED: ${target}` : `❌ PERMISSION DENIED: ${target}`)
            .addFields(
              { name: 'Effective Tier', value: result.effectiveTierName, inline: true },
              { name: 'Your Permissions', value: result.permissions.join(', ') || 'None', inline: false }
            )
            .setDescription(result.reason ?? '')
            .setColor(result.allowed ? 0x00ff00 : 0xff0000),
        ],
      });
      break;
    }

    case 'tier': {
      const result = await service.checkTier(sandboxId);
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle(`🏆 Current Tier: ${result.tierName}`)
            .addFields(
              { name: 'Tier ID', value: result.tierId, inline: true },
              { name: 'Source', value: result.source, inline: true },
              { name: 'Rank in Tier', value: result.rankInTier?.toString() ?? 'N/A', inline: true },
              { name: 'Computed From', value: `Rank: ${result.computedFrom.rank}, BGT: ${result.computedFrom.bgtBalance}`, inline: false }
            )
            .setColor(parseInt(result.roleColor.replace('#', ''), 16)),
        ],
      });
      break;
    }

    case 'badges': {
      const results = await service.checkBadges(sandboxId);
      const eligible = results.filter(b => b.eligible);
      const ineligible = results.filter(b => !b.eligible);

      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle('🏅 Badge Eligibility')
            .addFields(
              {
                name: `✅ Eligible (${eligible.length})`,
                value: eligible.length > 0
                  ? eligible.map(b => `${b.emoji} ${b.badgeName}`).join('\n')
                  : 'None',
                inline: true,
              },
              {
                name: `❌ Not Eligible (${ineligible.length})`,
                value: ineligible.length > 0
                  ? ineligible.slice(0, 5).map(b => `${b.emoji} ${b.badgeName}`).join('\n') +
                    (ineligible.length > 5 ? `\n...and ${ineligible.length - 5} more` : '')
                  : 'None',
                inline: true,
              }
            )
            .setColor(0x4169e1),
        ],
      });
      break;
    }
  }
}

async function handleWhoami(
  interaction: ChatInputCommandInteraction,
  service: SimulationService,
  sandboxId: string
): Promise<void> {
  const { assumedRole, computedTier, state } = await service.whoami(sandboxId);

  const embed = new EmbedBuilder()
    .setTitle('🔍 Simulation State')
    .addFields(
      {
        name: 'Assumed Role',
        value: assumedRole ? `${assumedRole.tierName} (${assumedRole.tierId})` : 'None (using computed)',
        inline: true,
      },
      {
        name: 'Computed Tier',
        value: `${computedTier.tierName} (${computedTier.source})`,
        inline: true,
      },
      {
        name: 'State',
        value: [
          `Rank: ${state.rank}`,
          `BGT: ${state.bgtBalance}`,
          `Stage: ${state.engagementStage}`,
          `Activity: ${state.activityScore}`,
          `Tenure: ${state.tenureDays} days`,
        ].join('\n'),
        inline: false,
      }
    )
    .setColor(0x4169e1);

  await interaction.reply({ embeds: [embed] });
}

async function handleReset(
  interaction: ChatInputCommandInteraction,
  service: SimulationService,
  sandboxId: string
): Promise<void> {
  await service.resetContext(sandboxId);

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setTitle('🔄 Simulation Reset')
        .setDescription('All simulation state has been reset to defaults.')
        .setColor(0x00ff00),
    ],
  });
}
```

---

## 5. Data Architecture

### 5.1 Redis Storage

SimulationContext is stored entirely in Redis, leveraging the existing sandbox namespace pattern.

**Key Pattern:**
```
sandbox:simulation:{sandboxId}
```

**TTL:** Matches sandbox TTL (default 24 hours), auto-cleanup on sandbox destruction.

**Value:** JSON-serialized `SimulationContext` with Map serialization:
```json
{
  "sandboxId": "abc-123",
  "assumedRole": {
    "tierId": "fedaykin",
    "tierName": "Fedaykin",
    "permissions": ["view_all", "vote", "elite_access", "water_share"],
    "assumedAt": "2026-01-19T12:00:00Z"
  },
  "simulatedState": {
    "address": "0x1234...5678",
    "rank": 42,
    "bgtBalance": 150,
    "engagementStage": "engaged",
    "engagementPoints": 65,
    "activityScore": 45,
    "convictionScore": 100,
    "tenureDays": 45,
    "firstClaimAt": "2025-12-01T00:00:00Z",
    "lastActivityAt": "2026-01-18T00:00:00Z"
  },
  "thresholdOverrides": {
    "tiers": [],
    "bgt": [],
    "engagement": {}
  },
  "themeId": "sietch",
  "createdAt": "2026-01-19T10:00:00Z",
  "lastAccessedAt": "2026-01-19T12:00:00Z"
}
```

### 5.2 No Database Tables Required

The QA Sandbox Testing System intentionally avoids PostgreSQL tables:

1. **Ephemeral by Design** - Simulation state should not persist beyond sandbox lifetime
2. **Isolation** - Redis namespacing provides sufficient isolation
3. **Performance** - Redis reads/writes are faster than database for this use case
4. **Simplicity** - No schema migrations, no ORM setup

### 5.3 Redis Operations

| Operation | Key | Command | TTL |
|-----------|-----|---------|-----|
| Get Context | `sandbox:simulation:{id}` | GET | N/A |
| Save Context | `sandbox:simulation:{id}` | SET with EX | Sandbox TTL |
| Delete Context | `sandbox:simulation:{id}` | DEL | N/A |

---

## 6. API Design

### 6.1 REST API Endpoints

All endpoints under `/sandbox/:sandboxId/simulation/`

#### Role Assumption

```
POST /sandbox/:sandboxId/simulation/assume
Body: { "tierId": "fedaykin" }
Response: {
  "assumedRole": {
    "tierId": "fedaykin",
    "tierName": "Fedaykin",
    "permissions": ["view_all", "vote", "elite_access", "water_share"],
    "assumedAt": "2026-01-19T12:00:00Z"
  }
}

DELETE /sandbox/:sandboxId/simulation/assume
Response: { "message": "Assumed role cleared" }
```

#### State Configuration

```
PATCH /sandbox/:sandboxId/simulation/state
Body: {
  "bgtBalance": 500,
  "rank": 42,
  "engagementStage": "engaged"
}
Response: {
  "updated": ["bgtBalance", "rank", "engagementStage"],
  "newState": { ... },
  "computedTier": {
    "tierId": "fedaykin",
    "tierName": "Fedaykin",
    "source": "computed"
  }
}

GET /sandbox/:sandboxId/simulation/state
Response: {
  "address": "0x...",
  "rank": 42,
  "bgtBalance": 500,
  ...
}
```

#### Permission Checks

```
POST /sandbox/:sandboxId/simulation/check
Body: { "type": "channel", "target": "war-room" }
Response: {
  "allowed": true,
  "effectiveTier": "fedaykin",
  "effectiveTierName": "Fedaykin",
  "requiredTier": "fedaykin",
  "blurLevel": 0.3,
  "permissions": ["view_all", "vote", "elite_access", "water_share"],
  "engagementStage": "engaged"
}

Body: { "type": "feature", "target": "council_access" }
Body: { "type": "tier" }
Body: { "type": "badges" }
```

#### Threshold Configuration

```
PATCH /sandbox/:sandboxId/simulation/thresholds
Body: {
  "bgt": { "sihaya": 500 },
  "engagement": { "engagedMin": 75 }
}
Response: {
  "tiers": [],
  "bgt": [["sihaya", 500]],
  "engagement": { "engagedMin": 75 }
}

GET /sandbox/:sandboxId/simulation/thresholds
DELETE /sandbox/:sandboxId/simulation/thresholds
```

#### Context Management

```
GET /sandbox/:sandboxId/simulation/whoami
Response: {
  "assumedRole": { ... } | null,
  "computedTier": { ... },
  "state": { ... }
}

DELETE /sandbox/:sandboxId/simulation
Response: { "message": "Simulation context reset" }
```

### 6.2 Discord Slash Commands

| Command | Description | Example |
|---------|-------------|---------|
| `/simulation assume <tier>` | Assume a role | `/simulation assume fedaykin` |
| `/simulation set <attr> <value>` | Set state value | `/simulation set bgt 500` |
| `/simulation check access <channel>` | Check channel access | `/simulation check access war-room` |
| `/simulation check feature <id>` | Check feature access | `/simulation check feature council_access` |
| `/simulation check tier` | Check computed tier | `/simulation check tier` |
| `/simulation check badges` | Check badge eligibility | `/simulation check badges` |
| `/simulation whoami` | Show current state | `/simulation whoami` |
| `/simulation reset` | Reset to defaults | `/simulation reset` |

### 6.3 Error Responses

```typescript
// HTTP 400 Bad Request
{
  "error": "INVALID_VALUE",
  "message": "Rank must be a positive integer, got: -1",
  "details": { "field": "rank", "value": -1 }
}

// HTTP 400 Bad Request
{
  "error": "INVALID_TIER",
  "message": "Unknown tier: foobar. Valid tiers: naib, fedaykin, usul, ...",
  "details": { "requested": "foobar" }
}

// HTTP 404 Not Found
{
  "error": "SANDBOX_NOT_FOUND",
  "message": "Sandbox abc-123 not found or expired"
}
```

---

## 7. Integration Points

### 7.1 Existing Component Integration

| Component | Integration | Changes Required |
|-----------|-------------|------------------|
| `SandboxManager` | Validate sandbox exists before operations | None - use existing `getById()` |
| `TierEvaluator` | Tier computation | None - use existing `evaluate()` |
| `SietchTheme` | Tier/badge/channel definitions | None - use existing methods |
| `ProgressiveGate` | Blur level constants | Reference `BLUR_LEVELS` constant |
| Redis (`MinimalRedis`) | Context storage | None - use existing interface |

### 7.2 Module Registration

```typescript
// themes/sietch/src/modules/simulation.module.ts
import { Module } from './module-types.js';
import { SimulationService, createSimulationService } from '../services/sandbox/simulation-service.js';
import { simulationRouter } from '../routes/simulation.routes.js';

export function createSimulationModule(config: {
  redis: MinimalRedis;
  logger: ILogger;
}): Module {
  const service = createSimulationService({
    redis: config.redis,
    logger: config.logger,
  });

  return {
    name: 'simulation',
    service,
    routes: simulationRouter(service),
    commands: [simulationCommand],
  };
}
```

### 7.3 Route Registration

```typescript
// themes/sietch/src/routes/simulation.routes.ts
import { Router } from 'express';
import { SimulationService } from '../services/sandbox/simulation-service.js';

export function simulationRouter(service: SimulationService): Router {
  const router = Router({ mergeParams: true });

  // All routes require sandboxId in params
  router.post('/assume', async (req, res) => {
    const { sandboxId } = req.params;
    const { tierId } = req.body;
    const context = await service.assumeRole(sandboxId, tierId);
    res.json({ assumedRole: context.assumedRole });
  });

  router.delete('/assume', async (req, res) => {
    const { sandboxId } = req.params;
    await service.clearAssumedRole(sandboxId);
    res.json({ message: 'Assumed role cleared' });
  });

  // ... other routes

  return router;
}
```

---

## 8. Security Considerations

### 8.1 Sandbox Isolation

1. **Context Scoping** - SimulationContext is keyed by sandboxId, no cross-sandbox access
2. **TTL Enforcement** - Redis keys expire with sandbox, no orphaned state
3. **No Production Access** - Simulation service has no access to production data

### 8.2 Input Validation

All inputs validated before processing:

| Field | Validation | Error |
|-------|------------|-------|
| `tierId` | Must exist in theme config | INVALID_TIER |
| `rank` | Positive integer | INVALID_VALUE |
| `bgtBalance` | Non-negative number | INVALID_VALUE |
| `engagementStage` | Enum: free, engaged, verified | INVALID_VALUE |
| `address` | Ethereum address format | INVALID_VALUE |

### 8.3 Rate Limiting

Apply existing sandbox rate limits:

| Limit | Value | Scope |
|-------|-------|-------|
| Requests per minute | 100 | Per sandbox |
| State updates per hour | 1000 | Per sandbox |

### 8.4 Audit Logging

Log all simulation operations for debugging:

```typescript
this.logger.info({
  sandboxId,
  operation: 'assumeRole',
  tierId,
  actor: userId,
}, 'Role assumed');
```

---

## 9. Observability

### 9.1 Metrics

| Metric | Type | Labels |
|--------|------|--------|
| `simulation_operations_total` | Counter | `operation`, `sandbox_id` |
| `simulation_permission_checks_total` | Counter | `result`, `check_type` |
| `simulation_state_updates_total` | Counter | `field`, `sandbox_id` |
| `simulation_context_cache_hits` | Counter | `sandbox_id` |
| `simulation_latency_seconds` | Histogram | `operation` |

### 9.2 Logging

Structured logging format:

```json
{
  "level": "info",
  "service": "SimulationService",
  "sandboxId": "abc-123",
  "operation": "checkChannelAccess",
  "channel": "war-room",
  "allowed": true,
  "effectiveTier": "fedaykin",
  "latencyMs": 12,
  "timestamp": "2026-01-19T12:00:00Z"
}
```

### 9.3 Alerts

| Alert | Condition | Severity |
|-------|-----------|----------|
| `SimulationHighLatency` | p95 > 100ms for 5 min | Warning |
| `SimulationRedisErrors` | > 10 errors/min | Critical |

---

## 10. Development Phases

### Sprint S-QA-1: SimulationContext Data Model (~15h)

| Task | Estimate | Dependencies |
|------|----------|--------------|
| Define `SimulationContext` interfaces | 2h | None |
| Implement Redis serialization/deserialization | 3h | Interfaces |
| Factory functions for default state | 2h | Interfaces |
| Unit tests for context operations | 4h | Implementation |
| Integration test with Redis | 4h | Implementation |

### Sprint S-QA-2: Role Assumption (~12h)

| Task | Estimate | Dependencies |
|------|----------|--------------|
| Implement `assumeRole()` | 3h | S-QA-1 |
| Implement `clearAssumedRole()` | 1h | S-QA-1 |
| Implement `whoami()` | 2h | assumeRole |
| Discord `/simulation assume` command | 3h | Service methods |
| REST API endpoints | 2h | Service methods |
| Tests | 1h | All above |

### Sprint S-QA-3: State Configuration (~15h)

| Task | Estimate | Dependencies |
|------|----------|--------------|
| Implement `setState()` with validation | 4h | S-QA-1 |
| Implement `getState()` | 1h | S-QA-1 |
| Discord `/simulation set` command | 3h | Service methods |
| REST API endpoints | 2h | Service methods |
| Validation error handling | 2h | setState |
| Tests | 3h | All above |

### Sprint S-QA-4: Permission Checks (~18h)

| Task | Estimate | Dependencies |
|------|----------|--------------|
| Implement `checkChannelAccess()` | 4h | S-QA-1, S-QA-2 |
| Implement `checkFeatureAccess()` | 3h | S-QA-1, S-QA-2 |
| Implement `checkTier()` | 2h | S-QA-1, S-QA-2 |
| Implement `checkBadges()` | 3h | S-QA-1, S-QA-2 |
| Discord `/simulation check` commands | 3h | Service methods |
| REST API endpoints | 2h | Service methods |
| Tests | 1h | All above |

### Sprint S-QA-5: Threshold Overrides (~12h)

| Task | Estimate | Dependencies |
|------|----------|--------------|
| Implement `setThresholdOverrides()` | 3h | S-QA-1 |
| Integrate overrides into tier computation | 3h | S-QA-4 |
| Discord `/simulation config` command | 3h | Service methods |
| REST API endpoints | 2h | Service methods |
| Tests | 1h | All above |

---

## 11. Technical Risks & Mitigation

### Risk 1: Production Parity Drift

**Risk:** Simulation logic diverges from production TierEvaluator/ProgressiveGate.

**Impact:** Tests pass but production behavior differs.

**Mitigation:**
- Use identical evaluation methods (no copies)
- Integration tests compare simulation vs production evaluators
- Code review checklist: "Does this change affect simulation?"

### Risk 2: Redis Memory Pressure

**Risk:** Many concurrent simulations exhaust Redis memory.

**Impact:** Service degradation, lost state.

**Mitigation:**
- Context size is small (~2KB per sandbox)
- TTL ensures cleanup
- Monitor `redis_memory_used_bytes` metric
- Set `maxmemory-policy volatile-lru` for graceful eviction

### Risk 3: Threshold Override Complexity

**Risk:** Complex threshold overrides lead to confusing behavior.

**Impact:** Users don't understand why tier computation differs.

**Mitigation:**
- Always show "source: computed/assumed" in results
- Include `computedFrom` field showing inputs
- Warn when overrides are active in response

### Risk 4: Discord Command Discovery

**Risk:** Users don't discover simulation commands in sandbox.

**Impact:** Low adoption, feature unused.

**Mitigation:**
- Display simulation commands in sandbox welcome message
- Add `/simulation help` command
- Include simulation commands in sandbox documentation

---

## 12. Appendix

### A. SietchTheme Tier Reference

| Tier | Rank Range | BGT Threshold | Permissions |
|------|------------|---------------|-------------|
| naib | 1-7 | N/A (rank-based) | view_all, council_access, vote, govern, naib_ceremony |
| fedaykin | 8-69 | N/A (rank-based) | view_all, vote, elite_access, water_share |
| usul | 70-100 | 1111+ | view_premium, vote, inner_circle |
| sayyadina | 101-150 | 888+ | view_premium, vote, ceremony_access |
| mushtamal | 151-200 | 690+ | view_premium, vote, garden_access |
| sihaya | 201-300 | 420+ | view_standard, vote |
| qanat | 301-500 | 222+ | view_standard, limited_vote |
| ichwan | 501-1000 | 69+ | view_basic |
| hajra | 1001+ | 6.9+ | view_general |

### B. Channel Template Reference

| Category | Channels | Tier Restriction |
|----------|----------|------------------|
| SIETCH SCROLLS | the-door, desert-laws, census, announcements | None (public) |
| NAIB COUNCIL | council-chamber, naib-voice | naib |
| FEDAYKIN QUARTERS | war-room, fedaykin-voice | fedaykin |
| THE OASIS | oasis-lounge | Water Sharer badge |
| COMMON GROUNDS | sietch-lounge, introductions, spice-market, desert-voice | None |
| CAVE ENTRANCE | taqwa-waiting | None |
| THE STILLSUIT | bot-commands, leaderboard | None |

### C. Engagement Stage Reference

| Stage | Points Required | Blur Level | Features |
|-------|-----------------|------------|----------|
| FREE | 0 | 80% | Glimpse mode |
| ENGAGED | 50 | 30% | Partial features, trust inheritance |
| VERIFIED | Wallet verified | 0% | Full features |

### D. Activity Point Values

| Activity | Points |
|----------|--------|
| leaderboard_view | 5 |
| profile_view | 3 |
| badge_preview | 2 |
| cta_click | 10 |
| command_use | 5 |
| return_visit | 8 |

### E. Related Documents

- PRD: `grimoires/loa/prd.md` (QA Sandbox Testing System v1.0)
- Theme Interface: `themes/sietch/src/packages/core/ports/IThemeProvider.ts`
- TierEvaluator: `themes/sietch/src/packages/core/services/TierEvaluator.ts`
- SietchTheme: `themes/sietch/src/packages/adapters/themes/SietchTheme.ts`
- ProgressiveGate: `themes/sietch/src/services/discord/progressive-gate/ProgressiveGate.ts`
- Sandbox Manager: `packages/sandbox/src/services/sandbox-manager.ts`

---

**Document Status:** DRAFT - Pending Approval
**Next Steps:** Review with stakeholders, then proceed to `/sprint-plan`

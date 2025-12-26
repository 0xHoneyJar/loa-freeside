# Software Design Document: Sietch v4.0

**Version**: 4.0
**Date**: December 26, 2025
**Status**: DRAFT
**Codename**: The Unification

---

## Document Traceability

| Section | Source | Reference |
|---------|--------|-----------|
| Requirements | loa-grimoire/prd.md | PRD v4.0 |
| Existing Architecture | sietch-service/src/ | v3.0 codebase |
| Reference Architecture | ARCHITECTURE_SPEC_v2.9.0.md | Enterprise spec |
| Billing Patterns | BOOTSTRAP_PROMPT.md | Stripe integration |

---

## 1. Executive Summary

### 1.1 Document Purpose

This Software Design Document (SDD) details the technical architecture and implementation plan for Sietch v4.0 "The Unification". This release evolves the existing v3.0 codebase into an enterprise-grade SaaS platform while preserving all existing functionality.

### 1.2 Scope

This document covers:
- System architecture extensions for v4.0 features
- New service designs (StripeService, GatekeeperService, RedisService)
- Database schema extensions for billing
- API endpoint specifications
- Security architecture for payment processing
- Migration approach from v3.0

### 1.3 Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| HTTP Framework | Express (preserved) | Stable, existing codebase, no migration risk |
| Cache Provider | Upstash Redis | Serverless, cost-effective, no infrastructure management |
| Payment Provider | Stripe | Industry standard, excellent SDK, PCI compliant |
| Database | SQLite (preserved) | Simple, proven, sufficient for single-tenant |
| Webhook Pattern | Idempotent with Redis | Prevents duplicate processing, standard pattern |
| Feature Gating | Server-side only | No client bypass possible, audit trail |

### 1.4 Architecture Principles

1. **Preserve v3.0 Stability**: No modifications to working v3.0 services
2. **Additive Changes Only**: New services alongside existing ones
3. **Graceful Degradation**: Redis unavailable → fallback to DB lookup
4. **Security First**: All payment data handled by Stripe, never stored locally
5. **Single Responsibility**: Each new service has one clear purpose

---

## 2. System Architecture

### 2.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           SIETCH SERVICE v4.0                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │                         NEW SERVICES (v4.0)                           │ │
│  │                                                                       │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │ │
│  │  │   Stripe    │  │ Gatekeeper  │  │   Redis     │  │   Waiver    │  │ │
│  │  │   Service   │  │   Service   │  │   Service   │  │   Service   │  │ │
│  │  │             │  │             │  │             │  │             │  │ │
│  │  │ • Checkout  │  │ • Feature   │  │ • Entitle-  │  │ • Grant     │  │ │
│  │  │ • Webhooks  │  │   gating    │  │   ment      │  │ • Revoke    │  │ │
│  │  │ • Portal    │  │ • Tier      │  │   cache     │  │ • List      │  │ │
│  │  │ • Subscrip- │  │   lookup    │  │ • Event     │  │ • Audit     │  │ │
│  │  │   tions     │  │ • Upgrade   │  │   dedup     │  │   trail     │  │ │
│  │  │             │  │   prompts   │  │             │  │             │  │ │
│  │  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  │ │
│  │         │                │                │                │          │ │
│  └─────────┼────────────────┼────────────────┼────────────────┼──────────┘ │
│            │                │                │                │            │
│            └────────────────┴────────┬───────┴────────────────┘            │
│                                      │                                      │
│  ┌───────────────────────────────────┼───────────────────────────────────┐ │
│  │                    PRESERVED SERVICES (v3.0)                          │ │
│  │                                   │                                   │ │
│  │  ┌───────────┐ ┌───────────┐ ┌───┴───────┐ ┌───────────┐             │ │
│  │  │   Tier    │ │   Stats   │ │ Notifica- │ │   Naib    │             │ │
│  │  │  Service  │ │  Service  │ │   tion    │ │  Service  │             │ │
│  │  └───────────┘ └───────────┘ └───────────┘ └───────────┘             │ │
│  │                                                                       │ │
│  │  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐             │ │
│  │  │Eligibility│ │  Profile  │ │  Activity │ │ Threshold │             │ │
│  │  │  Service  │ │  Service  │ │  Service  │ │  Service  │             │ │
│  │  └───────────┘ └───────────┘ └───────────┘ └───────────┘             │ │
│  │                                                                       │ │
│  │  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐             │ │
│  │  │  Digest   │ │   Story   │ │ Analytics │ │ Directory │             │ │
│  │  │  Service  │ │  Service  │ │  Service  │ │  Service  │             │ │
│  │  └───────────┘ └───────────┘ └───────────┘ └───────────┘             │ │
│  │                                                                       │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │                              DATA LAYER                               │ │
│  │                                                                       │ │
│  │  ┌─────────────────────────┐      ┌─────────────────────────┐        │ │
│  │  │        SQLite           │      │    Upstash Redis        │        │ │
│  │  │   (Primary Storage)     │      │   (Entitlement Cache)   │        │ │
│  │  │                         │      │                         │        │ │
│  │  │ • Members               │      │ • Subscription tier     │        │ │
│  │  │ • Subscriptions (NEW)   │      │ • Feature entitlements  │        │ │
│  │  │ • Fee Waivers (NEW)     │      │ • Webhook deduplication │        │ │
│  │  │ • Webhook Events (NEW)  │      │                         │        │ │
│  │  │ • All v3.0 tables       │      │ TTL: 5 minutes          │        │ │
│  │  └─────────────────────────┘      └─────────────────────────┘        │ │
│  │                                                                       │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 External Integrations

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          EXTERNAL SERVICES                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌───────────┐ │
│  │   Stripe    │     │  Discord    │     │  Berachain  │     │ Upstash   │ │
│  │    API      │     │    API      │     │    RPC      │     │  Redis    │ │
│  │             │     │             │     │             │     │           │ │
│  │ • Checkout  │     │ • Bot API   │     │ • BGT query │     │ • Cache   │ │
│  │ • Webhooks  │     │ • Roles     │     │ • Events    │     │ • Dedup   │ │
│  │ • Portal    │     │ • Messages  │     │             │     │           │ │
│  │ • Customers │     │ • Channels  │     │             │     │           │ │
│  └──────┬──────┘     └──────┬──────┘     └──────┬──────┘     └─────┬─────┘ │
│         │                   │                   │                   │       │
│         └───────────────────┴─────────┬─────────┴───────────────────┘       │
│                                       │                                     │
│                                       ▼                                     │
│                            ┌─────────────────────┐                          │
│                            │   Sietch Service    │                          │
│                            │       v4.0          │                          │
│                            └─────────────────────┘                          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.3 Request Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         FEATURE ACCESS REQUEST FLOW                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Discord User                                                               │
│      │                                                                      │
│      │ /stats command                                                       │
│      ▼                                                                      │
│  ┌─────────────────┐                                                        │
│  │   Discord Bot   │                                                        │
│  └────────┬────────┘                                                        │
│           │                                                                 │
│           │ Check feature access                                            │
│           ▼                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                      GATEKEEPER SERVICE                              │   │
│  │                                                                      │   │
│  │  1. Check Redis cache (entitlement:{community_id})                   │   │
│  │     │                                                                │   │
│  │     ├─── HIT ──► Return cached tier + features                       │   │
│  │     │                                                                │   │
│  │     └─── MISS                                                        │   │
│  │            │                                                         │   │
│  │            ▼                                                         │   │
│  │  2. Check fee_waivers table (highest priority)                       │   │
│  │     │                                                                │   │
│  │     ├─── FOUND ──► Return waiver tier                                │   │
│  │     │                                                                │   │
│  │     └─── NOT FOUND                                                   │   │
│  │            │                                                         │   │
│  │            ▼                                                         │   │
│  │  3. Check subscriptions table                                        │   │
│  │     │                                                                │   │
│  │     ├─── ACTIVE ──► Return subscription tier                         │   │
│  │     │                                                                │   │
│  │     ├─── GRACE PERIOD ──► Return tier + warning flag                 │   │
│  │     │                                                                │   │
│  │     └─── NONE/EXPIRED ──► Return 'starter' tier                      │   │
│  │                                                                      │   │
│  │  4. Cache result in Redis (TTL: 300s)                                │   │
│  │                                                                      │   │
│  │  5. Return { tier, features[], canAccess, upgradeRequired }          │   │
│  │                                                                      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│           │                                                                 │
│           │ canAccess: true/false                                           │
│           ▼                                                                 │
│  ┌─────────────────┐                                                        │
│  │  Stats Service  │ ◄── If canAccess=true, execute normally                │
│  └─────────────────┘                                                        │
│           │                                                                 │
│           │ OR                                                              │
│           ▼                                                                 │
│  ┌─────────────────┐                                                        │
│  │ Upgrade Prompt  │ ◄── If canAccess=false, show upgrade message           │
│  └─────────────────┘                                                        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Technology Stack

### 3.1 Preserved Stack (v3.0)

| Layer | Technology | Version | Status |
|-------|------------|---------|--------|
| Runtime | Node.js | 20 LTS | Preserved |
| HTTP Framework | Express | 4.x | Preserved |
| Database | SQLite (better-sqlite3) | 11.x | Preserved |
| ORM | Raw SQL | - | Preserved |
| Discord | discord.js | 14.x | Preserved |
| Task Queue | trigger.dev | 3.x | Preserved |
| Validation | Zod | 3.x | Preserved |
| Logging | Pino | 9.x | Preserved |
| Blockchain | Viem | 2.x | Preserved |

### 3.2 New Stack (v4.0)

| Layer | Technology | Version | Purpose |
|-------|------------|---------|---------|
| Payments | Stripe SDK | 14.x | Subscription billing |
| Cache | ioredis | 5.x | Redis client |
| Cache Provider | Upstash | - | Serverless Redis |

### 3.3 Development Stack

| Tool | Version | Purpose |
|------|---------|---------|
| TypeScript | 5.x | Type safety |
| ESLint | 8.x | Linting |
| Prettier | 3.x | Formatting |
| Vitest | 1.x | Testing |
| pnpm | 8.x | Package manager |

---

## 4. Component Design

### 4.1 StripeService

**Purpose**: Handle all Stripe API interactions for subscription billing.

**Location**: `src/services/billing/StripeService.ts`

```typescript
/**
 * StripeService
 *
 * Manages Stripe integration for subscription billing.
 * Single responsibility: Stripe API communication.
 */

interface StripeService {
  // Checkout
  createCheckoutSession(params: {
    communityId: string;
    tier: SubscriptionTier;
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ sessionId: string; url: string }>;

  // Portal
  createPortalSession(params: {
    customerId: string;
    returnUrl: string;
  }): Promise<{ url: string }>;

  // Subscription Management
  getSubscription(subscriptionId: string): Promise<Stripe.Subscription | null>;
  cancelSubscription(subscriptionId: string): Promise<void>;

  // Customer Management
  getOrCreateCustomer(params: {
    communityId: string;
    email?: string;
    metadata?: Record<string, string>;
  }): Promise<string>; // Returns customer ID
}
```

**Dependencies**:
- `stripe` SDK
- `config.stripe.*` environment variables

**Error Handling**:
- Stripe API errors → Log and rethrow with context
- Network errors → Retry with exponential backoff (max 3 attempts)
- Invalid requests → Return descriptive error message

### 4.2 WebhookService

**Purpose**: Process Stripe webhooks with idempotency guarantees.

**Location**: `src/services/billing/WebhookService.ts`

```typescript
/**
 * WebhookService
 *
 * Processes Stripe webhooks idempotently.
 * Uses Redis for deduplication with 24h TTL.
 */

interface WebhookService {
  // Signature verification
  verifySignature(payload: string | Buffer, signature: string): Stripe.Event;

  // Event processing
  processEvent(event: Stripe.Event): Promise<WebhookResult>;
}

interface WebhookResult {
  status: 'processed' | 'duplicate' | 'skipped' | 'failed';
  eventId: string;
  eventType: string;
  message?: string;
}

// Supported webhook events
type SupportedEvent =
  | 'checkout.session.completed'
  | 'invoice.paid'
  | 'invoice.payment_failed'
  | 'customer.subscription.updated'
  | 'customer.subscription.deleted';
```

**Idempotency Flow**:
```
1. Receive webhook
2. Verify HMAC signature
3. Check Redis: event:{eventId} exists?
   - Yes → Return 'duplicate'
   - No → Continue
4. Check SQLite: webhook_events.event_id exists?
   - Yes → Return 'duplicate'
   - No → Continue
5. Set Redis lock: event:{eventId}:lock (TTL: 30s)
6. Process event
7. Store in webhook_events table
8. Set Redis: event:{eventId} (TTL: 24h)
9. Return 'processed'
```

### 4.3 GatekeeperService

**Purpose**: Control feature access based on subscription tier.

**Location**: `src/services/billing/GatekeeperService.ts`

```typescript
/**
 * GatekeeperService
 *
 * Single point of feature access control.
 * Uses Redis cache with SQLite fallback.
 */

interface GatekeeperService {
  // Check access
  checkAccess(params: {
    communityId: string;
    feature: Feature;
  }): Promise<AccessResult>;

  // Get current tier
  getCurrentTier(communityId: string): Promise<TierInfo>;

  // Get all entitlements
  getEntitlements(communityId: string): Promise<Entitlements>;

  // Invalidate cache (called after subscription changes)
  invalidateCache(communityId: string): Promise<void>;
}

interface AccessResult {
  canAccess: boolean;
  currentTier: SubscriptionTier;
  requiredTier: SubscriptionTier;
  inGracePeriod: boolean;
  upgradeUrl?: string;
}

interface TierInfo {
  tier: SubscriptionTier;
  source: 'waiver' | 'subscription' | 'boost' | 'free';
  expiresAt?: Date;
  inGracePeriod: boolean;
}

interface Entitlements {
  tier: SubscriptionTier;
  maxMembers: number;
  features: Feature[];
  source: 'waiver' | 'subscription' | 'boost' | 'free';
}
```

**Feature Matrix**:
```typescript
const FEATURE_MATRIX: Record<Feature, SubscriptionTier> = {
  'basic_tgr': 'starter',
  'member_limit_25': 'starter',
  'member_limit_500': 'basic',
  'member_limit_1000': 'premium',
  'member_limit_2500': 'exclusive',
  'member_limit_7500': 'elite',
  'member_limit_unlimited': 'enterprise',
  'nine_tier_system': 'premium',
  'stats_leaderboard': 'premium',
  'weekly_digest': 'premium',
  'position_alerts': 'premium',
  'naib_dynamics': 'exclusive',
  'admin_analytics': 'exclusive',
  'white_label': 'enterprise',
};
```

### 4.4 RedisService

**Purpose**: Manage Redis connection and provide caching utilities.

**Location**: `src/services/cache/RedisService.ts`

```typescript
/**
 * RedisService
 *
 * Redis client wrapper with graceful degradation.
 * Falls back to SQLite lookups if Redis unavailable.
 */

interface RedisService {
  // Connection
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;

  // Basic operations
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;

  // Entitlement cache helpers
  getEntitlements(communityId: string): Promise<Entitlements | null>;
  setEntitlements(communityId: string, entitlements: Entitlements): Promise<void>;
  invalidateEntitlements(communityId: string): Promise<void>;

  // Webhook deduplication
  isEventProcessed(eventId: string): Promise<boolean>;
  markEventProcessed(eventId: string): Promise<void>;
  acquireEventLock(eventId: string): Promise<boolean>;
  releaseEventLock(eventId: string): Promise<void>;
}
```

**Configuration**:
```typescript
const REDIS_CONFIG = {
  // Cache TTLs
  entitlementTtl: 300,      // 5 minutes
  eventDeduplicationTtl: 86400, // 24 hours
  eventLockTtl: 30,         // 30 seconds

  // Connection
  maxRetries: 3,
  retryDelayMs: 1000,
  connectTimeoutMs: 5000,
};
```

### 4.5 WaiverService

**Purpose**: Manage fee waivers for complimentary access.

**Location**: `src/services/billing/WaiverService.ts`

```typescript
/**
 * WaiverService
 *
 * Manages platform-granted fee waivers.
 * Waivers take priority over subscriptions.
 */

interface WaiverService {
  // Create waiver
  grantWaiver(params: {
    communityId: string;
    tier: SubscriptionTier;
    reason: string;
    grantedBy: string;
    expiresAt?: Date;
    internalNotes?: string;
  }): Promise<FeeWaiver>;

  // Get waiver
  getWaiver(communityId: string): Promise<FeeWaiver | null>;

  // List waivers
  listWaivers(params?: {
    includeExpired?: boolean;
  }): Promise<FeeWaiver[]>;

  // Revoke waiver
  revokeWaiver(params: {
    communityId: string;
    reason: string;
    revokedBy: string;
  }): Promise<void>;

  // Check if waiver active
  hasActiveWaiver(communityId: string): Promise<boolean>;
}

interface FeeWaiver {
  id: string;
  communityId: string;
  tier: SubscriptionTier;
  reason: string;
  grantedBy: string;
  expiresAt: Date | null;
  internalNotes: string | null;
  createdAt: Date;
  isActive: boolean;
}
```

---

## 5. Data Architecture

### 5.1 Database Schema Extensions

**Migration**: `src/db/migrations/009_billing.ts`

```sql
-- Community table (if not exists, add for future multi-tenancy)
CREATE TABLE IF NOT EXISTS communities (
  id TEXT PRIMARY KEY,
  discord_guild_id TEXT UNIQUE NOT NULL,
  name TEXT,
  data_region TEXT DEFAULT 'us' CHECK (data_region IN ('us', 'eu', 'asia')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Default community for single-tenant mode
INSERT OR IGNORE INTO communities (id, discord_guild_id, name)
VALUES ('default', (SELECT value FROM config WHERE key = 'discord_guild_id'), 'Default Community');

-- Subscriptions
CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  community_id TEXT NOT NULL REFERENCES communities(id),
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT UNIQUE,
  tier TEXT NOT NULL DEFAULT 'starter'
    CHECK (tier IN ('starter', 'basic', 'premium', 'exclusive', 'elite', 'enterprise')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'past_due', 'canceled', 'incomplete')),
  current_period_start INTEGER,
  current_period_end INTEGER,
  cancel_at_period_end INTEGER DEFAULT 0,
  grace_until INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_community
  ON subscriptions(community_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer
  ON subscriptions(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status
  ON subscriptions(status);

-- Fee Waivers
CREATE TABLE IF NOT EXISTS fee_waivers (
  id TEXT PRIMARY KEY,
  community_id TEXT NOT NULL UNIQUE REFERENCES communities(id),
  tier TEXT NOT NULL DEFAULT 'enterprise'
    CHECK (tier IN ('starter', 'basic', 'premium', 'exclusive', 'elite', 'enterprise')),
  reason TEXT NOT NULL,
  granted_by TEXT NOT NULL,
  expires_at INTEGER,
  internal_notes TEXT,
  revoked_at INTEGER,
  revoked_by TEXT,
  revoke_reason TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_fee_waivers_expires
  ON fee_waivers(expires_at);

-- Webhook Events (for idempotency)
CREATE TABLE IF NOT EXISTS webhook_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  processed_at INTEGER NOT NULL DEFAULT (unixepoch()),
  status TEXT NOT NULL DEFAULT 'processed'
    CHECK (status IN ('processed', 'failed', 'skipped'))
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_processed
  ON webhook_events(processed_at);

-- Billing Audit Log (separate from main audit_log for billing-specific events)
CREATE TABLE IF NOT EXISTS billing_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  community_id TEXT REFERENCES communities(id),
  actor TEXT,
  details TEXT NOT NULL,  -- JSON
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_billing_audit_type
  ON billing_audit_log(event_type);
CREATE INDEX IF NOT EXISTS idx_billing_audit_community
  ON billing_audit_log(community_id);
```

### 5.2 Redis Key Schema

```
# Entitlement Cache
entitlement:{community_id}
  → JSON: { tier, features[], source, expiresAt, inGracePeriod }
  → TTL: 300 seconds (5 minutes)

# Webhook Deduplication
webhook:event:{event_id}
  → Value: "processed"
  → TTL: 86400 seconds (24 hours)

# Webhook Processing Lock
webhook:lock:{event_id}
  → Value: "1"
  → TTL: 30 seconds
```

### 5.3 Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           DATA FLOW: SUBSCRIPTION LIFECYCLE                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  CHECKOUT FLOW                                                              │
│  ─────────────                                                              │
│                                                                             │
│  Admin clicks "Subscribe"                                                   │
│       │                                                                     │
│       ▼                                                                     │
│  POST /api/billing/checkout                                                 │
│       │                                                                     │
│       ▼                                                                     │
│  ┌─────────────────┐      ┌─────────────────┐                              │
│  │  StripeService  │ ───► │   Stripe API    │                              │
│  │ createCheckout  │      │ Create Session  │                              │
│  └─────────────────┘      └────────┬────────┘                              │
│                                    │                                        │
│                                    ▼                                        │
│                           Redirect to Stripe                                │
│                                    │                                        │
│                                    │ User completes payment                 │
│                                    │                                        │
│                                    ▼                                        │
│  WEBHOOK FLOW                                                               │
│  ─────────────                                                              │
│                                                                             │
│  Stripe sends checkout.session.completed                                    │
│       │                                                                     │
│       ▼                                                                     │
│  POST /api/billing/webhook                                                  │
│       │                                                                     │
│       ▼                                                                     │
│  ┌─────────────────┐                                                        │
│  │ WebhookService  │                                                        │
│  │ verifySignature │                                                        │
│  └────────┬────────┘                                                        │
│           │                                                                 │
│           ▼                                                                 │
│  ┌─────────────────┐      ┌─────────────────┐                              │
│  │  RedisService   │ ───► │   Check dedup   │                              │
│  │ isEventProcessed│      │                 │                              │
│  └────────┬────────┘      └─────────────────┘                              │
│           │                                                                 │
│           │ Not duplicate                                                   │
│           ▼                                                                 │
│  ┌─────────────────┐      ┌─────────────────┐                              │
│  │   SQLite        │ ◄─── │ Insert/Update   │                              │
│  │ subscriptions   │      │  subscription   │                              │
│  └─────────────────┘      └────────┬────────┘                              │
│                                    │                                        │
│                                    ▼                                        │
│  ┌─────────────────┐      ┌─────────────────┐                              │
│  │  RedisService   │ ◄─── │ Invalidate      │                              │
│  │ invalidateCache │      │  entitlements   │                              │
│  └─────────────────┘      └────────┬────────┘                              │
│                                    │                                        │
│                                    ▼                                        │
│  ┌─────────────────┐      ┌─────────────────┐                              │
│  │ Discord Service │ ◄─── │ Send success    │                              │
│  │ sendNotification│      │  notification   │                              │
│  └─────────────────┘      └─────────────────┘                              │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 6. API Design

### 6.1 New Endpoints

#### 6.1.1 Billing Endpoints

**POST /api/billing/checkout**
```typescript
// Create Stripe Checkout session
Request:
{
  tier: 'basic' | 'premium' | 'exclusive' | 'elite',
  successUrl: string,
  cancelUrl: string
}

Response (200):
{
  sessionId: string,
  url: string  // Redirect user here
}

Errors:
- 400: Invalid tier
- 401: Not authorized (admin only)
- 500: Stripe API error
```

**GET /api/billing/portal**
```typescript
// Get Stripe Customer Portal URL
Request:
Query: { returnUrl: string }

Response (200):
{
  url: string  // Redirect user here
}

Errors:
- 400: No active subscription
- 401: Not authorized
- 500: Stripe API error
```

**GET /api/billing/subscription**
```typescript
// Get current subscription details
Response (200):
{
  tier: SubscriptionTier,
  source: 'waiver' | 'subscription' | 'free',
  status: 'active' | 'past_due' | 'canceled',
  currentPeriodEnd?: string,  // ISO date
  cancelAtPeriodEnd: boolean,
  inGracePeriod: boolean,
  features: Feature[]
}
```

**POST /api/billing/webhook**
```typescript
// Stripe webhook handler
Headers:
  Stripe-Signature: string

Request Body: Raw Stripe event

Response (200):
{
  received: true
}

Response (400):
{
  error: 'Invalid signature' | 'Event processing failed'
}
```

#### 6.1.2 Waiver Endpoints (Admin)

**POST /admin/waivers**
```typescript
// Grant fee waiver
Request:
{
  communityId: string,
  tier?: SubscriptionTier,  // Default: 'enterprise'
  reason: string,
  expiresAt?: string,  // ISO date
  internalNotes?: string
}

Response (201):
{
  id: string,
  communityId: string,
  tier: SubscriptionTier,
  reason: string,
  expiresAt: string | null,
  createdAt: string
}

Errors:
- 400: Invalid request body
- 401: Not authorized
- 409: Waiver already exists for community
```

**GET /admin/waivers**
```typescript
// List all waivers
Query:
  includeExpired?: boolean  // Default: false

Response (200):
{
  waivers: FeeWaiver[]
}
```

**DELETE /admin/waivers/:communityId**
```typescript
// Revoke waiver
Request:
{
  reason: string
}

Response (200):
{
  success: true,
  message: 'Waiver revoked'
}

Errors:
- 404: Waiver not found
- 401: Not authorized
```

#### 6.1.3 Entitlement Endpoints

**GET /api/entitlements**
```typescript
// Get current entitlements
Response (200):
{
  tier: SubscriptionTier,
  maxMembers: number,
  features: Feature[],
  source: 'waiver' | 'subscription' | 'free',
  inGracePeriod: boolean
}
```

**GET /api/features/:feature**
```typescript
// Check specific feature access
Response (200):
{
  feature: string,
  canAccess: boolean,
  currentTier: SubscriptionTier,
  requiredTier: SubscriptionTier,
  upgradeUrl?: string
}
```

### 6.2 Modified Endpoints

Existing endpoints that need modification to check entitlements:

| Endpoint | Modification |
|----------|--------------|
| `GET /api/v1/members` | Add member count limit check |
| Discord `/stats` | Check `stats_leaderboard` feature |
| Discord `/leaderboard` | Check `stats_leaderboard` feature |
| Discord `/admin-stats` | Check `admin_analytics` feature |
| Discord `/position` | Check `position_alerts` feature |
| All tier-related commands | Check `nine_tier_system` feature |

### 6.3 Webhook Event Handlers

```typescript
// Webhook event handlers
const webhookHandlers: Record<string, WebhookHandler> = {
  'checkout.session.completed': async (event) => {
    // Extract community ID and tier from metadata
    // Create/update subscription record
    // Invalidate entitlement cache
    // Send success notification
  },

  'invoice.paid': async (event) => {
    // Update subscription current_period_end
    // Clear any grace period
    // Invalidate entitlement cache
  },

  'invoice.payment_failed': async (event) => {
    // Set grace period (24 hours)
    // Send warning notification to admin
    // Do NOT revoke access yet
  },

  'customer.subscription.updated': async (event) => {
    // Update tier if changed
    // Update cancel_at_period_end flag
    // Invalidate entitlement cache
  },

  'customer.subscription.deleted': async (event) => {
    // Set status to 'canceled'
    // If past grace period, revoke features
    // Send cancellation notification
  },
};
```

---

## 7. Security Architecture

### 7.1 Authentication & Authorization

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        AUTHENTICATION LAYERS                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  PUBLIC ENDPOINTS                                                           │
│  ─────────────────                                                          │
│  GET /health                    No auth required                            │
│  POST /api/billing/webhook      Stripe signature verification               │
│                                                                             │
│  MEMBER ENDPOINTS                                                           │
│  ─────────────────                                                          │
│  GET /api/*                     Discord OAuth2 (via bot context)            │
│  POST /api/billing/checkout     Admin role required                         │
│  GET /api/billing/portal        Admin role required                         │
│                                                                             │
│  ADMIN ENDPOINTS                                                            │
│  ─────────────────                                                          │
│  /admin/*                       API Key required (X-API-Key header)         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 7.2 Stripe Webhook Security

```typescript
/**
 * Webhook signature verification
 */
function verifyWebhookSignature(
  payload: string | Buffer,
  signature: string,
  webhookSecret: string
): Stripe.Event {
  try {
    return stripe.webhooks.constructEvent(
      payload,
      signature,
      webhookSecret
    );
  } catch (err) {
    throw new WebhookSignatureError('Invalid signature');
  }
}

// Middleware for webhook endpoint
app.post('/api/billing/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const signature = req.headers['stripe-signature'];

    if (!signature) {
      return res.status(400).json({ error: 'Missing signature' });
    }

    try {
      const event = verifyWebhookSignature(
        req.body,
        signature,
        config.stripe.webhookSecret
      );

      await webhookService.processEvent(event);
      res.json({ received: true });
    } catch (err) {
      logger.error({ err }, 'Webhook processing failed');
      res.status(400).json({ error: err.message });
    }
  }
);
```

### 7.3 Data Protection

| Data Type | Protection | Storage |
|-----------|------------|---------|
| Stripe Customer ID | Encrypted at rest (SQLite) | Local |
| Stripe Subscription ID | Encrypted at rest (SQLite) | Local |
| Credit Card Data | Never stored | Stripe only |
| Payment History | Never stored | Stripe only |
| Webhook Payloads | Hash stored only | Local (for dedup) |
| Entitlement Cache | Short TTL (5 min) | Redis |

### 7.4 Secrets Management

```bash
# Required secrets (never commit to git)
STRIPE_SECRET_KEY=sk_live_...        # Stripe API key
STRIPE_WEBHOOK_SECRET=whsec_...      # Webhook signature secret
REDIS_URL=redis://...                # Upstash connection string

# Environment-specific
NODE_ENV=production                   # Affects Stripe mode
```

### 7.5 Audit Trail

All billing-related actions are logged to `billing_audit_log`:

| Event Type | Logged Data |
|------------|-------------|
| `subscription.created` | community_id, tier, stripe_subscription_id |
| `subscription.updated` | community_id, old_tier, new_tier |
| `subscription.canceled` | community_id, reason |
| `waiver.granted` | community_id, tier, reason, granted_by |
| `waiver.revoked` | community_id, reason, revoked_by |
| `payment.failed` | community_id, grace_until |
| `payment.succeeded` | community_id, amount |
| `feature.denied` | community_id, feature, required_tier |

---

## 8. Integration Points

### 8.1 Stripe Integration

**Products to Create in Stripe Dashboard**:
```
Products:
├── sietch-basic
│   └── price_basic ($15/month, recurring)
├── sietch-premium
│   └── price_premium ($35/month, recurring)
├── sietch-exclusive
│   └── price_exclusive ($149/month, recurring)
├── sietch-elite
│   └── price_elite ($449/month, recurring)
├── sietch-badge (optional, v4.0)
│   └── price_badge ($4.99, one-time)
└── sietch-boost (optional, v4.0)
    └── price_boost ($2.99/month, recurring)
```

**Webhook Configuration**:
```
Endpoint URL: https://api.sietch.io/api/billing/webhook
Events:
- checkout.session.completed
- invoice.paid
- invoice.payment_failed
- customer.subscription.created
- customer.subscription.updated
- customer.subscription.deleted
```

### 8.2 Redis Integration (Upstash)

**Setup**:
1. Create Upstash account
2. Create Redis database (free tier: 10,000 commands/day)
3. Get connection string
4. Set `REDIS_URL` environment variable

**Connection Handling**:
```typescript
// Graceful degradation if Redis unavailable
async function getEntitlements(communityId: string): Promise<Entitlements> {
  try {
    // Try Redis first
    const cached = await redisService.getEntitlements(communityId);
    if (cached) return cached;
  } catch (err) {
    logger.warn({ err }, 'Redis unavailable, falling back to DB');
  }

  // Fallback to SQLite
  return await gatekeeperService.lookupEntitlements(communityId);
}
```

### 8.3 Discord Integration

**New Discord Embed: Upgrade Prompt**
```typescript
const upgradeEmbed = new EmbedBuilder()
  .setColor(0xFFD700)
  .setTitle('Premium Feature')
  .setDescription(`The **${featureName}** feature requires **${requiredTier}** tier.`)
  .addFields(
    { name: 'Current Tier', value: currentTier, inline: true },
    { name: 'Required Tier', value: requiredTier, inline: true },
  )
  .setFooter({ text: 'Contact your admin to upgrade' });
```

---

## 9. Scalability & Performance

### 9.1 Caching Strategy

| Data | Cache Location | TTL | Invalidation |
|------|---------------|-----|--------------|
| Entitlements | Redis | 5 min | On subscription change |
| Webhook Events | Redis | 24 hours | Never (TTL expiry) |
| Feature Matrix | In-memory | Forever | On deploy |
| Subscription Lookup | None | - | Real-time from DB |

### 9.2 Performance Targets

| Operation | Target | Current |
|-----------|--------|---------|
| Feature check (cached) | <10ms | - |
| Feature check (DB fallback) | <50ms | - |
| Webhook processing | <500ms | - |
| Checkout session creation | <2s | - |

### 9.3 Future Scaling Considerations

For v4.1 multi-tenancy:
- Add connection pooling for multiple communities
- Consider read replicas for SQLite (Litestream)
- Add rate limiting per community
- Implement cache warming on startup

---

## 10. Deployment Architecture

### 10.1 Current Infrastructure (Preserved)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         VPS DEPLOYMENT (v4.0)                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                        OVH VPS Starter                               │   │
│  │                   (2 vCPU, 4GB RAM, Ubuntu 22.04)                    │   │
│  │                                                                      │   │
│  │  ┌───────────────┐                                                   │   │
│  │  │    nginx      │ ─── Rate limiting, SSL termination                │   │
│  │  └───────┬───────┘                                                   │   │
│  │          │                                                           │   │
│  │          ▼                                                           │   │
│  │  ┌───────────────┐                                                   │   │
│  │  │     PM2       │ ─── Process management, auto-restart              │   │
│  │  └───────┬───────┘                                                   │   │
│  │          │                                                           │   │
│  │          ▼                                                           │   │
│  │  ┌───────────────┐     ┌───────────────┐                            │   │
│  │  │ sietch-service│ ──► │   SQLite      │                            │   │
│  │  │   (Node.js)   │     │ /data/sietch.db                            │   │
│  │  └───────────────┘     └───────────────┘                            │   │
│  │                                                                      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│                    │                              │                         │
│                    ▼                              ▼                         │
│           ┌───────────────┐              ┌───────────────┐                 │
│           │ Upstash Redis │              │    Stripe     │                 │
│           │   (External)  │              │  (External)   │                 │
│           └───────────────┘              └───────────────┘                 │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 10.2 Environment Configuration

**.env.local additions**:
```bash
# Stripe Configuration
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_ID_BASIC=price_...
STRIPE_PRICE_ID_PREMIUM=price_...
STRIPE_PRICE_ID_EXCLUSIVE=price_...
STRIPE_PRICE_ID_ELITE=price_...

# Redis Configuration
REDIS_URL=redis://default:...@...:6379

# Feature Flags
FEATURE_BILLING_ENABLED=true
FEATURE_GATEKEEPER_ENABLED=true
```

### 10.3 Deployment Process

```bash
# Pre-deployment
1. Backup database: cp /data/sietch.db /backups/sietch.db.$(date +%Y%m%d)
2. Run migrations: npm run migrate
3. Verify Stripe products exist

# Deployment
4. git pull origin main
5. npm install
6. npm run build
7. pm2 restart sietch-service

# Post-deployment
8. Verify health: curl https://api.sietch.io/health
9. Test webhook: stripe trigger checkout.session.completed
10. Verify logs: pm2 logs sietch-service --lines 100
```

---

## 11. Development Workflow

### 11.1 Local Development

```bash
# Setup
cp .env.example .env.local
# Edit .env.local with test Stripe keys

# Install dependencies
npm install

# Run migrations
npm run migrate

# Start development server
npm run dev

# Run tests
npm test
```

### 11.2 Testing Strategy

**Unit Tests**:
```typescript
// src/services/billing/__tests__/GatekeeperService.test.ts
describe('GatekeeperService', () => {
  describe('checkAccess', () => {
    it('returns canAccess=true for starter tier with basic_tgr', async () => {
      // ...
    });

    it('returns canAccess=false for starter tier with nine_tier_system', async () => {
      // ...
    });

    it('uses cached entitlements when available', async () => {
      // ...
    });

    it('falls back to DB when Redis unavailable', async () => {
      // ...
    });
  });
});
```

**Integration Tests**:
```typescript
// src/services/billing/__tests__/webhook.integration.test.ts
describe('Webhook Integration', () => {
  it('processes checkout.session.completed correctly', async () => {
    const payload = createMockStripeEvent('checkout.session.completed');
    const result = await webhookService.processEvent(payload);

    expect(result.status).toBe('processed');
    // Verify subscription created in DB
    // Verify cache invalidated
  });

  it('rejects duplicate events', async () => {
    const payload = createMockStripeEvent('checkout.session.completed');
    await webhookService.processEvent(payload);
    const result = await webhookService.processEvent(payload);

    expect(result.status).toBe('duplicate');
  });
});
```

### 11.3 Stripe CLI Testing

```bash
# Listen for webhooks locally
stripe listen --forward-to localhost:3000/api/billing/webhook

# Trigger test events
stripe trigger checkout.session.completed
stripe trigger invoice.paid
stripe trigger invoice.payment_failed
stripe trigger customer.subscription.deleted
```

---

## 12. Technical Risks & Mitigation

### 12.1 Risk Matrix

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Stripe API outage | Low | High | Grace period, cached entitlements |
| Redis unavailable | Low | Medium | SQLite fallback, in-memory cache |
| Webhook delivery failure | Medium | Medium | Idempotent handlers, manual retry |
| Feature gate bypass | Low | High | Server-side only, no client checks |
| Data migration issues | Low | Critical | Backup before migration, row counts |
| Subscription sync drift | Medium | Low | Periodic reconciliation job |

### 12.2 Fallback Strategies

**Redis Unavailable**:
```typescript
async function getEntitlements(communityId: string): Promise<Entitlements> {
  try {
    return await redisService.getEntitlements(communityId);
  } catch {
    logger.warn('Redis fallback to DB');
    return await lookupEntitlementsFromDB(communityId);
  }
}
```

**Stripe Webhook Failure**:
```typescript
// Manual reconciliation endpoint
app.post('/admin/reconcile-subscriptions', adminAuth, async (req, res) => {
  const subscriptions = await stripe.subscriptions.list({ limit: 100 });
  for (const sub of subscriptions.data) {
    await syncSubscription(sub);
  }
  res.json({ synced: subscriptions.data.length });
});
```

### 12.3 Monitoring Alerts

| Alert | Condition | Action |
|-------|-----------|--------|
| Webhook failures | >3 failures in 1 hour | Check Stripe dashboard, manual reconcile |
| Redis connection lost | No connection for 5 min | Check Upstash status, restart service |
| Payment failures spike | >10% failure rate | Check Stripe Radar, contact support |
| Feature denials spike | >100 denials in 1 hour | Review tier assignments, cache issues |

---

## 13. Future Considerations

### 13.1 v4.1 Multi-Tenancy

- Add `community_id` foreign key to all tables
- Implement community isolation middleware
- Add per-community rate limiting
- Deploy regional databases (US, EU, Asia)

### 13.2 v4.2 White-Label

- Theme engine for branding
- Custom domain support
- Configurable tier names
- Community-specific assets

### 13.3 Technical Debt

| Item | Priority | Notes |
|------|----------|-------|
| Express → Hono migration | Low | Better performance, but working fine |
| SQLite → PostgreSQL | Medium | For multi-tenancy, regional deployment |
| Add OpenTelemetry tracing | Medium | For production observability |
| Implement rate limiting per feature | Low | Prevent abuse at feature level |

---

## 14. Appendix

### 14.1 Type Definitions

```typescript
// src/types/billing.ts

export type SubscriptionTier =
  | 'starter'
  | 'basic'
  | 'premium'
  | 'exclusive'
  | 'elite'
  | 'enterprise';

export type Feature =
  | 'basic_tgr'
  | 'member_limit_25'
  | 'member_limit_500'
  | 'member_limit_1000'
  | 'member_limit_2500'
  | 'member_limit_7500'
  | 'member_limit_unlimited'
  | 'nine_tier_system'
  | 'stats_leaderboard'
  | 'weekly_digest'
  | 'position_alerts'
  | 'naib_dynamics'
  | 'admin_analytics'
  | 'white_label';

export interface Subscription {
  id: string;
  communityId: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  tier: SubscriptionTier;
  status: 'active' | 'past_due' | 'canceled' | 'incomplete';
  currentPeriodStart: number | null;
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean;
  graceUntil: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface FeeWaiver {
  id: string;
  communityId: string;
  tier: SubscriptionTier;
  reason: string;
  grantedBy: string;
  expiresAt: number | null;
  internalNotes: string | null;
  revokedAt: number | null;
  revokedBy: string | null;
  revokeReason: string | null;
  createdAt: number;
}

export interface Entitlements {
  tier: SubscriptionTier;
  maxMembers: number;
  features: Feature[];
  source: 'waiver' | 'subscription' | 'free';
  inGracePeriod: boolean;
  expiresAt?: number;
}
```

### 14.2 Configuration Schema Extension

```typescript
// Addition to src/config.ts

const stripeConfigSchema = z.object({
  secretKey: z.string().min(1),
  webhookSecret: z.string().min(1),
  priceIds: z.object({
    basic: z.string().min(1),
    premium: z.string().min(1),
    exclusive: z.string().min(1),
    elite: z.string().min(1),
  }),
});

const redisConfigSchema = z.object({
  url: z.string().url(),
  maxRetries: z.number().default(3),
  connectTimeout: z.number().default(5000),
});

const featureFlagsSchema = z.object({
  billingEnabled: z.boolean().default(true),
  gatekeeperEnabled: z.boolean().default(true),
  boostsEnabled: z.boolean().default(false),
  badgesEnabled: z.boolean().default(false),
});
```

### 14.3 Migration Checklist

**Pre-Migration**:
- [ ] Backup SQLite database
- [ ] Create Stripe products and prices
- [ ] Set up Upstash Redis database
- [ ] Configure environment variables
- [ ] Test webhook endpoint locally

**Migration**:
- [ ] Run database migration (009_billing.ts)
- [ ] Deploy updated code
- [ ] Configure Stripe webhook endpoint
- [ ] Verify webhook signature

**Post-Migration**:
- [ ] Test checkout flow end-to-end
- [ ] Verify entitlement caching works
- [ ] Test feature gating for each tier
- [ ] Monitor webhook processing
- [ ] Verify grace period behavior

---

*SDD v4.0 generated by Loa architect workflow*
*Sources: PRD v4.0, sietch-service v3.0 codebase, ARCHITECTURE_SPEC_v2.9.0.md*

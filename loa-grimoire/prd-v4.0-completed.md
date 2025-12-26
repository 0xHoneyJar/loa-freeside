# Product Requirements Document: Sietch v4.0

**Version**: 4.0
**Date**: December 26, 2025
**Status**: DRAFT
**Codename**: The Unification

---

## Document Traceability

| Section | Primary Source | Secondary Sources |
|---------|---------------|-------------------|
| Problem Statement | ARCHITECTURE_SPEC_v2.9.0.md:1-50 | BOOTSTRAP_PROMPT.md:9-11 |
| Vision | BOOTSTRAP_PROMPT.md:9-50 | Existing Sietch v3.0 codebase |
| Billing Model | ARCHITECTURE_SPEC_v2.9.0.md:203-296 | Phase 2 Interview |
| Technical Stack | BOOTSTRAP_PROMPT.md:850-865 | sietch-unified reference |
| Existing Features | Sietch v3.0 codebase | prd-v2.1.md (historical) |

---

## 1. Executive Summary

### 1.1 Product Overview

**Sietch v4.0 "The Unification"** evolves the existing Sietch v3.0 community management system into an enterprise-grade SaaS platform. This release preserves ALL existing v3.0 features while adding:

1. **Stripe SaaS Billing** - Subscription tiers aligned with Collab.Land pricing
2. **Multi-Tenancy Foundation** - Community isolation for future multi-server support
3. **Enterprise Hardening** - Quality gates, secret scanning, deployment controls
4. **Migration Infrastructure** - Hybrid VPS→GCP deployment path

### 1.2 Problem Statement

**Current State (v3.0):**
- Single-tenant Discord bot for BGT holder community management
- Manual deployment via PM2 on VPS
- No monetization capability
- No multi-community support

**Target State (v4.0):**
- Multi-tenant SaaS platform foundation
- Stripe-powered subscription billing
- Enterprise deployment controls
- Path to multi-community, multi-platform support

**Why Now:**
- v3.0 feature set is complete and stable (22 sprints, ~15,000 LOC)
- Market demand for token-gated community tools
- Revenue generation needed to sustain development
- Enterprise customers requesting white-label options

### 1.3 Vision

Sietch becomes the **enterprise-grade token-gated community platform**:

- **For community operators**: Monetizable SaaS with tiered features
- **For members**: Privacy-first, pseudonymous community experience
- **For enterprises**: White-label, GDPR-compliant, multi-region deployment

### 1.4 Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Billing integration | 100% payment success rate | Stripe webhook completion |
| Migration safety | Zero data loss during migration | Pre/post row counts |
| Feature parity | All v3.0 features functional | Regression test suite |
| Deployment reliability | <5min deployment time | CI/CD metrics |
| Grace period effectiveness | <1% role stripping during outages | Audit logs |

### 1.5 Preserved v3.0 Capabilities

**CRITICAL**: The following features from v3.0 MUST be preserved:

| Feature | Sprint | Status |
|---------|--------|--------|
| 9-Tier Progression System | 15-18 | Preserve |
| Tier Notifications | 18 | Preserve |
| Stats & Leaderboard | 19 | Preserve |
| Weekly Digest | 20 | Preserve |
| Story Fragments | 21 | Preserve |
| Admin Analytics | 21 | Preserve |
| Integration Tests | 22 | Preserve |
| Naib Dynamics | 14 | Preserve |
| Cave Entrance (Waitlist) | 14 | Preserve |
| Position Alerts | 14 | Preserve |

---

## 2. User & Stakeholder Context

### 2.1 Target Users

| User Type | Description | Primary Needs |
|-----------|-------------|---------------|
| **Platform Operator** | Runs the Sietch SaaS platform | Revenue, multi-tenancy, ops tools |
| **Community Admin** | Discord server owner using Sietch | Easy setup, billing management, analytics |
| **Premium Member** | Token holder in paid community | All v3.0 features, badge display |
| **Free Tier Member** | Member in free/starter community | Basic token gating, tier display |
| **Aspiring Member** | On waitlist (Cave Entrance) | Visibility, eligibility notifications |

### 2.2 User Stories

#### Platform Operator (NEW)
- As a platform operator, I want communities to self-service subscribe so I can scale without manual onboarding
- As a platform operator, I want to grant fee waivers to partners so I can support strategic relationships
- As a platform operator, I want deployment gates so I can ensure code quality before production

#### Community Admin (NEW)
- As a community admin, I want to subscribe to a tier that matches my community size
- As a community admin, I want a grace period if my payment fails so my members aren't immediately affected
- As a community admin, I want to see which features unlock at each tier

#### Premium Member (PRESERVED + ENHANCED)
- As a premium member, I want all existing v3.0 features (tiers, stats, leaderboards)
- As a premium member, I want to display my Sietch Score as a badge (NEW)
- As a premium member, I want to boost my community (NEW)

#### Free Tier Member (NEW)
- As a free tier member, I want basic token gating (25 members max)
- As a free tier member, I want to see upgrade prompts for premium features

### 2.3 Privacy Threat Model (PRESERVED)

All v3.0 privacy constraints remain in effect:

| Data Point | Public | Members | Admin | Never |
|------------|--------|---------|-------|-------|
| Wallet address | | | | ✓ |
| Discord UID | | | ✓ | |
| BGT holdings | | | ✓ | |
| Pseudonym (Nym) | ✓ | | | |
| Conviction score | | ✓ | | |
| Tier assignment | ✓ | | | |
| Position rank | | ✓ | | |

**NEW Privacy Considerations for v4.0:**
- Payment data: Stripe-managed, never stored locally
- Community billing: Admin-only visibility
- Cross-community data: Isolated (multi-tenancy)

---

## 3. Functional Requirements

### 3.1 Preserved Features (v3.0)

All features from Sietch v3.0 are preserved without modification:

#### 3.1.1 9-Tier System
- Traveler, Acolyte, Fremen, Sayyadina, Sandrider, Reverend Mother, Usul, Fedaykin, Naib
- BGT-based tier calculation
- Discord role synchronization
- Tier promotion/demotion notifications

#### 3.1.2 Member Features
- `/stats` - Personal statistics
- `/leaderboard` - Community rankings
- Profile management (nym, visibility)
- Position alerts (at-risk warnings)

#### 3.1.3 Admin Features
- `/admin-stats` - Community analytics
- Weekly digest generation
- Story fragment posting
- Manual sync triggers

#### 3.1.4 Naib Dynamics
- First 7 eligible = Naib status
- Dynamic seat competition
- Former Naib recognition
- Naib Archives access

#### 3.1.5 Cave Entrance
- Positions 70-100 waitlist
- Public threshold visibility
- Waitlist registration
- Eligibility notifications

### 3.2 New Features (v4.0)

#### 3.2.1 Stripe Billing Integration

**FR-4.0.1**: Subscription Management
- Community admins can subscribe via Stripe Checkout
- Tier alignment: Starter (Free) → Basic ($15) → Premium ($35) → Exclusive ($149) → Elite ($449) → Enterprise (Contact)
- Self-service upgrade/downgrade via Stripe Customer Portal

**FR-4.0.2**: Webhook Processing
- Idempotent webhook handler (Redis-based deduplication)
- Events: `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.deleted`, `customer.subscription.updated`
- HMAC-SHA256 signature verification

**FR-4.0.3**: Grace Period
- 24-hour grace period on payment failure
- Warning notifications to admin
- Soft access revocation (settings preserved)
- Re-activation on payment success

**FR-4.0.4**: Fee Waivers
- Platform operators can grant complimentary access
- Waiver priority: Fee Waiver > Subscription > Free Tier
- Audit trail with reason and expiration
- API: `POST /admin/waivers`, `GET /admin/waivers`, `DELETE /admin/waivers/:id`

#### 3.2.2 Feature Gating (Gatekeeper Service)

**FR-4.0.5**: Entitlement Checking
- Redis-cached entitlements (5-minute TTL)
- Feature matrix enforcement:

| Feature | Starter | Basic | Premium | Exclusive | Elite | Enterprise |
|---------|---------|-------|---------|-----------|-------|------------|
| Verified Members | 25 | 500 | 1,000 | 2,500 | 7,500 | Unlimited |
| Basic TGRs | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 9-Tier System | | | ✓ | ✓ | ✓ | ✓ |
| Stats & Leaderboard | | | ✓ | ✓ | ✓ | ✓ |
| Weekly Digest | | | ✓ | ✓ | ✓ | ✓ |
| Position Alerts | | | ✓ | ✓ | ✓ | ✓ |
| Naib Dynamics | | | | ✓ | ✓ | ✓ |
| Admin Analytics | | | | ✓ | ✓ | ✓ |
| White-label | | | | | | ✓ |

**FR-4.0.6**: Upgrade Prompts
- Non-intrusive prompts when accessing gated features
- Direct link to Stripe Checkout for upgrade
- "Unlock with Premium" style messaging

#### 3.2.3 Score Badge (Optional Add-on)

**FR-4.0.7**: Badge Display
- Users can display conviction score in Discord messages
- Styles: `default` (⚡ 847 | Fedaykin), `minimal` (⚡847), `detailed`
- Free for Premium+ tiers, $4.99 one-time for lower tiers

**FR-4.0.8**: Badge Management
- Enable/disable per platform
- Style selection
- Bot integration for display

#### 3.2.4 Community Boosts (Collective Funding)

**FR-4.0.9**: Boost Levels
- Members can purchase boosts ($2.99/month each)
- Level thresholds: 2 boosts = Basic, 7 = Premium, 14 = Exclusive, 30 = Elite
- Higher of (subscription tier, boost level) wins

**FR-4.0.10**: Booster Perks
- "Booster" badge
- Priority in member directory
- Recognition in announcements

**FR-4.0.11**: Sustain Period
- 7-day grace when boost level drops
- Prevents immediate feature loss

#### 3.2.5 Multi-Tenancy Foundation

**FR-4.0.12**: Community Isolation
- `community_id` column on all member data
- Database queries scoped by community
- Prepared for future multi-community support

**FR-4.0.13**: Data Region Selection (GDPR Prep)
- Community selects data region during onboarding: US, EU, Asia
- Region stored but single-region deployment in v4.0
- Foundation for v4.1 regional databases

### 3.3 API Endpoints

#### 3.3.1 Preserved Endpoints (v3.0)
All existing endpoints remain functional:
- `GET /health` - Health check
- `GET /api/v1/members` - Member listing
- `GET /api/v1/members/:id` - Member details
- `GET /api/v1/stats` - Community statistics
- `POST /api/v1/sync` - Trigger sync (admin)

#### 3.3.2 New Endpoints (v4.0)

**Billing:**
- `POST /api/billing/checkout` - Create Stripe Checkout session
- `GET /api/billing/portal` - Get Stripe Customer Portal URL
- `GET /api/billing/subscription` - Current subscription details
- `POST /api/billing/webhook` - Stripe webhook handler

**Waivers (Admin):**
- `POST /admin/waivers` - Grant fee waiver
- `GET /admin/waivers` - List all waivers
- `DELETE /admin/waivers/:communityId` - Revoke waiver

**Badges:**
- `GET /api/badge/entitlement` - Check badge access
- `POST /api/badge/purchase` - Purchase badge (lower tiers)
- `GET /api/badge/display/:platform/:platformId` - Get badge for display
- `PUT /api/badge/settings` - Update badge settings

**Boosts:**
- `GET /api/boost/levels` - Get boost level definitions
- `GET /api/boost/status/:communityId` - Community boost status
- `POST /api/boost/purchase` - Purchase boosts
- `GET /api/boost/boosters/:communityId` - List boosters

**Gatekeeper:**
- `GET /api/entitlements` - Current community entitlements
- `GET /api/features/:feature` - Check specific feature access

---

## 4. Technical & Non-Functional Requirements

### 4.1 Preserved Architecture (v3.0)

The existing sietch-service architecture is preserved:

```
sietch-service/
├── src/
│   ├── index.ts              # Application entry
│   ├── bot.ts                # Discord bot
│   ├── services/             # Business logic
│   │   ├── ChainService.ts   # Blockchain interaction
│   │   ├── TierService.ts    # 9-tier calculations
│   │   ├── StatsService.ts   # Analytics
│   │   ├── DigestService.ts  # Weekly digest
│   │   ├── StoryService.ts   # Story fragments
│   │   └── NotificationService.ts
│   ├── database/             # SQLite + migrations
│   └── commands/             # Discord slash commands
├── data/                     # SQLite database
└── .env.local               # Configuration
```

### 4.2 New Services (v4.0)

```
sietch-service/
├── src/
│   ├── services/
│   │   ├── billing/
│   │   │   ├── StripeService.ts      # Stripe API client
│   │   │   ├── WebhookService.ts     # Webhook processing
│   │   │   ├── GatekeeperService.ts  # Feature gating
│   │   │   └── WaiverService.ts      # Fee waivers
│   │   ├── badge/
│   │   │   └── BadgeService.ts       # Score badges
│   │   ├── boost/
│   │   │   └── BoostService.ts       # Community boosts
│   │   └── cache/
│   │       └── RedisService.ts       # Entitlement cache
│   └── routes/
│       ├── billing.routes.ts
│       ├── badge.routes.ts
│       └── boost.routes.ts
```

### 4.3 Database Schema Extensions

```sql
-- Subscriptions
CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY,
  community_id TEXT NOT NULL,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  tier TEXT NOT NULL DEFAULT 'starter',
  status TEXT NOT NULL DEFAULT 'active',
  current_period_end INTEGER,
  grace_until INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Fee Waivers
CREATE TABLE fee_waivers (
  id TEXT PRIMARY KEY,
  community_id TEXT NOT NULL UNIQUE,
  tier TEXT NOT NULL DEFAULT 'enterprise',
  reason TEXT NOT NULL,
  granted_by TEXT NOT NULL,
  expires_at INTEGER,
  internal_notes TEXT,
  created_at INTEGER NOT NULL
);

-- Badges
CREATE TABLE badge_purchases (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  stripe_payment_id TEXT,
  purchased_at INTEGER NOT NULL
);

CREATE TABLE badge_settings (
  member_id TEXT PRIMARY KEY,
  display_on_discord INTEGER DEFAULT 1,
  display_on_telegram INTEGER DEFAULT 0,
  badge_style TEXT DEFAULT 'default'
);

-- Boosts
CREATE TABLE boosts (
  id TEXT PRIMARY KEY,
  community_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  stripe_subscription_id TEXT,
  boost_count INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL
);

-- Webhook Idempotency
CREATE TABLE webhook_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  processed_at INTEGER NOT NULL,
  status TEXT NOT NULL
);
```

### 4.4 Infrastructure Requirements

#### 4.4.1 Preserved (VPS)
- OVH VPS Starter (2 vCPU, 4GB RAM)
- Ubuntu 22.04 LTS
- Node.js 20 LTS
- PM2 process manager
- SQLite database
- nginx reverse proxy

#### 4.4.2 New Requirements (v4.0)
- **Redis**: Entitlement cache (5-min TTL)
  - Option A: Redis Cloud free tier
  - Option B: Upstash serverless Redis
- **Stripe Account**: For payment processing
- **Environment Variables**:
  ```bash
  STRIPE_SECRET_KEY=sk_live_...
  STRIPE_WEBHOOK_SECRET=whsec_...
  STRIPE_PRICE_ID_BASIC=price_...
  STRIPE_PRICE_ID_PREMIUM=price_...
  STRIPE_PRICE_ID_EXCLUSIVE=price_...
  STRIPE_PRICE_ID_ELITE=price_...
  REDIS_URL=redis://...
  ```

### 4.5 Security Requirements

#### 4.5.1 Preserved (v3.0)
- API key authentication
- Discord OAuth2
- Rate limiting (nginx)
- Input validation

#### 4.5.2 New Requirements (v4.0)
- **Stripe Webhook Verification**: HMAC-SHA256 signature validation
- **Secret Scanning**: TruffleHog in CI pipeline
- **Deployment Gates**:
  - Integrity checks
  - Type checking
  - Lint passing
  - Test passing

### 4.6 Performance Requirements

| Metric | Target | Measurement |
|--------|--------|-------------|
| Webhook processing | <500ms | Stripe dashboard |
| Entitlement check | <10ms (cached) | Application logs |
| Feature gate decision | <50ms | Application logs |
| Badge display lookup | <100ms | Application logs |

### 4.7 Compliance Requirements

#### 4.7.1 Payment Compliance
- PCI DSS: Handled by Stripe (no card data stored locally)
- Refund policy: Standard Stripe refund handling
- Invoice generation: Stripe automatic invoicing

#### 4.7.2 GDPR Preparation (v4.0 Foundation)
- `data_region` column added to communities table
- Selection UI during onboarding (US/EU/Asia)
- Actual regional deployment deferred to v4.1

---

## 5. Scope & Prioritization

### 5.1 In Scope (v4.0)

| Priority | Feature | Effort |
|----------|---------|--------|
| P0 | Stripe billing integration | High |
| P0 | Gatekeeper service (feature gating) | Medium |
| P0 | Fee waiver system | Low |
| P0 | Webhook idempotency | Medium |
| P1 | Score badges | Medium |
| P1 | Community boosts | Medium |
| P2 | Multi-tenancy foundation | Medium |
| P2 | Deployment gates (CI/CD) | Low |

### 5.2 Out of Scope (v4.0)

| Feature | Reason | Target Version |
|---------|--------|----------------|
| Telegram support | Scope reduction | v4.1 |
| Telegram Mini App | Scope reduction | v4.1 |
| Regional databases (multi-region) | Infrastructure complexity | v4.1 |
| White-label theming | Enterprise-only | v4.2 |
| Multi-chain token gating | Collab.Land integration | v4.2 |
| AI Quiz Agent | Elite feature | v5.0 |
| GCP Cloud Run migration | Hybrid approach | v4.1+ |

### 5.3 Migration Path

```
v3.0 (Current)                    v4.0 (This Release)
┌─────────────────────┐          ┌─────────────────────┐
│ Single-tenant       │          │ Single-tenant       │
│ Discord only        │    ──►   │ Discord only        │
│ No billing          │          │ Stripe billing      │
│ VPS deployment      │          │ VPS + Redis         │
│ All features free   │          │ Gated features      │
└─────────────────────┘          └─────────────────────┘
                                          │
                                          ▼
                                 v4.1 (Next Release)
                                 ┌─────────────────────┐
                                 │ Multi-tenant        │
                                 │ Discord + Telegram  │
                                 │ Regional databases  │
                                 │ GCP Cloud Run       │
                                 └─────────────────────┘
```

---

## 6. Risks & Dependencies

### 6.1 External Dependencies

| Dependency | Risk Level | Mitigation |
|------------|------------|------------|
| Stripe API | Low | Well-documented, reliable SLA |
| Redis | Low | Multiple provider options, local fallback |
| Discord API | Low | Existing integration proven |
| Berachain RPC | Medium | Existing 24hr grace period |

### 6.2 Technical Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Webhook delivery failures | Medium | Medium | Idempotent handler, retry logic |
| Redis unavailability | Low | Medium | Graceful degradation to DB lookup |
| Feature gate bypass | Low | High | Server-side enforcement, audit logging |
| Migration data loss | Low | Critical | Pre-migration backup, row count verification |

### 6.3 Business Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Low subscription conversion | Medium | Medium | Generous free tier, boost option |
| Payment fraud | Low | Medium | Stripe Radar fraud detection |
| Churn after trial | Medium | Low | Grace periods, engagement features |

---

## 7. Implementation Approach

### 7.1 Sprint Planning

| Sprint | Focus | Deliverables |
|--------|-------|--------------|
| Sprint 16 | Billing Foundation | StripeService, webhook handler, subscriptions table |
| Sprint 17 | Gatekeeper | GatekeeperService, feature matrix, Redis cache |
| Sprint 18 | Fee Waivers & Admin | WaiverService, admin endpoints, audit logging |
| Sprint 19 | Score Badges | BadgeService, purchase flow, display integration |
| Sprint 20 | Community Boosts | BoostService, level calculations, booster perks |
| Sprint 21 | Integration & Testing | End-to-end tests, migration scripts |
| Sprint 22 | Deployment & Docs | CI/CD gates, documentation, runbooks |

### 7.2 Testing Strategy

- **Unit Tests**: All new services
- **Integration Tests**: Stripe webhook flow, feature gating
- **Migration Tests**: v3.0 → v4.0 data migration
- **Regression Tests**: All preserved v3.0 features

### 7.3 Rollback Plan

1. Database backup before migration
2. Feature flags for new functionality
3. Gradual rollout (internal → beta → production)
4. One-click rollback via git tag checkout

---

## 8. Appendix

### 8.1 Stripe Product Configuration

```
Products:
- sietch-basic ($15/mo) → price_basic
- sietch-premium ($35/mo) → price_premium
- sietch-exclusive ($149/mo) → price_exclusive
- sietch-elite ($449/mo) → price_elite
- sietch-badge ($4.99 one-time) → price_badge
- sietch-boost ($2.99/mo) → price_boost
```

### 8.2 Feature Flag Configuration

```yaml
feature_flags:
  billing_enabled: true
  boosts_enabled: true
  badges_enabled: true
  multi_tenancy_foundation: true
  regional_selection: true  # UI only, single region deployed
```

### 8.3 Environment Variables Template

```bash
# Existing (v3.0)
NODE_ENV=production
PORT=3000
API_KEY=<secure-key>
BERACHAIN_RPC_URL=https://rpc.berachain.com
DISCORD_BOT_TOKEN=<token>
DISCORD_GUILD_ID=<guild-id>
DISCORD_ANNOUNCEMENTS_CHANNEL_ID=<channel-id>
# ... (all tier role IDs)

# New (v4.0)
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_ID_BASIC=price_...
STRIPE_PRICE_ID_PREMIUM=price_...
STRIPE_PRICE_ID_EXCLUSIVE=price_...
STRIPE_PRICE_ID_ELITE=price_...
STRIPE_PRICE_ID_BADGE=price_...
STRIPE_PRICE_ID_BOOST=price_...
REDIS_URL=redis://...
```

---

*PRD v4.0 generated by Loa discovery workflow*
*Sources: ARCHITECTURE_SPEC_v2.9.0.md, BOOTSTRAP_PROMPT.md, sietch-unified reference implementation, Sietch v3.0 codebase*

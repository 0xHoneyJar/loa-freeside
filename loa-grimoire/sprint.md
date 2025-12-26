# Sprint Plan: Sietch v4.0 "The Unification"

**Version**: 1.0
**Date**: December 26, 2025
**Status**: READY
**Team**: Loa Framework + Jani

---

## Sprint Overview

| Parameter | Value |
|-----------|-------|
| Sprint Duration | 1 week |
| Total Sprints | 7 sprints |
| Team Structure | Loa agentic framework guiding implementation |
| MVP Target | Full v4.0 scope |
| Start Sprint | Sprint 23 (continuing from v3.0) |

### Success Criteria

- All P0 features (billing, gatekeeper, waivers) production-ready
- All P1 features (badges, boosts) implemented
- All P2 features (multi-tenancy foundation, CI/CD) complete
- Zero regression in v3.0 functionality
- All tests passing
- Production deployment verified

---

## Sprint Breakdown

### Sprint 23: Billing Foundation

**Goal**: Establish Stripe integration with subscription management

**Dependencies**: None (foundation sprint)

#### Tasks

##### TASK-23.1: Database Schema Migration
**Description**: Create 009_billing migration with subscriptions, fee_waivers, webhook_events, and billing_audit_log tables.

**Acceptance Criteria**:
- [ ] Migration file created at `src/db/migrations/009_billing.ts`
- [ ] All tables match SDD schema specification (Section 5.1)
- [ ] Migration runs successfully without errors
- [ ] Rollback script included
- [ ] Existing data unaffected

**Files**:
- `sietch-service/src/db/migrations/009_billing.ts`
- `sietch-service/src/db/schema.ts` (export new migration)

---

##### TASK-23.2: Stripe Configuration
**Description**: Extend config.ts with Stripe and Redis configuration schemas using Zod validation.

**Acceptance Criteria**:
- [ ] Stripe config schema added (secretKey, webhookSecret, priceIds)
- [ ] Redis config schema added (url, maxRetries, connectTimeout)
- [ ] Feature flags schema added (billingEnabled, gatekeeperEnabled)
- [ ] Environment variables documented in .env.example
- [ ] Config validation passes at startup

**Files**:
- `sietch-service/src/config.ts`
- `sietch-service/.env.example`

---

##### TASK-23.3: Type Definitions
**Description**: Create billing type definitions for SubscriptionTier, Feature, Subscription, FeeWaiver, and Entitlements.

**Acceptance Criteria**:
- [ ] All types from SDD Section 14.1 implemented
- [ ] Types exported from `src/types/billing.ts`
- [ ] No TypeScript errors
- [ ] JSDoc comments on all types

**Files**:
- `sietch-service/src/types/billing.ts`

---

##### TASK-23.4: StripeService Implementation
**Description**: Implement StripeService for Checkout sessions, Portal sessions, subscription management, and customer management.

**Acceptance Criteria**:
- [ ] `createCheckoutSession()` creates Stripe Checkout with correct price IDs
- [ ] `createPortalSession()` generates customer portal URL
- [ ] `getSubscription()` retrieves subscription details
- [ ] `cancelSubscription()` cancels at period end
- [ ] `getOrCreateCustomer()` handles customer lookup/creation
- [ ] Exponential backoff retry (max 3 attempts) for network errors
- [ ] Unit tests with mocked Stripe SDK

**Files**:
- `sietch-service/src/services/billing/StripeService.ts`
- `sietch-service/src/services/billing/__tests__/StripeService.test.ts`

---

##### TASK-23.5: Billing Routes Setup
**Description**: Create Express routes for billing endpoints (checkout, portal, subscription, webhook placeholder).

**Acceptance Criteria**:
- [ ] `POST /api/billing/checkout` route (admin auth required)
- [ ] `GET /api/billing/portal` route (admin auth required)
- [ ] `GET /api/billing/subscription` route
- [ ] `POST /api/billing/webhook` route (raw body parser)
- [ ] Routes registered in main app
- [ ] Error handling middleware applied

**Files**:
- `sietch-service/src/routes/billing.routes.ts`
- `sietch-service/src/index.ts` (register routes)

---

**Sprint 23 Testing**:
- Run `npm test` - all tests pass
- Run `npm run build` - no TypeScript errors
- Verify migration applies: `npm run migrate`
- Test Stripe CLI: `stripe trigger checkout.session.completed`

---

### Sprint 24: Webhook Processing & Redis Cache ✅ COMPLETED (2025-12-26)

**Goal**: Implement idempotent webhook handling with Redis caching

**Dependencies**: Sprint 23 complete

#### Tasks

##### TASK-24.1: RedisService Implementation ✅
**Description**: Create Redis client wrapper with connection management, graceful degradation, and entitlement cache helpers.

**Acceptance Criteria**:
- [x] Connection management (connect, disconnect, isConnected)
- [x] Basic operations (get, set, del) with error handling
- [x] Entitlement cache helpers (getEntitlements, setEntitlements, invalidateEntitlements)
- [x] Webhook deduplication helpers (isEventProcessed, markEventProcessed)
- [x] Event lock helpers (acquireEventLock, releaseEventLock)
- [x] Graceful degradation when Redis unavailable
- [x] Connection retry with exponential backoff
- [x] Unit tests with Redis mock

**Files**:
- `sietch-service/src/services/cache/RedisService.ts`
- `sietch-service/tests/unit/cache/RedisService.test.ts`

---

##### TASK-24.2: WebhookService Implementation ✅
**Description**: Implement idempotent Stripe webhook processor with signature verification and event handlers.

**Acceptance Criteria**:
- [x] `verifySignature()` validates HMAC-SHA256 signature
- [x] `processEvent()` processes events idempotently
- [x] Redis check before DB check for deduplication
- [x] Event lock acquired during processing
- [x] Events stored in webhook_events table after processing
- [x] Handler implementations for all supported events:
  - `checkout.session.completed`
  - `invoice.paid`
  - `invoice.payment_failed`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
- [x] Subscription record created/updated in database
- [x] Entitlement cache invalidated after subscription changes
- [x] Unit tests for each event type
- [x] Integration test for full webhook flow

**Files**:
- `sietch-service/src/services/billing/WebhookService.ts`
- `sietch-service/tests/unit/billing/WebhookService.test.ts`
- `sietch-service/tests/integration/webhook.integration.test.ts`

---

##### TASK-24.3: Webhook Route Integration ✅
**Description**: Connect WebhookService to the webhook route with proper raw body handling.

**Acceptance Criteria**:
- [x] Webhook route uses `express.raw()` for body parsing
- [x] Stripe-Signature header extracted and validated
- [x] Events processed through WebhookService
- [x] Returns 200 with `{ received: true }` on success
- [x] Returns 400 with error details on failure
- [x] Logging for all webhook events

**Files**:
- `sietch-service/src/api/billing.routes.ts` (updated)

---

##### TASK-24.4: Grace Period Logic ✅
**Description**: Implement 24-hour grace period on payment failure with warning notifications.

**Acceptance Criteria**:
- [x] On `invoice.payment_failed`: set `grace_until` = now + 24 hours
- [x] Grace period stored in subscriptions table
- [x] During grace period: features still accessible
- [x] Warning notification sent to admin via billing audit log
- [x] On successful payment: clear grace period
- [x] On grace period expiry: handled by GatekeeperService (Sprint 25)

**Files**:
- `sietch-service/src/services/billing/WebhookService.ts` (updated)

---

**Sprint 24 Testing**: ✅ COMPLETED
- Stripe CLI webhook testing for all event types
- Redis connection failure simulation
- Duplicate event rejection verification
- Grace period timing verification

**Review Status**: ✅ APPROVED (2025-12-26)
**Quality Gates**: All passed (66 test cases, comprehensive coverage)
**Production Ready**: Yes

---

### Sprint 25: Gatekeeper Service ✅ COMPLETED (2025-12-26)

**Goal**: Implement feature access control with tier-based entitlements

**Dependencies**: Sprint 24 complete (Redis, subscriptions)

#### Tasks

##### TASK-25.1: Feature Matrix Definition ✅
**Description**: Define the feature-to-tier mapping constant for all gated features.

**Acceptance Criteria**:
- [x] FEATURE_MATRIX constant matches PRD Section 3.2.2
- [x] All features from type definitions included
- [x] Tier hierarchy respected (enterprise > elite > exclusive > premium > basic > starter)
- [x] Exported for use in GatekeeperService

**Files**:
- `sietch-service/src/services/billing/featureMatrix.ts`

---

##### TASK-25.2: GatekeeperService Implementation ✅
**Description**: Implement central feature access control service with Redis caching and SQLite fallback.

**Acceptance Criteria**:
- [x] `checkAccess()` returns AccessResult with canAccess boolean
- [x] `getCurrentTier()` returns TierInfo with source
- [x] `getEntitlements()` returns full entitlement object
- [x] `invalidateCache()` clears Redis cache for community
- [x] Redis cache check first (5-min TTL)
- [x] SQLite fallback on Redis miss/failure
- [x] Fee waiver priority > subscription > free tier
- [x] Grace period flag included in results
- [x] Upgrade URL generated for denied features
- [x] Comprehensive unit tests

**Files**:
- `sietch-service/src/services/billing/GatekeeperService.ts`
- `sietch-service/tests/services/billing/GatekeeperService.test.ts`

---

##### TASK-25.3: Entitlement Lookup Logic ✅
**Description**: Implement the three-tier entitlement lookup (waiver → subscription → free).

**Acceptance Criteria**:
- [x] Check fee_waivers table first (active, not expired)
- [x] Check subscriptions table second (active or in grace)
- [x] Default to 'starter' tier if no subscription/waiver
- [x] Proper handling of grace period status
- [x] Results cached in Redis after lookup

**Files**:
- `sietch-service/src/services/billing/GatekeeperService.ts` (update)

---

##### TASK-25.4: Entitlement API Endpoint ✅
**Description**: Create API endpoint to query current entitlements.

**Acceptance Criteria**:
- [x] `GET /api/entitlements` returns current entitlements
- [x] `POST /api/feature-check` checks specific feature access
- [x] Returns tier, maxMembers, features array, source, gracePeriod flag
- [x] Proper authentication
- [x] Rate limited

**Files**:
- `sietch-service/src/api/billing.routes.ts` (update)

---

##### TASK-25.5: Discord Command Integration ⏭️
**Description**: Integrate GatekeeperService with existing Discord commands to enforce feature gating.

**Status**: DEFERRED to future sprint (non-blocking for core Gatekeeper functionality)

**Acceptance Criteria**:
- [ ] `/stats` command checks `stats_leaderboard` feature
- [ ] `/leaderboard` command checks `stats_leaderboard` feature
- [ ] `/admin-stats` command checks `admin_analytics` feature
- [ ] Tier-related commands check `nine_tier_system` feature
- [ ] Upgrade embed shown when feature denied
- [ ] Non-intrusive messaging (not spammy)

**Files**:
- `sietch-service/src/commands/stats.ts` (update)
- `sietch-service/src/commands/leaderboard.ts` (update)
- `sietch-service/src/commands/admin-stats.ts` (update)
- `sietch-service/src/embeds/upgradePrompt.ts` (new)

---

**Sprint 25 Testing**: ✅ COMPLETED
- Feature access tests for each tier level (23 test cases, all passing)
- Cache hit/miss verification (comprehensive Redis mock tests)
- Fallback behavior testing (Redis failure scenarios)
- Discord command gating verification (deferred with TASK-25.5)

**Review Status**: ✅ APPROVED (2025-12-26)
**Quality Gates**: All passed (23 test cases, comprehensive coverage)
**Production Ready**: Yes (core Gatekeeper functionality complete)

---

### Sprint 26: Fee Waivers & Admin Tools

**Goal**: Implement platform-granted fee waivers and admin management

**Dependencies**: Sprint 25 complete (GatekeeperService)

#### Tasks

##### TASK-26.1: WaiverService Implementation
**Description**: Create service for managing fee waivers with full CRUD operations.

**Acceptance Criteria**:
- [ ] `grantWaiver()` creates waiver with tier, reason, expiration
- [ ] `getWaiver()` retrieves active waiver for community
- [ ] `listWaivers()` returns all waivers with optional expired filter
- [ ] `revokeWaiver()` soft-deletes waiver with reason
- [ ] `hasActiveWaiver()` quick check for active waiver
- [ ] Validation: only one active waiver per community
- [ ] Audit trail for all waiver actions
- [ ] Unit tests for all methods

**Files**:
- `sietch-service/src/services/billing/WaiverService.ts`
- `sietch-service/src/services/billing/__tests__/WaiverService.test.ts`

---

##### TASK-26.2: Waiver Admin Routes
**Description**: Create admin-only endpoints for waiver management.

**Acceptance Criteria**:
- [ ] `POST /admin/waivers` grants waiver (API key auth)
- [ ] `GET /admin/waivers` lists all waivers
- [ ] `DELETE /admin/waivers/:communityId` revokes waiver
- [ ] Request validation with Zod
- [ ] Proper error responses (400, 401, 404, 409)
- [ ] Audit logging for all actions

**Files**:
- `sietch-service/src/routes/admin.routes.ts` (update)

---

##### TASK-26.3: Billing Audit Log
**Description**: Implement billing-specific audit logging for subscription and waiver events.

**Acceptance Criteria**:
- [ ] All subscription changes logged
- [ ] All waiver actions logged
- [ ] Payment events logged
- [ ] Feature denial events logged
- [ ] Query endpoint for audit log (admin)
- [ ] Log retention policy (30 days default)

**Files**:
- `sietch-service/src/services/billing/BillingAuditService.ts`
- `sietch-service/src/routes/admin.routes.ts` (audit query endpoint)

---

##### TASK-26.4: Admin Dashboard Enhancements
**Description**: Add billing information to existing admin stats/analytics.

**Acceptance Criteria**:
- [ ] Subscription status visible in admin view
- [ ] Current tier displayed
- [ ] Grace period warning if applicable
- [ ] Waiver status shown (if active)
- [ ] Feature usage stats (optional)

**Files**:
- `sietch-service/src/commands/admin-stats.ts` (update)

---

**Sprint 26 Testing**:
- Waiver grant/revoke flow
- Audit log verification
- Admin endpoint authorization
- Waiver priority over subscription

---

### Sprint 27: Score Badges

**Goal**: Implement optional score badge display feature

**Dependencies**: Sprint 25 complete (GatekeeperService for entitlement)

#### Tasks

##### TASK-27.1: Badge Database Schema
**Description**: Add badge_purchases and badge_settings tables via migration.

**Acceptance Criteria**:
- [ ] Migration file created: `010_badges.ts`
- [ ] badge_purchases table with member_id, stripe_payment_id, purchased_at
- [ ] badge_settings table with display preferences
- [ ] Indexes on member_id
- [ ] Migration runs successfully

**Files**:
- `sietch-service/src/db/migrations/010_badges.ts`

---

##### TASK-27.2: BadgeService Implementation
**Description**: Create service for badge entitlement checking, purchase flow, and display.

**Acceptance Criteria**:
- [ ] `checkBadgeEntitlement()` - Premium+ gets free, others need purchase
- [ ] `purchaseBadge()` - Creates Stripe payment for $4.99
- [ ] `getBadgeDisplay()` - Returns formatted badge string
- [ ] `updateBadgeSettings()` - Saves display preferences
- [ ] Badge styles: default, minimal, detailed
- [ ] Integration with conviction score from v3.0

**Files**:
- `sietch-service/src/services/badge/BadgeService.ts`
- `sietch-service/src/services/badge/__tests__/BadgeService.test.ts`

---

##### TASK-27.3: Badge API Routes
**Description**: Create REST endpoints for badge management.

**Acceptance Criteria**:
- [ ] `GET /api/badge/entitlement` - Check badge access
- [ ] `POST /api/badge/purchase` - Initiate purchase (lower tiers)
- [ ] `GET /api/badge/display/:platform/:platformId` - Get badge for display
- [ ] `PUT /api/badge/settings` - Update badge settings
- [ ] Proper authentication and validation

**Files**:
- `sietch-service/src/routes/badge.routes.ts`

---

##### TASK-27.4: Discord Badge Integration
**Description**: Integrate badge display with Discord messages (optional enhancement).

**Acceptance Criteria**:
- [ ] Badge displayed in member profile embed
- [ ] `/badge` slash command to manage settings
- [ ] Badge visible in leaderboard (if enabled)
- [ ] Respects display_on_discord setting

**Files**:
- `sietch-service/src/commands/badge.ts` (new)
- `sietch-service/src/embeds/memberProfile.ts` (update)

---

**Sprint 27 Testing**:
- Badge entitlement logic (free for Premium+)
- Purchase flow with Stripe
- Badge display formats
- Settings persistence

---

### Sprint 28: Community Boosts

**Goal**: Implement collective funding through community boosts

**Dependencies**: Sprint 25 complete (GatekeeperService)

#### Tasks

##### TASK-28.1: Boost Database Schema
**Description**: Add boosts table via migration.

**Acceptance Criteria**:
- [ ] Migration file created: `011_boosts.ts`
- [ ] boosts table with community_id, member_id, boost_count, stripe_subscription_id
- [ ] Indexes on community_id and member_id
- [ ] Migration runs successfully

**Files**:
- `sietch-service/src/db/migrations/011_boosts.ts`

---

##### TASK-28.2: BoostService Implementation
**Description**: Create service for boost purchasing, level calculation, and perks.

**Acceptance Criteria**:
- [ ] `purchaseBoost()` - Creates Stripe subscription for $2.99/boost
- [ ] `calculateBoostLevel()` - Returns tier based on total boosts (2=Basic, 7=Premium, 14=Exclusive, 30=Elite)
- [ ] `getBoostStatus()` - Returns community boost summary
- [ ] `listBoosters()` - Returns list of boosters with counts
- [ ] Sustain period logic (7-day grace when boost level drops)
- [ ] Integration with GatekeeperService (boost tier consideration)

**Files**:
- `sietch-service/src/services/boost/BoostService.ts`
- `sietch-service/src/services/boost/__tests__/BoostService.test.ts`

---

##### TASK-28.3: Boost API Routes
**Description**: Create REST endpoints for boost management.

**Acceptance Criteria**:
- [ ] `GET /api/boost/levels` - Get boost level definitions
- [ ] `GET /api/boost/status/:communityId` - Community boost status
- [ ] `POST /api/boost/purchase` - Purchase boosts
- [ ] `GET /api/boost/boosters/:communityId` - List boosters

**Files**:
- `sietch-service/src/routes/boost.routes.ts`

---

##### TASK-28.4: GatekeeperService Boost Integration
**Description**: Update GatekeeperService to consider boost level in tier calculation.

**Acceptance Criteria**:
- [ ] Effective tier = max(subscription tier, boost level)
- [ ] Boost source indicated in entitlement response
- [ ] Cache invalidation on boost changes
- [ ] Sustain period respected in calculations

**Files**:
- `sietch-service/src/services/billing/GatekeeperService.ts` (update)

---

##### TASK-28.5: Booster Recognition
**Description**: Implement booster perks (badge, priority, recognition).

**Acceptance Criteria**:
- [ ] "Booster" badge available for display
- [ ] Priority in member directory (optional)
- [ ] Recognition in weekly digest
- [ ] Booster role in Discord (if configured)

**Files**:
- `sietch-service/src/services/boost/BoosterPerksService.ts`
- `sietch-service/src/services/DigestService.ts` (update)

---

**Sprint 28 Testing**:
- Boost purchase flow
- Level calculation accuracy
- Sustain period behavior
- Tier effective calculation (max of sub/boost)

---

### Sprint 29: Integration, Testing & Deployment

**Goal**: End-to-end testing, migration scripts, deployment preparation

**Dependencies**: Sprints 23-28 complete

#### Tasks

##### TASK-29.1: End-to-End Test Suite
**Description**: Create comprehensive integration tests for the complete billing flow.

**Acceptance Criteria**:
- [ ] Full checkout → webhook → feature access flow tested
- [ ] Subscription upgrade/downgrade flow tested
- [ ] Payment failure → grace period → recovery flow tested
- [ ] Waiver grant → feature access flow tested
- [ ] Boost purchase → tier upgrade flow tested
- [ ] All tests pass in CI

**Files**:
- `sietch-service/src/__tests__/billing.e2e.test.ts`

---

##### TASK-29.2: v3.0 Regression Tests
**Description**: Verify all existing v3.0 features still work correctly.

**Acceptance Criteria**:
- [ ] 9-tier system functioning
- [ ] Stats and leaderboard working
- [ ] Weekly digest generation working
- [ ] Naib dynamics working
- [ ] Position alerts working
- [ ] All existing tests passing

**Files**:
- `sietch-service/src/__tests__/regression.test.ts`

---

##### TASK-29.3: Migration Script
**Description**: Create migration script for existing single-tenant data.

**Acceptance Criteria**:
- [ ] Create 'default' community record
- [ ] Assign existing members to default community
- [ ] Set default subscription to 'enterprise' (internal waiver)
- [ ] Verify data integrity post-migration
- [ ] Rollback script available

**Files**:
- `sietch-service/scripts/migrate-v3-to-v4.ts`

---

##### TASK-29.4: Deployment Guide Update
**Description**: Update deployment documentation for v4.0.

**Acceptance Criteria**:
- [ ] Stripe setup instructions
- [ ] Redis/Upstash setup instructions
- [ ] Environment variables documented
- [ ] Migration procedure documented
- [ ] Rollback procedure documented
- [ ] Webhook configuration instructions

**Files**:
- `loa-grimoire/deployment/deployment-guide.md` (update)

---

##### TASK-29.5: CI/CD Gates
**Description**: Add deployment quality gates to CI pipeline.

**Acceptance Criteria**:
- [ ] Type checking required
- [ ] Lint passing required
- [ ] All tests passing required
- [ ] Build successful required
- [ ] (Optional) Secret scanning with TruffleHog

**Files**:
- `.github/workflows/ci.yml` (update or create)

---

##### TASK-29.6: Production Deployment
**Description**: Deploy v4.0 to production.

**Acceptance Criteria**:
- [ ] Backup existing database
- [ ] Apply migrations
- [ ] Configure Stripe products in production
- [ ] Configure webhook endpoint in Stripe dashboard
- [ ] Set up Upstash Redis
- [ ] Deploy updated code
- [ ] Verify health endpoint
- [ ] Test webhook with Stripe CLI
- [ ] Verify feature gating works
- [ ] Grant internal waiver for existing community

**Files**:
- Production deployment (external)

---

**Sprint 29 Testing**:
- Full regression suite
- Production smoke tests
- Webhook delivery verification
- Entitlement caching verification

---

## Risk Mitigation

| Risk | Mitigation | Sprint |
|------|------------|--------|
| Stripe integration issues | Thorough Stripe CLI testing | 23-24 |
| Redis connection failures | Graceful degradation implemented | 24 |
| Webhook delivery failures | Idempotent handlers, manual reconcile | 24 |
| Feature gate bypass | Server-side only enforcement | 25 |
| Data migration issues | Backup + rollback scripts | 29 |
| Regression in v3.0 features | Comprehensive regression tests | 29 |

---

## Dependencies Graph

```
Sprint 23 (Foundation)
    │
    ▼
Sprint 24 (Webhooks + Redis)
    │
    ├────────────────────┬────────────────────┐
    ▼                    ▼                    ▼
Sprint 25            Sprint 27            Sprint 28
(Gatekeeper)         (Badges)             (Boosts)
    │                    │                    │
    ▼                    │                    │
Sprint 26                │                    │
(Waivers)                │                    │
    │                    │                    │
    └────────────────────┴────────────────────┘
                         │
                         ▼
                    Sprint 29
               (Integration & Deploy)
```

---

## MVP Definition

**Minimum Viable Product (Sprint 23-26)**:
- Stripe subscription management
- Webhook processing with idempotency
- Redis-cached entitlements
- Feature gating (GatekeeperService)
- Fee waiver system
- Admin tools

**Full v4.0 (Sprint 23-29)**:
- All MVP features
- Score badges
- Community boosts
- Full test coverage
- Production deployment

---

## Post-Sprint Activities

After Sprint 29:
1. Monitor webhook delivery rates
2. Track subscription conversion
3. Gather user feedback
4. Plan v4.1 (multi-tenancy, Telegram)

---

*Sprint Plan v1.0 generated by Loa planning workflow*
*Based on: PRD v4.0, SDD v4.0*

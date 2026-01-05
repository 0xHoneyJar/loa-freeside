# Sprint Plan: Stripe to Paddle Payment Migration

**Version**: 1.0
**Date**: January 4, 2026
**Status**: READY FOR IMPLEMENTATION
**Branch**: `feature/replace-stripe-with-paddle`
**Parent Documents**:
- PRD: `loa-grimoire/prd-paddle-migration.md`
- SDD: `loa-grimoire/sdd-paddle-migration.md`

---

## Sprint Overview

### Project Summary

Complete migration from Stripe to Paddle as the payment provider for Arrakis SaaS. THJ's BVI entity status requires Paddle's Merchant of Record model.

### Sprint Configuration

| Parameter | Value |
|-----------|-------|
| **Total Sprints** | 2 |
| **Sprint Duration** | 1 sprint = 1 implementation session |
| **Team Size** | 1 (AI agent) |
| **Parallel Execution** | Within-sprint parallelization where possible |

### Success Metrics

| Metric | Target |
|--------|--------|
| All subscription tiers purchasable | 6/6 tiers |
| One-time payments functional | Badge + 4 Boost bundles |
| Webhook idempotency | 100% (no duplicate processing) |
| Existing billing tests passing | 100% (adapted) |
| Stripe code removed | 100% |

---

## Sprint 1: Core Infrastructure

**Goal**: Establish hexagonal billing architecture with Paddle adapter and database migration

### Task 1.1: Create IBillingProvider Interface

**Description**: Define the provider-agnostic billing port interface following the established `IChainProvider` pattern.

**File**: `sietch-service/src/packages/core/ports/IBillingProvider.ts`

**Acceptance Criteria**:
- [ ] Interface defines all 15 methods from SDD Section 3.1
- [ ] Type definitions for `CreateCheckoutParams`, `CheckoutResult`, `ProviderSubscription`, etc.
- [ ] `NormalizedEventType` union type for provider-agnostic events
- [ ] `BillingProvider` type supporting 'paddle' | 'stripe'
- [ ] `PaddleConfig` configuration type
- [ ] JSDoc comments on all public types and methods
- [ ] Exports added to `packages/core/ports/index.ts`

**Estimated Effort**: Small

**Dependencies**: None

**Testing**: Type compilation only (interface has no runtime behavior)

---

### Task 1.2: Implement PaddleBillingAdapter

**Description**: Create the Paddle implementation of `IBillingProvider` using `@paddle/paddle-node-sdk`.

**File**: `sietch-service/src/packages/adapters/billing/PaddleBillingAdapter.ts`

**Acceptance Criteria**:
- [ ] Class implements `IBillingProvider` interface
- [ ] Lazy Paddle SDK initialization in `getClient()`
- [ ] Customer management: `getOrCreateCustomer()`, `getCustomer()`
- [ ] Checkout sessions: `createCheckoutSession()`, `createOneTimeCheckoutSession()`
- [ ] Portal session: `createPortalSession()`
- [ ] Subscription management: `getSubscription()`, `cancelSubscription()`, `resumeSubscription()`, `updateSubscriptionTier()`
- [ ] Webhook verification: `verifyWebhook()` using HMAC-SHA256
- [ ] Status mapping: `mapSubscriptionStatus()` per SDD Section 3.2
- [ ] Health check: `isHealthy()`
- [ ] Exponential backoff retry with `withRetry()` helper (MAX_RETRIES=3)
- [ ] Network error detection in `isNetworkError()`
- [ ] Event normalization in `normalizeEvent()` and `normalizeEventType()`
- [ ] Tier extraction in `extractTierFromSubscription()`
- [ ] Structured logging with pino logger

**Estimated Effort**: Medium

**Dependencies**: Task 1.1

**Testing**:
- [ ] Unit tests for `mapSubscriptionStatus()` (all status mappings)
- [ ] Unit tests for `normalizeEventType()` (all event mappings)
- [ ] Unit tests for `extractTierFromSubscription()` (metadata vs price lookup)
- [ ] Unit tests for retry logic (mock network errors)
- [ ] Mock Paddle SDK for isolation

---

### Task 1.3: Create Adapter Index and Exports

**Description**: Create index file for billing adapters package.

**File**: `sietch-service/src/packages/adapters/billing/index.ts`

**Acceptance Criteria**:
- [ ] Re-exports `PaddleBillingAdapter` class
- [ ] Re-exports all types from `IBillingProvider`
- [ ] Factory function `createBillingProvider(config)` that returns adapter instance

**Estimated Effort**: Small

**Dependencies**: Task 1.2

**Testing**: Import verification

---

### Task 1.4: Database Schema Migration

**Description**: Create SQL migration to rename Stripe-specific columns to provider-agnostic names.

**File**: `sietch-service/src/db/migrations/003_paddle_migration.sql`

**Acceptance Criteria**:
- [ ] Rename `stripe_customer_id` → `payment_customer_id` in subscriptions
- [ ] Rename `stripe_subscription_id` → `payment_subscription_id` in subscriptions
- [ ] Add `payment_provider` column (TEXT, DEFAULT 'paddle')
- [ ] Rename `stripe_event_id` → `provider_event_id` in webhook_events
- [ ] Rename `stripe_payment_id` → `payment_id` in badge_purchases
- [ ] Rename `stripe_payment_id` → `payment_id` in boost_purchases
- [ ] Drop old indexes (if exist)
- [ ] Create new indexes on renamed columns
- [ ] Insert migration record into schema_migrations table

**Estimated Effort**: Small

**Dependencies**: None (can run in parallel with Tasks 1.1-1.3)

**Testing**:
- [ ] Migration applies cleanly on fresh database
- [ ] Migration is idempotent (can run twice without error)
- [ ] Verify indexes exist after migration

---

### Task 1.5: Update Billing Queries

**Description**: Update `billing-queries.ts` to use new column names and add provider field.

**File**: `sietch-service/src/db/billing-queries.ts`

**Acceptance Criteria**:
- [ ] Update `SubscriptionRow` interface with new column names
- [ ] Update `WebhookEventRow` interface with `provider_event_id`
- [ ] Update `rowToSubscription()` mapper to use new field names
- [ ] Update `rowToWebhookEvent()` mapper
- [ ] Add `paymentProvider` to `CreateSubscriptionParams`
- [ ] Update `createSubscription()` to include payment_provider
- [ ] Update `updateSubscription()` for new field names
- [ ] Add `getSubscriptionByPaymentId()` function
- [ ] Update all SQL queries with new column names
- [ ] Verify all existing query functions work with renamed columns

**Estimated Effort**: Medium

**Dependencies**: Task 1.4

**Testing**:
- [ ] Existing billing query tests pass (updated for new names)
- [ ] New `getSubscriptionByPaymentId()` test
- [ ] CRUD operations verify correct column names

---

### Task 1.6: Update Billing Types

**Description**: Update type definitions to be provider-agnostic.

**File**: `sietch-service/src/types/billing.ts`

**Acceptance Criteria**:
- [ ] Import `BillingProvider` type from ports
- [ ] Update `Subscription` interface:
  - Rename `stripeCustomerId` → `paymentCustomerId`
  - Rename `stripeSubscriptionId` → `paymentSubscriptionId`
  - Add `paymentProvider: BillingProvider`
- [ ] Update `CreateSubscriptionParams` interface
- [ ] Update `UpdateSubscriptionParams` interface
- [ ] Update `WebhookEvent` interface:
  - Rename `stripeEventId` → `providerEventId`
- [ ] Update `BadgePurchase` interface:
  - Rename `stripePaymentId` → `paymentId`
- [ ] Update `BoostPurchase` interface:
  - Rename `stripePaymentId` → `paymentId`
- [ ] Keep `StripeEventType` for backward compatibility (deprecated)
- [ ] Add `PaddleEventType` union type

**Estimated Effort**: Small

**Dependencies**: Task 1.1 (for BillingProvider type)

**Testing**: Type compilation

---

### Task 1.7: Update Configuration

**Description**: Add Paddle configuration and remove Stripe config.

**File**: `sietch-service/src/config.ts`

**Acceptance Criteria**:
- [ ] Add `paddle` configuration object with:
  - `apiKey` from `PADDLE_API_KEY`
  - `webhookSecret` from `PADDLE_WEBHOOK_SECRET`
  - `environment` from `PADDLE_ENVIRONMENT` ('sandbox' | 'production')
  - `clientToken` from `PADDLE_CLIENT_TOKEN`
  - `priceIds` Map for all 6 tiers
  - `oneTimePriceIds` object for badge and boost products
- [ ] Add `getPaddlePriceId(tier)` helper function
- [ ] Remove `stripe` configuration object
- [ ] Remove `getStripePriceId()` function
- [ ] Update config validation for required Paddle env vars

**Estimated Effort**: Small

**Dependencies**: None

**Testing**:
- [ ] Config loads with valid env vars
- [ ] Config validation fails with missing required vars
- [ ] `getPaddlePriceId()` returns correct IDs

---

### Task 1.8: Install Paddle SDK

**Description**: Add Paddle SDK dependency and remove Stripe.

**File**: `sietch-service/package.json`

**Acceptance Criteria**:
- [ ] Add `@paddle/paddle-node-sdk` (latest version)
- [ ] Remove `stripe` package
- [ ] Run `npm install` successfully
- [ ] No peer dependency warnings

**Estimated Effort**: Small

**Dependencies**: None

**Testing**: `npm install` completes without errors

---

### Sprint 1 Completion Criteria

- [ ] All 8 tasks complete with passing tests
- [ ] `IBillingProvider` interface fully defined
- [ ] `PaddleBillingAdapter` implements interface
- [ ] Database migration applies cleanly
- [ ] All billing types updated to provider-agnostic naming
- [ ] Paddle SDK installed, Stripe removed
- [ ] No TypeScript compilation errors

---

## Sprint 2: Webhook Processing and Integration

**Goal**: Complete webhook handling, API integration, and cleanup

### Task 2.1: Update WebhookService for Paddle

**Description**: Refactor WebhookService to use provider-agnostic events via IBillingProvider.

**File**: `sietch-service/src/services/billing/WebhookService.ts`

**Acceptance Criteria**:
- [ ] Constructor accepts `IBillingProvider` dependency
- [ ] `verifySignature()` delegates to provider's `verifyWebhook()`
- [ ] `processEvent()` accepts `ProviderWebhookEvent` instead of Stripe event
- [ ] Update `SUPPORTED_EVENTS` to use `NormalizedEventType[]`
- [ ] Implement handlers for normalized events:
  - `handleSubscriptionCreated()`
  - `handleSubscriptionActivated()`
  - `handleSubscriptionUpdated()`
  - `handleSubscriptionCanceled()`
  - `handlePaymentCompleted()` (routes to boost/badge handlers)
  - `handlePaymentFailed()`
- [ ] Update `handleBoostPaymentCompleted()` for Paddle event structure
- [ ] Update `handleBadgePaymentCompleted()` for Paddle event structure
- [ ] Remove all Stripe-specific imports and types
- [ ] Update audit log entries to include `provider: 'paddle'`
- [ ] Grace period logic (24 hours) preserved

**Estimated Effort**: Medium-Large

**Dependencies**: Sprint 1 complete

**Testing**:
- [ ] Unit test each event handler with mock events
- [ ] Test idempotency (duplicate event rejection)
- [ ] Test grace period activation on payment failure
- [ ] Test subscription lifecycle (create → activate → update → cancel)
- [ ] Test one-time payment routing (boost, badge)

---

### Task 2.2: Update Webhook API Route

**Description**: Update billing routes to handle Paddle webhook signature header.

**File**: `sietch-service/src/api/billing.routes.ts`

**Acceptance Criteria**:
- [ ] Change signature header from `stripe-signature` to `paddle-signature`
- [ ] Initialize `WebhookService` with `PaddleBillingAdapter` instance
- [ ] Update error responses to be provider-agnostic
- [ ] Add request logging with correlation ID
- [ ] Ensure raw body parsing for signature verification

**Estimated Effort**: Small

**Dependencies**: Task 2.1

**Testing**:
- [ ] Integration test: valid signature accepted
- [ ] Integration test: invalid signature rejected (400)
- [ ] Integration test: missing signature rejected (400)

---

### Task 2.3: Update Checkout API Routes

**Description**: Update checkout and portal routes to use PaddleBillingAdapter.

**File**: `sietch-service/src/api/billing.routes.ts`

**Acceptance Criteria**:
- [ ] Inject `IBillingProvider` into route handlers
- [ ] Update `POST /checkout` to use `createCheckoutSession()`
- [ ] Update `POST /checkout/one-time` to use `createOneTimeCheckoutSession()`
- [ ] Update `POST /portal` to use `createPortalSession()`
- [ ] Include `clientToken` in checkout response for Paddle.js
- [ ] Remove any Stripe-specific response fields

**Estimated Effort**: Small

**Dependencies**: Sprint 1 complete

**Testing**:
- [ ] Checkout session creation returns valid URL
- [ ] One-time checkout for badge returns valid URL
- [ ] One-time checkout for boost returns valid URL
- [ ] Portal session returns valid URL

---

### Task 2.4: Update BoostService

**Description**: Update BoostService to use provider-agnostic payment fields.

**File**: `sietch-service/src/services/boost/BoostService.ts`

**Acceptance Criteria**:
- [ ] Rename `stripeSessionId` → `paymentSessionId` in `processBoostPayment()`
- [ ] Rename `stripePaymentId` → `paymentId` in params
- [ ] Update boost purchase creation with new field names
- [ ] Update any Stripe-specific checkout URL generation

**Estimated Effort**: Small

**Dependencies**: Task 1.6

**Testing**:
- [ ] Existing boost tests pass with renamed fields
- [ ] Boost purchase records correct payment ID

---

### Task 2.5: Update BadgeService

**Description**: Update BadgeService to use provider-agnostic payment fields.

**File**: `sietch-service/src/services/badge/BadgeService.ts`

**Acceptance Criteria**:
- [ ] Rename `stripePaymentId` → `paymentId` in `recordBadgePurchase()`
- [ ] Update badge purchase creation with new field name
- [ ] Update any Stripe-specific checkout URL generation

**Estimated Effort**: Small

**Dependencies**: Task 1.6

**Testing**:
- [ ] Existing badge tests pass with renamed fields
- [ ] Badge purchase records correct payment ID

---

### Task 2.6: Remove StripeService

**Description**: Delete the Stripe service file and remove all imports.

**File**: `sietch-service/src/services/billing/StripeService.ts` (DELETE)

**Acceptance Criteria**:
- [ ] Delete `StripeService.ts` file
- [ ] Remove all imports of `stripeService` throughout codebase
- [ ] Update billing service index to export new adapter
- [ ] Verify no remaining references to Stripe SDK
- [ ] Run grep for "stripe" to find any missed references

**Estimated Effort**: Small

**Dependencies**: Tasks 2.1-2.5 complete

**Testing**:
- [ ] TypeScript compilation succeeds
- [ ] No runtime imports of stripe package
- [ ] `grep -r "stripe" src/` returns only false positives (comments, etc.)

---

### Task 2.7: Update Environment Example

**Description**: Update `.env.example` with Paddle configuration.

**File**: `.env.example`

**Acceptance Criteria**:
- [ ] Remove all `STRIPE_*` environment variables
- [ ] Add all `PADDLE_*` environment variables:
  - `PADDLE_API_KEY`
  - `PADDLE_WEBHOOK_SECRET`
  - `PADDLE_ENVIRONMENT`
  - `PADDLE_CLIENT_TOKEN`
  - `PADDLE_PRICE_STARTER` through `PADDLE_PRICE_ELITE`
  - `PADDLE_PRICE_BADGE`
  - `PADDLE_PRICE_BOOST_1_MONTH` through `PADDLE_PRICE_BOOST_12_MONTH`
- [ ] Add comments explaining each variable
- [ ] Document sandbox vs production environment

**Estimated Effort**: Small

**Dependencies**: None

**Testing**: Documentation review

---

### Task 2.8: Integration Testing

**Description**: Run full test suite and fix any remaining issues.

**Acceptance Criteria**:
- [ ] All unit tests pass
- [ ] All integration tests pass (with mocked Paddle SDK)
- [ ] TypeScript compilation clean (no errors or warnings)
- [ ] ESLint passes with no errors
- [ ] Manual verification of checkout flow with Paddle sandbox
- [ ] Webhook signature verification works with test payloads

**Estimated Effort**: Medium

**Dependencies**: Tasks 2.1-2.7 complete

**Testing**:
- [ ] `npm run test:run` passes
- [ ] `npm run build` succeeds
- [ ] `npm run lint` passes

---

### Sprint 2 Completion Criteria

- [ ] All 8 tasks complete with passing tests
- [ ] WebhookService processes Paddle events correctly
- [ ] API routes use Paddle adapter
- [ ] StripeService.ts deleted
- [ ] No Stripe references in source code
- [ ] All tests pass
- [ ] Build succeeds

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Paddle SDK API changes | Low | Medium | Pin SDK version, check changelog |
| Webhook signature verification fails | Medium | High | Test with Paddle sandbox events |
| Database migration issues | Low | High | Test migration on copy first |
| Missing edge cases in event handling | Medium | Medium | Comprehensive test coverage |

---

## Rollback Plan

If critical issues arise after deployment:

1. **Immediate**: Revert to previous commit containing Stripe code
2. **Database**: Run reverse migration script (restore `stripe_*` columns)
3. **Config**: Restore `STRIPE_*` environment variables
4. **Note**: Rollback would require resolving BVI entity issue with Stripe

---

## Definition of Done

The migration is complete when:

1. **Functional**
   - [ ] All 6 subscription tiers purchasable via Paddle
   - [ ] Badge one-time purchase works
   - [ ] All 4 Boost bundles purchasable
   - [ ] Customer portal accessible
   - [ ] Subscription upgrades/downgrades work
   - [ ] Cancellation works

2. **Technical**
   - [ ] 100% of billing tests pass
   - [ ] No TypeScript errors
   - [ ] No ESLint errors
   - [ ] Zero Stripe code remaining

3. **Operational**
   - [ ] Webhook signature verification confirmed
   - [ ] Idempotent event processing verified
   - [ ] Grace period handling tested
   - [ ] Audit logging functional

---

## Next Steps

After sprint plan approval:

```
/implement sprint-1
```

Then after Sprint 1 review:

```
/implement sprint-2
```

---

**Document Status**: READY FOR IMPLEMENTATION

**Approval**: Pending user review

# Product Requirements Document: Stripe to Paddle Payment Migration

**Version**: 1.0
**Date**: January 4, 2026
**Status**: READY FOR ARCHITECTURE
**Branch**: `feature/replace-stripe-with-paddle`
**Parent PRD**: `loa-grimoire/prd.md` (Arrakis v5.2)

---

## Document Traceability

| Section | Source |
|---------|--------|
| Business Context | User Interview (Jan 4, 2026) |
| Technical Context | Existing Stripe Implementation (`sietch-service/src/services/billing/`) |
| Paddle Capabilities | [Paddle Developer Docs](https://developer.paddle.com/) |
| Pricing Strategy | User decision: Keep current prices |

---

## 1. Executive Summary

### 1.1 Problem Statement

**THJ cannot use Stripe** because:
- THJ is registered in BVI (British Virgin Islands)
- Stripe does not support BVI entities
- Arrakis SaaS cannot launch without functional payment processing
- Existing Stripe integration (~3,000 lines, 7 service files) is complete but unusable

**Solution**: Complete migration from Stripe to [Paddle](https://paddle.com)

### 1.2 Why Paddle

| Criteria | Paddle | Stripe |
|----------|--------|--------|
| BVI Entity Support | Yes (as MoR) | No |
| Merchant of Record | Yes - Paddle is the seller | No - You are the seller |
| Tax Compliance | Paddle handles globally | Self-managed via Stripe Tax |
| Subscriptions | Full support | Full support |
| One-time payments | Full support | Full support |
| Customer Portal | Built-in | Built-in |
| Node.js SDK | `@paddle/paddle-node-sdk` | `stripe` |

**Key Benefit**: As a Merchant of Record (MoR), Paddle legally becomes the seller to customers. This means:
- Paddle handles all tax collection, filing, and remittance globally
- THJ (as a BVI entity) receives net payouts without tax compliance burden
- Paddle is registered in 100+ tax jurisdictions worldwide

### 1.3 Scope

| In Scope | Out of Scope |
|----------|--------------|
| Replace Stripe with Paddle | Stripe fallback/hybrid mode |
| Subscription billing | Price adjustments (keep current) |
| One-time payments (badges, boosts) | Subscription pause feature |
| Webhook processing | Multi-currency support |
| Feature entitlements | Existing subscriber migration (none exist) |
| Customer portal | |

---

## 2. Business Requirements

### 2.1 Payment Model

| Requirement | Specification |
|-------------|---------------|
| **Currency** | USD |
| **Payment Methods** | Credit/Debit cards via Paddle Checkout |
| **Subscription Billing** | Automatic recurring via Paddle |
| **One-time Payments** | Badges ($4.99), Boosts ($4.99-$39.99) |
| **Transaction Fee** | 5% + $0.50 (absorbed by THJ) |

### 2.2 Pricing Tiers (Preserved from Parent PRD)

| Tier | USD Price | Max Members | Features |
|------|-----------|-------------|----------|
| Starter | $0/mo | 100 | Basic Discord bot, onboarding |
| Basic | $29/mo | 500 | + Stats, alerts, custom nym |
| Premium | $99/mo | 1,000 | + 9-tier system, digest, activity |
| Exclusive | $199/mo | 2,500 | + Admin analytics, naib dynamics |
| Elite | $449/mo | 10,000 | + Custom branding, priority support |
| Enterprise | Custom | Unlimited | + White label, dedicated support |

**Note**: Prices unchanged despite Paddle's higher fees (5% vs Stripe's 2.9%)

### 2.3 One-Time Purchase Products

| Product | Price | Description |
|---------|-------|-------------|
| Score Badge | $4.99 | Permanent badge for member profile |
| Community Boost (1 mo) | $4.99 | Temporary community visibility boost |
| Community Boost (3 mo) | $12.99 | 13% discount |
| Community Boost (6 mo) | $22.99 | 23% discount |
| Community Boost (12 mo) | $39.99 | 33% discount |

### 2.4 Settlement

- Paddle collects payments as Merchant of Record
- THJ receives net payouts (after Paddle fees and taxes)
- Payout currency: USD
- Payout schedule: Configurable in Paddle dashboard

---

## 3. Functional Requirements

### FR-1: Core Payment Infrastructure

#### FR-1.1: Paddle Service
- Implement `PaddleService` to replace `StripeService`
- Use official `@paddle/paddle-node-sdk` package
- Maintain interface compatibility for minimal domain changes
- Exponential backoff retry for network errors

#### FR-1.2: Checkout Session
- Create checkout sessions for subscriptions via Paddle.js
- Create checkout sessions for one-time payments (badges, boosts)
- Attach metadata: `community_id`, `tier`, `payment_type`
- Return Paddle checkout URL or embed configuration

#### FR-1.3: Webhook Processing
- Verify Paddle webhook signatures (HMAC-SHA256)
- Idempotent event handling (prevent duplicate processing)
- Event types to handle:
  - `subscription.created` → Create subscription record
  - `subscription.activated` → Activate subscription
  - `subscription.updated` → Update subscription details
  - `subscription.canceled` → Downgrade to starter
  - `transaction.completed` → Record payment, handle one-time purchases
  - `transaction.payment_failed` → Start grace period
- Invalidate entitlement cache on status change

#### FR-1.4: Customer Management
- Get or create Paddle customer for community
- Store `paddle_customer_id` in subscriptions table
- Map Paddle customer to community via metadata

### FR-2: Subscription Lifecycle

#### FR-2.1: Status Mapping

| Paddle Status | Internal Status |
|---------------|-----------------|
| `active` | `active` |
| `past_due` | `past_due` |
| `canceled` | `canceled` |
| `trialing` | `trialing` |

**Note**: Paddle `paused` status will NOT be used (per user decision)

#### FR-2.2: Grace Period
- 24-hour grace period on payment failure
- Features remain accessible during grace period
- Auto-downgrade to `starter` after grace expires

#### FR-2.3: Tier Changes
- Support mid-cycle upgrades/downgrades
- Use Paddle's `proration_billing_mode` for proration
- Immediate tier change on upgrade

### FR-3: One-Time Payments

#### FR-3.1: Badge Purchases
- Fixed price: $4.99
- Grant badge access on `transaction.completed` webhook
- Metadata: `member_id`, `community_id`, `type: badge_purchase`

#### FR-3.2: Community Boosts
- Bundle pricing (see §2.3)
- Metadata: `member_id`, `community_id`, `months`, `type: boost_purchase`

### FR-4: Customer Portal

- Use Paddle's built-in customer portal
- Create portal sessions for subscription management
- Allow: view subscription, update payment method, cancel
- Return Paddle portal URL for redirect

---

## 4. Non-Functional Requirements

### NFR-1: Security

| Requirement | Specification |
|-------------|---------------|
| Webhook verification | HMAC-SHA256 signature validation |
| API key storage | Environment variable (never committed) |
| Webhook secret | Separate secret per environment |
| Audit logging | All payments logged with transaction details |
| Tenant isolation | RLS context per operation |

### NFR-2: Reliability

| Requirement | Target |
|-------------|--------|
| Payment success rate | >95% |
| Webhook processing time | <5 seconds (Paddle timeout) |
| Idempotency | 100% (no duplicate charges) |

### NFR-3: Observability

- Structured logging with correlation IDs
- Metrics: payment success/failure rates, checkout abandonment
- Alerts: >5% failure rate triggers notification

---

## 5. Technical Constraints

### 5.1 Architecture Approach

**In-place replacement** using hexagonal architecture principles:
- Create `IBillingProvider` interface (port)
- Implement `PaddleBillingAdapter` (adapter)
- Update `WebhookService` for Paddle events
- Minimal changes to domain services (`GatekeeperService`, etc.)

### 5.2 Database Changes

| Change | Type | Description |
|--------|------|-------------|
| `stripe_customer_id` → `payment_customer_id` | Rename | Provider-agnostic naming |
| `stripe_subscription_id` → `payment_subscription_id` | Rename | Provider-agnostic naming |
| `stripe_event_id` → `provider_event_id` | Rename | Provider-agnostic naming |
| `payment_provider` | New column | 'paddle' or 'stripe' |

### 5.3 Configuration

```env
# Paddle Configuration
PADDLE_API_KEY=pdl_live_xxx
PADDLE_WEBHOOK_SECRET=pdl_ntfset_xxx
PADDLE_ENVIRONMENT=production
PADDLE_CLIENT_TOKEN=live_xxx  # For Paddle.js

# Price IDs (configured in Paddle dashboard)
PADDLE_PRICE_STARTER=pri_xxx
PADDLE_PRICE_BASIC=pri_xxx
PADDLE_PRICE_PREMIUM=pri_xxx
PADDLE_PRICE_EXCLUSIVE=pri_xxx
PADDLE_PRICE_ELITE=pri_xxx
```

### 5.4 Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `@paddle/paddle-node-sdk` | Latest | Server-side API |
| `@paddle/paddle-js` | Latest | Client-side checkout |

**Remove**:
- `stripe` package

### 5.5 Files to Modify

**Replace:**
- `sietch-service/src/services/billing/StripeService.ts` → `PaddleService.ts`

**Update:**
- `sietch-service/src/services/billing/WebhookService.ts`
- `sietch-service/src/config.ts`
- `sietch-service/src/types/billing.ts`
- `sietch-service/src/api/billing.routes.ts`
- `sietch-service/src/db/billing-queries.ts`

**Remove (after validation):**
- Stripe SDK imports
- Stripe-specific error handling

---

## 6. Paddle API Reference

### 6.1 Key Endpoints

| Operation | Endpoint | Node.js SDK |
|-----------|----------|-------------|
| List subscriptions | `GET /subscriptions` | `paddle.subscriptions.list()` |
| Get subscription | `GET /subscriptions/{id}` | `paddle.subscriptions.get(id)` |
| Update subscription | `PATCH /subscriptions/{id}` | `paddle.subscriptions.update(id, data)` |
| Cancel subscription | `POST /subscriptions/{id}/cancel` | `paddle.subscriptions.cancel(id)` |
| List customers | `GET /customers` | `paddle.customers.list()` |
| Create customer | `POST /customers` | `paddle.customers.create(data)` |

### 6.2 Webhook Events

| Event | When | Action |
|-------|------|--------|
| `subscription.created` | Customer completes checkout | Create subscription record |
| `subscription.activated` | Subscription becomes active | Update status to active |
| `subscription.updated` | Subscription details change | Sync tier/status |
| `subscription.canceled` | Subscription ends | Downgrade to starter |
| `transaction.completed` | Payment successful | Record payment, grant access |
| `transaction.payment_failed` | Payment fails | Start grace period |

### 6.3 Webhook Signature Verification

```typescript
import { Paddle, Environment } from '@paddle/paddle-node-sdk';

const paddle = new Paddle(process.env.PADDLE_API_KEY!, {
  environment: Environment.production,
});

// Verify webhook signature
const isValid = paddle.webhooks.unmarshal(
  rawBody,
  secretKey,
  signatureHeader
);
```

---

## 7. Migration Strategy

### 7.1 Pre-Launch (No Existing Subscribers)

Since Arrakis hasn't launched yet, there are no existing Stripe subscribers to migrate. This simplifies the migration to a clean cut-over:

1. Implement Paddle integration
2. Test in Paddle sandbox
3. Configure production products/prices in Paddle
4. Deploy Paddle integration
5. Remove Stripe code

### 7.2 Rollback Plan

If Paddle issues arise during initial launch:
1. Re-enable Stripe code (keep in separate branch)
2. Note: Would require resolving BVI entity issue with Stripe

---

## 8. Success Criteria

- [ ] All subscription tiers purchasable via Paddle
- [ ] Badge and boost one-time payments functional
- [ ] Webhook processing with idempotency
- [ ] Grace period handling on payment failure
- [ ] Customer portal for subscription management
- [ ] Audit trail for all payment events
- [ ] Existing billing tests pass (adapted for Paddle)
- [ ] No Stripe references remain in source code

---

## 9. Reference Materials

### Documentation
- [Paddle Developer Docs](https://developer.paddle.com/)
- [Paddle Node.js SDK](https://github.com/PaddleHQ/paddle-node-sdk)
- [Paddle Webhooks](https://developer.paddle.com/webhooks/overview)
- [Paddle Signature Verification](https://developer.paddle.com/webhooks/signature-verification)

### Existing Implementation
- `sietch-service/src/services/billing/StripeService.ts` (634 lines)
- `sietch-service/src/services/billing/WebhookService.ts` (718 lines)
- `sietch-service/src/types/billing.ts` (835 lines)

---

## 10. Next Steps

1. **Run `/architect`** to create Software Design Document
2. **Run `/sprint-plan`** to create implementation sprints
3. Set up Paddle sandbox account
4. Configure test products in Paddle dashboard

---

**Document Status**: READY FOR ARCHITECTURE

**Approval**: Pending user review

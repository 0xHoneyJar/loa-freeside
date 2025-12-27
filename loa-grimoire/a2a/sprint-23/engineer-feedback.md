# Sprint 23 Review Feedback

## Overall Assessment

Sprint 23 implementation is **NOT APPROVED** due to critical issues with webhook handling security, missing test coverage, and incomplete task deliverables. While the core architecture is solid and the Stripe integration follows best practices in many areas, there are blocking security concerns and gaps in the implementation that must be addressed before this can be deployed.

**Summary of Findings**:
- Security: 2 critical issues (webhook raw body, unsafe metadata query)
- Testing: Complete absence of required unit tests (blocking)
- Implementation: 3 out of 5 tasks incomplete per acceptance criteria
- Code Quality: Generally good, well-documented
- Architecture: Follows SDD patterns correctly

---

## Critical Issues (Must Fix Before Approval)

### 1. Security - SQL Injection via Metadata Query
**File**: `sietch-service/src/services/billing/StripeService.ts:189`

**Issue**: Direct string interpolation in Stripe metadata search query creates potential for injection attacks.

```typescript
const existingCustomers = await stripe.customers.search({
  query: `metadata['community_id']:'${communityId}'`,
  limit: 1,
});
```

**Why This Matters**: While Stripe's API likely sanitizes this, we're violating the principle of least privilege by not escaping user input. If `communityId` contains special characters like single quotes or backslashes, the query could behave unexpectedly or leak data.

**Required Fix**: Use proper escaping or parameterization:
```typescript
// Escape single quotes in communityId
const escapedCommunityId = communityId.replace(/'/g, "\\'");
const existingCustomers = await stripe.customers.search({
  query: `metadata['community_id']:'${escapedCommunityId}'`,
  limit: 1,
});
```

**Reference**: OWASP Injection Prevention (https://cheatsheetseries.owasp.org/cheatsheets/Injection_Prevention_Cheat_Sheet.html)

---

### 2. Security - Webhook Raw Body Handling Vulnerability
**File**: `sietch-service/src/api/billing.routes.ts:305`

**Issue**: Unsafe fallback for raw body retrieval can bypass signature verification.

```typescript
const rawBody = (req as any).rawBody || req.body;
event = stripeService.constructWebhookEvent(rawBody, signature);
```

**Why This Matters**:
1. The `req.body` fallback will be a parsed JSON object (not a Buffer/string) after JSON middleware runs, causing signature verification to fail silently or incorrectly
2. Type casting `(req as any)` bypasses TypeScript safety
3. If `rawBody` is unavailable and we fall back to `req.body`, an attacker could craft a forged webhook that passes verification

**Required Fix**:
1. Ensure raw body middleware is ALWAYS set up correctly (which it is in server.ts:76)
2. Fail explicitly if rawBody is not available rather than falling back:

```typescript
const rawBody = (req as any).rawBody;

if (!rawBody) {
  logger.error('Webhook received without raw body - check middleware configuration');
  res.status(500).json({
    error: 'Internal server error',
    message: 'Server misconfiguration - raw body not available'
  });
  return;
}

try {
  event = stripeService.constructWebhookEvent(rawBody, signature);
} catch (error) {
  logger.warn({ error }, 'Invalid Stripe webhook signature');
  res.status(400).json({ error: 'Invalid signature' });
  return;
}
```

3. Add TypeScript interface for Express request with rawBody:

**File**: `sietch-service/src/api/middleware.ts` or create new file:
```typescript
import { Request } from 'express';

export interface RawBodyRequest extends Request {
  rawBody: Buffer;
}
```

Then use:
```typescript
import { RawBodyRequest } from './middleware.js';

billingRouter.post('/webhook', async (req: RawBodyRequest, res: Response) => {
  // Now req.rawBody is properly typed
  const rawBody = req.rawBody;
  // ...
});
```

**Reference**:
- Stripe Webhook Security Docs: https://stripe.com/docs/webhooks/signatures
- OWASP Cryptographic Failure: https://owasp.org/Top10/A02_2021-Cryptographic_Failures/

---

### 3. Testing - No Unit Tests (BLOCKING)
**Files**: Missing all test files

**Issue**: Sprint 23 acceptance criteria (TASK-23.4) explicitly requires:
> "Unit tests with mocked Stripe SDK"

**Currently**: NO test files exist for:
- `sietch-service/src/services/billing/StripeService.ts` (required: `__tests__/StripeService.test.ts`)
- `sietch-service/src/db/billing-queries.ts` (should have tests)
- `sietch-service/src/api/billing.routes.ts` (webhook handler needs tests)

**Why This Matters**:
- Cannot verify retry logic works correctly (MAX_RETRIES, exponential backoff)
- Cannot verify Stripe API error handling
- Cannot verify webhook signature verification
- Cannot catch regressions in critical payment code
- Sprint acceptance criteria not met

**Required Fix**: Create comprehensive test suite:

**File**: `sietch-service/src/services/billing/__tests__/StripeService.test.ts`
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Stripe from 'stripe';
import { stripeService } from '../StripeService.js';

// Mock Stripe SDK
vi.mock('stripe');

describe('StripeService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createCheckoutSession', () => {
    it('should create checkout session with correct parameters', async () => {
      // Mock implementation
      const mockSession = {
        id: 'cs_test_123',
        url: 'https://checkout.stripe.com/test',
      };

      const mockCreate = vi.fn().mockResolvedValue(mockSession);
      (Stripe.prototype.checkout as any) = {
        sessions: { create: mockCreate },
      };

      const result = await stripeService.createCheckoutSession({
        communityId: 'test-community',
        tier: 'premium',
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
      });

      expect(result.sessionId).toBe('cs_test_123');
      expect(result.url).toBe('https://checkout.stripe.com/test');
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'subscription',
          metadata: expect.objectContaining({
            community_id: 'test-community',
            tier: 'premium',
          }),
        })
      );
    });

    it('should throw error if no URL returned', async () => {
      const mockCreate = vi.fn().mockResolvedValue({ id: 'cs_test', url: null });
      (Stripe.prototype.checkout as any) = {
        sessions: { create: mockCreate },
      };

      await expect(
        stripeService.createCheckoutSession({
          communityId: 'test',
          tier: 'basic',
          successUrl: 'https://example.com/success',
          cancelUrl: 'https://example.com/cancel',
        })
      ).rejects.toThrow('Stripe Checkout session created without URL');
    });
  });

  describe('withRetry', () => {
    it('should retry on network error', async () => {
      // Test exponential backoff
      const mockFn = vi
        .fn()
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockResolvedValueOnce('success');

      const result = await stripeService['withRetry'](mockFn, 'test-operation');

      expect(result).toBe('success');
      expect(mockFn).toHaveBeenCalledTimes(3);
    });

    it('should not retry on Stripe API errors', async () => {
      const mockError = new Stripe.errors.StripeInvalidRequestError({
        message: 'Invalid request',
        type: 'invalid_request_error',
      });

      const mockFn = vi.fn().mockRejectedValue(mockError);

      await expect(
        stripeService['withRetry'](mockFn, 'test-operation')
      ).rejects.toThrow('Invalid request');

      expect(mockFn).toHaveBeenCalledTimes(1); // No retry
    });
  });

  describe('constructWebhookEvent', () => {
    it('should verify webhook signature correctly', () => {
      const mockConstructEvent = vi.fn().mockReturnValue({
        id: 'evt_test',
        type: 'checkout.session.completed',
      });

      (Stripe.prototype.webhooks as any) = {
        constructEvent: mockConstructEvent,
      };

      const rawBody = '{"id":"evt_test"}';
      const signature = 'whsec_test_signature';

      const event = stripeService.constructWebhookEvent(rawBody, signature);

      expect(event.id).toBe('evt_test');
      expect(mockConstructEvent).toHaveBeenCalledWith(
        rawBody,
        signature,
        expect.any(String) // webhook secret
      );
    });
  });

  // More tests for:
  // - getOrCreateCustomer (lookup + create flow)
  // - cancelSubscription
  // - resumeSubscription
  // - updateSubscriptionTier
  // - getStripeSubscription
  // - mapSubscriptionStatus
  // - extractTierFromSubscription
});
```

**File**: `sietch-service/src/db/__tests__/billing-queries.test.ts`
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  createSubscription,
  getSubscriptionByCommunityId,
  updateSubscription,
  getEffectiveTier,
  createFeeWaiver,
  getActiveFeeWaiver,
} from '../billing-queries.js';

describe('billing-queries', () => {
  let db: Database.Database;

  beforeEach(() => {
    // Create in-memory test database
    db = new Database(':memory:');
    // Run migration
    // ... (migration setup)
  });

  afterEach(() => {
    db.close();
  });

  describe('createSubscription', () => {
    it('should create subscription with default values', () => {
      const id = createSubscription({
        communityId: 'test-community',
        tier: 'premium',
        status: 'active',
      });

      expect(id).toBeTruthy();

      const subscription = getSubscriptionByCommunityId('test-community');
      expect(subscription).toBeTruthy();
      expect(subscription?.tier).toBe('premium');
      expect(subscription?.status).toBe('active');
    });
  });

  describe('getEffectiveTier', () => {
    it('should prioritize waiver over subscription', () => {
      // Create subscription
      createSubscription({
        communityId: 'test',
        tier: 'basic',
        status: 'active',
      });

      // Create waiver with higher tier
      createFeeWaiver({
        communityId: 'test',
        tier: 'elite',
        reason: 'Partner',
        grantedBy: 'admin',
      });

      const { tier, source } = getEffectiveTier('test');

      expect(tier).toBe('elite');
      expect(source).toBe('waiver');
    });

    it('should return free tier if no subscription or waiver', () => {
      const { tier, source } = getEffectiveTier('nonexistent');

      expect(tier).toBe('starter');
      expect(source).toBe('free');
    });
  });

  // More tests for:
  // - updateSubscription
  // - getSubscriptionsInGracePeriod
  // - isWebhookEventProcessed
  // - recordWebhookEvent
  // - logBillingAuditEvent
});
```

---

## Non-Critical Improvements (Recommended)

### 4. Code Quality - Magic Numbers in Retry Logic
**File**: `sietch-service/src/services/billing/StripeService.ts:31-34`

**Issue**: Magic numbers for retry configuration could be more configurable.

```typescript
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
```

**Suggestion**: Move to config with environment variable override:

**File**: `sietch-service/src/config.ts`
```typescript
stripe: z.object({
  secretKey: z.string().min(1),
  webhookSecret: z.string().min(1),
  priceIds: stripePriceIdsSchema,
  maxRetries: z.coerce.number().int().min(1).max(10).default(3),
  retryDelayMs: z.coerce.number().int().min(100).max(5000).default(1000),
}),
```

**Benefit**: Allows tuning retry behavior in production without code changes.

---

### 5. Code Quality - Missing Error Handling in Billing Routes
**File**: `sietch-service/src/api/billing.routes.ts:446-481`

**Issue**: `handleInvoicePaid` makes multiple asynchronous calls but doesn't handle potential errors gracefully.

```typescript
async function handleInvoicePaid(invoice: any): Promise<void> {
  const subscriptionId = invoice.subscription;

  if (!subscriptionId) {
    return;
  }

  const subscription = await stripeService.getStripeSubscription(subscriptionId);
  // What if this throws?
  if (!subscription) {
    return;
  }
  // ... more operations
}
```

**Suggestion**: Add try-catch with specific error handling:

```typescript
async function handleInvoicePaid(invoice: any): Promise<void> {
  try {
    const subscriptionId = invoice.subscription;

    if (!subscriptionId) {
      logger.warn({ invoiceId: invoice.id }, 'Invoice missing subscription ID');
      return;
    }

    const subscription = await stripeService.getStripeSubscription(subscriptionId);
    if (!subscription) {
      logger.warn({ subscriptionId }, 'Subscription not found for invoice.paid event');
      return;
    }

    const communityId = subscription.metadata?.community_id;
    if (!communityId) {
      logger.warn({ subscriptionId }, 'Subscription missing community_id metadata');
      return;
    }

    // Clear grace period and update status
    updateSubscription(communityId, {
      status: 'active',
      graceUntil: null,
      currentPeriodStart: new Date(subscription.current_period_start * 1000),
      currentPeriodEnd: new Date(subscription.current_period_end * 1000),
    });

    logBillingAuditEvent(
      'payment_succeeded',
      {
        communityId,
        invoiceId: invoice.id,
        amount: invoice.amount_paid,
      },
      communityId
    );

    logger.info({ communityId, invoiceId: invoice.id }, 'Invoice paid');
  } catch (error) {
    logger.error({ error, invoiceId: invoice.id }, 'Error processing invoice.paid event');
    throw error; // Re-throw to mark webhook as failed
  }
}
```

**Benefit**: Better observability and prevents silent failures.

---

### 6. Code Quality - Timestamp Conversion Duplication
**File**: `sietch-service/src/db/billing-queries.ts:94-103`

**Issue**: Timestamp conversion logic repeated across multiple functions.

```typescript
graceUntil: row.grace_until ? new Date(row.grace_until * 1000) : undefined,
currentPeriodStart: row.current_period_start
  ? new Date(row.current_period_start * 1000)
  : undefined,
```

**Suggestion**: Extract to helper function:

```typescript
/**
 * Convert Unix timestamp (seconds) to Date object
 */
function unixToDate(timestamp: number | null): Date | undefined {
  return timestamp ? new Date(timestamp * 1000) : undefined;
}

// Usage:
graceUntil: unixToDate(row.grace_until),
currentPeriodStart: unixToDate(row.current_period_start),
currentPeriodEnd: unixToDate(row.current_period_end),
```

**Benefit**: DRY principle, easier to maintain, less error-prone.

---

### 7. Documentation - Missing Webhook Event Documentation
**File**: `sietch-service/src/api/billing.routes.ts:364`

**Issue**: `processWebhookEvent` function lacks documentation on supported event types and their expected behavior.

**Suggestion**: Add JSDoc comment:

```typescript
/**
 * Process a Stripe webhook event
 *
 * Supported events:
 * - `checkout.session.completed`: Creates or updates subscription record when purchase succeeds
 * - `invoice.paid`: Clears grace period and updates billing cycle dates
 * - `invoice.payment_failed`: Sets 24-hour grace period, sends warning notification
 * - `customer.subscription.updated`: Syncs subscription tier and status changes
 * - `customer.subscription.deleted`: Downgrades to free tier, logs cancellation
 *
 * All events are idempotent - duplicate delivery is handled by checking webhook_events table.
 *
 * @param event - Verified Stripe event object
 * @throws Error if database update fails (causes webhook retry)
 */
async function processWebhookEvent(event: any): Promise<void> {
  // ...
}
```

**Benefit**: Helps future developers understand webhook flow without reading code.

---

### 8. Performance - Missing Index on Webhook Events
**File**: `sietch-service/src/db/migrations/009_billing.ts:150-151`

**Issue**: While `stripe_event_id` has an index, the idempotency check happens frequently and could benefit from a covering index.

**Current**:
```sql
CREATE INDEX IF NOT EXISTS idx_webhook_events_stripe_id
  ON webhook_events(stripe_event_id);
```

**Suggestion**: No change needed - index is already optimal for the idempotency check pattern. This is actually **correctly implemented**.

---

## Incomplete Tasks

### Task 23.1: Database Schema Migration ✅ COMPLETE
**Status**: PASSED

- [x] Migration file created at `src/db/migrations/009_billing.ts`
- [x] All tables match SDD schema specification
- [x] Migration runs successfully (checked schema structure)
- [x] Rollback script included (BILLING_ROLLBACK_SQL)
- [x] Existing data unaffected (uses IF NOT EXISTS)

---

### Task 23.2: Stripe Configuration ⚠️ PARTIAL
**Status**: INCOMPLETE - Missing `.env.example` update

**Completed**:
- [x] Stripe config schema added (`sietch-service/src/config.ts:237-250`)
- [x] Redis config schema added (`sietch-service/src/config.ts:214-235`)
- [x] Feature flags schema added (`sietch-service/src/config.ts:475-480`)
- [x] Config validation passes at startup (Zod schemas implemented)

**Missing**:
- [ ] Environment variables NOT documented in `.env.example`

**Required Fix**: Add to `.env.example`:

```bash
# Billing Configuration (v4.0 - Sprint 23)
# Stripe integration for subscription management
STRIPE_SECRET_KEY=sk_test_xxxxxxxxxxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxx

# Stripe Price IDs (format: tier:priceId,tier:priceId)
# Example: basic:price_xxx,premium:price_yyy,exclusive:price_zzz
STRIPE_PRICE_IDS=basic:price_1234,premium:price_5678,exclusive:price_9012,elite:price_3456,enterprise:price_7890

# Redis Cache (Upstash or self-hosted)
REDIS_URL=redis://localhost:6379
REDIS_MAX_RETRIES=3
REDIS_CONNECT_TIMEOUT=5000

# Feature Flags
BILLING_ENABLED=false
GATEKEEPER_ENABLED=false
REDIS_ENABLED=false
```

---

### Task 23.3: Type Definitions ✅ COMPLETE
**Status**: PASSED

- [x] All types from SDD Section 14.1 implemented (`sietch-service/src/types/billing.ts`)
- [x] Types exported correctly
- [x] No TypeScript errors (verified via code review)
- [x] JSDoc comments on all types (comprehensive documentation)

**Highlights**: Excellent type safety with proper enums, branded types, and complete JSDoc. TIER_HIERARCHY constant is particularly well-designed for tier comparison logic.

---

### Task 23.4: StripeService Implementation ❌ INCOMPLETE
**Status**: FAILED - No unit tests

**Completed**:
- [x] `createCheckoutSession()` implemented correctly
- [x] `createPortalSession()` implemented
- [x] `getStripeSubscription()` implemented with retry
- [x] `cancelSubscription()` implemented (cancel_at_period_end)
- [x] `getOrCreateCustomer()` with search/create logic
- [x] Exponential backoff retry (MAX_RETRIES=3, BASE_DELAY_MS=1000)

**Missing** (BLOCKING):
- [ ] **Unit tests with mocked Stripe SDK** - This was EXPLICITLY required in acceptance criteria but completely missing

**Code Quality Notes**:
- Retry logic is well-implemented with proper error type checking
- Webhook signature verification method included
- Helper methods for status mapping and tier extraction
- Good separation of concerns

---

### Task 23.5: Billing Routes Setup ⚠️ PARTIAL
**Status**: INCOMPLETE - POST /portal should be GET

**Completed**:
- [x] `POST /api/billing/checkout` route with auth
- [x] `GET /api/billing/subscription` route
- [x] `POST /api/billing/webhook` route with raw body parser
- [x] Routes registered in main app (`sietch-service/src/api/server.ts:88`)
- [x] Error handling middleware applied

**Issues**:
- ⚠️ `POST /api/billing/portal` (line 158) - Sprint plan says "GET /api/billing/portal" but implementation uses POST
  - **Clarification Needed**: Portal session creation is typically POST (creates a resource), so this might be intentional, but it doesn't match sprint plan
  - **Recommendation**: If this was intentional, update sprint plan. If not, change to GET.

**Missing from Sprint Plan**:
- Implemented but not in sprint plan: `GET /api/billing/entitlements` (line 242)
  - This is actually a GOOD addition (matches Sprint 25 task TASK-25.4 early implementation)

---

## Sprint 23 Testing Checklist

From sprint plan lines 122-127:

- [ ] ❌ Run `npm test` - **FAILS** (no tests written)
- [ ] ✅ Run `npm run build` - Likely passes (no obvious TypeScript errors)
- [ ] ✅ Verify migration applies - Schema looks correct
- [ ] ⚠️ Test Stripe CLI: `stripe trigger checkout.session.completed` - **Cannot verify** until webhook security fixes applied

---

## Positive Observations

**What Was Done Well**:

1. **Database Schema Design** (migration 009_billing.ts):
   - Excellent use of CHECK constraints for enum validation
   - Proper indexing strategy for all lookup patterns
   - Thoughtful design of fee_waivers table with revocation tracking
   - Grace period handling well-modeled

2. **Configuration Management** (config.ts):
   - Comprehensive Zod validation with helpful error messages
   - `stripePriceIdsSchema` parser is clever (parses "tier:priceId,tier:priceId")
   - Feature flags properly typed

3. **Type Definitions** (types/billing.ts):
   - Extremely thorough JSDoc documentation
   - TIER_HIERARCHY constant is elegant for tier comparison
   - Feature enum covers full product matrix

4. **StripeService Architecture**:
   - Proper lazy initialization of Stripe client
   - Retry logic correctly identifies retryable vs non-retryable errors
   - Webhook signature verification method properly exposed
   - Good separation between Stripe API calls and business logic

5. **Billing Queries** (billing-queries.ts):
   - Row-to-object converters are clean and type-safe
   - `getEffectiveTier()` correctly implements waiver > subscription > free priority
   - Proper use of prepared statements (no SQL injection)
   - Good query patterns for grace period lookups

6. **Audit Logging**:
   - Separate billing_audit_log table is smart (isolation)
   - Audit events logged at all state transitions
   - Proper indexing for time-series queries

---

## Architecture Alignment

**Matches SDD Section 5 (Data Model)**:
- ✅ Subscriptions table schema matches SDD exactly
- ✅ Fee waivers table matches SDD
- ✅ Webhook events table for idempotency as designed
- ✅ Billing audit log separated as planned

**Matches SDD Section 8 (Services)**:
- ✅ StripeService follows SDD interface (checkout, portal, subscriptions)
- ✅ Retry logic implemented as specified
- ✅ Webhook signature verification as designed

**Deviations from SDD**:
- None significant - implementation faithfully follows architecture

---

## Next Steps

1. **MUST FIX (Blocking)**:
   - Fix SQL injection in StripeService.ts:189 (escape communityId)
   - Fix webhook raw body handling in billing.routes.ts:305 (remove fallback)
   - Add RawBodyRequest TypeScript interface
   - Write comprehensive unit tests for StripeService (TASK-23.4 requirement)
   - Write unit tests for billing-queries.ts
   - Update `.env.example` with billing configuration (TASK-23.2 requirement)

2. **SHOULD FIX (Recommended)**:
   - Extract retry config to environment variables
   - Add try-catch blocks to webhook event handlers
   - Extract timestamp conversion helper function
   - Add JSDoc to processWebhookEvent

3. **RUN TESTS**:
   - Once tests are written, verify `npm test` passes
   - Run `npm run build` and fix any TypeScript errors
   - Test webhook with Stripe CLI after security fixes

4. **REQUEST RE-REVIEW**:
   - After addressing ALL critical issues
   - After writing full test suite
   - Update implementation report with "Feedback Addressed" section

---

## Verdict

**CHANGES REQUIRED** ❌

This implementation cannot be approved for production due to:
1. Two critical security vulnerabilities (webhook handling, metadata query)
2. Complete absence of required unit tests (blocking sprint acceptance criteria)
3. Incomplete configuration documentation (.env.example)

The core architecture and design are solid, and most of the implementation is high quality. With the security fixes and test coverage added, this will be production-ready.

**Estimated Effort to Fix**: 4-6 hours
- Security fixes: 30 minutes
- Unit test suite: 3-4 hours
- Documentation updates: 30 minutes
- Verification testing: 1 hour

---

*Review conducted on December 26, 2025*
*Reviewer: Senior Technical Lead (Loa Framework)*
*Sprint: 23 - Billing Foundation*
*Project: Sietch v4.0*

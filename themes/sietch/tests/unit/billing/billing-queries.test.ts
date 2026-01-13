/**
 * Billing Database Queries Unit Tests (v4.0 - Sprint 23)
 *
 * Tests for billing database operations including:
 * - Subscription CRUD
 * - Fee waiver management
 * - Webhook event tracking
 * - Effective tier calculation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { BILLING_SCHEMA_SQL } from '../../../src/db/schema.js';

// Create in-memory database for testing
let testDb: Database.Database;

// Mock the getDatabase function to return our test database
vi.mock('../../../src/db/connection.js', () => ({
  getDatabase: vi.fn(() => testDb),
}));

// Mock logger
vi.mock('../../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Import after mocking
import {
  createSubscription,
  getSubscriptionByCommunityId,
  getSubscriptionByPaymentId,
  updateSubscription,
  deleteSubscription,
  getSubscriptionsInGracePeriod,
  getExpiredGracePeriodSubscriptions,
  createFeeWaiver,
  getActiveFeeWaiver,
  getFeeWaiversByCommunity,
  revokeFeeWaiver,
  getAllActiveFeeWaivers,
  isWebhookEventProcessed,
  recordWebhookEvent,
  updateWebhookEventStatus,
  getFailedWebhookEvents,
  logBillingAuditEvent,
  getBillingAuditLog,
  getEffectiveTier,
} from '../../../src/db/billing-queries.js';

describe('Billing Database Queries', () => {
  beforeEach(() => {
    // Create fresh in-memory database for each test
    testDb = new Database(':memory:');
    testDb.exec(BILLING_SCHEMA_SQL);
  });

  afterEach(() => {
    testDb.close();
  });

  // ===========================================================================
  // Subscription Tests
  // ===========================================================================

  describe('Subscriptions', () => {
    describe('createSubscription', () => {
      it('should create subscription with all fields', () => {
        const id = createSubscription({
          communityId: 'test-community',
          paymentCustomerId: 'cus_123',
          paymentSubscriptionId: 'sub_456',
          tier: 'premium',
          status: 'active',
        });

        expect(id).toBeTruthy();
        expect(typeof id).toBe('string');

        const subscription = getSubscriptionByCommunityId('test-community');
        expect(subscription).not.toBeNull();
        expect(subscription?.communityId).toBe('test-community');
        expect(subscription?.paymentCustomerId).toBe('cus_123');
        expect(subscription?.paymentSubscriptionId).toBe('sub_456');
        expect(subscription?.tier).toBe('premium');
        expect(subscription?.status).toBe('active');
      });

      it('should create subscription with minimal fields', () => {
        const id = createSubscription({
          communityId: 'minimal-community',
        });

        expect(id).toBeTruthy();

        const subscription = getSubscriptionByCommunityId('minimal-community');
        expect(subscription?.tier).toBe('starter');
        expect(subscription?.status).toBe('active');
      });

      it('should create unique IDs for each subscription', () => {
        const id1 = createSubscription({ communityId: 'community-1' });
        const id2 = createSubscription({ communityId: 'community-2' });

        expect(id1).not.toBe(id2);
      });
    });

    describe('getSubscriptionByCommunityId', () => {
      it('should return null for non-existent community', () => {
        const subscription = getSubscriptionByCommunityId('nonexistent');
        expect(subscription).toBeNull();
      });

      it('should return subscription when exists', () => {
        createSubscription({
          communityId: 'existing-community',
          tier: 'basic',
          status: 'active',
        });

        const subscription = getSubscriptionByCommunityId('existing-community');
        expect(subscription).not.toBeNull();
        expect(subscription?.tier).toBe('basic');
      });
    });

    describe('getSubscriptionByPaymentId', () => {
      it('should return subscription by payment subscription ID', () => {
        createSubscription({
          communityId: 'payment-test',
          paymentSubscriptionId: 'sub_unique_123',
          tier: 'elite',
        });

        const subscription = getSubscriptionByPaymentId('sub_unique_123');
        expect(subscription).not.toBeNull();
        expect(subscription?.communityId).toBe('payment-test');
        expect(subscription?.tier).toBe('elite');
      });

      it('should return null for non-existent payment ID', () => {
        const subscription = getSubscriptionByPaymentId('sub_nonexistent');
        expect(subscription).toBeNull();
      });
    });

    describe('updateSubscription', () => {
      it('should update tier', () => {
        createSubscription({
          communityId: 'update-test',
          tier: 'basic',
        });

        const updated = updateSubscription('update-test', { tier: 'premium' });
        expect(updated).toBe(true);

        const subscription = getSubscriptionByCommunityId('update-test');
        expect(subscription?.tier).toBe('premium');
      });

      it('should update status', () => {
        createSubscription({
          communityId: 'status-test',
          status: 'active',
        });

        updateSubscription('status-test', { status: 'past_due' });

        const subscription = getSubscriptionByCommunityId('status-test');
        expect(subscription?.status).toBe('past_due');
      });

      it('should update grace period', () => {
        createSubscription({
          communityId: 'grace-test',
        });

        const graceUntil = new Date(Date.now() + 24 * 60 * 60 * 1000);
        updateSubscription('grace-test', { graceUntil });

        const subscription = getSubscriptionByCommunityId('grace-test');
        expect(subscription?.graceUntil).toBeTruthy();
        // Use numDigits=-4 for precision to nearest 10000ms (10 seconds) to handle timing variations
        expect(subscription?.graceUntil?.getTime()).toBeCloseTo(graceUntil.getTime(), -4);
      });

      it('should clear grace period with null', () => {
        createSubscription({
          communityId: 'clear-grace-test',
        });

        // Set grace period
        const graceUntil = new Date(Date.now() + 24 * 60 * 60 * 1000);
        updateSubscription('clear-grace-test', { graceUntil });

        // Clear it
        updateSubscription('clear-grace-test', { graceUntil: null });

        const subscription = getSubscriptionByCommunityId('clear-grace-test');
        expect(subscription?.graceUntil).toBeUndefined();
      });

      it('should return false for non-existent community', () => {
        const updated = updateSubscription('nonexistent', { tier: 'premium' });
        expect(updated).toBe(false);
      });
    });

    describe('deleteSubscription', () => {
      it('should delete existing subscription', () => {
        createSubscription({ communityId: 'delete-test' });

        const deleted = deleteSubscription('delete-test');
        expect(deleted).toBe(true);

        const subscription = getSubscriptionByCommunityId('delete-test');
        expect(subscription).toBeNull();
      });

      it('should return false for non-existent subscription', () => {
        const deleted = deleteSubscription('nonexistent');
        expect(deleted).toBe(false);
      });
    });

    describe('getSubscriptionsInGracePeriod', () => {
      it('should return subscriptions with future grace_until', () => {
        // Create subscription with future grace period
        createSubscription({ communityId: 'grace-1' });
        const futureGrace = new Date(Date.now() + 24 * 60 * 60 * 1000);
        updateSubscription('grace-1', { graceUntil: futureGrace, status: 'past_due' });

        // Create subscription without grace period
        createSubscription({ communityId: 'no-grace' });

        const inGrace = getSubscriptionsInGracePeriod();
        expect(inGrace).toHaveLength(1);
        expect(inGrace[0]?.communityId).toBe('grace-1');
      });

      it('should not return subscriptions with expired grace period', () => {
        createSubscription({ communityId: 'expired-grace' });

        // Set grace period in the past - we need to do this via raw SQL
        // since updateSubscription won't allow past dates easily
        const pastTimestamp = Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000);
        testDb.prepare('UPDATE subscriptions SET grace_until = ? WHERE community_id = ?')
          .run(pastTimestamp, 'expired-grace');

        const inGrace = getSubscriptionsInGracePeriod();
        expect(inGrace).toHaveLength(0);
      });
    });
  });

  // ===========================================================================
  // Fee Waiver Tests
  // ===========================================================================

  describe('Fee Waivers', () => {
    describe('createFeeWaiver', () => {
      it('should create fee waiver', () => {
        const id = createFeeWaiver({
          communityId: 'waiver-test',
          tier: 'premium',
          reason: 'Partner program',
          grantedBy: 'admin',
        });

        expect(id).toBeTruthy();

        const waiver = getActiveFeeWaiver('waiver-test');
        expect(waiver).not.toBeNull();
        expect(waiver?.tier).toBe('premium');
        expect(waiver?.reason).toBe('Partner program');
      });

      it('should create fee waiver with expiration', () => {
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

        createFeeWaiver({
          communityId: 'expiring-waiver',
          tier: 'elite',
          reason: 'Trial',
          grantedBy: 'admin',
          expiresAt,
        });

        const waiver = getActiveFeeWaiver('expiring-waiver');
        expect(waiver?.expiresAt).toBeTruthy();
      });
    });

    describe('getActiveFeeWaiver', () => {
      it('should return null for community without waiver', () => {
        const waiver = getActiveFeeWaiver('no-waiver');
        expect(waiver).toBeNull();
      });

      it('should return highest tier waiver when multiple exist', () => {
        createFeeWaiver({
          communityId: 'multi-waiver',
          tier: 'basic',
          reason: 'Test 1',
          grantedBy: 'admin',
        });

        createFeeWaiver({
          communityId: 'multi-waiver',
          tier: 'elite',
          reason: 'Test 2',
          grantedBy: 'admin',
        });

        createFeeWaiver({
          communityId: 'multi-waiver',
          tier: 'premium',
          reason: 'Test 3',
          grantedBy: 'admin',
        });

        const waiver = getActiveFeeWaiver('multi-waiver');
        expect(waiver?.tier).toBe('elite');
      });

      it('should not return revoked waivers', () => {
        const id = createFeeWaiver({
          communityId: 'revoked-test',
          tier: 'premium',
          reason: 'Test',
          grantedBy: 'admin',
        });

        revokeFeeWaiver(id, {
          revokedBy: 'admin',
          revokeReason: 'Policy change',
        });

        const waiver = getActiveFeeWaiver('revoked-test');
        expect(waiver).toBeNull();
      });
    });

    describe('getFeeWaiversByCommunity', () => {
      it('should return all waivers including revoked', () => {
        const id1 = createFeeWaiver({
          communityId: 'history-test',
          tier: 'basic',
          reason: 'First',
          grantedBy: 'admin',
        });

        revokeFeeWaiver(id1, {
          revokedBy: 'admin',
          revokeReason: 'Upgraded',
        });

        createFeeWaiver({
          communityId: 'history-test',
          tier: 'premium',
          reason: 'Second',
          grantedBy: 'admin',
        });

        const waivers = getFeeWaiversByCommunity('history-test');
        expect(waivers).toHaveLength(2);
      });
    });

    describe('revokeFeeWaiver', () => {
      it('should revoke existing waiver', () => {
        const id = createFeeWaiver({
          communityId: 'revoke-test',
          tier: 'premium',
          reason: 'Test',
          grantedBy: 'admin',
        });

        const revoked = revokeFeeWaiver(id, {
          revokedBy: 'admin',
          revokeReason: 'Terms violated',
        });

        expect(revoked).toBe(true);

        const waivers = getFeeWaiversByCommunity('revoke-test');
        expect(waivers[0]?.revokedAt).toBeTruthy();
        expect(waivers[0]?.revokedBy).toBe('admin');
        expect(waivers[0]?.revokeReason).toBe('Terms violated');
      });

      it('should return false for non-existent waiver', () => {
        const revoked = revokeFeeWaiver('nonexistent-id', {
          revokedBy: 'admin',
          revokeReason: 'Test',
        });

        expect(revoked).toBe(false);
      });

      it('should not double-revoke waiver', () => {
        const id = createFeeWaiver({
          communityId: 'double-revoke',
          tier: 'premium',
          reason: 'Test',
          grantedBy: 'admin',
        });

        const first = revokeFeeWaiver(id, { revokedBy: 'admin1', revokeReason: 'First' });
        const second = revokeFeeWaiver(id, { revokedBy: 'admin2', revokeReason: 'Second' });

        expect(first).toBe(true);
        expect(second).toBe(false);
      });
    });
  });

  // ===========================================================================
  // Webhook Event Tests
  // ===========================================================================

  describe('Webhook Events', () => {
    describe('isWebhookEventProcessed', () => {
      it('should return false for new event', () => {
        const processed = isWebhookEventProcessed('evt_new_123');
        expect(processed).toBe(false);
      });

      it('should return true for processed event', () => {
        recordWebhookEvent('evt_test_456', 'checkout.session.completed', '{}', 'processed');

        const processed = isWebhookEventProcessed('evt_test_456');
        expect(processed).toBe(true);
      });
    });

    describe('recordWebhookEvent', () => {
      it('should record event with all details', () => {
        const id = recordWebhookEvent(
          'evt_full_789',
          'invoice.paid',
          '{"invoice": "inv_123"}',
          'processed'
        );

        expect(id).toBeTruthy();

        const processed = isWebhookEventProcessed('evt_full_789');
        expect(processed).toBe(true);
      });

      it('should record failed event with error message', () => {
        recordWebhookEvent(
          'evt_failed_123',
          'invoice.payment_failed',
          '{}',
          'failed',
          'Payment method declined'
        );

        const events = getFailedWebhookEvents();
        expect(events).toHaveLength(1);
        expect(events[0]?.errorMessage).toBe('Payment method declined');
      });
    });

    describe('updateWebhookEventStatus', () => {
      it('should update status from processing to processed', () => {
        recordWebhookEvent('evt_update_123', 'checkout.session.completed', '{}', 'processing');

        const updated = updateWebhookEventStatus('evt_update_123', 'processed');
        expect(updated).toBe(true);
      });

      it('should add error message on failure', () => {
        recordWebhookEvent('evt_fail_update', 'invoice.paid', '{}', 'processing');

        updateWebhookEventStatus('evt_fail_update', 'failed', 'Database error');

        const events = getFailedWebhookEvents();
        const event = events.find(e => e.providerEventId === 'evt_fail_update');
        expect(event?.errorMessage).toBe('Database error');
      });
    });

    describe('getFailedWebhookEvents', () => {
      it('should only return failed events', () => {
        recordWebhookEvent('evt_success_1', 'checkout.session.completed', '{}', 'processed');
        recordWebhookEvent('evt_fail_1', 'invoice.payment_failed', '{}', 'failed', 'Error 1');
        recordWebhookEvent('evt_success_2', 'invoice.paid', '{}', 'processed');
        recordWebhookEvent('evt_fail_2', 'subscription.updated', '{}', 'failed', 'Error 2');

        const failed = getFailedWebhookEvents();
        expect(failed).toHaveLength(2);
        expect(failed.every(e => e.status === 'failed')).toBe(true);
      });

      it('should respect limit parameter', () => {
        for (let i = 0; i < 10; i++) {
          recordWebhookEvent(`evt_fail_${i}`, 'test', '{}', 'failed');
        }

        const limited = getFailedWebhookEvents(5);
        expect(limited).toHaveLength(5);
      });
    });
  });

  // ===========================================================================
  // Billing Audit Log Tests
  // ===========================================================================

  describe('Billing Audit Log', () => {
    describe('logBillingAuditEvent', () => {
      it('should log event with all fields', () => {
        const id = logBillingAuditEvent(
          'subscription_created',
          { tier: 'premium', amount: 99 },
          'test-community',
          'admin@example.com'
        );

        expect(typeof id).toBe('number');

        const logs = getBillingAuditLog({ communityId: 'test-community' });
        expect(logs).toHaveLength(1);
        expect(logs[0]?.eventType).toBe('subscription_created');
        expect(logs[0]?.eventData.tier).toBe('premium');
        expect(logs[0]?.actor).toBe('admin@example.com');
      });

      it('should log event without optional fields', () => {
        logBillingAuditEvent('webhook_received', { eventId: 'evt_123' });

        const logs = getBillingAuditLog({ eventType: 'webhook_received' });
        expect(logs).toHaveLength(1);
        expect(logs[0]?.communityId).toBeUndefined();
        expect(logs[0]?.actor).toBeUndefined();
      });
    });

    describe('getBillingAuditLog', () => {
      beforeEach(() => {
        // Create some test data
        logBillingAuditEvent('subscription_created', {}, 'community-1', 'admin');
        logBillingAuditEvent('payment_succeeded', {}, 'community-1', 'system');
        logBillingAuditEvent('subscription_created', {}, 'community-2', 'admin');
        logBillingAuditEvent('payment_failed', {}, 'community-1', 'system');
      });

      it('should filter by event type', () => {
        const logs = getBillingAuditLog({ eventType: 'subscription_created' });
        expect(logs).toHaveLength(2);
      });

      it('should filter by community ID', () => {
        const logs = getBillingAuditLog({ communityId: 'community-1' });
        expect(logs).toHaveLength(3);
      });

      it('should combine filters', () => {
        const logs = getBillingAuditLog({
          eventType: 'subscription_created',
          communityId: 'community-1',
        });
        expect(logs).toHaveLength(1);
      });

      it('should respect limit', () => {
        const logs = getBillingAuditLog({ limit: 2 });
        expect(logs).toHaveLength(2);
      });
    });
  });

  // ===========================================================================
  // Effective Tier Tests
  // ===========================================================================

  describe('getEffectiveTier', () => {
    it('should return free tier for community without subscription or waiver', () => {
      const result = getEffectiveTier('new-community');

      expect(result.tier).toBe('starter');
      expect(result.source).toBe('free');
    });

    it('should return subscription tier for active subscription', () => {
      createSubscription({
        communityId: 'subscribed-community',
        tier: 'premium',
        status: 'active',
      });

      const result = getEffectiveTier('subscribed-community');

      expect(result.tier).toBe('premium');
      expect(result.source).toBe('subscription');
    });

    it('should prioritize waiver over subscription', () => {
      createSubscription({
        communityId: 'waiver-priority',
        tier: 'basic',
        status: 'active',
      });

      createFeeWaiver({
        communityId: 'waiver-priority',
        tier: 'elite',
        reason: 'VIP Partner',
        grantedBy: 'admin',
      });

      const result = getEffectiveTier('waiver-priority');

      expect(result.tier).toBe('elite');
      expect(result.source).toBe('waiver');
    });

    it('should return subscription tier during grace period', () => {
      createSubscription({
        communityId: 'grace-community',
        tier: 'exclusive',
        status: 'past_due',
      });

      const futureGrace = new Date(Date.now() + 24 * 60 * 60 * 1000);
      updateSubscription('grace-community', { graceUntil: futureGrace });

      const result = getEffectiveTier('grace-community');

      expect(result.tier).toBe('exclusive');
      expect(result.source).toBe('subscription');
    });

    it('should return free tier after grace period expires', () => {
      createSubscription({
        communityId: 'expired-community',
        tier: 'premium',
        status: 'past_due',
      });

      // Set grace period in the past via raw SQL
      const pastTimestamp = Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000);
      testDb.prepare('UPDATE subscriptions SET grace_until = ? WHERE community_id = ?')
        .run(pastTimestamp, 'expired-community');

      const result = getEffectiveTier('expired-community');

      expect(result.tier).toBe('starter');
      expect(result.source).toBe('free');
    });

    it('should return free tier for canceled subscription', () => {
      createSubscription({
        communityId: 'canceled-community',
        tier: 'premium',
        status: 'canceled',
      });

      const result = getEffectiveTier('canceled-community');

      expect(result.tier).toBe('starter');
      expect(result.source).toBe('free');
    });
  });
});

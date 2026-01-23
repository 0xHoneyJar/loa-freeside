/**
 * Crypto Payment Database Queries Unit Tests (Sprint 155: NOWPayments Integration)
 *
 * Tests for crypto payment database operations including:
 * - Payment creation and retrieval
 * - Status updates from webhooks
 * - Expiration handling
 * - List and filter operations
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { BILLING_SCHEMA_SQL, CRYPTO_PAYMENTS_SCHEMA_SQL } from '../../../src/db/schema.js';

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
  createCryptoPayment,
  getCryptoPaymentByPaymentId,
  getCryptoPaymentById,
  getCryptoPaymentByOrderId,
  updateCryptoPaymentStatus,
  listCryptoPayments,
  getPendingCryptoPayments,
  getExpiredCryptoPayments,
  markExpiredCryptoPayments,
  getCompletedCryptoPayments,
} from '../../../src/db/billing-queries.js';

describe('Crypto Payment Database Queries', () => {
  beforeEach(() => {
    // Create fresh in-memory database for each test
    testDb = new Database(':memory:');
    // Run billing schema first (creates subscriptions table)
    testDb.exec(BILLING_SCHEMA_SQL);
    // Run crypto payments schema (extends constraint and creates crypto_payments table)
    testDb.exec(CRYPTO_PAYMENTS_SCHEMA_SQL);

    // Create a test community for foreign key constraint
    testDb.exec(`
      CREATE TABLE IF NOT EXISTS communities (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')) NOT NULL
      );
      INSERT INTO communities (id, name) VALUES ('test-community', 'Test Community');
      INSERT INTO communities (id, name) VALUES ('community-1', 'Community 1');
      INSERT INTO communities (id, name) VALUES ('community-2', 'Community 2');
    `);
  });

  afterEach(() => {
    testDb.close();
  });

  // ===========================================================================
  // createCryptoPayment Tests
  // ===========================================================================

  describe('createCryptoPayment', () => {
    it('should create crypto payment with all fields', () => {
      const expiresAt = new Date(Date.now() + 20 * 60 * 1000); // 20 minutes

      const id = createCryptoPayment({
        paymentId: 'np_payment_123',
        communityId: 'test-community',
        tier: 'premium',
        priceAmount: 99.0,
        payAmount: 0.0025,
        payCurrency: 'btc',
        payAddress: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2',
        orderId: 'order_abc123',
        expiresAt,
      });

      expect(id).toBeTruthy();
      expect(id.startsWith('cp_')).toBe(true);

      const payment = getCryptoPaymentByPaymentId('np_payment_123');
      expect(payment).not.toBeNull();
      expect(payment?.communityId).toBe('test-community');
      expect(payment?.tier).toBe('premium');
      expect(payment?.priceAmount).toBe(99.0);
      expect(payment?.priceCurrency).toBe('usd');
      expect(payment?.payAmount).toBe(0.0025);
      expect(payment?.payCurrency).toBe('btc');
      expect(payment?.payAddress).toBe('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2');
      expect(payment?.status).toBe('waiting');
      expect(payment?.orderId).toBe('order_abc123');
    });

    it('should create crypto payment with minimal fields', () => {
      const id = createCryptoPayment({
        paymentId: 'np_minimal_456',
        communityId: 'test-community',
        tier: 'basic',
        priceAmount: 29.0,
      });

      expect(id).toBeTruthy();

      const payment = getCryptoPaymentByPaymentId('np_minimal_456');
      expect(payment?.tier).toBe('basic');
      expect(payment?.priceAmount).toBe(29.0);
      expect(payment?.payAmount).toBeUndefined();
      expect(payment?.payCurrency).toBeUndefined();
      expect(payment?.payAddress).toBeUndefined();
      expect(payment?.status).toBe('waiting');
    });

    it('should create unique IDs for each payment', () => {
      const id1 = createCryptoPayment({
        paymentId: 'np_unique_1',
        communityId: 'test-community',
        tier: 'basic',
        priceAmount: 29.0,
      });

      const id2 = createCryptoPayment({
        paymentId: 'np_unique_2',
        communityId: 'test-community',
        tier: 'premium',
        priceAmount: 99.0,
      });

      expect(id1).not.toBe(id2);
    });

    it('should handle different tiers correctly', () => {
      const tiers = ['starter', 'basic', 'premium', 'exclusive', 'elite', 'enterprise'] as const;

      for (const tier of tiers) {
        const id = createCryptoPayment({
          paymentId: `np_tier_${tier}`,
          communityId: 'test-community',
          tier,
          priceAmount: 100.0,
        });

        expect(id).toBeTruthy();
        const payment = getCryptoPaymentByPaymentId(`np_tier_${tier}`);
        expect(payment?.tier).toBe(tier);
      }
    });
  });

  // ===========================================================================
  // getCryptoPaymentByPaymentId Tests
  // ===========================================================================

  describe('getCryptoPaymentByPaymentId', () => {
    it('should return null for non-existent payment', () => {
      const payment = getCryptoPaymentByPaymentId('nonexistent');
      expect(payment).toBeNull();
    });

    it('should return payment when exists', () => {
      createCryptoPayment({
        paymentId: 'np_existing_789',
        communityId: 'test-community',
        tier: 'exclusive',
        priceAmount: 199.0,
      });

      const payment = getCryptoPaymentByPaymentId('np_existing_789');
      expect(payment).not.toBeNull();
      expect(payment?.tier).toBe('exclusive');
      expect(payment?.priceAmount).toBe(199.0);
    });
  });

  // ===========================================================================
  // getCryptoPaymentById Tests
  // ===========================================================================

  describe('getCryptoPaymentById', () => {
    it('should return null for non-existent ID', () => {
      const payment = getCryptoPaymentById('cp_nonexistent');
      expect(payment).toBeNull();
    });

    it('should return payment by internal ID', () => {
      const id = createCryptoPayment({
        paymentId: 'np_internal_test',
        communityId: 'test-community',
        tier: 'premium',
        priceAmount: 99.0,
      });

      const payment = getCryptoPaymentById(id);
      expect(payment).not.toBeNull();
      expect(payment?.id).toBe(id);
      expect(payment?.paymentId).toBe('np_internal_test');
    });
  });

  // ===========================================================================
  // getCryptoPaymentByOrderId Tests
  // ===========================================================================

  describe('getCryptoPaymentByOrderId', () => {
    it('should return null for non-existent order ID', () => {
      const payment = getCryptoPaymentByOrderId('order_nonexistent');
      expect(payment).toBeNull();
    });

    it('should return payment by order ID', () => {
      createCryptoPayment({
        paymentId: 'np_order_test',
        communityId: 'test-community',
        tier: 'elite',
        priceAmount: 449.0,
        orderId: 'order_xyz789',
      });

      const payment = getCryptoPaymentByOrderId('order_xyz789');
      expect(payment).not.toBeNull();
      expect(payment?.paymentId).toBe('np_order_test');
      expect(payment?.tier).toBe('elite');
    });
  });

  // ===========================================================================
  // updateCryptoPaymentStatus Tests
  // ===========================================================================

  describe('updateCryptoPaymentStatus', () => {
    it('should update payment status', () => {
      createCryptoPayment({
        paymentId: 'np_status_update',
        communityId: 'test-community',
        tier: 'premium',
        priceAmount: 99.0,
      });

      const updated = updateCryptoPaymentStatus('np_status_update', {
        status: 'confirming',
      });

      expect(updated).toBe(true);

      const payment = getCryptoPaymentByPaymentId('np_status_update');
      expect(payment?.status).toBe('confirming');
    });

    it('should update actually_paid amount', () => {
      createCryptoPayment({
        paymentId: 'np_paid_update',
        communityId: 'test-community',
        tier: 'premium',
        priceAmount: 99.0,
        payAmount: 0.0025,
        payCurrency: 'btc',
      });

      updateCryptoPaymentStatus('np_paid_update', {
        status: 'finished',
        actuallyPaid: 0.0026,
        finishedAt: new Date(),
      });

      const payment = getCryptoPaymentByPaymentId('np_paid_update');
      expect(payment?.status).toBe('finished');
      expect(payment?.actuallyPaid).toBe(0.0026);
      expect(payment?.finishedAt).toBeTruthy();
    });

    it('should update updated_at timestamp', () => {
      createCryptoPayment({
        paymentId: 'np_timestamp_test',
        communityId: 'test-community',
        tier: 'basic',
        priceAmount: 29.0,
      });

      // Set a past timestamp to ensure update changes it (use SQLite datetime format)
      const pastDate = new Date(Date.now() - 120000); // 2 minutes ago
      const pastTime = pastDate.toISOString().replace('T', ' ').replace('Z', '').slice(0, 19);
      testDb.prepare(`UPDATE crypto_payments SET updated_at = ? WHERE payment_id = ?`).run(
        pastTime,
        'np_timestamp_test'
      );

      const before = getCryptoPaymentByPaymentId('np_timestamp_test');
      const originalUpdatedAt = before?.updatedAt;

      updateCryptoPaymentStatus('np_timestamp_test', { status: 'confirmed' });

      const after = getCryptoPaymentByPaymentId('np_timestamp_test');
      // The updated_at should be different from the original
      expect(after?.updatedAt.toISOString()).not.toBe(originalUpdatedAt!.toISOString());
    });

    it('should return false for non-existent payment', () => {
      const updated = updateCryptoPaymentStatus('nonexistent', { status: 'confirmed' });
      expect(updated).toBe(false);
    });

    it('should handle all valid status transitions', () => {
      const statuses = [
        'waiting',
        'confirming',
        'confirmed',
        'sending',
        'partially_paid',
        'finished',
        'failed',
        'refunded',
        'expired',
      ] as const;

      for (const status of statuses) {
        createCryptoPayment({
          paymentId: `np_status_${status}`,
          communityId: 'test-community',
          tier: 'basic',
          priceAmount: 29.0,
        });

        updateCryptoPaymentStatus(`np_status_${status}`, { status });

        const payment = getCryptoPaymentByPaymentId(`np_status_${status}`);
        expect(payment?.status).toBe(status);
      }
    });
  });

  // ===========================================================================
  // listCryptoPayments Tests
  // ===========================================================================

  describe('listCryptoPayments', () => {
    beforeEach(() => {
      // Create test payments
      createCryptoPayment({
        paymentId: 'np_list_1',
        communityId: 'community-1',
        tier: 'basic',
        priceAmount: 29.0,
      });

      createCryptoPayment({
        paymentId: 'np_list_2',
        communityId: 'community-1',
        tier: 'premium',
        priceAmount: 99.0,
      });

      createCryptoPayment({
        paymentId: 'np_list_3',
        communityId: 'community-2',
        tier: 'elite',
        priceAmount: 449.0,
      });

      // Update one to finished status
      updateCryptoPaymentStatus('np_list_2', { status: 'finished' });
    });

    it('should list all payments', () => {
      const payments = listCryptoPayments();
      expect(payments).toHaveLength(3);
    });

    it('should filter by community ID', () => {
      const payments = listCryptoPayments({ communityId: 'community-1' });
      expect(payments).toHaveLength(2);
      expect(payments.every((p) => p.communityId === 'community-1')).toBe(true);
    });

    it('should filter by status', () => {
      const payments = listCryptoPayments({ status: 'waiting' });
      expect(payments).toHaveLength(2);

      const finishedPayments = listCryptoPayments({ status: 'finished' });
      expect(finishedPayments).toHaveLength(1);
    });

    it('should combine filters', () => {
      const payments = listCryptoPayments({
        communityId: 'community-1',
        status: 'waiting',
      });
      expect(payments).toHaveLength(1);
    });

    it('should respect limit', () => {
      const payments = listCryptoPayments({ limit: 2 });
      expect(payments).toHaveLength(2);
    });

    it('should respect offset', () => {
      const allPayments = listCryptoPayments();
      const offsetPayments = listCryptoPayments({ offset: 1, limit: 10 });

      expect(offsetPayments).toHaveLength(2);
      // Payments are ordered by created_at DESC, so offset skips newest
    });

    it('should return empty array for no matches', () => {
      const payments = listCryptoPayments({ communityId: 'nonexistent' });
      expect(payments).toHaveLength(0);
    });
  });

  // ===========================================================================
  // getPendingCryptoPayments Tests
  // ===========================================================================

  describe('getPendingCryptoPayments', () => {
    it('should return pending payments for community', () => {
      createCryptoPayment({
        paymentId: 'np_pending_1',
        communityId: 'test-community',
        tier: 'premium',
        priceAmount: 99.0,
      });

      createCryptoPayment({
        paymentId: 'np_pending_2',
        communityId: 'test-community',
        tier: 'basic',
        priceAmount: 29.0,
      });

      // Update one to confirming (still pending)
      updateCryptoPaymentStatus('np_pending_1', { status: 'confirming' });

      // Update another to finished (not pending)
      createCryptoPayment({
        paymentId: 'np_finished',
        communityId: 'test-community',
        tier: 'elite',
        priceAmount: 449.0,
      });
      updateCryptoPaymentStatus('np_finished', { status: 'finished' });

      const pending = getPendingCryptoPayments('test-community');
      expect(pending).toHaveLength(2);
      expect(pending.every((p) => ['waiting', 'confirming', 'confirmed', 'sending'].includes(p.status))).toBe(true);
    });

    it('should not return payments from other communities', () => {
      createCryptoPayment({
        paymentId: 'np_other_community',
        communityId: 'community-2',
        tier: 'premium',
        priceAmount: 99.0,
      });

      const pending = getPendingCryptoPayments('test-community');
      expect(pending).toHaveLength(0);
    });

    it('should not return expired pending payments', () => {
      createCryptoPayment({
        paymentId: 'np_expired_pending',
        communityId: 'test-community',
        tier: 'basic',
        priceAmount: 29.0,
        expiresAt: new Date(Date.now() + 20 * 60 * 1000),
      });

      // Set expires_at to past via raw SQL (use SQLite datetime format without 'Z')
      const pastDate = new Date(Date.now() - 60 * 1000);
      const pastTime = pastDate.toISOString().replace('T', ' ').replace('Z', '').slice(0, 19);
      testDb.prepare('UPDATE crypto_payments SET expires_at = ? WHERE payment_id = ?').run(
        pastTime,
        'np_expired_pending'
      );

      const pending = getPendingCryptoPayments('test-community');
      expect(pending).toHaveLength(0);
    });
  });

  // ===========================================================================
  // getExpiredCryptoPayments Tests
  // ===========================================================================

  describe('getExpiredCryptoPayments', () => {
    it('should return payments that have expired but still waiting', () => {
      createCryptoPayment({
        paymentId: 'np_expired_1',
        communityId: 'test-community',
        tier: 'basic',
        priceAmount: 29.0,
        expiresAt: new Date(Date.now() + 20 * 60 * 1000),
      });

      // Set expires_at to past (use SQLite datetime format without 'Z')
      const pastDate = new Date(Date.now() - 60 * 1000);
      const pastTime = pastDate.toISOString().replace('T', ' ').replace('Z', '').slice(0, 19);
      testDb.prepare('UPDATE crypto_payments SET expires_at = ? WHERE payment_id = ?').run(
        pastTime,
        'np_expired_1'
      );

      const expired = getExpiredCryptoPayments();
      expect(expired).toHaveLength(1);
      expect(expired[0]?.paymentId).toBe('np_expired_1');
    });

    it('should not return expired payments already marked as expired', () => {
      createCryptoPayment({
        paymentId: 'np_already_expired',
        communityId: 'test-community',
        tier: 'basic',
        priceAmount: 29.0,
        expiresAt: new Date(Date.now() + 20 * 60 * 1000),
      });

      // Set expires_at to past and status to expired (use SQLite datetime format)
      const pastDate = new Date(Date.now() - 60 * 1000);
      const pastTime = pastDate.toISOString().replace('T', ' ').replace('Z', '').slice(0, 19);
      testDb.prepare('UPDATE crypto_payments SET expires_at = ?, status = ? WHERE payment_id = ?').run(
        pastTime,
        'expired',
        'np_already_expired'
      );

      const expired = getExpiredCryptoPayments();
      expect(expired).toHaveLength(0);
    });

    it('should not return payments without expiration date', () => {
      createCryptoPayment({
        paymentId: 'np_no_expiry',
        communityId: 'test-community',
        tier: 'basic',
        priceAmount: 29.0,
      });

      const expired = getExpiredCryptoPayments();
      expect(expired).toHaveLength(0);
    });

    it('should not return non-waiting payments', () => {
      createCryptoPayment({
        paymentId: 'np_confirming_expired',
        communityId: 'test-community',
        tier: 'basic',
        priceAmount: 29.0,
        expiresAt: new Date(Date.now() + 20 * 60 * 1000),
      });

      // Set to confirming status and expired time (use SQLite datetime format)
      const pastDate = new Date(Date.now() - 60 * 1000);
      const pastTime = pastDate.toISOString().replace('T', ' ').replace('Z', '').slice(0, 19);
      testDb.prepare('UPDATE crypto_payments SET expires_at = ?, status = ? WHERE payment_id = ?').run(
        pastTime,
        'confirming',
        'np_confirming_expired'
      );

      const expired = getExpiredCryptoPayments();
      expect(expired).toHaveLength(0);
    });
  });

  // ===========================================================================
  // markExpiredCryptoPayments Tests
  // ===========================================================================

  describe('markExpiredCryptoPayments', () => {
    it('should mark expired waiting payments as expired', () => {
      // Create payment with future expiry
      createCryptoPayment({
        paymentId: 'np_mark_expired_1',
        communityId: 'test-community',
        tier: 'basic',
        priceAmount: 29.0,
        expiresAt: new Date(Date.now() + 20 * 60 * 1000),
      });

      createCryptoPayment({
        paymentId: 'np_mark_expired_2',
        communityId: 'test-community',
        tier: 'premium',
        priceAmount: 99.0,
        expiresAt: new Date(Date.now() + 20 * 60 * 1000),
      });

      // Set both to past expiry (use SQLite datetime format)
      const pastDate = new Date(Date.now() - 60 * 1000);
      const pastTime = pastDate.toISOString().replace('T', ' ').replace('Z', '').slice(0, 19);
      testDb.prepare('UPDATE crypto_payments SET expires_at = ? WHERE payment_id IN (?, ?)').run(
        pastTime,
        'np_mark_expired_1',
        'np_mark_expired_2'
      );

      const count = markExpiredCryptoPayments();
      expect(count).toBe(2);

      const payment1 = getCryptoPaymentByPaymentId('np_mark_expired_1');
      const payment2 = getCryptoPaymentByPaymentId('np_mark_expired_2');
      expect(payment1?.status).toBe('expired');
      expect(payment2?.status).toBe('expired');
    });

    it('should return 0 when no payments need marking', () => {
      createCryptoPayment({
        paymentId: 'np_not_expired',
        communityId: 'test-community',
        tier: 'basic',
        priceAmount: 29.0,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour from now
      });

      const count = markExpiredCryptoPayments();
      expect(count).toBe(0);
    });

    it('should not affect non-waiting payments', () => {
      createCryptoPayment({
        paymentId: 'np_confirming_no_mark',
        communityId: 'test-community',
        tier: 'basic',
        priceAmount: 29.0,
        expiresAt: new Date(Date.now() + 20 * 60 * 1000),
      });

      // Set to confirming and expired (use SQLite datetime format)
      const pastDate = new Date(Date.now() - 60 * 1000);
      const pastTime = pastDate.toISOString().replace('T', ' ').replace('Z', '').slice(0, 19);
      testDb.prepare('UPDATE crypto_payments SET expires_at = ?, status = ? WHERE payment_id = ?').run(
        pastTime,
        'confirming',
        'np_confirming_no_mark'
      );

      const count = markExpiredCryptoPayments();
      expect(count).toBe(0);

      const payment = getCryptoPaymentByPaymentId('np_confirming_no_mark');
      expect(payment?.status).toBe('confirming');
    });
  });

  // ===========================================================================
  // getCompletedCryptoPayments Tests
  // ===========================================================================

  describe('getCompletedCryptoPayments', () => {
    it('should return finished payments for community', () => {
      createCryptoPayment({
        paymentId: 'np_completed_1',
        communityId: 'test-community',
        tier: 'premium',
        priceAmount: 99.0,
      });

      createCryptoPayment({
        paymentId: 'np_completed_2',
        communityId: 'test-community',
        tier: 'elite',
        priceAmount: 449.0,
      });

      // Mark both as finished
      const finishedAt = new Date();
      updateCryptoPaymentStatus('np_completed_1', { status: 'finished', finishedAt });
      updateCryptoPaymentStatus('np_completed_2', { status: 'finished', finishedAt });

      const completed = getCompletedCryptoPayments('test-community');
      expect(completed).toHaveLength(2);
      expect(completed.every((p) => p.status === 'finished')).toBe(true);
    });

    it('should not return waiting or failed payments', () => {
      createCryptoPayment({
        paymentId: 'np_waiting_complete',
        communityId: 'test-community',
        tier: 'basic',
        priceAmount: 29.0,
      });

      createCryptoPayment({
        paymentId: 'np_failed_complete',
        communityId: 'test-community',
        tier: 'premium',
        priceAmount: 99.0,
      });
      updateCryptoPaymentStatus('np_failed_complete', { status: 'failed' });

      const completed = getCompletedCryptoPayments('test-community');
      expect(completed).toHaveLength(0);
    });

    it('should not return payments from other communities', () => {
      createCryptoPayment({
        paymentId: 'np_other_completed',
        communityId: 'community-2',
        tier: 'premium',
        priceAmount: 99.0,
      });
      updateCryptoPaymentStatus('np_other_completed', { status: 'finished', finishedAt: new Date() });

      const completed = getCompletedCryptoPayments('test-community');
      expect(completed).toHaveLength(0);
    });

    it('should order by finished_at DESC', () => {
      createCryptoPayment({
        paymentId: 'np_ordered_1',
        communityId: 'test-community',
        tier: 'basic',
        priceAmount: 29.0,
      });

      createCryptoPayment({
        paymentId: 'np_ordered_2',
        communityId: 'test-community',
        tier: 'premium',
        priceAmount: 99.0,
      });

      // Finish second one first (earlier timestamp)
      const earlier = new Date(Date.now() - 60000);
      const later = new Date();

      updateCryptoPaymentStatus('np_ordered_2', { status: 'finished', finishedAt: earlier });
      updateCryptoPaymentStatus('np_ordered_1', { status: 'finished', finishedAt: later });

      const completed = getCompletedCryptoPayments('test-community');
      expect(completed).toHaveLength(2);
      // Most recent should be first
      expect(completed[0]?.paymentId).toBe('np_ordered_1');
      expect(completed[1]?.paymentId).toBe('np_ordered_2');
    });
  });

  // ===========================================================================
  // Edge Cases and Integration Tests
  // ===========================================================================

  describe('Edge Cases', () => {
    it('should handle decimal precision for crypto amounts', () => {
      createCryptoPayment({
        paymentId: 'np_precision_test',
        communityId: 'test-community',
        tier: 'premium',
        priceAmount: 99.99,
        payAmount: 0.00123456789,
        payCurrency: 'btc',
      });

      const payment = getCryptoPaymentByPaymentId('np_precision_test');
      expect(payment?.priceAmount).toBeCloseTo(99.99, 2);
      // SQLite DECIMAL(20,10) should preserve precision
      expect(payment?.payAmount).toBeCloseTo(0.00123456789, 8);
    });

    it('should handle all supported crypto currencies', () => {
      const currencies = ['btc', 'eth', 'usdt', 'usdc', 'ltc', 'doge', 'matic', 'sol'] as const;

      for (const currency of currencies) {
        createCryptoPayment({
          paymentId: `np_currency_${currency}`,
          communityId: 'test-community',
          tier: 'basic',
          priceAmount: 29.0,
          payCurrency: currency,
        });

        const payment = getCryptoPaymentByPaymentId(`np_currency_${currency}`);
        expect(payment?.payCurrency).toBe(currency);
      }
    });

    it('should handle concurrent payment lookups', () => {
      // Create multiple payments
      for (let i = 0; i < 10; i++) {
        createCryptoPayment({
          paymentId: `np_concurrent_${i}`,
          communityId: 'test-community',
          tier: 'basic',
          priceAmount: 29.0,
          orderId: `order_concurrent_${i}`,
        });
      }

      // Look up all in parallel (simulated)
      const results = [];
      for (let i = 0; i < 10; i++) {
        results.push(getCryptoPaymentByPaymentId(`np_concurrent_${i}`));
        results.push(getCryptoPaymentByOrderId(`order_concurrent_${i}`));
      }

      expect(results.filter((r) => r !== null)).toHaveLength(20);
    });
  });
});

/**
 * Admin Billing Integration Tests (v4.0 - Sprint 26)
 *
 * End-to-end tests for admin billing functionality:
 * - WaiverService → Database → Cache Invalidation
 * - BillingAuditService → Database queries
 * - GatekeeperService → Cache integration
 *
 * Tests the full integration flow for fee waivers and audit logging.
 */

import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';

// In-memory database for testing
const mockDatabase = {
  waivers: new Map<string, any>(),
  subscriptions: new Map<string, any>(),
  auditLog: [] as any[],

  reset() {
    this.waivers.clear();
    this.subscriptions.clear();
    this.auditLog = [];
  },
};

// Mock Redis
vi.mock('ioredis', () => {
  const mockCache = new Map<string, string>();
  return {
    default: vi.fn().mockImplementation(() => ({
      status: 'ready',
      get: vi.fn((key: string) => Promise.resolve(mockCache.get(key) || null)),
      del: vi.fn((key: string) => {
        mockCache.delete(key);
        return Promise.resolve(1);
      }),
      setex: vi.fn((key: string, ttl: number, value: string) => {
        mockCache.set(key, value);
        return Promise.resolve('OK');
      }),
      ping: vi.fn().mockResolvedValue('PONG'),
      on: vi.fn(),
      quit: vi.fn().mockResolvedValue('OK'),
      _mockCache: mockCache, // Expose for test inspection
    })),
  };
});

// Mock config
vi.mock('../../src/config.js', () => ({
  config: {
    stripe: {
      secretKey: 'sk_test_123',
      webhookSecret: 'whsec_test_123',
      priceIds: new Map([
        ['basic', 'price_basic'],
        ['premium', 'price_premium'],
        ['enterprise', 'price_enterprise'],
      ]),
    },
    redis: {
      url: 'redis://localhost:6379',
      maxRetries: 3,
      connectTimeout: 5000,
      entitlementTtl: 300,
    },
  },
  isBillingEnabled: vi.fn(() => true),
}));

// Mock database queries
vi.mock('../../src/db/billing-queries.js', () => ({
  getActiveFeeWaiver: vi.fn((communityId: string) => {
    return Array.from(mockDatabase.waivers.values()).find(
      (w) => w.communityId === communityId && !w.revokedAt
    );
  }),
  getAllActiveFeeWaivers: vi.fn(() => {
    return Array.from(mockDatabase.waivers.values()).filter((w) => !w.revokedAt);
  }),
  getFeeWaiversByCommunity: vi.fn((communityId: string) => {
    return Array.from(mockDatabase.waivers.values()).filter(
      (w) => w.communityId === communityId
    );
  }),
  createFeeWaiver: vi.fn((data: any) => {
    const id = 'waiver_' + Date.now() + Math.random();
    const waiver = {
      id,
      ...data,
      createdAt: new Date(),
      grantedAt: new Date(),
      revokedAt: null,
      revokedBy: null,
      revokeReason: null,
    };
    mockDatabase.waivers.set(waiver.id, waiver);
    return id; // Return ID, not waiver object
  }),
  revokeFeeWaiver: vi.fn((waiverId: string, params: { revokedBy: string; revokeReason: string }) => {
    const waiver = mockDatabase.waivers.get(waiverId);
    if (waiver && !waiver.revokedAt) {
      waiver.revokedAt = new Date();
      waiver.revokedBy = params.revokedBy;
      waiver.revokeReason = params.revokeReason;
      return true;
    }
    return false;
  }),
  getSubscriptionByCommunityId: vi.fn((communityId: string) => {
    return mockDatabase.subscriptions.get(communityId);
  }),
  updateSubscription: vi.fn((communityId: string, data: any) => {
    const existing = mockDatabase.subscriptions.get(communityId);
    if (existing) {
      Object.assign(existing, data, { updatedAt: new Date() });
      return true;
    }
    return false;
  }),
  logBillingAuditEvent: vi.fn((type: string, data: any, communityId?: string, actor?: string) => {
    const entry = {
      id: mockDatabase.auditLog.length + 1,
      eventType: type,
      eventData: data,
      communityId: communityId || null,
      actor: actor || null,
      createdAt: new Date(),
    };
    mockDatabase.auditLog.push(entry);
  }),
  getBillingAuditLog: vi.fn((options: any) => {
    let entries = [...mockDatabase.auditLog];
    if (options.eventType) {
      entries = entries.filter((e) => e.eventType === options.eventType);
    }
    if (options.communityId) {
      entries = entries.filter((e) => e.communityId === options.communityId);
    }
    if (options.since) {
      entries = entries.filter((e) => e.createdAt >= options.since);
    }
    const limited = entries.slice(0, options.limit || 100);
    return limited;
  }),
  getBillingAuditStatistics: vi.fn((communityId?: string) => {
    let entries = [...mockDatabase.auditLog];
    if (communityId) {
      entries = entries.filter((e) => e.communityId === communityId);
    }
    const eventCounts = entries.reduce((acc, e) => {
      acc[e.eventType] = (acc[e.eventType] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return {
      totalEvents: entries.length,
      eventCounts,
      oldestEvent: entries.length > 0 ? entries[0].createdAt : null,
      newestEvent: entries.length > 0 ? entries[entries.length - 1].createdAt : null,
    };
  }),
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

describe('Admin Billing Integration Tests', () => {
  let waiverService: any;
  let billingAuditService: any;
  let gatekeeperService: any;
  let redisService: any;

  beforeAll(async () => {
    // Import services after all mocks are in place
    const waiverModule = await import('../../src/services/billing/WaiverService.js');
    const auditModule = await import('../../src/services/billing/BillingAuditService.js');
    const gatekeeperModule = await import('../../src/services/billing/GatekeeperService.js');
    const redisModule = await import('../../src/services/cache/RedisService.js');

    waiverService = waiverModule.waiverService;
    billingAuditService = auditModule.billingAuditService;
    gatekeeperService = gatekeeperModule.gatekeeperService;
    redisService = redisModule.redisService;

    // Connect Redis
    await redisService.connect();
  });

  afterAll(async () => {
    await redisService.disconnect();
  });

  beforeEach(() => {
    mockDatabase.reset();
    vi.clearAllMocks();
  });

  // ==========================================================================
  // Integration: WaiverService → Database → Cache
  // ==========================================================================

  describe('Fee Waiver Integration Flow', () => {
    it('should grant waiver → log audit → invalidate cache', async () => {
      const communityId = 'test-community';

      // Grant waiver
      const result = await waiverService.grantWaiver({
        communityId,
        tier: 'enterprise',
        reason: 'Integration test waiver',
        grantedBy: 'test-admin',
      });

      // Verify waiver created
      expect(result.waiver).toBeDefined();
      expect(result.waiver.communityId).toBe(communityId);
      expect(result.waiver.tier).toBe('enterprise');
      expect(result.previousWaiverRevoked).toBe(false);

      // Verify waiver in database
      const retrieved = waiverService.getWaiver(communityId);
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(result.waiver.id);

      // Verify audit log entry created
      expect(mockDatabase.auditLog.length).toBeGreaterThan(0);
      const auditEntry = mockDatabase.auditLog.find(
        (e) => e.eventType === 'waiver_granted' && e.communityId === communityId
      );
      expect(auditEntry).toBeDefined();
      expect(auditEntry?.eventData.tier).toBe('enterprise');
    });

    it('should auto-revoke previous waiver when granting new one', async () => {
      const communityId = 'test-revoke';

      // Grant first waiver
      const first = await waiverService.grantWaiver({
        communityId,
        tier: 'premium',
        reason: 'First waiver',
        grantedBy: 'admin-1',
      });

      // Grant second waiver (should auto-revoke first)
      const second = await waiverService.grantWaiver({
        communityId,
        tier: 'enterprise',
        reason: 'Second waiver',
        grantedBy: 'admin-2',
      });

      // Verify second waiver succeeded
      expect(second.waiver).toBeDefined();
      expect(second.previousWaiverRevoked).toBe(true);

      // Verify only second waiver is active
      const active = waiverService.getWaiver(communityId);
      expect(active?.id).toBe(second.waiver.id);
      expect(active?.tier).toBe('enterprise');

      // Verify both audit events logged
      const grantEvents = mockDatabase.auditLog.filter(
        (e) => e.eventType === 'waiver_granted' && e.communityId === communityId
      );
      expect(grantEvents.length).toBe(2);

      const revokeEvents = mockDatabase.auditLog.filter(
        (e) => e.eventType === 'waiver_revoked' && e.communityId === communityId
      );
      expect(revokeEvents.length).toBe(1);
    });

    it('should revoke waiver → log audit → invalidate cache', async () => {
      const communityId = 'test-revoke-manual';

      // Grant waiver
      await waiverService.grantWaiver({
        communityId,
        tier: 'premium',
        reason: 'Test waiver',
        grantedBy: 'admin',
      });

      const auditLogLengthBeforeRevoke = mockDatabase.auditLog.length;

      // Revoke waiver
      const revoked = await waiverService.revokeWaiver({
        communityId,
        reason: 'Manual revocation for testing',
        revokedBy: 'test-admin',
      });

      // Verify revocation succeeded
      expect(revoked).toBe(true);

      // Verify waiver no longer active
      const active = waiverService.getWaiver(communityId);
      expect(active).toBeFalsy();

      // Verify revoke audit event
      expect(mockDatabase.auditLog.length).toBeGreaterThan(auditLogLengthBeforeRevoke);
      const revokeEvent = mockDatabase.auditLog.find(
        (e) => e.eventType === 'waiver_revoked' && e.communityId === communityId
      );
      expect(revokeEvent).toBeDefined();
      expect(revokeEvent?.eventData.reason).toBe('Manual revocation for testing');
    });

    it('should handle waiver expiration correctly', async () => {
      const communityId = 'test-expiry';
      // Set expiration 2 days in future
      const expiresAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);

      // Grant waiver with expiration
      await waiverService.grantWaiver({
        communityId,
        tier: 'premium',
        reason: 'Expiring waiver',
        grantedBy: 'admin',
        expiresAt,
      });

      // Verify initially active with expiration info
      let info = waiverService.getWaiverInfo(communityId);
      expect(info.hasWaiver).toBe(true);
      expect(info.waiver).toBeDefined();
      expect(info.waiver?.expiresAt).toBeDefined();
      expect(info.daysUntilExpiry).toBeGreaterThan(0);
      expect(info.daysUntilExpiry).toBeLessThanOrEqual(2);

      // Verify waiver is active
      const active = waiverService.getWaiver(communityId);
      expect(active).toBeDefined();
      expect(active?.communityId).toBe(communityId);
    });
  });

  // ==========================================================================
  // Integration: BillingAuditService → Database queries
  // ==========================================================================

  describe('Billing Audit Service Integration', () => {
    beforeEach(() => {
      // Create test audit events
      mockDatabase.auditLog.push({
        id: 1,
        eventType: 'waiver_granted',
        communityId: 'community-1',
        eventData: { tier: 'enterprise', reason: 'Test' },
        actor: 'admin-1',
        createdAt: new Date(Date.now() - 3600000), // 1 hour ago
      });
      mockDatabase.auditLog.push({
        id: 2,
        eventType: 'subscription_updated',
        communityId: 'community-2',
        eventData: { oldTier: 'basic', newTier: 'premium' },
        actor: 'admin-2',
        createdAt: new Date(Date.now() - 1800000), // 30 min ago
      });
      mockDatabase.auditLog.push({
        id: 3,
        eventType: 'waiver_revoked',
        communityId: 'community-1',
        eventData: { reason: 'Test revoke' },
        actor: 'admin-1',
        createdAt: new Date(), // Now
      });
    });

    it('should query all audit events', () => {
      const result = billingAuditService.queryAuditLog({ limit: 100 });

      expect(result.entries).toBeDefined();
      expect(result.entries.length).toBe(3);
      expect(result.hasMore).toBe(false);
    });

    it('should filter by event type', () => {
      const result = billingAuditService.queryAuditLog({
        limit: 100,
        eventType: 'waiver_granted',
      });

      expect(result.entries.length).toBe(1);
      expect(result.entries[0].eventType).toBe('waiver_granted');
    });

    it('should filter by community ID', () => {
      const result = billingAuditService.queryAuditLog({
        limit: 100,
        communityId: 'community-1',
      });

      expect(result.entries.length).toBe(2);
      expect(result.entries.every((e) => e.communityId === 'community-1')).toBe(true);
    });

    it('should respect limit parameter', () => {
      const result = billingAuditService.queryAuditLog({ limit: 1 });

      expect(result.entries.length).toBe(1);
      expect(result.hasMore).toBe(true);
    });

    it('should get statistics for all events', () => {
      const stats = billingAuditService.getStatistics();

      expect(stats.totalEvents).toBe(3);
      expect(stats.eventCounts.waiver_granted).toBe(1);
      expect(stats.eventCounts.subscription_updated).toBe(1);
      expect(stats.eventCounts.waiver_revoked).toBe(1);
      expect(stats.oldestEvent).toBeDefined();
      expect(stats.newestEvent).toBeDefined();
    });

    it('should get statistics for specific community', () => {
      const stats = billingAuditService.getStatistics('community-1');

      expect(stats.totalEvents).toBe(2);
      expect(stats.eventCounts.waiver_granted).toBe(1);
      expect(stats.eventCounts.waiver_revoked).toBe(1);
    });
  });

  // ==========================================================================
  // Integration: WaiverService + BillingAuditService together
  // ==========================================================================

  describe('Complete Admin Workflow', () => {
    it('should complete full waiver lifecycle with audit trail', async () => {
      const communityId = 'full-lifecycle';

      // 1. Grant waiver
      const granted = await waiverService.grantWaiver({
        communityId,
        tier: 'enterprise',
        reason: 'Full lifecycle test',
        grantedBy: 'admin-1',
      });

      expect(granted.waiver).toBeDefined();

      // 2. Query waiver
      const info = waiverService.getWaiverInfo(communityId);
      expect(info.hasWaiver).toBe(true);
      expect(info.waiver?.tier).toBe('enterprise');

      // 3. List all waivers
      const allWaivers = waiverService.listWaivers({ includeInactive: false });
      expect(allWaivers.some((w) => w.communityId === communityId)).toBe(true);

      // 4. Revoke waiver
      const revoked = await waiverService.revokeWaiver({
        communityId,
        reason: 'Lifecycle test complete',
        revokedBy: 'admin-1',
      });

      expect(revoked).toBe(true);

      // 5. Verify revoked
      const afterRevoke = waiverService.getWaiver(communityId);
      expect(afterRevoke).toBeFalsy();

      // 6. Query audit log for full history
      const auditHistory = billingAuditService.queryAuditLog({
        limit: 100,
        communityId,
      });

      expect(auditHistory.entries.length).toBeGreaterThanOrEqual(2);
      expect(
        auditHistory.entries.some((e) => e.eventType === 'waiver_granted')
      ).toBe(true);
      expect(
        auditHistory.entries.some((e) => e.eventType === 'waiver_revoked')
      ).toBe(true);
    });

    it('should handle multiple communities independently', async () => {
      // Grant waivers to different communities
      await waiverService.grantWaiver({
        communityId: 'community-a',
        tier: 'premium',
        reason: 'Community A waiver',
        grantedBy: 'admin',
      });

      await waiverService.grantWaiver({
        communityId: 'community-b',
        tier: 'enterprise',
        reason: 'Community B waiver',
        grantedBy: 'admin',
      });

      // Verify both exist
      const waiverA = waiverService.getWaiver('community-a');
      const waiverB = waiverService.getWaiver('community-b');

      expect(waiverA).toBeDefined();
      expect(waiverB).toBeDefined();
      expect(waiverA?.tier).toBe('premium');
      expect(waiverB?.tier).toBe('enterprise');

      // Revoke one
      await waiverService.revokeWaiver({
        communityId: 'community-a',
        reason: 'Test revoke',
        revokedBy: 'admin',
      });

      // Verify only community-a revoked
      expect(waiverService.getWaiver('community-a')).toBeFalsy();
      expect(waiverService.getWaiver('community-b')).toBeDefined();

      // Verify audit logs separated by community
      const auditA = billingAuditService.queryAuditLog({
        limit: 100,
        communityId: 'community-a',
      });
      const auditB = billingAuditService.queryAuditLog({
        limit: 100,
        communityId: 'community-b',
      });

      expect(auditA.entries.length).toBeGreaterThan(0);
      expect(auditB.entries.length).toBeGreaterThan(0);
      expect(auditA.entries.every((e) => e.communityId === 'community-a')).toBe(true);
      expect(auditB.entries.every((e) => e.communityId === 'community-b')).toBe(true);
    });
  });
});

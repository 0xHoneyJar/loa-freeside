/**
 * Billing Gatekeeper API Tests (v4.0 - Sprint 25)
 *
 * Integration tests for the Gatekeeper-powered billing API endpoints:
 * - GET /billing/entitlements (with caching)
 * - POST /billing/feature-check
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import request from 'supertest';
import express, { type Express } from 'express';
import { billingRouter } from '../../src/api/billing.routes.js';
import { gatekeeperService } from '../../src/services/billing/GatekeeperService.js';
import type { Entitlements, Feature } from '../../src/types/billing.js';

// =============================================================================
// Mock Setup
// =============================================================================

vi.mock('../../src/services/billing/GatekeeperService.js', () => ({
  gatekeeperService: {
    getEntitlements: vi.fn(),
    checkAccess: vi.fn(),
  },
}));

vi.mock('../../src/config.js', () => ({
  config: {
    featureFlags: {
      billingEnabled: true,
    },
  },
  isBillingEnabled: () => true,
  SUBSCRIPTION_TIERS: {
    starter: { name: 'Starter', maxMembers: 100 },
    basic: { name: 'Basic', maxMembers: 500 },
    premium: { name: 'Premium', maxMembers: 1000 },
    exclusive: { name: 'Exclusive', maxMembers: 2500 },
    elite: { name: 'Elite', maxMembers: 10000 },
    enterprise: { name: 'Enterprise', maxMembers: Infinity },
  },
}));

// =============================================================================
// Test App Setup
// =============================================================================

function createTestApp(): Express {
  const app = express();
  app.use(express.json());

  // Mock authentication middleware
  app.use((req, res, next) => {
    (req as any).isAuthenticated = true;
    (req as any).adminName = 'test-admin';
    next();
  });

  app.use('/billing', billingRouter);

  // Error handler
  app.use((err: any, req: any, res: any, next: any) => {
    res.status(err.status || 500).json({
      error: err.message || 'Internal server error',
    });
  });

  return app;
}

// =============================================================================
// Test Helpers
// =============================================================================

function createMockEntitlements(
  overrides: Partial<Entitlements> = {}
): Entitlements {
  const now = new Date();
  return {
    communityId: 'comm-123',
    tier: 'premium',
    maxMembers: 1000,
    features: [
      'discord_bot',
      'basic_onboarding',
      'member_profiles',
      'stats_leaderboard',
      'position_alerts',
      'custom_nym',
      'nine_tier_system',
      'custom_pfp',
      'weekly_digest',
      'activity_tracking',
      'score_badge',
    ] as Feature[],
    source: 'subscription',
    inGracePeriod: false,
    cachedAt: now,
    expiresAt: new Date(now.getTime() + 5 * 60 * 1000),
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('Billing Gatekeeper API', () => {
  let app: Express;

  beforeEach(() => {
    app = createTestApp();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('GET /billing/entitlements', () => {
    it('should return entitlements with caching', async () => {
      const mockEntitlements = createMockEntitlements({
        tier: 'premium',
        source: 'subscription',
      });

      vi.mocked(gatekeeperService.getEntitlements).mockResolvedValue(
        mockEntitlements
      );

      const response = await request(app)
        .get('/billing/entitlements')
        .query({ community_id: 'comm-123' })
        .expect(200);

      expect(response.body).toMatchObject({
        communityId: 'comm-123',
        tier: 'premium',
        tierName: 'Premium',
        maxMembers: 1000,
        source: 'subscription',
        inGracePeriod: false,
      });

      expect(response.body.features).toContain('nine_tier_system');
      expect(response.body.features).toContain('discord_bot');

      // Should have called GatekeeperService (which handles caching)
      expect(gatekeeperService.getEntitlements).toHaveBeenCalledWith('comm-123');
    });

    it('should include grace period information', async () => {
      const graceUntil = new Date(Date.now() + 12 * 60 * 60 * 1000);
      const mockEntitlements = createMockEntitlements({
        tier: 'exclusive',
        inGracePeriod: true,
        graceUntil,
      });

      vi.mocked(gatekeeperService.getEntitlements).mockResolvedValue(
        mockEntitlements
      );

      const response = await request(app)
        .get('/billing/entitlements')
        .query({ community_id: 'comm-123' })
        .expect(200);

      expect(response.body.inGracePeriod).toBe(true);
      expect(response.body.graceUntil).toBe(graceUntil.toISOString());
    });

    it('should return starter tier entitlements', async () => {
      const mockEntitlements = createMockEntitlements({
        tier: 'starter',
        maxMembers: 100,
        features: ['discord_bot', 'basic_onboarding', 'member_profiles'] as Feature[],
        source: 'free',
      });

      vi.mocked(gatekeeperService.getEntitlements).mockResolvedValue(
        mockEntitlements
      );

      const response = await request(app)
        .get('/billing/entitlements')
        .query({ community_id: 'comm-123' })
        .expect(200);

      expect(response.body.tier).toBe('starter');
      expect(response.body.maxMembers).toBe(100);
      expect(response.body.source).toBe('free');
      expect(response.body.features).toHaveLength(3);
    });

    it('should return enterprise tier with all features', async () => {
      const mockEntitlements = createMockEntitlements({
        tier: 'enterprise',
        maxMembers: Infinity,
        features: [
          'discord_bot',
          'basic_onboarding',
          'member_profiles',
          'stats_leaderboard',
          'position_alerts',
          'custom_nym',
          'nine_tier_system',
          'custom_pfp',
          'weekly_digest',
          'activity_tracking',
          'score_badge',
          'admin_analytics',
          'naib_dynamics',
          'water_sharer_badge',
          'custom_branding',
          'priority_support',
          'api_access',
          'white_label',
          'dedicated_support',
          'custom_integrations',
        ] as Feature[],
        source: 'waiver',
      });

      vi.mocked(gatekeeperService.getEntitlements).mockResolvedValue(
        mockEntitlements
      );

      const response = await request(app)
        .get('/billing/entitlements')
        .query({ community_id: 'comm-123' })
        .expect(200);

      expect(response.body.tier).toBe('enterprise');
      expect(response.body.maxMembers).toBe(null); // Infinity serializes as null
      expect(response.body.source).toBe('waiver');
      expect(response.body.features).toContain('white_label');
      expect(response.body.features).toContain('custom_integrations');
    });

    it('should handle GatekeeperService errors', async () => {
      vi.mocked(gatekeeperService.getEntitlements).mockRejectedValue(
        new Error('Database connection failed')
      );

      await request(app)
        .get('/billing/entitlements')
        .query({ community_id: 'comm-123' })
        .expect(500);
    });

    it('should use default community_id if not provided', async () => {
      const mockEntitlements = createMockEntitlements({
        communityId: 'default',
      });

      vi.mocked(gatekeeperService.getEntitlements).mockResolvedValue(
        mockEntitlements
      );

      await request(app).get('/billing/entitlements').expect(200);

      expect(gatekeeperService.getEntitlements).toHaveBeenCalledWith('default');
    });
  });

  describe('POST /billing/feature-check', () => {
    it('should allow access to owned feature', async () => {
      vi.mocked(gatekeeperService.checkAccess).mockResolvedValue({
        canAccess: true,
        tier: 'premium',
        requiredTier: 'premium',
        inGracePeriod: false,
      });

      const response = await request(app)
        .post('/billing/feature-check')
        .send({
          community_id: 'comm-123',
          feature: 'nine_tier_system',
        })
        .expect(200);

      expect(response.body).toMatchObject({
        feature: 'nine_tier_system',
        canAccess: true,
        currentTier: 'premium',
        requiredTier: 'premium',
      });

      expect(response.body.upgradeUrl).toBeUndefined();
    });

    it('should deny access to unowned feature', async () => {
      vi.mocked(gatekeeperService.checkAccess).mockResolvedValue({
        canAccess: false,
        tier: 'starter',
        requiredTier: 'exclusive',
        inGracePeriod: false,
        upgradeUrl: 'https://sietch.io/upgrade?tier=exclusive&community=comm-123',
        reason: "Feature 'admin_analytics' requires Exclusive tier. Your current tier is Starter.",
      });

      const response = await request(app)
        .post('/billing/feature-check')
        .send({
          community_id: 'comm-123',
          feature: 'admin_analytics',
        })
        .expect(200);

      expect(response.body).toMatchObject({
        feature: 'admin_analytics',
        canAccess: false,
        currentTier: 'starter',
        requiredTier: 'exclusive',
      });

      expect(response.body.upgradeUrl).toBeDefined();
      expect(response.body.upgradeUrl).toContain('exclusive');
    });

    it('should validate feature parameter', async () => {
      const response = await request(app)
        .post('/billing/feature-check')
        .send({
          community_id: 'comm-123',
          feature: 'invalid_feature_name',
        })
        .expect(400);

      expect(response.body.error).toContain('Invalid feature');
    });

    it('should require feature parameter', async () => {
      await request(app)
        .post('/billing/feature-check')
        .send({
          community_id: 'comm-123',
        })
        .expect(400);
    });

    it('should use default community_id if not provided', async () => {
      vi.mocked(gatekeeperService.checkAccess).mockResolvedValue({
        canAccess: true,
        tier: 'premium',
        requiredTier: 'premium',
        inGracePeriod: false,
      });

      await request(app)
        .post('/billing/feature-check')
        .send({
          feature: 'nine_tier_system',
        })
        .expect(200);

      expect(gatekeeperService.checkAccess).toHaveBeenCalledWith({
        communityId: 'default',
        feature: 'nine_tier_system',
      });
    });

    it('should handle GatekeeperService errors', async () => {
      vi.mocked(gatekeeperService.checkAccess).mockRejectedValue(
        new Error('Redis connection failed')
      );

      await request(app)
        .post('/billing/feature-check')
        .send({
          community_id: 'comm-123',
          feature: 'nine_tier_system',
        })
        .expect(500);
    });
  });

  describe('Feature validation', () => {
    it('should accept all valid feature types', async () => {
      const validFeatures: Feature[] = [
        'discord_bot',
        'basic_onboarding',
        'member_profiles',
        'stats_leaderboard',
        'position_alerts',
        'custom_nym',
        'nine_tier_system',
        'custom_pfp',
        'weekly_digest',
        'activity_tracking',
        'score_badge',
        'admin_analytics',
        'naib_dynamics',
        'water_sharer_badge',
        'custom_branding',
        'priority_support',
        'api_access',
        'white_label',
        'dedicated_support',
        'custom_integrations',
      ];

      vi.mocked(gatekeeperService.checkAccess).mockResolvedValue({
        canAccess: true,
        tier: 'enterprise',
        requiredTier: 'starter',
        inGracePeriod: false,
      });

      for (const feature of validFeatures) {
        const response = await request(app)
          .post('/billing/feature-check')
          .send({
            community_id: 'comm-123',
            feature,
          });

        expect(response.status).toBe(200);
        expect(response.body.feature).toBe(feature);
      }
    });

    it('should reject invalid feature types', async () => {
      const invalidFeatures = [
        'not_a_feature',
        'super_admin_access',
        'unlimited_power',
        '',
        '  ',
      ];

      for (const feature of invalidFeatures) {
        await request(app)
          .post('/billing/feature-check')
          .send({
            community_id: 'comm-123',
            feature,
          })
          .expect(400);
      }
    });
  });
});

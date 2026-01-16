/**
 * WizardEngine Tests
 *
 * Sprint S-23: WizardEngine Implementation
 *
 * Comprehensive tests for:
 * - Session lifecycle management
 * - Step execution and transitions
 * - Manifest generation and validation
 * - Deployment orchestration
 * - Analytics tracking
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WizardEngine } from '../engine.js';
import { createNoOpWizardMetrics } from '../metrics.js';
import { createAllStepHandlers } from '../steps/index.js';
import {
  WizardState,
  type WizardSession,
  type CommunityManifest,
} from '@arrakis/core/domain';
import type {
  IWizardSessionStore,
  ISynthesisEngine,
} from '@arrakis/core/ports';
import type { AnalyticsRedisClient } from '../engine.js';
import pino from 'pino';

// =============================================================================
// Mock Factory
// =============================================================================

const logger = pino({ level: 'silent' });

function createMockSession(overrides: Partial<WizardSession> = {}): WizardSession {
  return {
    id: 'test-session-123',
    communityId: 'community-456',
    guildId: 'guild-789',
    userId: 'user-abc',
    state: WizardState.INIT,
    data: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    ipAddress: '192.168.1.1',
    ...overrides,
  };
}

function createMockSessionStore(): IWizardSessionStore {
  const sessions = new Map<string, WizardSession>();

  return {
    create: vi.fn(async (data) => {
      const session = createMockSession({
        id: `session-${Date.now()}`,
        ...data,
      });
      sessions.set(session.id, session);
      return session;
    }),
    get: vi.fn(async (id) => sessions.get(id) ?? null),
    getByGuild: vi.fn(async (guildId) => {
      for (const session of sessions.values()) {
        if (session.guildId === guildId) return session;
      }
      return null;
    }),
    update: vi.fn(async (id, updates) => {
      const session = sessions.get(id);
      if (!session) return null;
      const updated = { ...session, ...updates, updatedAt: new Date() };
      sessions.set(id, updated);
      return updated;
    }),
    delete: vi.fn(async (id) => sessions.delete(id)),
    refresh: vi.fn(async (id) => {
      const session = sessions.get(id);
      if (!session) return false;
      session.expiresAt = new Date(Date.now() + 15 * 60 * 1000);
      return true;
    }),
    transition: vi.fn(async (id, newState, stepData) => {
      const session = sessions.get(id);
      if (!session) return { success: false, error: 'Session not found' };
      const updated = {
        ...session,
        state: newState,
        data: { ...session.data, ...stepData },
        updatedAt: new Date(),
      };
      sessions.set(id, updated);
      return { success: true, session: updated };
    }),
    validateSession: vi.fn(async (id, ipAddress) => {
      const session = sessions.get(id);
      if (!session) return { valid: false, reason: 'Session not found' };
      if (session.ipAddress && session.ipAddress !== ipAddress) {
        return { valid: false, reason: 'IP mismatch' };
      }
      return { valid: true, session };
    }),
    getStats: vi.fn(async () => ({
      totalActive: sessions.size,
      byState: {},
      avgAge: 0,
    })),
    // Test helper
    _sessions: sessions,
  } as unknown as IWizardSessionStore;
}

function createMockSynthesisEngine(): ISynthesisEngine {
  return {
    enqueueSynthesis: vi.fn(async () => ({
      jobCount: 3,
      jobIds: ['job-1', 'job-2', 'job-3'],
    })),
    getJobsByCommunity: vi.fn(async () => [
      { jobId: 'job-1', status: 'completed', data: { type: 'role' } },
      { jobId: 'job-2', status: 'completed', data: { type: 'role' } },
      { jobId: 'job-3', status: 'active', data: { type: 'channel' } },
    ]),
  } as unknown as ISynthesisEngine;
}

function createMockAnalyticsRedis(): AnalyticsRedisClient {
  const data = new Map<string, string | number>();

  return {
    incr: vi.fn(async (key) => {
      const current = (data.get(key) as number) ?? 0;
      data.set(key, current + 1);
      return current + 1;
    }),
    incrby: vi.fn(async (key, increment) => {
      const current = (data.get(key) as number) ?? 0;
      data.set(key, current + increment);
      return current + increment;
    }),
    get: vi.fn(async (key) => data.get(key) as string ?? null),
    lpush: vi.fn(async () => 1),
    lrange: vi.fn(async () => []),
    hset: vi.fn(async () => 1),
    hget: vi.fn(async () => null),
    hgetall: vi.fn(async () => ({})),
  };
}

// =============================================================================
// Session Management Tests
// =============================================================================

describe('WizardEngine', () => {
  let engine: WizardEngine;
  let sessionStore: IWizardSessionStore;
  let synthesisEngine: ISynthesisEngine;
  let analyticsRedis: AnalyticsRedisClient;

  beforeEach(() => {
    sessionStore = createMockSessionStore();
    synthesisEngine = createMockSynthesisEngine();
    analyticsRedis = createMockAnalyticsRedis();

    engine = new WizardEngine({
      sessionStore,
      synthesisEngine,
      stepHandlers: createAllStepHandlers(logger),
      analyticsRedis,
      logger,
      metrics: createNoOpWizardMetrics(),
    });
  });

  describe('startSession', () => {
    it('should create a new session', async () => {
      const session = await engine.startSession(
        'guild-123',
        'user-456',
        'community-789',
        '192.168.1.1'
      );

      expect(session).toBeDefined();
      expect(session.guildId).toBe('guild-123');
      expect(session.userId).toBe('user-456');
      expect(session.communityId).toBe('community-789');
      expect(session.state).toBe(WizardState.INIT);
      expect(sessionStore.create).toHaveBeenCalled();
    });

    it('should reject if session already exists for guild', async () => {
      // Create first session
      await engine.startSession('guild-123', 'user-456', 'community-789');

      // Try to create another
      await expect(
        engine.startSession('guild-123', 'user-456', 'community-789')
      ).rejects.toThrow(/Session already exists/);
    });

    it('should track session started analytics', async () => {
      await engine.startSession('guild-123', 'user-456', 'community-789');

      expect(analyticsRedis.incr).toHaveBeenCalled();
    });
  });

  describe('resumeSession', () => {
    it('should resume an existing session', async () => {
      const created = await engine.startSession(
        'guild-123',
        'user-456',
        'community-789',
        '192.168.1.1'
      );

      const resumed = await engine.resumeSession(created.id, '192.168.1.1');

      expect(resumed).toBeDefined();
      expect(resumed!.id).toBe(created.id);
      expect(sessionStore.validateSession).toHaveBeenCalled();
    });

    it('should return null for non-existent session', async () => {
      const result = await engine.resumeSession('non-existent', '192.168.1.1');

      expect(result).toBeNull();
    });

    it('should reject IP mismatch', async () => {
      const created = await engine.startSession(
        'guild-123',
        'user-456',
        'community-789',
        '192.168.1.1'
      );

      // Mock IP mismatch validation
      vi.mocked(sessionStore.validateSession).mockResolvedValueOnce({
        valid: false,
        reason: 'IP mismatch',
      });

      const resumed = await engine.resumeSession(created.id, '10.0.0.1');

      expect(resumed).toBeNull();
    });
  });

  describe('resumeByGuild', () => {
    it('should resume session by guild ID', async () => {
      const created = await engine.startSession(
        'guild-123',
        'user-456',
        'community-789',
        '192.168.1.1'
      );

      const resumed = await engine.resumeByGuild('guild-123', '192.168.1.1');

      expect(resumed).toBeDefined();
      expect(resumed!.guildId).toBe('guild-123');
    });

    it('should return null if no session for guild', async () => {
      const result = await engine.resumeByGuild('non-existent-guild');

      expect(result).toBeNull();
    });
  });

  describe('cancelSession', () => {
    it('should cancel an existing session', async () => {
      const created = await engine.startSession(
        'guild-123',
        'user-456',
        'community-789'
      );

      const cancelled = await engine.cancelSession(created.id);

      expect(cancelled).toBe(true);
      expect(sessionStore.delete).toHaveBeenCalledWith(created.id);
    });

    it('should return false for non-existent session', async () => {
      const result = await engine.cancelSession('non-existent');

      expect(result).toBe(false);
    });
  });

  // ===========================================================================
  // Step Execution Tests
  // ===========================================================================

  describe('executeStep', () => {
    it('should execute current step', async () => {
      const session = await engine.startSession(
        'guild-123',
        'user-456',
        'community-789'
      );

      const result = await engine.executeStep(
        {
          sessionId: session.id,
          session,
          guildId: session.guildId,
          userId: session.userId,
        },
        {
          data: { communityName: 'Test Community' },
        }
      );

      expect(result.success).toBe(true);
    });

    it('should validate step input', async () => {
      const session = await engine.startSession(
        'guild-123',
        'user-456',
        'community-789'
      );

      const result = await engine.executeStep(
        {
          sessionId: session.id,
          session,
          guildId: session.guildId,
          userId: session.userId,
        },
        {
          data: { communityName: '' }, // Invalid - empty
        }
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should transition to next state on success', async () => {
      const session = await engine.startSession(
        'guild-123',
        'user-456',
        'community-789'
      );

      await engine.executeStep(
        {
          sessionId: session.id,
          session,
          guildId: session.guildId,
          userId: session.userId,
        },
        {
          data: { communityName: 'Test Community' },
        }
      );

      expect(sessionStore.transition).toHaveBeenCalledWith(
        session.id,
        WizardState.CHAIN_SELECT,
        expect.any(Object)
      );
    });
  });

  describe('goBack', () => {
    it('should navigate to previous step', async () => {
      // Create session at CHAIN_SELECT
      const session = createMockSession({ state: WizardState.CHAIN_SELECT });
      (sessionStore as unknown as { _sessions: Map<string, WizardSession> })._sessions.set(
        session.id,
        session
      );

      const result = await engine.goBack(session.id);

      expect(result.success).toBe(true);
      expect(sessionStore.transition).toHaveBeenCalledWith(
        session.id,
        WizardState.INIT
      );
    });

    it('should fail at initial state', async () => {
      const session = await engine.startSession(
        'guild-123',
        'user-456',
        'community-789'
      );

      const result = await engine.goBack(session.id);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Cannot go back');
    });
  });

  describe('getCurrentStepDisplay', () => {
    it('should return display data for current step', async () => {
      const session = await engine.startSession(
        'guild-123',
        'user-456',
        'community-789'
      );

      const display = await engine.getCurrentStepDisplay(session.id);

      expect(display.success).toBe(true);
      expect(display.embeds).toBeDefined();
      expect(display.components).toBeDefined();
    });

    it('should return error for non-existent session', async () => {
      const display = await engine.getCurrentStepDisplay('non-existent');

      expect(display.success).toBe(false);
      expect(display.error).toBeDefined();
    });
  });

  // ===========================================================================
  // Manifest Tests
  // ===========================================================================

  describe('generateManifest', () => {
    it('should generate manifest from complete session data', async () => {
      const session = createMockSession({
        state: WizardState.REVIEW,
        data: {
          communityName: 'Test Community',
          chains: [{ chainId: 'ethereum', name: 'Ethereum', enabled: true }],
          assets: [
            {
              id: 'asset-1',
              type: 'erc721',
              contractAddress: '0x1234567890123456789012345678901234567890',
              chainId: 'ethereum',
              name: 'Test NFT',
              symbol: 'TNFT',
            },
          ],
          rules: [
            {
              id: 'rule-1',
              type: 'nft_ownership',
              assetId: 'asset-1',
              parameters: { minCount: 1 },
              description: 'Own 1 NFT',
            },
          ],
          tierRoles: [
            {
              tierId: 'fedaykin',
              roleName: 'Fedaykin',
              roleColor: 0xcd7f32,
              mentionable: false,
              hoist: true,
            },
          ],
          channelTemplate: 'additive_only',
        },
      });
      (sessionStore as unknown as { _sessions: Map<string, WizardSession> })._sessions.set(
        session.id,
        session
      );

      const manifest = await engine.generateManifest(session.id);

      expect(manifest).toBeDefined();
      expect(manifest.name).toBe('Test Community');
      expect(manifest.chains).toHaveLength(1);
      expect(manifest.assets).toHaveLength(1);
      expect(manifest.rules).toHaveLength(1);
      expect(manifest.tierRoles).toHaveLength(1);
    });

    it('should throw for incomplete session data', async () => {
      const session = createMockSession({
        state: WizardState.REVIEW,
        data: {
          communityName: 'Test Community',
          // Missing other required data
        },
      });
      (sessionStore as unknown as { _sessions: Map<string, WizardSession> })._sessions.set(
        session.id,
        session
      );

      await expect(engine.generateManifest(session.id)).rejects.toThrow();
    });
  });

  describe('validateManifest', () => {
    it('should validate complete manifest', async () => {
      const manifest: CommunityManifest = {
        version: '1.0.0',
        name: 'Test Community',
        themeId: 'basic',
        chains: [{ chainId: 'ethereum', name: 'Ethereum', enabled: true }],
        assets: [
          {
            id: 'asset-1',
            type: 'erc721',
            contractAddress: '0x1234567890123456789012345678901234567890',
            chainId: 'ethereum',
            name: 'Test NFT',
            symbol: 'TNFT',
          },
        ],
        rules: [
          {
            id: 'rule-1',
            type: 'nft_ownership',
            assetId: 'asset-1',
            parameters: { minCount: 1 },
            description: 'Own 1 NFT',
          },
        ],
        tierRoles: [
          {
            tierId: 'fedaykin',
            roleName: 'Fedaykin',
            roleColor: 0xcd7f32,
            mentionable: false,
            hoist: true,
          },
        ],
        channelTemplate: 'none',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = await engine.validateManifest(manifest);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect missing required fields', async () => {
      const manifest: CommunityManifest = {
        version: '1.0.0',
        name: '',
        themeId: 'basic',
        chains: [],
        assets: [],
        rules: [],
        tierRoles: [],
        channelTemplate: 'none',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = await engine.validateManifest(manifest);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should detect invalid asset chain references', async () => {
      const manifest: CommunityManifest = {
        version: '1.0.0',
        name: 'Test',
        themeId: 'basic',
        chains: [{ chainId: 'ethereum', name: 'Ethereum', enabled: true }],
        assets: [
          {
            id: 'asset-1',
            type: 'erc721',
            contractAddress: '0x1234567890123456789012345678901234567890',
            chainId: 'polygon', // Invalid - not in chains
            name: 'Test NFT',
            symbol: 'TNFT',
          },
        ],
        rules: [
          {
            id: 'rule-1',
            type: 'nft_ownership',
            assetId: 'asset-1',
            parameters: {},
            description: 'Test',
          },
        ],
        tierRoles: [
          {
            tierId: 'test',
            roleName: 'Test',
            roleColor: 0,
            mentionable: false,
            hoist: false,
          },
        ],
        channelTemplate: 'none',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = await engine.validateManifest(manifest);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('unknown chain'))).toBe(true);
    });
  });

  // ===========================================================================
  // Deployment Tests
  // ===========================================================================

  describe('deploy', () => {
    it('should start deployment for validated session', async () => {
      const session = createMockSession({
        state: WizardState.DEPLOY,
        data: {
          manifest: {
            version: '1.0.0',
            name: 'Test',
            themeId: 'basic',
            chains: [],
            assets: [],
            rules: [],
            tierRoles: [],
            channelTemplate: 'none',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          validated: true,
        },
      });
      (sessionStore as unknown as { _sessions: Map<string, WizardSession> })._sessions.set(
        session.id,
        session
      );

      const jobId = await engine.deploy(session.id);

      expect(jobId).toBeDefined();
      expect(synthesisEngine.enqueueSynthesis).toHaveBeenCalled();
    });

    it('should reject deployment without validation', async () => {
      const session = createMockSession({
        state: WizardState.DEPLOY,
        data: {
          manifest: {},
          validated: false,
        },
      });
      (sessionStore as unknown as { _sessions: Map<string, WizardSession> })._sessions.set(
        session.id,
        session
      );

      await expect(engine.deploy(session.id)).rejects.toThrow(/validated/);
    });
  });

  describe('getDeploymentStatus', () => {
    it('should return deployment progress', async () => {
      const session = createMockSession({
        state: WizardState.DEPLOY,
        data: {
          synthesisJobId: 'job-1',
          deploymentStatus: 'roles_creating',
        },
      });
      (sessionStore as unknown as { _sessions: Map<string, WizardSession> })._sessions.set(
        session.id,
        session
      );

      const status = await engine.getDeploymentStatus(session.id);

      expect(status.status).toBeDefined();
      expect(status.progress).toBeGreaterThanOrEqual(0);
      expect(status.jobIds).toBeDefined();
    });
  });

  // ===========================================================================
  // Analytics Tests
  // ===========================================================================

  describe('trackEvent', () => {
    it('should track events to Redis', async () => {
      const session = await engine.startSession(
        'guild-123',
        'user-456',
        'community-789'
      );

      await engine.trackEvent(session.id, 'test.event', { foo: 'bar' });

      expect(analyticsRedis.incr).toHaveBeenCalled();
    });
  });

  describe('getFunnelStats', () => {
    it('should return funnel statistics', async () => {
      const startDate = new Date();
      const endDate = new Date();

      const stats = await engine.getFunnelStats(startDate, endDate);

      expect(stats).toBeDefined();
      expect(stats.started).toBeGreaterThanOrEqual(0);
      expect(stats.completionRate).toBeGreaterThanOrEqual(0);
      expect(stats.reachedByStep).toBeDefined();
    });
  });

  describe('getStepAnalytics', () => {
    it('should return step-level analytics', async () => {
      const startDate = new Date();
      const endDate = new Date();

      const analytics = await engine.getStepAnalytics(
        WizardState.INIT,
        startDate,
        endDate
      );

      expect(analytics).toBeDefined();
      expect(analytics.step).toBe(WizardState.INIT);
      expect(analytics.averageTimeSeconds).toBeGreaterThanOrEqual(0);
    });
  });
});

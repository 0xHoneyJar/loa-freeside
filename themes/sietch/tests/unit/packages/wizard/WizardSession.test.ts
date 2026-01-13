/**
 * WizardSession Unit Tests
 *
 * Sprint 42: WizardEngine & Session Store
 *
 * Tests for session creation, serialization, and helper functions.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  WizardSession,
  CreateSessionParams,
  DEFAULT_SESSION_TTL,
  generateSessionId,
  createWizardSession,
  isSessionExpired,
  serializeSession,
  deserializeSession,
} from '../../../../src/packages/wizard/WizardSession.js';
import { WizardState } from '../../../../src/packages/wizard/WizardState.js';

describe('WizardSession', () => {
  describe('generateSessionId', () => {
    it('should generate unique IDs', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(generateSessionId());
      }
      expect(ids.size).toBe(100);
    });

    it('should start with "wiz_" prefix', () => {
      const id = generateSessionId();
      expect(id).toMatch(/^wiz_/);
    });

    it('should be reasonably short', () => {
      const id = generateSessionId();
      expect(id.length).toBeLessThan(30);
    });
  });

  describe('createWizardSession', () => {
    const params: CreateSessionParams = {
      guildId: 'guild_123',
      userId: 'user_456',
      channelId: 'channel_789',
      interactionId: 'interaction_abc',
      locale: 'en-US',
    };

    it('should create session with correct initial values', () => {
      const session = createWizardSession(params);

      expect(session.guildId).toBe(params.guildId);
      expect(session.userId).toBe(params.userId);
      expect(session.channelId).toBe(params.channelId);
      expect(session.state).toBe(WizardState.INIT);
      expect(session.data).toEqual({});
      expect(session.stepCount).toBe(0);
      expect(session.history).toEqual([]);
    });

    it('should include metadata', () => {
      const session = createWizardSession(params);

      expect(session.metadata?.interactionId).toBe(params.interactionId);
      expect(session.metadata?.locale).toBe(params.locale);
    });

    it('should set correct timestamps', () => {
      const before = new Date();
      const session = createWizardSession(params);
      const after = new Date();

      const createdAt = new Date(session.createdAt);
      const updatedAt = new Date(session.updatedAt);
      const expiresAt = new Date(session.expiresAt);

      expect(createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(createdAt.getTime()).toBeLessThanOrEqual(after.getTime());
      expect(updatedAt.getTime()).toBe(createdAt.getTime());

      // Expiry should be ~15 minutes in the future
      const expectedExpiry = createdAt.getTime() + DEFAULT_SESSION_TTL * 1000;
      expect(Math.abs(expiresAt.getTime() - expectedExpiry)).toBeLessThan(1000);
    });

    it('should generate unique session ID', () => {
      const session = createWizardSession(params);
      expect(session.id).toMatch(/^wiz_/);
    });
  });

  describe('isSessionExpired', () => {
    it('should return false for non-expired session', () => {
      const session = createWizardSession({
        guildId: 'g1',
        userId: 'u1',
        channelId: 'c1',
      });
      expect(isSessionExpired(session)).toBe(false);
    });

    it('should return true for expired session', () => {
      const session = createWizardSession({
        guildId: 'g1',
        userId: 'u1',
        channelId: 'c1',
      });
      // Set expiry to past
      session.expiresAt = new Date(Date.now() - 1000).toISOString();
      expect(isSessionExpired(session)).toBe(true);
    });

    it('should return true for session expiring now', () => {
      const session = createWizardSession({
        guildId: 'g1',
        userId: 'u1',
        channelId: 'c1',
      });
      session.expiresAt = new Date(Date.now() - 1).toISOString();
      expect(isSessionExpired(session)).toBe(true);
    });
  });

  describe('serializeSession / deserializeSession', () => {
    it('should serialize and deserialize correctly', () => {
      const original = createWizardSession({
        guildId: 'guild_123',
        userId: 'user_456',
        channelId: 'channel_789',
      });

      // Add some data
      original.data = {
        chainId: 'ethereum',
        assets: [{ type: 'erc20', address: '0x123', symbol: 'TEST' }],
      };
      original.state = WizardState.ASSET_CONFIG;
      original.stepCount = 2;
      original.history = [WizardState.INIT, WizardState.CHAIN_SELECT];

      const serialized = serializeSession(original);
      expect(typeof serialized).toBe('string');

      const deserialized = deserializeSession(serialized);
      expect(deserialized).toEqual(original);
    });

    it('should preserve all fields through serialization', () => {
      const original: WizardSession = {
        id: 'wiz_test_123',
        guildId: 'guild_123',
        userId: 'user_456',
        channelId: 'channel_789',
        state: WizardState.REVIEW,
        data: {
          chainId: 'berachain',
          assets: [
            { type: 'native', address: null, symbol: 'BERA' },
            { type: 'erc20', address: '0xabc', symbol: 'TOKEN', decimals: 18 },
          ],
          tiers: [
            { name: 'Gold', minRank: 1, maxRank: 10 },
            { name: 'Silver', minRank: 11, maxRank: 50 },
          ],
          roleMappings: [
            { tierName: 'Gold', roleId: '', createNew: true, roleName: 'Gold' },
          ],
          channels: [
            { name: 'general', type: 'text', accessTiers: ['*'] },
          ],
        },
        createdAt: '2025-12-28T10:00:00.000Z',
        updatedAt: '2025-12-28T10:05:00.000Z',
        expiresAt: '2025-12-28T10:15:00.000Z',
        stepCount: 5,
        history: [
          WizardState.INIT,
          WizardState.CHAIN_SELECT,
          WizardState.ASSET_CONFIG,
          WizardState.ELIGIBILITY_RULES,
          WizardState.ROLE_MAPPING,
        ],
        metadata: {
          interactionId: 'int_123',
          messageId: 'msg_456',
          locale: 'en-US',
          clientVersion: '1.0.0',
        },
      };

      const serialized = serializeSession(original);
      const deserialized = deserializeSession(serialized);

      expect(deserialized.id).toBe(original.id);
      expect(deserialized.guildId).toBe(original.guildId);
      expect(deserialized.state).toBe(original.state);
      expect(deserialized.data).toEqual(original.data);
      expect(deserialized.history).toEqual(original.history);
      expect(deserialized.metadata).toEqual(original.metadata);
    });

    it('should handle empty data', () => {
      const original = createWizardSession({
        guildId: 'g1',
        userId: 'u1',
        channelId: 'c1',
      });

      const serialized = serializeSession(original);
      const deserialized = deserializeSession(serialized);

      expect(deserialized.data).toEqual({});
      expect(deserialized.history).toEqual([]);
    });
  });

  describe('DEFAULT_SESSION_TTL', () => {
    it('should be 15 minutes in seconds', () => {
      expect(DEFAULT_SESSION_TTL).toBe(15 * 60);
    });
  });
});

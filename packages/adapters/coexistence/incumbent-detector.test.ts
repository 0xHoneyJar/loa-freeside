/**
 * IncumbentDetector Tests
 *
 * Sprint S-24: Incumbent Detection & Shadow Ledger
 *
 * Tests for auto-detection of incumbent token-gating providers
 * with >90% accuracy on known patterns.
 *
 * @see SDD §7.1.2 Incumbent Detection
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pino } from 'pino';
import {
  IncumbentDetector,
  createIncumbentDetector,
  type IDiscordRestService,
  type GuildMember,
  type GuildChannel,
  type GuildRole,
} from './incumbent-detector.js';
import { KNOWN_INCUMBENT_BOTS } from '@arrakis/core/domain';

// =============================================================================
// Test Fixtures
// =============================================================================

const mockLogger = pino({ level: 'silent' });

function createMockDiscordRest(overrides: Partial<IDiscordRestService> = {}): IDiscordRestService {
  return {
    getGuildMembers: vi.fn().mockResolvedValue([]),
    getGuildChannels: vi.fn().mockResolvedValue([]),
    getGuildRoles: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function createBot(id: string, username: string): GuildMember {
  return {
    user: { id, username, bot: true },
    roles: [],
  };
}

function createUser(id: string, username: string, roles: string[] = []): GuildMember {
  return {
    user: { id, username, bot: false },
    roles,
  };
}

function createChannel(id: string, name: string, type = 0): GuildChannel {
  return { id, name, type };
}

function createRole(id: string, name: string, position = 1, managed = false): GuildRole {
  return { id, name, position, managed };
}

// =============================================================================
// Known Bot ID Detection Tests
// =============================================================================

describe('IncumbentDetector', () => {
  describe('Bot ID Detection', () => {
    it('should detect Collab.Land by primary bot ID', async () => {
      const mockRest = createMockDiscordRest({
        getGuildMembers: vi.fn().mockResolvedValue([
          createBot(KNOWN_INCUMBENT_BOTS.collabland[0]!, 'Collab.Land'),
        ]),
      });

      const detector = new IncumbentDetector(mockRest, mockLogger);
      const result = await detector.detect('guild-123');

      expect(result.type).toBe('collabland');
      expect(result.confidence).toBeGreaterThanOrEqual(0.3);
      expect(result.evidence).toContainEqual(
        expect.objectContaining({
          type: 'bot_id',
          value: expect.stringContaining('collabland'),
        })
      );
    });

    it('should detect Collab.Land by secondary bot ID', async () => {
      const mockRest = createMockDiscordRest({
        getGuildMembers: vi.fn().mockResolvedValue([
          createBot(KNOWN_INCUMBENT_BOTS.collabland[1]!, 'Collab.Land Backup'),
        ]),
      });

      const detector = new IncumbentDetector(mockRest, mockLogger);
      const result = await detector.detect('guild-123');

      expect(result.type).toBe('collabland');
    });

    it('should detect Matrica by bot ID', async () => {
      const mockRest = createMockDiscordRest({
        getGuildMembers: vi.fn().mockResolvedValue([
          createBot(KNOWN_INCUMBENT_BOTS.matrica[0]!, 'Matrica'),
        ]),
      });

      const detector = new IncumbentDetector(mockRest, mockLogger);
      const result = await detector.detect('guild-123');

      expect(result.type).toBe('matrica');
      expect(result.confidence).toBeGreaterThanOrEqual(0.3);
    });

    it('should detect Guild.xyz by bot ID', async () => {
      const mockRest = createMockDiscordRest({
        getGuildMembers: vi.fn().mockResolvedValue([
          createBot(KNOWN_INCUMBENT_BOTS.guild_xyz[0]!, 'Guild.xyz'),
        ]),
      });

      const detector = new IncumbentDetector(mockRest, mockLogger);
      const result = await detector.detect('guild-123');

      expect(result.type).toBe('guild_xyz');
      expect(result.confidence).toBeGreaterThanOrEqual(0.3);
    });

    it('should return highest confidence when multiple incumbents detected', async () => {
      const mockRest = createMockDiscordRest({
        getGuildMembers: vi.fn().mockResolvedValue([
          createBot(KNOWN_INCUMBENT_BOTS.collabland[0]!, 'Collab.Land'),
          createBot(KNOWN_INCUMBENT_BOTS.collabland[1]!, 'Collab.Land Backup'),
          createBot(KNOWN_INCUMBENT_BOTS.matrica[0]!, 'Matrica'),
        ]),
      });

      const detector = new IncumbentDetector(mockRest, mockLogger);
      const result = await detector.detect('guild-123');

      // Collab.Land has 2 bot IDs, Matrica has 1, so Collab.Land should win
      expect(result.type).toBe('collabland');
    });

    it('should ignore non-bot users', async () => {
      const mockRest = createMockDiscordRest({
        getGuildMembers: vi.fn().mockResolvedValue([
          createUser(KNOWN_INCUMBENT_BOTS.collabland[0]!, 'Fake Collab.Land'),
        ]),
      });

      const detector = new IncumbentDetector(mockRest, mockLogger);
      const result = await detector.detect('guild-123');

      expect(result.type).toBe('none');
    });
  });

  // ===========================================================================
  // Channel Pattern Detection Tests
  // ===========================================================================

  describe('Channel Pattern Detection', () => {
    it('should detect Collab.Land by collabland-join channel', async () => {
      const mockRest = createMockDiscordRest({
        getGuildChannels: vi.fn().mockResolvedValue([
          createChannel('ch-1', 'collabland-join'),
        ]),
      });

      const detector = new IncumbentDetector(mockRest, mockLogger);
      // Use low threshold for single-evidence tests
      const result = await detector.detect('guild-123', { minConfidence: 0.1 });

      expect(result.type).toBe('collabland');
      expect(result.evidence).toContainEqual(
        expect.objectContaining({
          type: 'channel_name',
          value: expect.stringContaining('collabland'),
        })
      );
    });

    it('should detect Collab.Land by collab-verify channel', async () => {
      const mockRest = createMockDiscordRest({
        getGuildChannels: vi.fn().mockResolvedValue([
          createChannel('ch-1', 'collab-land'),
        ]),
      });

      const detector = new IncumbentDetector(mockRest, mockLogger);
      const result = await detector.detect('guild-123', { minConfidence: 0.1 });

      expect(result.type).toBe('collabland');
    });

    it('should detect Matrica by matrica-verify channel', async () => {
      const mockRest = createMockDiscordRest({
        getGuildChannels: vi.fn().mockResolvedValue([
          createChannel('ch-1', 'matrica-verify'),
        ]),
      });

      const detector = new IncumbentDetector(mockRest, mockLogger);
      const result = await detector.detect('guild-123', { minConfidence: 0.1 });

      expect(result.type).toBe('matrica');
    });

    it('should detect Guild.xyz by guild-join channel', async () => {
      const mockRest = createMockDiscordRest({
        getGuildChannels: vi.fn().mockResolvedValue([
          createChannel('ch-1', 'guild-join'),
        ]),
      });

      const detector = new IncumbentDetector(mockRest, mockLogger);
      const result = await detector.detect('guild-123', { minConfidence: 0.1 });

      expect(result.type).toBe('guild_xyz');
    });

    it('should detect Guild.xyz by guild-verify channel', async () => {
      const mockRest = createMockDiscordRest({
        getGuildChannels: vi.fn().mockResolvedValue([
          createChannel('ch-1', 'guild-verify'),
        ]),
      });

      const detector = new IncumbentDetector(mockRest, mockLogger);
      const result = await detector.detect('guild-123', { minConfidence: 0.1 });

      expect(result.type).toBe('guild_xyz');
    });

    it('should skip channel patterns when option set', async () => {
      const mockRest = createMockDiscordRest({
        getGuildChannels: vi.fn().mockResolvedValue([
          createChannel('ch-1', 'collabland-join'),
        ]),
      });

      const detector = new IncumbentDetector(mockRest, mockLogger);
      const result = await detector.detect('guild-123', { skipChannelPatterns: true });

      expect(result.type).toBe('none');
      expect(mockRest.getGuildChannels).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Role Pattern Detection Tests
  // ===========================================================================

  describe('Role Pattern Detection', () => {
    it('should detect Collab.Land by Collab.Land Verified role', async () => {
      const mockRest = createMockDiscordRest({
        getGuildRoles: vi.fn().mockResolvedValue([
          createRole('role-1', 'Collab.Land Verified'),
        ]),
      });

      const detector = new IncumbentDetector(mockRest, mockLogger);
      const result = await detector.detect('guild-123', { minConfidence: 0.1 });

      expect(result.type).toBe('collabland');
      expect(result.evidence).toContainEqual(
        expect.objectContaining({
          type: 'role_name',
          value: expect.stringContaining('collabland'),
        })
      );
    });

    it('should detect Matrica by Matrica Holder role', async () => {
      const mockRest = createMockDiscordRest({
        getGuildRoles: vi.fn().mockResolvedValue([
          createRole('role-1', 'Matrica Holder'),
        ]),
      });

      const detector = new IncumbentDetector(mockRest, mockLogger);
      const result = await detector.detect('guild-123', { minConfidence: 0.1 });

      expect(result.type).toBe('matrica');
    });

    it('should detect Guild.xyz by Guild.xyz Member role', async () => {
      const mockRest = createMockDiscordRest({
        getGuildRoles: vi.fn().mockResolvedValue([
          createRole('role-1', 'Guild.xyz Member'),
        ]),
      });

      const detector = new IncumbentDetector(mockRest, mockLogger);
      const result = await detector.detect('guild-123', { minConfidence: 0.1 });

      expect(result.type).toBe('guild_xyz');
    });

    it('should skip managed roles', async () => {
      const mockRest = createMockDiscordRest({
        getGuildRoles: vi.fn().mockResolvedValue([
          createRole('role-1', 'Collab.Land Verified', 1, true), // managed
        ]),
      });

      const detector = new IncumbentDetector(mockRest, mockLogger);
      const result = await detector.detect('guild-123');

      expect(result.type).toBe('none');
    });

    it('should skip role patterns when option set', async () => {
      const mockRest = createMockDiscordRest({
        getGuildRoles: vi.fn().mockResolvedValue([
          createRole('role-1', 'Collab.Land Verified'),
        ]),
      });

      const detector = new IncumbentDetector(mockRest, mockLogger);
      const result = await detector.detect('guild-123', { skipRolePatterns: true });

      expect(result.type).toBe('none');
      expect(mockRest.getGuildRoles).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Confidence Scoring Tests
  // ===========================================================================

  describe('Confidence Scoring', () => {
    it('should return highest confidence for bot ID detection', async () => {
      const mockRest = createMockDiscordRest({
        getGuildMembers: vi.fn().mockResolvedValue([
          createBot(KNOWN_INCUMBENT_BOTS.collabland[0]!, 'Collab.Land'),
        ]),
      });

      const detector = new IncumbentDetector(mockRest, mockLogger);
      const result = await detector.detect('guild-123');

      // Bot ID has 0.95 confidence, normalized to 0.95/3 ≈ 0.317
      expect(result.confidence).toBeGreaterThanOrEqual(0.3);
    });

    it('should accumulate confidence from multiple evidences', async () => {
      const mockRest = createMockDiscordRest({
        getGuildMembers: vi.fn().mockResolvedValue([
          createBot(KNOWN_INCUMBENT_BOTS.collabland[0]!, 'Collab.Land'),
        ]),
        getGuildChannels: vi.fn().mockResolvedValue([
          createChannel('ch-1', 'collabland-join'),
        ]),
        getGuildRoles: vi.fn().mockResolvedValue([
          createRole('role-1', 'Collab.Land Verified'),
        ]),
      });

      const detector = new IncumbentDetector(mockRest, mockLogger);
      const result = await detector.detect('guild-123');

      // Should have higher confidence with multiple evidences
      expect(result.confidence).toBeGreaterThan(0.5);
      expect(result.evidence.length).toBeGreaterThanOrEqual(3);
    });

    it('should normalize confidence to max 1.0', async () => {
      const mockRest = createMockDiscordRest({
        getGuildMembers: vi.fn().mockResolvedValue([
          createBot(KNOWN_INCUMBENT_BOTS.collabland[0]!, 'Collab.Land'),
          createBot(KNOWN_INCUMBENT_BOTS.collabland[1]!, 'Collab.Land Backup'),
        ]),
        getGuildChannels: vi.fn().mockResolvedValue([
          createChannel('ch-1', 'collabland-join'),
          createChannel('ch-2', 'collab-verify'),
        ]),
        getGuildRoles: vi.fn().mockResolvedValue([
          createRole('role-1', 'Collab.Land Verified'),
          createRole('role-2', 'CollabLand Member'),
        ]),
      });

      const detector = new IncumbentDetector(mockRest, mockLogger);
      const result = await detector.detect('guild-123');

      expect(result.confidence).toBeLessThanOrEqual(1.0);
    });

    it('should filter results below minimum confidence threshold', async () => {
      const mockRest = createMockDiscordRest({
        getGuildRoles: vi.fn().mockResolvedValue([
          createRole('role-1', 'Guild Member'), // Just one role pattern
        ]),
      });

      const detector = new IncumbentDetector(mockRest, mockLogger);

      // With high threshold, single role evidence should not pass
      const result = await detector.detect('guild-123', { minConfidence: 0.5 });

      // Role pattern has 0.5 confidence, normalized to ~0.167
      expect(result.type).toBe('none');
    });
  });

  // ===========================================================================
  // Error Handling Tests
  // ===========================================================================

  describe('Error Handling', () => {
    it('should handle member fetch errors gracefully', async () => {
      const mockRest = createMockDiscordRest({
        getGuildMembers: vi.fn().mockRejectedValue(new Error('Rate limited')),
      });

      const detector = new IncumbentDetector(mockRest, mockLogger);
      const result = await detector.detect('guild-123');

      expect(result.type).toBe('none');
      expect(result.confidence).toBe(0);
    });

    it('should handle channel fetch errors gracefully', async () => {
      const mockRest = createMockDiscordRest({
        getGuildMembers: vi.fn().mockResolvedValue([
          createBot(KNOWN_INCUMBENT_BOTS.collabland[0]!, 'Collab.Land'),
        ]),
        getGuildChannels: vi.fn().mockRejectedValue(new Error('Forbidden')),
      });

      const detector = new IncumbentDetector(mockRest, mockLogger);
      const result = await detector.detect('guild-123');

      // Should still detect based on bot
      expect(result.type).toBe('collabland');
    });

    it('should handle role fetch errors gracefully', async () => {
      const mockRest = createMockDiscordRest({
        getGuildMembers: vi.fn().mockResolvedValue([
          createBot(KNOWN_INCUMBENT_BOTS.matrica[0]!, 'Matrica'),
        ]),
        getGuildRoles: vi.fn().mockRejectedValue(new Error('Forbidden')),
      });

      const detector = new IncumbentDetector(mockRest, mockLogger);
      const result = await detector.detect('guild-123');

      // Should still detect based on bot
      expect(result.type).toBe('matrica');
    });
  });

  // ===========================================================================
  // Format Summary Tests
  // ===========================================================================

  describe('formatSummary', () => {
    it('should format Collab.Land detection', () => {
      const detector = new IncumbentDetector(createMockDiscordRest(), mockLogger);

      const summary = detector.formatSummary({
        type: 'collabland',
        confidence: 0.95,
        evidence: [],
      });

      expect(summary).toContain('Collab.Land');
      expect(summary).toContain('High confidence');
    });

    it('should format Matrica detection', () => {
      const detector = new IncumbentDetector(createMockDiscordRest(), mockLogger);

      const summary = detector.formatSummary({
        type: 'matrica',
        confidence: 0.6,
        evidence: [],
      });

      expect(summary).toContain('Matrica');
      expect(summary).toContain('Medium confidence');
    });

    it('should format Guild.xyz detection', () => {
      const detector = new IncumbentDetector(createMockDiscordRest(), mockLogger);

      const summary = detector.formatSummary({
        type: 'guild_xyz',
        confidence: 0.4,
        evidence: [],
      });

      expect(summary).toContain('Guild.xyz');
      expect(summary).toContain('Low confidence');
    });

    it('should format no detection', () => {
      const detector = new IncumbentDetector(createMockDiscordRest(), mockLogger);

      const summary = detector.formatSummary({
        type: 'none',
        confidence: 0,
        evidence: [],
      });

      expect(summary).toContain('No incumbent');
    });
  });

  // ===========================================================================
  // Factory Function Tests
  // ===========================================================================

  describe('createIncumbentDetector', () => {
    it('should create IncumbentDetector instance', () => {
      const detector = createIncumbentDetector(createMockDiscordRest(), mockLogger);

      expect(detector).toBeInstanceOf(IncumbentDetector);
    });
  });

  // ===========================================================================
  // Accuracy Test Suite (>90% on known patterns)
  // ===========================================================================

  describe('Detection Accuracy (>90%)', () => {
    const testCases = [
      // Collab.Land patterns (matching regex: /collabland-join|collab-land|cl-verify/i)
      { name: 'Collab.Land bot (primary)', bots: [KNOWN_INCUMBENT_BOTS.collabland[0]!], expected: 'collabland' },
      { name: 'Collab.Land bot (secondary)', bots: [KNOWN_INCUMBENT_BOTS.collabland[1]!], expected: 'collabland' },
      { name: 'collabland-join channel', channels: ['collabland-join'], expected: 'collabland' },
      { name: 'collab-land channel', channels: ['collab-land'], expected: 'collabland' },
      { name: 'cl-verify channel', channels: ['cl-verify'], expected: 'collabland' },
      // Role pattern: /collab|holder|verified/i
      { name: 'Collab.Land Verified role', roles: ['Collab.Land Verified'], expected: 'collabland' },
      { name: 'CollabLand Member role', roles: ['CollabLand Member'], expected: 'collabland' },
      { name: 'NFT Holder role', roles: ['NFT Holder'], expected: 'collabland' },

      // Matrica patterns (matching regex: /matrica-verify|matrica-join/i)
      { name: 'Matrica bot', bots: [KNOWN_INCUMBENT_BOTS.matrica[0]!], expected: 'matrica' },
      { name: 'matrica-verify channel', channels: ['matrica-verify'], expected: 'matrica' },
      { name: 'matrica-join channel', channels: ['matrica-join'], expected: 'matrica' },
      // Role pattern: /matrica/i
      { name: 'Matrica Verified role', roles: ['Matrica Verified'], expected: 'matrica' },
      { name: 'Matrica Holder role', roles: ['Matrica Holder'], expected: 'matrica' },

      // Guild.xyz patterns (matching regex: /guild-verify|guild-join/i)
      { name: 'Guild.xyz bot', bots: [KNOWN_INCUMBENT_BOTS.guild_xyz[0]!], expected: 'guild_xyz' },
      { name: 'guild-join channel', channels: ['guild-join'], expected: 'guild_xyz' },
      { name: 'guild-verify channel', channels: ['guild-verify'], expected: 'guild_xyz' },
      // Role pattern: /guild\.xyz|guildxyz/i
      { name: 'Guild.xyz Member role', roles: ['Guild.xyz Member'], expected: 'guild_xyz' },
      { name: 'GuildXYZ Role role', roles: ['GuildXYZ Role'], expected: 'guild_xyz' },

      // No incumbent
      { name: 'empty guild', expected: 'none' },
      { name: 'random bots', bots: ['123456789', '987654321'], expected: 'none' },
      { name: 'random channels', channels: ['general', 'announcements', 'rules'], expected: 'none' },
      { name: 'random roles', roles: ['Admin', 'Moderator', 'Staff'], expected: 'none' },
    ];

    testCases.forEach((testCase) => {
      it(`should detect ${testCase.name}`, async () => {
        const mockRest = createMockDiscordRest({
          getGuildMembers: vi.fn().mockResolvedValue(
            (testCase.bots ?? []).map((id) => createBot(id, `Bot-${id}`))
          ),
          getGuildChannels: vi.fn().mockResolvedValue(
            (testCase.channels ?? []).map((name, i) => createChannel(`ch-${i}`, name))
          ),
          getGuildRoles: vi.fn().mockResolvedValue(
            (testCase.roles ?? []).map((name, i) => createRole(`role-${i}`, name))
          ),
        });

        const detector = new IncumbentDetector(mockRest, mockLogger);
        // Use lower threshold for single-evidence patterns
        const result = await detector.detect('guild-123', { minConfidence: 0.1 });

        // For known patterns, expect detection (even with low confidence)
        // For unknown patterns, expect none
        if (testCase.expected === 'none') {
          expect(result.type).toBe('none');
        } else {
          expect(result.type).toBe(testCase.expected);
        }
      });
    });
  });
});

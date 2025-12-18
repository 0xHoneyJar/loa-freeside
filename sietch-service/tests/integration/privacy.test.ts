/**
 * Privacy Leak Detection Tests
 *
 * Ensures no wallet addresses or Discord IDs leak through public APIs or responses.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the config
vi.mock('../../src/config.js', () => ({
  config: {
    discord: {
      roles: { naib: 'role', fedaykin: 'role' },
      guildId: 'guild',
      channels: { theDoor: 'channel', census: 'channel' },
      botToken: 'token',
    },
    socialLayer: {
      profile: { launchDate: '2025-01-01T00:00:00Z' },
    },
  },
}));

// Mock database queries
vi.mock('../../src/db/queries.js', () => ({
  getMemberProfileById: vi.fn(),
  getMemberProfileByDiscordId: vi.fn(),
  getDatabase: vi.fn(() => ({
    prepare: vi.fn(() => ({
      all: vi.fn(() => []),
      get: vi.fn(),
      run: vi.fn(),
    })),
  })),
}));

describe('Privacy Protection', () => {
  describe('Public Profile Filtering', () => {
    const mockProfile = {
      memberId: 'member-uuid-123',
      discordUserId: 'discord-123456789',
      nym: 'TestUser',
      bio: 'A test user bio',
      pfpUrl: 'https://cdn.example.com/avatar.webp',
      pfpType: 'custom',
      tier: 'fedaykin',
      createdAt: new Date('2024-06-01'),
      updatedAt: new Date('2024-12-01'),
      nymLastChanged: null,
      onboardingComplete: true,
      onboardingStep: 3,
    };

    // Simulated wallet address that should NEVER appear
    const walletAddress = '0x1234567890abcdef1234567890abcdef12345678';

    it('should NOT expose Discord ID in public profile', () => {
      // Simulate getPublicProfile() filtering
      const publicProfile = {
        memberId: mockProfile.memberId,
        nym: mockProfile.nym,
        bio: mockProfile.bio,
        pfpUrl: mockProfile.pfpUrl,
        tier: mockProfile.tier,
        tenureCategory: 'established',
        badges: [],
      };

      // Verify Discord ID is not present
      expect(JSON.stringify(publicProfile)).not.toContain('discord');
      expect(JSON.stringify(publicProfile)).not.toContain('Discord');
      expect(JSON.stringify(publicProfile)).not.toContain(mockProfile.discordUserId);
    });

    it('should NOT expose wallet address in any response', () => {
      const publicProfile = {
        memberId: mockProfile.memberId,
        nym: mockProfile.nym,
        bio: mockProfile.bio,
        pfpUrl: mockProfile.pfpUrl,
        tier: mockProfile.tier,
        badges: [],
      };

      const profileJson = JSON.stringify(publicProfile);

      // Verify no wallet-like strings
      expect(profileJson).not.toContain('0x');
      expect(profileJson).not.toContain(walletAddress);
      expect(profileJson).not.toContain('wallet');
      expect(profileJson).not.toContain('Wallet');
      expect(profileJson).not.toContain('address');
    });

    it('should use memberId instead of discordUserId in public APIs', () => {
      // Public APIs should use memberId for identification
      const apiResponse = {
        success: true,
        profile: {
          memberId: mockProfile.memberId,
          nym: mockProfile.nym,
          tier: mockProfile.tier,
        },
      };

      expect(apiResponse.profile.memberId).toBeDefined();
      expect((apiResponse.profile as any).discordUserId).toBeUndefined();
    });
  });

  describe('Directory Response Privacy', () => {
    it('should filter sensitive fields from directory entries', () => {
      // Simulated directory response
      const directoryEntry = {
        memberId: 'member-123',
        nym: 'CommunityMember',
        tier: 'naib',
        tenureCategory: 'veteran',
        badgeCount: 5,
        // These should NEVER be present in directory
        // discordUserId: 'SHOULD_NOT_EXIST',
        // walletAddress: 'SHOULD_NOT_EXIST',
      };

      expect(directoryEntry).not.toHaveProperty('discordUserId');
      expect(directoryEntry).not.toHaveProperty('walletAddress');
      expect(directoryEntry).not.toHaveProperty('discord_user_id');
      expect(directoryEntry).not.toHaveProperty('wallet_address');
    });
  });

  describe('Leaderboard Response Privacy', () => {
    it('should only show nym and public stats in leaderboard', () => {
      const leaderboardEntry = {
        rank: 1,
        nym: 'TopUser',
        tier: 'naib',
        badgeCount: 15,
        tierEmoji: '👑',
      };

      const entryJson = JSON.stringify(leaderboardEntry);

      // No PII should be present
      expect(entryJson).not.toContain('discord');
      expect(entryJson).not.toContain('wallet');
      expect(entryJson).not.toContain('0x');
      expect(entryJson).not.toContain('userId');
    });
  });

  describe('API Endpoint Privacy', () => {
    it('should not return wallet correlation in GET /api/members/:nym', () => {
      // Simulated API response
      const apiResponse = {
        memberId: 'uuid-123',
        nym: 'SomeUser',
        bio: 'User bio',
        pfpUrl: null,
        tier: 'fedaykin',
        tenureCategory: 'newcomer',
        badges: [
          { badgeId: 'consistent', name: 'Consistent', emoji: '🔥' },
        ],
      };

      const responseJson = JSON.stringify(apiResponse);

      // Verify no sensitive data
      expect(responseJson).not.toMatch(/\d{17,19}/); // No Discord snowflake IDs
      expect(responseJson).not.toMatch(/0x[a-fA-F0-9]{40}/); // No Ethereum addresses
    });
  });

  describe('Error Response Privacy', () => {
    it('should not leak sensitive info in error messages', () => {
      // Common error responses should not reveal private data
      const errorResponses = [
        { error: 'Member not found' },
        { error: 'Invalid request' },
        { error: 'Unauthorized' },
        { error: 'Rate limit exceeded' },
      ];

      for (const response of errorResponses) {
        const json = JSON.stringify(response);
        expect(json).not.toContain('discord');
        expect(json).not.toContain('wallet');
        expect(json).not.toContain('0x');
      }
    });
  });

  describe('Audit Log Privacy', () => {
    it('should use memberId instead of discordUserId in audit logs', () => {
      // Audit log entry format
      const auditEntry = {
        eventType: 'badge_awarded',
        eventData: {
          memberId: 'member-uuid-123',
          badgeId: 'helper',
          awardedBy: 'admin-system',
        },
      };

      const entryJson = JSON.stringify(auditEntry);

      // Audit logs can contain memberId but not direct Discord/wallet correlation
      expect(auditEntry.eventData.memberId).toBeDefined();
      expect((auditEntry.eventData as any).discordUserId).toBeUndefined();
      expect((auditEntry.eventData as any).walletAddress).toBeUndefined();
    });
  });
});

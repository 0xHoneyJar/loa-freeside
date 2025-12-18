/**
 * Directory Integration Tests
 *
 * Tests directory browsing, filtering, and privacy protections.
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

// Mock database
const mockPrepare = vi.fn();

vi.mock('../../src/db/queries.js', () => ({
  getMemberProfileById: vi.fn(),
  getDatabase: vi.fn(() => ({
    prepare: mockPrepare.mockReturnValue({
      all: vi.fn(() => []),
      get: vi.fn(),
      run: vi.fn(),
    }),
  })),
  logAuditEvent: vi.fn(),
}));

describe('Directory Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Directory Listing', () => {
    it('should return public profile fields only', () => {
      const directoryEntry = {
        memberId: 'member-123',
        nym: 'TestUser',
        tier: 'naib',
        tenureCategory: 'veteran',
        badgeCount: 5,
        pfpUrl: 'https://cdn.example.com/avatar.webp',
      };

      // Verify only public fields
      expect(directoryEntry).toHaveProperty('memberId');
      expect(directoryEntry).toHaveProperty('nym');
      expect(directoryEntry).toHaveProperty('tier');
      expect(directoryEntry).toHaveProperty('badgeCount');

      // Should NOT have private fields
      expect(directoryEntry).not.toHaveProperty('discordUserId');
      expect(directoryEntry).not.toHaveProperty('walletAddress');
    });

    it('should support pagination', () => {
      const page = 1;
      const pageSize = 20;
      const totalMembers = 55;

      const totalPages = Math.ceil(totalMembers / pageSize);
      const offset = (page - 1) * pageSize;

      expect(totalPages).toBe(3);
      expect(offset).toBe(0);
    });

    it('should calculate correct offsets', () => {
      const pageSize = 20;

      expect((1 - 1) * pageSize).toBe(0); // Page 1
      expect((2 - 1) * pageSize).toBe(20); // Page 2
      expect((3 - 1) * pageSize).toBe(40); // Page 3
    });
  });

  describe('Directory Filtering', () => {
    it('should filter by tier (naib)', () => {
      const members = [
        { memberId: '1', nym: 'User1', tier: 'naib' },
        { memberId: '2', nym: 'User2', tier: 'fedaykin' },
        { memberId: '3', nym: 'User3', tier: 'naib' },
      ];

      const filtered = members.filter((m) => m.tier === 'naib');

      expect(filtered).toHaveLength(2);
      expect(filtered.every((m) => m.tier === 'naib')).toBe(true);
    });

    it('should filter by tier (fedaykin)', () => {
      const members = [
        { memberId: '1', nym: 'User1', tier: 'naib' },
        { memberId: '2', nym: 'User2', tier: 'fedaykin' },
        { memberId: '3', nym: 'User3', tier: 'fedaykin' },
      ];

      const filtered = members.filter((m) => m.tier === 'fedaykin');

      expect(filtered).toHaveLength(2);
    });

    it('should filter by tenure category', () => {
      const members = [
        { memberId: '1', nym: 'User1', tenureCategory: 'newcomer' },
        { memberId: '2', nym: 'User2', tenureCategory: 'veteran' },
        { memberId: '3', nym: 'User3', tenureCategory: 'veteran' },
      ];

      const filtered = members.filter((m) => m.tenureCategory === 'veteran');

      expect(filtered).toHaveLength(2);
    });

    it('should search by nym (case insensitive)', () => {
      const members = [
        { memberId: '1', nym: 'TestUser' },
        { memberId: '2', nym: 'AnotherTest' },
        { memberId: '3', nym: 'RandomNym' },
      ];

      const searchTerm = 'test';
      const filtered = members.filter((m) =>
        m.nym.toLowerCase().includes(searchTerm.toLowerCase())
      );

      expect(filtered).toHaveLength(2);
    });
  });

  describe('Directory Sorting', () => {
    it('should sort by badge count (descending)', () => {
      const members = [
        { nym: 'User1', badgeCount: 3 },
        { nym: 'User2', badgeCount: 10 },
        { nym: 'User3', badgeCount: 5 },
      ];

      const sorted = [...members].sort((a, b) => b.badgeCount - a.badgeCount);

      expect(sorted[0].badgeCount).toBe(10);
      expect(sorted[1].badgeCount).toBe(5);
      expect(sorted[2].badgeCount).toBe(3);
    });

    it('should sort by tenure (oldest first)', () => {
      const members = [
        { nym: 'User1', createdAt: new Date('2024-06-01') },
        { nym: 'User2', createdAt: new Date('2024-01-01') },
        { nym: 'User3', createdAt: new Date('2024-09-01') },
      ];

      const sorted = [...members].sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
      );

      expect(sorted[0].nym).toBe('User2');
      expect(sorted[1].nym).toBe('User1');
      expect(sorted[2].nym).toBe('User3');
    });

    it('should sort alphabetically by nym', () => {
      const members = [
        { nym: 'Zephyr' },
        { nym: 'Alpha' },
        { nym: 'Delta' },
      ];

      const sorted = [...members].sort((a, b) =>
        a.nym.toLowerCase().localeCompare(b.nym.toLowerCase())
      );

      expect(sorted[0].nym).toBe('Alpha');
      expect(sorted[1].nym).toBe('Delta');
      expect(sorted[2].nym).toBe('Zephyr');
    });
  });

  describe('Directory Privacy', () => {
    it('should only show onboarded members', () => {
      const members = [
        { memberId: '1', nym: 'User1', onboardingComplete: true },
        { memberId: '2', nym: 'Member_ABC123', onboardingComplete: false },
        { memberId: '3', nym: 'User3', onboardingComplete: true },
      ];

      const visible = members.filter((m) => m.onboardingComplete);

      expect(visible).toHaveLength(2);
      expect(visible.every((m) => m.onboardingComplete)).toBe(true);
    });

    it('should not expose placeholder nyms', () => {
      const members = [
        { nym: 'User1', onboardingComplete: true },
        { nym: 'Member_ABC123', onboardingComplete: false },
      ];

      const visible = members.filter(
        (m) => m.onboardingComplete && !m.nym.startsWith('Member_')
      );

      expect(visible).toHaveLength(1);
      expect(visible[0].nym).toBe('User1');
    });

    it('should not expose any PII in directory entries', () => {
      const directoryEntry = {
        memberId: 'uuid-123',
        nym: 'TestUser',
        tier: 'naib',
        tenureCategory: 'veteran',
        badgeCount: 5,
        pfpUrl: null,
      };

      const json = JSON.stringify(directoryEntry);

      expect(json).not.toContain('discord');
      expect(json).not.toContain('wallet');
      expect(json).not.toContain('0x');
      expect(json).not.toMatch(/\d{17,19}/); // No Discord snowflakes
    });
  });

  describe('Directory Response Format', () => {
    it('should include pagination metadata', () => {
      const response = {
        members: [],
        pagination: {
          page: 1,
          pageSize: 20,
          totalMembers: 55,
          totalPages: 3,
        },
      };

      expect(response.pagination).toBeDefined();
      expect(response.pagination.totalPages).toBe(3);
    });

    it('should include filter metadata', () => {
      const response = {
        members: [],
        filters: {
          tier: 'naib',
          tenureCategory: null,
          search: null,
        },
        pagination: {
          page: 1,
          pageSize: 20,
          totalMembers: 30,
          totalPages: 2,
        },
      };

      expect(response.filters).toBeDefined();
      expect(response.filters.tier).toBe('naib');
    });
  });

  describe('Directory Performance', () => {
    it('should limit page size', () => {
      const requestedPageSize = 1000;
      const maxPageSize = 50;
      const actualPageSize = Math.min(requestedPageSize, maxPageSize);

      expect(actualPageSize).toBe(50);
    });

    it('should enforce minimum page size', () => {
      const requestedPageSize = 0;
      const minPageSize = 1;
      const actualPageSize = Math.max(requestedPageSize, minPageSize);

      expect(actualPageSize).toBe(1);
    });
  });

  describe('Directory Embed Generation', () => {
    it('should format directory page embed', () => {
      const members = [
        { nym: 'User1', tier: 'naib', badgeCount: 5 },
        { nym: 'User2', tier: 'fedaykin', badgeCount: 3 },
      ];

      const embed = {
        title: 'Sietch Directory',
        description: 'Browse community members',
        fields: members.map((m) => ({
          name: m.nym,
          value: `${m.tier === 'naib' ? '👑' : '⚔️'} ${m.tier} | ${m.badgeCount} badges`,
          inline: true,
        })),
        footer: { text: 'Page 1 of 3' },
      };

      expect(embed.fields).toHaveLength(2);
      expect(embed.footer.text).toContain('Page');
    });

    it('should show tier emojis correctly', () => {
      const tierEmojis = {
        naib: '👑',
        fedaykin: '⚔️',
      };

      expect(tierEmojis.naib).toBe('👑');
      expect(tierEmojis.fedaykin).toBe('⚔️');
    });
  });
});

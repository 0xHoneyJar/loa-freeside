/**
 * Role Manager Integration Tests
 *
 * Tests for dynamic role assignment based on badges and tenure.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GuildMember, Collection } from 'discord.js';

// Use vi.hoisted to ensure mocks are available at module load time
const { mockAssignRole, mockRemoveRole, mockGetMemberById } = vi.hoisted(() => ({
  mockAssignRole: vi.fn(),
  mockRemoveRole: vi.fn(),
  mockGetMemberById: vi.fn(),
}));

// Mock the config before imports
vi.mock('../../src/config.js', () => ({
  config: {
    discord: {
      roles: {
        naib: 'role_naib',
        fedaykin: 'role_fedaykin',
        onboarded: 'role_onboarded',
        engaged: 'role_engaged',
        veteran: 'role_veteran',
        trusted: 'role_trusted',
      },
      guildId: 'test_guild',
      channels: {
        theDoor: 'channel_door',
        census: 'channel_census',
      },
      botToken: 'test_token',
    },
    socialLayer: {
      profile: {
        launchDate: '2025-01-01T00:00:00Z',
      },
    },
  },
}));

// Mock the database queries
vi.mock('../../src/db/index.js', () => ({
  getMemberProfileById: vi.fn(),
  getMemberBadgeCount: vi.fn(),
  getMemberActivity: vi.fn(),
  memberHasBadge: vi.fn(),
  getDatabase: vi.fn(() => ({
    prepare: vi.fn(() => ({
      all: vi.fn(() => []),
      get: vi.fn(),
      run: vi.fn(),
    })),
  })),
  logAuditEvent: vi.fn(),
}));

// Mock the badge service
vi.mock('../../src/services/badge.js', () => ({
  checkRoleUpgrades: vi.fn(),
  ROLE_THRESHOLDS: {
    engaged: { badgeCount: 5, activityBalance: 200 },
    veteran: { tenureDays: 90 },
    trusted: { badgeCount: 10, helperBadge: true },
  },
}));

// Mock Discord service using hoisted mocks
vi.mock('../../src/services/discord.js', () => ({
  discordService: {
    assignRole: mockAssignRole,
    removeRole: mockRemoveRole,
    getMemberById: mockGetMemberById,
    isConnected: vi.fn(() => true),
  },
}));

// Import after mocks
import {
  isDynamicRolesEnabled,
  syncMemberRoles,
  assignOnboardedRole,
} from '../../src/services/roleManager.js';
import { checkRoleUpgrades } from '../../src/services/badge.js';
import { getMemberProfileById } from '../../src/db/index.js';

describe('Role Manager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAssignRole.mockResolvedValue(true);
    mockRemoveRole.mockResolvedValue(true);
  });

  describe('isDynamicRolesEnabled', () => {
    it('should return true when any dynamic role is configured', () => {
      expect(isDynamicRolesEnabled()).toBe(true);
    });
  });

  describe('syncMemberRoles', () => {
    it('should assign engaged role when member qualifies', async () => {
      const mockProfile = {
        memberId: 'member_123',
        discordUserId: 'discord_123',
        onboardingComplete: true,
        createdAt: new Date('2024-01-01'),
      };

      const mockRoles = {
        has: vi.fn((roleId: string) => false), // Member has no roles
      } as unknown as Collection<string, unknown>;

      const mockMember = {
        roles: { cache: mockRoles },
      } as unknown as GuildMember;

      vi.mocked(getMemberProfileById).mockReturnValue(mockProfile as any);
      vi.mocked(checkRoleUpgrades).mockReturnValue(['engaged']);
      mockGetMemberById.mockResolvedValue(mockMember);

      const result = await syncMemberRoles('member_123');

      expect(result.assigned).toContain('engaged');
      expect(mockAssignRole).toHaveBeenCalledWith('discord_123', 'role_engaged');
    });

    it('should not remove veteran role (permanent)', async () => {
      const mockProfile = {
        memberId: 'member_123',
        discordUserId: 'discord_123',
        onboardingComplete: true,
        createdAt: new Date('2024-01-01'),
      };

      const mockRoles = {
        has: vi.fn((roleId: string) => roleId === 'role_veteran'), // Has veteran role
      } as unknown as Collection<string, unknown>;

      const mockMember = {
        roles: { cache: mockRoles },
      } as unknown as GuildMember;

      vi.mocked(getMemberProfileById).mockReturnValue(mockProfile as any);
      vi.mocked(checkRoleUpgrades).mockReturnValue([]); // No longer qualifies
      mockGetMemberById.mockResolvedValue(mockMember);

      const result = await syncMemberRoles('member_123');

      // Should NOT remove veteran role
      expect(result.removed).not.toContain('veteran');
      expect(mockRemoveRole).not.toHaveBeenCalled();
    });

    it('should return empty arrays when member not onboarded', async () => {
      vi.mocked(getMemberProfileById).mockReturnValue({
        memberId: 'member_123',
        onboardingComplete: false,
      } as any);

      const result = await syncMemberRoles('member_123');

      expect(result.assigned).toHaveLength(0);
      expect(result.removed).toHaveLength(0);
    });

    it('should return empty arrays when member not found', async () => {
      vi.mocked(getMemberProfileById).mockReturnValue(null);

      const result = await syncMemberRoles('nonexistent');

      expect(result.assigned).toHaveLength(0);
      expect(result.removed).toHaveLength(0);
    });
  });

  describe('assignOnboardedRole', () => {
    it('should assign onboarded role successfully', async () => {
      mockAssignRole.mockResolvedValue(true);

      const result = await assignOnboardedRole('discord_123');

      expect(result).toBe(true);
      expect(mockAssignRole).toHaveBeenCalledWith('discord_123', 'role_onboarded');
    });

    it('should return false when role assignment fails', async () => {
      mockAssignRole.mockResolvedValue(false);

      const result = await assignOnboardedRole('discord_123');

      expect(result).toBe(false);
    });
  });
});

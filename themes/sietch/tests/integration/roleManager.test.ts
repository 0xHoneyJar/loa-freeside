/**
 * Role Manager Integration Tests
 *
 * Tests for dynamic role assignment based on badges, tenure, and tiers.
 * Sprint 10 (Global ID 173): Added comprehensive tier role tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GuildMember, Collection } from 'discord.js';

// Use vi.hoisted to ensure mocks are available at module load time
const { mockAssignRole, mockRemoveRole, mockGetMemberById } = vi.hoisted(() => ({
  mockAssignRole: vi.fn(),
  mockRemoveRole: vi.fn(),
  mockGetMemberById: vi.fn(),
}));

// Mock getTierRoleId function
const mockGetTierRoleId = vi.hoisted(() => vi.fn((tier: string) => {
  const roleMap: Record<string, string> = {
    hajra: 'role_hajra',
    ichwan: 'role_ichwan',
    qanat: 'role_qanat',
    sihaya: 'role_sihaya',
    mushtamal: 'role_mushtamal',
    sayyadina: 'role_sayyadina',
    usul: 'role_usul',
    fedaykin: 'role_fedaykin',
    naib: 'role_naib',
  };
  return roleMap[tier] ?? null;
}));

// Mock the config before imports
vi.mock('../../src/config.js', () => ({
  config: {
    discord: {
      roles: {
        hajra: 'role_hajra',
        ichwan: 'role_ichwan',
        qanat: 'role_qanat',
        sihaya: 'role_sihaya',
        mushtamal: 'role_mushtamal',
        sayyadina: 'role_sayyadina',
        usul: 'role_usul',
        naib: 'role_naib',
        fedaykin: 'role_fedaykin',
        onboarded: 'role_onboarded',
        engaged: 'role_engaged',
        veteran: 'role_veteran',
        trusted: 'role_trusted',
        formerNaib: 'role_former_naib',
        taqwa: 'role_taqwa',
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
  getTierRoleId: mockGetTierRoleId,
  getMissingTierRoles: vi.fn(() => []),
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
  syncTierRole,
  assignTierRolesUpTo,
  removeAllTierRoles,
  assignNaibRole,
  assignFormerNaibRole,
  removeNaibRole,
  isTierRolesConfigured,
} from '../../src/services/roleManager.js';
import { checkRoleUpgrades } from '../../src/services/badge.js';
import { getMemberProfileById, logAuditEvent } from '../../src/db/index.js';
import type { Tier } from '../../src/types/index.js';

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

  // ===========================================================================
  // Sprint 10 (Global ID 173): Tier Role Tests
  // ===========================================================================

  describe('syncTierRole', () => {
    it('should assign tier role when member does not have it', async () => {
      const mockRoles = {
        has: vi.fn(() => false), // Member has no tier roles
      } as unknown as Collection<string, unknown>;

      const mockMember = {
        roles: { cache: mockRoles },
      } as unknown as GuildMember;

      mockGetMemberById.mockResolvedValue(mockMember);

      const result = await syncTierRole('discord_123', 'ichwan');

      expect(result.assigned).toContain('ichwan');
      expect(mockAssignRole).toHaveBeenCalledWith('discord_123', 'role_ichwan');
    });

    it('should not assign tier role when member already has it', async () => {
      const mockRoles = {
        has: vi.fn((roleId: string) => roleId === 'role_ichwan'),
      } as unknown as Collection<string, unknown>;

      const mockMember = {
        roles: { cache: mockRoles },
      } as unknown as GuildMember;

      mockGetMemberById.mockResolvedValue(mockMember);

      const result = await syncTierRole('discord_123', 'ichwan');

      expect(result.assigned).toHaveLength(0);
      expect(mockAssignRole).not.toHaveBeenCalled();
    });

    it('should remove higher tier roles on demotion', async () => {
      const mockRoles = {
        has: vi.fn((roleId: string) => {
          // Member has qanat and sihaya roles
          return roleId === 'role_qanat' || roleId === 'role_sihaya';
        }),
      } as unknown as Collection<string, unknown>;

      const mockMember = {
        roles: { cache: mockRoles },
      } as unknown as GuildMember;

      mockGetMemberById.mockResolvedValue(mockMember);

      // Demote from sihaya to ichwan
      const result = await syncTierRole('discord_123', 'ichwan', 'sihaya');

      expect(result.assigned).toContain('ichwan');
      // Should remove qanat and sihaya (tiers above ichwan up to sihaya)
      expect(result.removed).toContain('qanat');
      expect(result.removed).toContain('sihaya');
    });

    it('should handle promotion without removing roles', async () => {
      const mockRoles = {
        has: vi.fn((roleId: string) => roleId === 'role_ichwan'),
      } as unknown as Collection<string, unknown>;

      const mockMember = {
        roles: { cache: mockRoles },
      } as unknown as GuildMember;

      mockGetMemberById.mockResolvedValue(mockMember);

      // Promote from ichwan to qanat
      const result = await syncTierRole('discord_123', 'qanat', 'ichwan');

      expect(result.assigned).toContain('qanat');
      expect(result.removed).toHaveLength(0);
    });

    it('should return empty arrays when Discord member not found', async () => {
      mockGetMemberById.mockResolvedValue(null);

      const result = await syncTierRole('nonexistent', 'ichwan');

      expect(result.assigned).toHaveLength(0);
      expect(result.removed).toHaveLength(0);
    });
  });

  describe('assignTierRolesUpTo', () => {
    it('should assign all BGT-based tier roles up to the given tier', async () => {
      const mockRoles = {
        has: vi.fn(() => false), // Member has no roles
      } as unknown as Collection<string, unknown>;

      const mockMember = {
        roles: { cache: mockRoles },
      } as unknown as GuildMember;

      mockGetMemberById.mockResolvedValue(mockMember);

      // Assign up to qanat (should get hajra, ichwan, qanat)
      const count = await assignTierRolesUpTo('discord_123', 'qanat');

      expect(count).toBe(3);
      expect(mockAssignRole).toHaveBeenCalledWith('discord_123', 'role_hajra');
      expect(mockAssignRole).toHaveBeenCalledWith('discord_123', 'role_ichwan');
      expect(mockAssignRole).toHaveBeenCalledWith('discord_123', 'role_qanat');
    });

    it('should skip already assigned roles', async () => {
      const mockRoles = {
        has: vi.fn((roleId: string) => roleId === 'role_hajra'), // Already has hajra
      } as unknown as Collection<string, unknown>;

      const mockMember = {
        roles: { cache: mockRoles },
      } as unknown as GuildMember;

      mockGetMemberById.mockResolvedValue(mockMember);

      const count = await assignTierRolesUpTo('discord_123', 'qanat');

      expect(count).toBe(2); // Only ichwan and qanat
      expect(mockAssignRole).not.toHaveBeenCalledWith('discord_123', 'role_hajra');
      expect(mockAssignRole).toHaveBeenCalledWith('discord_123', 'role_ichwan');
      expect(mockAssignRole).toHaveBeenCalledWith('discord_123', 'role_qanat');
    });

    it('should skip rank-based tiers (fedaykin, naib)', async () => {
      const mockRoles = {
        has: vi.fn(() => false),
      } as unknown as Collection<string, unknown>;

      const mockMember = {
        roles: { cache: mockRoles },
      } as unknown as GuildMember;

      mockGetMemberById.mockResolvedValue(mockMember);

      // Try to assign up to fedaykin - should only assign BGT-based tiers
      const count = await assignTierRolesUpTo('discord_123', 'fedaykin');

      // Should assign all 7 BGT-based tiers, not fedaykin
      expect(count).toBe(7);
      expect(mockAssignRole).not.toHaveBeenCalledWith('discord_123', 'role_fedaykin');
      expect(mockAssignRole).not.toHaveBeenCalledWith('discord_123', 'role_naib');
    });

    it('should return 0 when member not found', async () => {
      mockGetMemberById.mockResolvedValue(null);

      const count = await assignTierRolesUpTo('nonexistent', 'qanat');

      expect(count).toBe(0);
    });
  });

  describe('removeAllTierRoles', () => {
    it('should remove all tier roles from member', async () => {
      const mockRoles = {
        has: vi.fn((roleId: string) => {
          // Member has hajra, ichwan, qanat
          return ['role_hajra', 'role_ichwan', 'role_qanat'].includes(roleId);
        }),
      } as unknown as Collection<string, unknown>;

      const mockMember = {
        roles: { cache: mockRoles },
      } as unknown as GuildMember;

      mockGetMemberById.mockResolvedValue(mockMember);

      const count = await removeAllTierRoles('discord_123');

      expect(count).toBe(3);
      expect(mockRemoveRole).toHaveBeenCalledWith('discord_123', 'role_hajra');
      expect(mockRemoveRole).toHaveBeenCalledWith('discord_123', 'role_ichwan');
      expect(mockRemoveRole).toHaveBeenCalledWith('discord_123', 'role_qanat');
    });

    it('should return 0 when member has no tier roles', async () => {
      const mockRoles = {
        has: vi.fn(() => false),
      } as unknown as Collection<string, unknown>;

      const mockMember = {
        roles: { cache: mockRoles },
      } as unknown as GuildMember;

      mockGetMemberById.mockResolvedValue(mockMember);

      const count = await removeAllTierRoles('discord_123');

      expect(count).toBe(0);
      expect(mockRemoveRole).not.toHaveBeenCalled();
    });
  });

  describe('Naib Role Management', () => {
    describe('assignNaibRole', () => {
      it('should assign Naib role and remove Fedaykin', async () => {
        const result = await assignNaibRole('discord_123');

        expect(result).toBe(true);
        expect(mockAssignRole).toHaveBeenCalledWith('discord_123', 'role_naib');
        expect(mockRemoveRole).toHaveBeenCalledWith('discord_123', 'role_fedaykin');
      });

      it('should return false when Naib role assignment fails', async () => {
        mockAssignRole.mockResolvedValueOnce(false);

        const result = await assignNaibRole('discord_123');

        expect(result).toBe(false);
      });
    });

    describe('assignFormerNaibRole', () => {
      it('should remove Naib and assign Fedaykin + Former Naib', async () => {
        const result = await assignFormerNaibRole('discord_123');

        expect(result).toBe(true);
        expect(mockRemoveRole).toHaveBeenCalledWith('discord_123', 'role_naib');
        expect(mockAssignRole).toHaveBeenCalledWith('discord_123', 'role_fedaykin');
        expect(mockAssignRole).toHaveBeenCalledWith('discord_123', 'role_former_naib');
      });
    });

    describe('removeNaibRole', () => {
      it('should remove Naib role and assign Fedaykin', async () => {
        const result = await removeNaibRole('discord_123');

        expect(result).toBe(true);
        expect(mockRemoveRole).toHaveBeenCalledWith('discord_123', 'role_naib');
        expect(mockAssignRole).toHaveBeenCalledWith('discord_123', 'role_fedaykin');
      });
    });
  });

  describe('isTierRolesConfigured', () => {
    it('should return true when naib and fedaykin roles are configured', () => {
      expect(isTierRolesConfigured()).toBe(true);
    });
  });

  // ===========================================================================
  // Tier Transition Scenarios
  // ===========================================================================

  describe('Tier Transition Scenarios', () => {
    it('should handle promotion from Hajra to Ichwan', async () => {
      const mockRoles = {
        has: vi.fn((roleId: string) => roleId === 'role_hajra'),
      } as unknown as Collection<string, unknown>;

      const mockMember = {
        roles: { cache: mockRoles },
      } as unknown as GuildMember;

      mockGetMemberById.mockResolvedValue(mockMember);

      const result = await syncTierRole('discord_123', 'ichwan', 'hajra');

      expect(result.assigned).toContain('ichwan');
      expect(result.removed).toHaveLength(0);
    });

    it('should handle multi-tier promotion (Hajra to Qanat)', async () => {
      const mockRoles = {
        has: vi.fn((roleId: string) => roleId === 'role_hajra'),
      } as unknown as Collection<string, unknown>;

      const mockMember = {
        roles: { cache: mockRoles },
      } as unknown as GuildMember;

      mockGetMemberById.mockResolvedValue(mockMember);

      // Skip ichwan, go straight to qanat
      const result = await syncTierRole('discord_123', 'qanat', 'hajra');

      expect(result.assigned).toContain('qanat');
      expect(result.removed).toHaveLength(0);
    });

    it('should handle demotion from Qanat to Ichwan', async () => {
      const mockRoles = {
        has: vi.fn((roleId: string) => {
          return ['role_hajra', 'role_ichwan', 'role_qanat'].includes(roleId);
        }),
      } as unknown as Collection<string, unknown>;

      const mockMember = {
        roles: { cache: mockRoles },
      } as unknown as GuildMember;

      mockGetMemberById.mockResolvedValue(mockMember);

      // Demote from qanat to ichwan
      const result = await syncTierRole('discord_123', 'ichwan', 'qanat');

      expect(result.assigned).toHaveLength(0); // Already has ichwan
      expect(result.removed).toContain('qanat');
    });

    it('should handle BGT crossing from below threshold to above', async () => {
      // Simulate BGT increasing from 68 to 70 (crossing 69 Ichwan threshold)
      const mockRoles = {
        has: vi.fn((roleId: string) => roleId === 'role_hajra'),
      } as unknown as Collection<string, unknown>;

      const mockMember = {
        roles: { cache: mockRoles },
      } as unknown as GuildMember;

      mockGetMemberById.mockResolvedValue(mockMember);

      // Old tier: hajra (BGT was 68), new tier: ichwan (BGT is 70)
      const result = await syncTierRole('discord_123', 'ichwan', 'hajra');

      expect(result.assigned).toContain('ichwan');
    });

    it('should handle rank-based tier assignment (Fedaykin)', async () => {
      const mockRoles = {
        has: vi.fn((roleId: string) => roleId === 'role_usul'),
      } as unknown as Collection<string, unknown>;

      const mockMember = {
        roles: { cache: mockRoles },
      } as unknown as GuildMember;

      mockGetMemberById.mockResolvedValue(mockMember);

      // Rank enters top 69, assigns Fedaykin
      const result = await syncTierRole('discord_123', 'fedaykin', 'usul');

      expect(result.assigned).toContain('fedaykin');
    });

    it('should handle rank-based promotion to Naib', async () => {
      const mockRoles = {
        has: vi.fn((roleId: string) => roleId === 'role_fedaykin'),
      } as unknown as Collection<string, unknown>;

      const mockMember = {
        roles: { cache: mockRoles },
      } as unknown as GuildMember;

      mockGetMemberById.mockResolvedValue(mockMember);

      // Rank enters top 7, assigns Naib
      const result = await syncTierRole('discord_123', 'naib', 'fedaykin');

      expect(result.assigned).toContain('naib');
    });
  });
});

/**
 * VerificationTiersService Tests
 *
 * Sprint 60: Verification Tiers - Feature Gating
 *
 * Tests for the verification tiers system including:
 * - Tier determination based on verification status
 * - Feature access control
 * - Tier upgrades on wallet connection
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  VerificationTiersService,
  createVerificationTiersService,
  type VerificationTier,
  type FeatureId,
  type MemberVerificationStatus,
  TIER_1_FEATURES,
  TIER_2_FEATURES,
  TIER_3_FEATURES,
  FEATURE_TIER_REQUIREMENTS,
  TIER_HIERARCHY,
} from '../../../../../src/packages/core/services/VerificationTiersService.js';
import type { ICoexistenceStorage } from '../../../../../src/packages/core/ports/ICoexistenceStorage.js';

// =============================================================================
// Test Fixtures
// =============================================================================

const createMockStorage = (): ICoexistenceStorage => ({
  getIncumbentConfig: vi.fn(),
  saveIncumbentConfig: vi.fn(),
  updateIncumbentHealth: vi.fn(),
  deleteIncumbentConfig: vi.fn(),
  hasIncumbent: vi.fn(),
  getMigrationState: vi.fn(),
  saveMigrationState: vi.fn(),
  getCurrentMode: vi.fn(),
  updateMode: vi.fn(),
  recordRollback: vi.fn(),
  initializeShadowMode: vi.fn(),
  getCommunitiesByMode: vi.fn(),
  getReadyCommunities: vi.fn(),
  getIncumbentHealthOverview: vi.fn(),
  getShadowMemberState: vi.fn(),
  getShadowMemberStates: vi.fn(),
  saveShadowMemberState: vi.fn(),
  batchSaveShadowMemberStates: vi.fn(),
  deleteShadowMemberState: vi.fn(),
  saveDivergence: vi.fn(),
  getDivergences: vi.fn(),
  getDivergenceStats: vi.fn(),
  updateShadowSnapshot: vi.fn(),
  getShadowSnapshot: vi.fn(),
  getParallelRoleConfig: vi.fn(),
  saveParallelRoleConfig: vi.fn(),
  deleteParallelRoleConfig: vi.fn(),
  isRolesEnabled: vi.fn(),
  getParallelRole: vi.fn(),
  getParallelRoles: vi.fn(),
  saveParallelRole: vi.fn(),
  updateParallelRoleMemberCount: vi.fn(),
  deleteParallelRole: vi.fn(),
  deleteAllParallelRoles: vi.fn(),
  getParallelRoleAssignment: vi.fn(),
  getMemberRoleAssignments: vi.fn(),
  getRoleAssignmentMembers: vi.fn(),
  saveParallelRoleAssignment: vi.fn(),
  batchSaveParallelRoleAssignments: vi.fn(),
  deleteParallelRoleAssignment: vi.fn(),
  getMembersNeedingRoleGrant: vi.fn(),
  getMembersNeedingRoleRevocation: vi.fn(),
  getParallelChannelConfig: vi.fn(),
  saveParallelChannelConfig: vi.fn(),
  deleteParallelChannelConfig: vi.fn(),
  isChannelsEnabled: vi.fn(),
  getParallelChannel: vi.fn(),
  getParallelChannels: vi.fn(),
  getParallelChannelsByConviction: vi.fn(),
  saveParallelChannel: vi.fn(),
  updateParallelChannelAccessCount: vi.fn(),
  deleteParallelChannel: vi.fn(),
  deleteAllParallelChannels: vi.fn(),
  getParallelChannelAccess: vi.fn(),
  getMemberChannelAccess: vi.fn(),
  getChannelAccessMembers: vi.fn(),
  saveParallelChannelAccess: vi.fn(),
  batchSaveParallelChannelAccess: vi.fn(),
  deleteParallelChannelAccess: vi.fn(),
  getMembersNeedingAccess: vi.fn(),
  getMembersNeedingRevocation: vi.fn(),
} as unknown as ICoexistenceStorage);

const createStatus = (overrides: Partial<MemberVerificationStatus> = {}): MemberVerificationStatus => ({
  communityId: 'community-123',
  memberId: 'member-456',
  hasIncumbentAccess: false,
  hasArrakisWallet: false,
  isArrakisVerified: false,
  ...overrides,
});

// =============================================================================
// Tests
// =============================================================================

describe('VerificationTiersService', () => {
  let service: VerificationTiersService;
  let mockStorage: ICoexistenceStorage;

  beforeEach(() => {
    mockStorage = createMockStorage();
    service = createVerificationTiersService(mockStorage);
  });

  // ===========================================================================
  // TASK-60.1: VerificationTier Enum
  // ===========================================================================

  describe('VerificationTier type', () => {
    it('has three tiers in correct hierarchy', () => {
      expect(TIER_HIERARCHY['incumbent_only']).toBe(1);
      expect(TIER_HIERARCHY['arrakis_basic']).toBe(2);
      expect(TIER_HIERARCHY['arrakis_full']).toBe(3);
    });

    it('hierarchy values are sequential', () => {
      const values = Object.values(TIER_HIERARCHY);
      expect(values).toEqual([1, 2, 3]);
    });
  });

  // ===========================================================================
  // TASK-60.3: getMemberTier()
  // ===========================================================================

  describe('getMemberTier()', () => {
    it('returns incumbent_only for users without wallet', () => {
      const status = createStatus({
        hasIncumbentAccess: true,
        hasArrakisWallet: false,
        isArrakisVerified: false,
      });

      expect(service.getMemberTier(status)).toBe('incumbent_only');
    });

    it('returns incumbent_only for users with no access', () => {
      const status = createStatus({
        hasIncumbentAccess: false,
        hasArrakisWallet: false,
        isArrakisVerified: false,
      });

      expect(service.getMemberTier(status)).toBe('incumbent_only');
    });

    it('returns arrakis_basic for users with wallet but not verified', () => {
      const status = createStatus({
        hasArrakisWallet: true,
        walletAddress: '0x123',
        isArrakisVerified: false,
      });

      expect(service.getMemberTier(status)).toBe('arrakis_basic');
    });

    it('returns arrakis_full for fully verified users', () => {
      const status = createStatus({
        hasArrakisWallet: true,
        walletAddress: '0x123',
        isArrakisVerified: true,
      });

      expect(service.getMemberTier(status)).toBe('arrakis_full');
    });

    it('returns arrakis_full only when both wallet and verified', () => {
      // Has verified flag but no wallet - should still be incumbent_only
      const status = createStatus({
        hasArrakisWallet: false,
        isArrakisVerified: true,
      });

      expect(service.getMemberTier(status)).toBe('incumbent_only');
    });
  });

  // ===========================================================================
  // TASK-60.4: getFeatures()
  // ===========================================================================

  describe('getFeatures()', () => {
    it('returns Tier 1 features for incumbent_only', () => {
      const features = service.getFeatures('incumbent_only');

      expect(features.tier).toBe('incumbent_only');
      expect(features.displayName).toBe('Basic Access');
      expect(features.features).toEqual(TIER_1_FEATURES);
      expect(features.upgradeTo).toBeDefined();
      expect(features.upgradeTo?.tier).toBe('arrakis_basic');
    });

    it('returns Tier 2 features for arrakis_basic', () => {
      const features = service.getFeatures('arrakis_basic');

      expect(features.tier).toBe('arrakis_basic');
      expect(features.displayName).toBe('Arrakis Basic');
      expect(features.features).toEqual(TIER_2_FEATURES);
      expect(features.upgradeTo).toBeDefined();
      expect(features.upgradeTo?.tier).toBe('arrakis_full');
    });

    it('returns Tier 3 features for arrakis_full', () => {
      const features = service.getFeatures('arrakis_full');

      expect(features.tier).toBe('arrakis_full');
      expect(features.displayName).toBe('Arrakis Full');
      expect(features.features).toEqual(TIER_3_FEATURES);
      expect(features.upgradeTo).toBeUndefined(); // No upgrade for top tier
    });

    it('Tier 2 features include all Tier 1 features', () => {
      const tier1Features = TIER_1_FEATURES.map((f) => f.featureId);
      const tier2Features = TIER_2_FEATURES.map((f) => f.featureId);

      for (const t1Feature of tier1Features) {
        expect(tier2Features).toContain(t1Feature);
      }
    });

    it('Tier 3 features include exclusive features', () => {
      const tier3FeatureIds = TIER_3_FEATURES.map((f) => f.featureId);

      expect(tier3FeatureIds).toContain('full_profile');
      expect(tier3FeatureIds).toContain('badge_showcase');
      expect(tier3FeatureIds).toContain('water_sharing');
      expect(tier3FeatureIds).toContain('directory_listing');
    });
  });

  // ===========================================================================
  // TASK-60.5: canAccess()
  // ===========================================================================

  describe('canAccess()', () => {
    // TASK-60.9: Test tier 1 features only for incumbent_only
    describe('Tier 1 (incumbent_only) access', () => {
      it('allows shadow_tracking', () => {
        const status = createStatus({ hasIncumbentAccess: true });
        const result = service.canAccess({ featureId: 'shadow_tracking', status });

        expect(result.allowed).toBe(true);
        expect(result.tier).toBe('incumbent_only');
      });

      it('allows public_leaderboard', () => {
        const status = createStatus({ hasIncumbentAccess: true });
        const result = service.canAccess({ featureId: 'public_leaderboard', status });

        expect(result.allowed).toBe(true);
      });

      it('allows leaderboard_position', () => {
        const status = createStatus({ hasIncumbentAccess: true });
        const result = service.canAccess({ featureId: 'leaderboard_position', status });

        expect(result.allowed).toBe(true);
      });

      it('denies profile_view for incumbent_only', () => {
        const status = createStatus({ hasIncumbentAccess: true });
        const result = service.canAccess({ featureId: 'profile_view', status });

        expect(result.allowed).toBe(false);
        expect(result.requiredTier).toBe('arrakis_basic');
        expect(result.upgradeAction).toBeDefined();
      });

      it('denies full_profile for incumbent_only', () => {
        const status = createStatus({ hasIncumbentAccess: true });
        const result = service.canAccess({ featureId: 'full_profile', status });

        expect(result.allowed).toBe(false);
        expect(result.requiredTier).toBe('arrakis_full');
      });
    });

    describe('Tier 2 (arrakis_basic) access', () => {
      it('allows profile_view', () => {
        const status = createStatus({
          hasArrakisWallet: true,
          walletAddress: '0x123',
        });
        const result = service.canAccess({ featureId: 'profile_view', status });

        expect(result.allowed).toBe(true);
        expect(result.tier).toBe('arrakis_basic');
      });

      it('allows conviction_preview', () => {
        const status = createStatus({
          hasArrakisWallet: true,
          walletAddress: '0x123',
        });
        const result = service.canAccess({ featureId: 'conviction_preview', status });

        expect(result.allowed).toBe(true);
      });

      it('allows badge_preview', () => {
        const status = createStatus({
          hasArrakisWallet: true,
          walletAddress: '0x123',
        });
        const result = service.canAccess({ featureId: 'badge_preview', status });

        expect(result.allowed).toBe(true);
      });

      it('denies badge_showcase for arrakis_basic', () => {
        const status = createStatus({
          hasArrakisWallet: true,
          walletAddress: '0x123',
        });
        const result = service.canAccess({ featureId: 'badge_showcase', status });

        expect(result.allowed).toBe(false);
        expect(result.requiredTier).toBe('arrakis_full');
      });

      it('denies water_sharing for arrakis_basic', () => {
        const status = createStatus({
          hasArrakisWallet: true,
          walletAddress: '0x123',
        });
        const result = service.canAccess({ featureId: 'water_sharing', status });

        expect(result.allowed).toBe(false);
        expect(result.requiredTier).toBe('arrakis_full');
      });
    });

    describe('Tier 3 (arrakis_full) access', () => {
      it('allows all features', () => {
        const status = createStatus({
          hasArrakisWallet: true,
          walletAddress: '0x123',
          isArrakisVerified: true,
        });

        // Check all features
        for (const featureId of Object.keys(FEATURE_TIER_REQUIREMENTS) as FeatureId[]) {
          const result = service.canAccess({ featureId, status });
          expect(result.allowed).toBe(true);
        }
      });

      it('allows full_profile', () => {
        const status = createStatus({
          hasArrakisWallet: true,
          walletAddress: '0x123',
          isArrakisVerified: true,
        });
        const result = service.canAccess({ featureId: 'full_profile', status });

        expect(result.allowed).toBe(true);
        expect(result.tier).toBe('arrakis_full');
      });

      it('allows water_sharing', () => {
        const status = createStatus({
          hasArrakisWallet: true,
          walletAddress: '0x123',
          isArrakisVerified: true,
        });
        const result = service.canAccess({ featureId: 'water_sharing', status });

        expect(result.allowed).toBe(true);
      });

      it('allows directory_listing', () => {
        const status = createStatus({
          hasArrakisWallet: true,
          walletAddress: '0x123',
          isArrakisVerified: true,
        });
        const result = service.canAccess({ featureId: 'directory_listing', status });

        expect(result.allowed).toBe(true);
      });
    });

    describe('unknown feature handling', () => {
      it('denies unknown features', () => {
        const status = createStatus({
          hasArrakisWallet: true,
          isArrakisVerified: true,
        });
        const result = service.canAccess({
          featureId: 'nonexistent_feature' as FeatureId,
          status,
        });

        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('Unknown feature');
      });
    });
  });

  // ===========================================================================
  // TASK-60.10: Tier upgrade on wallet connect
  // ===========================================================================

  describe('upgradeTierOnWalletConnect()', () => {
    it('upgrades incumbent_only to arrakis_basic', () => {
      const currentStatus = createStatus({
        hasIncumbentAccess: true,
        hasArrakisWallet: false,
      });

      expect(service.getMemberTier(currentStatus)).toBe('incumbent_only');

      const newStatus = service.upgradeTierOnWalletConnect(currentStatus, '0xNewWallet');

      expect(service.getMemberTier(newStatus)).toBe('arrakis_basic');
      expect(newStatus.hasArrakisWallet).toBe(true);
      expect(newStatus.walletAddress).toBe('0xNewWallet');
      expect(newStatus.walletConnectedAt).toBeDefined();
    });

    it('preserves existing data on upgrade', () => {
      const currentStatus = createStatus({
        communityId: 'community-abc',
        memberId: 'member-xyz',
        hasIncumbentAccess: true,
      });

      const newStatus = service.upgradeTierOnWalletConnect(currentStatus, '0x123');

      expect(newStatus.communityId).toBe('community-abc');
      expect(newStatus.memberId).toBe('member-xyz');
      expect(newStatus.hasIncumbentAccess).toBe(true);
    });

    it('sets wallet connected timestamp', () => {
      const before = new Date();
      const currentStatus = createStatus();
      const newStatus = service.upgradeTierOnWalletConnect(currentStatus, '0x123');
      const after = new Date();

      expect(newStatus.walletConnectedAt).toBeDefined();
      expect(newStatus.walletConnectedAt!.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(newStatus.walletConnectedAt!.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });

  describe('upgradeTierOnVerification()', () => {
    it('upgrades arrakis_basic to arrakis_full', () => {
      const currentStatus = createStatus({
        hasArrakisWallet: true,
        walletAddress: '0x123',
        isArrakisVerified: false,
      });

      expect(service.getMemberTier(currentStatus)).toBe('arrakis_basic');

      const newStatus = service.upgradeTierOnVerification(currentStatus);

      expect(service.getMemberTier(newStatus)).toBe('arrakis_full');
      expect(newStatus.isArrakisVerified).toBe(true);
    });

    it('preserves wallet data on verification', () => {
      const currentStatus = createStatus({
        hasArrakisWallet: true,
        walletAddress: '0xMyWallet',
        walletConnectedAt: new Date('2024-01-01'),
      });

      const newStatus = service.upgradeTierOnVerification(currentStatus);

      expect(newStatus.walletAddress).toBe('0xMyWallet');
      expect(newStatus.walletConnectedAt).toEqual(new Date('2024-01-01'));
    });
  });

  // ===========================================================================
  // Tier Comparison Methods
  // ===========================================================================

  describe('isTierHigher()', () => {
    it('returns true when first tier is higher', () => {
      expect(service.isTierHigher('arrakis_full', 'arrakis_basic')).toBe(true);
      expect(service.isTierHigher('arrakis_basic', 'incumbent_only')).toBe(true);
      expect(service.isTierHigher('arrakis_full', 'incumbent_only')).toBe(true);
    });

    it('returns false when first tier is lower or equal', () => {
      expect(service.isTierHigher('incumbent_only', 'arrakis_basic')).toBe(false);
      expect(service.isTierHigher('incumbent_only', 'incumbent_only')).toBe(false);
      expect(service.isTierHigher('arrakis_full', 'arrakis_full')).toBe(false);
    });
  });

  describe('meetsTierRequirement()', () => {
    it('returns true when tier meets or exceeds requirement', () => {
      expect(service.meetsTierRequirement('arrakis_full', 'arrakis_full')).toBe(true);
      expect(service.meetsTierRequirement('arrakis_full', 'arrakis_basic')).toBe(true);
      expect(service.meetsTierRequirement('arrakis_basic', 'arrakis_basic')).toBe(true);
      expect(service.meetsTierRequirement('arrakis_basic', 'incumbent_only')).toBe(true);
    });

    it('returns false when tier is below requirement', () => {
      expect(service.meetsTierRequirement('incumbent_only', 'arrakis_basic')).toBe(false);
      expect(service.meetsTierRequirement('arrakis_basic', 'arrakis_full')).toBe(false);
    });
  });

  // ===========================================================================
  // Feature Query Methods
  // ===========================================================================

  describe('getAllFeatureAccess()', () => {
    it('returns access results for all features', () => {
      const status = createStatus({
        hasArrakisWallet: true,
        walletAddress: '0x123',
      });

      const results = service.getAllFeatureAccess(status);

      expect(results.size).toBe(Object.keys(FEATURE_TIER_REQUIREMENTS).length);
      expect(results.get('profile_view')?.allowed).toBe(true);
      expect(results.get('full_profile')?.allowed).toBe(false);
    });
  });

  describe('getUnlockableFeatures()', () => {
    it('returns features unlocked by upgrade', () => {
      const unlockable = service.getUnlockableFeatures('incumbent_only', 'arrakis_basic');

      expect(unlockable).toContain('profile_view');
      expect(unlockable).toContain('conviction_preview');
      expect(unlockable).not.toContain('shadow_tracking'); // Already unlocked
      expect(unlockable).not.toContain('full_profile'); // Requires higher tier
    });

    it('returns empty array for same tier', () => {
      const unlockable = service.getUnlockableFeatures('arrakis_basic', 'arrakis_basic');
      expect(unlockable).toEqual([]);
    });

    it('returns empty array for downgrade', () => {
      const unlockable = service.getUnlockableFeatures('arrakis_full', 'arrakis_basic');
      expect(unlockable).toEqual([]);
    });

    it('returns all tier 3 exclusive features for full upgrade', () => {
      const unlockable = service.getUnlockableFeatures('arrakis_basic', 'arrakis_full');

      expect(unlockable).toContain('full_profile');
      expect(unlockable).toContain('badge_showcase');
      expect(unlockable).toContain('water_sharing');
      expect(unlockable).toContain('directory_listing');
    });
  });

  describe('getTierDisplayName()', () => {
    it('returns correct display names', () => {
      expect(service.getTierDisplayName('incumbent_only')).toBe('Basic Access');
      expect(service.getTierDisplayName('arrakis_basic')).toBe('Arrakis Basic');
      expect(service.getTierDisplayName('arrakis_full')).toBe('Arrakis Full');
    });
  });
});

describe('Factory function', () => {
  it('createVerificationTiersService creates instance', () => {
    const mockStorage = createMockStorage();
    const service = createVerificationTiersService(mockStorage);

    expect(service).toBeInstanceOf(VerificationTiersService);
  });
});

describe('Feature tier constants', () => {
  it('TIER_1_FEATURES has expected features', () => {
    const featureIds = TIER_1_FEATURES.map((f) => f.featureId);
    expect(featureIds).toContain('shadow_tracking');
    expect(featureIds).toContain('public_leaderboard');
  });

  it('TIER_2_FEATURES includes tier 1 features', () => {
    const tier1Ids = TIER_1_FEATURES.map((f) => f.featureId);
    const tier2Ids = TIER_2_FEATURES.map((f) => f.featureId);

    for (const id of tier1Ids) {
      expect(tier2Ids).toContain(id);
    }
  });

  it('TIER_3_FEATURES has all exclusive features', () => {
    const featureIds = TIER_3_FEATURES.map((f) => f.featureId);
    expect(featureIds).toContain('full_profile');
    expect(featureIds).toContain('water_sharing');
    expect(featureIds).toContain('conviction_history');
  });

  it('FEATURE_TIER_REQUIREMENTS covers all feature IDs', () => {
    const allFeatures = [
      ...TIER_1_FEATURES,
      ...TIER_2_FEATURES,
      ...TIER_3_FEATURES,
    ].map((f) => f.featureId);

    const uniqueFeatures = [...new Set(allFeatures)];

    for (const featureId of uniqueFeatures) {
      expect(FEATURE_TIER_REQUIREMENTS[featureId]).toBeDefined();
    }
  });
});

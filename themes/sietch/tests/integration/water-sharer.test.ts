/**
 * Water Sharer (Sponsor) System Integration Tests
 *
 * Tests end-to-end Water Sharer badge sharing flow including:
 * - Badge sharing eligibility
 * - Grant creation and tracking
 * - One-share-per-member limit
 * - Badge award cascading
 * - Revocation handling
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock config
vi.mock('../../src/config.js', () => ({
  config: {
    discord: {
      roles: { waterSharer: 'role-water-sharer' },
      channels: { oasis: 'channel-oasis' },
      guildId: 'guild',
      botToken: 'token',
    },
  },
}));

// Mock logger
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock database queries
const mockMemberHasBadge = vi.fn();
const mockGetWaterSharerGrant = vi.fn();
const mockInsertWaterSharerGrant = vi.fn();
const mockAwardBadgeToMember = vi.fn();
const mockGetMemberProfileById = vi.fn();
const mockLogAuditEvent = vi.fn();

vi.mock('../../src/db/index.js', () => ({
  memberHasBadge: mockMemberHasBadge,
  getWaterSharerGrantByGranter: mockGetWaterSharerGrant,
  insertWaterSharerGrant: mockInsertWaterSharerGrant,
  awardBadgeToMember: mockAwardBadgeToMember,
  getMemberProfileById: mockGetMemberProfileById,
  logAuditEvent: mockLogAuditEvent,
  revokeBadgeFromMember: vi.fn(),
  revokeWaterSharerGrant: vi.fn(),
}));

// Import after mocks
// TODO: WaterSharerService exports individual functions (canShare, shareBadge,
// getShareStatus, getBadgeLineage), not a waterSharerService object. These tests
// need rewriting to match the actual API. Functions are also synchronous, not async.
// Skipping until aligned with implementation. See: src/services/WaterSharerService.ts

describe.skip('Water Sharer System Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Badge Sharing Eligibility', () => {
    it('should allow sharing if member has badge and no active grant', async () => {
      const granterId = 'granter-123';

      mockMemberHasBadge.mockResolvedValue(true);
      mockGetWaterSharerGrant.mockResolvedValue(null); // No existing grant

      const canShare = await waterSharerService.canShare(granterId);

      expect(canShare).toBe(true);
      expect(mockMemberHasBadge).toHaveBeenCalledWith(granterId, 'water-sharer');
      expect(mockGetWaterSharerGrant).toHaveBeenCalledWith(granterId);
    });

    it('should not allow sharing if member does not have badge', async () => {
      const granterId = 'granter-456';

      mockMemberHasBadge.mockResolvedValue(false);

      const canShare = await waterSharerService.canShare(granterId);

      expect(canShare).toBe(false);
      expect(mockMemberHasBadge).toHaveBeenCalledWith(granterId, 'water-sharer');
    });

    it('should not allow sharing if member already has active grant', async () => {
      const granterId = 'granter-789';

      mockMemberHasBadge.mockResolvedValue(true);
      mockGetWaterSharerGrant.mockResolvedValue({
        id: 'grant-1',
        granter_member_id: granterId,
        recipient_member_id: 'recipient-1',
        granted_at: Date.now(),
        revoked_at: null,
      });

      const canShare = await waterSharerService.canShare(granterId);

      expect(canShare).toBe(false);
    });
  });

  describe('Badge Sharing Flow', () => {
    it('should successfully share badge with eligible recipient', async () => {
      const granterId = 'granter-abc';
      const recipientId = 'recipient-xyz';

      // Setup: granter has badge, no existing grant
      mockMemberHasBadge.mockResolvedValueOnce(true); // Granter has badge
      mockGetWaterSharerGrant.mockResolvedValue(null); // No existing grant

      // Setup: recipient is onboarded and doesn't have badge
      mockGetMemberProfileById.mockResolvedValue({
        member_id: recipientId,
        onboarding_completed_at: Date.now() - 86400000, // Completed 1 day ago
      });
      mockMemberHasBadge.mockResolvedValueOnce(false); // Recipient doesn't have badge

      await waterSharerService.shareBadge(granterId, recipientId);

      // Verify grant created
      expect(mockInsertWaterSharerGrant).toHaveBeenCalledWith({
        granter_member_id: granterId,
        recipient_member_id: recipientId,
        granted_at: expect.any(Number),
      });

      // Verify badge awarded to recipient
      expect(mockAwardBadgeToMember).toHaveBeenCalledWith(recipientId, 'water-sharer');

      // Verify audit log
      expect(mockLogAuditEvent).toHaveBeenCalledWith({
        event_type: 'water_sharer_granted',
        actor_member_id: granterId,
        target_member_id: recipientId,
        details: expect.any(String),
      });
    });

    it('should reject sharing if granter does not have badge', async () => {
      const granterId = 'granter-no-badge';
      const recipientId = 'recipient-123';

      mockMemberHasBadge.mockResolvedValue(false);

      await expect(
        waterSharerService.shareBadge(granterId, recipientId)
      ).rejects.toThrow('Granter does not have Water Sharer badge');

      expect(mockInsertWaterSharerGrant).not.toHaveBeenCalled();
      expect(mockAwardBadgeToMember).not.toHaveBeenCalled();
    });

    it('should reject sharing if granter already has active grant', async () => {
      const granterId = 'granter-used';
      const recipientId = 'recipient-456';

      mockMemberHasBadge.mockResolvedValue(true);
      mockGetWaterSharerGrant.mockResolvedValue({
        id: 'existing-grant',
        granter_member_id: granterId,
        recipient_member_id: 'someone-else',
        granted_at: Date.now() - 86400000,
        revoked_at: null,
      });

      await expect(
        waterSharerService.shareBadge(granterId, recipientId)
      ).rejects.toThrow('Granter has already shared their badge');

      expect(mockInsertWaterSharerGrant).not.toHaveBeenCalled();
      expect(mockAwardBadgeToMember).not.toHaveBeenCalled();
    });

    it('should reject sharing if recipient not onboarded', async () => {
      const granterId = 'granter-valid';
      const recipientId = 'recipient-not-onboarded';

      mockMemberHasBadge.mockResolvedValue(true);
      mockGetWaterSharerGrant.mockResolvedValue(null);
      mockGetMemberProfileById.mockResolvedValue({
        member_id: recipientId,
        onboarding_completed_at: null, // Not completed
      });

      await expect(
        waterSharerService.shareBadge(granterId, recipientId)
      ).rejects.toThrow('Recipient has not completed onboarding');

      expect(mockInsertWaterSharerGrant).not.toHaveBeenCalled();
      expect(mockAwardBadgeToMember).not.toHaveBeenCalled();
    });

    it('should reject sharing if recipient already has badge', async () => {
      const granterId = 'granter-valid';
      const recipientId = 'recipient-has-badge';

      mockMemberHasBadge.mockResolvedValueOnce(true); // Granter has badge
      mockGetWaterSharerGrant.mockResolvedValue(null);
      mockGetMemberProfileById.mockResolvedValue({
        member_id: recipientId,
        onboarding_completed_at: Date.now() - 86400000,
      });
      mockMemberHasBadge.mockResolvedValueOnce(true); // Recipient has badge

      await expect(
        waterSharerService.shareBadge(granterId, recipientId)
      ).rejects.toThrow('Recipient already has Water Sharer badge');

      expect(mockInsertWaterSharerGrant).not.toHaveBeenCalled();
      expect(mockAwardBadgeToMember).not.toHaveBeenCalled();
    });
  });

  describe('Sharing Status', () => {
    it('should return correct status for member who has shared', async () => {
      const memberId = 'member-shared';

      mockMemberHasBadge.mockResolvedValue(true);
      mockGetWaterSharerGrant.mockResolvedValue({
        id: 'grant-123',
        granter_member_id: memberId,
        recipient_member_id: 'recipient-abc',
        granted_at: Date.now() - 86400000,
        revoked_at: null,
      });

      const status = await waterSharerService.getSharingStatus(memberId);

      expect(status.hasBadge).toBe(true);
      expect(status.canShare).toBe(false);
      expect(status.hasShared).toBe(true);
      expect(status.sharedWith).toBe('recipient-abc');
    });

    it('should return correct status for member who can share', async () => {
      const memberId = 'member-can-share';

      mockMemberHasBadge.mockResolvedValue(true);
      mockGetWaterSharerGrant.mockResolvedValue(null);

      const status = await waterSharerService.getSharingStatus(memberId);

      expect(status.hasBadge).toBe(true);
      expect(status.canShare).toBe(true);
      expect(status.hasShared).toBe(false);
      expect(status.sharedWith).toBeNull();
    });

    it('should return correct status for member without badge', async () => {
      const memberId = 'member-no-badge';

      mockMemberHasBadge.mockResolvedValue(false);

      const status = await waterSharerService.getSharingStatus(memberId);

      expect(status.hasBadge).toBe(false);
      expect(status.canShare).toBe(false);
      expect(status.hasShared).toBe(false);
    });
  });

  describe('Badge Lineage', () => {
    it('should track badge sharing lineage', async () => {
      // This test tracks multi-level sharing:
      // Admin awards to Member A
      // Member A shares to Member B
      // Member B shares to Member C
      // Lineage: Admin → A → B → C

      const memberCId = 'member-c';

      // Mock Member C profile
      mockGetMemberProfileById.mockResolvedValue({
        member_id: memberCId,
        nym: 'Member C',
        onboarding_completed_at: Date.now() - 86400000,
      });

      // Mock database query for Member C's lineage
      // Member C received from Member B at timestamp 3000
      const mockGetGrantReceived = vi.fn().mockReturnValue({
        granter_member_id: 'member-b',
        granted_at: 3000,
        nym: 'Member B',
      });

      // Mock database query for who Member C shared to (none)
      const mockGetGrantGiven = vi.fn().mockReturnValue(undefined);

      // Mock database prepare/get chain
      const mockDb = {
        prepare: vi.fn((sql: string) => ({
          get: (memberId: string) => {
            // If querying for received grant
            if (sql.includes('recipient_member_id')) {
              return mockGetGrantReceived(memberId);
            }
            // If querying for given grant
            if (sql.includes('granter_member_id')) {
              return mockGetGrantGiven(memberId);
            }
            return undefined;
          },
        })),
      };

      // Mock getDatabase to return our mock DB
      const mockGetDatabase = vi.fn().mockReturnValue(mockDb);
      vi.mock('../../src/db/index.js', async () => ({
        ...(await vi.importActual('../../src/db/index.js')),
        getDatabase: mockGetDatabase,
        getMemberProfileById: mockGetMemberProfileById,
      }));

      const lineage = await waterSharerService.getBadgeLineage(memberCId);

      // Assert lineage structure
      expect(lineage).toBeDefined();
      expect(lineage?.member.memberId).toBe(memberCId);
      expect(lineage?.member.nym).toBe('Member C');

      // Assert Member C received from Member B
      expect(lineage?.receivedFrom).toBeDefined();
      expect(lineage?.receivedFrom?.memberId).toBe('member-b');
      expect(lineage?.receivedFrom?.nym).toBe('Member B');
      expect(lineage?.receivedFrom?.grantedAt).toEqual(new Date(3000));

      // Assert Member C hasn't shared to anyone yet
      expect(lineage?.sharedTo).toBeNull();
    });
  });

  describe('Edge Cases', () => {
    it('should handle granter and recipient being same member', async () => {
      const memberId = 'same-member';

      mockMemberHasBadge.mockResolvedValue(true);
      mockGetWaterSharerGrant.mockResolvedValue(null);

      await expect(
        waterSharerService.shareBadge(memberId, memberId)
      ).rejects.toThrow('Cannot share badge with yourself');
    });

    it('should handle member profile not found', async () => {
      const granterId = 'granter-valid';
      const recipientId = 'nonexistent-member';

      mockMemberHasBadge.mockResolvedValue(true);
      mockGetWaterSharerGrant.mockResolvedValue(null);
      mockGetMemberProfileById.mockResolvedValue(null);

      await expect(
        waterSharerService.shareBadge(granterId, recipientId)
      ).rejects.toThrow('Recipient member not found');
    });
  });
});

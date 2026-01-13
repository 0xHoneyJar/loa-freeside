/**
 * Waiver Service Tests (v4.0 - Sprint 26)
 *
 * Test suite for WaiverService covering:
 * - Granting waivers
 * - Revoking waivers
 * - Querying waivers
 * - Validation logic
 * - Cache invalidation
 * - Audit logging
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { waiverService } from '../../../src/services/billing/WaiverService.js';
import * as billingQueries from '../../../src/db/billing-queries.js';
import { gatekeeperService } from '../../../src/services/billing/GatekeeperService.js';
import type { FeeWaiver, SubscriptionTier } from '../../../src/types/billing.js';

// =============================================================================
// Mocks
// =============================================================================

vi.mock('../../../src/config.js', () => ({
  config: {
    features: {
      billing: true,
    },
  },
  isBillingEnabled: () => true,
}));

vi.mock('../../../src/db/billing-queries.js');
vi.mock('../../../src/services/billing/GatekeeperService.js');
vi.mock('../../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  },
}));

// =============================================================================
// Test Fixtures
// =============================================================================

const mockWaiver: FeeWaiver = {
  id: 'waiver-123',
  communityId: 'community-123',
  tier: 'enterprise',
  reason: 'Partner program',
  grantedBy: 'admin',
  grantedAt: new Date('2025-01-01T00:00:00Z'),
  expiresAt: new Date('2026-12-31T23:59:59Z'), // ~1 year from now
  revokedAt: undefined,
  revokedBy: undefined,
  revokeReason: undefined,
  createdAt: new Date('2025-01-01T00:00:00Z'),
  updatedAt: new Date('2025-01-01T00:00:00Z'),
};

const mockExpiredWaiver: FeeWaiver = {
  ...mockWaiver,
  id: 'waiver-456',
  expiresAt: new Date('2024-01-01T00:00:00Z'), // Already expired
};

const mockRevokedWaiver: FeeWaiver = {
  ...mockWaiver,
  id: 'waiver-789',
  revokedAt: new Date('2025-06-01T00:00:00Z'),
  revokedBy: 'admin',
  revokeReason: 'Program ended',
};

// =============================================================================
// Test Suite: Grant Waiver
// =============================================================================

describe('WaiverService - grantWaiver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should grant a new waiver successfully', async () => {
    // Arrange
    const params = {
      communityId: 'community-123',
      tier: 'enterprise' as SubscriptionTier,
      reason: 'Partner program - strategic partnership',
      grantedBy: 'admin',
    };

    vi.mocked(billingQueries.getActiveFeeWaiver).mockReturnValue(null);
    vi.mocked(billingQueries.createFeeWaiver).mockReturnValue('waiver-123');
    vi.mocked(billingQueries.getActiveFeeWaiver).mockReturnValueOnce(null).mockReturnValueOnce(mockWaiver);
    vi.mocked(billingQueries.logBillingAuditEvent).mockReturnValue(1);
    vi.mocked(gatekeeperService.invalidateCache).mockResolvedValue(undefined);

    // Act
    const result = await waiverService.grantWaiver(params);

    // Assert
    expect(result.id).toBe('waiver-123');
    expect(result.waiver).toEqual(mockWaiver);
    expect(result.previousWaiverRevoked).toBe(false);
    expect(billingQueries.createFeeWaiver).toHaveBeenCalledWith({
      communityId: params.communityId,
      tier: params.tier,
      reason: params.reason,
      grantedBy: params.grantedBy,
      expiresAt: undefined,
    });
    expect(gatekeeperService.invalidateCache).toHaveBeenCalledWith(params.communityId);
    expect(billingQueries.logBillingAuditEvent).toHaveBeenCalledWith(
      'waiver_granted',
      expect.objectContaining({
        waiverId: 'waiver-123',
        communityId: params.communityId,
        tier: params.tier,
      }),
      params.communityId,
      params.grantedBy
    );
  });

  it('should grant waiver with expiration date', async () => {
    // Arrange
    const expiresAt = new Date('2026-01-01T00:00:00Z');
    const params = {
      communityId: 'community-123',
      tier: 'enterprise' as SubscriptionTier,
      reason: 'Trial period for 1 year',
      grantedBy: 'admin',
      expiresAt,
    };

    vi.mocked(billingQueries.getActiveFeeWaiver).mockReturnValue(null);
    vi.mocked(billingQueries.createFeeWaiver).mockReturnValue('waiver-123');
    vi.mocked(billingQueries.getActiveFeeWaiver).mockReturnValueOnce(null).mockReturnValueOnce(mockWaiver);
    vi.mocked(billingQueries.logBillingAuditEvent).mockReturnValue(1);
    vi.mocked(gatekeeperService.invalidateCache).mockResolvedValue(undefined);

    // Act
    const result = await waiverService.grantWaiver(params);

    // Assert
    expect(result.id).toBe('waiver-123');
    expect(billingQueries.createFeeWaiver).toHaveBeenCalledWith(
      expect.objectContaining({
        expiresAt,
      })
    );
  });

  it('should revoke existing waiver before granting new one', async () => {
    // Arrange
    const existingWaiver = { ...mockWaiver, id: 'waiver-old' };
    const params = {
      communityId: 'community-123',
      tier: 'elite' as SubscriptionTier,
      reason: 'Upgrade to elite tier',
      grantedBy: 'admin',
    };

    vi.mocked(billingQueries.getActiveFeeWaiver)
      .mockReturnValueOnce(existingWaiver)  // grantWaiver checks for existing
      .mockReturnValueOnce(existingWaiver)  // revokeWaiver checks for existing
      .mockReturnValueOnce(mockWaiver);     // grantWaiver gets new waiver after creation
    vi.mocked(billingQueries.revokeFeeWaiver).mockReturnValue(true);
    vi.mocked(billingQueries.createFeeWaiver).mockReturnValue('waiver-123');
    vi.mocked(billingQueries.logBillingAuditEvent).mockReturnValue(1);
    vi.mocked(gatekeeperService.invalidateCache).mockResolvedValue(undefined);

    // Act
    const result = await waiverService.grantWaiver(params);

    // Assert
    expect(result.previousWaiverRevoked).toBe(true);
    expect(billingQueries.revokeFeeWaiver).toHaveBeenCalledWith(
      'waiver-old',
      expect.objectContaining({
        revokeReason: expect.stringContaining('Superseded by new waiver'),
      })
    );
  });

  it('should use default tier (enterprise) if not specified', async () => {
    // Arrange
    const params = {
      communityId: 'community-123',
      reason: 'Default tier test',
      grantedBy: 'admin',
    };

    vi.mocked(billingQueries.getActiveFeeWaiver)
      .mockReturnValueOnce(null)       // grantWaiver checks for existing
      .mockReturnValueOnce(mockWaiver); // grantWaiver gets new waiver after creation
    vi.mocked(billingQueries.createFeeWaiver).mockReturnValue('waiver-123');
    vi.mocked(billingQueries.logBillingAuditEvent).mockReturnValue(1);
    vi.mocked(gatekeeperService.invalidateCache).mockResolvedValue(undefined);

    // Act
    await waiverService.grantWaiver(params);

    // Assert
    expect(billingQueries.createFeeWaiver).toHaveBeenCalledWith(
      expect.objectContaining({
        tier: 'enterprise',
      })
    );
  });

  it('should throw error if communityId is empty', async () => {
    // Arrange
    const params = {
      communityId: '',
      reason: 'Test reason that is long enough',
      grantedBy: 'admin',
    };

    // Act & Assert
    await expect(waiverService.grantWaiver(params)).rejects.toThrow('Community ID is required');
  });

  it('should throw error if reason is too short', async () => {
    // Arrange
    const params = {
      communityId: 'community-123',
      reason: 'Short',
      grantedBy: 'admin',
    };

    // Act & Assert
    await expect(waiverService.grantWaiver(params)).rejects.toThrow('Reason must be at least 10 characters');
  });

  it('should throw error if grantedBy is empty', async () => {
    // Arrange
    const params = {
      communityId: 'community-123',
      reason: 'Valid reason that is long enough',
      grantedBy: '',
    };

    // Act & Assert
    await expect(waiverService.grantWaiver(params)).rejects.toThrow('grantedBy is required');
  });

  it('should throw error if expiration date is in the past', async () => {
    // Arrange
    const params = {
      communityId: 'community-123',
      reason: 'Test with past expiration',
      grantedBy: 'admin',
      expiresAt: new Date('2020-01-01T00:00:00Z'),
    };

    // Act & Assert
    await expect(waiverService.grantWaiver(params)).rejects.toThrow('Expiration date must be in the future');
  });

  it('should throw error if waiver creation fails', async () => {
    // Arrange
    const params = {
      communityId: 'community-123',
      reason: 'Test waiver creation failure',
      grantedBy: 'admin',
    };

    vi.mocked(billingQueries.getActiveFeeWaiver)
      .mockReturnValueOnce(null)  // grantWaiver checks for existing
      .mockReturnValueOnce(null); // grantWaiver fails to retrieve after creation
    vi.mocked(billingQueries.createFeeWaiver).mockReturnValue('waiver-123');

    // Act & Assert
    await expect(waiverService.grantWaiver(params)).rejects.toThrow('Failed to create waiver');
  });
});

// =============================================================================
// Test Suite: Revoke Waiver
// =============================================================================

describe('WaiverService - revokeWaiver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should revoke active waiver successfully', async () => {
    // Arrange
    const params = {
      communityId: 'community-123',
      reason: 'Program ended - partner agreement expired',
      revokedBy: 'admin',
    };

    vi.mocked(billingQueries.getActiveFeeWaiver).mockReturnValue(mockWaiver);
    vi.mocked(billingQueries.revokeFeeWaiver).mockReturnValue(true);
    vi.mocked(billingQueries.logBillingAuditEvent).mockReturnValue(1);
    vi.mocked(gatekeeperService.invalidateCache).mockResolvedValue(undefined);

    // Act
    const result = await waiverService.revokeWaiver(params);

    // Assert
    expect(result).toBe(true);
    expect(billingQueries.revokeFeeWaiver).toHaveBeenCalledWith(
      mockWaiver.id,
      {
        revokedBy: params.revokedBy,
        revokeReason: params.reason,
      }
    );
    expect(gatekeeperService.invalidateCache).toHaveBeenCalledWith(params.communityId);
    expect(billingQueries.logBillingAuditEvent).toHaveBeenCalledWith(
      'waiver_revoked',
      expect.objectContaining({
        waiverId: mockWaiver.id,
        communityId: params.communityId,
      }),
      params.communityId,
      params.revokedBy
    );
  });

  it('should throw error if no active waiver exists', async () => {
    // Arrange
    const params = {
      communityId: 'community-123',
      reason: 'Test revocation of non-existent waiver',
      revokedBy: 'admin',
    };

    vi.mocked(billingQueries.getActiveFeeWaiver).mockReturnValue(null);

    // Act & Assert
    await expect(waiverService.revokeWaiver(params)).rejects.toThrow('No active waiver found for community community-123');
  });

  it('should throw error if revocation fails', async () => {
    // Arrange
    const params = {
      communityId: 'community-123',
      reason: 'Test failed revocation',
      revokedBy: 'admin',
    };

    vi.mocked(billingQueries.getActiveFeeWaiver).mockReturnValue(mockWaiver);
    vi.mocked(billingQueries.revokeFeeWaiver).mockReturnValue(false);

    // Act & Assert
    await expect(waiverService.revokeWaiver(params)).rejects.toThrow('Failed to revoke waiver');
  });

  it('should throw error if reason is too short', async () => {
    // Arrange
    const params = {
      communityId: 'community-123',
      reason: 'Short',
      revokedBy: 'admin',
    };

    // Act & Assert
    await expect(waiverService.revokeWaiver(params)).rejects.toThrow('Reason must be at least 10 characters');
  });
});

// =============================================================================
// Test Suite: Query Waivers
// =============================================================================

describe('WaiverService - Query Operations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getWaiver', () => {
    it('should return active waiver for community', () => {
      // Arrange
      vi.mocked(billingQueries.getActiveFeeWaiver).mockReturnValue(mockWaiver);

      // Act
      const result = waiverService.getWaiver('community-123');

      // Assert
      expect(result).toEqual(mockWaiver);
      expect(billingQueries.getActiveFeeWaiver).toHaveBeenCalledWith('community-123');
    });

    it('should return null if no active waiver', () => {
      // Arrange
      vi.mocked(billingQueries.getActiveFeeWaiver).mockReturnValue(null);

      // Act
      const result = waiverService.getWaiver('community-123');

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('listWaivers', () => {
    it('should list all active waivers when no filters', () => {
      // Arrange
      const activeWaivers = [mockWaiver, { ...mockWaiver, id: 'waiver-2', communityId: 'community-456' }];
      vi.mocked(billingQueries.getAllActiveFeeWaivers).mockReturnValue(activeWaivers);

      // Act
      const result = waiverService.listWaivers();

      // Assert
      expect(result).toEqual(activeWaivers);
      expect(billingQueries.getAllActiveFeeWaivers).toHaveBeenCalled();
    });

    it('should list waivers for specific community', () => {
      // Arrange
      const communityWaivers = [mockWaiver, mockRevokedWaiver];
      vi.mocked(billingQueries.getFeeWaiversByCommunity).mockReturnValue(communityWaivers);

      // Act
      const result = waiverService.listWaivers({ communityId: 'community-123' });

      // Assert
      expect(result.length).toBe(1); // Only active waiver
      expect(result[0]).toEqual(mockWaiver);
    });

    it('should include inactive waivers when requested', () => {
      // Arrange
      const communityWaivers = [mockWaiver, mockRevokedWaiver, mockExpiredWaiver];
      vi.mocked(billingQueries.getFeeWaiversByCommunity).mockReturnValue(communityWaivers);

      // Act
      const result = waiverService.listWaivers({
        communityId: 'community-123',
        includeInactive: true,
      });

      // Assert
      expect(result.length).toBe(3);
    });
  });

  describe('hasActiveWaiver', () => {
    it('should return true if active waiver exists', () => {
      // Arrange
      vi.mocked(billingQueries.getActiveFeeWaiver).mockReturnValue(mockWaiver);

      // Act
      const result = waiverService.hasActiveWaiver('community-123');

      // Assert
      expect(result).toBe(true);
    });

    it('should return false if no active waiver', () => {
      // Arrange
      vi.mocked(billingQueries.getActiveFeeWaiver).mockReturnValue(null);

      // Act
      const result = waiverService.hasActiveWaiver('community-123');

      // Assert
      expect(result).toBe(false);
    });
  });

  describe('getActiveWaiverCount', () => {
    it('should return count of active waivers', () => {
      // Arrange
      const activeWaivers = [
        mockWaiver,
        { ...mockWaiver, id: 'waiver-2', communityId: 'community-456' },
        { ...mockWaiver, id: 'waiver-3', communityId: 'community-789' },
      ];
      vi.mocked(billingQueries.getAllActiveFeeWaivers).mockReturnValue(activeWaivers);

      // Act
      const result = waiverService.getActiveWaiverCount();

      // Assert
      expect(result).toBe(3);
    });

    it('should return 0 if no active waivers', () => {
      // Arrange
      vi.mocked(billingQueries.getAllActiveFeeWaivers).mockReturnValue([]);

      // Act
      const result = waiverService.getActiveWaiverCount();

      // Assert
      expect(result).toBe(0);
    });
  });
});

// =============================================================================
// Test Suite: Waiver Info
// =============================================================================

describe('WaiverService - getWaiverInfo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return info for active waiver', () => {
    // Arrange
    vi.mocked(billingQueries.getActiveFeeWaiver).mockReturnValue(mockWaiver);

    // Act
    const result = waiverService.getWaiverInfo('community-123');

    // Assert
    expect(result.hasWaiver).toBe(true);
    expect(result.waiver).toEqual(mockWaiver);
    expect(result.isExpiringSoon).toBe(false); // Expires in ~1 year
  });

  it('should detect waiver expiring soon (within 7 days)', () => {
    // Arrange
    const expiringSoonDate = new Date();
    expiringSoonDate.setDate(expiringSoonDate.getDate() + 5); // 5 days from now

    const expiringSoonWaiver = {
      ...mockWaiver,
      expiresAt: expiringSoonDate,
    };
    vi.mocked(billingQueries.getActiveFeeWaiver).mockReturnValue(expiringSoonWaiver);

    // Act
    const result = waiverService.getWaiverInfo('community-123');

    // Assert
    expect(result.hasWaiver).toBe(true);
    expect(result.isExpiringSoon).toBe(true);
    expect(result.daysUntilExpiry).toBeLessThanOrEqual(7);
    expect(result.daysUntilExpiry).toBeGreaterThan(0);
  });

  it('should handle permanent waiver (no expiration)', () => {
    // Arrange
    const permanentWaiver = {
      ...mockWaiver,
      expiresAt: undefined,
    };
    vi.mocked(billingQueries.getActiveFeeWaiver).mockReturnValue(permanentWaiver);

    // Act
    const result = waiverService.getWaiverInfo('community-123');

    // Assert
    expect(result.hasWaiver).toBe(true);
    expect(result.isExpiringSoon).toBe(false);
    expect(result.daysUntilExpiry).toBeUndefined();
  });

  it('should return no waiver info when none exists', () => {
    // Arrange
    vi.mocked(billingQueries.getActiveFeeWaiver).mockReturnValue(null);

    // Act
    const result = waiverService.getWaiverInfo('community-123');

    // Assert
    expect(result.hasWaiver).toBe(false);
    expect(result.waiver).toBeUndefined();
    expect(result.isExpiringSoon).toBeUndefined();
    expect(result.daysUntilExpiry).toBeUndefined();
  });
});

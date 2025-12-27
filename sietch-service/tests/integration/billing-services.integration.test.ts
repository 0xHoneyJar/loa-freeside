/**
 * Billing Service Integration Tests (v4.0 - Sprint 26)
 *
 * Integration tests for billing services working together:
 * - WaiverService + BillingAuditService
 * - WaiverService + GatekeeperService cache invalidation
 * - BillingAuditService query capabilities
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { waiverService } from '../../src/services/billing/WaiverService.js';
import { billingAuditService } from '../../src/services/billing/BillingAuditService.js';
import { gatekeeperService } from '../../src/services/billing/GatekeeperService.js';
import * as billingQueries from '../../src/db/billing-queries.js';
import type { FeeWaiver } from '../../src/types/billing.js';

// =============================================================================
// Mocks
// =============================================================================

vi.mock('../../src/config.js', () => ({
  config: {
    features: {
      billing: true,
    },
  },
  isBillingEnabled: () => true,
}));

vi.mock('../../src/db/billing-queries.js');
vi.mock('../../src/services/billing/GatekeeperService.js');
vi.mock('../../src/utils/logger.js', () => ({
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
  expiresAt: new Date('2025-12-31T23:59:59Z'),
  revokedAt: undefined,
  revokedBy: undefined,
  revokeReason: undefined,
  createdAt: new Date('2025-01-01T00:00:00Z'),
  updatedAt: new Date('2025-01-01T00:00:00Z'),
};

// =============================================================================
// Test Suite: Waiver + Audit Integration
// =============================================================================

describe('Billing Service Integration - Waiver + Audit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should log audit event when granting waiver', async () => {
    // Arrange
    vi.mocked(billingQueries.getActiveFeeWaiver).mockReturnValue(null);
    vi.mocked(billingQueries.createFeeWaiver).mockReturnValue('waiver-123');
    vi.mocked(billingQueries.getActiveFeeWaiver).mockReturnValueOnce(null).mockReturnValueOnce(mockWaiver);
    vi.mocked(billingQueries.logBillingAuditEvent).mockReturnValue(1);
    vi.mocked(gatekeeperService.invalidateCache).mockResolvedValue(undefined);

    // Act
    await waiverService.grantWaiver({
      communityId: 'community-123',
      tier: 'enterprise',
      reason: 'Partner program test',
      grantedBy: 'admin',
    });

    // Assert - Audit event logged
    expect(billingQueries.logBillingAuditEvent).toHaveBeenCalledWith(
      'waiver_granted',
      expect.objectContaining({
        waiverId: 'waiver-123',
        communityId: 'community-123',
        tier: 'enterprise',
      }),
      'community-123',
      'admin'
    );
  });

  it('should log audit event when revoking waiver', async () => {
    // Arrange
    vi.mocked(billingQueries.getActiveFeeWaiver).mockReturnValue(mockWaiver);
    vi.mocked(billingQueries.revokeFeeWaiver).mockReturnValue(true);
    vi.mocked(billingQueries.logBillingAuditEvent).mockReturnValue(1);
    vi.mocked(gatekeeperService.invalidateCache).mockResolvedValue(undefined);

    // Act
    await waiverService.revokeWaiver({
      communityId: 'community-123',
      reason: 'Program ended',
      revokedBy: 'admin',
    });

    // Assert - Audit event logged
    expect(billingQueries.logBillingAuditEvent).toHaveBeenCalledWith(
      'waiver_revoked',
      expect.objectContaining({
        waiverId: mockWaiver.id,
        communityId: 'community-123',
      }),
      'community-123',
      'admin'
    );
  });
});

// =============================================================================
// Test Suite: Waiver + GatekeeperService Integration
// =============================================================================

describe('Billing Service Integration - Waiver + Gatekeeper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should invalidate gatekeeper cache when granting waiver', async () => {
    // Arrange
    vi.mocked(billingQueries.getActiveFeeWaiver).mockReturnValue(null);
    vi.mocked(billingQueries.createFeeWaiver).mockReturnValue('waiver-123');
    vi.mocked(billingQueries.getActiveFeeWaiver).mockReturnValueOnce(null).mockReturnValueOnce(mockWaiver);
    vi.mocked(billingQueries.logBillingAuditEvent).mockReturnValue(1);
    vi.mocked(gatekeeperService.invalidateCache).mockResolvedValue(undefined);

    // Act
    await waiverService.grantWaiver({
      communityId: 'community-123',
      tier: 'enterprise',
      reason: 'Cache invalidation test',
      grantedBy: 'admin',
    });

    // Assert - Cache invalidated
    expect(gatekeeperService.invalidateCache).toHaveBeenCalledWith('community-123');
  });

  it('should invalidate gatekeeper cache when revoking waiver', async () => {
    // Arrange
    vi.mocked(billingQueries.getActiveFeeWaiver).mockReturnValue(mockWaiver);
    vi.mocked(billingQueries.revokeFeeWaiver).mockReturnValue(true);
    vi.mocked(billingQueries.logBillingAuditEvent).mockReturnValue(1);
    vi.mocked(gatekeeperService.invalidateCache).mockResolvedValue(undefined);

    // Act
    await waiverService.revokeWaiver({
      communityId: 'community-123',
      reason: 'Cache invalidation test',
      revokedBy: 'admin',
    });

    // Assert - Cache invalidated
    expect(gatekeeperService.invalidateCache).toHaveBeenCalledWith('community-123');
  });
});

// =============================================================================
// Test Suite: Audit Service Query Capabilities
// =============================================================================

describe('Billing Service Integration - Audit Queries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should query audit log with filters', () => {
    // Arrange
    const mockEntries = [
      {
        id: 1,
        eventType: 'waiver_granted' as const,
        communityId: 'community-123',
        eventData: { tier: 'enterprise' },
        actor: 'admin',
        createdAt: new Date('2025-01-01T00:00:00Z'),
      },
    ];
    vi.mocked(billingQueries.getBillingAuditLog).mockReturnValue(mockEntries);

    // Act
    const result = billingAuditService.queryAuditLog({
      limit: 50,
      eventType: 'waiver_granted',
      communityId: 'community-123',
    });

    // Assert
    expect(result.entries).toEqual(mockEntries);
    expect(result.total).toBe(1);
    expect(billingQueries.getBillingAuditLog).toHaveBeenCalledWith({
      limit: 51, // +1 to check hasMore
      eventType: 'waiver_granted',
      communityId: 'community-123',
      since: undefined,
    });
  });

  it('should calculate statistics from audit log', () => {
    // Arrange
    const mockEntries = [
      {
        id: 1,
        eventType: 'waiver_granted' as const,
        communityId: 'community-123',
        eventData: {},
        createdAt: new Date('2025-01-01T00:00:00Z'),
      },
      {
        id: 2,
        eventType: 'waiver_granted' as const,
        communityId: 'community-456',
        eventData: {},
        createdAt: new Date('2025-01-02T00:00:00Z'),
      },
      {
        id: 3,
        eventType: 'waiver_revoked' as const,
        communityId: 'community-123',
        eventData: {},
        createdAt: new Date('2025-01-03T00:00:00Z'),
      },
    ];
    vi.mocked(billingQueries.getBillingAuditLog).mockReturnValue(mockEntries);

    // Act
    const stats = billingAuditService.getStatistics();

    // Assert
    expect(stats.totalEvents).toBe(3);
    expect(stats.eventCounts.waiver_granted).toBe(2);
    expect(stats.eventCounts.waiver_revoked).toBe(1);
    expect(stats.oldestEvent).toEqual(new Date('2025-01-01T00:00:00Z'));
    expect(stats.newestEvent).toEqual(new Date('2025-01-03T00:00:00Z'));
  });
});

// =============================================================================
// Test Suite: Complete Waiver Lifecycle
// =============================================================================

describe('Billing Service Integration - Waiver Lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should complete full waiver lifecycle with all integrations', async () => {
    // Arrange
    vi.mocked(billingQueries.getActiveFeeWaiver).mockReturnValue(null);
    vi.mocked(billingQueries.createFeeWaiver).mockReturnValue('waiver-123');
    vi.mocked(billingQueries.getActiveFeeWaiver)
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(mockWaiver)
      .mockReturnValueOnce(mockWaiver);
    vi.mocked(billingQueries.revokeFeeWaiver).mockReturnValue(true);
    vi.mocked(billingQueries.logBillingAuditEvent).mockReturnValue(1);
    vi.mocked(gatekeeperService.invalidateCache).mockResolvedValue(undefined);

    // Step 1: Grant waiver
    const grantResult = await waiverService.grantWaiver({
      communityId: 'community-123',
      tier: 'enterprise',
      reason: 'Lifecycle test - granting waiver',
      grantedBy: 'admin',
    });

    // Assert Step 1
    expect(grantResult.id).toBe('waiver-123');
    expect(gatekeeperService.invalidateCache).toHaveBeenCalledTimes(1);
    expect(billingQueries.logBillingAuditEvent).toHaveBeenCalledWith(
      'waiver_granted',
      expect.any(Object),
      'community-123',
      'admin'
    );

    // Step 2: Revoke waiver
    const revokeResult = await waiverService.revokeWaiver({
      communityId: 'community-123',
      reason: 'Lifecycle test - revoking waiver',
      revokedBy: 'admin',
    });

    // Assert Step 2
    expect(revokeResult).toBe(true);
    expect(gatekeeperService.invalidateCache).toHaveBeenCalledTimes(2);
    expect(billingQueries.logBillingAuditEvent).toHaveBeenCalledWith(
      'waiver_revoked',
      expect.any(Object),
      'community-123',
      'admin'
    );

    // Verify cache was invalidated on both operations
    expect(gatekeeperService.invalidateCache).toHaveBeenNthCalledWith(1, 'community-123');
    expect(gatekeeperService.invalidateCache).toHaveBeenNthCalledWith(2, 'community-123');
  });
});

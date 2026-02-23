/**
 * Community Scope Tests — withCommunityScope & requireCommunityMatch
 *
 * Unit tests for tenant-scoped DB operations and request-level community validation.
 *
 * @see Sprint 1, Tasks 1.1 & 1.3
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  withCommunityScope,
  withCommunityBoundary,
  requireCommunityMatch,
  type CommunityMatchContext,
} from '../community-scope.js';

// =============================================================================
// Mock Database
// =============================================================================

const createMockClient = () => ({
  query: vi.fn().mockResolvedValue({ rows: [] }),
  release: vi.fn(),
});

const createMockPool = (mockClient: ReturnType<typeof createMockClient>) => ({
  connect: vi.fn().mockResolvedValue(mockClient),
});

// =============================================================================
// AC-1.1.1: withCommunityScope — SET LOCAL scoping with error rollback
// =============================================================================

describe('withCommunityScope', () => {
  let mockClient: ReturnType<typeof createMockClient>;
  let mockPool: ReturnType<typeof createMockPool>;

  beforeEach(() => {
    mockClient = createMockClient();
    mockPool = createMockPool(mockClient);
  });

  it('should execute BEGIN, SET LOCAL, callback, COMMIT', async () => {
    const callback = vi.fn().mockResolvedValue('result');

    // @ts-expect-error - mock pool
    const result = await withCommunityScope('community-123', mockPool, callback);

    expect(result).toBe('result');
    expect(mockClient.query).toHaveBeenCalledTimes(3);
    expect(mockClient.query).toHaveBeenNthCalledWith(1, 'BEGIN');
    expect(mockClient.query).toHaveBeenNthCalledWith(2, 'SET LOCAL app.community_id = $1', ['community-123']);
    expect(mockClient.query).toHaveBeenNthCalledWith(3, 'COMMIT');
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('should ROLLBACK and release on error', async () => {
    const error = new Error('test error');
    const callback = vi.fn().mockRejectedValue(error);

    // @ts-expect-error - mock pool
    await expect(withCommunityScope('community-123', mockPool, callback)).rejects.toThrow('test error');

    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('should release client even when ROLLBACK fails', async () => {
    const callback = vi.fn().mockRejectedValue(new Error('callback error'));
    mockClient.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({}) // SET LOCAL
      .mockRejectedValueOnce(new Error('rollback error')); // ROLLBACK fails

    // @ts-expect-error - mock pool
    await expect(withCommunityScope('community-123', mockPool, callback)).rejects.toThrow();
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('should pass the scoped client to the callback', async () => {
    const callback = vi.fn().mockResolvedValue(undefined);

    // @ts-expect-error - mock pool
    await withCommunityScope('community-123', mockPool, callback);

    expect(callback).toHaveBeenCalledWith(mockClient);
  });
});

// =============================================================================
// withCommunityBoundary — SET LOCAL only (caller manages transaction)
// =============================================================================

describe('withCommunityBoundary', () => {
  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    mockClient = createMockClient();
  });

  it('should only SET LOCAL without BEGIN/COMMIT', async () => {
    const callback = vi.fn().mockResolvedValue('result');

    // @ts-expect-error - mock client
    const result = await withCommunityBoundary('community-123', mockClient, callback);

    expect(result).toBe('result');
    expect(mockClient.query).toHaveBeenCalledTimes(1);
    expect(mockClient.query).toHaveBeenCalledWith('SET LOCAL app.community_id = $1', ['community-123']);
  });
});

// =============================================================================
// AC-1.3.1: requireCommunityMatch — 403 COMMUNITY_MISMATCH
// =============================================================================

describe('requireCommunityMatch', () => {
  it('should allow matching community IDs', () => {
    const context: CommunityMatchContext = {
      actorCommunityId: 'community-123',
      paramsCommunityId: 'community-123',
    };

    const result = requireCommunityMatch(context);
    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('should deny mismatching community IDs', () => {
    const context: CommunityMatchContext = {
      actorCommunityId: 'community-123',
      paramsCommunityId: 'community-456',
    };

    const result = requireCommunityMatch(context);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('COMMUNITY_MISMATCH');
  });

  // ===========================================================================
  // AC-1.3.2: Platform admin bypass with audit logging
  // ===========================================================================

  it('should allow platform admin bypass with audit context', () => {
    const context: CommunityMatchContext = {
      actorCommunityId: 'admin-community',
      paramsCommunityId: 'target-community',
      isPlatformAdmin: true,
      auditContext: {
        actorId: 'admin-user',
        action: 'view_billing',
      },
    };

    const result = requireCommunityMatch(context);
    expect(result.allowed).toBe(true);
    expect(result.bypassed).toBe(true);
  });

  it('should deny admin without audit context', () => {
    const context: CommunityMatchContext = {
      actorCommunityId: 'admin-community',
      paramsCommunityId: 'target-community',
      isPlatformAdmin: true,
      // No auditContext
    };

    const result = requireCommunityMatch(context);
    expect(result.allowed).toBe(false);
  });

  it('should call audit log on admin bypass', async () => {
    const auditLog = vi.fn().mockResolvedValue(undefined);
    const context: CommunityMatchContext = {
      actorCommunityId: 'admin-community',
      paramsCommunityId: 'target-community',
      isPlatformAdmin: true,
      auditContext: {
        actorId: 'admin-user',
        action: 'view_billing',
        ipAddress: '10.0.0.1',
      },
    };

    requireCommunityMatch(context, auditLog);

    // Audit log is fire-and-forget, so it's called but not awaited
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        actor_id: 'admin-user',
        action: 'COMMUNITY_MATCH_BYPASS',
        target_community_id: 'target-community',
        actor_community_id: 'admin-community',
        ip_address: '10.0.0.1',
      }),
    );
  });

  it('should not block request if audit log fails', () => {
    const auditLog = vi.fn().mockRejectedValue(new Error('audit db down'));
    const context: CommunityMatchContext = {
      actorCommunityId: 'admin-community',
      paramsCommunityId: 'target-community',
      isPlatformAdmin: true,
      auditContext: {
        actorId: 'admin-user',
        action: 'view_billing',
      },
    };

    // Should not throw even if audit log fails
    const result = requireCommunityMatch(context, auditLog);
    expect(result.allowed).toBe(true);
  });
});

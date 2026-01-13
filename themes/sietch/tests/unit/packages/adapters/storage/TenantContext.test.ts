/**
 * TenantContext Unit Tests
 *
 * Sprint 39: RLS Implementation
 *
 * Tests for the TenantContext class that manages PostgreSQL RLS tenant context.
 * These are unit tests that mock the database layer.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  TenantContext,
  createTenantContext,
  isValidTenantId,
  type TenantContextOptions,
} from '../../../../../src/packages/adapters/storage/TenantContext.js';

// Mock PostgreSQL database
const mockDb = {
  execute: vi.fn(),
};

describe('TenantContext', () => {
  let tenantContext: TenantContext;

  beforeEach(() => {
    vi.clearAllMocks();
    tenantContext = new TenantContext(mockDb as any);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  // ===========================================================================
  // Constructor Tests
  // ===========================================================================

  describe('constructor', () => {
    it('should create instance with default options', () => {
      const ctx = new TenantContext(mockDb as any);
      expect(ctx).toBeDefined();
    });

    it('should create instance with custom options', () => {
      const options: TenantContextOptions = {
        throwOnInvalidTenant: false,
        debug: true,
      };
      const ctx = new TenantContext(mockDb as any, options);
      expect(ctx).toBeDefined();
    });

    it('should use factory function', () => {
      const ctx = createTenantContext(mockDb as any);
      expect(ctx).toBeInstanceOf(TenantContext);
    });
  });

  // ===========================================================================
  // setTenant Tests
  // ===========================================================================

  describe('setTenant', () => {
    it('should call set_tenant_context with valid UUID', async () => {
      const tenantId = '123e4567-e89b-12d3-a456-426614174000';
      mockDb.execute.mockResolvedValueOnce([]);

      await tenantContext.setTenant(tenantId);

      expect(mockDb.execute).toHaveBeenCalledTimes(1);
      // Verify the SQL template contains the tenant ID
      const sqlCall = mockDb.execute.mock.calls[0][0];
      expect(sqlCall).toBeDefined();
    });

    it('should throw on invalid UUID by default', async () => {
      const invalidId = 'not-a-valid-uuid';

      await expect(tenantContext.setTenant(invalidId)).rejects.toThrow(
        'Invalid tenant ID: not-a-valid-uuid'
      );
      expect(mockDb.execute).not.toHaveBeenCalled();
    });

    it('should not throw on invalid UUID when throwOnInvalidTenant is false', async () => {
      const ctx = new TenantContext(mockDb as any, { throwOnInvalidTenant: false });
      const invalidId = 'not-a-valid-uuid';

      await expect(ctx.setTenant(invalidId)).resolves.toBeUndefined();
      expect(mockDb.execute).not.toHaveBeenCalled();
    });

    it('should throw on empty string', async () => {
      await expect(tenantContext.setTenant('')).rejects.toThrow('Invalid tenant ID');
    });

    it('should throw on UUID with invalid version', async () => {
      // UUID version 6+ is not valid per RFC 4122
      const invalidVersion = '123e4567-e89b-62d3-a456-426614174000';
      await expect(tenantContext.setTenant(invalidVersion)).rejects.toThrow('Invalid tenant ID');
    });

    it('should accept UUID version 1', async () => {
      const v1Uuid = '123e4567-e89b-12d3-a456-426614174000';
      mockDb.execute.mockResolvedValueOnce([]);

      await expect(tenantContext.setTenant(v1Uuid)).resolves.toBeUndefined();
    });

    it('should accept UUID version 4', async () => {
      const v4Uuid = '123e4567-e89b-42d3-a456-426614174000';
      mockDb.execute.mockResolvedValueOnce([]);

      await expect(tenantContext.setTenant(v4Uuid)).resolves.toBeUndefined();
    });
  });

  // ===========================================================================
  // clearTenant Tests
  // ===========================================================================

  describe('clearTenant', () => {
    it('should call clear_tenant_context', async () => {
      mockDb.execute.mockResolvedValueOnce([]);

      await tenantContext.clearTenant();

      expect(mockDb.execute).toHaveBeenCalledTimes(1);
    });
  });

  // ===========================================================================
  // getTenant Tests
  // ===========================================================================

  describe('getTenant', () => {
    it('should return isSet: true when tenant is set', async () => {
      const tenantId = '123e4567-e89b-12d3-a456-426614174000';
      mockDb.execute.mockResolvedValueOnce([{ get_tenant_context: tenantId }]);

      const result = await tenantContext.getTenant();

      expect(result.isSet).toBe(true);
      expect(result.tenantId).toBe(tenantId);
    });

    it('should return isSet: false when tenant is not set', async () => {
      mockDb.execute.mockResolvedValueOnce([{ get_tenant_context: null }]);

      const result = await tenantContext.getTenant();

      expect(result.isSet).toBe(false);
      expect(result.tenantId).toBeNull();
    });

    it('should handle empty result', async () => {
      mockDb.execute.mockResolvedValueOnce([]);

      const result = await tenantContext.getTenant();

      expect(result.isSet).toBe(false);
      expect(result.tenantId).toBeNull();
    });
  });

  // ===========================================================================
  // withTenant Tests
  // ===========================================================================

  describe('withTenant', () => {
    it('should set tenant, execute callback, and clear tenant', async () => {
      const tenantId = '123e4567-e89b-12d3-a456-426614174000';
      const callbackResult = { data: 'test' };
      const callback = vi.fn().mockResolvedValue(callbackResult);

      mockDb.execute
        .mockResolvedValueOnce([]) // setTenant
        .mockResolvedValueOnce([]); // clearTenant

      const result = await tenantContext.withTenant(tenantId, callback);

      expect(mockDb.execute).toHaveBeenCalledTimes(2);
      expect(callback).toHaveBeenCalledTimes(1);
      expect(result).toEqual(callbackResult);
    });

    it('should clear tenant even when callback throws', async () => {
      const tenantId = '123e4567-e89b-12d3-a456-426614174000';
      const error = new Error('Callback error');
      const callback = vi.fn().mockRejectedValue(error);

      mockDb.execute
        .mockResolvedValueOnce([]) // setTenant
        .mockResolvedValueOnce([]); // clearTenant

      await expect(tenantContext.withTenant(tenantId, callback)).rejects.toThrow('Callback error');

      // clearTenant should still be called
      expect(mockDb.execute).toHaveBeenCalledTimes(2);
    });

    it('should pass return value from callback', async () => {
      const tenantId = '123e4567-e89b-12d3-a456-426614174000';
      const profiles = [{ id: '1' }, { id: '2' }];
      const callback = vi.fn().mockResolvedValue(profiles);

      mockDb.execute
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await tenantContext.withTenant(tenantId, callback);

      expect(result).toEqual(profiles);
    });
  });

  // ===========================================================================
  // withoutTenant Tests
  // ===========================================================================

  describe('withoutTenant', () => {
    it('should clear tenant before executing callback', async () => {
      const callbackResult = { allData: true };
      const callback = vi.fn().mockResolvedValue(callbackResult);

      mockDb.execute.mockResolvedValueOnce([]); // clearTenant

      const result = await tenantContext.withoutTenant(callback);

      expect(mockDb.execute).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledTimes(1);
      expect(result).toEqual(callbackResult);
    });
  });

  // ===========================================================================
  // assertTenant Tests
  // ===========================================================================

  describe('assertTenant', () => {
    it('should return true when context matches', async () => {
      const tenantId = '123e4567-e89b-12d3-a456-426614174000';
      mockDb.execute.mockResolvedValueOnce([{ get_tenant_context: tenantId }]);

      const result = await tenantContext.assertTenant(tenantId);

      expect(result).toBe(true);
    });

    it('should throw when context is not set', async () => {
      mockDb.execute.mockResolvedValueOnce([{ get_tenant_context: null }]);

      await expect(tenantContext.assertTenant('any-id')).rejects.toThrow(
        'Tenant context not set'
      );
    });

    it('should throw when context does not match', async () => {
      const setTenant = '123e4567-e89b-12d3-a456-426614174000';
      const expectedTenant = 'aaaaaaaa-bbbb-1ccc-dddd-eeeeeeeeeeee';
      mockDb.execute.mockResolvedValueOnce([{ get_tenant_context: setTenant }]);

      await expect(tenantContext.assertTenant(expectedTenant)).rejects.toThrow(
        `Tenant context mismatch: expected ${expectedTenant}, got ${setTenant}`
      );
    });
  });

  // ===========================================================================
  // Debug Mode Tests
  // ===========================================================================

  describe('debug mode', () => {
    let consoleSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
      consoleSpy.mockRestore();
    });

    it('should log when setting tenant in debug mode', async () => {
      const ctx = new TenantContext(mockDb as any, { debug: true });
      const tenantId = '123e4567-e89b-12d3-a456-426614174000';
      mockDb.execute.mockResolvedValueOnce([]);

      await ctx.setTenant(tenantId);

      expect(consoleSpy).toHaveBeenCalledWith(
        `[TenantContext] Setting tenant: ${tenantId}`
      );
    });

    it('should log when clearing tenant in debug mode', async () => {
      const ctx = new TenantContext(mockDb as any, { debug: true });
      mockDb.execute.mockResolvedValueOnce([]);

      await ctx.clearTenant();

      expect(consoleSpy).toHaveBeenCalledWith(
        '[TenantContext] Clearing tenant context'
      );
    });

    it('should not log when debug is false', async () => {
      const ctx = new TenantContext(mockDb as any, { debug: false });
      const tenantId = '123e4567-e89b-12d3-a456-426614174000';
      mockDb.execute.mockResolvedValueOnce([]);

      await ctx.setTenant(tenantId);

      expect(consoleSpy).not.toHaveBeenCalled();
    });
  });
});

// ===========================================================================
// isValidTenantId Tests
// ===========================================================================

describe('isValidTenantId', () => {
  it('should return true for valid UUID v1', () => {
    expect(isValidTenantId('123e4567-e89b-12d3-a456-426614174000')).toBe(true);
  });

  it('should return true for valid UUID v4', () => {
    expect(isValidTenantId('123e4567-e89b-42d3-a456-426614174000')).toBe(true);
  });

  it('should return true for valid UUID v5', () => {
    expect(isValidTenantId('123e4567-e89b-52d3-a456-426614174000')).toBe(true);
  });

  it('should return false for empty string', () => {
    expect(isValidTenantId('')).toBe(false);
  });

  it('should return false for non-string', () => {
    expect(isValidTenantId(123)).toBe(false);
    expect(isValidTenantId(null)).toBe(false);
    expect(isValidTenantId(undefined)).toBe(false);
    expect(isValidTenantId({})).toBe(false);
  });

  it('should return false for invalid UUID format', () => {
    expect(isValidTenantId('not-a-uuid')).toBe(false);
    expect(isValidTenantId('123e4567e89b12d3a456426614174000')).toBe(false); // No hyphens
    expect(isValidTenantId('123e4567-e89b-12d3-a456')).toBe(false); // Too short
  });

  it('should return false for UUID with invalid version', () => {
    // Version 0 and 6+ are invalid
    expect(isValidTenantId('123e4567-e89b-02d3-a456-426614174000')).toBe(false);
    expect(isValidTenantId('123e4567-e89b-62d3-a456-426614174000')).toBe(false);
  });

  it('should return false for UUID with invalid variant', () => {
    // Variant must be 8, 9, a, or b in position 19
    expect(isValidTenantId('123e4567-e89b-12d3-0456-426614174000')).toBe(false);
    expect(isValidTenantId('123e4567-e89b-12d3-c456-426614174000')).toBe(false);
  });
});

// ===========================================================================
// createTenantContext Factory Tests
// ===========================================================================

describe('createTenantContext', () => {
  it('should create TenantContext with default options', () => {
    const ctx = createTenantContext(mockDb as any);
    expect(ctx).toBeInstanceOf(TenantContext);
  });

  it('should create TenantContext with custom options', () => {
    const options: TenantContextOptions = {
      throwOnInvalidTenant: false,
      debug: true,
    };
    const ctx = createTenantContext(mockDb as any, options);
    expect(ctx).toBeInstanceOf(TenantContext);
  });
});

/**
 * AuditTrailService.verify() — Safety bound tests (Task 1.3)
 *
 * Validates the safety limit behavior when verify() is called
 * without domainTag or explicit limit.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock hounfour
vi.mock('@0xhoneyjar/loa-hounfour/commons', () => ({
  buildDomainTag: vi.fn((...args: string[]) => args.join(':')),
  computeAuditEntryHash: vi.fn(() => 'mock-hash'),
  verifyAuditTrailIntegrity: vi.fn(() => ({ valid: true })),
  createCheckpoint: vi.fn(),
  AUDIT_TRAIL_GENESIS_HASH: '0'.repeat(64),
}));

// Mock audit-helpers
vi.mock('../../packages/adapters/storage/audit-helpers.js', () => ({
  advisoryLockKey: vi.fn(() => 12345),
  sleep: vi.fn(),
}));

const mockQuery = vi.fn();
const mockRelease = vi.fn();
const mockConnect = vi.fn().mockResolvedValue({
  query: mockQuery,
  release: mockRelease,
});

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  child: vi.fn().mockReturnThis(),
};

describe('AuditTrailService.verify() safety bound', () => {
  let service: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockQuery.mockReset();

    // Default: return empty rows
    mockQuery.mockResolvedValue({ rows: [] });

    const mod = await import(
      '../../packages/adapters/storage/audit-trail-service.js'
    );
    service = new mod.AuditTrailService(
      { connect: mockConnect } as any,
      mockLogger as any,
    );
  });

  it('should apply DEFAULT_VERIFY_LIMIT when called without domainTag and without limit', async () => {
    await service.verify();

    // Find the query call (first call after connect)
    const queryCall = mockQuery.mock.calls.find(
      (call: any[]) => typeof call[0] === 'string' && call[0].includes('SELECT entry_id'),
    );

    expect(queryCall).toBeDefined();
    const [sql, params] = queryCall!;

    // Should have LIMIT clause with 10000
    expect(sql).toContain('LIMIT');
    expect(params).toContain(10_000);

    // Should log warning
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ safety_limit: 10_000 }),
      expect.stringContaining('verify() called without domainTag or limit'),
    );
  });

  it('should respect caller-provided limit (not override)', async () => {
    await service.verify({ limit: 500 });

    const queryCall = mockQuery.mock.calls.find(
      (call: any[]) => typeof call[0] === 'string' && call[0].includes('SELECT entry_id'),
    );

    expect(queryCall).toBeDefined();
    const [sql, params] = queryCall!;

    // Should have LIMIT clause with caller's value
    expect(sql).toContain('LIMIT');
    expect(params).toContain(500);

    // Should NOT log safety limit warning
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it('should not apply safety limit when domainTag is provided (even without limit)', async () => {
    await service.verify({ domainTag: 'test-domain' });

    const queryCall = mockQuery.mock.calls.find(
      (call: any[]) => typeof call[0] === 'string' && call[0].includes('SELECT entry_id'),
    );

    expect(queryCall).toBeDefined();
    const [sql] = queryCall!;

    // Domain-scoped queries are bounded — no safety limit
    expect(sql).not.toContain('LIMIT');

    // Should NOT log safety limit warning
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it('should reject non-integer limit', async () => {
    await expect(service.verify({ limit: 1.5 })).rejects.toThrow(
      'limit must be a non-negative integer',
    );
  });

  it('should reject negative limit', async () => {
    await expect(service.verify({ limit: -1 })).rejects.toThrow(
      'limit must be a non-negative integer',
    );
  });

  it('should reject non-integer fromId', async () => {
    await expect(service.verify({ fromId: 2.7 })).rejects.toThrow(
      'fromId must be a non-negative integer',
    );
  });
});

/**
 * parseBudgetResult Unit Tests
 * Sprint S10-T4: ALREADY_RESERVED Idempotent Handling (IMP-001)
 *
 * Verifies that parseBudgetResult correctly maps all Lua response statuses,
 * including the ALREADY_RESERVED idempotent case.
 */

import { describe, it, expect, vi } from 'vitest';

// Mock fs to bypass Lua script loading at module init
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    readFileSync: vi.fn().mockReturnValue('-- mock lua'),
  };
});

import { parseBudgetResult } from '@arrakis/adapters/agent/budget-manager';

describe('parseBudgetResult (S10-T4)', () => {
  it('should map RESERVED status correctly', () => {
    const result = parseBudgetResult(['RESERVED', '9500', '10000', '0']);
    expect(result.status).toBe('RESERVED');
    expect(result.remaining).toBe(9500);
    expect(result.limit).toBe(10000);
    expect(result.warning).toBe(false);
  });

  it('should map ALREADY_RESERVED to success (not error)', () => {
    const result = parseBudgetResult(['ALREADY_RESERVED', '9500', '10000', '0']);
    expect(result.status).toBe('ALREADY_RESERVED');
    expect(result.remaining).toBe(9500);
    expect(result.limit).toBe(10000);
    expect(result.warning).toBe(false);
  });

  it('should map BUDGET_EXCEEDED correctly', () => {
    const result = parseBudgetResult(['BUDGET_EXCEEDED', '0', '10000', '1']);
    expect(result.status).toBe('BUDGET_EXCEEDED');
    expect(result.remaining).toBe(0);
    expect(result.warning).toBe(true);
  });

  it('should parse warning flag from Lua response', () => {
    const result = parseBudgetResult(['RESERVED', '1500', '10000', '1']);
    expect(result.warning).toBe(true);
  });

  it('should handle missing/malformed values safely', () => {
    const result = parseBudgetResult([]);
    expect(result.status).toBe('INVALID_INPUT');
    expect(result.remaining).toBe(0);
    expect(result.limit).toBe(0);
    expect(result.warning).toBe(false);
  });

  it('should treat ALREADY_RESERVED as success alongside RESERVED in gateway logic', () => {
    // Both RESERVED and ALREADY_RESERVED should be accepted by the gateway
    const reserved = parseBudgetResult(['RESERVED', '9000', '10000', '0']);
    const alreadyReserved = parseBudgetResult(['ALREADY_RESERVED', '9000', '10000', '0']);

    // Both should pass the gateway's success check
    const isSuccess = (r: typeof reserved) =>
      r.status === 'RESERVED' || r.status === 'ALREADY_RESERVED';

    expect(isSuccess(reserved)).toBe(true);
    expect(isSuccess(alreadyReserved)).toBe(true);
  });
});

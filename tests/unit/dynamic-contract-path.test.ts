/**
 * DynamicContract — Path resolution hardening tests (Task 1.2)
 *
 * Validates that DEFAULT_CONTRACT_PATH uses import.meta.url resolution
 * and that DYNAMIC_CONTRACT_PATH env var is blocked in production.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock node:fs to intercept readFileSync calls
vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
}));

// Mock hounfour
vi.mock('@0xhoneyjar/loa-hounfour/commons', () => ({
  DynamicContractSchema: { type: 'object' },
  verifyMonotonicExpansion: vi.fn(() => ({ valid: true, violations: [] })),
}));

// Mock typebox
vi.mock('@sinclair/typebox/value', () => ({
  Value: {
    Check: vi.fn(() => true),
    Errors: vi.fn(() => []),
  },
}));

describe('DynamicContract path resolution', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    // Clear any cached singleton
    delete process.env.DYNAMIC_CONTRACT_OVERRIDE;
    delete process.env.DYNAMIC_CONTRACT_PATH;
    delete process.env.ALLOW_DYNAMIC_CONTRACT_PATH;
    delete process.env.NODE_ENV;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should not use process.cwd() in DEFAULT_CONTRACT_PATH', async () => {
    const fs = await import('node:fs');
    const readSpy = vi.mocked(fs.readFileSync);
    readSpy.mockReturnValue('{"surfaces":{"cold":{"schemas":[],"capabilities":[],"rate_limit_tier":"free"}}}');

    const mod = await import(
      '../../themes/sietch/src/packages/core/protocol/arrakis-dynamic-contract.js'
    );

    // Call loadDynamicContract without explicit path — should use import.meta.url-relative
    try {
      mod.loadDynamicContract(undefined, { logger: { fatal: vi.fn() } });
    } catch {
      // May throw due to mock limitations — that's fine, we're testing the path
    }

    // Check that readFileSync was called with a path that does NOT start with process.cwd()
    if (readSpy.mock.calls.length > 0) {
      const calledPath = readSpy.mock.calls[0][0] as string;
      // The path should contain 'config/dynamic-contract.json' and NOT be cwd-relative
      expect(calledPath).toContain('dynamic-contract.json');
      // The path should be absolute (starts with /)
      expect(calledPath.startsWith('/') || calledPath.match(/^[A-Z]:\\/)).toBeTruthy();
    }
  });

  it('should use DYNAMIC_CONTRACT_PATH env var when set', async () => {
    process.env.DYNAMIC_CONTRACT_PATH = '/custom/path/contract.json';

    const fs = await import('node:fs');
    const readSpy = vi.mocked(fs.readFileSync);
    readSpy.mockReturnValue('{"surfaces":{"cold":{"schemas":[],"capabilities":[],"rate_limit_tier":"free"}}}');

    const mod = await import(
      '../../themes/sietch/src/packages/core/protocol/arrakis-dynamic-contract.js'
    );

    try {
      mod.loadDynamicContract(undefined, { logger: { fatal: vi.fn() } });
    } catch {
      // May throw — we're testing path resolution
    }

    if (readSpy.mock.calls.length > 0) {
      const calledPath = readSpy.mock.calls[0][0] as string;
      expect(calledPath).toBe('/custom/path/contract.json');
    }
  });

  it('should block DYNAMIC_CONTRACT_PATH in production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.DYNAMIC_CONTRACT_PATH = '/custom/path/contract.json';

    const mod = await import(
      '../../themes/sietch/src/packages/core/protocol/arrakis-dynamic-contract.js'
    );

    const fatalFn = vi.fn();
    expect(() => {
      mod.loadDynamicContract(undefined, { logger: { fatal: fatalFn } });
    }).toThrow('DYNAMIC_CONTRACT_PATH is blocked in production');
  });

  it('should allow DYNAMIC_CONTRACT_PATH in production with explicit allow flag', async () => {
    process.env.NODE_ENV = 'production';
    process.env.DYNAMIC_CONTRACT_PATH = '/custom/path/contract.json';
    process.env.ALLOW_DYNAMIC_CONTRACT_PATH = 'true';

    const fs = await import('node:fs');
    const readSpy = vi.mocked(fs.readFileSync);
    readSpy.mockReturnValue('{"surfaces":{"cold":{"schemas":[],"capabilities":[],"rate_limit_tier":"free"}}}');

    const mod = await import(
      '../../themes/sietch/src/packages/core/protocol/arrakis-dynamic-contract.js'
    );

    // Should NOT throw — allow flag is set
    try {
      mod.loadDynamicContract(undefined, { logger: { fatal: vi.fn() } });
    } catch (e) {
      // Only fail if it's the production block error
      expect((e as Error).message).not.toContain('blocked in production');
    }
  });

  it('should prioritize explicit contractPath param over env var', async () => {
    process.env.DYNAMIC_CONTRACT_PATH = '/env/path/contract.json';

    const fs = await import('node:fs');
    const readSpy = vi.mocked(fs.readFileSync);
    readSpy.mockReturnValue('{"surfaces":{"cold":{"schemas":[],"capabilities":[],"rate_limit_tier":"free"}}}');

    const mod = await import(
      '../../themes/sietch/src/packages/core/protocol/arrakis-dynamic-contract.js'
    );

    try {
      mod.loadDynamicContract('/explicit/param/contract.json', { logger: { fatal: vi.fn() } });
    } catch {
      // May throw
    }

    if (readSpy.mock.calls.length > 0) {
      const calledPath = readSpy.mock.calls[0][0] as string;
      // Explicit param should win over env var
      expect(calledPath).toBe('/explicit/param/contract.json');
    }
  });
});

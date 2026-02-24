/**
 * Config Fingerprint Tests
 *
 * Tests for emitConfigFingerprint() per SDD §3.4 and sprint Task 2.5.
 *
 * Coverage:
 *   - AC-4.4: Fingerprint emitted at startup
 *   - AC-4.4: Fingerprint changes when behavior-affecting env vars change
 *   - AC-4.4: Fingerprint does NOT leak secret values
 *
 * @see grimoires/loa/sdd.md §3.4
 * @see grimoires/loa/sprint.md Sprint 2, Tasks 2.4 + 2.5
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Env + Mock Setup (must happen before config import)
// ---------------------------------------------------------------------------

const originalEnv = { ...process.env };

function setRequiredEnv() {
  process.env.BERACHAIN_RPC_URL = 'https://rpc.berachain.com';
  process.env.BGT_ADDRESS = '0x1234567890123456789012345678901234567890';
  process.env.TRIGGER_PROJECT_ID = 'test-project';
  process.env.TRIGGER_SECRET_KEY = 'test-secret';
  process.env.DISCORD_BOT_TOKEN = 'test-token';
  process.env.DISCORD_GUILD_ID = '123456789';
  process.env.DISCORD_CHANNEL_THE_DOOR = '123456789';
  process.env.DISCORD_CHANNEL_CENSUS = '123456789';
  process.env.DISCORD_ROLE_NAIB = '123456789';
  process.env.DISCORD_ROLE_FEDAYKIN = '123456789';
  process.env.DATABASE_PATH = './test.db';
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('emitConfigFingerprint', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  async function importConfigWithMocks() {
    setRequiredEnv();

    vi.doMock('../../src/utils/logger.js', () => ({
      logger: {
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
      },
    }));

    const { emitConfigFingerprint } = await import('../../src/config.js');
    return emitConfigFingerprint;
  }

  it('emits fingerprint with configFingerprint and behaviorFingerprint fields', async () => {
    const emitConfigFingerprint = await importConfigWithMocks();
    const mockLogger = { info: vi.fn() };
    const result = emitConfigFingerprint(mockLogger);

    expect(result.configFingerprint).toBeDefined();
    expect(result.behaviorFingerprint).toBeDefined();
    expect(typeof result.configFingerprint).toBe('string');
    expect(typeof result.behaviorFingerprint).toBe('string');
    expect(result.configFingerprint.length).toBe(16);
    expect(result.behaviorFingerprint.length).toBe(16);
  });

  it('logs structured event with correct fields', async () => {
    const emitConfigFingerprint = await importConfigWithMocks();
    const mockLogger = { info: vi.fn() };
    emitConfigFingerprint(mockLogger);

    expect(mockLogger.info).toHaveBeenCalledTimes(1);
    const [logObj, logMsg] = mockLogger.info.mock.calls[0];

    expect(logObj.event).toBe('config.fingerprint');
    expect(logObj.configFingerprint).toBeDefined();
    expect(logObj.behaviorFingerprint).toBeDefined();
    expect(logObj.behaviorKeys).toBeInstanceOf(Array);
    expect(logObj.runtimeEvaluable).toEqual([]);
    expect(logMsg).toContain('Config fingerprint:');
  });

  it('behaviorFingerprint changes when PARSE_MICRO_USD_MODE changes', async () => {
    // First import with legacy mode
    setRequiredEnv();
    process.env.PARSE_MICRO_USD_MODE = 'legacy';

    vi.doMock('../../src/utils/logger.js', () => ({
      logger: {
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
      },
    }));

    const mod1 = await import('../../src/config.js');
    const mockLogger1 = { info: vi.fn() };
    const result1 = mod1.emitConfigFingerprint(mockLogger1);

    // Reset and import with enforce mode
    vi.resetModules();
    process.env = { ...originalEnv };
    setRequiredEnv();
    process.env.PARSE_MICRO_USD_MODE = 'enforce';

    vi.doMock('../../src/utils/logger.js', () => ({
      logger: {
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
      },
    }));

    const mod2 = await import('../../src/config.js');
    const mockLogger2 = { info: vi.fn() };
    const result2 = mod2.emitConfigFingerprint(mockLogger2);

    expect(result1.behaviorFingerprint).not.toBe(result2.behaviorFingerprint);
  });

  it('configFingerprint is deterministic across calls', async () => {
    const emitConfigFingerprint = await importConfigWithMocks();
    const mockLogger = { info: vi.fn() };
    const result1 = emitConfigFingerprint(mockLogger);
    const result2 = emitConfigFingerprint(mockLogger);

    expect(result1.configFingerprint).toBe(result2.configFingerprint);
  });

  it('does NOT leak secret values in log output', async () => {
    const emitConfigFingerprint = await importConfigWithMocks();
    const mockLogger = { info: vi.fn() };
    emitConfigFingerprint(mockLogger);

    const [logObj, logMsg] = mockLogger.info.mock.calls[0];
    const logStr = JSON.stringify(logObj) + logMsg;

    // Fingerprint values should be hex hashes, not raw config values
    expect(logObj.configFingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(logObj.behaviorFingerprint).toMatch(/^[0-9a-f]{16}$/);

    // Must not contain actual secret env var values
    const secretEnvVars = [
      'TRIGGER_SECRET_KEY',
      'DISCORD_BOT_TOKEN',
      'DATABASE_PATH',
    ];
    for (const key of secretEnvVars) {
      const val = process.env[key];
      // Only check if the value is meaningful (not empty)
      if (val && val.length > 4) {
        expect(logStr).not.toContain(val);
      }
    }
  });

  it('behaviorKeys list includes PARSE_MICRO_USD_MODE', async () => {
    const emitConfigFingerprint = await importConfigWithMocks();
    const mockLogger = { info: vi.fn() };
    emitConfigFingerprint(mockLogger);

    const [logObj] = mockLogger.info.mock.calls[0];
    expect(logObj.behaviorKeys).toContain('PARSE_MICRO_USD_MODE');
  });

  it('runtimeEvaluable is empty (all flags require cold restart)', async () => {
    const emitConfigFingerprint = await importConfigWithMocks();
    const mockLogger = { info: vi.fn() };
    emitConfigFingerprint(mockLogger);

    const [logObj] = mockLogger.info.mock.calls[0];
    expect(logObj.runtimeEvaluable).toEqual([]);
  });
});

/**
 * Regression test — bug 20260530-ecc0b3 (sprint-bug-332).
 *
 * Config-validation failure at import time must NOT crash with
 * `TypeError: logger.fatal is not a function`.
 *
 * Root cause: the throw path in src/config.ts (parseConfig, ~L702) called
 * `logger.fatal(...)`. In CI `.env.local` is absent, so config validation
 * reaches that throw path; and when a sibling unit file in the same vitest
 * worker has `vi.mock('../../src/utils/logger.js', ...)` WITHOUT a `fatal`
 * method (statsService/digestService/tierService do exactly this), the mock
 * leaks and `logger.fatal` is undefined -> TypeError -> 0 tests collected in
 * the importing files. Locally `.env.local` exists so validation passes and the
 * throw path is never hit, which is why main is green on a dev box but red in CI.
 *
 * This test forces the exact condition at unit granularity:
 *   - mock `dotenv` to a no-op so `.env.local`/`.env` cannot satisfy validation
 *   - mock the logger WITHOUT `fatal` (the leaking-sibling shape)
 *   - replace process.env with a minimal map missing all app-required vars
 * so the throw path is reached deterministically, independent of the developer's
 * local env files and the pnpm-vs-npm-ci module layout.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Reproduce the leaking sibling mocks: a logger WITHOUT `fatal`.
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
    child: vi.fn(),
    // NOTE: intentionally NO `fatal` — this is the regression condition.
  },
  createChildLogger: vi.fn(),
  piiScrubber: vi.fn(),
}));

// Prevent .env.local / .env from satisfying validation, so the throw path is
// reached deterministically regardless of the developer's local env files.
vi.mock('dotenv', () => ({
  config: vi.fn(() => ({ parsed: {} })),
  default: { config: vi.fn(() => ({ parsed: {} })) },
}));

const ORIGINAL_ENV = process.env;

describe('config validation throw path (bug 20260530-ecc0b3)', () => {
  beforeEach(() => {
    vi.resetModules();
    // Minimal env missing all app-required vars -> Zod validation must fail.
    process.env = { NODE_ENV: 'test' } as NodeJS.ProcessEnv;
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('surfaces a clean "Configuration validation failed" Error, not a logger.fatal TypeError', async () => {
    let caught: unknown;
    try {
      await import('../../src/config.js');
    } catch (e) {
      caught = e;
    }

    expect(
      caught,
      'importing config with empty env must throw a validation error'
    ).toBeDefined();
    // The regression: pre-fix this is `TypeError: logger.fatal is not a function`.
    expect(caught).not.toBeInstanceOf(TypeError);
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(/Configuration validation failed/);
    expect((caught as Error).message).not.toMatch(
      /logger\.fatal is not a function/
    );
  });
});

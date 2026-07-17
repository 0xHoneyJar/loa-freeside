/**
 * tests/setup-unit.ts — Canonical test-environment placeholder convention
 *
 * Defines the `test-*` placeholder values for CI env vars per SDD §4.1.
 * These are injected in CI job `env:` blocks (ci.yml integration-tests,
 * agent-ci.yml) to satisfy Zod schema validation without real credentials.
 *
 * Invariant: every value MUST be a recognizable placeholder — no value may
 * function as a real credential. The `test-*` prefix convention enforces
 * this visually and is checked by the pre-deploy credential scan.
 *
 * References:
 *   - SDD §4.1 Environment Variable Contract
 *   - .github/workflows/ci.yml (integration-tests job env block)
 *   - .github/workflows/agent-ci.yml (agent-ci job env block)
 */

/** Canonical placeholder values for unit and integration test environments. */
export const TEST_ENV_DEFAULTS = {
  // Network
  REDIS_URL: 'redis://localhost:6379',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/freeside_test',

  // Chain
  BERACHAIN_RPC_URLS: 'https://rpc.test.example.com',
  BGT_ADDRESS: '0x0000000000000000000000000000000000000001',

  // Trigger.dev
  TRIGGER_PROJECT_ID: 'test-project-id',
  TRIGGER_SECRET_KEY: 'test-secret-key',

  // Discord
  DISCORD_BOT_TOKEN: 'test-bot-token',
  DISCORD_GUILD_ID: 'test-guild-id',
  DISCORD_CHANNEL_THE_DOOR: 'test-channel-the-door',
  DISCORD_CHANNEL_CENSUS: 'test-channel-census',
  DISCORD_ROLE_NAIB: 'test-role-naib',
  DISCORD_ROLE_FEDAYKIN: 'test-role-fedaykin',

  // API auth (32-char minimum for pepper)
  ADMIN_API_KEYS: 'test-key:test-admin',
  API_KEY_PEPPER: 'test-pepper-value-for-unit-tests-32chars!',
  RATE_LIMIT_SALT: 'test-rate-limit-salt-value',

  // Runtime
  NODE_ENV: 'test',
  LOG_LEVEL: 'error',
} as const;

/**
 * Apply test env defaults to process.env for the current test run.
 * Called in vitest setupFiles or test helpers that need a clean env.
 * Only sets vars that are NOT already set — existing env takes precedence
 * so per-test overrides (e.g. REDIS_URL pointing at a local service) work.
 */
export function applyTestEnvDefaults(): void {
  for (const [key, value] of Object.entries(TEST_ENV_DEFAULTS)) {
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

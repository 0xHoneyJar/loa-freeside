import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('Config Module', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset modules to allow re-import with new env vars
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('validateApiKey', () => {
    it('returns admin name for valid API key', async () => {
      process.env.BERACHAIN_RPC_URL = 'https://rpc.berachain.com';
      process.env.BGT_ADDRESS = '0x1234567890123456789012345678901234567890';
      process.env.REWARD_VAULT_ADDRESSES = '0x1234567890123456789012345678901234567891';
      process.env.TRIGGER_PROJECT_ID = 'test-project';
      process.env.TRIGGER_SECRET_KEY = 'test-secret';
      process.env.DISCORD_BOT_TOKEN = 'test-token';
      process.env.DISCORD_GUILD_ID = '123456789';
      process.env.DISCORD_CHANNEL_THE_DOOR = '123456789';
      process.env.DISCORD_CHANNEL_CENSUS = '123456789';
      process.env.DISCORD_ROLE_NAIB = '123456789';
      process.env.DISCORD_ROLE_FEDAYKIN = '123456789';
      process.env.ADMIN_API_KEYS = 'test_key:TestAdmin,other_key:OtherAdmin';
      process.env.DATABASE_PATH = './test.db';

      // Mock logger before importing config
      vi.doMock('../../src/utils/logger.js', () => ({
        logger: {
          info: vi.fn(),
          debug: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
          fatal: vi.fn(),
        },
      }));

      const { validateApiKey } = await import('../../src/config.js');

      expect(validateApiKey('test_key')).toBe('TestAdmin');
      expect(validateApiKey('other_key')).toBe('OtherAdmin');
      expect(validateApiKey('invalid_key')).toBeUndefined();
    });
  });

  describe('address validation', () => {
    it('accepts valid Ethereum addresses', async () => {
      process.env.BERACHAIN_RPC_URL = 'https://rpc.berachain.com';
      process.env.BGT_ADDRESS = '0x1234567890123456789012345678901234567890';
      process.env.REWARD_VAULT_ADDRESSES = '0x1234567890123456789012345678901234567891,0xabcdef1234567890123456789012345678901234';
      process.env.TRIGGER_PROJECT_ID = 'test-project';
      process.env.TRIGGER_SECRET_KEY = 'test-secret';
      process.env.DISCORD_BOT_TOKEN = 'test-token';
      process.env.DISCORD_GUILD_ID = '123456789';
      process.env.DISCORD_CHANNEL_THE_DOOR = '123456789';
      process.env.DISCORD_CHANNEL_CENSUS = '123456789';
      process.env.DISCORD_ROLE_NAIB = '123456789';
      process.env.DISCORD_ROLE_FEDAYKIN = '123456789';
      process.env.ADMIN_API_KEYS = 'key:name';
      process.env.DATABASE_PATH = './test.db';

      vi.doMock('../../src/utils/logger.js', () => ({
        logger: {
          info: vi.fn(),
          debug: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
          fatal: vi.fn(),
        },
      }));

      const { config } = await import('../../src/config.js');

      expect(config.chain.bgtAddress).toBe('0x1234567890123456789012345678901234567890');
      expect(config.chain.rewardVaultAddresses).toHaveLength(2);
    });
  });
});

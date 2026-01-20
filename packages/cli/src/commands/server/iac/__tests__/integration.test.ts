/**
 * Discord API Integration Tests
 *
 * Sprint 91: Discord Infrastructure-as-Code - Config Parsing & State Reading
 *
 * Tests real Discord API interactions. Requires DISCORD_BOT_TOKEN environment variable.
 * These tests are skipped by default unless running with INTEGRATION_TEST=1.
 *
 * @example
 * # Run integration tests
 * INTEGRATION_TEST=1 DISCORD_BOT_TOKEN=your-token DISCORD_GUILD_ID=your-guild pnpm test
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  DiscordClient,
  DiscordApiError,
  DiscordErrorCode,
  createClientFromEnv,
  mapChannelType,
} from '../DiscordClient.js';
import { readServerState } from '../StateReader.js';
import type { Snowflake } from '../types.js';

// Skip integration tests unless explicitly enabled
const SKIP_INTEGRATION = process.env.INTEGRATION_TEST !== '1';
const describeIntegration = SKIP_INTEGRATION ? describe.skip : describe;

describeIntegration('Discord API Integration', () => {
  let client: DiscordClient;
  let guildId: Snowflake;

  beforeAll(() => {
    if (SKIP_INTEGRATION) return;

    // Validate required environment variables
    const token = process.env.DISCORD_BOT_TOKEN;
    guildId = process.env.DISCORD_GUILD_ID || '';

    if (!token) {
      throw new Error(
        'DISCORD_BOT_TOKEN environment variable is required for integration tests'
      );
    }

    if (!guildId) {
      throw new Error(
        'DISCORD_GUILD_ID environment variable is required for integration tests'
      );
    }

    client = new DiscordClient({ token });
  });

  // ==========================================================================
  // DiscordClient Tests
  // ==========================================================================

  describe('DiscordClient', () => {
    it('should create client from environment', () => {
      const envClient = createClientFromEnv();
      expect(envClient).toBeInstanceOf(DiscordClient);
    });

    it('should mask token correctly', () => {
      const masked = client.getMaskedToken();
      expect(masked).toMatch(/^.{10}\.\.\.{5}$/);
      expect(masked).not.toContain(process.env.DISCORD_BOT_TOKEN);
    });

    it('should fetch guild data successfully', async () => {
      const data = await client.fetchGuildData(guildId);

      expect(data.guild).toBeDefined();
      expect(data.guild.id).toBe(guildId);
      expect(data.guild.name).toBeTruthy();

      expect(data.roles).toBeDefined();
      expect(Array.isArray(data.roles)).toBe(true);
      expect(data.roles.length).toBeGreaterThan(0); // At least @everyone

      expect(data.channels).toBeDefined();
      expect(Array.isArray(data.channels)).toBe(true);
    });

    it('should fetch guild info only', async () => {
      const guild = await client.fetchGuild(guildId);
      expect(guild.id).toBe(guildId);
      expect(guild.name).toBeTruthy();
    });

    it('should fetch roles only', async () => {
      const roles = await client.fetchRoles(guildId);
      expect(Array.isArray(roles)).toBe(true);
      expect(roles.length).toBeGreaterThan(0);

      // Should include @everyone role
      const everyoneRole = roles.find((r) => r.id === guildId);
      expect(everyoneRole).toBeDefined();
    });

    it('should fetch channels only', async () => {
      const channels = await client.fetchChannels(guildId);
      expect(Array.isArray(channels)).toBe(true);
    });

    it('should validate guild access', async () => {
      const hasAccess = await client.validateGuildAccess(guildId);
      expect(hasAccess).toBe(true);
    });

    it('should throw GUILD_NOT_FOUND for invalid guild', async () => {
      try {
        await client.fetchGuild('999999999999999999');
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(DiscordApiError);
        expect((error as DiscordApiError).code).toBe(DiscordErrorCode.GUILD_NOT_FOUND);
      }
    });
  });

  // ==========================================================================
  // StateReader Tests
  // ==========================================================================

  describe('StateReader', () => {
    it('should read complete server state', async () => {
      const state = await readServerState(client, guildId);

      expect(state.id).toBe(guildId);
      expect(state.name).toBeTruthy();
      expect(state.fetchedAt).toBeInstanceOf(Date);

      // Roles
      expect(Array.isArray(state.roles)).toBe(true);
      expect(state.roles.length).toBeGreaterThan(0);

      // Should have @everyone
      const everyone = state.roles.find((r) => r.isEveryone);
      expect(everyone).toBeDefined();
      expect(everyone?.id).toBe(guildId);

      // Categories and channels
      expect(Array.isArray(state.categories)).toBe(true);
      expect(Array.isArray(state.channels)).toBe(true);
    });

    it('should sort roles by position descending', async () => {
      const state = await readServerState(client, guildId);

      for (let i = 0; i < state.roles.length - 1; i++) {
        expect(state.roles[i].position).toBeGreaterThanOrEqual(state.roles[i + 1].position);
      }
    });

    it('should sort categories by position ascending', async () => {
      const state = await readServerState(client, guildId);

      for (let i = 0; i < state.categories.length - 1; i++) {
        expect(state.categories[i].position).toBeLessThanOrEqual(
          state.categories[i + 1].position
        );
      }
    });

    it('should sort channels by position ascending', async () => {
      const state = await readServerState(client, guildId);

      for (let i = 0; i < state.channels.length - 1; i++) {
        expect(state.channels[i].position).toBeLessThanOrEqual(
          state.channels[i + 1].position
        );
      }
    });

    it('should convert role colors to hex format', async () => {
      const state = await readServerState(client, guildId);

      for (const role of state.roles) {
        expect(role.color).toMatch(/^#[0-9A-F]{6}$/);
      }
    });

    it('should convert role permissions to flag arrays', async () => {
      const state = await readServerState(client, guildId);

      for (const role of state.roles) {
        expect(Array.isArray(role.permissions)).toBe(true);
        // All permissions should be valid flags
        for (const perm of role.permissions) {
          expect(typeof perm).toBe('string');
        }
      }
    });

    it('should resolve channel parent names', async () => {
      const state = await readServerState(client, guildId);

      for (const channel of state.channels) {
        if (channel.parentId) {
          // If channel has a parent ID, it should have the parent name resolved
          expect(channel.parentName).toBeTruthy();

          // Verify parent exists in categories
          const parent = state.categories.find((c) => c.id === channel.parentId);
          expect(parent).toBeDefined();
          expect(channel.parentName).toBe(parent?.name);
        }
      }
    });

    it('should filter managed roles when includeManagedRoles is false', async () => {
      const state = await readServerState(client, guildId, {
        includeManagedRoles: false,
      });

      // No roles should have managed: true (excluding bots)
      const managedRoles = state.roles.filter((r) => r.managed);
      expect(managedRoles).toHaveLength(0);
    });

    it('should include managed roles when includeManagedRoles is true', async () => {
      const stateWithManaged = await readServerState(client, guildId, {
        includeManagedRoles: true,
      });
      const stateWithoutManaged = await readServerState(client, guildId, {
        includeManagedRoles: false,
      });

      // Should have same or more roles when including managed
      expect(stateWithManaged.roles.length).toBeGreaterThanOrEqual(
        stateWithoutManaged.roles.length
      );
    });

    it('should include unmanaged resources when includeUnmanaged is true', async () => {
      const state = await readServerState(client, guildId, {
        includeUnmanaged: true,
      });

      // Should include all roles, categories, channels
      expect(state.roles.length).toBeGreaterThan(0);
    });

    it('should filter to only IaC-managed when includeUnmanaged is false', async () => {
      const stateAll = await readServerState(client, guildId, {
        includeUnmanaged: true,
      });
      const stateManaged = await readServerState(client, guildId, {
        includeUnmanaged: false,
      });

      // Managed state should have same or fewer resources
      expect(stateManaged.roles.length).toBeLessThanOrEqual(stateAll.roles.length);
      expect(stateManaged.categories.length).toBeLessThanOrEqual(stateAll.categories.length);
      expect(stateManaged.channels.length).toBeLessThanOrEqual(stateAll.channels.length);

      // @everyone should still be included
      const everyone = stateManaged.roles.find((r) => r.isEveryone);
      expect(everyone).toBeDefined();
    });

    it('should handle voice channel specific fields', async () => {
      const state = await readServerState(client, guildId);

      const voiceChannels = state.channels.filter((c) => c.type === 'voice');
      for (const vc of voiceChannels) {
        // Voice channels should have bitrate
        expect(vc.bitrate).toBeGreaterThan(0);
        // userLimit can be 0 (unlimited)
        expect(typeof vc.userLimit).toBe('number');
      }
    });

    it('should map channel types correctly', async () => {
      const state = await readServerState(client, guildId);

      const validTypes = ['text', 'voice', 'announcement', 'stage', 'forum'];
      for (const channel of state.channels) {
        expect(validTypes).toContain(channel.type);
      }
    });

    it('should convert permission overwrites with names', async () => {
      const state = await readServerState(client, guildId);

      for (const channel of state.channels) {
        for (const overwrite of channel.permissionOverwrites) {
          expect(overwrite.id).toBeTruthy();
          expect(overwrite.name).toBeTruthy();
          expect(['role', 'member']).toContain(overwrite.type);
          expect(Array.isArray(overwrite.allow)).toBe(true);
          expect(Array.isArray(overwrite.deny)).toBe(true);
        }
      }
    });
  });

  // ==========================================================================
  // Error Handling Tests
  // ==========================================================================

  describe('Error handling', () => {
    it('should handle invalid token', async () => {
      const badClient = new DiscordClient({ token: 'invalid-token' });

      try {
        await badClient.fetchGuild(guildId);
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(DiscordApiError);
        expect((error as DiscordApiError).code).toBe(DiscordErrorCode.INVALID_TOKEN);
      }
    });

    it('should throw GUILD_NOT_FOUND for inaccessible guild', async () => {
      // Random snowflake that doesn't exist
      const fakeGuildId = '123456789012345678';

      try {
        await client.fetchGuild(fakeGuildId);
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(DiscordApiError);
        expect((error as DiscordApiError).code).toBe(DiscordErrorCode.GUILD_NOT_FOUND);
      }
    });
  });

  // ==========================================================================
  // Utility Function Tests
  // ==========================================================================

  describe('mapChannelType', () => {
    it('should map Discord channel types to IaC types', () => {
      expect(mapChannelType(0)).toBe('text'); // GuildText
      expect(mapChannelType(2)).toBe('voice'); // GuildVoice
      expect(mapChannelType(5)).toBe('announcement'); // GuildAnnouncement
      expect(mapChannelType(13)).toBe('stage'); // GuildStageVoice
      expect(mapChannelType(15)).toBe('forum'); // GuildForum
    });

    it('should return null for unsupported types', () => {
      expect(mapChannelType(1)).toBeNull(); // DM
      expect(mapChannelType(3)).toBeNull(); // GroupDM
      expect(mapChannelType(4)).toBeNull(); // GuildCategory (handled separately)
    });
  });
});

// ==========================================================================
// Non-integration tests (always run)
// ==========================================================================

describe('DiscordClient utilities', () => {
  describe('createClientFromEnv', () => {
    it('should throw if DISCORD_BOT_TOKEN and DISCORD_TOKEN not set', () => {
      const originalBotToken = process.env.DISCORD_BOT_TOKEN;
      const originalToken = process.env.DISCORD_TOKEN;
      delete process.env.DISCORD_BOT_TOKEN;
      delete process.env.DISCORD_TOKEN;

      try {
        expect(() => createClientFromEnv()).toThrow('Discord bot token not found');
      } finally {
        if (originalBotToken) {
          process.env.DISCORD_BOT_TOKEN = originalBotToken;
        }
        if (originalToken) {
          process.env.DISCORD_TOKEN = originalToken;
        }
      }
    });
  });

  describe('mapChannelType', () => {
    it('should map known types', () => {
      expect(mapChannelType(0)).toBe('text');
      expect(mapChannelType(2)).toBe('voice');
      expect(mapChannelType(5)).toBe('announcement');
      expect(mapChannelType(13)).toBe('stage');
      expect(mapChannelType(15)).toBe('forum');
    });

    it('should return null for unknown types', () => {
      expect(mapChannelType(1)).toBeNull();
      expect(mapChannelType(4)).toBeNull();
      expect(mapChannelType(99)).toBeNull();
    });
  });
});

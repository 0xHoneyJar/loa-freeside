/**
 * StateReader Unit Tests
 *
 * Sprint 91: Discord Infrastructure-as-Code - Config Parsing & State Reading
 *
 * Tests state reading utilities and type conversions.
 */

import { describe, it, expect } from 'vitest';
import type { ServerState, RoleState, CategoryState, ChannelState } from '../types.js';
import {
  findRoleByName,
  findCategoryByName,
  findChannelByName,
  getEveryoneRole,
  getManagedResources,
  buildResourceMappings,
} from '../StateReader.js';

// Helper to create mock server state
function createMockServerState(overrides?: Partial<ServerState>): ServerState {
  return {
    id: '123456789',
    name: 'Test Server',
    roles: [
      {
        id: '123456789', // Same as guild ID = @everyone
        name: '@everyone',
        color: '#000000',
        hoist: false,
        mentionable: false,
        permissions: ['VIEW_CHANNEL'],
        position: 0,
        managed: false,
        isEveryone: true,
        isIacManaged: false,
      },
      {
        id: '111111111',
        name: 'Admin',
        color: '#FF0000',
        hoist: true,
        mentionable: false,
        permissions: ['ADMINISTRATOR'],
        position: 10,
        managed: false,
        isEveryone: false,
        isIacManaged: true,
      },
      {
        id: '222222222',
        name: 'Moderator',
        color: '#00FF00',
        hoist: true,
        mentionable: true,
        permissions: ['KICK_MEMBERS', 'BAN_MEMBERS'],
        position: 5,
        managed: false,
        isEveryone: false,
        isIacManaged: true,
      },
      {
        id: '333333333',
        name: 'Bot Role',
        color: '#0000FF',
        hoist: false,
        mentionable: false,
        permissions: [],
        position: 8,
        managed: true, // Integration-managed
        isEveryone: false,
        isIacManaged: false,
      },
    ],
    categories: [
      {
        id: '444444444',
        name: 'General',
        position: 0,
        permissionOverwrites: [],
        isIacManaged: true,
      },
      {
        id: '555555555',
        name: 'Voice Channels',
        position: 1,
        permissionOverwrites: [],
        isIacManaged: false,
      },
    ],
    channels: [
      {
        id: '666666666',
        name: 'general',
        type: 'text',
        parentId: '444444444',
        parentName: 'General',
        topic: 'General chat [managed-by:arrakis-iac]',
        nsfw: false,
        slowmode: 0,
        position: 0,
        permissionOverwrites: [],
        isIacManaged: true,
      },
      {
        id: '777777777',
        name: 'announcements',
        type: 'announcement',
        parentId: '444444444',
        parentName: 'General',
        nsfw: false,
        slowmode: 0,
        position: 1,
        permissionOverwrites: [],
        isIacManaged: true,
      },
      {
        id: '888888888',
        name: 'voice-chat',
        type: 'voice',
        parentId: '555555555',
        parentName: 'Voice Channels',
        nsfw: false,
        slowmode: 0,
        position: 0,
        permissionOverwrites: [],
        bitrate: 64000,
        userLimit: 10,
        isIacManaged: false,
      },
    ],
    fetchedAt: new Date('2025-01-18T00:00:00Z'),
    ...overrides,
  };
}

describe('StateReader utilities', () => {
  // ==========================================================================
  // findRoleByName
  // ==========================================================================

  describe('findRoleByName', () => {
    it('should find role by exact name', () => {
      const state = createMockServerState();
      const role = findRoleByName(state, 'Admin');
      expect(role).toBeDefined();
      expect(role?.id).toBe('111111111');
    });

    it('should find role case-insensitively', () => {
      const state = createMockServerState();
      expect(findRoleByName(state, 'admin')?.id).toBe('111111111');
      expect(findRoleByName(state, 'ADMIN')?.id).toBe('111111111');
      expect(findRoleByName(state, 'AdMiN')?.id).toBe('111111111');
    });

    it('should return undefined for non-existent role', () => {
      const state = createMockServerState();
      expect(findRoleByName(state, 'NonExistent')).toBeUndefined();
    });

    it('should find @everyone role', () => {
      const state = createMockServerState();
      const role = findRoleByName(state, '@everyone');
      expect(role).toBeDefined();
      expect(role?.isEveryone).toBe(true);
    });
  });

  // ==========================================================================
  // findCategoryByName
  // ==========================================================================

  describe('findCategoryByName', () => {
    it('should find category by exact name', () => {
      const state = createMockServerState();
      const category = findCategoryByName(state, 'General');
      expect(category).toBeDefined();
      expect(category?.id).toBe('444444444');
    });

    it('should find category case-insensitively', () => {
      const state = createMockServerState();
      expect(findCategoryByName(state, 'general')?.id).toBe('444444444');
      expect(findCategoryByName(state, 'GENERAL')?.id).toBe('444444444');
    });

    it('should return undefined for non-existent category', () => {
      const state = createMockServerState();
      expect(findCategoryByName(state, 'NonExistent')).toBeUndefined();
    });
  });

  // ==========================================================================
  // findChannelByName
  // ==========================================================================

  describe('findChannelByName', () => {
    it('should find channel by exact name', () => {
      const state = createMockServerState();
      const channel = findChannelByName(state, 'general');
      expect(channel).toBeDefined();
      expect(channel?.id).toBe('666666666');
    });

    it('should find channel case-insensitively', () => {
      const state = createMockServerState();
      expect(findChannelByName(state, 'GENERAL')?.id).toBe('666666666');
      expect(findChannelByName(state, 'General')?.id).toBe('666666666');
    });

    it('should return undefined for non-existent channel', () => {
      const state = createMockServerState();
      expect(findChannelByName(state, 'nonexistent')).toBeUndefined();
    });

    it('should find voice channels', () => {
      const state = createMockServerState();
      const channel = findChannelByName(state, 'voice-chat');
      expect(channel).toBeDefined();
      expect(channel?.type).toBe('voice');
    });
  });

  // ==========================================================================
  // getEveryoneRole
  // ==========================================================================

  describe('getEveryoneRole', () => {
    it('should return @everyone role', () => {
      const state = createMockServerState();
      const everyone = getEveryoneRole(state);
      expect(everyone).toBeDefined();
      expect(everyone?.isEveryone).toBe(true);
      expect(everyone?.name).toBe('@everyone');
    });

    it('should return undefined if no @everyone role', () => {
      const state = createMockServerState({
        roles: [
          {
            id: '111111111',
            name: 'Admin',
            color: '#FF0000',
            hoist: true,
            mentionable: false,
            permissions: [],
            position: 10,
            managed: false,
            isEveryone: false,
            isIacManaged: true,
          },
        ],
      });
      expect(getEveryoneRole(state)).toBeUndefined();
    });
  });

  // ==========================================================================
  // getManagedResources
  // ==========================================================================

  describe('getManagedResources', () => {
    it('should return only IaC-managed resources', () => {
      const state = createMockServerState();
      const managed = getManagedResources(state);

      // Check roles - Admin and Moderator are managed, @everyone and Bot Role are not
      expect(managed.roles).toHaveLength(2);
      expect(managed.roles.map((r) => r.name)).toContain('Admin');
      expect(managed.roles.map((r) => r.name)).toContain('Moderator');
      expect(managed.roles.map((r) => r.name)).not.toContain('@everyone');
      expect(managed.roles.map((r) => r.name)).not.toContain('Bot Role');

      // Check categories - General is managed, Voice Channels is not
      expect(managed.categories).toHaveLength(1);
      expect(managed.categories[0].name).toBe('General');

      // Check channels - general and announcements are managed, voice-chat is not
      expect(managed.channels).toHaveLength(2);
      expect(managed.channels.map((c) => c.name)).toContain('general');
      expect(managed.channels.map((c) => c.name)).toContain('announcements');
      expect(managed.channels.map((c) => c.name)).not.toContain('voice-chat');
    });

    it('should return empty arrays when nothing is managed', () => {
      const state = createMockServerState({
        roles: [
          {
            id: '123456789',
            name: '@everyone',
            color: '#000000',
            hoist: false,
            mentionable: false,
            permissions: [],
            position: 0,
            managed: false,
            isEveryone: true,
            isIacManaged: false,
          },
        ],
        categories: [],
        channels: [],
      });
      const managed = getManagedResources(state);
      expect(managed.roles).toHaveLength(0);
      expect(managed.categories).toHaveLength(0);
      expect(managed.channels).toHaveLength(0);
    });
  });

  // ==========================================================================
  // buildResourceMappings
  // ==========================================================================

  describe('buildResourceMappings', () => {
    it('should build name-to-ID mappings', () => {
      const state = createMockServerState();
      const mappings = buildResourceMappings(state);

      // Check role mappings (lowercase keys)
      expect(mappings.roles.get('admin')).toBe('111111111');
      expect(mappings.roles.get('moderator')).toBe('222222222');
      expect(mappings.roles.get('@everyone')).toBe('123456789');

      // Check category mappings
      expect(mappings.categories.get('general')).toBe('444444444');
      expect(mappings.categories.get('voice channels')).toBe('555555555');

      // Check channel mappings
      expect(mappings.channels.get('general')).toBe('666666666');
      expect(mappings.channels.get('announcements')).toBe('777777777');
      expect(mappings.channels.get('voice-chat')).toBe('888888888');
    });

    it('should handle empty state', () => {
      const state = createMockServerState({
        roles: [],
        categories: [],
        channels: [],
      });
      const mappings = buildResourceMappings(state);
      expect(mappings.roles.size).toBe(0);
      expect(mappings.categories.size).toBe(0);
      expect(mappings.channels.size).toBe(0);
    });

    it('should use lowercase keys', () => {
      const state = createMockServerState();
      const mappings = buildResourceMappings(state);

      // Ensure keys are lowercase
      expect(mappings.roles.has('Admin')).toBe(false);
      expect(mappings.roles.has('admin')).toBe(true);
    });
  });
});

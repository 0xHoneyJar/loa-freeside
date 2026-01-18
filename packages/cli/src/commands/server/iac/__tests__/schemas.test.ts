/**
 * Schema Unit Tests
 *
 * Sprint 91: Discord Infrastructure-as-Code - Config Parsing & State Reading
 *
 * Tests Zod schemas and utility functions for Discord IaC.
 */

import { describe, it, expect } from 'vitest';
import {
  PermissionFlag,
  PERMISSION_FLAGS,
  permissionsToBitfield,
  bitfieldToPermissions,
  ColorSchema,
  colorToInt,
  intToColor,
  ChannelType,
  CHANNEL_TYPES,
  RoleSchema,
  CategorySchema,
  ChannelSchema,
  ServerConfigSchema,
  MANAGED_MARKER,
  isManaged,
  addManagedMarker,
  removeManagedMarker,
} from '../schemas.js';

describe('schemas', () => {
  // ==========================================================================
  // Permission Utilities
  // ==========================================================================

  describe('Permission utilities', () => {
    describe('permissionsToBitfield', () => {
      it('should convert empty array to 0', () => {
        expect(permissionsToBitfield([])).toBe('0');
      });

      it('should convert single permission', () => {
        const result = permissionsToBitfield(['VIEW_CHANNEL']);
        expect(BigInt(result)).toBe(1n << 10n);
      });

      it('should combine multiple permissions', () => {
        const result = permissionsToBitfield(['VIEW_CHANNEL', 'SEND_MESSAGES']);
        const value = BigInt(result);
        expect(value & (1n << 10n)).toBe(1n << 10n); // VIEW_CHANNEL
        expect(value & (1n << 11n)).toBe(1n << 11n); // SEND_MESSAGES
      });

      it('should handle ADMINISTRATOR', () => {
        const result = permissionsToBitfield(['ADMINISTRATOR']);
        expect(BigInt(result)).toBe(1n << 3n);
      });

      it('should handle all common permissions', () => {
        const commonPerms: PermissionFlag[] = [
          'VIEW_CHANNEL',
          'SEND_MESSAGES',
          'READ_MESSAGE_HISTORY',
          'ADD_REACTIONS',
          'EMBED_LINKS',
          'ATTACH_FILES',
        ];
        const result = permissionsToBitfield(commonPerms);
        const value = BigInt(result);
        expect(value).toBeGreaterThan(0n);
      });
    });

    describe('bitfieldToPermissions', () => {
      it('should convert 0 to empty array', () => {
        expect(bitfieldToPermissions('0')).toEqual([]);
      });

      it('should convert single permission bitfield', () => {
        const bitfield = (1n << 10n).toString(); // VIEW_CHANNEL
        const result = bitfieldToPermissions(bitfield);
        expect(result).toContain('VIEW_CHANNEL');
        expect(result).toHaveLength(1);
      });

      it('should convert multiple permissions bitfield', () => {
        const bitfield = ((1n << 10n) | (1n << 11n)).toString();
        const result = bitfieldToPermissions(bitfield);
        expect(result).toContain('VIEW_CHANNEL');
        expect(result).toContain('SEND_MESSAGES');
      });

      it('should round-trip permissions', () => {
        const original: PermissionFlag[] = ['KICK_MEMBERS', 'BAN_MEMBERS', 'MANAGE_CHANNELS'];
        const bitfield = permissionsToBitfield(original);
        const result = bitfieldToPermissions(bitfield);
        expect(result.sort()).toEqual(original.sort());
      });
    });

    describe('PERMISSION_FLAGS', () => {
      it('should have correct bit positions', () => {
        expect(PERMISSION_FLAGS.CREATE_INSTANT_INVITE).toBe(1n << 0n);
        expect(PERMISSION_FLAGS.KICK_MEMBERS).toBe(1n << 1n);
        expect(PERMISSION_FLAGS.BAN_MEMBERS).toBe(1n << 2n);
        expect(PERMISSION_FLAGS.ADMINISTRATOR).toBe(1n << 3n);
        expect(PERMISSION_FLAGS.VIEW_CHANNEL).toBe(1n << 10n);
        expect(PERMISSION_FLAGS.SEND_MESSAGES).toBe(1n << 11n);
      });

      it('should cover all PermissionFlag enum values', () => {
        const enumValues = PermissionFlag.options;
        for (const perm of enumValues) {
          expect(PERMISSION_FLAGS[perm]).toBeDefined();
          expect(typeof PERMISSION_FLAGS[perm]).toBe('bigint');
        }
      });
    });
  });

  // ==========================================================================
  // Color Utilities
  // ==========================================================================

  describe('Color utilities', () => {
    describe('ColorSchema', () => {
      it('should accept valid 6-digit hex', () => {
        const result = ColorSchema.parse('#FF0000');
        expect(result).toBe('#FF0000');
      });

      it('should accept lowercase hex', () => {
        const result = ColorSchema.parse('#ff0000');
        expect(result).toBe('#FF0000');
      });

      it('should normalize 3-digit hex to 6-digit', () => {
        expect(ColorSchema.parse('#F00')).toBe('#FF0000');
        expect(ColorSchema.parse('#0F0')).toBe('#00FF00');
        expect(ColorSchema.parse('#00F')).toBe('#0000FF');
        expect(ColorSchema.parse('#FFF')).toBe('#FFFFFF');
        expect(ColorSchema.parse('#000')).toBe('#000000');
      });

      it('should reject invalid formats', () => {
        expect(() => ColorSchema.parse('red')).toThrow();
        expect(() => ColorSchema.parse('#GGGGGG')).toThrow();
        expect(() => ColorSchema.parse('FF0000')).toThrow();
        expect(() => ColorSchema.parse('#FF00')).toThrow();
        expect(() => ColorSchema.parse('#FF00000')).toThrow();
      });
    });

    describe('colorToInt', () => {
      it('should convert hex to integer', () => {
        expect(colorToInt('#FF0000')).toBe(16711680); // Red
        expect(colorToInt('#00FF00')).toBe(65280); // Green
        expect(colorToInt('#0000FF')).toBe(255); // Blue
        expect(colorToInt('#FFFFFF')).toBe(16777215); // White
        expect(colorToInt('#000000')).toBe(0); // Black
      });
    });

    describe('intToColor', () => {
      it('should convert integer to hex', () => {
        expect(intToColor(16711680)).toBe('#FF0000');
        expect(intToColor(65280)).toBe('#00FF00');
        expect(intToColor(255)).toBe('#0000FF');
        expect(intToColor(0)).toBe('#000000');
      });

      it('should pad with zeros', () => {
        expect(intToColor(1)).toBe('#000001');
        expect(intToColor(255)).toBe('#0000FF');
      });

      it('should round-trip with colorToInt', () => {
        const colors = ['#FF0000', '#00FF00', '#0000FF', '#123456', '#ABCDEF'];
        for (const color of colors) {
          expect(intToColor(colorToInt(color))).toBe(color);
        }
      });
    });
  });

  // ==========================================================================
  // Channel Types
  // ==========================================================================

  describe('Channel types', () => {
    describe('ChannelType', () => {
      it('should accept valid channel types', () => {
        expect(ChannelType.parse('text')).toBe('text');
        expect(ChannelType.parse('voice')).toBe('voice');
        expect(ChannelType.parse('announcement')).toBe('announcement');
        expect(ChannelType.parse('stage')).toBe('stage');
        expect(ChannelType.parse('forum')).toBe('forum');
      });

      it('should reject invalid types', () => {
        expect(() => ChannelType.parse('dm')).toThrow();
        expect(() => ChannelType.parse('private')).toThrow();
      });
    });

    describe('CHANNEL_TYPES', () => {
      it('should map to Discord API values', () => {
        expect(CHANNEL_TYPES.text).toBe(0);
        expect(CHANNEL_TYPES.voice).toBe(2);
        expect(CHANNEL_TYPES.announcement).toBe(5);
        expect(CHANNEL_TYPES.stage).toBe(13);
        expect(CHANNEL_TYPES.forum).toBe(15);
      });
    });
  });

  // ==========================================================================
  // Role Schema
  // ==========================================================================

  describe('RoleSchema', () => {
    it('should accept minimal role', () => {
      const result = RoleSchema.parse({ name: 'Test' });
      expect(result.name).toBe('Test');
      expect(result.hoist).toBe(false);
      expect(result.mentionable).toBe(false);
      expect(result.permissions).toEqual([]);
    });

    it('should accept full role config', () => {
      const result = RoleSchema.parse({
        name: 'Admin',
        color: '#FF0000',
        hoist: true,
        mentionable: true,
        permissions: ['ADMINISTRATOR'],
        position: 10,
      });
      expect(result.name).toBe('Admin');
      expect(result.color).toBe('#FF0000');
      expect(result.hoist).toBe(true);
      expect(result.permissions).toContain('ADMINISTRATOR');
      expect(result.position).toBe(10);
    });

    it('should reject empty name', () => {
      expect(() => RoleSchema.parse({ name: '' })).toThrow();
    });

    it('should reject name over 100 characters', () => {
      expect(() => RoleSchema.parse({ name: 'a'.repeat(101) })).toThrow();
    });

    it('should reject negative position', () => {
      expect(() => RoleSchema.parse({ name: 'Test', position: -1 })).toThrow();
    });
  });

  // ==========================================================================
  // Category Schema
  // ==========================================================================

  describe('CategorySchema', () => {
    it('should accept minimal category', () => {
      const result = CategorySchema.parse({ name: 'General' });
      expect(result.name).toBe('General');
    });

    it('should accept category with permissions', () => {
      const result = CategorySchema.parse({
        name: 'Private',
        position: 0,
        permissions: {
          '@everyone': { deny: ['VIEW_CHANNEL'] },
        },
      });
      expect(result.permissions!['@everyone'].deny).toContain('VIEW_CHANNEL');
    });

    it('should reject empty name', () => {
      expect(() => CategorySchema.parse({ name: '' })).toThrow();
    });
  });

  // ==========================================================================
  // Channel Schema
  // ==========================================================================

  describe('ChannelSchema', () => {
    it('should accept minimal channel', () => {
      const result = ChannelSchema.parse({ name: 'general' });
      expect(result.name).toBe('general');
      expect(result.type).toBe('text');
      expect(result.nsfw).toBe(false);
      expect(result.slowmode).toBe(0);
    });

    it('should accept full text channel config', () => {
      const result = ChannelSchema.parse({
        name: 'announcements',
        type: 'announcement',
        category: 'Info',
        topic: 'Server announcements',
        nsfw: false,
        slowmode: 60,
        position: 0,
        permissions: {
          '@everyone': { deny: ['SEND_MESSAGES'] },
        },
      });
      expect(result.topic).toBe('Server announcements');
      expect(result.slowmode).toBe(60);
    });

    it('should accept voice channel config', () => {
      const result = ChannelSchema.parse({
        name: 'voice-chat',
        type: 'voice',
        bitrate: 96000,
        userLimit: 10,
      });
      expect(result.bitrate).toBe(96000);
      expect(result.userLimit).toBe(10);
    });

    it('should reject invalid channel name format', () => {
      expect(() => ChannelSchema.parse({ name: 'Invalid Name' })).toThrow();
      expect(() => ChannelSchema.parse({ name: 'UPPERCASE' })).toThrow();
      expect(() => ChannelSchema.parse({ name: 'with spaces' })).toThrow();
    });

    it('should accept valid channel name formats', () => {
      expect(ChannelSchema.parse({ name: 'general' }).name).toBe('general');
      expect(ChannelSchema.parse({ name: 'voice-chat' }).name).toBe('voice-chat');
      expect(ChannelSchema.parse({ name: 'channel_name' }).name).toBe('channel_name');
      expect(ChannelSchema.parse({ name: 'channel123' }).name).toBe('channel123');
    });

    it('should reject slowmode out of range', () => {
      expect(() => ChannelSchema.parse({ name: 'test', slowmode: -1 })).toThrow();
      expect(() => ChannelSchema.parse({ name: 'test', slowmode: 21601 })).toThrow();
    });

    it('should reject bitrate out of range', () => {
      expect(() => ChannelSchema.parse({ name: 'test', bitrate: 7999 })).toThrow();
      expect(() => ChannelSchema.parse({ name: 'test', bitrate: 384001 })).toThrow();
    });

    it('should reject userLimit out of range', () => {
      expect(() => ChannelSchema.parse({ name: 'test', userLimit: -1 })).toThrow();
      expect(() => ChannelSchema.parse({ name: 'test', userLimit: 100 })).toThrow();
    });

    it('should reject topic over 1024 characters', () => {
      expect(() => ChannelSchema.parse({ name: 'test', topic: 'a'.repeat(1025) })).toThrow();
    });
  });

  // ==========================================================================
  // Server Config Schema
  // ==========================================================================

  describe('ServerConfigSchema', () => {
    it('should accept minimal config', () => {
      const result = ServerConfigSchema.parse({ version: '1' });
      expect(result.version).toBe('1');
      expect(result.roles).toEqual([]);
      expect(result.categories).toEqual([]);
      expect(result.channels).toEqual([]);
    });

    it('should accept full config', () => {
      const result = ServerConfigSchema.parse({
        version: '1',
        server: { name: 'My Server', description: 'A test server' },
        roles: [{ name: 'Admin' }],
        categories: [{ name: 'General' }],
        channels: [{ name: 'chat', category: 'General' }],
      });
      expect(result.server?.name).toBe('My Server');
      expect(result.roles).toHaveLength(1);
    });

    it('should reject invalid version', () => {
      expect(() => ServerConfigSchema.parse({ version: '2' })).toThrow();
    });

    it('should reject duplicate role names (case-insensitive)', () => {
      expect(() =>
        ServerConfigSchema.parse({
          version: '1',
          roles: [{ name: 'Admin' }, { name: 'admin' }],
        })
      ).toThrow(/[Dd]uplicate role name/);
    });

    it('should reject unknown category reference in channel', () => {
      expect(() =>
        ServerConfigSchema.parse({
          version: '1',
          channels: [{ name: 'test', category: 'NonExistent' }],
        })
      ).toThrow(/unknown category/i);
    });

    it('should reject unknown role reference in channel permissions', () => {
      expect(() =>
        ServerConfigSchema.parse({
          version: '1',
          channels: [
            {
              name: 'test',
              permissions: {
                NonExistentRole: { allow: ['VIEW_CHANNEL'] },
              },
            },
          ],
        })
      ).toThrow(/unknown role/i);
    });

    it('should allow @everyone in permissions without defining it', () => {
      const result = ServerConfigSchema.parse({
        version: '1',
        channels: [
          {
            name: 'test',
            permissions: {
              '@everyone': { deny: ['SEND_MESSAGES'] },
            },
          },
        ],
      });
      expect(result.channels[0].permissions!['@everyone']).toBeDefined();
    });
  });

  // ==========================================================================
  // Managed Resource Markers
  // ==========================================================================

  describe('Managed resource markers', () => {
    describe('MANAGED_MARKER', () => {
      it('should be the expected string', () => {
        expect(MANAGED_MARKER).toBe('[managed-by:arrakis-iac]');
      });
    });

    describe('isManaged', () => {
      it('should return true for managed description', () => {
        expect(isManaged('Some description [managed-by:arrakis-iac]')).toBe(true);
        expect(isManaged('[managed-by:arrakis-iac]')).toBe(true);
        expect(isManaged('prefix [managed-by:arrakis-iac] suffix')).toBe(true);
      });

      it('should return false for unmanaged description', () => {
        expect(isManaged('Regular description')).toBe(false);
        expect(isManaged('')).toBe(false);
        expect(isManaged(null)).toBe(false);
        expect(isManaged(undefined)).toBe(false);
      });
    });

    describe('addManagedMarker', () => {
      it('should add marker to empty string', () => {
        expect(addManagedMarker(undefined)).toBe('[managed-by:arrakis-iac]');
        expect(addManagedMarker('')).toBe('[managed-by:arrakis-iac]');
      });

      it('should append marker to existing description', () => {
        expect(addManagedMarker('My description')).toBe('My description [managed-by:arrakis-iac]');
      });

      it('should not duplicate marker', () => {
        const marked = addManagedMarker('Description');
        expect(addManagedMarker(marked)).toBe(marked);
      });
    });

    describe('removeManagedMarker', () => {
      it('should remove marker from description', () => {
        expect(removeManagedMarker('Description [managed-by:arrakis-iac]')).toBe('Description');
        expect(removeManagedMarker('[managed-by:arrakis-iac]')).toBe('');
      });

      it('should handle description without marker', () => {
        expect(removeManagedMarker('Regular description')).toBe('Regular description');
      });

      it('should handle undefined', () => {
        expect(removeManagedMarker(undefined)).toBe('');
      });
    });
  });
});

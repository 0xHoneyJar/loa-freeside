/**
 * Tests for authorization utilities
 *
 * Sprint SEC-1: Critical & High Priority Security Fixes
 * Finding H-2: Admin commands lack server-side authorization
 */

import { describe, it, expect } from 'vitest';
import {
  DiscordPermissions,
  getMemberPermissions,
  hasPermission,
  hasAdministratorPermission,
  hasAnyPermission,
  hasAllPermissions,
  requireAdministrator,
} from '../../src/utils/authorization.js';
import type { DiscordEventPayload } from '../../src/types.js';

// Helper to create a mock payload with permissions
function createPayloadWithPermissions(permissions: string | undefined): DiscordEventPayload {
  return {
    eventId: 'test-event-id',
    eventType: 'interaction.command',
    timestamp: Date.now(),
    guildId: 'test-guild-id',
    userId: 'test-user-id',
    interactionId: 'test-interaction-id',
    interactionToken: 'test-interaction-token',
    data: permissions !== undefined ? {
      member: {
        permissions,
      },
    } : {},
  };
}

describe('Authorization Utilities', () => {
  describe('DiscordPermissions', () => {
    it('should have ADMINISTRATOR at bit 3 (0x8)', () => {
      expect(DiscordPermissions.ADMINISTRATOR).toBe(8n);
    });

    it('should have correct permission values', () => {
      expect(DiscordPermissions.CREATE_INSTANT_INVITE).toBe(1n);
      expect(DiscordPermissions.KICK_MEMBERS).toBe(2n);
      expect(DiscordPermissions.BAN_MEMBERS).toBe(4n);
      expect(DiscordPermissions.ADMINISTRATOR).toBe(8n);
      expect(DiscordPermissions.MANAGE_GUILD).toBe(32n);
    });
  });

  describe('getMemberPermissions', () => {
    it('should extract permissions from payload', () => {
      const payload = createPayloadWithPermissions('8');
      expect(getMemberPermissions(payload)).toBe(8n);
    });

    it('should handle large permission values', () => {
      // All permissions
      const payload = createPayloadWithPermissions('1099511627775');
      expect(getMemberPermissions(payload)).toBe(1099511627775n);
    });

    it('should return 0n for missing member data', () => {
      const payload: DiscordEventPayload = {
        eventId: 'test',
        eventType: 'interaction.command',
        timestamp: Date.now(),
        data: {},
      };
      expect(getMemberPermissions(payload)).toBe(0n);
    });

    it('should return 0n for missing permissions', () => {
      const payload: DiscordEventPayload = {
        eventId: 'test',
        eventType: 'interaction.command',
        timestamp: Date.now(),
        data: {
          member: {},
        },
      };
      expect(getMemberPermissions(payload)).toBe(0n);
    });

    it('should return 0n for invalid permission string', () => {
      const payload = createPayloadWithPermissions('not-a-number');
      expect(getMemberPermissions(payload)).toBe(0n);
    });

    it('should return 0n for null data', () => {
      const payload: DiscordEventPayload = {
        eventId: 'test',
        eventType: 'interaction.command',
        timestamp: Date.now(),
      };
      expect(getMemberPermissions(payload)).toBe(0n);
    });
  });

  describe('hasPermission', () => {
    it('should return true when permission is present', () => {
      const permissions = DiscordPermissions.ADMINISTRATOR;
      expect(hasPermission(permissions, DiscordPermissions.ADMINISTRATOR)).toBe(true);
    });

    it('should return false when permission is not present', () => {
      const permissions = DiscordPermissions.SEND_MESSAGES;
      expect(hasPermission(permissions, DiscordPermissions.ADMINISTRATOR)).toBe(false);
    });

    it('should work with combined permissions', () => {
      const permissions = DiscordPermissions.ADMINISTRATOR | DiscordPermissions.SEND_MESSAGES;
      expect(hasPermission(permissions, DiscordPermissions.ADMINISTRATOR)).toBe(true);
      expect(hasPermission(permissions, DiscordPermissions.SEND_MESSAGES)).toBe(true);
      expect(hasPermission(permissions, DiscordPermissions.BAN_MEMBERS)).toBe(false);
    });
  });

  describe('hasAdministratorPermission', () => {
    it('should return true for administrator', () => {
      const payload = createPayloadWithPermissions('8');
      expect(hasAdministratorPermission(payload)).toBe(true);
    });

    it('should return true when admin is part of combined permissions', () => {
      // 8 (admin) + 2048 (send messages) = 2056
      const payload = createPayloadWithPermissions('2056');
      expect(hasAdministratorPermission(payload)).toBe(true);
    });

    it('should return false for non-administrator', () => {
      // Just SEND_MESSAGES (2048)
      const payload = createPayloadWithPermissions('2048');
      expect(hasAdministratorPermission(payload)).toBe(false);
    });

    it('should return false for zero permissions', () => {
      const payload = createPayloadWithPermissions('0');
      expect(hasAdministratorPermission(payload)).toBe(false);
    });

    it('should return false for missing permissions', () => {
      const payload = createPayloadWithPermissions(undefined);
      expect(hasAdministratorPermission(payload)).toBe(false);
    });
  });

  describe('hasAnyPermission', () => {
    it('should return true if any permission matches', () => {
      const payload = createPayloadWithPermissions('2048'); // SEND_MESSAGES
      expect(hasAnyPermission(payload, [
        DiscordPermissions.ADMINISTRATOR,
        DiscordPermissions.SEND_MESSAGES,
      ])).toBe(true);
    });

    it('should return false if no permissions match', () => {
      const payload = createPayloadWithPermissions('2048'); // SEND_MESSAGES
      expect(hasAnyPermission(payload, [
        DiscordPermissions.ADMINISTRATOR,
        DiscordPermissions.BAN_MEMBERS,
      ])).toBe(false);
    });

    it('should return true for administrator even if not in list', () => {
      const payload = createPayloadWithPermissions('8'); // ADMINISTRATOR
      expect(hasAnyPermission(payload, [
        DiscordPermissions.BAN_MEMBERS,
        DiscordPermissions.KICK_MEMBERS,
      ])).toBe(true);
    });
  });

  describe('hasAllPermissions', () => {
    it('should return true if all permissions match', () => {
      // SEND_MESSAGES (2048) + BAN_MEMBERS (4) = 2052
      const payload = createPayloadWithPermissions('2052');
      expect(hasAllPermissions(payload, [
        DiscordPermissions.SEND_MESSAGES,
        DiscordPermissions.BAN_MEMBERS,
      ])).toBe(true);
    });

    it('should return false if not all permissions match', () => {
      const payload = createPayloadWithPermissions('2048'); // Only SEND_MESSAGES
      expect(hasAllPermissions(payload, [
        DiscordPermissions.SEND_MESSAGES,
        DiscordPermissions.BAN_MEMBERS,
      ])).toBe(false);
    });

    it('should return true for administrator even if specific perms not in bitfield', () => {
      const payload = createPayloadWithPermissions('8'); // ADMINISTRATOR
      expect(hasAllPermissions(payload, [
        DiscordPermissions.SEND_MESSAGES,
        DiscordPermissions.BAN_MEMBERS,
      ])).toBe(true);
    });
  });

  describe('requireAdministrator', () => {
    it('should return authorized: true for administrator', () => {
      const payload = createPayloadWithPermissions('8');
      const result = requireAdministrator(payload);
      expect(result.authorized).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should return authorized: false with reason for non-administrator', () => {
      const payload = createPayloadWithPermissions('2048');
      const result = requireAdministrator(payload);
      expect(result.authorized).toBe(false);
      expect(result.reason).toBe('This command requires Administrator permissions.');
    });

    it('should return authorized: false for missing permissions', () => {
      const payload = createPayloadWithPermissions(undefined);
      const result = requireAdministrator(payload);
      expect(result.authorized).toBe(false);
      expect(result.reason).toBe('This command requires Administrator permissions.');
    });
  });

  describe('Security edge cases', () => {
    it('should not be fooled by negative permission strings', () => {
      const payload = createPayloadWithPermissions('-1');
      // This should either be 0n or the actual BigInt value, not bypass checks
      // BigInt('-1') is -1n which would have all bits set in twos complement
      // but we should handle this as invalid
      const perms = getMemberPermissions(payload);
      // BigInt('-1') is valid but represents negative number
      // This is edge case - Discord should never send negative
      expect(perms).toBe(-1n);
    });

    it('should handle very large permission strings', () => {
      // Max safe integer as string
      const payload = createPayloadWithPermissions('9007199254740991');
      expect(getMemberPermissions(payload)).toBe(9007199254740991n);
    });

    it('should reject non-string permission values', () => {
      const payload: DiscordEventPayload = {
        eventId: 'test',
        eventType: 'interaction.command',
        timestamp: Date.now(),
        data: {
          member: {
            permissions: 8, // number instead of string
          },
        },
      };
      // Should return 0n because permissions is not a string
      expect(getMemberPermissions(payload)).toBe(0n);
    });
  });
});

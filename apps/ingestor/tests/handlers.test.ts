import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Client, Guild, GuildMember, User, Interaction } from 'discord.js';
import { wireEventHandlers } from '../src/handlers.js';
import { PRIORITY } from '../src/types.js';

/**
 * Create a mock Discord.js Collection (extended Map with array methods)
 */
function createMockCollection<K, V>(entries: [K, V][]): Map<K, V> & { map: <T>(fn: (value: V, key: K) => T) => T[] } {
  const map = new Map(entries) as Map<K, V> & { map: <T>(fn: (value: V, key: K) => T) => T[] };
  map.map = function<T>(fn: (value: V, key: K) => T): T[] {
    const result: T[] = [];
    for (const [key, value] of this) {
      result.push(fn(value, key));
    }
    return result;
  };
  return map;
}

describe('Event Handlers', () => {
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    child: vi.fn(() => mockLogger),
  } as any;

  let mockPublisher: any;
  let mockClient: any;
  let eventHandlers: Map<string, Function>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockPublisher = {
      publish: vi.fn().mockResolvedValue(undefined),
    };

    eventHandlers = new Map();

    mockClient = {
      on: vi.fn((event: string, handler: Function) => {
        eventHandlers.set(event, handler);
      }),
      shard: { ids: [0] },
      isReady: vi.fn().mockReturnValue(true),
    };
  });

  describe('wireEventHandlers', () => {
    it('should register all event handlers', () => {
      wireEventHandlers(mockClient, mockPublisher, mockLogger);

      expect(eventHandlers.has('interactionCreate')).toBe(true);
      expect(eventHandlers.has('guildMemberAdd')).toBe(true);
      expect(eventHandlers.has('guildMemberRemove')).toBe(true);
      expect(eventHandlers.has('guildMemberUpdate')).toBe(true);
      expect(eventHandlers.has('guildCreate')).toBe(true);
      expect(eventHandlers.has('guildDelete')).toBe(true);
      expect(eventHandlers.has('messageCreate')).toBe(true);
    });
  });

  describe('interactionCreate handler', () => {
    it('should publish slash command interaction', async () => {
      wireEventHandlers(mockClient, mockPublisher, mockLogger);
      const handler = eventHandlers.get('interactionCreate')!;

      const mockInteraction = {
        guild: { id: '123456789' },
        user: { id: '987654321' },
        id: 'interaction-id',
        token: 'interaction-token',
        type: 2, // APPLICATION_COMMAND
        channelId: 'channel-id',
        isChatInputCommand: vi.fn().mockReturnValue(true),
        isButton: vi.fn().mockReturnValue(false),
        isModalSubmit: vi.fn().mockReturnValue(false),
        isAutocomplete: vi.fn().mockReturnValue(false),
        commandName: 'check-eligibility',
        options: { data: [] },
        memberPermissions: { toArray: () => ['SEND_MESSAGES'] },
        client: mockClient,
      };

      await handler(mockInteraction);

      expect(mockPublisher.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'interaction.command.check-eligibility',
          guildId: '123456789',
          userId: '987654321',
          interactionId: 'interaction-id',
          interactionToken: 'interaction-token',
        }),
        PRIORITY.COMMAND
      );
    });

    it('should publish button interaction', async () => {
      wireEventHandlers(mockClient, mockPublisher, mockLogger);
      const handler = eventHandlers.get('interactionCreate')!;

      const mockInteraction = {
        guild: { id: '123456789' },
        user: { id: '987654321' },
        id: 'interaction-id',
        token: 'interaction-token',
        type: 3, // MESSAGE_COMPONENT
        channelId: 'channel-id',
        isChatInputCommand: vi.fn().mockReturnValue(false),
        isButton: vi.fn().mockReturnValue(true),
        isModalSubmit: vi.fn().mockReturnValue(false),
        isAutocomplete: vi.fn().mockReturnValue(false),
        customId: 'verify-button',
        memberPermissions: { toArray: () => [] },
        client: mockClient,
      };

      await handler(mockInteraction);

      expect(mockPublisher.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'interaction.button',
          data: expect.objectContaining({
            customId: 'verify-button',
          }),
        }),
        PRIORITY.BUTTON
      );
    });

    it('should skip DM interactions', async () => {
      wireEventHandlers(mockClient, mockPublisher, mockLogger);
      const handler = eventHandlers.get('interactionCreate')!;

      const mockInteraction = {
        guild: null, // DM
        user: { id: '987654321' },
        client: mockClient,
      };

      await handler(mockInteraction);

      expect(mockPublisher.publish).not.toHaveBeenCalled();
    });
  });

  describe('guildMemberAdd handler', () => {
    it('should publish member join event', async () => {
      wireEventHandlers(mockClient, mockPublisher, mockLogger);
      const handler = eventHandlers.get('guildMemberAdd')!;

      const mockMember = {
        guild: { id: '123456789' },
        user: { id: '987654321', username: 'testuser' },
        displayName: 'Test User',
        joinedAt: new Date(),
        pending: false,
        roles: {
          cache: createMockCollection([['role-1', { id: 'role-1' }]]),
        },
        client: mockClient,
      };

      await handler(mockMember);

      expect(mockPublisher.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'member.join',
          guildId: '123456789',
          userId: '987654321',
          data: expect.objectContaining({
            userId: '987654321',
            username: 'testuser',
          }),
        }),
        PRIORITY.MEMBER_EVENT
      );
    });
  });

  describe('guildMemberRemove handler', () => {
    it('should publish member leave event', async () => {
      wireEventHandlers(mockClient, mockPublisher, mockLogger);
      const handler = eventHandlers.get('guildMemberRemove')!;

      const mockMember = {
        guild: { id: '123456789' },
        user: { id: '987654321', username: 'testuser' },
        client: mockClient,
      };

      await handler(mockMember);

      expect(mockPublisher.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'member.leave',
          guildId: '123456789',
          userId: '987654321',
        }),
        PRIORITY.MEMBER_EVENT
      );
    });
  });

  describe('guildMemberUpdate handler', () => {
    it('should publish member update for role changes', async () => {
      wireEventHandlers(mockClient, mockPublisher, mockLogger);
      const handler = eventHandlers.get('guildMemberUpdate')!;

      const oldMember = {
        guild: { id: '123456789' },
        nickname: 'OldNick',
        roles: {
          cache: createMockCollection([['role-1', { id: 'role-1' }]]),
        },
        client: mockClient,
      };

      const newMember = {
        guild: { id: '123456789' },
        user: { id: '987654321', username: 'testuser' },
        nickname: 'NewNick',
        roles: {
          cache: createMockCollection([
            ['role-1', { id: 'role-1' }],
            ['role-2', { id: 'role-2' }],
          ]),
        },
        client: mockClient,
      };

      await handler(oldMember, newMember);

      expect(mockPublisher.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'member.update',
          data: expect.objectContaining({
            addedRoles: ['role-2'],
            removedRoles: [],
          }),
        }),
        PRIORITY.MEMBER_EVENT
      );
    });

    it('should skip update with no role changes', async () => {
      wireEventHandlers(mockClient, mockPublisher, mockLogger);
      const handler = eventHandlers.get('guildMemberUpdate')!;

      const roles = createMockCollection([['role-1', { id: 'role-1' }]]);

      const oldMember = {
        guild: { id: '123456789' },
        roles: { cache: roles },
        client: mockClient,
      };

      const newMember = {
        guild: { id: '123456789' },
        user: { id: '987654321', username: 'testuser' },
        roles: { cache: roles },
        client: mockClient,
      };

      await handler(oldMember, newMember);

      expect(mockPublisher.publish).not.toHaveBeenCalled();
    });
  });

  describe('guildCreate handler', () => {
    it('should publish guild join event', async () => {
      wireEventHandlers(mockClient, mockPublisher, mockLogger);
      const handler = eventHandlers.get('guildCreate')!;

      const mockGuild = { id: '123456789' };

      await handler(mockGuild);

      expect(mockPublisher.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'guild.join',
          guildId: '123456789',
        }),
        PRIORITY.GUILD_EVENT
      );
    });
  });

  describe('guildDelete handler', () => {
    it('should publish guild leave event', async () => {
      wireEventHandlers(mockClient, mockPublisher, mockLogger);
      const handler = eventHandlers.get('guildDelete')!;

      const mockGuild = { id: '123456789' };

      await handler(mockGuild);

      expect(mockPublisher.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'guild.leave',
          guildId: '123456789',
        }),
        PRIORITY.GUILD_EVENT
      );
    });
  });

  describe('messageCreate handler', () => {
    it('should skip bot messages', async () => {
      wireEventHandlers(mockClient, mockPublisher, mockLogger);
      const handler = eventHandlers.get('messageCreate')!;

      const mockMessage = {
        author: { bot: true, id: '123' },
        guild: { id: '123456789' },
        client: mockClient,
      };

      await handler(mockMessage);

      expect(mockPublisher.publish).not.toHaveBeenCalled();
    });

    it('should skip DM messages', async () => {
      wireEventHandlers(mockClient, mockPublisher, mockLogger);
      const handler = eventHandlers.get('messageCreate')!;

      const mockMessage = {
        author: { bot: false, id: '123' },
        guild: null, // DM
        client: mockClient,
      };

      await handler(mockMessage);

      expect(mockPublisher.publish).not.toHaveBeenCalled();
    });

    it('should publish message metadata', async () => {
      wireEventHandlers(mockClient, mockPublisher, mockLogger);
      const handler = eventHandlers.get('messageCreate')!;

      const mockMessage = {
        author: { bot: false, id: '987654321' },
        guild: { id: '123456789' },
        channel: { id: 'channel-id' },
        id: 'message-id',
        content: 'Hello world',
        attachments: { size: 0 },
        embeds: [],
        mentions: { everyone: false },
        client: mockClient,
      };

      await handler(mockMessage);

      expect(mockPublisher.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'message.create',
          data: expect.objectContaining({
            hasContent: true,
            hasAttachments: false,
            hasEmbeds: false,
          }),
        }),
        PRIORITY.MESSAGE
      );
    });
  });
});

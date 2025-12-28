/**
 * Synthesis Worker Tests (v5.0 - Sprint 44)
 *
 * Unit tests for SynthesisWorker class covering:
 * - Worker initialization
 * - Job routing to correct handlers
 * - Role operations (create, update, delete)
 * - Channel operations (create, update, delete)
 * - Category operations (create, update, delete)
 * - Member operations (assign role, remove role)
 * - Progress tracking
 * - Error handling (retryable vs non-retryable)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SynthesisWorker, SynthesisError, ResourceNotFoundError, PermissionError } from '../../../../src/packages/synthesis/SynthesisWorker.js';
import type { SynthesisJobData, SynthesisJobResult } from '../../../../src/packages/synthesis/types.js';

// Mock Discord.js
const mockRole = {
  id: '11111111111111111',
  edit: vi.fn().mockResolvedValue({ id: '11111111111111111' }),
  delete: vi.fn().mockResolvedValue(undefined),
};

const mockChannel = {
  id: '22222222222222222',
  isTextBased: vi.fn().mockReturnValue(true),
  edit: vi.fn().mockResolvedValue({ id: '22222222222222222' }),
  delete: vi.fn().mockResolvedValue(undefined),
  send: vi.fn().mockResolvedValue({ id: '55555555555555555' }),
};

const mockMember = {
  roles: {
    add: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    highest: { position: 10 },
  },
  permissions: {
    has: vi.fn().mockReturnValue(true), // Bot has all permissions by default
    bitfield: 8n, // ADMINISTRATOR permission for testing
  },
};

const mockGuild = {
  id: '12345678901234567',
  roles: {
    create: vi.fn().mockResolvedValue(mockRole),
    fetch: vi.fn().mockResolvedValue({ ...mockRole, position: 5 }), // Role position lower than bot
  },
  channels: {
    create: vi.fn().mockResolvedValue(mockChannel),
    fetch: vi.fn().mockResolvedValue(mockChannel),
  },
  members: {
    fetch: vi.fn().mockResolvedValue(mockMember),
    fetchMe: vi.fn().mockResolvedValue(mockMember), // Security: HIGH-002 - Mock for permission checks
  },
};

const mockDiscordClient = {
  guilds: {
    fetch: vi.fn().mockResolvedValue(mockGuild),
  },
  channels: {
    fetch: vi.fn().mockResolvedValue(mockChannel),
  },
};

// Mock BullMQ Worker
vi.mock('bullmq', () => {
  const mockWorker = {
    on: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn().mockResolvedValue(undefined),
    resume: vi.fn().mockResolvedValue(undefined),
  };

  class MockWorker {
    constructor(queueName: string, processor: any, options: any) {
      (this as any).processor = processor;
      return mockWorker;
    }
  }

  return {
    Worker: MockWorker,
  };
});

// Mock ioredis
vi.mock('ioredis', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      status: 'ready',
    })),
  };
});

describe('SynthesisWorker', () => {
  let worker: SynthesisWorker;
  let mockJob: any;

  beforeEach(() => {
    vi.clearAllMocks();

    worker = new SynthesisWorker({
      queueName: 'test-queue',
      redis: {
        host: 'localhost',
        port: 6379,
      },
      discordClient: mockDiscordClient as any,
    });

    mockJob = {
      id: 'job-123',
      data: {},
      updateProgress: vi.fn().mockResolvedValue(undefined),
    };
  });

  afterEach(async () => {
    await worker.close();
  });

  // ---------------------------------------------------------------------------
  // Role Operation Tests
  // ---------------------------------------------------------------------------

  describe('Role Operations', () => {
    it('should create a role successfully', async () => {
      mockJob.data = {
        type: 'CREATE_ROLE',
        payload: {
          guildId: '12345678901234567',
          name: 'Test Role',
          color: 0xff0000,
          hoist: true,
          mentionable: false,
        },
        idempotencyKey: 'key-1',
      } as SynthesisJobData;

      const result = await worker['processJob'](mockJob);

      expect(result.success).toBe(true);
      expect(result.resourceId).toBe('11111111111111111');
      expect(mockGuild.roles.create).toHaveBeenCalledWith({
        name: 'Test Role',
        color: 0xff0000,
        hoist: true,
        mentionable: false,
        permissions: undefined,
        position: undefined,
        reason: 'Arrakis Synthesis',
      });
      expect(mockJob.updateProgress).toHaveBeenCalledTimes(2);
    });

    it('should update a role successfully', async () => {
      mockJob.data = {
        type: 'UPDATE_ROLE',
        payload: {
          guildId: '12345678901234567',
          roleId: '11111111111111111',
          name: 'Updated Role',
          color: 0x00ff00,
        },
        idempotencyKey: 'key-2',
      } as SynthesisJobData;

      const result = await worker['processJob'](mockJob);

      expect(result.success).toBe(true);
      expect(result.resourceId).toBe('11111111111111111');
      expect(mockRole.edit).toHaveBeenCalled();
    });

    it('should delete a role successfully', async () => {
      mockJob.data = {
        type: 'DELETE_ROLE',
        payload: {
          guildId: '12345678901234567',
          roleId: '11111111111111111',
          reason: 'Cleanup',
        },
        idempotencyKey: 'key-3',
      } as SynthesisJobData;

      const result = await worker['processJob'](mockJob);

      expect(result.success).toBe(true);
      expect(result.resourceId).toBe('11111111111111111');
      expect(mockRole.delete).toHaveBeenCalledWith('Cleanup');
    });

    it('should handle guild not found error', async () => {
      vi.mocked(mockDiscordClient.guilds.fetch).mockRejectedValueOnce(
        new Error('Unknown Guild')
      );

      mockJob.data = {
        type: 'CREATE_ROLE',
        payload: {
          guildId: 'invalid-guild',
          name: 'Test Role',
        },
        idempotencyKey: 'key-4',
      } as SynthesisJobData;

      const result = await worker['processJob'](mockJob);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should handle role not found error', async () => {
      vi.mocked(mockGuild.roles.fetch).mockResolvedValueOnce(null);

      mockJob.data = {
        type: 'UPDATE_ROLE',
        payload: {
          guildId: '12345678901234567',
          roleId: 'invalid-role',
          name: 'Updated Role',
        },
        idempotencyKey: 'key-5',
      } as SynthesisJobData;

      const result = await worker['processJob'](mockJob);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('RESOURCE_NOT_FOUND');
      expect(result.error?.retryable).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Channel Operation Tests
  // ---------------------------------------------------------------------------

  describe('Channel Operations', () => {
    it('should create a channel successfully', async () => {
      mockJob.data = {
        type: 'CREATE_CHANNEL',
        payload: {
          guildId: '12345678901234567',
          name: 'test-channel',
          type: 0,
          topic: 'Test topic',
        },
        idempotencyKey: 'key-6',
      } as SynthesisJobData;

      const result = await worker['processJob'](mockJob);

      expect(result.success).toBe(true);
      expect(result.resourceId).toBe('22222222222222222');
      expect(mockGuild.channels.create).toHaveBeenCalled();
    });

    it('should update a channel successfully', async () => {
      mockJob.data = {
        type: 'UPDATE_CHANNEL',
        payload: {
          guildId: '12345678901234567',
          channelId: '22222222222222222',
          name: 'updated-channel',
          topic: 'Updated topic',
        },
        idempotencyKey: 'key-7',
      } as SynthesisJobData;

      const result = await worker['processJob'](mockJob);

      expect(result.success).toBe(true);
      expect(result.resourceId).toBe('22222222222222222');
      expect(mockChannel.edit).toHaveBeenCalled();
    });

    it('should delete a channel successfully', async () => {
      mockJob.data = {
        type: 'DELETE_CHANNEL',
        payload: {
          guildId: '12345678901234567',
          channelId: '22222222222222222',
          reason: 'Cleanup',
        },
        idempotencyKey: 'key-8',
      } as SynthesisJobData;

      const result = await worker['processJob'](mockJob);

      expect(result.success).toBe(true);
      expect(result.resourceId).toBe('22222222222222222');
      expect(mockChannel.delete).toHaveBeenCalledWith('Cleanup');
    });

    it('should handle channel not found error', async () => {
      vi.mocked(mockGuild.channels.fetch).mockResolvedValueOnce(null);

      mockJob.data = {
        type: 'UPDATE_CHANNEL',
        payload: {
          guildId: '12345678901234567',
          channelId: 'invalid-channel',
          name: 'updated-channel',
        },
        idempotencyKey: 'key-9',
      } as SynthesisJobData;

      const result = await worker['processJob'](mockJob);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('RESOURCE_NOT_FOUND');
    });
  });

  // ---------------------------------------------------------------------------
  // Category Operation Tests
  // ---------------------------------------------------------------------------

  describe('Category Operations', () => {
    it('should create a category successfully', async () => {
      mockJob.data = {
        type: 'CREATE_CATEGORY',
        payload: {
          guildId: '12345678901234567',
          name: 'Test Category',
        },
        idempotencyKey: 'key-10',
      } as SynthesisJobData;

      const result = await worker['processJob'](mockJob);

      expect(result.success).toBe(true);
      expect(mockGuild.channels.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Test Category',
          type: 4, // Category type
        })
      );
    });

    it('should update a category successfully', async () => {
      mockJob.data = {
        type: 'UPDATE_CATEGORY',
        payload: {
          guildId: '12345678901234567',
          categoryId: '33333333333333333',
          name: 'Updated Category',
        },
        idempotencyKey: 'key-11',
      } as SynthesisJobData;

      const result = await worker['processJob'](mockJob);

      expect(result.success).toBe(true);
      expect(mockChannel.edit).toHaveBeenCalled();
    });

    it('should delete a category successfully', async () => {
      mockJob.data = {
        type: 'DELETE_CATEGORY',
        payload: {
          guildId: '12345678901234567',
          categoryId: '33333333333333333',
        },
        idempotencyKey: 'key-12',
      } as SynthesisJobData;

      const result = await worker['processJob'](mockJob);

      expect(result.success).toBe(true);
      expect(mockChannel.delete).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Member Operation Tests
  // ---------------------------------------------------------------------------

  describe('Member Operations', () => {
    it('should assign a role to a member', async () => {
      mockJob.data = {
        type: 'ASSIGN_ROLE',
        payload: {
          guildId: '12345678901234567',
          userId: 'user-456',
          roleId: 'role-789',
          reason: 'Tier promotion',
        },
        idempotencyKey: 'key-13',
      } as SynthesisJobData;

      const result = await worker['processJob'](mockJob);

      expect(result.success).toBe(true);
      expect(mockMember.roles.add).toHaveBeenCalledWith(
        'role-789',
        'Tier promotion'
      );
    });

    it('should remove a role from a member', async () => {
      mockJob.data = {
        type: 'REMOVE_ROLE',
        payload: {
          guildId: '12345678901234567',
          userId: 'user-456',
          roleId: 'role-789',
          reason: 'Tier demotion',
        },
        idempotencyKey: 'key-14',
      } as SynthesisJobData;

      const result = await worker['processJob'](mockJob);

      expect(result.success).toBe(true);
      expect(mockMember.roles.remove).toHaveBeenCalledWith(
        'role-789',
        'Tier demotion'
      );
    });

    it('should handle member not found error', async () => {
      vi.mocked(mockGuild.members.fetch).mockRejectedValueOnce(
        new Error('Unknown User')
      );

      mockJob.data = {
        type: 'ASSIGN_ROLE',
        payload: {
          guildId: '12345678901234567',
          userId: 'invalid-user',
          roleId: 'role-789',
        },
        idempotencyKey: 'key-15',
      } as SynthesisJobData;

      const result = await worker['processJob'](mockJob);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Message Operation Tests
  // ---------------------------------------------------------------------------

  describe('Message Operations', () => {
    it('should send a message successfully', async () => {
      mockJob.data = {
        type: 'SEND_MESSAGE',
        payload: {
          channelId: '22222222222222222',
          content: 'Hello, world!',
        },
        idempotencyKey: 'key-16',
      } as SynthesisJobData;

      const result = await worker['processJob'](mockJob);

      expect(result.success).toBe(true);
      expect(result.resourceId).toBe('55555555555555555');
      expect(mockChannel.send).toHaveBeenCalledWith({
        content: 'Hello, world!',
        embeds: undefined,
        components: undefined,
      });
    });

    it('should handle non-text channel error', async () => {
      vi.mocked(mockChannel.isTextBased).mockReturnValueOnce(false);

      mockJob.data = {
        type: 'SEND_MESSAGE',
        payload: {
          channelId: 'voice-channel-123',
          content: 'Hello!',
        },
        idempotencyKey: 'key-17',
      } as SynthesisJobData;

      const result = await worker['processJob'](mockJob);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('RESOURCE_NOT_FOUND');
    });
  });

  // ---------------------------------------------------------------------------
  // Community Synthesis Tests
  // ---------------------------------------------------------------------------

  describe('Community Synthesis', () => {
    it('should synthesize a full community', async () => {
      mockJob.data = {
        type: 'SYNTHESIZE_COMMUNITY',
        payload: {
          communityId: 'community-123',
          guildId: '12345678901234567',
          manifestId: 'manifest-123',
          categories: [{ guildId: '12345678901234567', name: 'Category 1' }],
          roles: [{ guildId: '12345678901234567', name: 'Role 1', color: 0xff0000 }],
          channels: [{ guildId: '12345678901234567', name: 'channel-1', type: 0 }],
        },
        idempotencyKey: 'key-18',
      } as SynthesisJobData;

      const result = await worker['processJob'](mockJob);

      expect(result.success).toBe(true);
      expect(result.resourceId).toBe('manifest-123');
      expect(result.metadata?.totalOperations).toBe(3);
      expect(mockGuild.channels.create).toHaveBeenCalledTimes(2); // category + channel
      expect(mockGuild.roles.create).toHaveBeenCalledTimes(1);
    });

    it('should track progress during community synthesis', async () => {
      mockJob.data = {
        type: 'SYNTHESIZE_COMMUNITY',
        payload: {
          communityId: 'community-123',
          guildId: '12345678901234567',
          manifestId: 'manifest-123',
          categories: [],
          roles: [
            { guildId: '12345678901234567', name: 'Role 1' },
            { guildId: '12345678901234567', name: 'Role 2' },
          ],
          channels: [],
        },
        idempotencyKey: 'key-19',
      } as SynthesisJobData;

      await worker['processJob'](mockJob);

      expect(mockJob.updateProgress).toHaveBeenCalledWith(
        expect.objectContaining({
          stage: 'creating_roles',
        })
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Error Handling Tests
  // ---------------------------------------------------------------------------

  describe('Error Handling', () => {
    it('should handle unknown job type', async () => {
      mockJob.data = {
        type: 'UNKNOWN_TYPE' as any,
        payload: {},
        idempotencyKey: 'key-20',
      } as SynthesisJobData;

      const result = await worker['processJob'](mockJob);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('UNKNOWN_JOB_TYPE');
      expect(result.error?.retryable).toBe(false);
    });

    it('should classify SynthesisError correctly', async () => {
      vi.mocked(mockGuild.roles.create).mockRejectedValueOnce(
        new SynthesisError('Test error', 'TEST_ERROR', true)
      );

      mockJob.data = {
        type: 'CREATE_ROLE',
        payload: {
          guildId: '12345678901234567',
          name: 'Test Role',
        },
        idempotencyKey: 'key-21',
      } as SynthesisJobData;

      const result = await worker['processJob'](mockJob);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('TEST_ERROR');
      expect(result.error?.retryable).toBe(true);
    });

    it('should classify ResourceNotFoundError as non-retryable', async () => {
      vi.mocked(mockGuild.roles.fetch).mockResolvedValueOnce(null);

      mockJob.data = {
        type: 'UPDATE_ROLE',
        payload: {
          guildId: '12345678901234567',
          roleId: 'invalid-role',
          name: 'Test',
        },
        idempotencyKey: 'key-22',
      } as SynthesisJobData;

      const result = await worker['processJob'](mockJob);

      expect(result.success).toBe(false);
      expect(result.error?.retryable).toBe(false);
    });

    it('should classify unknown errors as retryable', async () => {
      vi.mocked(mockGuild.roles.create).mockRejectedValueOnce(
        new Error('Unknown error')
      );

      mockJob.data = {
        type: 'CREATE_ROLE',
        payload: {
          guildId: '12345678901234567',
          name: 'Test Role',
        },
        idempotencyKey: 'key-23',
      } as SynthesisJobData;

      const result = await worker['processJob'](mockJob);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('UNKNOWN_ERROR');
      expect(result.error?.retryable).toBe(true);
    });

    it('should include duration in result', async () => {
      mockJob.data = {
        type: 'CREATE_ROLE',
        payload: {
          guildId: '12345678901234567',
          name: 'Test Role',
        },
        idempotencyKey: 'key-24',
      } as SynthesisJobData;

      const result = await worker['processJob'](mockJob);

      expect(result.duration).toBeGreaterThanOrEqual(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Lifecycle Tests
  // ---------------------------------------------------------------------------

  describe('Lifecycle', () => {
    it('should close worker', async () => {
      await worker.close();
      expect(worker['worker'].close).toHaveBeenCalled();
    });

    it('should pause worker', async () => {
      await worker.pause();
      expect(worker['worker'].pause).toHaveBeenCalled();
    });

    it('should resume worker', async () => {
      await worker.resume();
      expect(worker['worker'].resume).toHaveBeenCalled();
    });
  });
});

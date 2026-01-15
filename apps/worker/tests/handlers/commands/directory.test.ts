/**
 * Directory Handler Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Logger } from 'pino';
import type { DiscordEventPayload } from '../../../src/types.js';
import {
  createDirectoryHandler,
  createDirectoryButtonHandler,
  createDirectorySelectHandler,
} from '../../../src/handlers/commands/directory.js';
import { DIRECTORY_INTERACTIONS } from '../../../src/embeds/directory.js';

// Mock data module
vi.mock('../../../src/data/index.js', () => ({
  getCommunityByGuildId: vi.fn(),
  getProfileByDiscordId: vi.fn(),
  getDirectory: vi.fn(),
}));

// Import mocked functions
import {
  getCommunityByGuildId,
  getProfileByDiscordId,
  getDirectory,
} from '../../../src/data/index.js';

describe('createDirectoryHandler', () => {
  const mockDiscord = {
    deferReply: vi.fn(),
    editOriginal: vi.fn(),
  };

  const mockState = {
    setSession: vi.fn(),
    getSession: vi.fn(),
  };

  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => mockLogger),
  } as unknown as Logger;

  const basePayload: DiscordEventPayload = {
    type: 'interaction',
    timestamp: Date.now(),
    interactionId: 'interaction-123',
    interactionToken: 'token-abc',
    guildId: 'guild-456',
    userId: 'user-789',
    channelId: 'channel-101',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDiscord.deferReply.mockResolvedValue({ success: true });
    mockDiscord.editOriginal.mockResolvedValue({ success: true, messageId: 'msg-1' });
    mockState.setSession.mockResolvedValue(undefined);
  });

  it('should defer reply as ephemeral', async () => {
    const handler = createDirectoryHandler(mockDiscord as any, mockState as any);

    vi.mocked(getCommunityByGuildId).mockResolvedValue({ id: 'community-1', name: 'Test' } as any);
    vi.mocked(getProfileByDiscordId).mockResolvedValue({ id: 'profile-1', nym: 'TestUser' } as any);
    vi.mocked(getDirectory).mockResolvedValue({
      members: [],
      total: 0,
      page: 1,
      pageSize: 10,
      totalPages: 0,
    });

    await handler(basePayload, mockLogger);

    expect(mockDiscord.deferReply).toHaveBeenCalledWith(
      'interaction-123',
      'token-abc',
      true // ephemeral
    );
  });

  it('should return ack when missing interaction credentials', async () => {
    const handler = createDirectoryHandler(mockDiscord as any, mockState as any);

    const result = await handler({ ...basePayload, interactionId: undefined }, mockLogger);

    expect(result).toBe('ack');
    expect(mockDiscord.deferReply).not.toHaveBeenCalled();
  });

  it('should show error when community not found', async () => {
    const handler = createDirectoryHandler(mockDiscord as any, mockState as any);

    vi.mocked(getCommunityByGuildId).mockResolvedValue(null);

    await handler(basePayload, mockLogger);

    expect(mockDiscord.editOriginal).toHaveBeenCalledWith(
      'token-abc',
      expect.objectContaining({
        embeds: expect.arrayContaining([
          expect.objectContaining({
            description: expect.stringContaining('not configured'),
          }),
        ]),
      })
    );
  });

  it('should show error when user has no profile', async () => {
    const handler = createDirectoryHandler(mockDiscord as any, mockState as any);

    vi.mocked(getCommunityByGuildId).mockResolvedValue({ id: 'community-1', name: 'Test' } as any);
    vi.mocked(getProfileByDiscordId).mockResolvedValue(null);

    await handler(basePayload, mockLogger);

    expect(mockDiscord.editOriginal).toHaveBeenCalledWith(
      'token-abc',
      expect.objectContaining({
        embeds: expect.arrayContaining([
          expect.objectContaining({
            description: expect.stringContaining('onboarding'),
          }),
        ]),
      })
    );
  });

  it('should store session in Redis', async () => {
    const handler = createDirectoryHandler(mockDiscord as any, mockState as any);

    vi.mocked(getCommunityByGuildId).mockResolvedValue({ id: 'community-1', name: 'Test' } as any);
    vi.mocked(getProfileByDiscordId).mockResolvedValue({ id: 'profile-1', nym: 'TestUser' } as any);
    vi.mocked(getDirectory).mockResolvedValue({
      members: [],
      total: 0,
      page: 1,
      pageSize: 10,
      totalPages: 0,
    });

    await handler(basePayload, mockLogger);

    expect(mockState.setSession).toHaveBeenCalledWith(
      'directory',
      'user-789',
      expect.objectContaining({
        page: 1,
        pageSize: 10,
        sortBy: 'nym',
        sortDir: 'asc',
        communityId: 'community-1',
      }),
      300000 // 5 minutes
    );
  });

  it('should send directory embed with components', async () => {
    const handler = createDirectoryHandler(mockDiscord as any, mockState as any);

    vi.mocked(getCommunityByGuildId).mockResolvedValue({ id: 'community-1', name: 'Test' } as any);
    vi.mocked(getProfileByDiscordId).mockResolvedValue({ id: 'profile-1', nym: 'TestUser' } as any);
    vi.mocked(getDirectory).mockResolvedValue({
      members: [
        {
          profileId: 'p1',
          discordId: 'd1',
          nym: 'Member1',
          tier: 'fedaykin',
          tenureCategory: 'member',
          badgeCount: 5,
          joinedAt: new Date(),
        },
      ],
      total: 1,
      page: 1,
      pageSize: 10,
      totalPages: 1,
    });

    await handler(basePayload, mockLogger);

    expect(mockDiscord.editOriginal).toHaveBeenCalledWith(
      'token-abc',
      expect.objectContaining({
        embeds: expect.any(Array),
        components: expect.any(Array),
      })
    );
  });

  it('should return ack on success', async () => {
    const handler = createDirectoryHandler(mockDiscord as any, mockState as any);

    vi.mocked(getCommunityByGuildId).mockResolvedValue({ id: 'community-1', name: 'Test' } as any);
    vi.mocked(getProfileByDiscordId).mockResolvedValue({ id: 'profile-1', nym: 'TestUser' } as any);
    vi.mocked(getDirectory).mockResolvedValue({
      members: [],
      total: 0,
      page: 1,
      pageSize: 10,
      totalPages: 0,
    });

    const result = await handler(basePayload, mockLogger);

    expect(result).toBe('ack');
  });
});

describe('createDirectoryButtonHandler', () => {
  const mockDiscord = {
    updateMessage: vi.fn(),
  };

  const mockState = {
    setSession: vi.fn(),
    getSession: vi.fn(),
  };

  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => mockLogger),
  } as unknown as Logger;

  const basePayload: DiscordEventPayload = {
    type: 'interaction',
    timestamp: Date.now(),
    interactionId: 'interaction-123',
    interactionToken: 'token-abc',
    guildId: 'guild-456',
    userId: 'user-789',
    channelId: 'channel-101',
    customId: DIRECTORY_INTERACTIONS.nextPage,
  };

  const mockSession = {
    data: {
      communityId: 'community-1',
      page: 1,
      pageSize: 10,
      sortBy: 'nym',
      sortDir: 'asc',
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDiscord.updateMessage.mockResolvedValue({ success: true });
    mockState.setSession.mockResolvedValue(undefined);
    mockState.getSession.mockResolvedValue(mockSession);
  });

  it('should return ack for non-directory buttons', async () => {
    const handler = createDirectoryButtonHandler(mockDiscord as any, mockState as any);

    const result = await handler({ ...basePayload, customId: 'other_button' }, mockLogger);

    expect(result).toBe('ack');
    expect(mockState.getSession).not.toHaveBeenCalled();
  });

  it('should show error when session expired', async () => {
    const handler = createDirectoryButtonHandler(mockDiscord as any, mockState as any);

    mockState.getSession.mockResolvedValue(null);

    await handler(basePayload, mockLogger);

    expect(mockDiscord.updateMessage).toHaveBeenCalledWith(
      'interaction-123',
      'token-abc',
      expect.objectContaining({
        embeds: expect.arrayContaining([
          expect.objectContaining({
            description: expect.stringContaining('Session expired'),
          }),
        ]),
        components: [],
      })
    );
  });

  it('should increment page on next button', async () => {
    const handler = createDirectoryButtonHandler(mockDiscord as any, mockState as any);

    vi.mocked(getDirectory).mockResolvedValue({
      members: [],
      total: 50,
      page: 2,
      pageSize: 10,
      totalPages: 5,
    });

    await handler({ ...basePayload, customId: DIRECTORY_INTERACTIONS.nextPage }, mockLogger);

    expect(mockState.setSession).toHaveBeenCalledWith(
      'directory',
      'user-789',
      expect.objectContaining({
        page: 2,
      }),
      300000
    );
  });

  it('should decrement page on prev button', async () => {
    const handler = createDirectoryButtonHandler(mockDiscord as any, mockState as any);

    mockState.getSession.mockResolvedValue({
      data: { ...mockSession.data, page: 3 },
    });

    vi.mocked(getDirectory).mockResolvedValue({
      members: [],
      total: 50,
      page: 2,
      pageSize: 10,
      totalPages: 5,
    });

    await handler({ ...basePayload, customId: DIRECTORY_INTERACTIONS.prevPage }, mockLogger);

    expect(mockState.setSession).toHaveBeenCalledWith(
      'directory',
      'user-789',
      expect.objectContaining({
        page: 2,
      }),
      300000
    );
  });

  it('should not go below page 1', async () => {
    const handler = createDirectoryButtonHandler(mockDiscord as any, mockState as any);

    vi.mocked(getDirectory).mockResolvedValue({
      members: [],
      total: 50,
      page: 1,
      pageSize: 10,
      totalPages: 5,
    });

    await handler({ ...basePayload, customId: DIRECTORY_INTERACTIONS.prevPage }, mockLogger);

    expect(mockState.setSession).toHaveBeenCalledWith(
      'directory',
      'user-789',
      expect.objectContaining({
        page: 1,
      }),
      300000
    );
  });

  it('should keep same page on refresh', async () => {
    const handler = createDirectoryButtonHandler(mockDiscord as any, mockState as any);

    vi.mocked(getDirectory).mockResolvedValue({
      members: [],
      total: 50,
      page: 1,
      pageSize: 10,
      totalPages: 5,
    });

    await handler({ ...basePayload, customId: DIRECTORY_INTERACTIONS.refresh }, mockLogger);

    expect(mockState.setSession).toHaveBeenCalledWith(
      'directory',
      'user-789',
      expect.objectContaining({
        page: 1,
      }),
      300000
    );
  });

  it('should clamp page if past end', async () => {
    const handler = createDirectoryButtonHandler(mockDiscord as any, mockState as any);

    mockState.getSession.mockResolvedValue({
      data: { ...mockSession.data, page: 10 },
    });

    // First call returns high page, second returns clamped
    vi.mocked(getDirectory)
      .mockResolvedValueOnce({
        members: [],
        total: 30,
        page: 11,
        pageSize: 10,
        totalPages: 3,
      })
      .mockResolvedValueOnce({
        members: [],
        total: 30,
        page: 3,
        pageSize: 10,
        totalPages: 3,
      });

    await handler({ ...basePayload, customId: DIRECTORY_INTERACTIONS.nextPage }, mockLogger);

    // Should have called setSession twice (once for next, once for clamp)
    expect(mockState.setSession).toHaveBeenCalledTimes(2);
  });

  it('should update message with new embed', async () => {
    const handler = createDirectoryButtonHandler(mockDiscord as any, mockState as any);

    vi.mocked(getDirectory).mockResolvedValue({
      members: [
        {
          profileId: 'p1',
          discordId: 'd1',
          nym: 'Member1',
          tier: 'fedaykin',
          tenureCategory: 'member',
          badgeCount: 5,
          joinedAt: new Date(),
        },
      ],
      total: 1,
      page: 1,
      pageSize: 10,
      totalPages: 1,
    });

    await handler(basePayload, mockLogger);

    expect(mockDiscord.updateMessage).toHaveBeenCalledWith(
      'interaction-123',
      'token-abc',
      expect.objectContaining({
        embeds: expect.any(Array),
        components: expect.any(Array),
      })
    );
  });
});

describe('createDirectorySelectHandler', () => {
  const mockDiscord = {
    updateMessage: vi.fn(),
  };

  const mockState = {
    setSession: vi.fn(),
    getSession: vi.fn(),
  };

  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => mockLogger),
  } as unknown as Logger;

  const basePayload: DiscordEventPayload = {
    type: 'interaction',
    timestamp: Date.now(),
    interactionId: 'interaction-123',
    interactionToken: 'token-abc',
    guildId: 'guild-456',
    userId: 'user-789',
    channelId: 'channel-101',
    customId: DIRECTORY_INTERACTIONS.tierFilter,
    selectedValues: ['naib'],
  };

  const mockSession = {
    data: {
      communityId: 'community-1',
      page: 3,
      pageSize: 10,
      sortBy: 'nym',
      sortDir: 'asc',
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDiscord.updateMessage.mockResolvedValue({ success: true });
    mockState.setSession.mockResolvedValue(undefined);
    mockState.getSession.mockResolvedValue(mockSession);
  });

  it('should return ack for non-directory selects', async () => {
    const handler = createDirectorySelectHandler(mockDiscord as any, mockState as any);

    const result = await handler({ ...basePayload, customId: 'other_select' }, mockLogger);

    expect(result).toBe('ack');
    expect(mockState.getSession).not.toHaveBeenCalled();
  });

  it('should show error when session expired', async () => {
    const handler = createDirectorySelectHandler(mockDiscord as any, mockState as any);

    mockState.getSession.mockResolvedValue(null);

    await handler(basePayload, mockLogger);

    expect(mockDiscord.updateMessage).toHaveBeenCalledWith(
      'interaction-123',
      'token-abc',
      expect.objectContaining({
        embeds: expect.arrayContaining([
          expect.objectContaining({
            description: expect.stringContaining('Session expired'),
          }),
        ]),
        components: [],
      })
    );
  });

  it('should reset to page 1 on filter change', async () => {
    const handler = createDirectorySelectHandler(mockDiscord as any, mockState as any);

    vi.mocked(getDirectory).mockResolvedValue({
      members: [],
      total: 10,
      page: 1,
      pageSize: 10,
      totalPages: 1,
    });

    await handler(basePayload, mockLogger);

    expect(mockState.setSession).toHaveBeenCalledWith(
      'directory',
      'user-789',
      expect.objectContaining({
        page: 1, // Reset from page 3
      }),
      300000
    );
  });

  it('should set tier filter to naib', async () => {
    const handler = createDirectorySelectHandler(mockDiscord as any, mockState as any);

    vi.mocked(getDirectory).mockResolvedValue({
      members: [],
      total: 7,
      page: 1,
      pageSize: 10,
      totalPages: 1,
    });

    await handler(
      {
        ...basePayload,
        customId: DIRECTORY_INTERACTIONS.tierFilter,
        selectedValues: ['naib'],
      },
      mockLogger
    );

    expect(mockState.setSession).toHaveBeenCalledWith(
      'directory',
      'user-789',
      expect.objectContaining({
        tier: 'naib',
      }),
      300000
    );
  });

  it('should set tier filter to fedaykin', async () => {
    const handler = createDirectorySelectHandler(mockDiscord as any, mockState as any);

    vi.mocked(getDirectory).mockResolvedValue({
      members: [],
      total: 100,
      page: 1,
      pageSize: 10,
      totalPages: 10,
    });

    await handler(
      {
        ...basePayload,
        customId: DIRECTORY_INTERACTIONS.tierFilter,
        selectedValues: ['fedaykin'],
      },
      mockLogger
    );

    expect(mockState.setSession).toHaveBeenCalledWith(
      'directory',
      'user-789',
      expect.objectContaining({
        tier: 'fedaykin',
      }),
      300000
    );
  });

  it('should clear tier filter on all', async () => {
    const handler = createDirectorySelectHandler(mockDiscord as any, mockState as any);

    mockState.getSession.mockResolvedValue({
      data: { ...mockSession.data, tier: 'naib' },
    });

    vi.mocked(getDirectory).mockResolvedValue({
      members: [],
      total: 100,
      page: 1,
      pageSize: 10,
      totalPages: 10,
    });

    await handler(
      {
        ...basePayload,
        customId: DIRECTORY_INTERACTIONS.tierFilter,
        selectedValues: ['all'],
      },
      mockLogger
    );

    expect(mockState.setSession).toHaveBeenCalledWith(
      'directory',
      'user-789',
      expect.not.objectContaining({
        tier: expect.anything(),
      }),
      300000
    );
  });

  it('should change sort to tenure with desc direction', async () => {
    const handler = createDirectorySelectHandler(mockDiscord as any, mockState as any);

    vi.mocked(getDirectory).mockResolvedValue({
      members: [],
      total: 100,
      page: 1,
      pageSize: 10,
      totalPages: 10,
    });

    await handler(
      {
        ...basePayload,
        customId: DIRECTORY_INTERACTIONS.sortBy,
        selectedValues: ['tenure'],
      },
      mockLogger
    );

    expect(mockState.setSession).toHaveBeenCalledWith(
      'directory',
      'user-789',
      expect.objectContaining({
        sortBy: 'tenure',
        sortDir: 'desc',
      }),
      300000
    );
  });

  it('should change sort to nym with asc direction', async () => {
    const handler = createDirectorySelectHandler(mockDiscord as any, mockState as any);

    mockState.getSession.mockResolvedValue({
      data: { ...mockSession.data, sortBy: 'badgeCount', sortDir: 'desc' },
    });

    vi.mocked(getDirectory).mockResolvedValue({
      members: [],
      total: 100,
      page: 1,
      pageSize: 10,
      totalPages: 10,
    });

    await handler(
      {
        ...basePayload,
        customId: DIRECTORY_INTERACTIONS.sortBy,
        selectedValues: ['nym'],
      },
      mockLogger
    );

    expect(mockState.setSession).toHaveBeenCalledWith(
      'directory',
      'user-789',
      expect.objectContaining({
        sortBy: 'nym',
        sortDir: 'asc',
      }),
      300000
    );
  });

  it('should update message with filtered results', async () => {
    const handler = createDirectorySelectHandler(mockDiscord as any, mockState as any);

    vi.mocked(getDirectory).mockResolvedValue({
      members: [
        {
          profileId: 'p1',
          discordId: 'd1',
          nym: 'NaibMember',
          tier: 'naib',
          tenureCategory: 'og',
          badgeCount: 20,
          joinedAt: new Date(),
        },
      ],
      total: 7,
      page: 1,
      pageSize: 10,
      totalPages: 1,
    });

    await handler(basePayload, mockLogger);

    expect(mockDiscord.updateMessage).toHaveBeenCalledWith(
      'interaction-123',
      'token-abc',
      expect.objectContaining({
        embeds: expect.any(Array),
        components: expect.any(Array),
      })
    );
  });
});

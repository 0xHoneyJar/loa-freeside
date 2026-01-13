/**
 * Story Fragments Integration Tests
 *
 * Tests story fragment system for elite member joins:
 * - Fragment selection with usage balancing
 * - Fragment posting to #the-door
 * - Usage count tracking
 * - Category-based selection (Fedaykin vs Naib)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock config
vi.mock('../../src/config.js', () => ({
  config: {
    discord: {
      channels: { theDoor: 'channel-the-door' },
      guildId: 'guild',
      botToken: 'token',
    },
  },
}));

// Mock logger
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock database queries
const mockGetStoryFragments = vi.fn();
const mockIncrementFragmentUsage = vi.fn();
const mockGetFragmentStats = vi.fn();

vi.mock('../../src/db/index.js', () => ({
  getDatabase: vi.fn(() => ({
    prepare: vi.fn(() => ({
      all: vi.fn(),
      get: vi.fn(),
      run: vi.fn(),
    })),
  })),
  getStoryFragments: mockGetStoryFragments,
  incrementFragmentUsage: mockIncrementFragmentUsage,
  getFragmentStats: mockGetFragmentStats,
  logAuditEvent: vi.fn(),
}));

// Import after mocks
const { storyService } = await import('../../src/services/StoryService.js');

describe('Story Fragments Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Fragment Selection', () => {
    it('should select least-used Fedaykin fragment', async () => {
      const mockFragments = [
        {
          id: 'frag-1',
          category: 'fedaykin_join',
          content: 'The desert wind carried whispers...',
          used_count: 0,
        },
        {
          id: 'frag-2',
          category: 'fedaykin_join',
          content: 'Footsteps in the sand revealed...',
          used_count: 2,
        },
        {
          id: 'frag-3',
          category: 'fedaykin_join',
          content: 'The winds shifted...',
          used_count: 1,
        },
      ];

      mockGetStoryFragments.mockResolvedValue(mockFragments);

      const fragment = await storyService.getFragment('fedaykin_join');

      expect(fragment).toBeDefined();
      expect(fragment.id).toBe('frag-1'); // Lowest usage count (0)
      expect(fragment.category).toBe('fedaykin_join');
    });

    it('should select least-used Naib fragment', async () => {
      const mockFragments = [
        {
          id: 'naib-1',
          category: 'naib_join',
          content: 'The council chamber stirred...',
          used_count: 3,
        },
        {
          id: 'naib-2',
          category: 'naib_join',
          content: 'The sands trembled...',
          used_count: 1,
        },
        {
          id: 'naib-3',
          category: 'naib_join',
          content: 'Ancient traditions speak...',
          used_count: 5,
        },
      ];

      mockGetStoryFragments.mockResolvedValue(mockFragments);

      const fragment = await storyService.getFragment('naib_join');

      expect(fragment).toBeDefined();
      expect(fragment.id).toBe('naib-2'); // Lowest usage count (1)
      expect(fragment.category).toBe('naib_join');
    });

    it('should handle empty fragment table gracefully', async () => {
      mockGetStoryFragments.mockResolvedValue([]);

      const fragment = await storyService.getFragment('fedaykin_join');

      expect(fragment).toBeNull();
    });

    it('should balance usage across multiple fragments', async () => {
      // All fragments have same usage count - should rotate randomly
      const mockFragments = [
        {
          id: 'frag-1',
          category: 'fedaykin_join',
          content: 'Fragment 1',
          used_count: 5,
        },
        {
          id: 'frag-2',
          category: 'fedaykin_join',
          content: 'Fragment 2',
          used_count: 5,
        },
        {
          id: 'frag-3',
          category: 'fedaykin_join',
          content: 'Fragment 3',
          used_count: 5,
        },
      ];

      mockGetStoryFragments.mockResolvedValue(mockFragments);

      const fragment = await storyService.getFragment('fedaykin_join');

      expect(fragment).toBeDefined();
      expect(fragment.used_count).toBe(5);
      expect(['frag-1', 'frag-2', 'frag-3']).toContain(fragment.id);
    });
  });

  describe('Usage Count Tracking', () => {
    it('should increment usage count after selecting fragment', async () => {
      const mockFragment = {
        id: 'frag-track',
        category: 'fedaykin_join',
        content: 'Test fragment',
        used_count: 2,
      };

      mockGetStoryFragments.mockResolvedValue([mockFragment]);

      const fragment = await storyService.getFragment('fedaykin_join');

      expect(mockIncrementFragmentUsage).toHaveBeenCalledWith('frag-track');
    });

    it('should track usage stats correctly', async () => {
      const mockStats = [
        { category: 'fedaykin_join', total_count: 5, total_uses: 25, avg_uses: 5 },
        { category: 'naib_join', total_count: 3, total_uses: 12, avg_uses: 4 },
      ];

      mockGetFragmentStats.mockResolvedValue(mockStats);

      const stats = await storyService.getFragmentStats();

      expect(stats).toHaveLength(2);
      expect(stats[0].category).toBe('fedaykin_join');
      expect(stats[0].total_uses).toBe(25);
      expect(stats[1].category).toBe('naib_join');
      expect(stats[1].total_uses).toBe(12);
    });
  });

  describe('Fragment Posting', () => {
    it('should post Fedaykin fragment to #the-door', async () => {
      const mockFragment = {
        id: 'frag-post',
        category: 'fedaykin_join',
        content: 'A new warrior joins the ranks...',
        used_count: 0,
      };

      const mockChannel = {
        id: 'channel-the-door',
        isTextBased: () => true,
        send: vi.fn().mockResolvedValue({
          id: 'msg-123',
        }),
      };

      const mockClient = {
        channels: {
          fetch: vi.fn().mockResolvedValue(mockChannel),
        },
      };

      mockGetStoryFragments.mockResolvedValue([mockFragment]);

      const result = await storyService.postJoinFragment(mockClient as any, 'fedaykin');

      expect(result).toBe(true);
      expect(mockChannel.send).toHaveBeenCalled();

      // Check that message includes decorative borders
      const sentContent = mockChannel.send.mock.calls[0][0];
      expect(sentContent).toContain('━'); // Border character
      expect(sentContent).toContain('A new warrior joins the ranks...');
    });

    it('should post Naib fragment to #the-door', async () => {
      const mockFragment = {
        id: 'naib-post',
        category: 'naib_join',
        content: 'The council welcomes a new leader...',
        used_count: 0,
      };

      const mockChannel = {
        id: 'channel-the-door',
        isTextBased: () => true,
        send: vi.fn().mockResolvedValue({
          id: 'msg-456',
        }),
      };

      const mockClient = {
        channels: {
          fetch: vi.fn().mockResolvedValue(mockChannel),
        },
      };

      mockGetStoryFragments.mockResolvedValue([mockFragment]);

      const result = await storyService.postJoinFragment(mockClient as any, 'naib');

      expect(result).toBe(true);
      expect(mockChannel.send).toHaveBeenCalled();

      const sentContent = mockChannel.send.mock.calls[0][0];
      expect(sentContent).toContain('The council welcomes a new leader...');
    });

    it('should handle missing channel gracefully', async () => {
      const mockClient = {
        channels: {
          fetch: vi.fn().mockResolvedValue(null),
        },
      };

      mockGetStoryFragments.mockResolvedValue([
        {
          id: 'frag',
          category: 'fedaykin_join',
          content: 'Test',
          used_count: 0,
        },
      ]);

      const result = await storyService.postJoinFragment(mockClient as any, 'fedaykin');

      expect(result).toBe(false);
    });

    it('should handle posting error gracefully', async () => {
      const mockChannel = {
        id: 'channel-the-door',
        isTextBased: () => true,
        send: vi.fn().mockRejectedValue(new Error('Discord API error')),
      };

      const mockClient = {
        channels: {
          fetch: vi.fn().mockResolvedValue(mockChannel),
        },
      };

      mockGetStoryFragments.mockResolvedValue([
        {
          id: 'frag',
          category: 'fedaykin_join',
          content: 'Test',
          used_count: 0,
        },
      ]);

      const result = await storyService.postJoinFragment(mockClient as any, 'fedaykin');

      expect(result).toBe(false);
    });
  });

  describe('Fragment Formatting', () => {
    it('should format fragment with decorative borders', async () => {
      const mockFragment = {
        id: 'frag-format',
        category: 'fedaykin_join',
        content: 'Test fragment content with multiple lines\nSecond line here',
        used_count: 0,
      };

      const mockChannel = {
        id: 'channel-the-door',
        isTextBased: () => true,
        send: vi.fn().mockResolvedValue({ id: 'msg' }),
      };

      const mockClient = {
        channels: {
          fetch: vi.fn().mockResolvedValue(mockChannel),
        },
      };

      mockGetStoryFragments.mockResolvedValue([mockFragment]);

      await storyService.postJoinFragment(mockClient as any, 'fedaykin');

      const sentContent = mockChannel.send.mock.calls[0][0];

      // Should have top border
      expect(sentContent).toMatch(/━+/);

      // Should contain fragment content
      expect(sentContent).toContain('Test fragment content with multiple lines');
      expect(sentContent).toContain('Second line here');

      // Should have bottom border
      expect(sentContent.split('\n').length).toBeGreaterThan(2);
    });

    it('should not post for non-elite tiers', async () => {
      const mockClient = {
        channels: {
          fetch: vi.fn(),
        },
      };

      const result = await storyService.postJoinFragment(mockClient as any, 'hajra');

      expect(result).toBe(false);
      expect(mockClient.channels.fetch).not.toHaveBeenCalled();
    });
  });

  describe('Category Filtering', () => {
    it('should only return fragments matching category', async () => {
      const mockFragments = [
        {
          id: 'fed-1',
          category: 'fedaykin_join',
          content: 'Fedaykin fragment',
          used_count: 0,
        },
      ];

      mockGetStoryFragments.mockResolvedValue(mockFragments);

      const fragment = await storyService.getFragment('fedaykin_join');

      expect(fragment).toBeDefined();
      expect(fragment.category).toBe('fedaykin_join');

      // Verify query was called with correct category
      expect(mockGetStoryFragments).toHaveBeenCalledWith('fedaykin_join');
    });
  });

  describe('Edge Cases', () => {
    it('should handle invalid tier gracefully', async () => {
      const mockClient = {
        channels: {
          fetch: vi.fn(),
        },
      };

      const result = await storyService.postJoinFragment(mockClient as any, 'invalid' as any);

      expect(result).toBe(false);
    });

    it('should handle database error during fragment retrieval', async () => {
      mockGetStoryFragments.mockRejectedValue(new Error('Database error'));

      await expect(
        storyService.getFragment('fedaykin_join')
      ).rejects.toThrow('Database error');
    });

    it('should handle concurrent fragment requests', async () => {
      // Multiple simultaneous requests should each get different fragments
      const mockFragments = [
        { id: 'frag-1', category: 'fedaykin_join', content: 'A', used_count: 0 },
        { id: 'frag-2', category: 'fedaykin_join', content: 'B', used_count: 0 },
        { id: 'frag-3', category: 'fedaykin_join', content: 'C', used_count: 0 },
      ];

      mockGetStoryFragments.mockResolvedValue(mockFragments);

      const results = await Promise.all([
        storyService.getFragment('fedaykin_join'),
        storyService.getFragment('fedaykin_join'),
        storyService.getFragment('fedaykin_join'),
      ]);

      expect(results).toHaveLength(3);
      expect(results[0]).toBeDefined();
      expect(results[1]).toBeDefined();
      expect(results[2]).toBeDefined();
    });
  });
});

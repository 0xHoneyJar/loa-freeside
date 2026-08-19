/**
 * Story Fragments Integration Tests
 *
 * Tests story fragment system for elite member joins:
 * - Fragment selection with usage balancing
 * - Fragment posting to #the-door
 * - Usage count tracking
 * - Category-based selection (Fedaykin vs Naib)
 *
 * Runs against the CURRENT StoryService API: synchronous, direct sqlite
 * queries via getDatabase(). Uses a real in-memory better-sqlite3 database
 * instead of mocking individual query helpers (which no longer exist).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';

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

// getDatabase() returns a real in-memory sqlite database per test
let db: Database.Database;

vi.mock('../../src/db/index.js', () => ({
  getDatabase: vi.fn(() => db),
  logAuditEvent: vi.fn(),
}));

// Import after mocks
const { storyService } = await import('../../src/services/StoryService.js');

function seedFragments(rows: Array<{ id: string; category: string; content: string; used_count: number }>) {
  const insert = db.prepare(
    'INSERT INTO story_fragments (id, category, content, used_count) VALUES (?, ?, ?, ?)'
  );
  for (const r of rows) insert.run(r.id, r.category, r.content, r.used_count);
}

function makeTextChannel() {
  return {
    isTextBased: () => true,
    send: vi.fn(async () => ({})),
  };
}

describe('Story Fragments Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE story_fragments (
        id TEXT PRIMARY KEY,
        category TEXT NOT NULL,
        content TEXT NOT NULL,
        used_count INTEGER NOT NULL DEFAULT 0
      )
    `);
  });

  afterEach(() => {
    db.close();
  });

  describe('Fragment Selection', () => {
    it('should select least-used Fedaykin fragment', () => {
      seedFragments([
        { id: 'frag-1', category: 'fedaykin_join', content: 'The desert wind carried whispers...', used_count: 0 },
        { id: 'frag-2', category: 'fedaykin_join', content: 'Footsteps in the sand revealed...', used_count: 2 },
        { id: 'frag-3', category: 'fedaykin_join', content: 'The winds shifted...', used_count: 1 },
      ]);

      const fragment = storyService.getFragment('fedaykin_join');

      expect(fragment).toBeDefined();
      expect(fragment!.id).toBe('frag-1'); // Lowest usage count (0)
      expect(fragment!.category).toBe('fedaykin_join');
    });

    it('should select least-used Naib fragment', () => {
      seedFragments([
        { id: 'naib-1', category: 'naib_join', content: 'The council chamber stirred...', used_count: 3 },
        { id: 'naib-2', category: 'naib_join', content: 'The sands trembled...', used_count: 1 },
        { id: 'naib-3', category: 'naib_join', content: 'Ancient traditions speak...', used_count: 5 },
      ]);

      const fragment = storyService.getFragment('naib_join');

      expect(fragment).toBeDefined();
      expect(fragment!.id).toBe('naib-2'); // Lowest usage count (1)
      expect(fragment!.category).toBe('naib_join');
    });

    it('should handle empty fragment table gracefully', () => {
      const fragment = storyService.getFragment('fedaykin_join');
      expect(fragment).toBeNull();
    });

    it('should balance usage across multiple fragments', () => {
      // All fragments have the same usage count — ties break randomly, and
      // repeated selection rotates because used_count increments.
      seedFragments([
        { id: 'frag-1', category: 'fedaykin_join', content: 'Fragment 1', used_count: 5 },
        { id: 'frag-2', category: 'fedaykin_join', content: 'Fragment 2', used_count: 5 },
        { id: 'frag-3', category: 'fedaykin_join', content: 'Fragment 3', used_count: 5 },
      ]);

      const seen = new Set<string>();
      for (let i = 0; i < 3; i++) {
        const fragment = storyService.getFragment('fedaykin_join');
        expect(fragment).toBeDefined();
        seen.add(fragment!.id);
      }
      // Three selections over three equal fragments must cover all of them
      // (each selection increments used_count, so the others become least-used).
      expect(seen.size).toBe(3);
    });
  });

  describe('Usage Count Tracking', () => {
    it('should increment usage count after selecting fragment', () => {
      seedFragments([
        { id: 'frag-track', category: 'fedaykin_join', content: 'Test fragment', used_count: 2 },
      ]);

      storyService.getFragment('fedaykin_join');

      const row = db
        .prepare('SELECT used_count FROM story_fragments WHERE id = ?')
        .get('frag-track') as { used_count: number };
      expect(row.used_count).toBe(3);
    });

    it('should track usage stats correctly', () => {
      seedFragments([
        { id: 'f1', category: 'fedaykin_join', content: 'A', used_count: 10 },
        { id: 'f2', category: 'fedaykin_join', content: 'B', used_count: 15 },
        { id: 'n1', category: 'naib_join', content: 'C', used_count: 12 },
      ]);

      const stats = storyService.getFragmentStats();

      expect(stats.total).toBe(3);
      expect(stats.byCategory['fedaykin_join']).toMatchObject({ count: 2, totalUsed: 25 });
      expect(stats.byCategory['naib_join']).toMatchObject({ count: 1, totalUsed: 12 });
    });
  });

  describe('Fragment Posting', () => {
    it('should post Fedaykin fragment to #the-door', async () => {
      seedFragments([
        { id: 'frag-1', category: 'fedaykin_join', content: 'The desert welcomes you.', used_count: 0 },
      ]);
      const channel = makeTextChannel();
      const mockClient = { channels: { fetch: vi.fn(async () => channel) } };

      const result = await storyService.postJoinFragment(mockClient as any, 'fedaykin');

      expect(result).toBe(true);
      expect(mockClient.channels.fetch).toHaveBeenCalledWith('channel-the-door');
      expect(channel.send).toHaveBeenCalledTimes(1);
      expect(channel.send.mock.calls[0][0]).toContain('The desert welcomes you.');
    });

    it('should post Naib fragment to #the-door', async () => {
      seedFragments([
        { id: 'naib-1', category: 'naib_join', content: 'The council convenes.', used_count: 0 },
      ]);
      const channel = makeTextChannel();
      const mockClient = { channels: { fetch: vi.fn(async () => channel) } };

      const result = await storyService.postJoinFragment(mockClient as any, 'naib');

      expect(result).toBe(true);
      expect(channel.send.mock.calls[0][0]).toContain('The council convenes.');
    });

    it('should not post for non-elite tiers', async () => {
      const mockClient = { channels: { fetch: vi.fn() } };

      const result = await storyService.postJoinFragment(mockClient as any, 'hajra');

      expect(result).toBe(false);
      expect(mockClient.channels.fetch).not.toHaveBeenCalled();
    });
  });

  describe('Fragment Formatting', () => {
    it('should format fragment with decorative borders', () => {
      const formatted = storyService.formatFragment('A tale of sand.');
      const lines = formatted.split('\n');
      expect(lines).toHaveLength(3);
      expect(lines[0]).toBe(lines[2]); // top and bottom border match
      expect(lines[1]).toBe('A tale of sand.');
      expect(lines[0].length).toBeGreaterThan(10);
    });
  });

  describe('Category Filtering', () => {
    it('should only return fragments matching category', () => {
      seedFragments([
        { id: 'fed-1', category: 'fedaykin_join', content: 'Fedaykin fragment', used_count: 0 },
        { id: 'naib-1', category: 'naib_join', content: 'Naib fragment', used_count: 0 },
      ]);

      const fragment = storyService.getFragment('fedaykin_join');

      expect(fragment).toBeDefined();
      expect(fragment!.id).toBe('fed-1');
      expect(fragment!.category).toBe('fedaykin_join');
    });
  });

  describe('Edge Cases', () => {
    it('should handle invalid tier gracefully', async () => {
      const mockClient = { channels: { fetch: vi.fn() } };

      const result = await storyService.postJoinFragment(mockClient as any, 'invalid' as any);

      expect(result).toBe(false);
    });

    it('should handle database error during fragment retrieval', () => {
      // getFragment() is synchronous — a DB failure surfaces as a throw.
      db.close(); // subsequent prepare() throws
      expect(() => storyService.getFragment('fedaykin_join')).toThrow();
      // reopen so afterEach close() is a no-op on a valid handle
      db = new Database(':memory:');
    });

    it('should handle sequential fragment requests with rotation', () => {
      seedFragments([
        { id: 'frag-1', category: 'fedaykin_join', content: 'A', used_count: 0 },
        { id: 'frag-2', category: 'fedaykin_join', content: 'B', used_count: 0 },
      ]);

      const first = storyService.getFragment('fedaykin_join');
      const second = storyService.getFragment('fedaykin_join');

      expect(first).toBeDefined();
      expect(second).toBeDefined();
      // After the first selection increments its count, the second selection
      // must pick the other fragment.
      expect(second!.id).not.toBe(first!.id);
    });
  });
});

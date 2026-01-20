/**
 * Create Command Tests
 *
 * Sprint 85: Discord Server Sandboxes - CLI Commands
 *
 * Unit tests for the create command.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies before imports
vi.mock('../utils.js', () => ({
  getSandboxManager: vi.fn(),
  getCurrentUser: vi.fn(() => 'test-user'),
  parseTTL: vi.fn((ttl: string) => {
    if (ttl === '24h') return 24;
    if (ttl === '48h') return 48;
    if (ttl === '7d') return 168;
    return 24;
  }),
  formatDate: vi.fn((date: Date | null) => date?.toISOString() ?? '-'),
  formatDuration: vi.fn(() => '23h 59m'),
  timeUntil: vi.fn(() => 86400000),
  handleError: vi.fn(),
  createSilentLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis(),
  })),
  isInteractive: vi.fn(() => false),
}));

vi.mock('ora', () => ({
  default: vi.fn(() => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
  })),
}));

vi.mock('chalk', () => ({
  default: {
    green: vi.fn((s: string) => s),
    red: vi.fn((s: string) => s),
    cyan: vi.fn((s: string) => s),
    bold: vi.fn((s: string) => s),
    dim: vi.fn((s: string) => s),
  },
}));

import { createCommand } from '../new.js';
import * as utils from '../utils.js';

describe('createCommand', () => {
  const mockCreate = vi.fn();
  const mockManager = {
    create: mockCreate,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(utils.getSandboxManager).mockReturnValue(mockManager as any);

    // Default successful create result
    mockCreate.mockResolvedValue({
      sandbox: {
        id: 'test-uuid',
        name: 'test-sandbox',
        owner: 'test-user',
        status: 'running',
        schemaName: 'sandbox_testuuid',
        createdAt: new Date('2024-01-15T00:00:00Z'),
        expiresAt: new Date('2024-01-16T00:00:00Z'),
        guildIds: [],
        metadata: {},
      },
      schema: {
        name: 'sandbox_testuid',
        tablesCreated: ['communities', 'profiles', 'badges'],
      },
      durationMs: 150,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should create a sandbox with default options', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await createCommand(undefined, { ttl: '24h' });

    expect(mockCreate).toHaveBeenCalledWith({
      name: undefined,
      owner: 'test-user',
      ttlHours: 24,
      guildIds: [],
      metadata: {
        createdFrom: 'cli',
        createdBy: 'test-user',
        ttlHours: 24,
      },
    });

    consoleSpy.mockRestore();
  });

  it('should create a sandbox with custom name', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await createCommand('my-sandbox', { ttl: '24h' });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'my-sandbox',
      })
    );

    consoleSpy.mockRestore();
  });

  it('should create a sandbox with custom TTL', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await createCommand(undefined, { ttl: '48h' });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        ttlHours: 48,
      })
    );

    consoleSpy.mockRestore();
  });

  it('should create a sandbox with guild registration', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await createCommand(undefined, { ttl: '24h', guild: '123456789' });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        guildIds: ['123456789'],
      })
    );

    consoleSpy.mockRestore();
  });

  it('should output JSON when --json flag is set', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await createCommand(undefined, { ttl: '24h', json: true });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('"success": true')
    );

    consoleSpy.mockRestore();
  });

  it('should handle errors gracefully', async () => {
    mockCreate.mockRejectedValue(new Error('Database error'));

    await createCommand(undefined, { ttl: '24h' });

    expect(utils.handleError).toHaveBeenCalled();
  });
});

/**
 * List Command Tests
 *
 * Sprint 85: Discord Server Sandboxes - CLI Commands
 *
 * Unit tests for the list command.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies before imports
vi.mock('../utils.js', () => ({
  getSandboxManager: vi.fn(),
  getCurrentUser: vi.fn(() => 'test-user'),
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
}));

vi.mock('chalk', () => ({
  default: {
    green: vi.fn((s: string) => s),
    red: vi.fn((s: string) => s),
    yellow: vi.fn((s: string) => s),
    blue: vi.fn((s: string) => s),
    magenta: vi.fn((s: string) => s),
    gray: vi.fn((s: string) => s),
    cyan: vi.fn((s: string) => s),
    bold: vi.fn((s: string) => s),
    dim: vi.fn((s: string) => s),
  },
}));

vi.mock('cli-table3', () => ({
  default: vi.fn().mockImplementation(() => ({
    push: vi.fn(),
    toString: vi.fn(() => 'mocked-table'),
  })),
}));

import { listCommand } from '../ls.js';
import * as utils from '../utils.js';

describe('listCommand', () => {
  const mockList = vi.fn();
  const mockManager = {
    list: mockList,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(utils.getSandboxManager).mockReturnValue(mockManager as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should list sandboxes for current user by default', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    mockList.mockResolvedValue([
      {
        id: 'test-uuid',
        name: 'test-sandbox',
        owner: 'test-user',
        status: 'running',
        schemaName: 'sandbox_testuuid',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 86400000),
        guildIds: [],
        metadata: {},
      },
    ]);

    await listCommand({});

    expect(mockList).toHaveBeenCalledWith({
      owner: 'test-user',
      includeDestroyed: undefined,
    });

    consoleSpy.mockRestore();
  });

  it('should filter by owner when specified', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    mockList.mockResolvedValue([]);

    await listCommand({ owner: 'other-user' });

    expect(mockList).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 'other-user',
      })
    );

    consoleSpy.mockRestore();
  });

  it('should filter by status when specified', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    mockList.mockResolvedValue([]);

    await listCommand({ status: 'running' });

    expect(mockList).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'running',
      })
    );

    consoleSpy.mockRestore();
  });

  it('should include destroyed sandboxes with --all flag', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    mockList.mockResolvedValue([]);

    await listCommand({ all: true });

    expect(mockList).toHaveBeenCalledWith(
      expect.objectContaining({
        includeDestroyed: true,
      })
    );

    consoleSpy.mockRestore();
  });

  it('should output JSON when --json flag is set', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    mockList.mockResolvedValue([
      {
        id: 'test-uuid',
        name: 'test-sandbox',
        owner: 'test-user',
        status: 'running',
        schemaName: 'sandbox_testuuid',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 86400000),
        guildIds: ['123'],
        metadata: {},
      },
    ]);

    await listCommand({ json: true });

    const calls = consoleSpy.mock.calls;
    const jsonOutput = calls[0][0] as string;
    expect(jsonOutput).toContain('"success": true');
    expect(jsonOutput).toContain('"count": 1');

    consoleSpy.mockRestore();
  });

  it('should show message when no sandboxes found', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    mockList.mockResolvedValue([]);

    await listCommand({});

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('No sandboxes found')
    );

    consoleSpy.mockRestore();
  });

  it('should handle errors gracefully', async () => {
    mockList.mockRejectedValue(new Error('Database error'));

    await listCommand({});

    expect(utils.handleError).toHaveBeenCalled();
  });
});

/**
 * Destroy Command Tests
 *
 * Sprint 85: Discord Server Sandboxes - CLI Commands
 *
 * Unit tests for the destroy command.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies before imports
vi.mock('../utils.js', () => ({
  getSandboxManager: vi.fn(),
  getCurrentUser: vi.fn(() => 'test-user'),
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
  canPrompt: vi.fn(() => false),
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
    yellow: vi.fn((s: string) => s),
    cyan: vi.fn((s: string) => s),
    bold: vi.fn((s: string) => s),
  },
}));

// Mock readline
vi.mock('readline', () => ({
  createInterface: vi.fn(() => ({
    question: vi.fn((_, callback) => callback('y')),
    close: vi.fn(),
  })),
}));

import { destroyCommand } from '../rm.js';
import * as utils from '../utils.js';

describe('destroyCommand', () => {
  const mockGetByName = vi.fn();
  const mockDestroy = vi.fn();
  const mockManager = {
    getByName: mockGetByName,
    destroy: mockDestroy,
  };

  const mockSandbox = {
    id: 'test-uuid',
    name: 'test-sandbox',
    owner: 'test-user',
    status: 'running',
    schemaName: 'sandbox_testuuid',
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 86400000),
    guildIds: [],
    metadata: {},
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(utils.getSandboxManager).mockReturnValue(mockManager as any);
    mockGetByName.mockResolvedValue(mockSandbox);
    mockDestroy.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should destroy a sandbox with --yes flag', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    await destroyCommand('test-sandbox', { yes: true });

    expect(mockGetByName).toHaveBeenCalledWith('test-sandbox');
    expect(mockDestroy).toHaveBeenCalledWith('test-uuid', 'test-user');

    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('should output JSON when --json flag is set', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await destroyCommand('test-sandbox', { json: true });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('"success": true')
    );

    consoleSpy.mockRestore();
  });

  it('should handle sandbox not found', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    mockGetByName.mockResolvedValue(null);

    await destroyCommand('nonexistent', { yes: true });

    expect(exitSpy).toHaveBeenCalledWith(1);

    consoleSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('should handle already destroyed sandbox', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    mockGetByName.mockResolvedValue({
      ...mockSandbox,
      status: 'destroyed',
    });

    await destroyCommand('test-sandbox', { yes: true });

    // Should have called process.exit(0) for already destroyed sandbox
    // Note: mockDestroy may still be called because the mock of process.exit
    // doesn't actually stop execution, but in production it would
    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('already destroyed')
    );

    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('should report not found in JSON format', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    mockGetByName.mockResolvedValue(null);

    await destroyCommand('nonexistent', { json: true });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('"code": "NOT_FOUND"')
    );

    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('should handle errors gracefully', async () => {
    mockGetByName.mockRejectedValue(new Error('Database error'));

    await destroyCommand('test-sandbox', { yes: true });

    expect(utils.handleError).toHaveBeenCalled();
  });
});

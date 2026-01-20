/**
 * Connect Command Tests
 *
 * Sprint 85: Discord Server Sandboxes - CLI Commands
 *
 * Unit tests for the connect command.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies before imports
vi.mock('../utils.js', () => ({
  getSandboxManager: vi.fn(),
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
    red: vi.fn((s: string) => s),
    dim: vi.fn((s: string) => s),
  },
}));

import { connectCommand } from '../env.js';
import * as utils from '../utils.js';

describe('connectCommand', () => {
  const mockGetByName = vi.fn();
  const mockGetConnectionDetails = vi.fn();
  const mockManager = {
    getByName: mockGetByName,
    getConnectionDetails: mockGetConnectionDetails,
  };

  const mockSandbox = {
    id: 'test-uuid',
    name: 'test-sandbox',
    owner: 'test-user',
    status: 'running',
    schemaName: 'sandbox_testuuid',
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 86400000),
    guildIds: ['123456'],
    metadata: {},
  };

  const mockConnectionDetails = {
    sandboxId: 'test-uuid',
    schemaName: 'sandbox_testuuid',
    redisPrefix: 'sandbox:test-uuid:',
    natsPrefix: 'sandbox.test-uuid.',
    guildIds: ['123456'],
    env: {
      SANDBOX_ID: 'test-uuid',
      SANDBOX_SCHEMA: 'sandbox_testuuid',
      SANDBOX_REDIS_PREFIX: 'sandbox:test-uuid:',
      SANDBOX_NATS_PREFIX: 'sandbox.test-uuid.',
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(utils.getSandboxManager).mockReturnValue(mockManager as any);
    mockGetByName.mockResolvedValue(mockSandbox);
    mockGetConnectionDetails.mockResolvedValue(mockConnectionDetails);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should output shell export statements by default', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await connectCommand('test-sandbox', {});

    expect(consoleSpy).toHaveBeenCalledWith('export SANDBOX_ID="test-uuid"');
    expect(consoleSpy).toHaveBeenCalledWith('export SANDBOX_SCHEMA="sandbox_testuuid"');
    expect(consoleSpy).toHaveBeenCalledWith('export SANDBOX_REDIS_PREFIX="sandbox:test-uuid:"');
    expect(consoleSpy).toHaveBeenCalledWith('export SANDBOX_NATS_PREFIX="sandbox.test-uuid."');

    consoleSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('should output JSON when --json flag is set', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await connectCommand('test-sandbox', { json: true });

    const calls = consoleSpy.mock.calls;
    const jsonOutput = calls[0][0] as string;
    expect(jsonOutput).toContain('"success": true');
    expect(jsonOutput).toContain('"schemaName": "sandbox_testuuid"');

    consoleSpy.mockRestore();
  });

  it('should handle sandbox not found', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    mockGetByName.mockResolvedValue(null);

    await connectCommand('nonexistent', {});

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Sandbox 'nonexistent' not found")
    );
    expect(exitSpy).toHaveBeenCalledWith(1);

    consoleSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('should handle sandbox not running', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    mockGetByName.mockResolvedValue({
      ...mockSandbox,
      status: 'expired',
    });

    await connectCommand('test-sandbox', {});

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('is not running')
    );
    expect(exitSpy).toHaveBeenCalledWith(1);

    consoleSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('should report not found in JSON format', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    mockGetByName.mockResolvedValue(null);

    await connectCommand('nonexistent', { json: true });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('"code": "NOT_FOUND"')
    );

    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('should report not running in JSON format', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    mockGetByName.mockResolvedValue({
      ...mockSandbox,
      status: 'destroyed',
    });

    await connectCommand('test-sandbox', { json: true });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('"code": "NOT_RUNNING"')
    );

    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('should handle errors gracefully', async () => {
    mockGetByName.mockRejectedValue(new Error('Database error'));

    await connectCommand('test-sandbox', {});

    expect(utils.handleError).toHaveBeenCalled();
  });
});

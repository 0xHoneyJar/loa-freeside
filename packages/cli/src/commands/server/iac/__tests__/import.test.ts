/**
 * Import Command Tests
 *
 * Sprint 99: Import & State Commands
 *
 * @module packages/cli/commands/server/iac/__tests__/import.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock modules before imports
vi.mock('../DiscordClient.js', () => ({
  createClientFromEnv: vi.fn(),
  DiscordClient: vi.fn(),
}));

vi.mock('../WorkspaceManager.js', () => ({
  createWorkspaceManager: vi.fn(),
}));

vi.mock('../backends/BackendFactory.js', () => ({
  BackendFactory: {
    auto: vi.fn(),
  },
}));

vi.mock('../../utils.js', () => ({
  getGuildId: vi.fn(),
  getDiscordToken: vi.fn(),
  formatInfo: vi.fn(),
  formatSuccess: vi.fn(),
  handleError: vi.fn(),
  ExitCodes: {
    SUCCESS: 0,
    ERROR: 1,
  },
}));

// Import after mocks
import { importCommand } from '../../import.js';
import { createClientFromEnv } from '../DiscordClient.js';
import { createWorkspaceManager } from '../WorkspaceManager.js';
import { BackendFactory } from '../backends/BackendFactory.js';
import { getGuildId, getDiscordToken, handleError } from '../../utils.js';

describe('Import Command', () => {
  let mockBackend: {
    getState: ReturnType<typeof vi.fn>;
    setState: ReturnType<typeof vi.fn>;
    lock: ReturnType<typeof vi.fn>;
    unlock: ReturnType<typeof vi.fn>;
    getLock: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  };

  let mockClient: {
    fetchResource: ReturnType<typeof vi.fn>;
  };

  let mockWorkspaceManager: {
    current: ReturnType<typeof vi.fn>;
    getBackend: ReturnType<typeof vi.fn>;
  };

  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Mock process.exit
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    // Create mock backend
    mockBackend = {
      getState: vi.fn(),
      setState: vi.fn(),
      lock: vi.fn().mockResolvedValue({ acquired: true, lockId: 'test-lock' }),
      unlock: vi.fn().mockResolvedValue(true),
      getLock: vi.fn().mockResolvedValue(null),
      close: vi.fn().mockResolvedValue(undefined),
    };

    // Create mock client
    mockClient = {
      fetchResource: vi.fn(),
    };

    // Create mock workspace manager
    mockWorkspaceManager = {
      current: vi.fn().mockResolvedValue('default'),
      getBackend: vi.fn().mockReturnValue({ close: vi.fn() }),
    };

    // Setup default mocks
    vi.mocked(BackendFactory.auto).mockResolvedValue(mockBackend as any);
    vi.mocked(createClientFromEnv).mockReturnValue(mockClient as any);
    vi.mocked(createWorkspaceManager).mockResolvedValue(mockWorkspaceManager as any);
    vi.mocked(getGuildId).mockReturnValue('guild-123');
    vi.mocked(getDiscordToken).mockReturnValue('token');
  });

  afterEach(() => {
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
  });

  describe('Address Parsing', () => {
    it('rejects invalid address format', async () => {
      await importCommand('invalid_address', 'resource-123', { json: false });

      expect(handleError).toHaveBeenCalled();
      const errorCall = vi.mocked(handleError).mock.calls[0][0] as Error;
      expect(errorCall.message).toContain('Invalid address format');
    });

    it('rejects unknown resource types', async () => {
      await importCommand('discord_unknown.test', 'resource-123', { json: false });

      expect(handleError).toHaveBeenCalled();
      const errorCall = vi.mocked(handleError).mock.calls[0][0] as Error;
      expect(errorCall.message).toContain('Invalid address format');
    });

    it('accepts valid role address', async () => {
      mockBackend.getState.mockResolvedValue({
        version: 1,
        serial: 1,
        lineage: 'test',
        resources: [],
      });

      mockClient.fetchResource.mockResolvedValue({
        type: 'role',
        id: 'role-123',
        name: 'Admin',
        attributes: { id: 'role-123', name: 'Admin' },
      });

      await importCommand('discord_role.admin', 'role-123', { json: false, quiet: true });

      expect(mockClient.fetchResource).toHaveBeenCalledWith('guild-123', 'role', 'role-123');
    });

    it('accepts valid channel address', async () => {
      mockBackend.getState.mockResolvedValue({
        version: 1,
        serial: 1,
        lineage: 'test',
        resources: [],
      });

      mockClient.fetchResource.mockResolvedValue({
        type: 'channel',
        id: 'channel-123',
        name: 'general',
        attributes: { id: 'channel-123', name: 'general' },
      });

      await importCommand('discord_channel.general', 'channel-123', { json: false, quiet: true });

      expect(mockClient.fetchResource).toHaveBeenCalledWith('guild-123', 'channel', 'channel-123');
    });

    it('accepts valid category address', async () => {
      mockBackend.getState.mockResolvedValue({
        version: 1,
        serial: 1,
        lineage: 'test',
        resources: [],
      });

      mockClient.fetchResource.mockResolvedValue({
        type: 'category',
        id: 'cat-123',
        name: 'Info',
        attributes: { id: 'cat-123', name: 'Info' },
      });

      await importCommand('discord_category.info', 'cat-123', { json: false, quiet: true });

      expect(mockClient.fetchResource).toHaveBeenCalledWith('guild-123', 'category', 'cat-123');
    });
  });

  describe('State Management', () => {
    it('creates empty state if none exists', async () => {
      mockBackend.getState.mockResolvedValue(null);

      mockClient.fetchResource.mockResolvedValue({
        type: 'role',
        id: 'role-123',
        name: 'Admin',
        attributes: { id: 'role-123', name: 'Admin' },
      });

      await importCommand('discord_role.admin', 'role-123', { json: false, quiet: true });

      expect(mockBackend.setState).toHaveBeenCalled();
      const setStateCall = mockBackend.setState.mock.calls[0][1];
      expect(setStateCall.resources.length).toBe(1);
    });

    it('rejects import if resource already exists in state', async () => {
      mockBackend.getState.mockResolvedValue({
        version: 1,
        serial: 1,
        lineage: 'test',
        resources: [
          {
            type: 'discord_role',
            name: 'admin',
            provider: 'discord',
            instances: [{ schema_version: 1, attributes: { id: 'existing-123' } }],
          },
        ],
      });

      await importCommand('discord_role.admin', 'role-123', { json: false });

      expect(handleError).toHaveBeenCalled();
      const errorCall = vi.mocked(handleError).mock.calls[0][0] as Error;
      expect(errorCall.message).toContain('already exists in state');
    });

    it('increments serial number on import', async () => {
      mockBackend.getState.mockResolvedValue({
        version: 1,
        serial: 5,
        lineage: 'test',
        resources: [],
      });

      mockClient.fetchResource.mockResolvedValue({
        type: 'role',
        id: 'role-123',
        name: 'Admin',
        attributes: { id: 'role-123', name: 'Admin' },
      });

      await importCommand('discord_role.admin', 'role-123', { json: false, quiet: true });

      const setStateCall = mockBackend.setState.mock.calls[0][1];
      expect(setStateCall.serial).toBe(6);
    });
  });

  describe('Guild ID Handling', () => {
    it('requires guild ID', async () => {
      vi.mocked(getGuildId).mockReturnValue(undefined as any);

      await importCommand('discord_role.admin', 'role-123', { json: false });

      expect(handleError).toHaveBeenCalled();
      const errorCall = vi.mocked(handleError).mock.calls[0][0] as Error;
      expect(errorCall.message).toContain('Guild ID is required');
    });

    it('uses guild ID from options', async () => {
      vi.mocked(getGuildId).mockReturnValue('custom-guild');

      mockBackend.getState.mockResolvedValue({
        version: 1,
        serial: 1,
        lineage: 'test',
        resources: [],
      });

      mockClient.fetchResource.mockResolvedValue({
        type: 'role',
        id: 'role-123',
        name: 'Admin',
        attributes: { id: 'role-123', name: 'Admin' },
      });

      await importCommand('discord_role.admin', 'role-123', {
        guild: 'custom-guild',
        json: false,
        quiet: true,
      });

      expect(mockClient.fetchResource).toHaveBeenCalledWith('custom-guild', 'role', 'role-123');
    });
  });

  describe('JSON Output', () => {
    it('outputs JSON on success', async () => {
      mockBackend.getState.mockResolvedValue({
        version: 1,
        serial: 1,
        lineage: 'test',
        resources: [],
      });

      mockClient.fetchResource.mockResolvedValue({
        type: 'role',
        id: 'role-123',
        name: 'Admin',
        attributes: { id: 'role-123', name: 'Admin' },
      });

      await importCommand('discord_role.admin', 'role-123', { json: true, quiet: true });

      expect(consoleSpy).toHaveBeenCalled();
      const output = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(output.success).toBe(true);
      expect(output.address).toBe('discord_role.admin');
      expect(output.resourceType).toBe('role');
    });
  });

  describe('Workspace Handling', () => {
    it('uses current workspace by default', async () => {
      mockWorkspaceManager.current.mockResolvedValue('production');

      mockBackend.getState.mockResolvedValue({
        version: 1,
        serial: 1,
        lineage: 'test',
        resources: [],
      });

      mockClient.fetchResource.mockResolvedValue({
        type: 'role',
        id: 'role-123',
        name: 'Admin',
        attributes: { id: 'role-123', name: 'Admin' },
      });

      await importCommand('discord_role.admin', 'role-123', { json: false, quiet: true });

      expect(mockBackend.getState).toHaveBeenCalledWith('production');
    });

    it('uses workspace from options', async () => {
      mockBackend.getState.mockResolvedValue({
        version: 1,
        serial: 1,
        lineage: 'test',
        resources: [],
      });

      mockClient.fetchResource.mockResolvedValue({
        type: 'role',
        id: 'role-123',
        name: 'Admin',
        attributes: { id: 'role-123', name: 'Admin' },
      });

      await importCommand('discord_role.admin', 'role-123', {
        workspace: 'staging',
        json: false,
        quiet: true,
      });

      expect(mockBackend.getState).toHaveBeenCalledWith('staging');
    });
  });
});

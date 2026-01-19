/**
 * State Commands Tests
 *
 * Sprint 99: Import & State Commands
 *
 * @module packages/cli/commands/server/iac/__tests__/state.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock modules before imports
vi.mock('../DiscordClient.js', () => ({
  createClientFromEnv: vi.fn(),
  DiscordClient: vi.fn(),
}));

vi.mock('../StateReader.js', () => ({
  readServerState: vi.fn(),
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
  formatWarning: vi.fn(),
  handleError: vi.fn(),
  ExitCodes: {
    SUCCESS: 0,
    ERROR: 1,
    PARTIAL_FAILURE: 2,
  },
}));

// Import after mocks
import {
  stateListCommand,
  stateShowCommand,
  stateRmCommand,
  stateMvCommand,
  statePullCommand,
} from '../../state.js';
import { createClientFromEnv } from '../DiscordClient.js';
import { readServerState } from '../StateReader.js';
import { createWorkspaceManager } from '../WorkspaceManager.js';
import { BackendFactory } from '../backends/BackendFactory.js';
import { getGuildId, getDiscordToken, handleError } from '../../utils.js';

describe('State Commands', () => {
  let mockBackend: {
    getState: ReturnType<typeof vi.fn>;
    setState: ReturnType<typeof vi.fn>;
    lock: ReturnType<typeof vi.fn>;
    unlock: ReturnType<typeof vi.fn>;
    getLock: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  };

  let mockWorkspaceManager: {
    current: ReturnType<typeof vi.fn>;
    getBackend: ReturnType<typeof vi.fn>;
  };

  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  const createMockState = (resources: any[] = []) => ({
    version: 1,
    serial: 5,
    lineage: 'test-lineage',
    lastModified: '2026-01-19T00:00:00Z',
    resources,
  });

  const createMockResource = (type: string, name: string, id: string, attrs: any = {}) => ({
    type: `discord_${type}`,
    name,
    provider: 'discord',
    instances: [
      {
        schema_version: 1,
        attributes: { id, name: attrs.name || name, ...attrs },
      },
    ],
  });

  beforeEach(() => {
    vi.clearAllMocks();

    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    mockBackend = {
      getState: vi.fn(),
      setState: vi.fn(),
      lock: vi.fn().mockResolvedValue({ acquired: true, lockId: 'test-lock' }),
      unlock: vi.fn().mockResolvedValue(true),
      getLock: vi.fn().mockResolvedValue(null),
      close: vi.fn().mockResolvedValue(undefined),
    };

    mockWorkspaceManager = {
      current: vi.fn().mockResolvedValue('default'),
      getBackend: vi.fn().mockReturnValue({ close: vi.fn() }),
    };

    vi.mocked(BackendFactory.auto).mockResolvedValue(mockBackend as any);
    vi.mocked(createWorkspaceManager).mockResolvedValue(mockWorkspaceManager as any);
    vi.mocked(getGuildId).mockReturnValue('guild-123');
    vi.mocked(getDiscordToken).mockReturnValue('token');
  });

  afterEach(() => {
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
  });

  describe('state list', () => {
    it('handles empty state', async () => {
      mockBackend.getState.mockResolvedValue(null);

      await stateListCommand({ json: true });

      const output = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(output.success).toBe(true);
      expect(output.resources).toEqual([]);
      expect(output.count).toBe(0);
    });

    it('lists all resources grouped by type', async () => {
      mockBackend.getState.mockResolvedValue(
        createMockState([
          createMockResource('role', 'admin', 'role-1'),
          createMockResource('role', 'mod', 'role-2'),
          createMockResource('channel', 'general', 'chan-1'),
        ])
      );

      await stateListCommand({ json: true });

      const output = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(output.success).toBe(true);
      expect(output.count).toBe(3);
      expect(output.resources.length).toBe(3);
    });

    it('includes serial number in output', async () => {
      mockBackend.getState.mockResolvedValue(
        createMockState([createMockResource('role', 'admin', 'role-1')])
      );

      await stateListCommand({ json: true });

      const output = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(output.serial).toBe(5);
    });
  });

  describe('state show', () => {
    it('shows resource details', async () => {
      mockBackend.getState.mockResolvedValue(
        createMockState([
          createMockResource('role', 'admin', 'role-123', { color: 0xff0000, hoist: true }),
        ])
      );

      await stateShowCommand('discord_role.admin', { json: true });

      const output = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(output.success).toBe(true);
      expect(output.address).toBe('discord_role.admin');
      expect(output.resource.type).toBe('discord_role');
      expect(output.resource.instances[0].attributes.color).toBe(0xff0000);
    });

    it('errors if resource not found', async () => {
      mockBackend.getState.mockResolvedValue(createMockState([]));

      await stateShowCommand('discord_role.nonexistent', { json: false });

      expect(handleError).toHaveBeenCalled();
      const errorCall = vi.mocked(handleError).mock.calls[0][0] as Error;
      expect(errorCall.message).toContain('Resource not found');
    });

    it('errors if state is empty', async () => {
      mockBackend.getState.mockResolvedValue(null);

      await stateShowCommand('discord_role.admin', { json: false });

      expect(handleError).toHaveBeenCalled();
      const errorCall = vi.mocked(handleError).mock.calls[0][0] as Error;
      expect(errorCall.message).toContain('No state found');
    });

    it('rejects invalid address format', async () => {
      await stateShowCommand('invalid', { json: false });

      expect(handleError).toHaveBeenCalled();
      const errorCall = vi.mocked(handleError).mock.calls[0][0] as Error;
      expect(errorCall.message).toContain('Invalid address format');
    });
  });

  describe('state rm', () => {
    it('removes resource from state', async () => {
      mockBackend.getState.mockResolvedValue(
        createMockState([
          createMockResource('role', 'admin', 'role-1'),
          createMockResource('role', 'mod', 'role-2'),
        ])
      );

      await stateRmCommand('discord_role.admin', { json: true, yes: true });

      expect(mockBackend.setState).toHaveBeenCalled();
      const newState = mockBackend.setState.mock.calls[0][1];
      expect(newState.resources.length).toBe(1);
      expect(newState.resources[0].name).toBe('mod');
    });

    it('increments serial on removal', async () => {
      mockBackend.getState.mockResolvedValue(
        createMockState([createMockResource('role', 'admin', 'role-1')])
      );

      await stateRmCommand('discord_role.admin', { json: true, yes: true });

      const newState = mockBackend.setState.mock.calls[0][1];
      expect(newState.serial).toBe(6);
    });

    it('errors if resource not found', async () => {
      mockBackend.getState.mockResolvedValue(createMockState([]));

      await stateRmCommand('discord_role.nonexistent', { json: false, yes: true });

      expect(handleError).toHaveBeenCalled();
      const errorCall = vi.mocked(handleError).mock.calls[0][0] as Error;
      expect(errorCall.message).toContain('Resource not found');
    });

    it('outputs JSON with removed resource info', async () => {
      mockBackend.getState.mockResolvedValue(
        createMockState([createMockResource('role', 'admin', 'role-123')])
      );

      await stateRmCommand('discord_role.admin', { json: true, yes: true });

      const output = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(output.success).toBe(true);
      expect(output.removed).toBe('discord_role.admin');
      expect(output.resourceId).toBe('role-123');
    });
  });

  describe('state mv', () => {
    it('renames resource in state', async () => {
      mockBackend.getState.mockResolvedValue(
        createMockState([createMockResource('role', 'old_name', 'role-1')])
      );

      await stateMvCommand('discord_role.old_name', 'discord_role.new_name', { json: true });

      expect(mockBackend.setState).toHaveBeenCalled();
      const newState = mockBackend.setState.mock.calls[0][1];
      expect(newState.resources[0].name).toBe('new_name');
    });

    it('increments serial on move', async () => {
      mockBackend.getState.mockResolvedValue(
        createMockState([createMockResource('role', 'old_name', 'role-1')])
      );

      await stateMvCommand('discord_role.old_name', 'discord_role.new_name', { json: true });

      const newState = mockBackend.setState.mock.calls[0][1];
      expect(newState.serial).toBe(6);
    });

    it('errors if source not found', async () => {
      mockBackend.getState.mockResolvedValue(createMockState([]));

      await stateMvCommand('discord_role.nonexistent', 'discord_role.new_name', { json: false });

      expect(handleError).toHaveBeenCalled();
      const errorCall = vi.mocked(handleError).mock.calls[0][0] as Error;
      expect(errorCall.message).toContain('Source resource not found');
    });

    it('errors if destination already exists', async () => {
      mockBackend.getState.mockResolvedValue(
        createMockState([
          createMockResource('role', 'source', 'role-1'),
          createMockResource('role', 'dest', 'role-2'),
        ])
      );

      await stateMvCommand('discord_role.source', 'discord_role.dest', { json: false });

      expect(handleError).toHaveBeenCalled();
      const errorCall = vi.mocked(handleError).mock.calls[0][0] as Error;
      expect(errorCall.message).toContain('Destination already exists');
    });

    it('errors if types do not match', async () => {
      await stateMvCommand('discord_role.admin', 'discord_channel.admin', { json: false });

      expect(handleError).toHaveBeenCalled();
      const errorCall = vi.mocked(handleError).mock.calls[0][0] as Error;
      expect(errorCall.message).toContain('Cannot move between different resource types');
    });

    it('outputs JSON with move info', async () => {
      mockBackend.getState.mockResolvedValue(
        createMockState([createMockResource('role', 'old', 'role-123')])
      );

      await stateMvCommand('discord_role.old', 'discord_role.new', { json: true });

      const output = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(output.success).toBe(true);
      expect(output.source).toBe('discord_role.old');
      expect(output.destination).toBe('discord_role.new');
    });
  });

  describe('state pull', () => {
    it('requires guild ID', async () => {
      vi.mocked(getGuildId).mockReturnValue(undefined as any);

      await statePullCommand({ json: false });

      expect(handleError).toHaveBeenCalled();
      const errorCall = vi.mocked(handleError).mock.calls[0][0] as Error;
      expect(errorCall.message).toContain('Guild ID is required');
    });

    it('handles empty state gracefully', async () => {
      mockBackend.getState.mockResolvedValue(null);

      await statePullCommand({ json: true, guild: 'guild-123' });

      const output = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(output.updated).toBe(0);
      expect(output.failed).toBe(0);
    });

    it('updates resource attributes from Discord', async () => {
      mockBackend.getState.mockResolvedValue(
        createMockState([createMockResource('role', 'admin', 'role-123', { color: 0x000000 })])
      );

      vi.mocked(readServerState).mockResolvedValue({
        id: 'guild-123',
        name: 'Test Server',
        roles: [
          {
            id: 'role-123',
            name: 'Admin',
            color: 0xff0000,
            hoist: true,
            position: 5,
            permissions: '8',
            mentionable: false,
            isIacManaged: true,
          },
        ],
        categories: [],
        channels: [],
      });

      await statePullCommand({ json: true, guild: 'guild-123' });

      expect(mockBackend.setState).toHaveBeenCalled();
      const newState = mockBackend.setState.mock.calls[0][1];
      expect(newState.resources[0].instances[0].attributes.color).toBe(0xff0000);
    });

    it('reports resources not found in Discord', async () => {
      mockBackend.getState.mockResolvedValue(
        createMockState([createMockResource('role', 'deleted', 'role-deleted')])
      );

      vi.mocked(readServerState).mockResolvedValue({
        id: 'guild-123',
        name: 'Test Server',
        roles: [],
        categories: [],
        channels: [],
      });

      await statePullCommand({ json: true, guild: 'guild-123' });

      const output = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(output.failed).toBe(1);
      expect(output.failures[0].address).toBe('discord_role.deleted');
    });

    it('increments serial only if updates made', async () => {
      mockBackend.getState.mockResolvedValue(
        createMockState([createMockResource('role', 'admin', 'role-123')])
      );

      vi.mocked(readServerState).mockResolvedValue({
        id: 'guild-123',
        name: 'Test Server',
        roles: [
          {
            id: 'role-123',
            name: 'Admin',
            color: 0,
            hoist: false,
            position: 1,
            permissions: '0',
            mentionable: false,
            isIacManaged: true,
          },
        ],
        categories: [],
        channels: [],
      });

      await statePullCommand({ json: true, guild: 'guild-123' });

      const newState = mockBackend.setState.mock.calls[0][1];
      expect(newState.serial).toBe(6);
    });
  });

  describe('Workspace Handling', () => {
    it('uses current workspace by default', async () => {
      mockWorkspaceManager.current.mockResolvedValue('production');
      mockBackend.getState.mockResolvedValue(createMockState([]));

      await stateListCommand({ json: true });

      expect(mockBackend.getState).toHaveBeenCalledWith('production');
    });

    it('uses workspace from options', async () => {
      mockBackend.getState.mockResolvedValue(createMockState([]));

      await stateListCommand({ workspace: 'staging', json: true });

      expect(mockBackend.getState).toHaveBeenCalledWith('staging');
    });
  });
});

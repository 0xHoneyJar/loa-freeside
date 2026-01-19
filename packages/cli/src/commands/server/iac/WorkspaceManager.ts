/**
 * Workspace Manager
 *
 * Sprint 97: Workspace Management
 *
 * Manages workspace lifecycle for environment isolation (dev/staging/prod).
 * Workspaces provide separate state files for different environments.
 *
 * @see SDD grimoires/loa/gaib-sdd.md §3.2
 * @module packages/cli/commands/server/iac/WorkspaceManager
 */

import { existsSync, promises as fs } from 'fs';
import { join, dirname } from 'path';
import type { StateBackend, GaibState } from './backends/types.js';
import { createEmptyState } from './backends/types.js';
import { BackendFactory } from './backends/BackendFactory.js';

// ============================================================================
// Constants
// ============================================================================

/** Default workspace name */
export const DEFAULT_WORKSPACE = 'default';

/** Workspace name validation pattern */
const WORKSPACE_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

/** Maximum workspace name length */
const MAX_WORKSPACE_NAME_LENGTH = 64;

/** Local file to track current workspace */
const CURRENT_WORKSPACE_FILE = '.gaib/workspace';

// ============================================================================
// Types
// ============================================================================

/**
 * Information about a workspace
 */
export interface WorkspaceInfo {
  /** Workspace name */
  name: string;
  /** Whether this is the current workspace */
  current: boolean;
  /** Number of resources in the workspace */
  resourceCount: number;
  /** State serial number */
  serial: number;
  /** Last modification timestamp */
  lastModified: string | null;
  /** Backend type */
  backend: string;
}

/**
 * Options for creating a workspace
 */
export interface CreateWorkspaceOptions {
  /** Switch to the new workspace after creation */
  switchTo?: boolean;
}

/**
 * Options for deleting a workspace
 */
export interface DeleteWorkspaceOptions {
  /** Force delete even if workspace has resources */
  force?: boolean;
}

/**
 * Options for selecting a workspace
 */
export interface SelectWorkspaceOptions {
  /** Create workspace if it doesn't exist */
  create?: boolean;
}

// ============================================================================
// WorkspaceManager
// ============================================================================

/**
 * Manages workspace lifecycle
 *
 * Workspaces provide environment isolation by maintaining separate state files.
 * The default workspace is always available and cannot be deleted.
 *
 * @example
 * ```typescript
 * const manager = new WorkspaceManager(backend);
 *
 * // List workspaces
 * const workspaces = await manager.list();
 *
 * // Create a new workspace
 * await manager.create('staging');
 *
 * // Switch to workspace
 * await manager.select('staging');
 *
 * // Get current workspace
 * const current = await manager.current();
 * ```
 */
export class WorkspaceManager {
  private readonly backend: StateBackend;
  private readonly basePath: string;

  constructor(backend: StateBackend, basePath: string = process.cwd()) {
    this.backend = backend;
    this.basePath = basePath;
  }

  // ============================================================================
  // Core Operations
  // ============================================================================

  /**
   * Get the current workspace name
   *
   * @returns Current workspace name (defaults to 'default')
   */
  async current(): Promise<string> {
    const workspaceFile = join(this.basePath, CURRENT_WORKSPACE_FILE);

    try {
      const content = await fs.readFile(workspaceFile, 'utf-8');
      const workspace = content.trim();
      return workspace || DEFAULT_WORKSPACE;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return DEFAULT_WORKSPACE;
      }
      throw error;
    }
  }

  /**
   * List all available workspaces
   *
   * @returns Array of workspace information
   */
  async list(): Promise<WorkspaceInfo[]> {
    const currentWorkspace = await this.current();
    const workspaceNames = await this.backend.listWorkspaces();

    // Ensure default workspace is always listed
    if (!workspaceNames.includes(DEFAULT_WORKSPACE)) {
      workspaceNames.unshift(DEFAULT_WORKSPACE);
    }

    const workspaces: WorkspaceInfo[] = [];

    for (const name of workspaceNames) {
      const info = await this.getWorkspaceInfo(name, currentWorkspace);
      workspaces.push(info);
    }

    // Sort: current first, then alphabetically
    workspaces.sort((a, b) => {
      if (a.current) return -1;
      if (b.current) return 1;
      return a.name.localeCompare(b.name);
    });

    return workspaces;
  }

  /**
   * Create a new workspace
   *
   * @param name - Workspace name
   * @param options - Creation options
   */
  async create(name: string, options: CreateWorkspaceOptions = {}): Promise<WorkspaceInfo> {
    // Validate name
    this.validateWorkspaceName(name);

    // Check if workspace already exists
    const existingWorkspaces = await this.backend.listWorkspaces();
    if (existingWorkspaces.includes(name)) {
      throw new WorkspaceError(
        `Workspace "${name}" already exists`,
        'WORKSPACE_EXISTS'
      );
    }

    // Create empty state for the workspace
    const emptyState = createEmptyState({ workspace: name });
    await this.backend.setState(name, emptyState);

    // Switch to new workspace if requested
    if (options.switchTo) {
      await this.setCurrent(name);
    }

    const currentWorkspace = await this.current();
    return this.getWorkspaceInfo(name, currentWorkspace);
  }

  /**
   * Select (switch to) a workspace
   *
   * @param name - Workspace name
   * @param options - Selection options
   */
  async select(name: string, options: SelectWorkspaceOptions = {}): Promise<WorkspaceInfo> {
    // Validate name
    this.validateWorkspaceName(name);

    // Check if workspace exists
    const existingWorkspaces = await this.backend.listWorkspaces();
    const exists = existingWorkspaces.includes(name) || name === DEFAULT_WORKSPACE;

    if (!exists) {
      if (options.create) {
        // Create the workspace
        return this.create(name, { switchTo: true });
      }
      throw new WorkspaceError(
        `Workspace "${name}" does not exist. Use --create to create it.`,
        'WORKSPACE_NOT_FOUND'
      );
    }

    // Switch to workspace
    await this.setCurrent(name);

    return this.getWorkspaceInfo(name, name);
  }

  /**
   * Get detailed information about a workspace
   *
   * @param name - Workspace name (defaults to current)
   */
  async show(name?: string): Promise<WorkspaceInfo> {
    const workspaceName = name ?? await this.current();
    const currentWorkspace = await this.current();

    // Validate that workspace exists (except for default which always exists)
    if (workspaceName !== DEFAULT_WORKSPACE) {
      const existingWorkspaces = await this.backend.listWorkspaces();
      if (!existingWorkspaces.includes(workspaceName)) {
        throw new WorkspaceError(
          `Workspace "${workspaceName}" does not exist`,
          'WORKSPACE_NOT_FOUND'
        );
      }
    }

    return this.getWorkspaceInfo(workspaceName, currentWorkspace);
  }

  /**
   * Delete a workspace
   *
   * @param name - Workspace name
   * @param options - Deletion options
   */
  async delete(name: string, options: DeleteWorkspaceOptions = {}): Promise<void> {
    // Cannot delete default workspace
    if (name === DEFAULT_WORKSPACE) {
      throw new WorkspaceError(
        'Cannot delete the default workspace',
        'CANNOT_DELETE_DEFAULT'
      );
    }

    // Cannot delete current workspace
    const currentWorkspace = await this.current();
    if (name === currentWorkspace) {
      throw new WorkspaceError(
        `Cannot delete current workspace "${name}". Switch to another workspace first.`,
        'CANNOT_DELETE_CURRENT'
      );
    }

    // Check if workspace exists
    const existingWorkspaces = await this.backend.listWorkspaces();
    if (!existingWorkspaces.includes(name)) {
      throw new WorkspaceError(
        `Workspace "${name}" does not exist`,
        'WORKSPACE_NOT_FOUND'
      );
    }

    // Check if workspace has resources
    if (!options.force) {
      const state = await this.backend.getState(name);
      if (state && state.resources.length > 0) {
        throw new WorkspaceError(
          `Workspace "${name}" contains ${state.resources.length} resource(s). ` +
            'Use --force to delete anyway.',
          'WORKSPACE_NOT_EMPTY'
        );
      }
    }

    // Delete the workspace state
    await this.backend.deleteState(name);
  }

  /**
   * Check if a workspace exists
   *
   * @param name - Workspace name
   */
  async exists(name: string): Promise<boolean> {
    if (name === DEFAULT_WORKSPACE) {
      return true;
    }

    const workspaces = await this.backend.listWorkspaces();
    return workspaces.includes(name);
  }

  // ============================================================================
  // State Helpers
  // ============================================================================

  /**
   * Get state for current workspace
   */
  async getState(): Promise<GaibState | null> {
    const workspace = await this.current();
    return this.backend.getState(workspace);
  }

  /**
   * Set state for current workspace
   */
  async setState(state: GaibState): Promise<void> {
    const workspace = await this.current();
    await this.backend.setState(workspace, state);
  }

  /**
   * Get the backend instance
   */
  getBackend(): StateBackend {
    return this.backend;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Validate workspace name
   */
  private validateWorkspaceName(name: string): void {
    if (!name) {
      throw new WorkspaceError(
        'Workspace name cannot be empty',
        'INVALID_NAME'
      );
    }

    if (name.length > MAX_WORKSPACE_NAME_LENGTH) {
      throw new WorkspaceError(
        `Workspace name cannot exceed ${MAX_WORKSPACE_NAME_LENGTH} characters`,
        'INVALID_NAME'
      );
    }

    if (!WORKSPACE_NAME_PATTERN.test(name)) {
      throw new WorkspaceError(
        'Workspace name must start with a letter or number and contain only ' +
          'letters, numbers, hyphens, and underscores',
        'INVALID_NAME'
      );
    }
  }

  /**
   * Set the current workspace
   */
  private async setCurrent(name: string): Promise<void> {
    const workspaceFile = join(this.basePath, CURRENT_WORKSPACE_FILE);

    // Ensure directory exists
    const dir = dirname(workspaceFile);
    if (!existsSync(dir)) {
      await fs.mkdir(dir, { recursive: true });
    }

    await fs.writeFile(workspaceFile, name, 'utf-8');
  }

  /**
   * Get workspace information
   */
  private async getWorkspaceInfo(name: string, currentWorkspace: string): Promise<WorkspaceInfo> {
    const state = await this.backend.getState(name);

    return {
      name,
      current: name === currentWorkspace,
      resourceCount: state?.resources.length ?? 0,
      serial: state?.serial ?? 0,
      lastModified: state?.lastModified ?? null,
      backend: this.backend.type,
    };
  }
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Error codes for workspace operations
 */
export type WorkspaceErrorCode =
  | 'WORKSPACE_EXISTS'
  | 'WORKSPACE_NOT_FOUND'
  | 'WORKSPACE_NOT_EMPTY'
  | 'CANNOT_DELETE_DEFAULT'
  | 'CANNOT_DELETE_CURRENT'
  | 'INVALID_NAME';

/**
 * Error for workspace operations
 */
export class WorkspaceError extends Error {
  constructor(
    message: string,
    public readonly code: WorkspaceErrorCode
  ) {
    super(message);
    this.name = 'WorkspaceError';
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a WorkspaceManager with auto-detected backend
 *
 * @param cwd - Current working directory
 */
export async function createWorkspaceManager(cwd: string = process.cwd()): Promise<WorkspaceManager> {
  const backend = await BackendFactory.auto(cwd);
  return new WorkspaceManager(backend, cwd);
}

/**
 * Create a WorkspaceManager with a specific backend
 *
 * @param backend - State backend instance
 * @param cwd - Current working directory
 */
export function createWorkspaceManagerWithBackend(
  backend: StateBackend,
  cwd: string = process.cwd()
): WorkspaceManager {
  return new WorkspaceManager(backend, cwd);
}

# Software Design Document: Gaib CLI

**Version**: 2.0.0
**Status**: READY FOR REVIEW
**Last Updated**: 2026-01-19
**PRD Reference**: `grimoires/loa/gaib-prd.md`
**Previous SDD**: `grimoires/loa/archive/2026-01/features/discord-iac-sdd.md`

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Architecture Overview](#2-architecture-overview)
3. [System Components](#3-system-components)
4. [Data Models](#4-data-models)
5. [State Management](#5-state-management)
6. [CLI Command Design](#6-cli-command-design)
7. [Theme System](#7-theme-system)
8. [Security Design](#8-security-design)
9. [Error Handling](#9-error-handling)
10. [Testing Strategy](#10-testing-strategy)
11. [Migration Path](#11-migration-path)
12. [Sprint Breakdown](#12-sprint-breakdown)

---

## 1. Executive Summary

### 1.1 Purpose

Gaib CLI ("Vercel for Discord") extends the existing Discord IaC implementation (Sprint 91-93) with enterprise-grade features:

- **Remote State Management**: S3 backend with DynamoDB locking
- **Workspaces**: Environment isolation (dev/staging/prod)
- **Theme System**: Reusable server templates with registry
- **Full Lifecycle**: Apply, destroy, import commands

### 1.2 Design Principles

| Principle | Implementation |
|-----------|----------------|
| Terraform Familiarity | Same workflow: init -> plan -> apply |
| Declarative Config | YAML with Zod validation |
| Idempotent Operations | Same input = same output |
| Progressive Disclosure | Simple defaults, advanced options |
| Offline-First | Local state as fallback |

### 1.3 Scope

**In Scope (MVP)**:
- S3 remote state with DynamoDB locking
- Workspace management (create, select, list, delete)
- Theme system with local and registry themes
- Full apply/destroy lifecycle
- Import existing resources

**Out of Scope (Future)**:
- ECS-based worker architecture
- Bot-driven UI for community managers
- Real-time event synchronization
- Multi-region state replication

---

## 2. Architecture Overview

### 2.1 High-Level Architecture

```
+-----------------------------------------------------------------------------+
|                              Gaib CLI                                        |
+-----------------------------------------------------------------------------+
|                                                                              |
|  +--------------+  +--------------+  +--------------+  +--------------+     |
|  |   Commands   |  |    Config    |  |    State     |  |    Theme     |     |
|  |              |  |              |  |              |  |              |     |
|  | init         |  | ConfigParser |  | StateBackend |  | ThemeLoader  |     |
|  | plan         |  | ConfigWriter |  | StateLock    |  | ThemeRegistry|     |
|  | apply        |  | ConfigMerger |  | StateReader  |  | ThemeMerger  |     |
|  | destroy      |  |              |  | StateWriter  |  |              |     |
|  | import       |  |              |  |              |  |              |     |
|  +------+-------+  +------+-------+  +------+-------+  +------+-------+     |
|         |                 |                 |                 |              |
|  +------v-----------------v-----------------v-----------------v------+      |
|  |                         Core Engine                                |      |
|  |  +------------+  +------------+  +------------+  +------------+   |      |
|  |  | DiffEngine |  | PlanEngine |  |ApplyEngine |  | Workspace  |   |      |
|  |  +------------+  +------------+  +------------+  +------------+   |      |
|  +-----------------------------------+-----------------------------------+      |
|                                      |                                       |
|  +-----------------------------------v-----------------------------------+      |
|  |                      Infrastructure Layer                          |      |
|  |  +------------+  +------------+  +------------+  +------------+   |      |
|  |  |DiscordAPI  |  | S3 Backend |  |  DynamoDB  |  |   Local    |   |      |
|  |  |  Client    |  |            |  |   Lock     |  |  Backend   |   |      |
|  |  +------------+  +------------+  +------------+  +------------+   |      |
|  +-------------------------------------------------------------------+      |
|                                                                              |
+------------------------------------------------------------------------------+
                                      |
                                      v
+-----------------------------------------------------------------------------+
|                           External Services                                  |
|  +------------+  +------------+  +------------+  +------------+            |
|  |  Discord   |  |    AWS     |  |   Theme    |  |   Vault    |            |
|  |  REST API  |  | S3/DynamoDB|  |  Registry  |  | (Secrets)  |            |
|  +------------+  +------------+  +------------+  +------------+            |
+-----------------------------------------------------------------------------+
```

### 2.2 Component Dependencies

```
                    +-------------+
                    |   CLI App   |
                    +------+------+
                           |
          +----------------+----------------+
          |                |                |
    +-----v-----+   +-----v-----+   +-----v-----+
    |  Commands |   |   Config  |   |   Theme   |
    +-----+-----+   +-----+-----+   +-----+-----+
          |               |               |
          +-------+-------+-------+-------+
                  |               |
           +------v------+ +-----v------+
           | Core Engine | | Workspace  |
           +------+------+ +-----+------+
                  |              |
           +------v--------------v------+
           |     State Management       |
           +------+-------------+-------+
                  |             |
           +------v------+ +---v----+
           | S3 Backend  | | Local  |
           | + DynamoDB  | |Backend |
           +------+------+ +---+----+
                  |            |
           +------v------------v-------+
           |      Discord Client       |
           +---------------------------+
```

### 2.3 Existing Implementation Reference

The following components from Sprint 91-93 are reused:

| Component | Path | Status |
|-----------|------|--------|
| ConfigParser | `packages/cli/src/commands/server/iac/ConfigParser.ts` | Extend |
| DiffEngine | `packages/cli/src/commands/server/iac/DiffEngine.ts` | Reuse |
| StateReader | `packages/cli/src/commands/server/iac/StateReader.ts` | Extend |
| StateWriter | `packages/cli/src/commands/server/iac/StateWriter.ts` | Extend |
| DiscordClient | `packages/cli/src/commands/server/iac/DiscordClient.ts` | Reuse |
| RateLimiter | `packages/cli/src/commands/server/iac/RateLimiter.ts` | Reuse |
| RetryHandler | `packages/cli/src/commands/server/iac/RetryHandler.ts` | Reuse |
| Schemas | `packages/cli/src/commands/server/iac/schemas.ts` | Extend |

---

## 3. System Components

### 3.1 State Backend Architecture

```typescript
// packages/cli/src/commands/server/iac/backends/StateBackend.ts

/**
 * Abstract interface for state storage backends.
 * Supports local filesystem, S3, and future backends.
 */
export interface StateBackend {
  /** Read state from backend */
  read(workspace: string): Promise<ServerState | null>;

  /** Write state to backend */
  write(workspace: string, state: ServerState): Promise<void>;

  /** List available workspaces */
  listWorkspaces(): Promise<string[]>;

  /** Delete a workspace's state */
  deleteWorkspace(workspace: string): Promise<void>;

  /** Acquire lock for workspace */
  lock(workspace: string, info: LockInfo): Promise<LockResult>;

  /** Release lock for workspace */
  unlock(workspace: string, lockId: string): Promise<void>;

  /** Check if backend is configured and accessible */
  isConfigured(): Promise<boolean>;
}

export interface LockInfo {
  id: string;
  operation: 'plan' | 'apply' | 'destroy' | 'import';
  who: string;
  created: string;
}

export interface LockResult {
  acquired: boolean;
  lockId?: string;
  existingLock?: LockInfo;
}
```

### 3.2 S3 Backend Implementation

```typescript
// packages/cli/src/commands/server/iac/backends/S3Backend.ts

import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { DynamoDBClient, PutItemCommand, DeleteItemCommand, GetItemCommand } from '@aws-sdk/client-dynamodb';
import type { StateBackend, LockInfo, LockResult } from './StateBackend.js';

export interface S3BackendConfig {
  bucket: string;
  region: string;
  key_prefix?: string;           // Default: 'gaib-state'
  dynamodb_table?: string;       // Default: 'gaib-locks'
  encrypt?: boolean;             // Default: true (SSE-S3)
  kms_key_id?: string;           // Optional KMS key for SSE-KMS
  role_arn?: string;             // Optional assume role
}

export class S3Backend implements StateBackend {
  private s3: S3Client;
  private dynamodb: DynamoDBClient;
  private config: Required<S3BackendConfig>;

  constructor(config: S3BackendConfig) {
    this.config = {
      key_prefix: 'gaib-state',
      dynamodb_table: 'gaib-locks',
      encrypt: true,
      kms_key_id: '',
      role_arn: '',
      ...config
    };

    this.s3 = new S3Client({ region: this.config.region });
    this.dynamodb = new DynamoDBClient({ region: this.config.region });
  }

  private stateKey(workspace: string): string {
    return `${this.config.key_prefix}/${workspace}/terraform.tfstate`;
  }

  async read(workspace: string): Promise<ServerState | null> {
    try {
      const response = await this.s3.send(new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: this.stateKey(workspace)
      }));

      const body = await response.Body?.transformToString();
      if (!body) return null;

      return JSON.parse(body) as ServerState;
    } catch (error: any) {
      if (error.name === 'NoSuchKey') return null;
      throw error;
    }
  }

  async write(workspace: string, state: ServerState): Promise<void> {
    const params: any = {
      Bucket: this.config.bucket,
      Key: this.stateKey(workspace),
      Body: JSON.stringify(state, null, 2),
      ContentType: 'application/json'
    };

    if (this.config.encrypt) {
      if (this.config.kms_key_id) {
        params.ServerSideEncryption = 'aws:kms';
        params.SSEKMSKeyId = this.config.kms_key_id;
      } else {
        params.ServerSideEncryption = 'AES256';
      }
    }

    await this.s3.send(new PutObjectCommand(params));
  }

  async lock(workspace: string, info: LockInfo): Promise<LockResult> {
    const lockKey = `${this.config.key_prefix}/${workspace}`;

    try {
      // Conditional put - only succeeds if lock doesn't exist
      await this.dynamodb.send(new PutItemCommand({
        TableName: this.config.dynamodb_table,
        Item: {
          LockID: { S: lockKey },
          Info: { S: JSON.stringify(info) }
        },
        ConditionExpression: 'attribute_not_exists(LockID)'
      }));

      return { acquired: true, lockId: info.id };
    } catch (error: any) {
      if (error.name === 'ConditionalCheckFailedException') {
        // Lock exists - fetch existing lock info
        const existing = await this.dynamodb.send(new GetItemCommand({
          TableName: this.config.dynamodb_table,
          Key: { LockID: { S: lockKey } }
        }));

        const existingInfo = existing.Item?.Info?.S
          ? JSON.parse(existing.Item.Info.S) as LockInfo
          : undefined;

        return { acquired: false, existingLock: existingInfo };
      }
      throw error;
    }
  }

  async unlock(workspace: string, lockId: string): Promise<void> {
    const lockKey = `${this.config.key_prefix}/${workspace}`;

    await this.dynamodb.send(new DeleteItemCommand({
      TableName: this.config.dynamodb_table,
      Key: { LockID: { S: lockKey } },
      ConditionExpression: 'Info.id = :lockId',
      ExpressionAttributeValues: {
        ':lockId': { S: lockId }
      }
    }));
  }

  async listWorkspaces(): Promise<string[]> {
    const response = await this.s3.send(new ListObjectsV2Command({
      Bucket: this.config.bucket,
      Prefix: this.config.key_prefix + '/',
      Delimiter: '/'
    }));

    return (response.CommonPrefixes || [])
      .map(p => p.Prefix?.replace(`${this.config.key_prefix}/`, '').replace('/', '') || '')
      .filter(Boolean);
  }

  async deleteWorkspace(workspace: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({
      Bucket: this.config.bucket,
      Key: this.stateKey(workspace)
    }));
  }

  async isConfigured(): Promise<boolean> {
    try {
      await this.s3.send(new ListObjectsV2Command({
        Bucket: this.config.bucket,
        MaxKeys: 1
      }));
      return true;
    } catch {
      return false;
    }
  }
}
```

### 3.3 Local Backend Implementation

```typescript
// packages/cli/src/commands/server/iac/backends/LocalBackend.ts

import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import type { StateBackend, LockInfo, LockResult } from './StateBackend.js';

export interface LocalBackendConfig {
  path: string;  // Directory for state files
}

export class LocalBackend implements StateBackend {
  private basePath: string;

  constructor(config: LocalBackendConfig) {
    this.basePath = config.path;
  }

  private statePath(workspace: string): string {
    return join(this.basePath, workspace, 'terraform.tfstate');
  }

  private lockPath(workspace: string): string {
    return join(this.basePath, workspace, '.terraform.lock');
  }

  async read(workspace: string): Promise<ServerState | null> {
    const path = this.statePath(workspace);
    if (!existsSync(path)) return null;

    const content = readFileSync(path, 'utf-8');
    return JSON.parse(content) as ServerState;
  }

  async write(workspace: string, state: ServerState): Promise<void> {
    const path = this.statePath(workspace);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(state, null, 2));
  }

  async lock(workspace: string, info: LockInfo): Promise<LockResult> {
    const path = this.lockPath(workspace);
    mkdirSync(dirname(path), { recursive: true });

    if (existsSync(path)) {
      const existing = JSON.parse(readFileSync(path, 'utf-8')) as LockInfo;
      return { acquired: false, existingLock: existing };
    }

    writeFileSync(path, JSON.stringify(info, null, 2));
    return { acquired: true, lockId: info.id };
  }

  async unlock(workspace: string, _lockId: string): Promise<void> {
    const path = this.lockPath(workspace);
    if (existsSync(path)) unlinkSync(path);
  }

  async listWorkspaces(): Promise<string[]> {
    if (!existsSync(this.basePath)) return ['default'];

    return readdirSync(this.basePath, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
  }

  async deleteWorkspace(workspace: string): Promise<void> {
    const statePath = this.statePath(workspace);
    const lockPath = this.lockPath(workspace);

    if (existsSync(statePath)) unlinkSync(statePath);
    if (existsSync(lockPath)) unlinkSync(lockPath);
  }

  async isConfigured(): Promise<boolean> {
    return true; // Local backend is always available
  }
}
```

### 3.4 Backend Factory

```typescript
// packages/cli/src/commands/server/iac/backends/BackendFactory.ts

import type { StateBackend } from './StateBackend.js';
import { S3Backend, type S3BackendConfig } from './S3Backend.js';
import { LocalBackend, type LocalBackendConfig } from './LocalBackend.js';

export type BackendConfig =
  | { type: 's3'; config: S3BackendConfig }
  | { type: 'local'; config: LocalBackendConfig };

export function createBackend(config: BackendConfig): StateBackend {
  switch (config.type) {
    case 's3':
      return new S3Backend(config.config);
    case 'local':
      return new LocalBackend(config.config);
    default:
      throw new Error(`Unknown backend type: ${(config as any).type}`);
  }
}

/**
 * Parse backend configuration from gaib.yaml
 */
export function parseBackendConfig(raw: any): BackendConfig {
  if (!raw?.backend) {
    // Default to local backend
    return {
      type: 'local',
      config: { path: '.gaib' }
    };
  }

  if (raw.backend.s3) {
    return {
      type: 's3',
      config: {
        bucket: raw.backend.s3.bucket,
        region: raw.backend.s3.region,
        key_prefix: raw.backend.s3.key_prefix,
        dynamodb_table: raw.backend.s3.dynamodb_table,
        encrypt: raw.backend.s3.encrypt,
        kms_key_id: raw.backend.s3.kms_key_id,
        role_arn: raw.backend.s3.role_arn
      }
    };
  }

  if (raw.backend.local) {
    return {
      type: 'local',
      config: { path: raw.backend.local.path || '.gaib' }
    };
  }

  throw new Error('Invalid backend configuration');
}
```

### 3.5 Workspace Manager

```typescript
// packages/cli/src/commands/server/iac/WorkspaceManager.ts

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { StateBackend } from './backends/StateBackend.js';

export interface WorkspaceConfig {
  current: string;
  workspaces: string[];
}

const WORKSPACE_FILE = '.gaib/workspace';
const DEFAULT_WORKSPACE = 'default';

export class WorkspaceManager {
  private backend: StateBackend;
  private projectRoot: string;

  constructor(backend: StateBackend, projectRoot: string = process.cwd()) {
    this.backend = backend;
    this.projectRoot = projectRoot;
  }

  private get configPath(): string {
    return join(this.projectRoot, WORKSPACE_FILE);
  }

  /**
   * Get current workspace name
   */
  async current(): Promise<string> {
    if (!existsSync(this.configPath)) {
      return DEFAULT_WORKSPACE;
    }

    const content = readFileSync(this.configPath, 'utf-8').trim();
    return content || DEFAULT_WORKSPACE;
  }

  /**
   * Select a workspace (create if doesn't exist)
   */
  async select(name: string, create: boolean = false): Promise<void> {
    const workspaces = await this.list();

    if (!workspaces.includes(name)) {
      if (!create) {
        throw new Error(`Workspace "${name}" does not exist. Use --create to create it.`);
      }
      // Workspace will be created on first state write
    }

    mkdirSync(join(this.projectRoot, '.gaib'), { recursive: true });
    writeFileSync(this.configPath, name);
  }

  /**
   * List all workspaces
   */
  async list(): Promise<string[]> {
    const workspaces = await this.backend.listWorkspaces();

    // Always include 'default'
    if (!workspaces.includes(DEFAULT_WORKSPACE)) {
      workspaces.unshift(DEFAULT_WORKSPACE);
    }

    return workspaces;
  }

  /**
   * Create a new workspace
   */
  async create(name: string): Promise<void> {
    const workspaces = await this.list();

    if (workspaces.includes(name)) {
      throw new Error(`Workspace "${name}" already exists`);
    }

    // Initialize empty state in new workspace
    await this.backend.write(name, {
      version: 1,
      serial: 0,
      lineage: this.generateLineage(),
      terraform_version: '2.0.0',
      resources: []
    });
  }

  /**
   * Delete a workspace
   */
  async delete(name: string): Promise<void> {
    if (name === DEFAULT_WORKSPACE) {
      throw new Error('Cannot delete the default workspace');
    }

    const current = await this.current();
    if (current === name) {
      throw new Error('Cannot delete the currently selected workspace');
    }

    // Check if workspace has resources
    const state = await this.backend.read(name);
    if (state && state.resources && state.resources.length > 0) {
      throw new Error(`Workspace "${name}" is not empty. Run 'gaib destroy' first.`);
    }

    await this.backend.deleteWorkspace(name);
  }

  /**
   * Show workspace details
   */
  async show(name?: string): Promise<WorkspaceInfo> {
    const workspace = name || await this.current();
    const state = await this.backend.read(workspace);

    return {
      name: workspace,
      isCurrent: workspace === await this.current(),
      resourceCount: state?.resources?.length || 0,
      serial: state?.serial || 0,
      lastModified: state?.last_modified
    };
  }

  private generateLineage(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

export interface WorkspaceInfo {
  name: string;
  isCurrent: boolean;
  resourceCount: number;
  serial: number;
  lastModified?: string;
}
```

---

## 4. Data Models

### 4.1 Configuration Schema (Extended)

```typescript
// packages/cli/src/commands/server/iac/schemas.ts (additions)

import { z } from 'zod';

/**
 * Backend configuration for remote state
 */
export const S3BackendSchema = z.object({
  bucket: z.string().describe('S3 bucket name'),
  region: z.string().describe('AWS region'),
  key_prefix: z.string().default('gaib-state').describe('S3 key prefix'),
  dynamodb_table: z.string().default('gaib-locks').describe('DynamoDB table for locking'),
  encrypt: z.boolean().default(true).describe('Enable server-side encryption'),
  kms_key_id: z.string().optional().describe('KMS key for SSE-KMS'),
  role_arn: z.string().optional().describe('IAM role to assume')
});

export const LocalBackendSchema = z.object({
  path: z.string().default('.gaib').describe('Local directory for state')
});

export const BackendSchema = z.object({
  s3: S3BackendSchema.optional(),
  local: LocalBackendSchema.optional()
}).refine(
  (data) => Object.keys(data).filter(k => data[k as keyof typeof data]).length <= 1,
  { message: 'Only one backend type can be configured' }
);

/**
 * Theme reference configuration
 */
export const ThemeReferenceSchema = z.object({
  name: z.string().describe('Theme name'),
  version: z.string().optional().describe('Theme version constraint'),
  source: z.enum(['local', 'registry', 'git']).default('registry'),
  path: z.string().optional().describe('Path for local themes'),
  repository: z.string().optional().describe('Git repository URL'),
  ref: z.string().optional().describe('Git ref (branch/tag/commit)')
});

/**
 * Variable definitions for parameterization
 */
export const VariableDefinitionSchema = z.object({
  description: z.string().optional(),
  type: z.enum(['string', 'number', 'boolean', 'list']).default('string'),
  default: z.any().optional(),
  sensitive: z.boolean().default(false)
});

/**
 * Extended server configuration with new features
 */
export const ExtendedServerConfigSchema = z.object({
  // Metadata
  version: z.literal('2.0').describe('Config schema version'),

  // Backend configuration (new)
  backend: BackendSchema.optional(),

  // Theme reference (new)
  theme: ThemeReferenceSchema.optional(),

  // Variables for parameterization (new)
  variables: z.record(VariableDefinitionSchema).optional(),

  // Server configuration (existing, extended)
  server: z.object({
    name: z.string().max(100),
    description: z.string().max(1000).optional(),
    icon: z.string().url().optional(),
    verification_level: z.enum(['none', 'low', 'medium', 'high', 'very_high']).optional(),
    default_notifications: z.enum(['all_messages', 'only_mentions']).optional(),
    explicit_content_filter: z.enum(['disabled', 'members_without_roles', 'all_members']).optional(),

    // Feature flags (new)
    features: z.object({
      community: z.boolean().default(false),
      discoverable: z.boolean().default(false),
      welcome_screen: z.boolean().default(false)
    }).optional()
  }),

  // Existing schemas
  roles: z.array(z.any()).optional(),  // RoleConfigSchema
  categories: z.array(z.any()).optional(),  // CategoryConfigSchema
  channels: z.array(z.any()).optional(),  // ChannelConfigSchema

  // Lifecycle hooks (new)
  hooks: z.object({
    pre_apply: z.array(z.string()).optional(),
    post_apply: z.array(z.string()).optional(),
    pre_destroy: z.array(z.string()).optional(),
    post_destroy: z.array(z.string()).optional()
  }).optional()
});

export type ExtendedServerConfig = z.infer<typeof ExtendedServerConfigSchema>;
```

### 4.2 State Schema (Extended)

```typescript
// packages/cli/src/commands/server/iac/types.ts (additions)

/**
 * Extended state format with workspace support
 */
export interface ExtendedServerState {
  version: number;                    // State format version
  serial: number;                     // Incrementing serial for conflict detection
  lineage: string;                    // Unique ID for state lineage
  terraform_version: string;          // Gaib version that wrote the state

  // Workspace metadata
  workspace?: string;

  // Backend info (for state show)
  backend?: {
    type: string;
    config: Record<string, any>;
  };

  // Resources (existing)
  resources: ResourceState[];

  // Outputs (new)
  outputs?: Record<string, OutputValue>;

  // Checksums for drift detection (new)
  checksums?: {
    config: string;                   // Hash of config file
    state: string;                    // Hash of state content
  };

  // Timestamps
  created?: string;
  last_modified?: string;
}

export interface ResourceState {
  type: 'discord_server' | 'discord_role' | 'discord_category' | 'discord_channel';
  name: string;                       // Logical name from config
  provider: 'discord';

  instances: ResourceInstance[];
}

export interface ResourceInstance {
  schema_version: number;
  attributes: Record<string, any>;    // Actual resource attributes

  // Dependencies (new)
  dependencies?: string[];            // e.g., ["discord_role.admin"]

  // Sensitive values tracking (new)
  sensitive_attributes?: string[];

  // Private metadata (new)
  private?: string;                   // Base64 encoded provider-specific data
}

export interface OutputValue {
  value: any;
  type: string;
  sensitive?: boolean;
}
```

### 4.3 Plan Schema

```typescript
// packages/cli/src/commands/server/iac/types.ts (additions)

/**
 * Execution plan for apply/destroy operations
 */
export interface ExecutionPlan {
  version: number;

  // Plan metadata
  timestamp: string;
  workspace: string;
  command: 'apply' | 'destroy';

  // Configuration hash for staleness detection
  config_hash: string;

  // Resource changes
  resource_changes: ResourceChange[];

  // Output changes
  output_changes?: OutputChange[];

  // Summary
  summary: {
    add: number;
    change: number;
    destroy: number;
  };

  // Warnings
  warnings?: string[];
}

export interface ResourceChange {
  address: string;                    // e.g., "discord_role.admin"
  type: string;
  name: string;

  change: {
    actions: ('create' | 'update' | 'delete' | 'no-op' | 'read')[];
    before: Record<string, any> | null;
    after: Record<string, any> | null;
    after_unknown?: Record<string, boolean>;
  };
}

export interface OutputChange {
  name: string;
  change: {
    actions: ('create' | 'update' | 'delete' | 'no-op')[];
    before: any;
    after: any;
    sensitive?: boolean;
  };
}
```

---

## 5. State Management

### 5.1 State Lifecycle

```
+-------------+     +-------------+     +-------------+     +-------------+
|    init     |---->|    plan     |---->|    apply    |---->|   verify    |
+-------------+     +-------------+     +-------------+     +-------------+
                           |                   |
                           v                   v
                    +-------------+     +-------------+
                    | Plan File   |     |   State     |
                    | (optional)  |     |  (updated)  |
                    +-------------+     +-------------+
```

### 5.2 Locking Protocol

```typescript
// packages/cli/src/commands/server/iac/StateLock.ts

import { randomUUID } from 'crypto';
import { hostname, userInfo } from 'os';
import type { StateBackend, LockInfo, LockResult } from './backends/StateBackend.js';

export class StateLock {
  private backend: StateBackend;
  private lockId: string | null = null;
  private workspace: string;

  constructor(backend: StateBackend, workspace: string) {
    this.backend = backend;
    this.workspace = workspace;
  }

  /**
   * Acquire lock with retry
   */
  async acquire(operation: LockInfo['operation']): Promise<void> {
    const info: LockInfo = {
      id: randomUUID(),
      operation,
      who: `${userInfo().username}@${hostname()}`,
      created: new Date().toISOString()
    };

    const result = await this.backend.lock(this.workspace, info);

    if (!result.acquired) {
      const existing = result.existingLock;
      throw new StateLockError(
        `Error acquiring lock. Lock held by ${existing?.who} since ${existing?.created}.\n` +
        `Operation: ${existing?.operation}\n` +
        `Lock ID: ${existing?.id}\n\n` +
        `If you believe this lock is stale, you can force-unlock with:\n` +
        `  gaib force-unlock ${existing?.id}`
      );
    }

    this.lockId = result.lockId!;
  }

  /**
   * Release lock
   */
  async release(): Promise<void> {
    if (this.lockId) {
      await this.backend.unlock(this.workspace, this.lockId);
      this.lockId = null;
    }
  }

  /**
   * Force unlock (admin operation)
   */
  async forceUnlock(lockId: string): Promise<void> {
    await this.backend.unlock(this.workspace, lockId);
  }
}

export class StateLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StateLockError';
  }
}
```

### 5.3 State Operations Flow

```
+----------------------------------------------------------------------------+
|                           Apply Operation Flow                              |
+----------------------------------------------------------------------------+

1. Parse Config
   gaib.yaml --> ConfigParser --> ExtendedServerConfig

2. Acquire Lock
   StateLock.acquire('apply') --> DynamoDB conditional put

3. Read Current State
   StateBackend.read(workspace) --> S3 GetObject --> ExtendedServerState

4. Read Discord State
   StateReader.fetchState() --> Discord API --> ServerState

5. Compute Diff
   DiffEngine.diff(config, current) --> ResourceChange[]

6. Generate Plan
   PlanEngine.plan(changes) --> ExecutionPlan

7. User Confirmation (unless --auto-approve)
   Display plan --> Prompt Y/N

8. Apply Changes
   ApplyEngine.apply(plan) --> Discord API mutations

9. Update State
   StateBackend.write(workspace, newState) --> S3 PutObject

10. Release Lock
    StateLock.release() --> DynamoDB DeleteItem

11. Output Summary
    Display results
```

---

## 6. CLI Command Design

### 6.1 Command Tree

```
gaib
|-- init                    # Initialize configuration
|-- plan                    # Generate execution plan
|-- apply                   # Apply changes to Discord
|-- destroy                 # Destroy managed resources
|-- import                  # Import existing resources
|-- diff                    # Show differences (quick)
|-- export                  # Export server to config
|
|-- state                   # State management
|   |-- list                # List resources in state
|   |-- show <address>      # Show resource details
|   |-- rm <address>        # Remove from state (not Discord)
|   |-- mv <src> <dst>      # Rename resource in state
|   +-- pull                # Refresh state from Discord
|
|-- workspace               # Workspace management
|   |-- list                # List workspaces
|   |-- new <name>          # Create workspace
|   |-- select <name>       # Switch workspace
|   |-- show [name]         # Show workspace details
|   +-- delete <name>       # Delete workspace
|
|-- theme                   # Theme management
|   |-- list                # List available themes
|   |-- info <name>         # Show theme details
|   |-- install <name>      # Install from registry
|   +-- create              # Create new theme
|
|-- force-unlock <id>       # Force release a lock
|-- validate                # Validate configuration
+-- version                 # Show version info
```

### 6.2 Apply Command Implementation

```typescript
// packages/cli/src/commands/server/apply.ts

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { confirm } from '@inquirer/prompts';
import { parseConfigFile } from './iac/ConfigParser.js';
import { createBackend, parseBackendConfig } from './iac/backends/BackendFactory.js';
import { WorkspaceManager } from './iac/WorkspaceManager.js';
import { StateLock } from './iac/StateLock.js';
import { StateReader } from './iac/StateReader.js';
import { DiffEngine } from './iac/DiffEngine.js';
import { ApplyEngine } from './iac/ApplyEngine.js';
import { formatPlan, formatApplyResult } from './iac/formatters.js';

export function registerApplyCommand(parent: Command): void {
  parent
    .command('apply')
    .description('Apply configuration changes to Discord server')
    .option('-c, --config <path>', 'Path to configuration file', 'gaib.yaml')
    .option('--auto-approve', 'Skip interactive approval')
    .option('--parallelism <n>', 'Limit concurrent operations', '10')
    .option('--target <address...>', 'Target specific resources')
    .option('--refresh-only', 'Only refresh state, no changes')
    .option('--plan <path>', 'Use existing plan file')
    .option('--lock-timeout <duration>', 'Lock wait timeout', '5m')
    .action(async (options) => {
      const spinner = ora();
      let lock: StateLock | null = null;

      try {
        // 1. Load configuration
        spinner.start('Loading configuration...');
        const config = await parseConfigFile(options.config);
        spinner.succeed('Configuration loaded');

        // 2. Initialize backend and workspace
        const backendConfig = parseBackendConfig(config);
        const backend = createBackend(backendConfig);
        const workspaceManager = new WorkspaceManager(backend);
        const workspace = await workspaceManager.current();

        console.log(chalk.dim(`Workspace: ${workspace}`));

        // 3. Acquire lock
        spinner.start('Acquiring state lock...');
        lock = new StateLock(backend, workspace);
        await lock.acquire('apply');
        spinner.succeed('State lock acquired');

        // 4. Read states
        spinner.start('Reading current state...');
        const [savedState, discordState] = await Promise.all([
          backend.read(workspace),
          new StateReader(config.server.id).fetchState()
        ]);
        spinner.succeed('State refreshed');

        // 5. Compute plan
        spinner.start('Computing changes...');
        const diff = new DiffEngine(config, discordState, savedState);
        const plan = diff.generatePlan();
        spinner.succeed('Plan computed');

        // 6. Display plan
        console.log('\n' + formatPlan(plan));

        // 7. Check if there are changes
        if (plan.summary.add === 0 && plan.summary.change === 0 && plan.summary.destroy === 0) {
          console.log(chalk.green('\nNo changes. Infrastructure is up-to-date.'));
          await lock.release();
          return;
        }

        // 8. Confirm unless auto-approve
        if (!options.autoApprove) {
          const proceed = await confirm({
            message: `Do you want to perform these actions in workspace "${workspace}"?`,
            default: false
          });

          if (!proceed) {
            console.log(chalk.yellow('\nApply cancelled.'));
            await lock.release();
            return;
          }
        }

        // 9. Apply changes
        console.log('\n' + chalk.bold('Applying changes...'));
        const applyEngine = new ApplyEngine({
          parallelism: parseInt(options.parallelism, 10),
          targets: options.target
        });

        const result = await applyEngine.apply(plan, (progress) => {
          console.log(`  ${progress.status === 'success' ? chalk.green('[ok]') : chalk.red('[x]')} ${progress.address}`);
        });

        // 10. Update state
        spinner.start('Updating state...');
        await backend.write(workspace, result.newState);
        spinner.succeed('State saved');

        // 11. Release lock
        await lock.release();
        lock = null;

        // 12. Display summary
        console.log('\n' + formatApplyResult(result));

        if (result.errors.length > 0) {
          process.exit(1);
        }

      } catch (error) {
        spinner.fail();

        if (lock) {
          try {
            await lock.release();
          } catch {}
        }

        if (error instanceof Error) {
          console.error(chalk.red(`\nError: ${error.message}`));
        }
        process.exit(1);
      }
    });
}
```

### 6.3 Destroy Command Implementation

```typescript
// packages/cli/src/commands/server/destroy.ts

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { confirm, input } from '@inquirer/prompts';
import { createBackend, parseBackendConfig } from './iac/backends/BackendFactory.js';
import { WorkspaceManager } from './iac/WorkspaceManager.js';
import { StateLock } from './iac/StateLock.js';
import { DestroyEngine } from './iac/DestroyEngine.js';

export function registerDestroyCommand(parent: Command): void {
  parent
    .command('destroy')
    .description('Destroy all managed resources in Discord server')
    .option('-c, --config <path>', 'Path to configuration file', 'gaib.yaml')
    .option('--auto-approve', 'Skip interactive approval (DANGEROUS)')
    .option('--target <address...>', 'Target specific resources')
    .option('--force', 'Force destroy even if state is inconsistent')
    .action(async (options) => {
      const spinner = ora();
      let lock: StateLock | null = null;

      try {
        // 1. Load configuration
        spinner.start('Loading configuration...');
        const config = await parseConfigFile(options.config);
        spinner.succeed('Configuration loaded');

        // 2. Initialize backend and workspace
        const backendConfig = parseBackendConfig(config);
        const backend = createBackend(backendConfig);
        const workspaceManager = new WorkspaceManager(backend);
        const workspace = await workspaceManager.current();

        // 3. Read state
        spinner.start('Reading state...');
        const state = await backend.read(workspace);
        spinner.succeed();

        if (!state || state.resources.length === 0) {
          console.log(chalk.yellow('\nNo managed resources found in state.'));
          return;
        }

        // 4. Display what will be destroyed
        console.log(chalk.red.bold('\n!! DESTRUCTION PLAN'));
        console.log(chalk.red('The following resources will be PERMANENTLY DELETED:\n'));

        for (const resource of state.resources) {
          console.log(chalk.red(`  - ${resource.type}.${resource.name}`));
        }

        console.log(chalk.red(`\n  Total: ${state.resources.length} resources`));

        // 5. Safety confirmation
        if (!options.autoApprove) {
          console.log(chalk.yellow('\n!! This action CANNOT be undone.'));

          const serverName = config.server.name;
          const typed = await input({
            message: `Type "${serverName}" to confirm destruction:`,
          });

          if (typed !== serverName) {
            console.log(chalk.yellow('\nDestroy cancelled.'));
            return;
          }

          const finalConfirm = await confirm({
            message: 'Are you ABSOLUTELY sure?',
            default: false
          });

          if (!finalConfirm) {
            console.log(chalk.yellow('\nDestroy cancelled.'));
            return;
          }
        }

        // 6. Acquire lock
        spinner.start('Acquiring state lock...');
        lock = new StateLock(backend, workspace);
        await lock.acquire('destroy');
        spinner.succeed('State lock acquired');

        // 7. Execute destroy
        console.log(chalk.red.bold('\nDestroying resources...'));

        const destroyEngine = new DestroyEngine({
          targets: options.target,
          force: options.force
        });

        const result = await destroyEngine.destroy(state, config, (progress) => {
          const icon = progress.status === 'success' ? chalk.red('[x]') : chalk.yellow('[!]');
          console.log(`  ${icon} Destroyed ${progress.address}`);
        });

        // 8. Clear state
        spinner.start('Clearing state...');
        await backend.write(workspace, {
          ...state,
          resources: result.remainingResources,
          serial: state.serial + 1,
          last_modified: new Date().toISOString()
        });
        spinner.succeed('State updated');

        // 9. Release lock
        await lock.release();
        lock = null;

        // 10. Summary
        console.log(chalk.red.bold(`\nDestroyed ${result.destroyedCount} resources.`));

        if (result.errors.length > 0) {
          console.log(chalk.yellow(`\n${result.errors.length} resources could not be destroyed:`));
          for (const err of result.errors) {
            console.log(chalk.yellow(`  - ${err.address}: ${err.message}`));
          }
          process.exit(1);
        }

      } catch (error) {
        spinner.fail();

        if (lock) {
          try { await lock.release(); } catch {}
        }

        if (error instanceof Error) {
          console.error(chalk.red(`\nError: ${error.message}`));
        }
        process.exit(1);
      }
    });
}
```

### 6.4 Import Command Implementation

```typescript
// packages/cli/src/commands/server/import.ts

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { createBackend, parseBackendConfig } from './iac/backends/BackendFactory.js';
import { WorkspaceManager } from './iac/WorkspaceManager.js';
import { StateLock } from './iac/StateLock.js';
import { DiscordClient } from './iac/DiscordClient.js';

export function registerImportCommand(parent: Command): void {
  parent
    .command('import <address> <id>')
    .description('Import an existing Discord resource into state')
    .option('-c, --config <path>', 'Path to configuration file', 'gaib.yaml')
    .addHelpText('after', `
Examples:
  gaib import discord_role.admin 123456789012345678
  gaib import discord_channel.general 987654321098765432
  gaib import discord_category.voice 456789012345678901

Resource Types:
  discord_server    - The Discord server itself
  discord_role      - A role in the server
  discord_category  - A channel category
  discord_channel   - A text or voice channel
`)
    .action(async (address: string, id: string, options) => {
      const spinner = ora();
      let lock: StateLock | null = null;

      try {
        // Parse address
        const [type, name] = address.split('.');
        if (!type || !name) {
          throw new Error(`Invalid address format: ${address}. Expected: resource_type.name`);
        }

        const validTypes = ['discord_server', 'discord_role', 'discord_category', 'discord_channel'];
        if (!validTypes.includes(type)) {
          throw new Error(`Unknown resource type: ${type}. Valid types: ${validTypes.join(', ')}`);
        }

        // Load configuration
        spinner.start('Loading configuration...');
        const config = await parseConfigFile(options.config);
        spinner.succeed();

        // Initialize backend
        const backendConfig = parseBackendConfig(config);
        const backend = createBackend(backendConfig);
        const workspaceManager = new WorkspaceManager(backend);
        const workspace = await workspaceManager.current();

        // Acquire lock
        spinner.start('Acquiring state lock...');
        lock = new StateLock(backend, workspace);
        await lock.acquire('import');
        spinner.succeed();

        // Read current state
        spinner.start('Reading state...');
        const state = await backend.read(workspace) || {
          version: 1,
          serial: 0,
          lineage: `${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 9)}`,
          terraform_version: '2.0.0',
          resources: []
        };
        spinner.succeed();

        // Check if resource already exists in state
        const existingIndex = state.resources.findIndex(
          r => r.type === type && r.name === name
        );

        if (existingIndex !== -1) {
          throw new Error(`Resource ${address} already exists in state. Remove it first with: gaib state rm ${address}`);
        }

        // Fetch resource from Discord
        spinner.start(`Fetching ${type} ${id} from Discord...`);
        const client = new DiscordClient(config.server.id);
        const resource = await client.fetchResource(type, id);
        spinner.succeed(`Found: ${resource.name || id}`);

        // Add to state
        state.resources.push({
          type: type as any,
          name,
          provider: 'discord',
          instances: [{
            schema_version: 1,
            attributes: {
              id,
              ...resource
            }
          }]
        });

        state.serial += 1;
        state.last_modified = new Date().toISOString();

        // Save state
        spinner.start('Saving state...');
        await backend.write(workspace, state);
        spinner.succeed();

        // Release lock
        await lock.release();
        lock = null;

        console.log(chalk.green(`\n[ok] Imported ${address} (ID: ${id})`));
        console.log(chalk.dim(`\nRemember to add the corresponding configuration to gaib.yaml`));

      } catch (error) {
        spinner.fail();

        if (lock) {
          try { await lock.release(); } catch {}
        }

        if (error instanceof Error) {
          console.error(chalk.red(`\nError: ${error.message}`));
        }
        process.exit(1);
      }
    });
}
```

### 6.5 Workspace Commands

```typescript
// packages/cli/src/commands/server/workspace.ts

import { Command } from 'commander';
import chalk from 'chalk';
import { createBackend, parseBackendConfig } from './iac/backends/BackendFactory.js';
import { WorkspaceManager } from './iac/WorkspaceManager.js';

export function registerWorkspaceCommand(parent: Command): void {
  const workspace = parent
    .command('workspace')
    .description('Manage workspaces for environment isolation');

  // workspace list
  workspace
    .command('list')
    .description('List all workspaces')
    .action(async () => {
      const config = await parseConfigFile('gaib.yaml').catch(() => ({}));
      const backendConfig = parseBackendConfig(config);
      const backend = createBackend(backendConfig);
      const manager = new WorkspaceManager(backend);

      const current = await manager.current();
      const workspaces = await manager.list();

      console.log(chalk.bold('Workspaces:\n'));
      for (const ws of workspaces) {
        const marker = ws === current ? chalk.green('* ') : '  ';
        console.log(`${marker}${ws}`);
      }
    });

  // workspace new
  workspace
    .command('new <name>')
    .description('Create a new workspace')
    .action(async (name: string) => {
      const config = await parseConfigFile('gaib.yaml').catch(() => ({}));
      const backendConfig = parseBackendConfig(config);
      const backend = createBackend(backendConfig);
      const manager = new WorkspaceManager(backend);

      await manager.create(name);
      await manager.select(name);

      console.log(chalk.green(`Created and switched to workspace "${name}"`));
    });

  // workspace select
  workspace
    .command('select <name>')
    .description('Switch to a workspace')
    .option('--create', 'Create workspace if it does not exist')
    .action(async (name: string, options) => {
      const config = await parseConfigFile('gaib.yaml').catch(() => ({}));
      const backendConfig = parseBackendConfig(config);
      const backend = createBackend(backendConfig);
      const manager = new WorkspaceManager(backend);

      await manager.select(name, options.create);

      console.log(chalk.green(`Switched to workspace "${name}"`));
    });

  // workspace show
  workspace
    .command('show [name]')
    .description('Show workspace details')
    .action(async (name?: string) => {
      const config = await parseConfigFile('gaib.yaml').catch(() => ({}));
      const backendConfig = parseBackendConfig(config);
      const backend = createBackend(backendConfig);
      const manager = new WorkspaceManager(backend);

      const info = await manager.show(name);

      console.log(chalk.bold(`Workspace: ${info.name}`));
      console.log(`  Current: ${info.isCurrent ? chalk.green('yes') : 'no'}`);
      console.log(`  Resources: ${info.resourceCount}`);
      console.log(`  Serial: ${info.serial}`);
      if (info.lastModified) {
        console.log(`  Last Modified: ${info.lastModified}`);
      }
    });

  // workspace delete
  workspace
    .command('delete <name>')
    .description('Delete a workspace')
    .option('--force', 'Delete even if not empty')
    .action(async (name: string, options) => {
      const config = await parseConfigFile('gaib.yaml').catch(() => ({}));
      const backendConfig = parseBackendConfig(config);
      const backend = createBackend(backendConfig);
      const manager = new WorkspaceManager(backend);

      await manager.delete(name);

      console.log(chalk.yellow(`Deleted workspace "${name}"`));
    });
}
```

---

## 7. Theme System

### 7.1 Theme Structure

```
themes/
|-- sietch/                       # Built-in reference theme
|   |-- theme.yaml                # Theme manifest
|   |-- server.yaml               # Server configuration
|   |-- roles.yaml                # Role definitions
|   |-- channels.yaml             # Channel structure
|   +-- README.md                 # Documentation
|
+-- custom/                       # User themes
    +-- my-theme/
        |-- theme.yaml
        +-- ...
```

### 7.2 Theme Manifest Schema

```typescript
// packages/cli/src/commands/server/themes/ThemeSchema.ts

import { z } from 'zod';

export const ThemeManifestSchema = z.object({
  name: z.string(),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  description: z.string(),
  author: z.string().optional(),
  license: z.string().default('MIT'),

  // Minimum Gaib version required
  gaib_version: z.string().optional(),

  // Theme variables that can be customized
  variables: z.record(z.object({
    description: z.string(),
    type: z.enum(['string', 'number', 'boolean', 'color', 'emoji']),
    default: z.any(),
    required: z.boolean().default(false)
  })).optional(),

  // Files that make up this theme
  files: z.object({
    server: z.string().default('server.yaml'),
    roles: z.string().default('roles.yaml'),
    channels: z.string().default('channels.yaml')
  }).optional(),

  // Dependencies on other themes
  extends: z.string().optional(),

  // Tags for discovery
  tags: z.array(z.string()).optional()
});

export type ThemeManifest = z.infer<typeof ThemeManifestSchema>;
```

### 7.3 Theme Loader

```typescript
// packages/cli/src/commands/server/themes/ThemeLoader.ts

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import * as yaml from 'yaml';
import { ThemeManifestSchema, type ThemeManifest } from './ThemeSchema.js';
import type { ExtendedServerConfig } from '../iac/schemas.js';

export interface ThemeSource {
  type: 'local' | 'registry' | 'git';
  path?: string;
  repository?: string;
  ref?: string;
}

export class ThemeLoader {
  private cache = new Map<string, LoadedTheme>();

  /**
   * Load a theme from source
   */
  async load(name: string, source: ThemeSource, variables?: Record<string, any>): Promise<LoadedTheme> {
    const cacheKey = `${source.type}:${name}`;

    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    let themePath: string;

    switch (source.type) {
      case 'local':
        themePath = source.path || join('themes', name);
        break;
      case 'registry':
        themePath = await this.downloadFromRegistry(name);
        break;
      case 'git':
        themePath = await this.cloneFromGit(source.repository!, source.ref);
        break;
    }

    const theme = await this.loadFromPath(themePath, variables);
    this.cache.set(cacheKey, theme);

    return theme;
  }

  /**
   * Load theme from filesystem path
   */
  private async loadFromPath(themePath: string, variables?: Record<string, any>): Promise<LoadedTheme> {
    const manifestPath = join(themePath, 'theme.yaml');

    if (!existsSync(manifestPath)) {
      throw new Error(`Theme manifest not found: ${manifestPath}`);
    }

    const manifestContent = readFileSync(manifestPath, 'utf-8');
    const manifest = ThemeManifestSchema.parse(yaml.parse(manifestContent));

    // Resolve variables with defaults
    const resolvedVars = this.resolveVariables(manifest, variables);

    // Load component files
    const files = manifest.files || {};
    const serverConfig = this.loadAndInterpolate(
      join(themePath, files.server || 'server.yaml'),
      resolvedVars
    );
    const rolesConfig = this.loadAndInterpolate(
      join(themePath, files.roles || 'roles.yaml'),
      resolvedVars
    );
    const channelsConfig = this.loadAndInterpolate(
      join(themePath, files.channels || 'channels.yaml'),
      resolvedVars
    );

    return {
      manifest,
      config: {
        server: serverConfig,
        roles: rolesConfig.roles || [],
        categories: channelsConfig.categories || [],
        channels: channelsConfig.channels || []
      },
      variables: resolvedVars
    };
  }

  /**
   * Resolve variables with defaults and validation
   */
  private resolveVariables(
    manifest: ThemeManifest,
    provided?: Record<string, any>
  ): Record<string, any> {
    const resolved: Record<string, any> = {};
    const varDefs = manifest.variables || {};

    for (const [name, def] of Object.entries(varDefs)) {
      if (provided && name in provided) {
        resolved[name] = provided[name];
      } else if ('default' in def) {
        resolved[name] = def.default;
      } else if (def.required) {
        throw new Error(`Required theme variable missing: ${name}`);
      }
    }

    return resolved;
  }

  /**
   * Load YAML file and interpolate variables
   */
  private loadAndInterpolate(path: string, variables: Record<string, any>): any {
    if (!existsSync(path)) {
      return {};
    }

    let content = readFileSync(path, 'utf-8');

    // Interpolate ${var} syntax
    content = content.replace(/\$\{(\w+)\}/g, (_, name) => {
      if (name in variables) {
        return String(variables[name]);
      }
      return `\${${name}}`;
    });

    return yaml.parse(content);
  }

  /**
   * Download theme from registry
   */
  private async downloadFromRegistry(name: string): Promise<string> {
    // TODO: Implement registry download
    throw new Error('Registry themes not yet implemented');
  }

  /**
   * Clone theme from git repository
   */
  private async cloneFromGit(repository: string, ref?: string): Promise<string> {
    // TODO: Implement git clone
    throw new Error('Git themes not yet implemented');
  }
}

export interface LoadedTheme {
  manifest: ThemeManifest;
  config: Partial<ExtendedServerConfig>;
  variables: Record<string, any>;
}
```

### 7.4 Sietch Theme (Reference Implementation)

```yaml
# themes/sietch/theme.yaml
name: sietch
version: 1.0.0
description: THJ community server template - Dune-inspired crypto DAO structure
author: The Honey Jar
license: MIT

variables:
  community_name:
    description: Name of your community
    type: string
    default: "My Community"

  primary_color:
    description: Primary brand color (hex)
    type: color
    default: "#F59E0B"

  welcome_emoji:
    description: Emoji for welcome messages
    type: emoji
    default: "wave"

tags:
  - crypto
  - dao
  - community
```

```yaml
# themes/sietch/roles.yaml
roles:
  # Leadership
  - name: Naib
    color: "#F59E0B"
    permissions:
      - administrator
    hoist: true
    mentionable: false

  - name: Sayyadina
    color: "#EAB308"
    permissions:
      - manage_channels
      - manage_roles
      - manage_messages
      - kick_members
      - ban_members
    hoist: true

  # Community tiers
  - name: Fedaykin
    color: "#84CC16"
    permissions:
      - send_messages
      - embed_links
      - attach_files
      - add_reactions
      - use_external_emojis
      - connect
      - speak
    hoist: true

  - name: Fremen
    color: "#22C55E"
    permissions:
      - send_messages
      - add_reactions
      - connect
      - speak
    hoist: true

  - name: Pilgrim
    color: "#6B7280"
    permissions:
      - view_channel
      - read_message_history
    hoist: false

  # Bot role
  - name: Shai-Hulud
    color: "#F97316"
    permissions:
      - send_messages
      - embed_links
      - manage_messages
    bot_managed: true
```

```yaml
# themes/sietch/channels.yaml
categories:
  - name: "${community_name} HQ"
    channels:
      - name: "rules"
        type: text
        topic: "Community guidelines and rules"
        permissions:
          Pilgrim:
            - view_channel
            - read_message_history
          "@everyone":
            deny:
              - send_messages

      - name: "welcome"
        type: text
        topic: "Welcome new members!"

      - name: "announcements"
        type: text
        topic: "Official announcements"
        permissions:
          "@everyone":
            deny:
              - send_messages
          Sayyadina:
            - send_messages

  - name: "General"
    channels:
      - name: "general-chat"
        type: text
        topic: "Main community chat"

      - name: "memes"
        type: text
        topic: "Share your best memes"
        slowmode: 10

  - name: "Voice"
    channels:
      - name: "Voice Lounge"
        type: voice
        user_limit: 10

      - name: "AFK"
        type: voice
        user_limit: 0
```

---

## 8. Security Design

### 8.1 Authentication Flow

```
+-------------------------------------------------------------------------+
|                        Authentication Sources                            |
+-------------------------------------------------------------------------+
|                                                                          |
|  +--------------+   +--------------+   +--------------+                 |
|  | Environment  |   |   Config     |   |  Secrets     |                 |
|  |  Variables   |   |    File      |   |  Manager     |                 |
|  +------+-------+   +------+-------+   +------+-------+                 |
|         |                  |                   |                         |
|         +------------+-----+-------------------+                         |
|                      |                                                    |
|               +------v------+                                            |
|               |  Credential |                                            |
|               |   Resolver  |                                            |
|               +------+------+                                            |
|                      |                                                    |
|         +------------+------------+                                      |
|         |            |            |                                      |
|   +-----v-----+ +----v----+ +----v-----+                                |
|   |  Discord  | |   AWS   | |  Vault   |                                |
|   |   Token   | |  Creds  | |  Token   |                                |
|   +-----------+ +---------+ +----------+                                |
|                                                                          |
+--------------------------------------------------------------------------+
```

### 8.2 Credential Resolution Order

```typescript
// packages/cli/src/commands/server/iac/CredentialResolver.ts

export interface Credentials {
  discord: {
    token: string;
    applicationId?: string;
  };
  aws?: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
    region: string;
  };
}

export class CredentialResolver {
  /**
   * Resolve credentials from multiple sources.
   * Priority: Environment > Config > Secrets Manager > Interactive
   */
  async resolve(config: any): Promise<Credentials> {
    // Discord token
    const discordToken =
      process.env.DISCORD_TOKEN ||
      config.credentials?.discord?.token ||
      await this.fromVault('discord/token') ||
      await this.promptForToken();

    // AWS credentials (for S3 backend)
    let aws: Credentials['aws'];

    if (config.backend?.s3) {
      // AWS SDK will auto-resolve from:
      // 1. Environment (AWS_ACCESS_KEY_ID, etc.)
      // 2. Shared credentials file (~/.aws/credentials)
      // 3. IAM role (EC2/ECS)
      // 4. Config file credential_process
      aws = {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
        sessionToken: process.env.AWS_SESSION_TOKEN,
        region: config.backend.s3.region
      };
    }

    return { discord: { token: discordToken }, aws };
  }

  private async fromVault(path: string): Promise<string | null> {
    // TODO: Implement Vault integration
    return null;
  }

  private async promptForToken(): Promise<string> {
    // Interactive prompt as last resort
    throw new Error('DISCORD_TOKEN not found. Set it via environment variable.');
  }
}
```

### 8.3 Sensitive Data Handling

```typescript
// Sensitive fields are never logged or displayed in full

export const SENSITIVE_FIELDS = [
  'token',
  'password',
  'secret',
  'api_key',
  'webhook_url'
];

export function redactSensitive(obj: any, fields = SENSITIVE_FIELDS): any {
  if (typeof obj !== 'object' || obj === null) {
    return obj;
  }

  const result: any = Array.isArray(obj) ? [] : {};

  for (const [key, value] of Object.entries(obj)) {
    if (fields.some(f => key.toLowerCase().includes(f))) {
      result[key] = '[REDACTED]';
    } else if (typeof value === 'object') {
      result[key] = redactSensitive(value, fields);
    } else {
      result[key] = value;
    }
  }

  return result;
}
```

---

## 9. Error Handling

### 9.1 Error Hierarchy

```typescript
// packages/cli/src/commands/server/iac/errors.ts

/**
 * Base error for all Gaib errors
 */
export class GaibError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly recoverable: boolean = false
  ) {
    super(message);
    this.name = 'GaibError';
  }
}

/**
 * Configuration errors
 */
export class ConfigError extends GaibError {
  constructor(message: string, public readonly path?: string) {
    super(message, 'CONFIG_ERROR', true);
    this.name = 'ConfigError';
  }
}

/**
 * State-related errors
 */
export class StateError extends GaibError {
  constructor(message: string) {
    super(message, 'STATE_ERROR', true);
    this.name = 'StateError';
  }
}

/**
 * Discord API errors
 */
export class DiscordApiError extends GaibError {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly discordCode?: number
  ) {
    super(message, 'DISCORD_API_ERROR', statusCode >= 500);
    this.name = 'DiscordApiError';
  }
}

export class RateLimitError extends DiscordApiError {
  constructor(
    public readonly retryAfter: number,
    public readonly global: boolean
  ) {
    super(`Rate limited. Retry after ${retryAfter}ms`, 429);
    this.name = 'RateLimitError';
  }
}
```

---

## 10. Testing Strategy

### 10.1 Test Categories

| Category | Purpose | Location |
|----------|---------|----------|
| Unit | Individual function testing | `packages/cli/src/commands/server/**/*.test.ts` |
| Integration | Component interaction | `packages/cli/tests/integration/` |
| E2E | Full CLI workflow | `packages/cli/tests/e2e/` |
| Snapshot | Config/output stability | `packages/cli/tests/snapshots/` |

### 10.2 Mock Strategy

```typescript
// packages/cli/tests/mocks/discord.ts

import { vi } from 'vitest';

/**
 * Mock Discord client for testing without API calls
 */
export function createMockDiscordClient() {
  return {
    fetchGuild: vi.fn().mockResolvedValue({
      id: '123456789',
      name: 'Test Server',
      roles: new Map(),
      channels: new Map()
    }),

    createRole: vi.fn().mockImplementation(async (data) => ({
      id: `role-${Date.now()}`,
      ...data
    })),

    updateRole: vi.fn().mockResolvedValue({}),
    deleteRole: vi.fn().mockResolvedValue({}),

    createChannel: vi.fn().mockImplementation(async (data) => ({
      id: `channel-${Date.now()}`,
      ...data
    })),

    updateChannel: vi.fn().mockResolvedValue({}),
    deleteChannel: vi.fn().mockResolvedValue({})
  };
}

// packages/cli/tests/mocks/backends.ts

/**
 * In-memory state backend for testing
 */
export class MockStateBackend implements StateBackend {
  private states = new Map<string, ServerState>();
  private locks = new Map<string, LockInfo>();

  async read(workspace: string) {
    return this.states.get(workspace) || null;
  }

  async write(workspace: string, state: ServerState) {
    this.states.set(workspace, state);
  }

  async lock(workspace: string, info: LockInfo) {
    if (this.locks.has(workspace)) {
      return { acquired: false, existingLock: this.locks.get(workspace) };
    }
    this.locks.set(workspace, info);
    return { acquired: true, lockId: info.id };
  }

  async unlock(workspace: string) {
    this.locks.delete(workspace);
  }

  async listWorkspaces() {
    return Array.from(this.states.keys());
  }

  async deleteWorkspace(workspace: string) {
    this.states.delete(workspace);
    this.locks.delete(workspace);
  }

  async isConfigured() {
    return true;
  }
}
```

---

## 11. Migration Path

### 11.1 From Sprint 91-93 Implementation

```typescript
// packages/cli/src/commands/server/iac/migration.ts

/**
 * Migrate from v1 (local-only) to v2 (remote state)
 */
export async function migrateV1ToV2(options: MigrationOptions): Promise<void> {
  console.log('Migrating from Gaib v1 to v2...\n');

  // 1. Read existing local state
  const localState = readLocalState(options.localPath);

  if (!localState) {
    console.log('No existing state found. Starting fresh.');
    return;
  }

  // 2. Transform state format
  const v2State = transformStateV1ToV2(localState);

  // 3. Initialize remote backend
  const backend = createBackend(options.backendConfig);

  // 4. Write to remote
  await backend.write('default', v2State);

  // 5. Backup and remove local state
  if (options.backupLocal) {
    renameSync(options.localPath, `${options.localPath}.v1.backup`);
  }

  console.log('Migration complete!');
  console.log(`  - State migrated to ${options.backendConfig.type} backend`);
  console.log(`  - Resources: ${v2State.resources.length}`);
}
```

### 11.2 Configuration Migration

```yaml
# v1 format (gaib.yaml)
server:
  name: My Server
  id: "123456789"

roles:
  - name: Admin
    color: "#FF0000"

# v2 format (gaib.yaml)
version: "2.0"

backend:
  s3:
    bucket: my-gaib-state
    region: us-east-1

server:
  name: My Server
  id: "123456789"

roles:
  - name: Admin
    color: "#FF0000"
```

---

## 12. Sprint Breakdown

### Sprint G-1: Remote State Backend (Foundation)

**Goal**: Implement S3 backend with DynamoDB locking

**Tasks**:
1. Create `StateBackend` interface
2. Implement `S3Backend` with read/write
3. Implement DynamoDB locking
4. Implement `LocalBackend` (refactor existing)
5. Create `BackendFactory`
6. Update `gaib init` to configure backend
7. Add backend configuration to schema

**Acceptance Criteria**:
- [ ] S3 state read/write works
- [ ] DynamoDB locking prevents concurrent operations
- [ ] Graceful fallback to local backend
- [ ] Backend configuration validated on init

**Files**:
- `packages/cli/src/commands/server/iac/backends/StateBackend.ts` (new)
- `packages/cli/src/commands/server/iac/backends/S3Backend.ts` (new)
- `packages/cli/src/commands/server/iac/backends/LocalBackend.ts` (new)
- `packages/cli/src/commands/server/iac/backends/BackendFactory.ts` (new)
- `packages/cli/src/commands/server/iac/schemas.ts` (extend)

---

### Sprint G-2: Workspace Management

**Goal**: Implement workspace system for environment isolation

**Tasks**:
1. Create `WorkspaceManager` class
2. Implement workspace commands (list, new, select, show, delete)
3. Add workspace to state path
4. Update all commands to respect current workspace
5. Add workspace prefix to resource names (optional)

**Acceptance Criteria**:
- [ ] Can create/select/delete workspaces
- [ ] State is isolated per workspace
- [ ] Current workspace persisted in `.gaib/workspace`
- [ ] All commands respect workspace context

**Files**:
- `packages/cli/src/commands/server/iac/WorkspaceManager.ts` (new)
- `packages/cli/src/commands/server/workspace.ts` (new)
- `packages/cli/src/commands/server/index.ts` (extend)

---

### Sprint G-3: Apply & Destroy Commands

**Goal**: Implement full apply/destroy lifecycle

**Tasks**:
1. Implement `gaib apply` command
2. Implement `gaib destroy` command
3. Add `--auto-approve` flag
4. Add `--target` flag for selective operations
5. Implement confirmation prompts
6. Add progress output during operations

**Acceptance Criteria**:
- [ ] Apply creates/updates resources as planned
- [ ] Destroy removes managed resources
- [ ] Confirmation required without `--auto-approve`
- [ ] Target flag limits scope
- [ ] Progress visible during operations

**Files**:
- `packages/cli/src/commands/server/apply.ts` (new)
- `packages/cli/src/commands/server/destroy.ts` (new)
- `packages/cli/src/commands/server/iac/ApplyEngine.ts` (extend)
- `packages/cli/src/commands/server/iac/DestroyEngine.ts` (new)

---

### Sprint G-4: Import & State Commands

**Goal**: Implement resource import and state management

**Tasks**:
1. Implement `gaib import` command
2. Implement `gaib state list` command
3. Implement `gaib state show` command
4. Implement `gaib state rm` command
5. Implement `gaib state mv` command
6. Implement `gaib state pull` command

**Acceptance Criteria**:
- [ ] Can import existing Discord resources
- [ ] State list shows all managed resources
- [ ] State show displays resource details
- [ ] State rm removes from state (not Discord)
- [ ] State pull refreshes from Discord

**Files**:
- `packages/cli/src/commands/server/import.ts` (new)
- `packages/cli/src/commands/server/state.ts` (new)

---

### Sprint G-5: Theme System

**Goal**: Implement theme loading and merging

**Tasks**:
1. Create `ThemeManifestSchema`
2. Implement `ThemeLoader` (local themes)
3. Implement `ThemeMerger`
4. Create Sietch reference theme
5. Implement theme commands (list, info)
6. Add theme configuration to schema

**Acceptance Criteria**:
- [ ] Themes load from local directory
- [ ] Theme variables interpolate correctly
- [ ] User config overrides theme defaults
- [ ] Sietch theme works as reference
- [ ] Theme commands display information

**Files**:
- `packages/cli/src/commands/server/themes/ThemeSchema.ts` (new)
- `packages/cli/src/commands/server/themes/ThemeLoader.ts` (new)
- `packages/cli/src/commands/server/themes/ThemeMerger.ts` (new)
- `packages/cli/src/commands/server/theme.ts` (new)
- `themes/sietch/` (new directory)

---

### Sprint G-6: Polish & Documentation

**Goal**: CLI polish, error handling, documentation

**Tasks**:
1. Implement comprehensive error hierarchy
2. Add error recovery strategies
3. Improve CLI output formatting
4. Add `--json` output flag to all commands
5. Write CLI help text
6. Create user documentation

**Acceptance Criteria**:
- [ ] All errors have clear messages
- [ ] JSON output available for scripting
- [ ] Help text comprehensive
- [ ] User guide complete

**Files**:
- `packages/cli/src/commands/server/iac/errors.ts` (extend)
- `packages/cli/src/commands/server/iac/ErrorRecovery.ts` (new)
- `packages/cli/src/commands/server/iac/formatters.ts` (extend)
- `docs/gaib/` (new directory)

---

## Appendix A: Configuration Reference

### Complete gaib.yaml Example

```yaml
# Gaib Configuration File
# Version 2.0

version: "2.0"

# Backend configuration (optional - defaults to local)
backend:
  s3:
    bucket: acme-gaib-state
    region: us-east-1
    key_prefix: gaib-state
    dynamodb_table: gaib-locks
    encrypt: true
    # kms_key_id: alias/gaib-state  # Optional

# Theme reference (optional)
theme:
  name: sietch
  source: local
  path: ./themes/sietch

# Variable overrides for theme
variables:
  community_name: "ACME DAO"
  primary_color: "#3B82F6"

# Server configuration
server:
  name: "ACME DAO"
  id: "${DISCORD_SERVER_ID}"
  description: "Official ACME DAO community server"
  verification_level: medium
  default_notifications: only_mentions
  explicit_content_filter: members_without_roles

  features:
    community: true
    welcome_screen: true

# Custom roles (merged with theme)
roles:
  - name: Core Team
    color: "#EF4444"
    permissions:
      - administrator
    hoist: true

# Custom channels (merged with theme)
channels:
  - name: "core-team"
    category: "ACME DAO HQ"
    type: text
    topic: "Core team discussion"
    permissions:
      "@everyone":
        deny:
          - view_channel
      Core Team:
        - view_channel
        - send_messages

# Lifecycle hooks (optional)
hooks:
  pre_apply:
    - "echo 'Starting apply...'"
  post_apply:
    - "curl -X POST https://hooks.slack.com/... -d '{\"text\":\"Deploy complete\"}'"
```

---

## Appendix B: CLI Quick Reference

```bash
# Initialization
gaib init                          # Interactive setup
gaib init --backend=s3             # Initialize with S3 backend

# Planning
gaib plan                          # Generate execution plan
gaib plan -out=plan.json           # Save plan to file
gaib plan --target=discord_role.*  # Plan specific resources

# Applying
gaib apply                         # Apply with confirmation
gaib apply --auto-approve          # Skip confirmation
gaib apply plan.json               # Apply saved plan
gaib apply --target=discord_role.* # Apply specific resources

# Destroying
gaib destroy                       # Destroy with confirmation
gaib destroy --auto-approve        # Skip confirmation (DANGEROUS)
gaib destroy --target=discord_role.admin  # Destroy specific resource

# Import
gaib import discord_role.admin 123456789  # Import existing resource

# State Management
gaib state list                    # List all resources
gaib state show discord_role.admin # Show resource details
gaib state rm discord_role.admin   # Remove from state
gaib state mv discord_role.old discord_role.new  # Rename
gaib state pull                    # Refresh from Discord

# Workspaces
gaib workspace list                # List workspaces
gaib workspace new staging         # Create workspace
gaib workspace select staging      # Switch workspace
gaib workspace show                # Show current workspace
gaib workspace delete staging      # Delete workspace

# Themes
gaib theme list                    # List available themes
gaib theme info sietch             # Show theme details

# Utilities
gaib validate                      # Validate configuration
gaib diff                          # Quick diff (no lock)
gaib export --server-id=123        # Export existing server
gaib force-unlock <lock-id>        # Force release lock
gaib version                       # Show version
```

---

**Document Status**: READY FOR REVIEW
**Next Phase**: `/sprint-plan` to break down into implementation sprints

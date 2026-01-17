/**
 * SandboxManager - Core Sandbox Lifecycle Management
 *
 * Sprint 84: Discord Server Sandboxes - Foundation
 *
 * Manages the complete lifecycle of sandboxes:
 * - Creation with schema provisioning
 * - Guild registration/unregistration
 * - TTL management and extension
 * - Destruction and cleanup
 * - Health monitoring
 *
 * @see SDD §5.1.3 SandboxManager
 * @module packages/sandbox/services/sandbox-manager
 */

import type { Logger } from 'pino';
import type postgres from 'postgres';
import { nanoid } from 'nanoid';

import type {
  Sandbox,
  SandboxStatus,
  CreateSandboxOptions,
  SandboxFilter,
  SandboxConnectionDetails,
  SandboxHealthStatus,
  HealthLevel,
  AuditEventType,
} from '../types.js';
import { VALID_STATUS_TRANSITIONS, SandboxError, SandboxErrorCode } from '../types.js';
import { SchemaProvisioner } from './schema-provisioner.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Configuration for SandboxManager
 */
export interface SandboxManagerConfig {
  /** PostgreSQL client (postgres.js) */
  sql: postgres.Sql;

  /** Logger instance */
  logger: Logger;

  /** Default TTL in hours for new sandboxes */
  defaultTtlHours?: number;

  /** Maximum TTL in hours allowed */
  maxTtlHours?: number;

  /** Maximum sandboxes per owner */
  maxSandboxesPerOwner?: number;
}

/**
 * Result of sandbox creation
 */
export interface SandboxCreateResult {
  /** Created sandbox */
  sandbox: Sandbox;

  /** Schema creation details */
  schema: {
    name: string;
    tablesCreated: string[];
  };

  /** Time taken in milliseconds */
  durationMs: number;
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_TTL_HOURS = 24;
const MAX_TTL_HOURS = 168; // 7 days
const MAX_SANDBOXES_PER_OWNER = 5;

// =============================================================================
// SandboxManager
// =============================================================================

/**
 * Core sandbox lifecycle manager
 */
export class SandboxManager {
  private readonly sql: postgres.Sql;
  private readonly logger: Logger;
  private readonly schemaProvisioner: SchemaProvisioner;
  private readonly defaultTtlHours: number;
  private readonly maxTtlHours: number;
  private readonly maxSandboxesPerOwner: number;

  constructor(config: SandboxManagerConfig) {
    this.sql = config.sql;
    this.logger = config.logger.child({ component: 'SandboxManager' });
    this.defaultTtlHours = config.defaultTtlHours ?? DEFAULT_TTL_HOURS;
    this.maxTtlHours = config.maxTtlHours ?? MAX_TTL_HOURS;
    this.maxSandboxesPerOwner = config.maxSandboxesPerOwner ?? MAX_SANDBOXES_PER_OWNER;

    this.schemaProvisioner = new SchemaProvisioner({
      sql: config.sql,
      logger: config.logger,
    });
  }

  // ===========================================================================
  // Sandbox Creation
  // ===========================================================================

  /**
   * Create a new sandbox
   *
   * @param options - Sandbox creation options
   * @returns Created sandbox with schema details
   * @throws SandboxError if creation fails
   */
  async create(options: CreateSandboxOptions): Promise<SandboxCreateResult> {
    const startTime = Date.now();
    const { owner, ttlHours = this.defaultTtlHours, guildIds = [], metadata = {} } = options;

    this.logger.info({ owner, ttlHours, guildIds }, 'Creating new sandbox');

    // Validate TTL
    const validatedTtl = Math.min(ttlHours, this.maxTtlHours);
    if (validatedTtl !== ttlHours) {
      this.logger.warn(
        { requested: ttlHours, max: this.maxTtlHours, used: validatedTtl },
        'TTL exceeds maximum, capping'
      );
    }

    // Check owner's sandbox count
    await this.checkOwnerLimit(owner);

    // Check guild availability
    for (const guildId of guildIds) {
      await this.checkGuildAvailability(guildId);
    }

    // Generate name if not provided
    const name = options.name ?? this.generateSandboxName(owner);

    // Check name uniqueness
    await this.checkNameAvailability(name);

    // Create sandbox record
    const expiresAt = new Date(Date.now() + validatedTtl * 60 * 60 * 1000);
    const sandboxMetadata = {
      ...metadata,
      ttlHours: validatedTtl,
      createdBy: owner,
      createdFrom: metadata.createdFrom ?? 'api',
    };

    let sandboxId: string;
    let schemaName: string;

    try {
      // Insert sandbox record
      const insertResult = await this.sql<{ id: string; schema_name: string }[]>`
        INSERT INTO sandboxes (name, owner, status, schema_name, expires_at, metadata)
        VALUES (
          ${name},
          ${owner},
          'pending',
          'pending_' || gen_random_uuid()::text,
          ${expiresAt},
          ${JSON.stringify(sandboxMetadata)}
        )
        RETURNING id, schema_name
      `;

      sandboxId = insertResult[0].id;

      // Generate schema name from sandbox ID
      schemaName = this.schemaProvisioner.generateSchemaName(sandboxId);

      // Update schema name
      await this.sql`
        UPDATE sandboxes
        SET schema_name = ${schemaName}, status = 'creating'
        WHERE id = ${sandboxId}::uuid
      `;

      // Create audit log entry
      await this.createAuditEntry(sandboxId, 'sandbox_created', owner, {
        name,
        ttlHours: validatedTtl,
        guildIds,
      });

      // Provision the schema
      const schemaResult = await this.schemaProvisioner.createSchema(sandboxId);

      // Register guilds
      for (const guildId of guildIds) {
        await this.registerGuildInternal(sandboxId, guildId, owner);
      }

      // Update status to running
      await this.updateStatus(sandboxId, 'running', owner);

      // Fetch complete sandbox
      const sandbox = await this.getById(sandboxId);
      if (!sandbox) {
        throw new SandboxError(
          SandboxErrorCode.NOT_FOUND,
          'Sandbox not found after creation',
          { sandboxId }
        );
      }

      const result: SandboxCreateResult = {
        sandbox,
        schema: {
          name: schemaResult.schemaName,
          tablesCreated: schemaResult.tablesCreated,
        },
        durationMs: Date.now() - startTime,
      };

      this.logger.info(
        { sandboxId, name, schemaName, durationMs: result.durationMs },
        'Sandbox created successfully'
      );

      return result;
    } catch (error) {
      // Cleanup on failure
      this.logger.error({ error, owner, name }, 'Sandbox creation failed, cleaning up');

      if (sandboxId!) {
        try {
          // Try to cleanup schema if it was created
          await this.schemaProvisioner.dropSchema(sandboxId);
        } catch {
          // Ignore cleanup errors
        }

        try {
          // Remove the sandbox record
          await this.sql`DELETE FROM sandboxes WHERE id = ${sandboxId}::uuid`;
        } catch {
          // Ignore cleanup errors
        }
      }

      // Re-throw or wrap error
      if (error instanceof SandboxError) {
        throw error;
      }

      throw new SandboxError(
        SandboxErrorCode.SCHEMA_FAILED,
        `Sandbox creation failed: ${error instanceof Error ? error.message : String(error)}`,
        { owner, name, originalError: String(error) }
      );
    }
  }

  /**
   * Generate a unique sandbox name
   */
  private generateSandboxName(owner: string): string {
    const shortId = nanoid(6);
    return `sandbox-${owner}-${shortId}`;
  }

  // ===========================================================================
  // Sandbox Retrieval
  // ===========================================================================

  /**
   * Get a sandbox by ID
   */
  async getById(id: string): Promise<Sandbox | null> {
    const rows = await this.sql<SandboxRow[]>`
      SELECT s.*,
        COALESCE(
          (SELECT array_agg(guild_id) FROM sandbox_guild_mapping WHERE sandbox_id = s.id),
          ARRAY[]::varchar[]
        ) as guild_ids
      FROM sandboxes s
      WHERE s.id = ${id}::uuid
    `;

    if (rows.length === 0) {
      return null;
    }

    return this.rowToSandbox(rows[0]);
  }

  /**
   * Get a sandbox by name
   */
  async getByName(name: string): Promise<Sandbox | null> {
    const rows = await this.sql<SandboxRow[]>`
      SELECT s.*,
        COALESCE(
          (SELECT array_agg(guild_id) FROM sandbox_guild_mapping WHERE sandbox_id = s.id),
          ARRAY[]::varchar[]
        ) as guild_ids
      FROM sandboxes s
      WHERE s.name = ${name}
    `;

    if (rows.length === 0) {
      return null;
    }

    return this.rowToSandbox(rows[0]);
  }

  /**
   * Get a sandbox by guild ID
   */
  async getByGuildId(guildId: string): Promise<Sandbox | null> {
    const rows = await this.sql<SandboxRow[]>`
      SELECT s.*,
        COALESCE(
          (SELECT array_agg(m2.guild_id) FROM sandbox_guild_mapping m2 WHERE m2.sandbox_id = s.id),
          ARRAY[]::varchar[]
        ) as guild_ids
      FROM sandboxes s
      JOIN sandbox_guild_mapping m ON m.sandbox_id = s.id
      WHERE m.guild_id = ${guildId}
    `;

    if (rows.length === 0) {
      return null;
    }

    return this.rowToSandbox(rows[0]);
  }

  /**
   * List sandboxes with optional filtering
   */
  async list(filter: SandboxFilter = {}): Promise<Sandbox[]> {
    const { owner, status, includeDestroyed = false } = filter;

    // Build dynamic query
    let rows: SandboxRow[];

    if (owner && status) {
      const statusArray = Array.isArray(status) ? status : [status];
      rows = await this.sql<SandboxRow[]>`
        SELECT s.*,
          COALESCE(
            (SELECT array_agg(guild_id) FROM sandbox_guild_mapping WHERE sandbox_id = s.id),
            ARRAY[]::varchar[]
          ) as guild_ids
        FROM sandboxes s
        WHERE s.owner = ${owner}
          AND s.status = ANY(${statusArray}::sandbox_status[])
          AND (${includeDestroyed} OR s.status != 'destroyed')
        ORDER BY s.created_at DESC
      `;
    } else if (owner) {
      rows = await this.sql<SandboxRow[]>`
        SELECT s.*,
          COALESCE(
            (SELECT array_agg(guild_id) FROM sandbox_guild_mapping WHERE sandbox_id = s.id),
            ARRAY[]::varchar[]
          ) as guild_ids
        FROM sandboxes s
        WHERE s.owner = ${owner}
          AND (${includeDestroyed} OR s.status != 'destroyed')
        ORDER BY s.created_at DESC
      `;
    } else if (status) {
      const statusArray = Array.isArray(status) ? status : [status];
      rows = await this.sql<SandboxRow[]>`
        SELECT s.*,
          COALESCE(
            (SELECT array_agg(guild_id) FROM sandbox_guild_mapping WHERE sandbox_id = s.id),
            ARRAY[]::varchar[]
          ) as guild_ids
        FROM sandboxes s
        WHERE s.status = ANY(${statusArray}::sandbox_status[])
          AND (${includeDestroyed} OR s.status != 'destroyed')
        ORDER BY s.created_at DESC
      `;
    } else {
      rows = await this.sql<SandboxRow[]>`
        SELECT s.*,
          COALESCE(
            (SELECT array_agg(guild_id) FROM sandbox_guild_mapping WHERE sandbox_id = s.id),
            ARRAY[]::varchar[]
          ) as guild_ids
        FROM sandboxes s
        WHERE (${includeDestroyed} OR s.status != 'destroyed')
        ORDER BY s.created_at DESC
      `;
    }

    return rows.map((row) => this.rowToSandbox(row));
  }

  // ===========================================================================
  // Guild Management
  // ===========================================================================

  /**
   * Register a Discord guild to a sandbox
   */
  async registerGuild(sandboxId: string, guildId: string, actor: string): Promise<void> {
    const sandbox = await this.getById(sandboxId);
    if (!sandbox) {
      throw new SandboxError(SandboxErrorCode.NOT_FOUND, `Sandbox not found: ${sandboxId}`, {
        sandboxId,
      });
    }

    if (sandbox.status !== 'running') {
      throw new SandboxError(
        SandboxErrorCode.INVALID_TRANSITION,
        `Cannot register guild to sandbox in ${sandbox.status} status`,
        { sandboxId, status: sandbox.status }
      );
    }

    await this.registerGuildInternal(sandboxId, guildId, actor);
  }

  private async registerGuildInternal(
    sandboxId: string,
    guildId: string,
    actor: string
  ): Promise<void> {
    // Check guild availability
    await this.checkGuildAvailability(guildId);

    // Insert mapping
    await this.sql`
      INSERT INTO sandbox_guild_mapping (guild_id, sandbox_id)
      VALUES (${guildId}, ${sandboxId}::uuid)
    `;

    // Audit log
    await this.createAuditEntry(sandboxId, 'guild_registered', actor, { guildId });

    this.logger.info({ sandboxId, guildId, actor }, 'Guild registered to sandbox');
  }

  /**
   * Unregister a Discord guild from a sandbox
   */
  async unregisterGuild(sandboxId: string, guildId: string, actor: string): Promise<void> {
    const result = await this.sql`
      DELETE FROM sandbox_guild_mapping
      WHERE sandbox_id = ${sandboxId}::uuid AND guild_id = ${guildId}
    `;

    if (result.count === 0) {
      this.logger.warn({ sandboxId, guildId }, 'Guild was not registered to sandbox');
      return;
    }

    // Audit log
    await this.createAuditEntry(sandboxId, 'guild_unregistered', actor, { guildId });

    this.logger.info({ sandboxId, guildId, actor }, 'Guild unregistered from sandbox');
  }

  // ===========================================================================
  // TTL Management
  // ===========================================================================

  /**
   * Extend sandbox TTL
   *
   * @param sandboxId - Sandbox ID
   * @param additionalHours - Hours to add
   * @param actor - Who is extending
   * @returns New expiry date
   */
  async extendTtl(sandboxId: string, additionalHours: number, actor: string): Promise<Date> {
    const sandbox = await this.getById(sandboxId);
    if (!sandbox) {
      throw new SandboxError(SandboxErrorCode.NOT_FOUND, `Sandbox not found: ${sandboxId}`, {
        sandboxId,
      });
    }

    if (sandbox.status !== 'running' && sandbox.status !== 'expired') {
      throw new SandboxError(
        SandboxErrorCode.INVALID_TRANSITION,
        `Cannot extend TTL for sandbox in ${sandbox.status} status`,
        { sandboxId, status: sandbox.status }
      );
    }

    // Calculate new expiry, respecting max TTL from creation time
    const maxExpiry = new Date(
      sandbox.createdAt.getTime() + this.maxTtlHours * 60 * 60 * 1000
    );
    const requestedExpiry = new Date(
      sandbox.expiresAt.getTime() + additionalHours * 60 * 60 * 1000
    );
    const newExpiry = requestedExpiry > maxExpiry ? maxExpiry : requestedExpiry;

    await this.sql`
      UPDATE sandboxes
      SET expires_at = ${newExpiry},
          status = 'running'
      WHERE id = ${sandboxId}::uuid
    `;

    // Audit log
    await this.createAuditEntry(sandboxId, 'ttl_extended', actor, {
      additionalHours,
      newExpiry: newExpiry.toISOString(),
      capped: requestedExpiry > maxExpiry,
    });

    this.logger.info(
      { sandboxId, additionalHours, newExpiry, actor },
      'Sandbox TTL extended'
    );

    return newExpiry;
  }

  // ===========================================================================
  // Sandbox Destruction
  // ===========================================================================

  /**
   * Destroy a sandbox
   *
   * Marks for destruction, drops schema, then marks as destroyed.
   */
  async destroy(sandboxId: string, actor: string): Promise<void> {
    const sandbox = await this.getById(sandboxId);
    if (!sandbox) {
      throw new SandboxError(SandboxErrorCode.NOT_FOUND, `Sandbox not found: ${sandboxId}`, {
        sandboxId,
      });
    }

    if (sandbox.status === 'destroyed') {
      this.logger.warn({ sandboxId }, 'Sandbox already destroyed');
      return;
    }

    if (sandbox.status === 'destroying') {
      this.logger.warn({ sandboxId }, 'Sandbox already being destroyed');
      return;
    }

    this.logger.info({ sandboxId, actor }, 'Destroying sandbox');

    try {
      // Mark as destroying
      await this.updateStatus(sandboxId, 'destroying', actor);
      await this.createAuditEntry(sandboxId, 'sandbox_destroying', actor, {});

      // Drop schema
      await this.schemaProvisioner.dropSchema(sandboxId);

      // Mark as destroyed
      await this.sql`
        UPDATE sandboxes
        SET status = 'destroyed', destroyed_at = NOW()
        WHERE id = ${sandboxId}::uuid
      `;

      await this.createAuditEntry(sandboxId, 'sandbox_destroyed', actor, {});

      this.logger.info({ sandboxId, actor }, 'Sandbox destroyed successfully');
    } catch (error) {
      this.logger.error({ sandboxId, error }, 'Error during sandbox destruction');
      throw new SandboxError(
        SandboxErrorCode.CLEANUP_FAILED,
        `Failed to destroy sandbox: ${error instanceof Error ? error.message : String(error)}`,
        { sandboxId, originalError: String(error) }
      );
    }
  }

  // ===========================================================================
  // Health & Status
  // ===========================================================================

  /**
   * Get sandbox health status
   */
  async getHealth(sandboxId: string): Promise<SandboxHealthStatus> {
    const sandbox = await this.getById(sandboxId);
    if (!sandbox) {
      throw new SandboxError(SandboxErrorCode.NOT_FOUND, `Sandbox not found: ${sandboxId}`, {
        sandboxId,
      });
    }

    // Check schema health
    let schemaStatus: 'ok' | 'missing' | 'error' = 'error';
    try {
      const exists = await this.schemaProvisioner.schemaExists(sandboxId);
      schemaStatus = exists ? 'ok' : 'missing';
    } catch {
      schemaStatus = 'error';
    }

    // Routing check - has guilds?
    const routingStatus =
      sandbox.guildIds.length > 0 ? 'ok' : ('no_guilds' as const);

    // Redis check would require Redis client - mark as ok for now
    // (will be implemented in Sprint 85 with Redis integration)
    const redisStatus = 'ok' as 'ok' | 'error';

    // Calculate overall health
    let health: HealthLevel = 'healthy';
    if (schemaStatus === 'error' || redisStatus === 'error') {
      health = 'unhealthy';
    } else if (schemaStatus === 'missing' || routingStatus === 'no_guilds') {
      health = 'degraded';
    }

    // Calculate expires_in
    const expiresIn = this.formatExpiresIn(sandbox.expiresAt);

    return {
      sandboxId,
      status: sandbox.status,
      health,
      checks: {
        schema: schemaStatus,
        redis: redisStatus,
        routing: routingStatus,
      },
      lastActivity: sandbox.lastActivityAt,
      expiresIn,
    };
  }

  /**
   * Get connection details for a sandbox
   */
  async getConnectionDetails(sandboxId: string): Promise<SandboxConnectionDetails> {
    const sandbox = await this.getById(sandboxId);
    if (!sandbox) {
      throw new SandboxError(SandboxErrorCode.NOT_FOUND, `Sandbox not found: ${sandboxId}`, {
        sandboxId,
      });
    }

    if (sandbox.status !== 'running') {
      throw new SandboxError(
        SandboxErrorCode.INVALID_TRANSITION,
        `Sandbox is not running: ${sandbox.status}`,
        { sandboxId, status: sandbox.status }
      );
    }

    const redisPrefix = `sandbox:${sandboxId}:`;
    const natsPrefix = `sandbox.${sandboxId}.`;

    return {
      sandboxId,
      schemaName: sandbox.schemaName,
      redisPrefix,
      natsPrefix,
      guildIds: sandbox.guildIds,
      env: {
        SANDBOX_ID: sandboxId,
        SANDBOX_SCHEMA: sandbox.schemaName,
        SANDBOX_REDIS_PREFIX: redisPrefix,
        SANDBOX_NATS_PREFIX: natsPrefix,
        SANDBOX_GUILD_IDS: sandbox.guildIds.join(','),
      },
    };
  }

  // ===========================================================================
  // Expiry Processing
  // ===========================================================================

  /**
   * Find sandboxes that have expired
   */
  async findExpired(): Promise<Sandbox[]> {
    const rows = await this.sql<SandboxRow[]>`
      SELECT s.*,
        COALESCE(
          (SELECT array_agg(guild_id) FROM sandbox_guild_mapping WHERE sandbox_id = s.id),
          ARRAY[]::varchar[]
        ) as guild_ids
      FROM sandboxes s
      WHERE s.status = 'running'
        AND s.expires_at < NOW()
      ORDER BY s.expires_at ASC
    `;

    return rows.map((row) => this.rowToSandbox(row));
  }

  /**
   * Mark expired sandboxes
   */
  async markExpired(): Promise<string[]> {
    const expired = await this.findExpired();
    const markedIds: string[] = [];

    for (const sandbox of expired) {
      try {
        await this.updateStatus(sandbox.id, 'expired', 'system');
        markedIds.push(sandbox.id);
        this.logger.info({ sandboxId: sandbox.id }, 'Marked sandbox as expired');
      } catch (error) {
        this.logger.error({ sandboxId: sandbox.id, error }, 'Failed to mark sandbox as expired');
      }
    }

    return markedIds;
  }

  // ===========================================================================
  // Activity Tracking
  // ===========================================================================

  /**
   * Update last activity timestamp
   */
  async updateActivity(sandboxId: string): Promise<void> {
    await this.sql`
      UPDATE sandboxes
      SET last_activity_at = NOW()
      WHERE id = ${sandboxId}::uuid AND status = 'running'
    `;
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  private async checkOwnerLimit(owner: string): Promise<void> {
    const result = await this.sql<{ count: string }[]>`
      SELECT COUNT(*) as count
      FROM sandboxes
      WHERE owner = ${owner} AND status NOT IN ('destroyed')
    `;

    const count = parseInt(result[0].count, 10);
    if (count >= this.maxSandboxesPerOwner) {
      throw new SandboxError(
        SandboxErrorCode.MAX_EXCEEDED,
        `Owner ${owner} has reached max sandbox limit (${this.maxSandboxesPerOwner})`,
        { owner, count, max: this.maxSandboxesPerOwner }
      );
    }
  }

  private async checkGuildAvailability(guildId: string): Promise<void> {
    const result = await this.sql<{ sandbox_id: string; sandbox_name: string }[]>`
      SELECT s.id as sandbox_id, s.name as sandbox_name
      FROM sandbox_guild_mapping m
      JOIN sandboxes s ON s.id = m.sandbox_id
      WHERE m.guild_id = ${guildId} AND s.status NOT IN ('destroyed')
    `;

    if (result.length > 0) {
      throw new SandboxError(
        SandboxErrorCode.GUILD_MAPPED,
        `Guild ${guildId} is already mapped to sandbox ${result[0].sandbox_name}`,
        { guildId, existingSandboxId: result[0].sandbox_id }
      );
    }
  }

  private async checkNameAvailability(name: string): Promise<void> {
    const result = await this.sql<{ id: string }[]>`
      SELECT id FROM sandboxes WHERE name = ${name} AND status != 'destroyed'
    `;

    if (result.length > 0) {
      throw new SandboxError(
        SandboxErrorCode.NAME_EXISTS,
        `Sandbox name already exists: ${name}`,
        { name, existingId: result[0].id }
      );
    }
  }

  private async updateStatus(
    sandboxId: string,
    newStatus: SandboxStatus,
    actor: string
  ): Promise<void> {
    // Get current status
    const result = await this.sql<{ status: SandboxStatus }[]>`
      SELECT status FROM sandboxes WHERE id = ${sandboxId}::uuid
    `;

    if (result.length === 0) {
      throw new SandboxError(SandboxErrorCode.NOT_FOUND, `Sandbox not found: ${sandboxId}`, {
        sandboxId,
      });
    }

    const currentStatus = result[0].status;
    const validTransitions = VALID_STATUS_TRANSITIONS[currentStatus];

    if (!validTransitions.includes(newStatus)) {
      throw new SandboxError(
        SandboxErrorCode.INVALID_TRANSITION,
        `Invalid status transition: ${currentStatus} -> ${newStatus}`,
        { sandboxId, currentStatus, newStatus, validTransitions }
      );
    }

    await this.sql`
      UPDATE sandboxes
      SET status = ${newStatus}::sandbox_status
      WHERE id = ${sandboxId}::uuid
    `;

    await this.createAuditEntry(sandboxId, 'status_changed', actor, {
      from: currentStatus,
      to: newStatus,
    });
  }

  private async createAuditEntry(
    sandboxId: string,
    eventType: AuditEventType,
    actor: string,
    details: Record<string, unknown>
  ): Promise<void> {
    await this.sql`
      INSERT INTO sandbox_audit_log (sandbox_id, event_type, actor, details)
      VALUES (${sandboxId}::uuid, ${eventType}, ${actor}, ${JSON.stringify(details)})
    `;
  }

  private formatExpiresIn(expiresAt: Date): string {
    const now = Date.now();
    const diffMs = expiresAt.getTime() - now;

    if (diffMs <= 0) {
      return 'expired';
    }

    const hours = Math.floor(diffMs / (60 * 60 * 1000));
    const minutes = Math.floor((diffMs % (60 * 60 * 1000)) / (60 * 1000));

    if (hours >= 24) {
      const days = Math.floor(hours / 24);
      return `${days} day${days !== 1 ? 's' : ''}`;
    }

    if (hours > 0) {
      return `${hours} hour${hours !== 1 ? 's' : ''}`;
    }

    return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
  }

  private rowToSandbox(row: SandboxRow): Sandbox {
    return {
      id: row.id,
      name: row.name,
      owner: row.owner,
      status: row.status as SandboxStatus,
      schemaName: row.schema_name,
      discordTokenId: row.discord_token_id,
      createdAt: new Date(row.created_at),
      expiresAt: new Date(row.expires_at),
      destroyedAt: row.destroyed_at ? new Date(row.destroyed_at) : null,
      lastActivityAt: row.last_activity_at ? new Date(row.last_activity_at) : null,
      metadata: row.metadata as Sandbox['metadata'],
      guildIds: row.guild_ids ?? [],
    };
  }
}

// =============================================================================
// Internal Types
// =============================================================================

interface SandboxRow {
  id: string;
  name: string;
  owner: string;
  status: string;
  schema_name: string;
  discord_token_id: string | null;
  created_at: string;
  expires_at: string;
  destroyed_at: string | null;
  last_activity_at: string | null;
  metadata: unknown;
  guild_ids: string[] | null;
}

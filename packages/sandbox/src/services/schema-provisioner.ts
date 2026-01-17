/**
 * SchemaProvisioner - PostgreSQL Schema Lifecycle Management
 *
 * Sprint 84: Discord Server Sandboxes - Foundation
 *
 * Manages the creation and destruction of PostgreSQL schemas for sandboxes.
 * Each sandbox gets an isolated schema with tenant-scoped tables.
 *
 * @see SDD §5.1.2 SchemaProvisioner
 * @module packages/sandbox/services/schema-provisioner
 */

import type { Logger } from 'pino';
import type postgres from 'postgres';

import type { SchemaStats } from '../types.js';
import { SandboxError, SandboxErrorCode } from '../types.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Configuration for SchemaProvisioner
 */
export interface SchemaProvisionerConfig {
  /** PostgreSQL client (postgres.js) */
  sql: postgres.Sql;

  /** Logger instance */
  logger: Logger;

  /** Schema name prefix (default: 'sandbox_') */
  schemaPrefix?: string;
}

/**
 * Result of schema creation
 */
export interface SchemaCreateResult {
  /** Full schema name (e.g., 'sandbox_abc123') */
  schemaName: string;

  /** Tables created in the schema */
  tablesCreated: string[];

  /** Time taken in milliseconds */
  durationMs: number;
}

/**
 * Result of schema destruction
 */
export interface SchemaDropResult {
  /** Full schema name that was dropped */
  schemaName: string;

  /** Whether the schema existed before drop */
  existed: boolean;

  /** Time taken in milliseconds */
  durationMs: number;
}

// =============================================================================
// SchemaProvisioner
// =============================================================================

/**
 * Manages PostgreSQL schema lifecycle for sandboxes
 *
 * Uses the database functions created in migration 003_sandboxes.sql:
 * - create_sandbox_schema(sandbox_id)
 * - drop_sandbox_schema(sandbox_id)
 * - sandbox_schema_exists(sandbox_id)
 * - get_sandbox_schema_stats(sandbox_id)
 */
export class SchemaProvisioner {
  private readonly sql: postgres.Sql;
  private readonly logger: Logger;
  private readonly schemaPrefix: string;

  constructor(config: SchemaProvisionerConfig) {
    this.sql = config.sql;
    this.logger = config.logger.child({ component: 'SchemaProvisioner' });
    this.schemaPrefix = config.schemaPrefix ?? 'sandbox_';
  }

  /**
   * Generate a short sandbox ID for schema naming
   *
   * Uses the first 8 characters of the UUID (stripped of hyphens).
   * Schema name format: sandbox_{short_id}
   */
  generateSchemaName(sandboxId: string): string {
    // Extract first 8 chars of UUID (without hyphens)
    const shortId = sandboxId.replace(/-/g, '').substring(0, 8);
    return `${this.schemaPrefix}${shortId}`;
  }

  /**
   * Extract sandbox ID from schema name
   */
  extractSandboxId(schemaName: string): string {
    if (!schemaName.startsWith(this.schemaPrefix)) {
      throw new SandboxError(
        SandboxErrorCode.SCHEMA_FAILED,
        `Invalid schema name format: ${schemaName}`,
        { schemaName, expectedPrefix: this.schemaPrefix }
      );
    }
    return schemaName.substring(this.schemaPrefix.length);
  }

  /**
   * Create a new sandbox schema with all tenant tables
   *
   * @param sandboxId - Short sandbox ID (8 chars from UUID)
   * @returns Schema creation result
   * @throws SandboxError if creation fails
   */
  async createSchema(sandboxId: string): Promise<SchemaCreateResult> {
    const startTime = Date.now();
    const schemaName = this.generateSchemaName(sandboxId);

    this.logger.info({ sandboxId, schemaName }, 'Creating sandbox schema');

    try {
      // Check if schema already exists
      const exists = await this.schemaExists(sandboxId);
      if (exists) {
        this.logger.warn({ sandboxId, schemaName }, 'Schema already exists, skipping creation');
        const stats = await this.getSchemaStats(sandboxId);
        return {
          schemaName,
          tablesCreated: Object.keys(stats.tables),
          durationMs: Date.now() - startTime,
        };
      }

      // Call the database function to create schema and tables
      await this.sql`SELECT create_sandbox_schema(${sandboxId})`;

      // Verify creation and get table list
      const stats = await this.getSchemaStats(sandboxId);

      if (!stats.exists) {
        throw new SandboxError(
          SandboxErrorCode.SCHEMA_FAILED,
          'Schema creation succeeded but schema not found',
          { sandboxId, schemaName }
        );
      }

      const result: SchemaCreateResult = {
        schemaName,
        tablesCreated: Object.keys(stats.tables),
        durationMs: Date.now() - startTime,
      };

      this.logger.info(
        { sandboxId, schemaName, tables: result.tablesCreated, durationMs: result.durationMs },
        'Sandbox schema created successfully'
      );

      return result;
    } catch (error) {
      const durationMs = Date.now() - startTime;

      // Re-throw SandboxErrors as-is
      if (error instanceof SandboxError) {
        throw error;
      }

      // Wrap database errors
      this.logger.error(
        { sandboxId, schemaName, error, durationMs },
        'Failed to create sandbox schema'
      );

      throw new SandboxError(
        SandboxErrorCode.SCHEMA_FAILED,
        `Failed to create schema: ${error instanceof Error ? error.message : String(error)}`,
        { sandboxId, schemaName, originalError: String(error) }
      );
    }
  }

  /**
   * Drop a sandbox schema and all its contents
   *
   * This operation is idempotent - safe to call multiple times.
   *
   * @param sandboxId - Short sandbox ID
   * @returns Schema drop result
   */
  async dropSchema(sandboxId: string): Promise<SchemaDropResult> {
    const startTime = Date.now();
    const schemaName = this.generateSchemaName(sandboxId);

    this.logger.info({ sandboxId, schemaName }, 'Dropping sandbox schema');

    try {
      // Check if schema exists before drop
      const existed = await this.schemaExists(sandboxId);

      // Call the database function to drop schema (CASCADE)
      await this.sql`SELECT drop_sandbox_schema(${sandboxId})`;

      const result: SchemaDropResult = {
        schemaName,
        existed,
        durationMs: Date.now() - startTime,
      };

      this.logger.info(
        { sandboxId, schemaName, existed, durationMs: result.durationMs },
        existed ? 'Sandbox schema dropped successfully' : 'Schema did not exist, no action taken'
      );

      return result;
    } catch (error) {
      const durationMs = Date.now() - startTime;

      this.logger.error(
        { sandboxId, schemaName, error, durationMs },
        'Failed to drop sandbox schema'
      );

      throw new SandboxError(
        SandboxErrorCode.CLEANUP_FAILED,
        `Failed to drop schema: ${error instanceof Error ? error.message : String(error)}`,
        { sandboxId, schemaName, originalError: String(error) }
      );
    }
  }

  /**
   * Check if a sandbox schema exists
   *
   * @param sandboxId - Short sandbox ID
   * @returns true if schema exists
   */
  async schemaExists(sandboxId: string): Promise<boolean> {
    try {
      const result = await this.sql<
        { sandbox_schema_exists: boolean }[]
      >`SELECT sandbox_schema_exists(${sandboxId})`;

      return result[0]?.sandbox_schema_exists ?? false;
    } catch (error) {
      this.logger.error({ sandboxId, error }, 'Failed to check schema existence');
      throw new SandboxError(
        SandboxErrorCode.SCHEMA_FAILED,
        `Failed to check schema existence: ${error instanceof Error ? error.message : String(error)}`,
        { sandboxId, originalError: String(error) }
      );
    }
  }

  /**
   * Get statistics for a sandbox schema
   *
   * @param sandboxId - Short sandbox ID
   * @returns Schema statistics including table row counts
   */
  async getSchemaStats(sandboxId: string): Promise<SchemaStats> {
    try {
      // Check if schema exists
      const exists = await this.schemaExists(sandboxId);
      if (!exists) {
        return {
          exists: false,
          tables: {},
          totalRows: 0,
        };
      }

      // Get table stats from database function
      const stats = await this.sql<{ table_name: string; row_count: string }[]>`
        SELECT table_name, row_count FROM get_sandbox_schema_stats(${sandboxId})
      `;

      const tables: Record<string, number> = {};
      let totalRows = 0;

      for (const row of stats) {
        const count = parseInt(row.row_count, 10);
        tables[row.table_name] = count;
        totalRows += count;
      }

      return {
        exists: true,
        tables,
        totalRows,
      };
    } catch (error) {
      this.logger.error({ sandboxId, error }, 'Failed to get schema stats');
      throw new SandboxError(
        SandboxErrorCode.SCHEMA_FAILED,
        `Failed to get schema stats: ${error instanceof Error ? error.message : String(error)}`,
        { sandboxId, originalError: String(error) }
      );
    }
  }

  /**
   * List all sandbox schemas in the database
   *
   * @returns List of schema names
   */
  async listSchemas(): Promise<string[]> {
    try {
      const result = await this.sql<{ schema_name: string }[]>`
        SELECT schema_name
        FROM information_schema.schemata
        WHERE schema_name LIKE ${this.schemaPrefix + '%'}
        ORDER BY schema_name
      `;

      return result.map((row) => row.schema_name);
    } catch (error) {
      this.logger.error({ error }, 'Failed to list sandbox schemas');
      throw new SandboxError(
        SandboxErrorCode.SCHEMA_FAILED,
        `Failed to list schemas: ${error instanceof Error ? error.message : String(error)}`,
        { originalError: String(error) }
      );
    }
  }

  /**
   * Cleanup orphaned schemas (schemas without corresponding sandbox records)
   *
   * @param activeSandboxIds - Set of active sandbox IDs from control plane
   * @returns List of orphaned schema names that were dropped
   */
  async cleanupOrphanedSchemas(activeSandboxIds: Set<string>): Promise<string[]> {
    this.logger.info({ activeCount: activeSandboxIds.size }, 'Starting orphaned schema cleanup');

    const allSchemas = await this.listSchemas();
    const orphaned: string[] = [];

    for (const schemaName of allSchemas) {
      try {
        const sandboxId = this.extractSandboxId(schemaName);

        // Check if this sandbox ID is in our active set
        // Note: We compare the short ID from schema name
        const isActive = Array.from(activeSandboxIds).some((id) =>
          id.replace(/-/g, '').startsWith(sandboxId)
        );

        if (!isActive) {
          this.logger.warn({ schemaName, sandboxId }, 'Found orphaned schema, dropping');
          await this.dropSchema(sandboxId);
          orphaned.push(schemaName);
        }
      } catch (error) {
        this.logger.error({ schemaName, error }, 'Error processing schema during cleanup');
        // Continue with other schemas
      }
    }

    this.logger.info({ orphanedCount: orphaned.length, orphaned }, 'Orphaned schema cleanup complete');

    return orphaned;
  }
}

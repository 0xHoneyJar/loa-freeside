/**
 * Tenant Context Manager
 *
 * Sprint 39: RLS Implementation
 *
 * Manages PostgreSQL tenant context for Row-Level Security.
 * All database operations should be wrapped with tenant context
 * to ensure proper data isolation.
 *
 * Usage:
 * ```typescript
 * const tenantContext = new TenantContext(db);
 *
 * // Option 1: Scoped execution
 * await tenantContext.withTenant(communityId, async () => {
 *   const profiles = await db.select().from(profiles);
 * });
 *
 * // Option 2: Manual management
 * await tenantContext.setTenant(communityId);
 * const profiles = await db.select().from(profiles);
 * await tenantContext.clearTenant();
 * ```
 *
 * @module packages/adapters/storage/TenantContext
 */

import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

/**
 * Tenant context configuration options
 */
export interface TenantContextOptions {
  /**
   * Whether to throw on invalid tenant ID (default: true)
   */
  throwOnInvalidTenant?: boolean;

  /**
   * Whether to log tenant context changes (default: false)
   */
  debug?: boolean;
}

/**
 * Result of a tenant context check
 */
export interface TenantContextInfo {
  /**
   * Whether tenant context is currently set
   */
  isSet: boolean;

  /**
   * Current tenant ID (null if not set)
   */
  tenantId: string | null;
}

/**
 * TenantContext manages PostgreSQL tenant context for RLS policies.
 *
 * This class provides methods to:
 * - Set tenant context before database operations
 * - Clear tenant context after operations
 * - Execute operations within a scoped tenant context
 * - Verify current tenant context state
 *
 * Security guarantees:
 * - Cross-tenant queries return empty results (not errors)
 * - Tenant context not set = no rows visible
 * - INSERT/UPDATE with wrong community_id = permission denied
 */
export class TenantContext {
  private readonly db: PostgresJsDatabase;
  private readonly options: Required<TenantContextOptions>;

  /**
   * Creates a new TenantContext manager
   *
   * @param db - Drizzle PostgresJsDatabase instance
   * @param options - Configuration options
   */
  constructor(
    db: PostgresJsDatabase,
    options: TenantContextOptions = {}
  ) {
    this.db = db;
    this.options = {
      throwOnInvalidTenant: options.throwOnInvalidTenant ?? true,
      debug: options.debug ?? false,
    };
  }

  /**
   * Sets the current tenant context for RLS policies.
   *
   * After calling this, all queries on RLS-enabled tables will be
   * automatically filtered to the specified tenant.
   *
   * @param tenantId - UUID of the tenant (community)
   * @throws Error if tenantId is invalid and throwOnInvalidTenant is true
   *
   * @example
   * ```typescript
   * await tenantContext.setTenant('123e4567-e89b-12d3-a456-426614174000');
   * const profiles = await db.select().from(profiles);
   * ```
   */
  async setTenant(tenantId: string): Promise<void> {
    if (!this.isValidUUID(tenantId)) {
      if (this.options.throwOnInvalidTenant) {
        throw new Error(`Invalid tenant ID: ${tenantId}`);
      }
      return;
    }

    if (this.options.debug) {
      console.log(`[TenantContext] Setting tenant: ${tenantId}`);
    }

    await this.db.execute(sql`SELECT set_tenant_context(${tenantId}::UUID)`);
  }

  /**
   * Clears the current tenant context.
   *
   * After calling this, queries on RLS-enabled tables will return
   * no rows (empty results) to prevent accidental data leaks.
   *
   * @example
   * ```typescript
   * await tenantContext.clearTenant();
   * ```
   */
  async clearTenant(): Promise<void> {
    if (this.options.debug) {
      console.log('[TenantContext] Clearing tenant context');
    }

    await this.db.execute(sql`SELECT clear_tenant_context()`);
  }

  /**
   * Gets the current tenant context.
   *
   * @returns TenantContextInfo with isSet and tenantId
   *
   * @example
   * ```typescript
   * const { isSet, tenantId } = await tenantContext.getTenant();
   * if (isSet) {
   *   console.log(`Current tenant: ${tenantId}`);
   * }
   * ```
   */
  async getTenant(): Promise<TenantContextInfo> {
    const result = await this.db.execute<{ get_tenant_context: string | null }>(
      sql`SELECT get_tenant_context()`
    );

    const tenantId = result[0]?.get_tenant_context ?? null;

    return {
      isSet: tenantId !== null,
      tenantId,
    };
  }

  /**
   * Executes a callback within a tenant context.
   *
   * This is the recommended way to use tenant context as it ensures
   * the context is always cleared after the operation, even on errors.
   *
   * @param tenantId - UUID of the tenant (community)
   * @param callback - Async function to execute within tenant context
   * @returns Result of the callback
   * @throws Rethrows any error from the callback after clearing context
   *
   * @example
   * ```typescript
   * const profiles = await tenantContext.withTenant(communityId, async () => {
   *   return await db.select().from(profiles);
   * });
   * ```
   */
  async withTenant<T>(tenantId: string, callback: () => Promise<T>): Promise<T> {
    await this.setTenant(tenantId);
    try {
      return await callback();
    } finally {
      await this.clearTenant();
    }
  }

  /**
   * Executes a callback without tenant context (admin mode).
   *
   * WARNING: This bypasses RLS! Only use for administrative operations
   * that need to see all tenants' data.
   *
   * Requires the database connection to use the arrakis_admin role.
   *
   * @param callback - Async function to execute without tenant context
   * @returns Result of the callback
   *
   * @example
   * ```typescript
   * // Must be connected as arrakis_admin role
   * const allProfiles = await tenantContext.withoutTenant(async () => {
   *   return await db.select().from(profiles);
   * });
   * ```
   */
  async withoutTenant<T>(callback: () => Promise<T>): Promise<T> {
    if (this.options.debug) {
      console.log('[TenantContext] Executing without tenant context (admin mode)');
    }

    await this.clearTenant();
    return await callback();
  }

  /**
   * Validates that the current tenant context matches the expected tenant.
   *
   * Useful for defensive programming to ensure RLS context is correct
   * before performing sensitive operations.
   *
   * @param expectedTenantId - Expected tenant UUID
   * @returns true if context matches
   * @throws Error if context doesn't match
   *
   * @example
   * ```typescript
   * await tenantContext.setTenant(communityId);
   * await tenantContext.assertTenant(communityId); // Verifies
   * ```
   */
  async assertTenant(expectedTenantId: string): Promise<boolean> {
    const { isSet, tenantId } = await this.getTenant();

    if (!isSet) {
      throw new Error('Tenant context not set');
    }

    if (tenantId !== expectedTenantId) {
      throw new Error(
        `Tenant context mismatch: expected ${expectedTenantId}, got ${tenantId}`
      );
    }

    return true;
  }

  /**
   * Validates UUID format
   */
  private isValidUUID(uuid: string): boolean {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(uuid);
  }
}

/**
 * Factory function to create a TenantContext
 *
 * @param db - Drizzle PostgresJsDatabase instance
 * @param options - Configuration options
 * @returns TenantContext instance
 */
export function createTenantContext(
  db: PostgresJsDatabase,
  options?: TenantContextOptions
): TenantContext {
  return new TenantContext(db, options);
}

/**
 * Type guard to check if a value is a valid UUID
 */
export function isValidTenantId(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(value);
}

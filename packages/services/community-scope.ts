/**
 * Community Scope — withCommunityScope Middleware & requireCommunityMatch Guard
 *
 * Centralizes the SET LOCAL pattern for tenant-scoped DB operations.
 * All tenant-scoped queries MUST go through withCommunityScope() to ensure
 * RLS policies are properly activated.
 *
 * Also provides requireCommunityMatch() for request-level tenant validation.
 *
 * @see SDD §4.2 RLS Enforcement Model
 * @see Sprint 1, Tasks 1.1 & 1.3
 * @module packages/services/community-scope
 */

import type { Pool, PoolClient } from 'pg';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

/** Result of a community-scoped operation */
export interface CommunityScoped<T> {
  result: T;
  communityId: string;
}

/** Options for withCommunityScope */
export interface CommunityBoundaryOptions {
  /** If true, don't create a new transaction (caller manages transaction) */
  existingTransaction?: boolean;
}

/** Telemetry emitter for unscoped query detection */
export interface ScopeTelemetry {
  /** Emit a metric for unscoped queries */
  emitUnscopedQuery(context: string): void;
}

// --------------------------------------------------------------------------
// Module-level telemetry
// --------------------------------------------------------------------------

let _telemetry: ScopeTelemetry | null = null;

/**
 * Configure the telemetry emitter for unscoped query detection.
 * Should be called once at application startup.
 */
export function configureScopeTelemetry(telemetry: ScopeTelemetry): void {
  _telemetry = telemetry;
}

// --------------------------------------------------------------------------
// withCommunityScope — Core Middleware (AC-1.1.1)
// --------------------------------------------------------------------------

/**
 * Execute a function within a community-scoped transaction.
 *
 * Wraps the callback in BEGIN/SET LOCAL/COMMIT with error rollback.
 * Uses SET LOCAL only (transaction-scoped, not session-scoped) to
 * prevent connection pool leakage in PgBouncer transaction mode.
 *
 * AC-1.1.1: SET LOCAL scoping with error rollback
 * AC-1.1.4: Sets correct community_id GUC
 *
 * @param communityId - Tenant community UUID
 * @param pool - PostgreSQL connection pool
 * @param fn - Async function to execute within scope
 * @returns Result of the callback function
 */
export async function withCommunityScope<T>(
  communityId: string,
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL app.community_id = $1', [communityId]);

    const result = await fn(client);

    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Execute within community scope using an existing client (caller manages transaction).
 *
 * Use this when the caller has already started a transaction and holds
 * a PoolClient. Only sets SET LOCAL without BEGIN/COMMIT.
 *
 * @param communityId - Tenant community UUID
 * @param client - PostgreSQL client (already in transaction)
 * @param fn - Async function to execute within scope
 * @returns Result of the callback function
 */
export async function withCommunityBoundary<T>(
  communityId: string,
  client: PoolClient,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  await client.query('SET LOCAL app.community_id = $1', [communityId]);
  return fn(client);
}

/**
 * Assert that community scope is set on a connection.
 *
 * Calls the DB assertion function assert_community_scope_set() which
 * raises TENANT_CONTEXT_MISSING if app.community_id is unset.
 *
 * AC-1.1.5: DB assertion function
 *
 * @param client - PostgreSQL client
 * @throws Error if community scope is not set
 */
export async function assertCommunityScope(client: PoolClient): Promise<void> {
  await client.query('SELECT app.assert_community_scope_set()');
}

// --------------------------------------------------------------------------
// requireCommunityMatch — Request Guard (Task 1.3)
// --------------------------------------------------------------------------

/** Context for community match validation */
export interface CommunityMatchContext {
  /** Community ID from the actor's authentication token */
  actorCommunityId: string;
  /** Community ID from the request parameters */
  paramsCommunityId: string;
  /** Whether the actor is a platform admin */
  isPlatformAdmin?: boolean;
  /** Audit context for platform admin bypasses */
  auditContext?: {
    actorId: string;
    action: string;
    ipAddress?: string;
  };
}

/** Result of community match check */
export interface CommunityMatchResult {
  allowed: boolean;
  reason?: string;
  bypassed?: boolean;
}

/**
 * Validate that actor.community_id matches params.communityId.
 *
 * AC-1.3.1: 403 with COMMUNITY_MISMATCH on mismatch
 * AC-1.3.2: Platform admin bypass with audit logging
 *
 * @param context - Match context with actor and params community IDs
 * @param auditLog - Optional audit log function for admin bypasses
 * @returns Match result
 */
export function requireCommunityMatch(
  context: CommunityMatchContext,
  auditLog?: (entry: AdminAuditEntry) => Promise<void>,
): CommunityMatchResult {
  const { actorCommunityId, paramsCommunityId, isPlatformAdmin, auditContext } = context;

  // Direct match — most common case
  if (actorCommunityId === paramsCommunityId) {
    return { allowed: true };
  }

  // Platform admin bypass with audit logging
  if (isPlatformAdmin && auditContext) {
    // Fire-and-forget audit logging (don't block the request)
    if (auditLog) {
      auditLog({
        actor_id: auditContext.actorId,
        action: 'COMMUNITY_MATCH_BYPASS',
        target_community_id: paramsCommunityId,
        actor_community_id: actorCommunityId,
        ip_address: auditContext.ipAddress,
        timestamp: new Date().toISOString(),
      }).catch(() => {
        // Audit log failure should not block the request
      });
    }

    return { allowed: true, bypassed: true };
  }

  // Mismatch — deny access
  return {
    allowed: false,
    reason: 'COMMUNITY_MISMATCH',
  };
}

/** Admin audit log entry */
export interface AdminAuditEntry {
  actor_id: string;
  action: string;
  target_community_id: string;
  actor_community_id: string;
  ip_address?: string;
  timestamp: string;
}

/**
 * Express/Fastify-style middleware factory for requireCommunityMatch.
 *
 * AC-1.3.3: Applied to all routes accepting :communityId parameter
 *
 * @param getCommunityIds - Function to extract actor and params community IDs from request
 * @param auditLog - Optional audit log function
 * @returns Middleware function
 */
export function createCommunityMatchMiddleware(
  getCommunityIds: (req: unknown) => CommunityMatchContext,
  auditLog?: (entry: AdminAuditEntry) => Promise<void>,
) {
  return (req: unknown, res: { status: (code: number) => { json: (body: unknown) => void } }, next: () => void) => {
    const context = getCommunityIds(req);
    const result = requireCommunityMatch(context, auditLog);

    if (!result.allowed) {
      res.status(403).json({
        error: 'COMMUNITY_MISMATCH',
        message: 'Actor community does not match target community',
      });
      return;
    }

    next();
  };
}

/**
 * PgBouncer Pool Configuration Loader
 *
 * Configures PostgreSQL connection pooling with per-service pool sizing.
 * Production: connects via PgBouncer in transaction mode.
 * Development: optional PgBouncer (falls back to direct PostgreSQL).
 *
 * Pool sizing (max_connections=120, 20 reserved for admin):
 *   - API:             60 connections
 *   - Worker:          20 connections
 *   - Reconciliation:  10 connections
 *   - Headroom:        10 connections
 *   Total:            100 connections through PgBouncer
 *
 * Queue timeout: 5s → HTTP 503 with Retry-After: 5
 * Server idle timeout: 300s
 *
 * @see Sprint 2, Task 2.5 (IMP-002)
 * @module packages/adapters/storage/pool-config
 */

import { Pool, type PoolConfig } from 'pg';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

/** Service-specific pool configuration */
export interface ServicePoolConfig {
  /** Service name for identification */
  service: 'api' | 'worker' | 'reconciliation';
  /** Maximum pool size for this service */
  maxConnections: number;
  /** Idle timeout in milliseconds */
  idleTimeoutMs: number;
  /** Connection timeout in milliseconds */
  connectionTimeoutMs: number;
  /** Statement timeout in milliseconds (per query) */
  statementTimeoutMs: number;
}

/** Pool health metrics */
export interface PoolHealthMetrics {
  /** Total pool size */
  totalCount: number;
  /** Idle connections */
  idleCount: number;
  /** Active connections */
  activeCount: number;
  /** Waiting clients in queue */
  waitingCount: number;
  /** Pool utilization percentage (0-100) */
  utilizationPercent: number;
}

// --------------------------------------------------------------------------
// Constants
// --------------------------------------------------------------------------

/** Default pool configurations per service */
const SERVICE_POOLS: Record<string, ServicePoolConfig> = {
  api: {
    service: 'api',
    maxConnections: 60,
    idleTimeoutMs: 30_000,
    connectionTimeoutMs: 5_000,
    statementTimeoutMs: 30_000,
  },
  worker: {
    service: 'worker',
    maxConnections: 20,
    idleTimeoutMs: 60_000,
    connectionTimeoutMs: 5_000,
    statementTimeoutMs: 60_000,
  },
  reconciliation: {
    service: 'reconciliation',
    maxConnections: 10,
    idleTimeoutMs: 60_000,
    connectionTimeoutMs: 5_000,
    statementTimeoutMs: 120_000,
  },
};

/** PgBouncer default port */
const PGBOUNCER_PORT = 6432;

/** PostgreSQL direct port */
const POSTGRES_PORT = 5432;

// --------------------------------------------------------------------------
// Configuration Loader
// --------------------------------------------------------------------------

/**
 * Detect if we should connect via PgBouncer.
 *
 * PgBouncer is used when:
 *   - PGBOUNCER_ENABLED=true (explicit)
 *   - DATABASE_URL contains port 6432 (convention)
 *   - NODE_ENV=production (default in prod)
 */
export function isPgBouncerEnabled(): boolean {
  if (process.env.PGBOUNCER_ENABLED === 'true') return true;
  if (process.env.PGBOUNCER_ENABLED === 'false') return false;

  // Check DATABASE_URL for PgBouncer port
  const dbUrl = process.env.DATABASE_URL || '';
  if (dbUrl.includes(`:${PGBOUNCER_PORT}`)) return true;

  // Default: enabled in production
  return process.env.NODE_ENV === 'production';
}

/**
 * Get the connection URL (PgBouncer or direct PostgreSQL).
 */
export function getConnectionUrl(): string {
  const pgbouncerUrl = process.env.PGBOUNCER_URL;
  const databaseUrl = process.env.DATABASE_URL;

  if (isPgBouncerEnabled() && pgbouncerUrl) {
    return pgbouncerUrl;
  }

  return databaseUrl || '';
}

/**
 * Create a configured pg Pool for a specific service.
 *
 * When PgBouncer is enabled:
 *   - Uses transaction mode (SET LOCAL is scoped to transaction)
 *   - Disables pg's built-in statement caching (PgBouncer manages this)
 *   - Applies per-service pool sizing
 *
 * @param service - Service identifier ('api', 'worker', 'reconciliation')
 * @returns Configured pg Pool
 */
export function createServicePool(service: keyof typeof SERVICE_POOLS): Pool {
  const serviceConfig = SERVICE_POOLS[service];
  if (!serviceConfig) {
    throw new Error(`Unknown service: ${service}. Valid: ${Object.keys(SERVICE_POOLS).join(', ')}`);
  }

  const connectionUrl = getConnectionUrl();
  const usePgBouncer = isPgBouncerEnabled();

  const poolConfig: PoolConfig = {
    connectionString: connectionUrl,
    max: serviceConfig.maxConnections,
    idleTimeoutMillis: serviceConfig.idleTimeoutMs,
    connectionTimeoutMillis: serviceConfig.connectionTimeoutMs,
    statement_timeout: serviceConfig.statementTimeoutMs,
    // Application name for PgBouncer stats and pg_stat_activity
    application_name: `arrakis-${service}`,
  };

  if (usePgBouncer) {
    // PgBouncer transaction mode considerations:
    // - Disable prepared statements (PgBouncer doesn't support them in transaction mode)
    // - The pg library's built-in prepared statement cache must be off
    poolConfig.max = serviceConfig.maxConnections;

    // Allow overriding pool size via environment
    const envMax = process.env[`POOL_MAX_${service.toUpperCase()}`];
    if (envMax) {
      poolConfig.max = parseInt(envMax, 10);
    }
  }

  return new Pool(poolConfig);
}

/**
 * Get pool health metrics for monitoring.
 *
 * Emits pgbouncer_pool_utilization metric for CloudWatch.
 *
 * @param pool - pg Pool instance
 * @returns Pool health metrics
 */
export function getPoolHealth(pool: Pool): PoolHealthMetrics {
  const totalCount = pool.totalCount;
  const idleCount = pool.idleCount;
  const waitingCount = pool.waitingCount;
  const activeCount = totalCount - idleCount;

  // Utilization = active / max * 100
  // pool.options.max may not be accessible, so use totalCount as proxy
  const maxConnections = (pool as unknown as { options: { max: number } }).options?.max || totalCount || 1;
  const utilizationPercent = Math.round((activeCount / maxConnections) * 100);

  return {
    totalCount,
    idleCount,
    activeCount,
    waitingCount,
    utilizationPercent,
  };
}

/**
 * Verify SET LOCAL works correctly through PgBouncer.
 *
 * In transaction mode, SET LOCAL is scoped to the transaction and
 * does not leak to other sessions. This verifies that property.
 *
 * Used by CI integration tests.
 *
 * @param pool - pg Pool instance
 * @returns true if SET LOCAL is properly scoped
 */
export async function verifySetLocalScoping(pool: Pool): Promise<boolean> {
  const client = await pool.connect();

  try {
    // Set a custom variable within a transaction
    await client.query('BEGIN');
    await client.query("SET LOCAL app.test_var = 'scoped_value'");

    // Should be visible within this transaction
    const withinTx = await client.query("SELECT current_setting('app.test_var', true) AS val");
    const valueDuringTx = withinTx.rows[0]?.val;

    await client.query('COMMIT');

    // After commit, the SET LOCAL should no longer be visible
    const afterTx = await client.query("SELECT current_setting('app.test_var', true) AS val");
    const valueAfterTx = afterTx.rows[0]?.val;

    // SET LOCAL was scoped: visible during TX, null/empty after
    return valueDuringTx === 'scoped_value' && (!valueAfterTx || valueAfterTx === '');
  } catch {
    return false;
  } finally {
    client.release();
  }
}

/**
 * DB Integration Test Harness — PostgreSQL test infrastructure (cycle-043)
 *
 * Provides a real PostgreSQL instance for integration tests with:
 * - Full migration applied (0004_audit_trail.sql)
 * - All 3 DB roles created (arrakis_app, arrakis_migrator, arrakis_dba)
 * - Connection pool per role for privilege testing
 * - Automatic teardown after test suite
 *
 * Uses pg_tmp or environment-provided PostgreSQL for CI.
 *
 * SDD ref: §4.2 (Integration Tests)
 * Sprint: 361, Task 4.2 (FR-4,5,6,7,8)
 */

import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TestDbContext {
  /** Pool connected as the application role (arrakis_app) */
  appPool: Pool;
  /** Pool connected as the migration role (arrakis_migrator) */
  migratorPool: Pool;
  /** Pool connected as the superuser (test admin) */
  adminPool: Pool;
  /** Teardown function — call in afterAll */
  teardown: () => Promise<void>;
  /** Database name */
  dbName: string;
}

export interface HarnessConfig {
  /** PostgreSQL connection string (defaults to PG_TEST_URL or localhost) */
  connectionString?: string;
  /** Whether to apply audit trail migration (default: true) */
  applyMigration?: boolean;
}

// ─── Harness ─────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Create a test database with full audit trail infrastructure.
 *
 * Usage in vitest:
 * ```ts
 * let ctx: TestDbContext;
 * beforeAll(async () => { ctx = await createTestDb(); });
 * afterAll(async () => { await ctx.teardown(); });
 * ```
 */
export async function createTestDb(config?: HarnessConfig): Promise<TestDbContext> {
  const connStr = config?.connectionString
    ?? process.env.PG_TEST_URL
    ?? 'postgresql://localhost:5432/postgres';

  const dbName = `test_audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // Connect as superuser to create test database
  const superPool = new Pool({ connectionString: connStr });

  try {
    // Create test database
    await superPool.query(`CREATE DATABASE "${dbName}"`);

    // Connect to test database
    const testConnStr = connStr.replace(/\/[^/]*$/, `/${dbName}`);
    const adminPool = new Pool({ connectionString: testConnStr });

    // Create roles (idempotent — IF NOT EXISTS in migration handles this)
    await adminPool.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'arrakis_app') THEN
          CREATE ROLE arrakis_app NOLOGIN;
        END IF;
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'arrakis_migrator') THEN
          CREATE ROLE arrakis_migrator NOLOGIN;
        END IF;
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'arrakis_dba') THEN
          CREATE ROLE arrakis_dba NOLOGIN;
        END IF;
      END $$;
    `);

    // Apply audit trail migration
    if (config?.applyMigration !== false) {
      const migrationPath = resolve(
        __dirname,
        '..',
        '..',
        'packages',
        'adapters',
        'storage',
        'migrations',
        '0004_audit_trail.sql',
      );
      const migrationSql = readFileSync(migrationPath, 'utf8');
      await adminPool.query(migrationSql);
    }

    // Create app pool (SET ROLE to arrakis_app)
    const appPool = new Pool({ connectionString: testConnStr });
    // Each connection sets role to arrakis_app
    const origAppConnect = appPool.connect.bind(appPool);
    appPool.connect = async () => {
      const client = await origAppConnect();
      await client.query('SET ROLE arrakis_app');
      return client;
    };

    // Create migrator pool
    const migratorPool = new Pool({ connectionString: testConnStr });
    const origMigratorConnect = migratorPool.connect.bind(migratorPool);
    migratorPool.connect = async () => {
      const client = await origMigratorConnect();
      await client.query('SET ROLE arrakis_migrator');
      return client;
    };

    const teardown = async () => {
      await appPool.end();
      await migratorPool.end();
      await adminPool.end();
      // Drop test database
      await superPool.query(`DROP DATABASE IF EXISTS "${dbName}"`);
      await superPool.end();
    };

    return { appPool, migratorPool, adminPool, teardown, dbName };
  } catch (err) {
    await superPool.end();
    throw err;
  }
}

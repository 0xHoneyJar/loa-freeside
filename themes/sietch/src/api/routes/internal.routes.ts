/**
 * Internal Routes Module
 * Sprint 175: Internal API endpoints called by Trigger.dev
 *
 * These endpoints run on ECS which has VPC access to RDS.
 * Trigger.dev workers call these endpoints via HTTP instead of
 * directly connecting to RDS (which is blocked by VPC isolation).
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import postgres from 'postgres';
import { config } from '../../config.js';
import { logger } from '../../utils/logger.js';
import { runEligibilitySyncOnServer } from '../../services/eligibility-sync.js';

/**
 * Internal routes router
 */
export const internalRouter = Router();

/**
 * Internal API key middleware
 * Uses a dedicated INTERNAL_API_KEY env var for Trigger.dev -> ECS communication
 */
function requireInternalApiKey(req: Request, res: Response, next: NextFunction): void {
  const internalKey = process.env.INTERNAL_API_KEY;

  if (!internalKey) {
    logger.warn('INTERNAL_API_KEY not configured - internal endpoints disabled');
    res.status(503).json({
      error: 'Internal API not configured',
      message: 'INTERNAL_API_KEY environment variable not set',
    });
    return;
  }

  const providedKey = req.headers['x-internal-api-key'];

  if (!providedKey || providedKey !== internalKey) {
    logger.warn({ hasKey: !!providedKey }, 'Invalid internal API key');
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid or missing X-Internal-API-Key header',
    });
    return;
  }

  next();
}

// Apply internal API key requirement to all routes
internalRouter.use(requireInternalApiKey);

/**
 * POST /internal/sync-eligibility
 * Trigger eligibility sync job from Trigger.dev
 *
 * This endpoint runs the same logic as the sync task, but on ECS
 * which has VPC access to RDS. Trigger.dev calls this endpoint
 * via HTTP instead of trying to connect to RDS directly.
 */
internalRouter.post('/sync-eligibility', async (req: Request, res: Response) => {
  const startTime = Date.now();
  logger.info('Internal eligibility sync triggered');

  try {
    // Run the sync logic
    const result = await runEligibilitySyncOnServer();

    const duration = Date.now() - startTime;
    logger.info({ duration, snapshotId: result.snapshotId }, 'Internal eligibility sync completed');

    res.json({
      ...result,
      duration_ms: duration,
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    logger.error({ error: errorMessage, duration }, 'Internal eligibility sync failed');

    res.status(500).json({
      success: false,
      error: errorMessage,
      duration_ms: duration,
    });
  }
});

/**
 * GET /internal/health
 * Health check for internal API (Trigger.dev can use to verify connectivity)
 */
internalRouter.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'sietch-internal',
    timestamp: new Date().toISOString(),
    database_url_configured: !!config.database.url,
  });
});

/**
 * POST /internal/run-migration
 * Run eligibility tables migration
 *
 * Creates the eligibility_current, eligibility_snapshots, and related tables
 * if they don't exist. Safe to run multiple times (IF NOT EXISTS).
 */
internalRouter.post('/run-migration', async (_req: Request, res: Response) => {
  const startTime = Date.now();
  logger.info('Running eligibility tables migration');

  if (!config.database.url) {
    res.status(500).json({
      success: false,
      error: 'DATABASE_URL not configured',
    });
    return;
  }

  const sql = postgres(config.database.url, {
    max: 1,
    idle_timeout: 20,
    connect_timeout: 30,
  });

  const tablesCreated: string[] = [];

  try {
    // T-1: Current eligibility
    // Use NUMERIC for BGT values - BIGINT overflows with wei amounts (18 decimals)
    // Drop and recreate to fix schema if columns were previously BIGINT
    await sql`DROP TABLE IF EXISTS eligibility_current`;
    await sql`
      CREATE TABLE eligibility_current (
        address TEXT PRIMARY KEY,
        rank INTEGER NOT NULL,
        bgt_claimed NUMERIC NOT NULL,
        bgt_burned NUMERIC NOT NULL,
        bgt_held NUMERIC NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('naib', 'fedaykin', 'none')),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
      )
    `;
    tablesCreated.push('eligibility_current');
    await sql`CREATE INDEX IF NOT EXISTS idx_eligibility_current_rank ON eligibility_current(rank)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_eligibility_current_role ON eligibility_current(role)`;

    // T-2: Historical snapshots
    await sql`
      CREATE TABLE IF NOT EXISTS eligibility_snapshots (
        id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
        data JSONB NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
      )
    `;
    tablesCreated.push('eligibility_snapshots');
    await sql`CREATE INDEX IF NOT EXISTS idx_eligibility_snapshots_created ON eligibility_snapshots(created_at DESC)`;

    // T-3: Admin overrides
    await sql`
      CREATE TABLE IF NOT EXISTS eligibility_admin_overrides (
        id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
        address TEXT NOT NULL,
        action TEXT NOT NULL CHECK (action IN ('add', 'remove')),
        reason TEXT NOT NULL,
        created_by TEXT NOT NULL,
        expires_at TIMESTAMP WITH TIME ZONE,
        active BOOLEAN DEFAULT TRUE NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
      )
    `;
    tablesCreated.push('eligibility_admin_overrides');
    await sql`CREATE INDEX IF NOT EXISTS idx_eligibility_overrides_address ON eligibility_admin_overrides(address)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_eligibility_overrides_active ON eligibility_admin_overrides(active, expires_at)`;

    // T-4: Health status
    await sql`
      CREATE TABLE IF NOT EXISTS eligibility_health_status (
        id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        last_success TIMESTAMP WITH TIME ZONE,
        last_failure TIMESTAMP WITH TIME ZONE,
        consecutive_failures INTEGER DEFAULT 0 NOT NULL,
        in_grace_period BOOLEAN DEFAULT FALSE NOT NULL,
        last_synced_block BIGINT,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
      )
    `;
    tablesCreated.push('eligibility_health_status');

    // Insert default health status
    await sql`
      INSERT INTO eligibility_health_status (id, consecutive_failures, in_grace_period)
      VALUES (1, 0, FALSE)
      ON CONFLICT (id) DO NOTHING
    `;

    // T-5: Wallet verifications
    await sql`
      CREATE TABLE IF NOT EXISTS wallet_verifications (
        discord_user_id TEXT PRIMARY KEY,
        wallet_address TEXT NOT NULL,
        verified_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
        signature TEXT,
        message TEXT
      )
    `;
    tablesCreated.push('wallet_verifications');
    await sql`CREATE INDEX IF NOT EXISTS idx_wallet_verifications_address ON wallet_verifications(wallet_address)`;

    // T-6: Claim events cache
    await sql`
      CREATE TABLE IF NOT EXISTS eligibility_claim_events (
        tx_hash TEXT NOT NULL,
        log_index INTEGER NOT NULL,
        block_number BIGINT NOT NULL,
        address TEXT NOT NULL,
        amount BIGINT NOT NULL,
        vault_address TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
        PRIMARY KEY (tx_hash, log_index)
      )
    `;
    tablesCreated.push('eligibility_claim_events');
    await sql`CREATE INDEX IF NOT EXISTS idx_eligibility_claim_events_address ON eligibility_claim_events(address)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_eligibility_claim_events_block ON eligibility_claim_events(block_number)`;

    // T-7: Burn events cache
    await sql`
      CREATE TABLE IF NOT EXISTS eligibility_burn_events (
        tx_hash TEXT NOT NULL,
        log_index INTEGER NOT NULL,
        block_number BIGINT NOT NULL,
        from_address TEXT NOT NULL,
        amount BIGINT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
        PRIMARY KEY (tx_hash, log_index)
      )
    `;
    tablesCreated.push('eligibility_burn_events');
    await sql`CREATE INDEX IF NOT EXISTS idx_eligibility_burn_events_address ON eligibility_burn_events(from_address)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_eligibility_burn_events_block ON eligibility_burn_events(block_number)`;

    const duration = Date.now() - startTime;
    logger.info({ duration, tablesCreated }, 'Eligibility tables migration completed');

    res.json({
      success: true,
      tablesCreated,
      duration_ms: duration,
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    logger.error({ error: errorMessage, duration, tablesCreated }, 'Migration failed');

    res.status(500).json({
      success: false,
      error: errorMessage,
      tablesCreated,
      duration_ms: duration,
    });
  } finally {
    await sql.end();
  }
});

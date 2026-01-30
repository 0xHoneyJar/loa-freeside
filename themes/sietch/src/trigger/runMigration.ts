import { task, logger as triggerLogger } from '@trigger.dev/sdk/v3';
import postgres from 'postgres';
import { config } from '../config.js';

/**
 * One-time migration task to create eligibility tables
 * Run once then delete this file
 */
export const runMigrationTask = task({
  id: 'run-migration',
  run: async () => {
    triggerLogger.info('Starting eligibility tables migration');

    if (!config.database.url) {
      throw new Error('DATABASE_URL not configured');
    }

    const sql = postgres(config.database.url, {
      max: 1,
      idle_timeout: 20,
      connect_timeout: 30,
    });

    try {
      // T-1: Current eligibility
      await sql`
        CREATE TABLE IF NOT EXISTS eligibility_current (
          address TEXT PRIMARY KEY,
          rank INTEGER NOT NULL,
          bgt_claimed BIGINT NOT NULL,
          bgt_burned BIGINT NOT NULL,
          bgt_held BIGINT NOT NULL,
          role TEXT NOT NULL CHECK (role IN ('naib', 'fedaykin', 'none')),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
        )
      `;
      triggerLogger.info('Created eligibility_current table');

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
      triggerLogger.info('Created eligibility_snapshots table');

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
      triggerLogger.info('Created eligibility_admin_overrides table');

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
      triggerLogger.info('Created eligibility_health_status table');

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
      triggerLogger.info('Created wallet_verifications table');

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
      triggerLogger.info('Created eligibility_claim_events table');

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
      triggerLogger.info('Created eligibility_burn_events table');

      await sql`CREATE INDEX IF NOT EXISTS idx_eligibility_burn_events_address ON eligibility_burn_events(from_address)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_eligibility_burn_events_block ON eligibility_burn_events(block_number)`;

      triggerLogger.info('All eligibility tables created successfully');

      return {
        success: true,
        tablesCreated: [
          'eligibility_current',
          'eligibility_snapshots',
          'eligibility_admin_overrides',
          'eligibility_health_status',
          'wallet_verifications',
          'eligibility_claim_events',
          'eligibility_burn_events',
        ],
      };
    } finally {
      await sql.end();
    }
  },
});

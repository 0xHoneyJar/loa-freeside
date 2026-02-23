/**
 * Seed Test Credits — Bootstrap a test community with credit lots
 *
 * Creates a credit lot (source='seed', amount_micro=10_000_000) for a test
 * community. Bypasses NOWPayments webhook. Sets Redis budget limit.
 *
 * Usage:
 *   npx tsx scripts/seed-test-credits.ts [--community-id UUID] [--amount-micro N]
 *
 * Environment:
 *   DATABASE_URL — PostgreSQL connection string
 *   REDIS_URL — Redis connection string
 *
 * @see Sprint 0B, Task 0B.3
 * @module scripts/seed-test-credits
 */

import { Pool } from 'pg';
import Redis from 'ioredis';
import { mintCreditLot } from '../packages/services/credit-lot-service.js';

// --------------------------------------------------------------------------
// Configuration
// --------------------------------------------------------------------------

const DEFAULT_AMOUNT_MICRO = 10_000_000n; // $10.00
const DEFAULT_COMMUNITY_ID = '00000000-0000-0000-0000-000000000001';

interface SeedConfig {
  communityId: string;
  amountMicro: bigint;
  databaseUrl: string;
  redisUrl: string;
}

// --------------------------------------------------------------------------
// Argument Parsing
// --------------------------------------------------------------------------

function parseArgs(): SeedConfig {
  const args = process.argv.slice(2);
  let communityId = DEFAULT_COMMUNITY_ID;
  let amountMicro = DEFAULT_AMOUNT_MICRO;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--community-id' && args[i + 1]) {
      communityId = args[++i];
    } else if (args[i] === '--amount-micro' && args[i + 1]) {
      amountMicro = BigInt(args[++i]);
    }
  }

  const databaseUrl = process.env.DATABASE_URL;
  const redisUrl = process.env.REDIS_URL;

  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is required');
  }
  if (!redisUrl) {
    throw new Error('REDIS_URL environment variable is required');
  }

  return { communityId, amountMicro, databaseUrl, redisUrl };
}

// --------------------------------------------------------------------------
// Seed Logic
// --------------------------------------------------------------------------

async function seedTestCredits(config: SeedConfig): Promise<void> {
  const pool = new Pool({ connectionString: config.databaseUrl });
  const redis = new Redis(config.redisUrl);

  try {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Set tenant context for RLS
      await client.query('SELECT app.set_community_context($1)', [config.communityId]);

      // Mint credit lot (idempotent via payment_id)
      const seedPaymentId = `seed-${config.communityId}-${Date.now()}`;
      const lotId = await mintCreditLot(client, {
        community_id: config.communityId,
        source: 'seed',
        amount_micro: config.amountMicro,
        payment_id: seedPaymentId,
      });

      if (lotId) {
        console.log(`[SEED] Created credit lot: ${lotId}`);
        console.log(`[SEED]   community: ${config.communityId}`);
        console.log(`[SEED]   amount: ${config.amountMicro} micro-USD ($${Number(config.amountMicro) / 1_000_000})`);
        console.log(`[SEED]   source: seed`);
        console.log(`[SEED]   payment_id: ${seedPaymentId}`);
      } else {
        console.log(`[SEED] Credit lot already exists for payment_id: ${seedPaymentId}`);
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    // Set Redis budget limit
    const currentMonth = getCurrentMonth();
    const limitKey = `agent:budget:limit:${config.communityId}`;
    const committedKey = `agent:budget:committed:${config.communityId}:${currentMonth}`;
    const reservedKey = `agent:budget:reserved:${config.communityId}:${currentMonth}`;

    // Convert micro-USD to cents for Redis (1 cent = 10,000 micro-USD)
    const limitCents = config.amountMicro / 10000n;

    await redis.set(limitKey, limitCents.toString());
    // Initialize committed and reserved to 0 if not set
    await redis.setnx(committedKey, '0');
    await redis.setnx(reservedKey, '0');

    console.log(`[SEED] Redis budget initialized:`);
    console.log(`[SEED]   limit: ${limitCents} cents`);
    console.log(`[SEED]   committed: 0`);
    console.log(`[SEED]   reserved: 0`);
    console.log(`[SEED]   month: ${currentMonth}`);
    console.log(`[SEED] Done.`);
  } finally {
    await redis.quit();
    await pool.end();
  }
}

function getCurrentMonth(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

// --------------------------------------------------------------------------
// Main
// --------------------------------------------------------------------------

seedTestCredits(parseArgs()).catch((error) => {
  console.error('[SEED] Fatal error:', error.message);
  process.exit(1);
});

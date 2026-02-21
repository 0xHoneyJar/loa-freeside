/**
 * Ownership Re-verification Service (Sprint 4, Task 4.8)
 *
 * Handles NFT ownership transfer detection and thread lifecycle:
 * - Background re-verification job (every 24h)
 * - Cache invalidation on ownership change
 * - Deactivates old threads and posts transfer notice
 *
 * @see SDD §4.1 Thread Management
 * @see PRD FR-4.2 NFT-Gated Agent Access
 */

import type { Logger } from 'pino';
import type { Redis } from 'ioredis';
import type { DiscordRestService } from '../../services/DiscordRest.js';
import {
  getProfileByDiscordId,
  getCommunityByGuildId,
} from '../../data/index.js';
import {
  getDb,
  getAllActiveThreads,
  deactivateThread,
  updateThreadLastActive,
} from '../commands/my-agent-data.js';

// --------------------------------------------------------------------------
// Constants
// --------------------------------------------------------------------------

/** Redis key prefix for ownership verification cache */
const OWNERSHIP_CACHE_PREFIX = 'agent:ownership:verified:';

/** Re-verification interval (24 hours in milliseconds) */
const REVERIFICATION_INTERVAL_MS = 24 * 60 * 60 * 1000;

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

export interface OwnershipReverificationDeps {
  discord: DiscordRestService;
  redis: Redis;
  logger: Logger;
}

// --------------------------------------------------------------------------
// Cache Invalidation
// --------------------------------------------------------------------------

/**
 * Invalidate ownership cache for a specific thread and user.
 * Called when a transfer event is detected or during re-verification.
 */
export async function invalidateOwnershipCache(
  redis: Redis,
  threadId: string,
  log: Logger,
): Promise<void> {
  try {
    // Scan for all cache keys matching this thread (any user, any community)
    const pattern = `${OWNERSHIP_CACHE_PREFIX}${threadId}:*`;
    let cursor = '0';
    const keysToDelete: string[] = [];

    do {
      const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = nextCursor;
      keysToDelete.push(...keys);
    } while (cursor !== '0');

    if (keysToDelete.length > 0) {
      await redis.del(...keysToDelete);
      log.info({ threadId, keysDeleted: keysToDelete.length }, 'Ownership cache invalidated');
    }
  } catch (err) {
    log.warn({ err, threadId }, 'Failed to invalidate ownership cache');
  }
}

// --------------------------------------------------------------------------
// Thread Transfer Handling
// --------------------------------------------------------------------------

/**
 * Handle ownership transfer for a thread.
 * Posts notice, deactivates the thread, and clears cache.
 */
async function handleTransfer(
  threadId: string,
  ownerWallet: string,
  deps: OwnershipReverificationDeps,
): Promise<void> {
  const { discord, redis, logger: log } = deps;

  // Post transfer notice in the thread
  await discord.sendMessage(threadId, {
    content:
      '**Ownership Transferred**\n\n' +
      'NFT ownership has changed. This thread is now inactive.\n' +
      'The new holder can use `/my-agent` to create their own thread.',
  }).catch((err) => {
    log.warn({ err, threadId }, 'Failed to post transfer notice');
  });

  // Deactivate the thread in database
  const db = getDb();
  await deactivateThread(db, threadId);

  // Clear ownership cache for this thread
  await invalidateOwnershipCache(redis, threadId, log);

  log.info({ threadId, ownerWallet }, 'Thread deactivated due to ownership transfer');
}

// --------------------------------------------------------------------------
// Background Re-verification Job
// --------------------------------------------------------------------------

/**
 * Re-verify ownership for all active agent threads.
 * Checks each thread's ownerWallet against current on-chain state
 * via the profile's conviction tier (tier > 0 = verified holder).
 *
 * Runs every 24h as a background job.
 */
async function reverifyAllThreads(deps: OwnershipReverificationDeps): Promise<void> {
  const { logger: log } = deps;
  const db = getDb();

  log.info('Starting background ownership re-verification');

  let verified = 0;
  let transferred = 0;
  let errors = 0;

  try {
    const threads = await getAllActiveThreads(db);
    log.info({ threadCount: threads.length }, 'Active threads to re-verify');

    for (const thread of threads) {
      try {
        // Look up the profile that owns this thread by wallet address
        // We need to find if any profile in this community still has this wallet + valid tier
        const profiles = await findProfileByWallet(thread.communityId, thread.ownerWallet);

        if (!profiles || profiles.tier < 1) {
          // Ownership lost — tier dropped or profile gone
          log.info(
            { threadId: thread.threadId, ownerWallet: thread.ownerWallet },
            'Ownership lost — deactivating thread',
          );
          await handleTransfer(thread.threadId, thread.ownerWallet, deps);
          transferred++;
        } else {
          // Still valid
          verified++;
        }
      } catch (err) {
        log.error({ err, threadId: thread.threadId }, 'Error re-verifying thread');
        errors++;
      }
    }
  } catch (err) {
    log.error({ err }, 'Failed to fetch active threads for re-verification');
    return;
  }

  log.info(
    { verified, transferred, errors },
    'Background ownership re-verification complete',
  );
}

/**
 * Look up a profile by wallet in a community and return tier info.
 * Returns null if no valid profile found.
 */
async function findProfileByWallet(
  communityId: string,
  walletAddress: string,
): Promise<{ tier: number } | null> {
  // Import dynamically to avoid circular dependency
  const { getProfileByWallet } = await import('../../data/database.js');

  const profile = await getProfileByWallet(communityId, walletAddress);
  if (!profile) return null;

  const rawTier = profile.tier ?? 0;
  const parsedTier = typeof rawTier === 'number' ? rawTier : Number(rawTier);
  const tier = Number.isFinite(parsedTier) ? parsedTier : 0;
  return { tier };
}

// --------------------------------------------------------------------------
// Job Lifecycle
// --------------------------------------------------------------------------

let reverificationTimer: ReturnType<typeof setInterval> | null = null;
let startupTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Start the background re-verification job.
 * Runs after a 60s startup delay, then every 24 hours.
 */
export function startReverificationJob(deps: OwnershipReverificationDeps): void {
  const log = deps.logger.child({ job: 'ownership-reverification' });

  // Run initial re-verification after a 60s startup delay
  startupTimer = setTimeout(() => {
    startupTimer = null;
    reverifyAllThreads({ ...deps, logger: log }).catch((err) => {
      log.error({ err }, 'Initial re-verification failed');
    });
  }, 60_000);

  if (startupTimer && typeof startupTimer.unref === 'function') {
    startupTimer.unref();
  }

  // Schedule recurring job every 24h
  reverificationTimer = setInterval(() => {
    reverifyAllThreads({ ...deps, logger: log }).catch((err) => {
      log.error({ err }, 'Scheduled re-verification failed');
    });
  }, REVERIFICATION_INTERVAL_MS);

  if (reverificationTimer && typeof reverificationTimer.unref === 'function') {
    reverificationTimer.unref();
  }

  log.info({ intervalMs: REVERIFICATION_INTERVAL_MS }, 'Background re-verification job started');
}

/**
 * Stop the background re-verification job.
 */
export function stopReverificationJob(): void {
  if (startupTimer) {
    clearTimeout(startupTimer);
    startupTimer = null;
  }
  if (reverificationTimer) {
    clearInterval(reverificationTimer);
    reverificationTimer = null;
  }
}

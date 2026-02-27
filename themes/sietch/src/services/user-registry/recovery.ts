/**
 * Point-in-Time Recovery for User Registry
 * Sprint 176: Global User Registry
 *
 * Provides event replay capabilities for reconstructing identity state
 * at any point in time. Used for audit investigations and disaster recovery.
 *
 * @module services/user-registry/recovery
 */

import { eq, and, lte } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { identityEvents, userIdentities } from '../../db/pg-schema.js';
import { IdentityEventType, type IdentityEventData } from './types.js';
import { logger } from '../../utils/logger.js';

/**
 * Reconstructed identity state at a point in time
 */
export interface RecoveredIdentityState {
  /** Timestamp the state was recovered to */
  asOf: Date;
  /** Identity ID */
  identityId: string;
  /** Reconstructed state */
  state: {
    discordId: string;
    discordUsername: string | null;
    discordDiscriminator: string | null;
    primaryWallet: string | null;
    wallets: string[];
    status: 'active' | 'suspended' | 'deleted';
    twitterHandle: string | null;
    telegramId: string | null;
  };
  /** Number of events replayed */
  eventCount: number;
  /** Events that were replayed */
  events: Array<{
    eventId: string;
    eventType: IdentityEventType;
    occurredAt: Date;
  }>;
}

/**
 * Recover identity state at a specific point in time
 *
 * Replays events from creation up to the target timestamp to reconstruct
 * the exact state of the identity at that moment.
 *
 * @param db - Database connection
 * @param identityId - Identity to recover
 * @param targetTimestamp - Point in time to recover to
 * @returns Reconstructed state at target timestamp
 */
export async function recoverIdentityAtTimestamp(
  db: PostgresJsDatabase,
  identityId: string,
  targetTimestamp: Date
): Promise<RecoveredIdentityState | null> {
  // Verify identity exists
  const identityCheck = await db
    .select({ identityId: userIdentities.identityId })
    .from(userIdentities)
    .where(eq(userIdentities.identityId, identityId))
    .limit(1);

  if (identityCheck.length === 0) {
    logger.warn({ identityId }, 'Identity not found for recovery');
    return null;
  }

  // Get events up to target timestamp
  const events = await db
    .select()
    .from(identityEvents)
    .where(
      and(
        eq(identityEvents.identityId, identityId),
        lte(identityEvents.occurredAt, targetTimestamp)
      )
    )
    .orderBy(identityEvents.occurredAt);

  if (events.length === 0) {
    logger.warn({ identityId, targetTimestamp }, 'No events found up to target timestamp');
    return null;
  }

  // Initialize empty state
  const state: RecoveredIdentityState['state'] = {
    discordId: '',
    discordUsername: null,
    discordDiscriminator: null,
    primaryWallet: null,
    wallets: [],
    status: 'active',
    twitterHandle: null,
    telegramId: null,
  };

  const replayedEvents: RecoveredIdentityState['events'] = [];

  // Replay events to reconstruct state
  for (const event of events) {
    const data = event.eventData as Record<string, unknown>;
    const eventType = event.eventType as IdentityEventType;

    replayedEvents.push({
      eventId: event.eventId,
      eventType,
      occurredAt: event.occurredAt,
    });

    switch (eventType) {
      case IdentityEventType.IDENTITY_CREATED:
        state.discordId = data.discord_id as string;
        state.discordUsername = (data.discord_username as string) || null;
        state.discordDiscriminator = (data.discord_discriminator as string) || null;
        state.status = 'active';
        break;

      case IdentityEventType.DISCORD_LINKED:
      case IdentityEventType.DISCORD_UPDATED:
        if (data.discord_username !== undefined) {
          state.discordUsername = data.discord_username as string;
        }
        if (data.discord_discriminator !== undefined) {
          state.discordDiscriminator = data.discord_discriminator as string;
        }
        break;

      case IdentityEventType.WALLET_VERIFIED:
        const walletAddress = (data.wallet_address as string).toLowerCase();
        if (!state.wallets.includes(walletAddress)) {
          state.wallets.push(walletAddress);
        }
        if (data.is_primary) {
          state.primaryWallet = walletAddress;
        }
        break;

      case IdentityEventType.WALLET_REMOVED:
        const removedWallet = (data.wallet_address as string).toLowerCase();
        state.wallets = state.wallets.filter((w) => w !== removedWallet);
        if (state.primaryWallet === removedWallet) {
          state.primaryWallet = null;
        }
        break;

      case IdentityEventType.WALLET_SET_PRIMARY:
        state.primaryWallet = (data.wallet_address as string).toLowerCase();
        break;

      case IdentityEventType.TWITTER_LINKED:
        state.twitterHandle = data.twitter_handle as string;
        break;

      case IdentityEventType.TELEGRAM_LINKED:
        state.telegramId = data.telegram_id as string;
        break;

      case IdentityEventType.IDENTITY_SUSPENDED:
        state.status = 'suspended';
        break;

      case IdentityEventType.IDENTITY_RESTORED:
        state.status = 'active';
        break;

      case IdentityEventType.IDENTITY_DELETED:
        state.status = 'deleted';
        break;

      case IdentityEventType.PROFILE_UPDATED:
        // Handle generic profile updates
        const field = data.field as string;
        if (field === 'discord_username') {
          state.discordUsername = data.new_value as string;
        } else if (field === 'twitter_handle') {
          state.twitterHandle = data.new_value as string;
        } else if (field === 'telegram_id') {
          state.telegramId = data.new_value as string;
        }
        break;

      default:
        // LOW-2 FIX: Use warning level for unknown events during recovery
        logger.warn(
          { eventType, eventId: event.eventId, identityId },
          'Unknown event type during recovery - event skipped'
        );
    }
  }

  // Track skipped events count
  const knownEventTypes = Object.values(IdentityEventType) as string[];
  const skippedEvents = replayedEvents.filter(
    (e) => !knownEventTypes.includes(e.eventType)
  );

  logger.info(
    {
      identityId,
      targetTimestamp,
      eventCount: events.length,
      skippedEventCount: skippedEvents.length,
      finalStatus: state.status,
      walletCount: state.wallets.length,
    },
    'Identity state recovered'
  );

  return {
    asOf: targetTimestamp,
    identityId,
    state,
    eventCount: events.length,
    events: replayedEvents,
  };
}

/**
 * Rebuild current identity state from all events
 *
 * Useful for verifying data integrity or recovering from corruption.
 * Does NOT modify the database - only returns what the state should be.
 *
 * @param db - Database connection
 * @param identityId - Identity to rebuild
 * @returns Rebuilt state from event history
 */
export async function rebuildIdentityFromEvents(
  db: PostgresJsDatabase,
  identityId: string
): Promise<RecoveredIdentityState | null> {
  // Use current timestamp to get all events
  return recoverIdentityAtTimestamp(db, identityId, new Date());
}

/**
 * Compare current database state with event-derived state
 *
 * Useful for detecting drift between the cached state (user_identities)
 * and the source of truth (identity_events).
 *
 * @param db - Database connection
 * @param identityId - Identity to verify
 * @returns Object with current state, derived state, and any mismatches
 */
export async function verifyIdentityIntegrity(
  db: PostgresJsDatabase,
  identityId: string
): Promise<{
  isConsistent: boolean;
  currentState: RecoveredIdentityState['state'] | null;
  derivedState: RecoveredIdentityState['state'] | null;
  mismatches: string[];
}> {
  // Get current state from database
  const currentIdentity = await db
    .select()
    .from(userIdentities)
    .where(eq(userIdentities.identityId, identityId))
    .limit(1);

  const current = currentIdentity[0];
  if (!current) {
    return {
      isConsistent: true,
      currentState: null,
      derivedState: null,
      mismatches: [],
    };
  }

  const currentState: RecoveredIdentityState['state'] = {
    discordId: current.discordId,
    discordUsername: current.discordUsername,
    discordDiscriminator: current.discordDiscriminator,
    primaryWallet: current.primaryWallet,
    wallets: [], // We don't track this in user_identities
    status: current.status as 'active' | 'suspended' | 'deleted',
    twitterHandle: current.twitterHandle,
    telegramId: current.telegramId,
  };

  // Rebuild from events
  const recovered = await rebuildIdentityFromEvents(db, identityId);

  if (!recovered) {
    return {
      isConsistent: false,
      currentState,
      derivedState: null,
      mismatches: ['No events found for identity'],
    };
  }

  const derivedState = recovered.state;
  const mismatches: string[] = [];

  // Compare fields
  if (currentState.discordId !== derivedState.discordId) {
    mismatches.push(`discordId: ${currentState.discordId} !== ${derivedState.discordId}`);
  }
  if (currentState.discordUsername !== derivedState.discordUsername) {
    mismatches.push(`discordUsername: ${currentState.discordUsername} !== ${derivedState.discordUsername}`);
  }
  if (currentState.primaryWallet !== derivedState.primaryWallet) {
    mismatches.push(`primaryWallet: ${currentState.primaryWallet} !== ${derivedState.primaryWallet}`);
  }
  if (currentState.status !== derivedState.status) {
    mismatches.push(`status: ${currentState.status} !== ${derivedState.status}`);
  }
  if (currentState.twitterHandle !== derivedState.twitterHandle) {
    mismatches.push(`twitterHandle: ${currentState.twitterHandle} !== ${derivedState.twitterHandle}`);
  }
  if (currentState.telegramId !== derivedState.telegramId) {
    mismatches.push(`telegramId: ${currentState.telegramId} !== ${derivedState.telegramId}`);
  }

  return {
    isConsistent: mismatches.length === 0,
    currentState,
    derivedState,
    mismatches,
  };
}

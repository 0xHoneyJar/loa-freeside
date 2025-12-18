/**
 * Activity Service
 *
 * Handles activity tracking with demurrage-based decay.
 * Activity balance decays 10% every 6 hours (configurable).
 *
 * Points:
 * - Message: +1 point
 * - Reaction given: +0.5 point
 * - Reaction received: +0.25 point
 */

import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import {
  getMemberActivity,
  getMemberProfileByDiscordId,
  addActivityPoints as dbAddActivityPoints,
  applyActivityDecay as dbApplyActivityDecay,
  getDatabase,
} from '../db/queries.js';
import type { MemberActivity } from '../types/index.js';

// Rate limiting: Track last message time per user to prevent spam gaming
const lastMessageTime = new Map<string, number>();
const MESSAGE_COOLDOWN_MS = 60 * 1000; // 1 minute between counted messages

// Rate limiting: Track last reaction time per user
const lastReactionTime = new Map<string, number>();
const REACTION_COOLDOWN_MS = 5 * 1000; // 5 seconds between counted reactions

/**
 * Tracked channel IDs for activity (configurable)
 * Activity is only counted in these channels
 */
let trackedChannelIds: Set<string> = new Set();

/**
 * Set the tracked channel IDs
 */
export function setTrackedChannels(channelIds: string[]): void {
  trackedChannelIds = new Set(channelIds);
  logger.info({ channelCount: channelIds.length }, 'Updated tracked channels for activity');
}

/**
 * Check if a channel is tracked for activity
 */
export function isTrackedChannel(channelId: string): boolean {
  // If no tracked channels configured, track all channels
  if (trackedChannelIds.size === 0) {
    return true;
  }
  return trackedChannelIds.has(channelId);
}

/**
 * Record a message for activity tracking
 * Returns the updated activity or null if rate limited or not tracked
 */
export async function recordMessage(
  discordUserId: string,
  channelId: string
): Promise<MemberActivity | null> {
  // Check if channel is tracked
  if (!isTrackedChannel(channelId)) {
    return null;
  }

  // Get member profile
  const profile = getMemberProfileByDiscordId(discordUserId);
  if (!profile || !profile.onboardingComplete) {
    return null;
  }

  // Rate limiting: check cooldown
  const now = Date.now();
  const lastTime = lastMessageTime.get(discordUserId) ?? 0;
  if (now - lastTime < MESSAGE_COOLDOWN_MS) {
    logger.debug({ discordUserId }, 'Message rate limited for activity');
    return null;
  }

  // Update rate limit tracker
  lastMessageTime.set(discordUserId, now);

  // Add activity points
  const points = config.socialLayer.activity.points.message;
  const activity = dbAddActivityPoints(profile.memberId, points, 'message');

  if (activity) {
    logger.debug(
      { memberId: profile.memberId, points, newBalance: activity.activityBalance },
      'Recorded message activity'
    );
  }

  return activity;
}

/**
 * Record a reaction given for activity tracking
 */
export async function recordReactionGiven(
  discordUserId: string,
  channelId: string
): Promise<MemberActivity | null> {
  // Check if channel is tracked
  if (!isTrackedChannel(channelId)) {
    return null;
  }

  // Get member profile
  const profile = getMemberProfileByDiscordId(discordUserId);
  if (!profile || !profile.onboardingComplete) {
    return null;
  }

  // Rate limiting
  const now = Date.now();
  const lastTime = lastReactionTime.get(discordUserId) ?? 0;
  if (now - lastTime < REACTION_COOLDOWN_MS) {
    return null;
  }
  lastReactionTime.set(discordUserId, now);

  // Add activity points
  const points = config.socialLayer.activity.points.reactionGiven;
  const activity = dbAddActivityPoints(profile.memberId, points, 'reaction_given');

  if (activity) {
    logger.debug(
      { memberId: profile.memberId, points, newBalance: activity.activityBalance },
      'Recorded reaction given activity'
    );
  }

  return activity;
}

/**
 * Record a reaction received for activity tracking
 */
export async function recordReactionReceived(
  discordUserId: string,
  channelId: string
): Promise<MemberActivity | null> {
  // Check if channel is tracked
  if (!isTrackedChannel(channelId)) {
    return null;
  }

  // Get member profile
  const profile = getMemberProfileByDiscordId(discordUserId);
  if (!profile || !profile.onboardingComplete) {
    return null;
  }

  // Add activity points (no rate limiting for received reactions)
  const points = config.socialLayer.activity.points.reactionReceived;
  const activity = dbAddActivityPoints(profile.memberId, points, 'reaction_received');

  if (activity) {
    logger.debug(
      { memberId: profile.memberId, points, newBalance: activity.activityBalance },
      'Recorded reaction received activity'
    );
  }

  return activity;
}

/**
 * Get own activity stats (self only - private)
 */
export function getOwnStats(discordUserId: string): MemberActivity | null {
  const profile = getMemberProfileByDiscordId(discordUserId);
  if (!profile) {
    return null;
  }

  // Apply pending decay first
  dbApplyActivityDecay(
    profile.memberId,
    config.socialLayer.activity.decayRate,
    config.socialLayer.activity.decayPeriodHours
  );

  return getMemberActivity(profile.memberId);
}

/**
 * Apply decay to a single member's activity
 */
export function applyDecay(memberId: string): MemberActivity | null {
  return dbApplyActivityDecay(
    memberId,
    config.socialLayer.activity.decayRate,
    config.socialLayer.activity.decayPeriodHours
  );
}

/**
 * Run decay task for all members (batch operation)
 * Called by scheduled task every 6 hours
 */
export async function runDecayTask(): Promise<{
  processed: number;
  decayed: number;
}> {
  const database = getDatabase();
  const decayRate = config.socialLayer.activity.decayRate;
  const decayPeriodHours = config.socialLayer.activity.decayPeriodHours;

  // Get all members with non-zero activity that need decay
  const cutoffTime = new Date(Date.now() - decayPeriodHours * 60 * 60 * 1000);

  const members = database
    .prepare(
      `
    SELECT member_id, activity_balance, last_decay_at
    FROM member_activity
    WHERE activity_balance > 0
      AND last_decay_at < ?
  `
    )
    .all(cutoffTime.toISOString()) as Array<{
    member_id: string;
    activity_balance: number;
    last_decay_at: string;
  }>;

  let decayed = 0;

  for (const member of members) {
    const result = applyDecay(member.member_id);
    if (result && result.activityBalance < member.activity_balance) {
      decayed++;
    }
  }

  logger.info(
    { processed: members.length, decayed },
    'Completed activity decay task'
  );

  return {
    processed: members.length,
    decayed,
  };
}

/**
 * Clean up stale rate limit entries (call periodically)
 */
export function cleanupRateLimitCache(): void {
  const now = Date.now();
  const staleThreshold = 5 * 60 * 1000; // 5 minutes

  for (const [userId, lastTime] of lastMessageTime.entries()) {
    if (now - lastTime > staleThreshold) {
      lastMessageTime.delete(userId);
    }
  }

  for (const [userId, lastTime] of lastReactionTime.entries()) {
    if (now - lastTime > staleThreshold) {
      lastReactionTime.delete(userId);
    }
  }
}

/**
 * Activity thresholds for automatic badges
 * These match the badge definitions in the database
 */
export const ACTIVITY_BADGE_THRESHOLDS = {
  consistent: 100, // Consistent: activity_balance >= 100
  dedicated: 250, // Dedicated: activity_balance >= 250
  devoted: 500, // Devoted: activity_balance >= 500
} as const;

/**
 * Check if member qualifies for activity-based badges
 */
export function checkActivityBadgeEligibility(
  activityBalance: number
): ('consistent' | 'dedicated' | 'devoted')[] {
  const eligible: ('consistent' | 'dedicated' | 'devoted')[] = [];

  if (activityBalance >= ACTIVITY_BADGE_THRESHOLDS.devoted) {
    eligible.push('devoted');
  } else if (activityBalance >= ACTIVITY_BADGE_THRESHOLDS.dedicated) {
    eligible.push('dedicated');
  } else if (activityBalance >= ACTIVITY_BADGE_THRESHOLDS.consistent) {
    eligible.push('consistent');
  }

  return eligible;
}

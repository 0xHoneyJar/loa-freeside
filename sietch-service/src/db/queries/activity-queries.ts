// =============================================================================
// Member Activity Queries (Social Layer v2.0)
// =============================================================================

import { getDatabase } from '../connection.js';
import type { MemberActivity } from '../../types/index.js';

/**
 * Database row shape for member_activity table
 */
interface MemberActivityRow {
  member_id: string;
  activity_balance: number;
  last_decay_at: string;
  total_messages: number;
  total_reactions_given: number;
  total_reactions_received: number;
  last_active_at: string | null;
  peak_balance: number;
  updated_at: string;
}

/**
 * Convert database row to MemberActivity
 */
function rowToMemberActivity(row: MemberActivityRow): MemberActivity {
  return {
    memberId: row.member_id,
    activityBalance: row.activity_balance,
    lastDecayAt: new Date(row.last_decay_at),
    totalMessages: row.total_messages,
    totalReactionsGiven: row.total_reactions_given,
    totalReactionsReceived: row.total_reactions_received,
    lastActiveAt: row.last_active_at ? new Date(row.last_active_at) : null,
    peakBalance: row.peak_balance,
    updatedAt: new Date(row.updated_at),
  };
}

/**
 * Get member activity record
 */
export function getMemberActivity(memberId: string): MemberActivity | null {
  const database = getDatabase();

  const row = database.prepare(`
    SELECT * FROM member_activity WHERE member_id = ?
  `).get(memberId) as MemberActivityRow | undefined;

  return row ? rowToMemberActivity(row) : null;
}

/**
 * Apply decay to activity balance based on time elapsed
 * Default: 10% decay every 6 hours
 */
export function applyActivityDecay(
  memberId: string,
  decayRate: number = 0.1,
  decayPeriodHours: number = 6
): MemberActivity | null {
  const database = getDatabase();

  const activity = getMemberActivity(memberId);
  if (!activity) return null;

  const now = new Date();
  const hoursSinceDecay = (now.getTime() - activity.lastDecayAt.getTime()) / (1000 * 60 * 60);
  const decayPeriods = Math.floor(hoursSinceDecay / decayPeriodHours);

  if (decayPeriods <= 0) {
    return activity; // No decay needed
  }

  // Apply compound decay: balance * (1 - decayRate)^periods
  const decayMultiplier = Math.pow(1 - decayRate, decayPeriods);
  const newBalance = Math.max(0, activity.activityBalance * decayMultiplier);

  database.prepare(`
    UPDATE member_activity
    SET activity_balance = ?,
        last_decay_at = datetime('now'),
        updated_at = datetime('now')
    WHERE member_id = ?
  `).run(newBalance, memberId);

  return getMemberActivity(memberId);
}

/**
 * Add activity points to a member
 */
export function addActivityPoints(
  memberId: string,
  points: number,
  type: 'message' | 'reaction_given' | 'reaction_received'
): MemberActivity | null {
  const database = getDatabase();

  // First apply any pending decay
  applyActivityDecay(memberId);

  const activity = getMemberActivity(memberId);
  if (!activity) return null;

  const newBalance = activity.activityBalance + points;
  const newPeak = Math.max(activity.peakBalance, newBalance);

  const updateClauses = [
    'activity_balance = ?',
    'peak_balance = ?',
    'last_active_at = datetime(\'now\')',
    'updated_at = datetime(\'now\')',
  ];
  const params: unknown[] = [newBalance, newPeak];

  // Update lifetime stats
  switch (type) {
    case 'message':
      updateClauses.push('total_messages = total_messages + 1');
      break;
    case 'reaction_given':
      updateClauses.push('total_reactions_given = total_reactions_given + 1');
      break;
    case 'reaction_received':
      updateClauses.push('total_reactions_received = total_reactions_received + 1');
      break;
  }

  params.push(memberId);

  database.prepare(`
    UPDATE member_activity
    SET ${updateClauses.join(', ')}
    WHERE member_id = ?
  `).run(...params);

  return getMemberActivity(memberId);
}

/**
 * Get activity leaderboard (top N by activity balance)
 */
export function getActivityLeaderboard(limit: number = 10): Array<{
  memberId: string;
  nym: string;
  activityBalance: number;
  tier: 'naib' | 'fedaykin';
}> {
  const database = getDatabase();

  const rows = database.prepare(`
    SELECT ma.member_id, mp.nym, ma.activity_balance, mp.tier
    FROM member_activity ma
    JOIN member_profiles mp ON ma.member_id = mp.member_id
    WHERE mp.onboarding_complete = 1
    ORDER BY ma.activity_balance DESC
    LIMIT ?
  `).all(limit) as Array<{
    member_id: string;
    nym: string;
    activity_balance: number;
    tier: 'naib' | 'fedaykin';
  }>;

  return rows.map((row) => ({
    memberId: row.member_id,
    nym: row.nym,
    activityBalance: row.activity_balance,
    tier: row.tier,
  }));
}

// =============================================================================
// Naib Seat Queries (v2.1 - Sprint 11)
// =============================================================================

import { getDatabase } from '../connection.js';
import type { NaibSeat, UnseatReason, MemberProfile } from '../../types/index.js';
import { NAIB_THRESHOLD_SCHEMA_SQL } from '../schema.js';
import { logger } from '../../utils/logger.js';

/**
 * Initialize Naib/Threshold schema (call after social layer schema)
 */
export function initNaibThresholdSchema(): void {
  const database = getDatabase();
  database.exec(NAIB_THRESHOLD_SCHEMA_SQL);
  logger.info('Naib/Threshold schema initialized');
}

/**
 * Database row shape for naib_seats table
 */
interface NaibSeatRow {
  id: number;
  seat_number: number;
  member_id: string;
  seated_at: string;
  unseated_at: string | null;
  unseat_reason: UnseatReason | null;
  bumped_by_member_id: string | null;
  bgt_at_seating: string;
  bgt_at_unseating: string | null;
}

/**
 * Database row shape for member_profiles table
 */
interface MemberProfileRow {
  member_id: string;
  discord_user_id: string;
  nym: string;
  bio: string | null;
  pfp_url: string | null;
  pfp_type: 'custom' | 'generated' | 'none';
  tier: 'naib' | 'fedaykin';
  created_at: string;
  updated_at: string;
  nym_last_changed: string | null;
  onboarding_complete: number;
  onboarding_step: number;
}

/**
 * Convert database row to NaibSeat
 */
function rowToNaibSeat(row: NaibSeatRow): NaibSeat {
  return {
    id: row.id,
    seatNumber: row.seat_number,
    memberId: row.member_id,
    seatedAt: new Date(row.seated_at),
    unseatedAt: row.unseated_at ? new Date(row.unseated_at) : null,
    unseatReason: row.unseat_reason,
    bumpedByMemberId: row.bumped_by_member_id,
    bgtAtSeating: row.bgt_at_seating,
    bgtAtUnseating: row.bgt_at_unseating,
  };
}

/**
 * Convert database row to MemberProfile
 */
function rowToMemberProfile(row: MemberProfileRow): MemberProfile {
  return {
    memberId: row.member_id,
    discordUserId: row.discord_user_id,
    nym: row.nym,
    bio: row.bio,
    pfpUrl: row.pfp_url,
    pfpType: row.pfp_type,
    tier: row.tier,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    nymLastChanged: row.nym_last_changed ? new Date(row.nym_last_changed) : null,
    onboardingComplete: row.onboarding_complete === 1,
    onboardingStep: row.onboarding_step,
  };
}

/**
 * Insert a new Naib seat record
 */
export function insertNaibSeat(params: {
  seatNumber: number;
  memberId: string;
  bgtAtSeating: string;
}): NaibSeat {
  const database = getDatabase();

  const stmt = database.prepare(`
    INSERT INTO naib_seats (seat_number, member_id, bgt_at_seating)
    VALUES (?, ?, ?)
  `);

  const result = stmt.run(params.seatNumber, params.memberId, params.bgtAtSeating);

  logger.info(
    { seatNumber: params.seatNumber, memberId: params.memberId },
    'Inserted Naib seat'
  );

  return getNaibSeatById(result.lastInsertRowid as number)!;
}

/**
 * Get a Naib seat by ID
 */
export function getNaibSeatById(id: number): NaibSeat | null {
  const database = getDatabase();

  const row = database.prepare(`
    SELECT * FROM naib_seats WHERE id = ?
  `).get(id) as NaibSeatRow | undefined;

  return row ? rowToNaibSeat(row) : null;
}

/**
 * Update a Naib seat (for unseating)
 */
export function updateNaibSeat(
  id: number,
  updates: {
    unseatedAt?: Date;
    unseatReason?: UnseatReason;
    bumpedByMemberId?: string;
    bgtAtUnseating?: string;
  }
): NaibSeat | null {
  const database = getDatabase();

  const setClauses: string[] = [];
  const params: unknown[] = [];

  if (updates.unseatedAt !== undefined) {
    setClauses.push('unseated_at = ?');
    params.push(updates.unseatedAt.toISOString());
  }

  if (updates.unseatReason !== undefined) {
    setClauses.push('unseat_reason = ?');
    params.push(updates.unseatReason);
  }

  if (updates.bumpedByMemberId !== undefined) {
    setClauses.push('bumped_by_member_id = ?');
    params.push(updates.bumpedByMemberId);
  }

  if (updates.bgtAtUnseating !== undefined) {
    setClauses.push('bgt_at_unseating = ?');
    params.push(updates.bgtAtUnseating);
  }

  if (setClauses.length === 0) {
    return getNaibSeatById(id);
  }

  params.push(id);

  const result = database.prepare(`
    UPDATE naib_seats
    SET ${setClauses.join(', ')}
    WHERE id = ?
  `).run(...params);

  if (result.changes === 0) {
    return null;
  }

  return getNaibSeatById(id);
}

/**
 * Get all currently active Naib seats (unseated_at IS NULL)
 */
export function getCurrentNaibSeats(): NaibSeat[] {
  const database = getDatabase();

  const rows = database.prepare(`
    SELECT * FROM naib_seats
    WHERE unseated_at IS NULL
    ORDER BY seat_number ASC
  `).all() as NaibSeatRow[];

  return rows.map(rowToNaibSeat);
}

/**
 * Get active Naib seat for a specific member
 */
export function getActiveSeatByMember(memberId: string): NaibSeat | null {
  const database = getDatabase();

  const row = database.prepare(`
    SELECT * FROM naib_seats
    WHERE member_id = ? AND unseated_at IS NULL
  `).get(memberId) as NaibSeatRow | undefined;

  return row ? rowToNaibSeat(row) : null;
}

/**
 * Get all seat history for a member (past and present)
 */
export function getNaibSeatsByMember(memberId: string): NaibSeat[] {
  const database = getDatabase();

  const rows = database.prepare(`
    SELECT * FROM naib_seats
    WHERE member_id = ?
    ORDER BY seated_at DESC
  `).all(memberId) as NaibSeatRow[];

  return rows.map(rowToNaibSeat);
}

/**
 * Count currently active Naib seats
 */
export function countActiveNaibSeats(): number {
  const database = getDatabase();

  const row = database.prepare(`
    SELECT COUNT(*) as count FROM naib_seats
    WHERE unseated_at IS NULL
  `).get() as { count: number };

  return row.count;
}

/**
 * Get the next available seat number (1-7)
 * Returns null if all seats are filled
 */
export function getNextAvailableSeatNumber(): number | null {
  const database = getDatabase();

  // Get all currently occupied seat numbers
  const rows = database.prepare(`
    SELECT seat_number FROM naib_seats
    WHERE unseated_at IS NULL
    ORDER BY seat_number ASC
  `).all() as Array<{ seat_number: number }>;

  const occupied = new Set(rows.map((r) => r.seat_number));

  // Find first available seat (1-7)
  for (let i = 1; i <= 7; i++) {
    if (!occupied.has(i)) {
      return i;
    }
  }

  return null; // All seats occupied
}

/**
 * Get the lowest BGT Naib seat (for bump evaluation)
 * Returns the seat with the lowest BGT holder, using tenure as tie-breaker
 */
export function getLowestBgtNaibSeat(): {
  seat: NaibSeat;
  currentBgt: string;
  memberId: string;
} | null {
  const database = getDatabase();

  // Join with current_eligibility to get current BGT
  // Order by BGT ascending, then by seated_at descending (newer members lose ties)
  const row = database.prepare(`
    SELECT ns.*, ce.bgt_held as current_bgt
    FROM naib_seats ns
    JOIN wallet_mappings wm ON (
      SELECT discord_user_id FROM member_profiles WHERE member_id = ns.member_id
    ) = wm.discord_user_id
    JOIN current_eligibility ce ON ce.address = wm.wallet_address
    WHERE ns.unseated_at IS NULL
    ORDER BY CAST(ce.bgt_held AS INTEGER) ASC, ns.seated_at DESC
    LIMIT 1
  `).get() as (NaibSeatRow & { current_bgt: string }) | undefined;

  if (!row) {
    return null;
  }

  return {
    seat: rowToNaibSeat(row),
    currentBgt: row.current_bgt,
    memberId: row.member_id,
  };
}

/**
 * Update member's is_former_naib status
 */
export function updateMemberFormerNaibStatus(
  memberId: string,
  isFormerNaib: boolean
): boolean {
  const database = getDatabase();

  const result = database.prepare(`
    UPDATE member_profiles
    SET is_former_naib = ?
    WHERE member_id = ?
  `).run(isFormerNaib ? 1 : 0, memberId);

  return result.changes > 0;
}

/**
 * Get all Former Naib members (is_former_naib = 1 AND not currently seated)
 */
export function getFormerNaibMembers(): MemberProfile[] {
  const database = getDatabase();

  const rows = database.prepare(`
    SELECT mp.* FROM member_profiles mp
    WHERE mp.is_former_naib = 1
    AND NOT EXISTS (
      SELECT 1 FROM naib_seats ns
      WHERE ns.member_id = mp.member_id AND ns.unseated_at IS NULL
    )
    ORDER BY mp.nym ASC
  `).all() as MemberProfileRow[];

  return rows.map(rowToMemberProfile);
}

/**
 * Check if there have been any Naib seats ever (for founding determination)
 */
export function hasAnyNaibSeatsEver(): boolean {
  const database = getDatabase();

  const row = database.prepare(`
    SELECT COUNT(*) as count FROM naib_seats
  `).get() as { count: number };

  return row.count > 0;
}

/**
 * Get count of total unique members who have held Naib seats
 */
export function getTotalNaibMembersEver(): number {
  const database = getDatabase();

  const row = database.prepare(`
    SELECT COUNT(DISTINCT member_id) as count FROM naib_seats
  `).get() as { count: number };

  return row.count;
}

/**
 * Get Naib seat history with pagination
 */
export function getNaibSeatHistory(options: {
  limit?: number;
  offset?: number;
} = {}): { seats: NaibSeat[]; total: number } {
  const database = getDatabase();

  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;

  const countRow = database.prepare(`
    SELECT COUNT(*) as total FROM naib_seats
  `).get() as { total: number };

  const rows = database.prepare(`
    SELECT * FROM naib_seats
    ORDER BY seated_at DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset) as NaibSeatRow[];

  return {
    seats: rows.map(rowToNaibSeat),
    total: countRow.total,
  };
}

/**
 * Get member's BGT from current_eligibility via wallet mapping
 */
export function getMemberCurrentBgt(memberId: string): string | null {
  const database = getDatabase();

  const row = database.prepare(`
    SELECT ce.bgt_held
    FROM member_profiles mp
    JOIN wallet_mappings wm ON mp.discord_user_id = wm.discord_user_id
    JOIN current_eligibility ce ON ce.address = wm.wallet_address
    WHERE mp.member_id = ?
  `).get(memberId) as { bgt_held: string } | undefined;

  return row?.bgt_held ?? null;
}

/**
 * Get member's eligibility rank from current_eligibility
 */
export function getMemberEligibilityRank(memberId: string): number | null {
  const database = getDatabase();

  const row = database.prepare(`
    SELECT ce.rank
    FROM member_profiles mp
    JOIN wallet_mappings wm ON mp.discord_user_id = wm.discord_user_id
    JOIN current_eligibility ce ON ce.address = wm.wallet_address
    WHERE mp.member_id = ?
  `).get(memberId) as { rank: number } | undefined;

  return row?.rank ?? null;
}

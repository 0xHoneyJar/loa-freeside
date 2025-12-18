/**
 * Migration 003: Migrate v1.0 Members to Social Layer
 *
 * This migration creates placeholder profiles for existing wallet_mappings
 * that have current_eligibility records. Members who haven't completed
 * onboarding will be prompted to do so via DM.
 *
 * Process:
 * 1. Find wallet_mappings with matching current_eligibility (verified v1.0 members)
 * 2. Create member_profiles with temporary nyms (Member_XXXXXX)
 * 3. Set onboarding_complete = 0 (pending onboarding)
 * 4. Preserve original verified_at as created_at
 *
 * This migration is reversible - down() removes placeholder profiles.
 */

import type Database from 'better-sqlite3';
import { randomBytes } from 'crypto';

export const version = 3;
export const name = '003_migrate_v1_members';

/**
 * Generate a UUID v4 for member_id
 */
function generateUUID(): string {
  const bytes = randomBytes(16);
  // Set version 4 bits (byte 6)
  const byte6 = bytes[6];
  const byte8 = bytes[8];
  if (byte6 !== undefined) {
    bytes[6] = (byte6 & 0x0f) | 0x40;
  }
  // Set variant bits (byte 8)
  if (byte8 !== undefined) {
    bytes[8] = (byte8 & 0x3f) | 0x80;
  }

  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

/**
 * Generate a 6-character random suffix for temporary nym
 */
function generateNymSuffix(): string {
  return randomBytes(3).toString('hex').toUpperCase();
}

export function up(db: Database.Database): void {
  // Get all wallet_mappings that have current_eligibility (v1.0 verified members)
  const v1Members = db
    .prepare(
      `
    SELECT
      wm.discord_user_id,
      wm.wallet_address,
      wm.verified_at,
      ce.role
    FROM wallet_mappings wm
    INNER JOIN current_eligibility ce ON LOWER(wm.wallet_address) = LOWER(ce.address)
    WHERE ce.role IN ('naib', 'fedaykin')
      AND wm.discord_user_id NOT IN (
        SELECT discord_user_id FROM member_profiles
      )
  `
    )
    .all() as Array<{
    discord_user_id: string;
    wallet_address: string;
    verified_at: string;
    role: 'naib' | 'fedaykin';
  }>;

  if (v1Members.length === 0) {
    console.log('No v1.0 members to migrate');
    return;
  }

  console.log(`Migrating ${v1Members.length} v1.0 members to social layer...`);

  // Prepare insert statement
  const insertProfile = db.prepare(`
    INSERT INTO member_profiles (
      member_id,
      discord_user_id,
      nym,
      bio,
      pfp_url,
      pfp_type,
      tier,
      created_at,
      updated_at,
      nym_last_changed,
      onboarding_complete,
      onboarding_step
    ) VALUES (?, ?, ?, NULL, NULL, 'none', ?, ?, datetime('now'), NULL, 0, 0)
  `);

  // Track used nyms to avoid collisions
  const usedNyms = new Set<string>();

  // Get existing nyms
  const existingNyms = db
    .prepare('SELECT nym FROM member_profiles')
    .all() as Array<{ nym: string }>;
  existingNyms.forEach((row) => usedNyms.add(row.nym.toLowerCase()));

  let migratedCount = 0;

  for (const member of v1Members) {
    // Generate unique temporary nym
    let nym: string;
    do {
      nym = `Member_${generateNymSuffix()}`;
    } while (usedNyms.has(nym.toLowerCase()));

    usedNyms.add(nym.toLowerCase());

    // Generate member ID
    const memberId = generateUUID();

    try {
      insertProfile.run(
        memberId,
        member.discord_user_id,
        nym,
        member.role,
        member.verified_at
      );
      migratedCount++;
    } catch (error) {
      console.error(
        `Failed to migrate member ${member.discord_user_id}: ${error}`
      );
    }
  }

  console.log(`Successfully migrated ${migratedCount}/${v1Members.length} v1.0 members`);

  // Create initial activity records for migrated members
  db.exec(`
    INSERT OR IGNORE INTO member_activity (member_id, activity_balance, last_decay_at)
    SELECT member_id, 0.0, datetime('now')
    FROM member_profiles
    WHERE onboarding_complete = 0
  `);

  console.log('Created activity records for migrated members');
}

export function down(db: Database.Database): void {
  // Remove placeholder profiles (those with onboarding_complete = 0 and nym starting with 'Member_')
  const result = db.prepare(`
    DELETE FROM member_profiles
    WHERE onboarding_complete = 0
      AND nym LIKE 'Member_%'
  `).run();

  console.log(`Removed ${result.changes} placeholder profiles`);
}

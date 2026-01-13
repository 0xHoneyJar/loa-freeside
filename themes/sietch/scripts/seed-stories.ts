#!/usr/bin/env npx tsx

/**
 * Story Fragments Seeder Script (Sprint 21: S21-T2)
 *
 * Seeds the story_fragments table with default Dune-themed narrative fragments
 * for elite member joins (Fedaykin and Naib).
 *
 * This script is idempotent - it only inserts fragments if the table is empty.
 *
 * Usage:
 *   npm run seed:stories
 *   npx tsx scripts/seed-stories.ts
 *
 * The script populates:
 * - 3+ Fedaykin join fragments
 * - 2+ Naib join fragments
 */

import { config } from 'dotenv';
import { initDatabase, getDatabase } from '../src/db/index.js';
import { randomUUID } from 'crypto';

// Load environment variables
config({ path: '.env.local' });
config();

/**
 * Default story fragments from PRD
 */
const DEFAULT_FRAGMENTS = {
  fedaykin_join: [
    `The desert wind carried whispers of a new arrival.
One who had held their water, never trading the sacred spice.
The sietch grows stronger.`,
    `Footsteps in the sand revealed a traveler from distant dunes.
They bore no marks of the water sellers.
A new Fedaykin has earned their place.`,
    `The winds shifted across the Great Bled.
A new figure emerged from the dancing sands,
their stillsuit bearing the marks of deep desert travel.

The watermasters took note.
Another has proven their worth in the spice trade.

A new Fedaykin walks among us.`,
    `Beneath the twin moons, a shadow moved with purpose.
The sand gave no resistance to their practiced steps.
One more keeper of the ancient way has joined our ranks.`,
    `The sietch's heartbeat grows louder.
Another warrior of the deep desert approaches,
their loyalty to the spice unbroken, their resolve unshaken.`,
  ],
  naib_join: [
    `The council chamber stirred.
A presence of great weight approached -
one whose reserves of melange could shift the balance.
A new voice joins the Naib.`,
    `The sands trembled with significance.
One of profound holdings has crossed the threshold,
their wisdom forged in the crucible of scarcity.
The Naib Council is complete once more.`,
    `Ancient traditions speak of leaders rising from the dunes.
Today, the prophecy continues.
A new Naib takes their seat among the watermasters.`,
  ],
};

async function main() {
  console.log('='.repeat(60));
  console.log('Story Fragments Seeder');
  console.log('='.repeat(60));
  console.log('');

  // Initialize database
  console.log('Initializing database...');
  initDatabase();

  const db = getDatabase();

  // Check if table already has fragments
  const existingCount = db
    .prepare('SELECT COUNT(*) as count FROM story_fragments')
    .get() as { count: number };

  if (existingCount.count > 0) {
    console.log(`✓ Story fragments table already contains ${existingCount.count} fragments`);
    console.log('  Seeder is idempotent - skipping insert to preserve existing data');
    console.log('');
    console.log('To re-seed, manually delete fragments:');
    console.log('  DELETE FROM story_fragments;');
    console.log('');
    return;
  }

  console.log('Story fragments table is empty. Seeding defaults...');
  console.log('');

  let totalInserted = 0;

  // Insert Fedaykin join fragments
  console.log('Seeding Fedaykin join fragments:');
  for (const content of DEFAULT_FRAGMENTS.fedaykin_join) {
    const id = randomUUID();
    db.prepare(
      `
      INSERT INTO story_fragments (id, category, content, used_count)
      VALUES (?, ?, ?, ?)
    `
    ).run(id, 'fedaykin_join', content, 0);

    const preview = content.split('\n')[0].substring(0, 50) + '...';
    console.log(`  ✓ ${preview}`);
    totalInserted++;
  }

  console.log('');

  // Insert Naib join fragments
  console.log('Seeding Naib join fragments:');
  for (const content of DEFAULT_FRAGMENTS.naib_join) {
    const id = randomUUID();
    db.prepare(
      `
      INSERT INTO story_fragments (id, category, content, used_count)
      VALUES (?, ?, ?, ?)
    `
    ).run(id, 'naib_join', content, 0);

    const preview = content.split('\n')[0].substring(0, 50) + '...';
    console.log(`  ✓ ${preview}`);
    totalInserted++;
  }

  console.log('');
  console.log('='.repeat(60));
  console.log(`✓ Successfully seeded ${totalInserted} story fragments`);
  console.log('  - Fedaykin join: ' + DEFAULT_FRAGMENTS.fedaykin_join.length);
  console.log('  - Naib join: ' + DEFAULT_FRAGMENTS.naib_join.length);
  console.log('='.repeat(60));
}

// Run the seeder
main().catch((error) => {
  console.error('Error seeding story fragments:', error);
  process.exit(1);
});

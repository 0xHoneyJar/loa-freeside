/**
 * Agent Thread Data Access (Sprint 4, Task 4.6)
 *
 * Drizzle ORM queries for agent_threads table.
 * Separated from handler for testability.
 */

import { eq, and } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { agentThreads, type NewAgentThread } from '../../data/schema.js';
import * as schema from '../../data/schema.js';
import { getDatabase } from '../../data/database.js';
import { randomBytes } from 'node:crypto';

type DB = PostgresJsDatabase<typeof schema>;

/** Get initialized DB instance */
export function getDb(): DB {
  return getDatabase();
}

/** Find active thread for an NFT in a community */
export async function findActiveThread(
  db: DB,
  nftId: string,
  communityId: string,
): Promise<typeof agentThreads.$inferSelect | null> {
  const rows = await db
    .select()
    .from(agentThreads)
    .where(
      and(
        eq(agentThreads.nftId, nftId),
        eq(agentThreads.communityId, communityId),
        eq(agentThreads.isActive, 1),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

/** Find active thread by Discord thread/channel ID */
export async function findThreadByThreadId(
  db: DB,
  threadId: string,
): Promise<typeof agentThreads.$inferSelect | null> {
  const rows = await db
    .select()
    .from(agentThreads)
    .where(
      and(
        eq(agentThreads.threadId, threadId),
        eq(agentThreads.isActive, 1),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

/** Update lastActiveAt timestamp on a thread */
export async function updateThreadLastActive(
  db: DB,
  threadId: string,
): Promise<void> {
  await db
    .update(agentThreads)
    .set({ lastActiveAt: new Date().toISOString() })
    .where(eq(agentThreads.threadId, threadId));
}

/** Deactivate a thread (set isActive = 0) */
export async function deactivateThread(
  db: DB,
  threadId: string,
): Promise<void> {
  await db
    .update(agentThreads)
    .set({ isActive: 0 })
    .where(eq(agentThreads.threadId, threadId));
}

/** Get all active threads for a wallet address */
export async function getActiveThreadsByWallet(
  db: DB,
  ownerWallet: string,
): Promise<Array<typeof agentThreads.$inferSelect>> {
  return db
    .select()
    .from(agentThreads)
    .where(
      and(
        eq(agentThreads.ownerWallet, ownerWallet.toLowerCase()),
        eq(agentThreads.isActive, 1),
      ),
    );
}

/** Get all active threads (for background re-verification) */
export async function getAllActiveThreads(
  db: DB,
): Promise<Array<typeof agentThreads.$inferSelect>> {
  return db
    .select()
    .from(agentThreads)
    .where(eq(agentThreads.isActive, 1));
}

/** Insert a new agent thread record */
export async function insertAgentThread(
  db: DB,
  data: Omit<NewAgentThread, 'id' | 'isActive'>,
): Promise<void> {
  const id = randomBytes(8).toString('hex');
  await db.insert(agentThreads).values({
    id,
    isActive: 1,
    ...data,
  });
}

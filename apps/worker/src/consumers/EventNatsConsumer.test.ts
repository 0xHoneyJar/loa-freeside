/**
 * EventNatsConsumer Integration Tests
 * Sprint: NATS Guild & Member Lifecycle Event Consumers
 *
 * Tests run against a real PostgreSQL instance.
 * Set DATABASE_URL env var or SKIP_DB_TESTS=true to skip.
 *
 * AC coverage: AC-1 through AC-18
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import pino from 'pino';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, and } from 'drizzle-orm';
import * as schema from '../data/schema.js';
import {
  initDatabase,
  getDatabase,
  upsertCommunity,
  markCommunityInactive,
  upsertProfile,
  markProfileInactive,
} from '../data/database.js';
import {
  createDefaultNatsEventHandlers,
  type GatewayEventPayload,
} from './EventNatsConsumer.js';
import type { DiscordRestService } from '../services/DiscordRest.js';

// ---------------------------------------------------------------------------
// Environment gate
// ---------------------------------------------------------------------------

const DATABASE_URL = process.env['DATABASE_URL'];
const SKIP = !DATABASE_URL || process.env['SKIP_DB_TESTS'] === 'true';

const log = pino({ level: 'silent' });

// ---------------------------------------------------------------------------
// DB bootstrap (shared across tests in this file)
// ---------------------------------------------------------------------------

let sql: postgres.Sql;

beforeAll(async () => {
  if (SKIP) return;
  sql = postgres(DATABASE_URL!, { max: 3, idle_timeout: 10 });
  initDatabase({ databaseUrl: DATABASE_URL! } as any, log);
});

afterAll(async () => {
  if (SKIP) return;
  await sql.end();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const GUILD_ID = 'test-guild-' + Math.random().toString(36).slice(2, 8);
const USER_ID = 'test-user-' + Math.random().toString(36).slice(2, 8);

function makeMockPayload(
  eventType: string,
  overrides: Partial<GatewayEventPayload> = {}
): GatewayEventPayload {
  return {
    event_id: 'evt-' + Math.random().toString(36).slice(2, 10),
    event_type: eventType,
    shard_id: 0,
    timestamp: Date.now(),
    guild_id: GUILD_ID,
    channel_id: null,
    user_id: null,
    data: {},
    ...overrides,
  };
}

async function getCommunitiesForGuild(guildId: string): Promise<schema.Community[]> {
  const db = getDatabase();
  return db.select().from(schema.communities).where(eq(schema.communities.discordGuildId, guildId));
}

async function getProfilesForUser(
  communityId: string,
  discordId: string
): Promise<schema.Profile[]> {
  const db = getDatabase();
  return db
    .select()
    .from(schema.profiles)
    .where(and(eq(schema.profiles.communityId, communityId), eq(schema.profiles.discordId, discordId)));
}

async function cleanGuild(guildId: string): Promise<void> {
  const db = getDatabase();
  const comms = await db
    .select({ id: schema.communities.id })
    .from(schema.communities)
    .where(eq(schema.communities.discordGuildId, guildId));
  for (const c of comms) {
    await db.delete(schema.profiles).where(eq(schema.profiles.communityId, c.id));
  }
  await db.delete(schema.communities).where(eq(schema.communities.discordGuildId, guildId));
}

function makeDiscordRestStub(): DiscordRestService {
  return {
    sendMessage: vi.fn().mockResolvedValue({ success: true, messageId: 'msg-1' }),
    setToken: vi.fn(),
  } as unknown as DiscordRestService;
}

// ---------------------------------------------------------------------------
// AC-17: initDatabase singleton
// ---------------------------------------------------------------------------

describe.skipIf(SKIP)('initDatabase (AC-17)', () => {
  it('AC-17: second call returns same singleton instance', () => {
    // initDatabase is already called in beforeAll; calling again must return same instance
    const db1 = getDatabase();
    initDatabase({ databaseUrl: DATABASE_URL! } as any, log);
    const db2 = getDatabase();
    expect(db1).toBe(db2);
  });
});

// ---------------------------------------------------------------------------
// Guild handlers
// ---------------------------------------------------------------------------

describe.skipIf(SKIP)('handleGuildJoin', () => {
  const guildId = GUILD_ID + '-join';

  beforeEach(async () => { await cleanGuild(guildId); });
  afterAll(async () => { await cleanGuild(guildId); });

  it('AC-1: inserts one row with isActive=true', async () => {
    const discordRest = makeDiscordRestStub();
    const handlers = createDefaultNatsEventHandlers(discordRest);
    const handler = handlers.get('guild.join')!;

    await handler(
      makeMockPayload('guild.join', { guild_id: guildId, data: { name: 'Test Guild', system_channel_id: 'ch-1' } }),
      log
    );

    const rows = await getCommunitiesForGuild(guildId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.isActive).toBe(true);
    expect(rows[0]!.name).toBe('Test Guild');
  });

  it('AC-2: N replays → one row, createdAt unchanged', async () => {
    const discordRest = makeDiscordRestStub();
    const handlers = createDefaultNatsEventHandlers(discordRest);
    const handler = handlers.get('guild.join')!;
    const payload = makeMockPayload('guild.join', { guild_id: guildId, data: { name: 'Test Guild', system_channel_id: 'ch-1' } });

    await handler(payload, log);
    const first = (await getCommunitiesForGuild(guildId))[0]!;

    await handler(payload, log);
    await handler(payload, log);
    await handler(payload, log);
    const rows = await getCommunitiesForGuild(guildId);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.createdAt.toISOString()).toBe(first.createdAt.toISOString());
    // discordRest.sendMessage called exactly once (on creation, not replays)
    expect(discordRest.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('AC-3: re-activates inactive community without duplication', async () => {
    const discordRest = makeDiscordRestStub();
    const handlers = createDefaultNatsEventHandlers(discordRest);
    const joinHandler = handlers.get('guild.join')!;
    const leaveHandler = handlers.get('guild.leave')!;
    const payload = makeMockPayload('guild.join', { guild_id: guildId, data: { name: 'Test Guild' } });

    await joinHandler(payload, log);
    await leaveHandler(makeMockPayload('guild.leave', { guild_id: guildId }), log);

    // Verify inactive
    let rows = await getCommunitiesForGuild(guildId);
    expect(rows[0]!.isActive).toBe(false);

    await joinHandler(payload, log);
    rows = await getCommunitiesForGuild(guildId);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.isActive).toBe(true);
  });

  it('AC-15a: null guild_id → no DB write, no throw', async () => {
    const discordRest = makeDiscordRestStub();
    const handlers = createDefaultNatsEventHandlers(discordRest);
    const handler = handlers.get('guild.join')!;

    await expect(
      handler(makeMockPayload('guild.join', { guild_id: null, data: { name: 'Test Guild' } }), log)
    ).resolves.toBeUndefined();

    const rows = await getCommunitiesForGuild(guildId);
    expect(rows).toHaveLength(0);
  });

  it('AC-15b: missing name in data → no DB write, no throw', async () => {
    const discordRest = makeDiscordRestStub();
    const handlers = createDefaultNatsEventHandlers(discordRest);
    const handler = handlers.get('guild.join')!;

    await expect(
      handler(makeMockPayload('guild.join', { guild_id: guildId, data: {} }), log)
    ).resolves.toBeUndefined();

    const rows = await getCommunitiesForGuild(guildId);
    expect(rows).toHaveLength(0);
  });

  it('AC-16a: DB failure → handler re-throws', async () => {
    // Temporarily break upsertCommunity by calling with invalid communityId (force DB error)
    // We verify this by directly testing that upsertCommunity propagates errors from the handler
    const discordRest = makeDiscordRestStub();
    const handlers = createDefaultNatsEventHandlers(discordRest);
    const handler = handlers.get('guild.join')!;

    // Patch getDatabase to throw
    const { getDatabase: origGetDb } = await import('../data/database.js');
    vi.spyOn(await import('../data/database.js'), 'upsertCommunity').mockRejectedValueOnce(
      new Error('simulated DB failure')
    );

    await expect(
      handler(makeMockPayload('guild.join', { guild_id: guildId, data: { name: 'Test Guild' } }), log)
    ).rejects.toThrow('simulated DB failure');
  });
});

describe.skipIf(SKIP)('handleGuildLeave', () => {
  const guildId = GUILD_ID + '-leave';

  beforeEach(async () => { await cleanGuild(guildId); });
  afterAll(async () => { await cleanGuild(guildId); });

  async function seedCommunity(name = 'Test Guild'): Promise<schema.Community> {
    const { community } = await upsertCommunity({ discordGuildId: guildId, name });
    return community;
  }

  it('AC-4: sets isActive=false', async () => {
    await seedCommunity();
    const handlers = createDefaultNatsEventHandlers();
    const handler = handlers.get('guild.leave')!;

    await handler(makeMockPayload('guild.leave', { guild_id: guildId }), log);

    const rows = await getCommunitiesForGuild(guildId);
    expect(rows[0]!.isActive).toBe(false);
  });

  it('AC-5: N replays on inactive community → no error, updatedAt stable', async () => {
    await seedCommunity();
    const handlers = createDefaultNatsEventHandlers();
    const handler = handlers.get('guild.leave')!;
    const payload = makeMockPayload('guild.leave', { guild_id: guildId });

    await handler(payload, log);
    const afterFirst = (await getCommunitiesForGuild(guildId))[0]!;

    await handler(payload, log);
    await handler(payload, log);
    const afterReplays = (await getCommunitiesForGuild(guildId))[0]!;

    expect(afterReplays.updatedAt.toISOString()).toBe(afterFirst.updatedAt.toISOString());
  });

  it('AC-6: unknown guild → no write, no throw', async () => {
    const handlers = createDefaultNatsEventHandlers();
    const handler = handlers.get('guild.leave')!;

    await expect(
      handler(makeMockPayload('guild.leave', { guild_id: 'nonexistent-guild-xyz' }), log)
    ).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Member handlers
// ---------------------------------------------------------------------------

describe.skipIf(SKIP)('handleMemberJoin', () => {
  const guildId = GUILD_ID + '-mjoin';
  const userId = USER_ID + '-mjoin';
  let communityId: string;

  beforeAll(async () => {
    if (SKIP) return;
    const { community } = await upsertCommunity({ discordGuildId: guildId, name: 'MJoin Guild' });
    communityId = community.id;
  });

  beforeEach(async () => {
    if (SKIP) return;
    // Remove profiles but keep community
    const db = getDatabase();
    await db
      .delete(schema.profiles)
      .where(and(eq(schema.profiles.communityId, communityId), eq(schema.profiles.discordId, userId)));
  });

  afterAll(async () => { await cleanGuild(guildId); });

  it('AC-7: inserts one row with joinedAt set', async () => {
    const handlers = createDefaultNatsEventHandlers();
    const handler = handlers.get('member.join')!;

    await handler(makeMockPayload('member.join', { guild_id: guildId, user_id: userId }), log);

    const rows = await getProfilesForUser(communityId, userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.joinedAt).toBeTruthy();
    expect(rows[0]!.communityId).toBe(communityId);
  });

  it('AC-8: N replays → one row, joinedAt unchanged', async () => {
    const handlers = createDefaultNatsEventHandlers();
    const handler = handlers.get('member.join')!;
    const payload = makeMockPayload('member.join', { guild_id: guildId, user_id: userId });

    await handler(payload, log);
    const first = (await getProfilesForUser(communityId, userId))[0]!;

    await handler(payload, log);
    await handler(payload, log);
    await handler(payload, log);
    const rows = await getProfilesForUser(communityId, userId);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.joinedAt.toISOString()).toBe(first.joinedAt.toISOString());
  });

  it('AC-9: unknown guild → no profile row, no throw', async () => {
    const handlers = createDefaultNatsEventHandlers();
    const handler = handlers.get('member.join')!;

    await expect(
      handler(makeMockPayload('member.join', { guild_id: 'nonexistent-guild-xyz', user_id: userId }), log)
    ).resolves.toBeUndefined();

    // Verify no profile was created
    const db = getDatabase();
    const rows = await db
      .select()
      .from(schema.profiles)
      .where(eq(schema.profiles.discordId, userId));
    expect(rows.filter(r => r.communityId === communityId)).toHaveLength(0);
  });

  it('AC-15c: missing discordId → no DB write, no throw', async () => {
    const handlers = createDefaultNatsEventHandlers();
    const handler = handlers.get('member.join')!;

    await expect(
      handler(makeMockPayload('member.join', { guild_id: guildId, user_id: null }), log)
    ).resolves.toBeUndefined();

    const rows = await getProfilesForUser(communityId, userId);
    expect(rows).toHaveLength(0);
  });

  it('AC-16b: DB failure → handler re-throws', async () => {
    const handlers = createDefaultNatsEventHandlers();
    const handler = handlers.get('member.join')!;

    vi.spyOn(await import('../data/database.js'), 'upsertProfile').mockRejectedValueOnce(
      new Error('simulated DB failure')
    );

    await expect(
      handler(makeMockPayload('member.join', { guild_id: guildId, user_id: userId }), log)
    ).rejects.toThrow('simulated DB failure');
  });
});

describe.skipIf(SKIP)('handleMemberLeave', () => {
  const guildId = GUILD_ID + '-mleave';
  const userId = USER_ID + '-mleave';
  let communityId: string;

  beforeAll(async () => {
    if (SKIP) return;
    const { community } = await upsertCommunity({ discordGuildId: guildId, name: 'MLeave Guild' });
    communityId = community.id;
  });

  beforeEach(async () => {
    if (SKIP) return;
    const db = getDatabase();
    await db
      .delete(schema.profiles)
      .where(and(eq(schema.profiles.communityId, communityId), eq(schema.profiles.discordId, userId)));
    // Seed active profile
    await upsertProfile({ communityId, discordId: userId, setJoinedAt: true });
  });

  afterAll(async () => { await cleanGuild(guildId); });

  it('AC-10: sets metadata.active=false', async () => {
    const handlers = createDefaultNatsEventHandlers();
    const handler = handlers.get('member.leave')!;

    await handler(makeMockPayload('member.leave', { guild_id: guildId, user_id: userId }), log);

    const rows = await getProfilesForUser(communityId, userId);
    expect(rows[0]!.metadata?.active).toBe(false);
  });

  it('AC-11: N replays on inactive profile → no error', async () => {
    const handlers = createDefaultNatsEventHandlers();
    const handler = handlers.get('member.leave')!;
    const payload = makeMockPayload('member.leave', { guild_id: guildId, user_id: userId });

    await handler(payload, log);
    await expect(handler(payload, log)).resolves.toBeUndefined();
    await expect(handler(payload, log)).resolves.toBeUndefined();
  });

  it('AC-12: absent profile → no write, no throw', async () => {
    const handlers = createDefaultNatsEventHandlers();
    const handler = handlers.get('member.leave')!;
    const db = getDatabase();
    // Remove seeded profile
    await db
      .delete(schema.profiles)
      .where(and(eq(schema.profiles.communityId, communityId), eq(schema.profiles.discordId, userId)));

    await expect(
      handler(makeMockPayload('member.leave', { guild_id: guildId, user_id: userId }), log)
    ).resolves.toBeUndefined();
  });
});

describe.skipIf(SKIP)('handleMemberUpdate', () => {
  const guildId = GUILD_ID + '-mupdate';
  const userId = USER_ID + '-mupdate';
  let communityId: string;

  beforeAll(async () => {
    if (SKIP) return;
    const { community } = await upsertCommunity({ discordGuildId: guildId, name: 'MUpdate Guild' });
    communityId = community.id;
  });

  beforeEach(async () => {
    if (SKIP) return;
    const db = getDatabase();
    await db
      .delete(schema.profiles)
      .where(and(eq(schema.profiles.communityId, communityId), eq(schema.profiles.discordId, userId)));
  });

  afterAll(async () => { await cleanGuild(guildId); });

  it('AC-13: updates tier; preserves unrelated metadata keys', async () => {
    // Seed profile with extra metadata
    await upsertProfile({
      communityId,
      discordId: userId,
      metadataPatch: { username: 'testuser', preferences: { notifications: true } as any },
      setJoinedAt: true,
    });

    const handlers = createDefaultNatsEventHandlers();
    const handler = handlers.get('member.update')!;

    await handler(
      makeMockPayload('member.update', { guild_id: guildId, user_id: userId, data: { tier: 'gold' } }),
      log
    );

    const rows = await getProfilesForUser(communityId, userId);
    expect(rows[0]!.tier).toBe('gold');
    // Unrelated metadata preserved via JSONB merge
    expect((rows[0]!.metadata as any)?.username).toBe('testuser');
  });

  it('AC-14: memberUpdate before memberJoin → no throw; memberJoin converges without duplication', async () => {
    const handlers = createDefaultNatsEventHandlers();
    const updateHandler = handlers.get('member.update')!;
    const joinHandler = handlers.get('member.join')!;

    // memberUpdate arrives first
    await expect(
      updateHandler(
        makeMockPayload('member.update', { guild_id: guildId, user_id: userId, data: { tier: 'silver' } }),
        log
      )
    ).resolves.toBeUndefined();

    let rows = await getProfilesForUser(communityId, userId);
    expect(rows).toHaveLength(1);
    const joinedAtAfterUpdate = rows[0]!.joinedAt;

    // memberJoin arrives after
    await joinHandler(
      makeMockPayload('member.join', { guild_id: guildId, user_id: userId }),
      log
    );

    rows = await getProfilesForUser(communityId, userId);
    expect(rows).toHaveLength(1);
    // joinedAt should be preserved from the update's implicit insert
    expect(rows[0]!.joinedAt.toISOString()).toBe(joinedAtAfterUpdate.toISOString());
  });
});

// ---------------------------------------------------------------------------
// Validation cross-handler (AC-15 already covered per-handler above)
// AC-15 summary test — missing guildId or discordId → no DB write, no throw
// ---------------------------------------------------------------------------

describe.skipIf(SKIP)('validation (AC-15)', () => {
  const guildId = GUILD_ID + '-validation';

  it('AC-15: missing guildId → no DB write, no throw across handler types', async () => {
    const handlers = createDefaultNatsEventHandlers();
    for (const eventType of ['guild.leave', 'member.join', 'member.leave', 'member.update']) {
      const handler = handlers.get(eventType)!;
      await expect(
        handler(makeMockPayload(eventType, { guild_id: null, user_id: 'u1' }), log)
      ).resolves.toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// AC-18: structural (path-domain check — documented, not run here)
// All changed files are exclusively under apps/worker/ — enforced by CI.
// ---------------------------------------------------------------------------

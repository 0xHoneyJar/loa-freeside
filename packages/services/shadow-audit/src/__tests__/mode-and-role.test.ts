import { describe, it, expect } from 'vitest';
import { resolveMode, type ModeContext } from '../mode-resolver.js';
import {
  RoleSnapshotSchema,
  isSnapshotFresh,
  resolveRoles,
  type RoleSnapshot,
} from '../role-snapshot.js';

const NOW = Math.floor(Date.UTC(2026, 5, 22, 12, 0, 0) / 1000);

function snapshot(over: Partial<RoleSnapshot> = {}): RoleSnapshot {
  return {
    source: 'discord:guild:123',
    community: 'the-honey-jar',
    captured_at: '2026-06-22T11:00:00.000Z', // 1h before NOW
    export_method: 'discord-bot-export',
    owner: '0x' + '1'.repeat(40),
    freshness_threshold_seconds: 86_400, // 24h
    entries: [
      { discord_user_id: 'u1', wallet: '0x' + 'A'.repeat(40), role_ids: ['holder'] },
      { discord_user_id: 'u2', role_ids: ['holder'] }, // unresolved wallet
    ],
    ...over,
  };
}

describe('resolveMode (AC-5)', () => {
  it('refuses an external (non-operated) community with the conversation hook', () => {
    const ctx: ModeContext = { isOperatedCommunity: false, nowUnixSeconds: NOW };
    const r = resolveMode(ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusal.code).toBe('external-mode');
  });

  it('refuses an operated community with no role snapshot', () => {
    const r = resolveMode({ isOperatedCommunity: true, nowUnixSeconds: NOW });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusal.code).toBe('external-mode');
  });

  it('serves dogfood-full with a fresh snapshot (not uncertain)', () => {
    const r = resolveMode({ isOperatedCommunity: true, roleSnapshot: snapshot(), nowUnixSeconds: NOW });
    expect(r).toEqual({ ok: true, mode: 'dogfood-full', snapshotFresh: true, uncertain: false });
  });

  it('serves dogfood-full but LABELS uncertain when the snapshot is stale (no silent degradation)', () => {
    const stale = snapshot({ captured_at: '2026-06-20T11:00:00.000Z' }); // >24h before NOW
    const r = resolveMode({ isOperatedCommunity: true, roleSnapshot: stale, nowUnixSeconds: NOW });
    expect(r).toEqual({ ok: true, mode: 'dogfood-full', snapshotFresh: false, uncertain: true });
  });

  it('is deterministic for identical context', () => {
    const ctx: ModeContext = { isOperatedCommunity: true, roleSnapshot: snapshot(), nowUnixSeconds: NOW };
    expect(resolveMode(ctx)).toEqual(resolveMode(ctx));
  });
});

describe('isSnapshotFresh', () => {
  it('is fresh exactly at the threshold boundary', () => {
    const snap = snapshot({ captured_at: '2026-06-21T12:00:00.000Z', freshness_threshold_seconds: 86_400 });
    expect(isSnapshotFresh(snap, NOW)).toBe(true); // exactly 24h
  });

  it('is stale one second past the threshold', () => {
    const snap = snapshot({ captured_at: '2026-06-21T11:59:59.000Z', freshness_threshold_seconds: 86_400 });
    expect(isSnapshotFresh(snap, NOW)).toBe(false);
  });
});

describe('resolveRoles (IMP-005 — flag, never drop)', () => {
  it('collects lowercased role wallets and flags unmatched role-holders', () => {
    const res = resolveRoles(snapshot());
    expect(res.roleWallets.has('0x' + 'a'.repeat(40))).toBe(true); // lowercased
    expect(res.unmatched).toEqual([{ discord_user_id: 'u2', role_ids: ['holder'] }]);
  });
});

describe('RoleSnapshotSchema', () => {
  it('accepts a valid snapshot', () => {
    expect(RoleSnapshotSchema.safeParse(snapshot()).success).toBe(true);
  });

  it('rejects a missing freshness threshold (.strict + required)', () => {
    const bad = snapshot() as Record<string, unknown>;
    delete bad.freshness_threshold_seconds;
    expect(RoleSnapshotSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects an entry with no role_ids', () => {
    const bad = snapshot({ entries: [{ discord_user_id: 'u3', role_ids: [] }] });
    expect(RoleSnapshotSchema.safeParse(bad).success).toBe(false);
  });
});

import { describe, it, expect } from 'vitest';
import { resolveMode, type ModeContext } from '../mode-resolver.js';
import {
  RoleSnapshotSchema,
  isSnapshotFresh,
  resolveRoles,
  type RoleSnapshot,
} from '../role-snapshot.js';

const NOW = Math.floor(Date.UTC(2026, 5, 22, 12, 0, 0) / 1000);

/** A wallet-bearing (matched) entry. */
function matched(n: number): RoleSnapshot['entries'][number] {
  return {
    discord_user_id: `u${n}`,
    wallet: '0x' + n.toString(16).padStart(40, '0'),
    role_ids: ['holder'],
  };
}
/** A role-holder whose wallet did NOT resolve — flagged, never dropped. */
function unmatched(n: number): RoleSnapshot['entries'][number] {
  return { discord_user_id: `u${n}`, role_ids: ['holder'] };
}

/** Default: FULLY-COVERED (every role-holder resolved) — the confident case. */
function snapshot(over: Partial<RoleSnapshot> = {}): RoleSnapshot {
  return {
    source: 'discord:guild:123',
    community: 'the-honey-jar',
    collection: { chain: '1', contract: '0x' + 'a'.repeat(40) },
    captured_at: '2026-06-22T11:00:00.000Z', // 1h before NOW
    export_method: 'discord-bot-export',
    owner: '0x' + '1'.repeat(40),
    freshness_threshold_seconds: 86_400, // 24h
    entries: [matched(1), matched(2)],
    ...over,
  };
}

/** `matchedCount` resolved wallets out of `total` role-holders. */
function coverageSnapshot(matchedCount: number, total: number): RoleSnapshot {
  const entries = Array.from({ length: total }, (_, i) =>
    i < matchedCount ? matched(i + 1) : unmatched(i + 1),
  );
  return snapshot({ entries });
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

  it('serves dogfood-full with a fresh, fully-covered snapshot (not uncertain)', () => {
    const r = resolveMode({ isOperatedCommunity: true, roleSnapshot: snapshot(), nowUnixSeconds: NOW });
    expect(r).toEqual({
      ok: true,
      mode: 'dogfood-full',
      snapshotFresh: true,
      uncertain: false,
      uncertainReasons: [],
      roleCoverage: 1,
    });
  });

  it('serves dogfood-full but LABELS uncertain when the snapshot is stale (no silent degradation)', () => {
    const stale = snapshot({ captured_at: '2026-06-20T11:00:00.000Z' }); // >24h before NOW
    const r = resolveMode({ isOperatedCommunity: true, roleSnapshot: stale, nowUnixSeconds: NOW });
    expect(r).toEqual({
      ok: true,
      mode: 'dogfood-full',
      snapshotFresh: false,
      uncertain: true,
      uncertainReasons: ['stale-snapshot'],
      roleCoverage: 1,
    });
  });

  it('is deterministic for identical context', () => {
    const ctx: ModeContext = { isOperatedCommunity: true, roleSnapshot: snapshot(), nowUnixSeconds: NOW };
    expect(resolveMode(ctx)).toEqual(resolveMode(ctx));
  });
});

/**
 * THE BUG (live, 2026-07-12): the THJ export produced a FRESH, contract-valid snapshot of 515
 * role-holders of which exactly 1 resolved to a wallet (their links live in CollabLand, not
 * identity-api). Freshness was the ONLY input to uncertainty, so the audit reported `uncertain:
 * false` — most confident precisely when the role data was least trustworthy.
 */
describe('resolveMode — role coverage drives uncertainty (bug 20260712-486383)', () => {
  it('REFUSES a fresh snapshot below the coverage floor — the real 1/515 THJ case', () => {
    const r = resolveMode({
      isOperatedCommunity: true,
      roleSnapshot: coverageSnapshot(1, 515),
      nowUnixSeconds: NOW,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusal.code).toBe('role-coverage-too-low');
    // The refusal must NAME what we cannot see — "be honest about what we cannot see" — while still
    // k-anonymizing the sub-k matched cohort (see the HIGH-1 block below).
    expect(r.refusal.reason).toContain('515');
    expect(r.refusal.reason).toContain('could be resolved to a wallet');
    expect(r.refusal.retryable).toBe(false);
  });

  it('REFUSES when the snapshot has no role-holders at all (a vacuous audit is still a lie)', () => {
    const r = resolveMode({
      isOperatedCommunity: true,
      roleSnapshot: coverageSnapshot(0, 0),
      nowUnixSeconds: NOW,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusal.code).toBe('role-coverage-too-low');
  });

  it('serves but LABELS uncertain when coverage is partial (above the floor, below confident)', () => {
    const r = resolveMode({
      isOperatedCommunity: true,
      roleSnapshot: coverageSnapshot(14, 20), // 70% — above the 50% floor, below the 90% bar
      nowUnixSeconds: NOW,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.uncertain).toBe(true);
    expect(r.uncertainReasons).toEqual(['low-role-coverage']);
    expect(r.roleCoverage).toBe(0.7);
    expect(r.snapshotFresh).toBe(true); // NOT stale — coverage alone drove the uncertainty
  });

  it('names BOTH reasons when a snapshot is stale AND under-covered', () => {
    const snap = coverageSnapshot(14, 20);
    snap.captured_at = '2026-06-20T11:00:00.000Z'; // >24h before NOW
    const r = resolveMode({ isOperatedCommunity: true, roleSnapshot: snap, nowUnixSeconds: NOW });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.uncertainReasons).toEqual(['stale-snapshot', 'low-role-coverage']);
  });

  it('does NOT flag a healthy-coverage community as uncertain (no false positives)', () => {
    const r = resolveMode({
      isOperatedCommunity: true,
      roleSnapshot: coverageSnapshot(19, 20), // 95%
      nowUnixSeconds: NOW,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.uncertain).toBe(false);
    expect(r.uncertainReasons).toEqual([]);
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
    const res = resolveRoles(
      snapshot({
        entries: [
          { discord_user_id: 'u1', wallet: '0x' + 'A'.repeat(40), role_ids: ['holder'] },
          { discord_user_id: 'u2', role_ids: ['holder'] }, // unresolved wallet
        ],
      }),
    );
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

/**
 * HIGH-1 (security audit) — the REFUSAL must honor the same k-anonymity as the success path.
 *
 * The refusal `reason` is returned VERBATIM to callers. Naming exact counts leaked precisely what the
 * aggregate suppresses: with total=6 / matched=2, `unmatched = 6 - 2 = 4` — an exact sub-k cohort the
 * success path publishes only as `{bucketed '<5'}`. A rounded percentage is no safer: beside an exact
 * denominator it re-derives the numerator ("rounding is not suppression"). A failure channel that
 * discloses what the success channel hides is not a smaller leak, just a quieter one.
 */
describe('resolveMode — the refusal cannot leak a sub-k cohort (HIGH-1)', () => {
  it('SUPPRESSES a sub-k matched cohort: total=6 / matched=2 must not disclose "2" or "33%"', () => {
    const r = resolveMode({
      isOperatedCommunity: true,
      roleSnapshot: coverageSnapshot(2, 6),
      nowUnixSeconds: NOW,
      k: 5,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const reason = r.refusal.reason;
    expect(r.refusal.code).toBe('role-coverage-too-low');
    // The exact numerator (and therefore unmatched = 6 - 2 = 4, a sub-k cohort) must NOT be derivable.
    expect(reason).not.toMatch(/\b2 of 6\b/);
    expect(reason).not.toContain('33%');
    expect(reason).toContain('fewer than 5'); // the k-anon bucket
    expect(reason).toContain('6'); // the denominator stays exact (a role-size, >= k)
  });

  it('SUPPRESSES the size-1 matched cohort in the real THJ case (no bare "1 of 515")', () => {
    const r = resolveMode({
      isOperatedCommunity: true,
      roleSnapshot: coverageSnapshot(1, 515),
      nowUnixSeconds: NOW,
      k: 5,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    // "exactly one person in your guild is linked" is a cohort of ONE — the thing k-anon exists for.
    expect(r.refusal.reason).not.toMatch(/\b1 of 515\b/);
    // \b prevents this from matching inside "50% coverage floor" — we're forbidding the TRUE ratio (0%),
    // not the floor's own published constant.
    expect(r.refusal.reason).not.toMatch(/\b0% coverage/);
    expect(r.refusal.reason).toContain('fewer than 5');
    expect(r.refusal.reason).toContain('515'); // still names what we cannot see
    expect(r.refusal.reason).toContain('re-export'); // still actionable — it IS the sales conversation
  });

  it('does NOT over-suppress the honest case: an EXACT (>= k) matched cohort keeps its counts', () => {
    const r = resolveMode({
      isOperatedCommunity: true,
      roleSnapshot: coverageSnapshot(30, 100), // 30% coverage, matched 30 >= k
      nowUnixSeconds: NOW,
      k: 5,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusal.reason).toContain('only 30 of 100');
    expect(r.refusal.reason).toContain('30% coverage'); // safe: the numerator is already exact
  });

  it('REFUSES cohort-too-small when the role set itself is below k (the denominator would expose it)', () => {
    const r = resolveMode({
      isOperatedCommunity: true,
      roleSnapshot: coverageSnapshot(1, 4), // 4 role-holders total, k=5
      nowUnixSeconds: NOW,
      k: 5,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusal.code).toBe('cohort-too-small');
    expect(r.refusal.reason).not.toMatch(/\b1 of 4\b/);
  });
});

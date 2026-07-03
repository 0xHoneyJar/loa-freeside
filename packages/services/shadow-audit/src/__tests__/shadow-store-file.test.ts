import { describe, it, expect, beforeEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendFileSync, existsSync, rmSync } from 'node:fs';
import { makeFileStore } from '../shadow-store-file.js';
import { runShadow, type ShadowRunInput } from '@freeside/shadow-audit-protocol';
import type { AccessDecisionRecord } from '@freeside/shadow-audit-protocol';

const PATH = join(tmpdir(), 'shadow-store-file.test.jsonl');
beforeEach(() => {
  if (existsSync(PATH)) rmSync(PATH);
});

const rec = (o: { band: AccessDecisionRecord['band']; holds_role: boolean; qualifies: boolean; wallet: string }): AccessDecisionRecord => ({
  wallet: o.wallet,
  community: 'honeycomb',
  holds_role: o.holds_role,
  qualifies: o.qualifies,
  band: o.band,
  evidence: { balance_at_snapshot: 1 },
  provenance: { rule_id: 'tier-1', snapshot_block: 887577, computed_at: '2026-06-28T00:00:00.000Z', sources: ['sonar'] },
});
const input = (over: Partial<ShadowRunInput> = {}): ShadowRunInput => ({
  community: 'honeycomb',
  mode: 'dogfood-full',
  computed_at: '2026-06-28T00:00:00.000Z',
  records: [rec({ band: 'stale', holds_role: true, qualifies: false, wallet: `0x${'1'.repeat(40)}` })],
  ...over,
});

describe('makeFileStore — durable ShadowStore', () => {
  it('persists to disk — a FRESH store reading the same file sees the snapshot', async () => {
    await runShadow(input(), makeFileStore(PATH));
    const fresh = makeFileStore(PATH); // a separate process/cadence reopening the file
    const latest = await fresh.latest('honeycomb');
    expect(latest).toBeDefined();
    expect(latest!.report.aggregate.demotions).toBe(1);
  });

  it('appends a growing series across runs (the dashboard history)', async () => {
    const store = makeFileStore(PATH);
    await runShadow(input({ computed_at: '2026-06-28T00:00:00.000Z' }), store);
    await runShadow(input({ computed_at: '2026-06-29T00:00:00.000Z' }), store);
    const series = await makeFileStore(PATH).series('honeycomb');
    expect(series.length).toBe(2);
    expect(series[1]?.computed_at).toBe('2026-06-29T00:00:00.000Z');
  });

  it('isolates communities + returns empty for an unknown one', async () => {
    await runShadow(input(), makeFileStore(PATH));
    expect(await makeFileStore(PATH).series('other')).toEqual([]);
    expect(await makeFileStore(PATH).latest('other')).toBeUndefined();
  });

  it('refuses a malformed snapshot at the boundary (never persists garbage)', async () => {
    await expect(makeFileStore(PATH).append({ community: 'x' } as never)).rejects.toThrow();
  });

  it('survives a torn/garbage line — one bad line does not brick the whole history (FAGAN HIGH-1)', async () => {
    const store = makeFileStore(PATH);
    await runShadow(input({ computed_at: '2026-06-28T00:00:00.000Z' }), store);
    // simulate a crash mid-append + a hand-edit: a torn JSON fragment and an outright garbage line
    appendFileSync(PATH, '{"community":"honeycomb","mode":"dogfo'); // torn (invalid JSON, no newline)
    appendFileSync(PATH, '\nnot json at all\n');
    await runShadow(input({ computed_at: '2026-06-29T00:00:00.000Z' }), store);
    // both VALID snapshots still read back; the two bad lines are skipped, never thrown
    const series = await makeFileStore(PATH).series('honeycomb');
    expect(series.map((s) => s.computed_at)).toEqual(['2026-06-28T00:00:00.000Z', '2026-06-29T00:00:00.000Z']);
    expect((await makeFileStore(PATH).latest('honeycomb'))?.computed_at).toBe('2026-06-29T00:00:00.000Z');
  });
});

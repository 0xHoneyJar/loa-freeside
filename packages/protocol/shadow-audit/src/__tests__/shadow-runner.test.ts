import { describe, it, expect } from 'vitest';
import { makeMemoryStore, runShadow, ShadowSnapshotSchema, type ShadowRunInput } from '../shadow-runner.js';
import type { AccessDecisionRecord } from '../schemas/access-decision-record.js';

const rec = (o: { band: AccessDecisionRecord['band']; holds_role: boolean; qualifies: boolean; wallet: string }): AccessDecisionRecord => ({
  wallet: o.wallet,
  community: 'honeycomb',
  holds_role: o.holds_role,
  qualifies: o.qualifies,
  band: o.band,
  evidence: { balance_at_snapshot: 1 },
  provenance: { rule_id: 'tier-1', snapshot_block: 887577, computed_at: '2026-06-28T00:00:00.000Z', sources: ['sonar'] },
});
const addr = (n: string) => `0x${n.repeat(40)}`;

const input = (over: Partial<ShadowRunInput> = {}): ShadowRunInput => ({
  community: 'honeycomb',
  mode: 'dogfood-full',
  computed_at: '2026-06-28T00:00:00.000Z',
  records: [
    rec({ band: 'stale', holds_role: true, qualifies: false, wallet: addr('1') }), // would demote
    rec({ band: 'missing', holds_role: false, qualifies: true, wallet: addr('2') }), // would promote
    rec({ band: 'ok', holds_role: true, qualifies: true, wallet: addr('3') }), // unchanged
  ],
  ...over,
});

describe('Shadow Mode — runShadow (produce + persist, read-only)', () => {
  it('produces + persists a schema-valid snapshot carrying the discrepancy', async () => {
    const store = makeMemoryStore();
    const snap = await runShadow(input(), store);
    expect(() => ShadowSnapshotSchema.parse(snap)).not.toThrow();
    expect(snap.report.aggregate.demotions).toBe(1);
    expect(snap.report.aggregate.promotions).toBe(1);
    expect(snap.report.aggregate.no_change).toBe(1);
    expect(await store.latest('honeycomb')).toEqual(snap);
  });

  it('appends a SERIES over time — the dashboard watches the discrepancy converge before going live', async () => {
    const store = makeMemoryStore();
    await runShadow(input({ computed_at: '2026-06-28T00:00:00.000Z' }), store);
    await runShadow(input({ computed_at: '2026-06-29T00:00:00.000Z' }), store);
    const series = await store.series('honeycomb');
    expect(series.length).toBe(2);
    expect(series[1]?.computed_at).toBe('2026-06-29T00:00:00.000Z');
  });

  it('is READ-ONLY — it touches no input record (and by construction, no Discord role)', async () => {
    const inp = input();
    const before = JSON.stringify(inp.records);
    await runShadow(inp, makeMemoryStore());
    expect(JSON.stringify(inp.records)).toBe(before);
  });

  it('isolates communities in the store', async () => {
    const store = makeMemoryStore();
    await runShadow(input({ community: 'honeycomb' }), store);
    expect(await store.latest('some-other-community')).toBeUndefined();
  });
});

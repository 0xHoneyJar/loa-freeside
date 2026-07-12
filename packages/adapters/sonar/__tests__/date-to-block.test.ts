import { describe, it, expect } from 'vitest';
import {
  utcBoundaryUnix,
  snapshotDateToBlock,
  type BlockTimeResolver,
} from '../date-to-block.js';
import { ReconstructionError } from '../types.js';

describe('utcBoundaryUnix (AC-2 determinism)', () => {
  it('computes a deterministic UTC day-end boundary', () => {
    const u = utcBoundaryUnix('2026-06-22', 'day-end');
    expect(u).toBe(Math.floor(Date.UTC(2026, 5, 22, 23, 59, 59) / 1000));
    expect(utcBoundaryUnix('2026-06-22', 'day-end')).toBe(u);
  });

  it('computes the UTC day-start boundary', () => {
    expect(utcBoundaryUnix('2026-06-22', 'day-start')).toBe(
      Math.floor(Date.UTC(2026, 5, 22, 0, 0, 0) / 1000),
    );
  });

  it('rejects a malformed date string', () => {
    expect(() => utcBoundaryUnix('2026/06/22', 'day-end')).toThrow();
  });

  it('rejects a non-existent calendar date', () => {
    expect(() => utcBoundaryUnix('2026-02-30', 'day-end')).toThrow();
  });
});

describe('snapshotDateToBlock', () => {
  const resolver = (block: number, head: number): BlockTimeResolver => ({
    blockAtOrBefore: async () => block,
    headBlock: async () => head,
  });

  it('resolves a final block for a historical date', async () => {
    const r = await snapshotDateToBlock('2026-06-22', resolver(1000, 5000), { confirmations: 12 });
    expect(r.snapshotBlock).toBe(1000);
    expect(r.headBlock).toBe(5000);
  });

  it('is deterministic for the same date + chain state', async () => {
    const a = await snapshotDateToBlock('2026-06-22', resolver(1000, 5000), { confirmations: 12 });
    const b = await snapshotDateToBlock('2026-06-22', resolver(1000, 5000), { confirmations: 12 });
    expect(a.snapshotBlock).toBe(b.snapshotBlock);
    expect(a.boundaryUnix).toBe(b.boundaryUnix);
  });

  it('refuses a too-recent snapshot (within the reorg window)', async () => {
    await expect(
      snapshotDateToBlock('2026-06-22', resolver(4995, 5000), { confirmations: 12 }),
    ).rejects.toBeInstanceOf(ReconstructionError);
  });
});

/**
 * AC-2 — deterministic snapshot_date → snapshot_block.
 *
 * The UTC-day boundary for a date is computed PURELY (no wall-clock); the block
 * lookup is delegated to an injected resolver (mockable in tests, a real
 * RPC/indexer in production). Reorg finality is then enforced so a too-recent
 * snapshot is refused rather than served from the unstable tip.
 */

import { ReconstructionError } from './types.js';

export interface BlockTimeResolver {
  /** Highest block whose timestamp is <= unixSeconds. */
  blockAtOrBefore(unixSeconds: number): Promise<number>;
  /** Current chain head height. */
  headBlock(): Promise<number>;
}

export interface DateToBlockOptions {
  /** Confirmations below head treated as final (reorg safety, §11). */
  confirmations: number;
  /** Which UTC boundary of the day to snapshot at. Default 'day-end'. */
  boundary?: 'day-start' | 'day-end';
}

export interface SnapshotResolution {
  snapshotBlock: number;
  headBlock: number;
  boundaryUnix: number;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * UTC unix-seconds for the chosen boundary of a `YYYY-MM-DD` date. Pure and
 * deterministic. Rejects malformed or non-existent dates (e.g. 2026-02-30).
 */
export function utcBoundaryUnix(
  dateUTC: string,
  boundary: 'day-start' | 'day-end',
): number {
  if (!DATE_RE.test(dateUTC)) {
    throw new Error(`snapshot_date must be YYYY-MM-DD, got "${dateUTC}"`);
  }
  const [y, m, d] = dateUTC.split('-').map(Number) as [number, number, number];
  // Round-trip check: Date.UTC silently rolls over out-of-range components.
  const check = new Date(Date.UTC(y, m - 1, d));
  if (
    check.getUTCFullYear() !== y ||
    check.getUTCMonth() !== m - 1 ||
    check.getUTCDate() !== d
  ) {
    throw new Error(`snapshot_date is not a real calendar date: "${dateUTC}"`);
  }
  const ms =
    boundary === 'day-start'
      ? Date.UTC(y, m - 1, d, 0, 0, 0)
      : Date.UTC(y, m - 1, d, 23, 59, 59);
  return Math.floor(ms / 1000);
}

/**
 * Resolve a snapshot date to a final block. Throws `within-reorg-window` when
 * the resolved block is not yet buried beyond the confirmation depth.
 */
export async function snapshotDateToBlock(
  dateUTC: string,
  resolver: BlockTimeResolver,
  opts: DateToBlockOptions,
): Promise<SnapshotResolution> {
  const boundary = opts.boundary ?? 'day-end';
  const boundaryUnix = utcBoundaryUnix(dateUTC, boundary);
  const [snapshotBlock, headBlock] = await Promise.all([
    resolver.blockAtOrBefore(boundaryUnix),
    resolver.headBlock(),
  ]);
  if (snapshotBlock > headBlock - opts.confirmations) {
    throw new ReconstructionError(
      'within-reorg-window',
      `resolved block ${snapshotBlock} is within ${opts.confirmations} confirmations of head ${headBlock}`,
    );
  }
  return { snapshotBlock, headBlock, boundaryUnix };
}

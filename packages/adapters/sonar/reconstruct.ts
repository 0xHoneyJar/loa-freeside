/**
 * SDD §11 — Transfer-replay ownership reconstruction (the CRITICAL invariant).
 *
 * Folds a Transfer event stream into ownership @ a block, with:
 *   - dedup by full-row identity (paginated-overlap safe, batch safe),
 *   - reorg finality (snapshot must be buried beyond the confirmation depth),
 *   - ERC-721 owner-fold with provenance consistency,
 *   - ERC-1155 BALANCE semantics (per (owner, tokenId), value required),
 *   - refusal on any breach — never a silently-wrong holder set.
 */

import {
  ReconstructionError,
  ZERO_ADDRESS,
  type HolderBalances,
  type HolderDiff,
  type OwnershipAtBlock,
  type TokenStandard,
  type TransferEvent,
} from './types.js';

function lc(addr: string): string {
  return addr.toLowerCase();
}

/**
 * Full-tuple identity for dedup — removes byte-identical rows from paginated
 * overlap while preserving distinct batch entries (different tokenId/value).
 */
function eventKey(e: TransferEvent): string {
  return `${e.txHash}:${e.logIndex}:${e.tokenId}:${lc(e.from)}:${lc(e.to)}:${e.value ?? ''}`;
}

export interface ReconstructOptions {
  standard: TokenStandard;
  snapshotBlock: number;
  /** Chain head height; snapshotBlock must be <= headBlock - confirmations. */
  headBlock: number;
  /** Reorg finality depth (confirmations below head considered final). */
  confirmations: number;
  /**
   * The caller (transport) sets this true once it has paged until the cursor
   * was exhausted. False → 'incomplete-pagination' refusal (we will not fold a
   * partial stream).
   */
  paginationComplete: boolean;
}

/**
 * Fold a Transfer event stream into ownership @ snapshotBlock. The input MAY
 * contain duplicate rows (paginated overlap) but MUST otherwise be the complete
 * set of Transfers with blockNumber <= snapshotBlock. Throws on any §11 breach.
 */
export function reconstructOwnership(
  events: readonly TransferEvent[],
  opts: ReconstructOptions,
): OwnershipAtBlock {
  if (!opts.paginationComplete) {
    throw new ReconstructionError(
      'incomplete-pagination',
      'event stream is not known-complete (pagination cap hit before cursor exhausted)',
    );
  }
  // Reorg finality: the snapshot must be buried beyond the confirmation depth.
  if (opts.snapshotBlock > opts.headBlock - opts.confirmations) {
    throw new ReconstructionError(
      'within-reorg-window',
      `snapshotBlock ${opts.snapshotBlock} is within ${opts.confirmations} confirmations of head ${opts.headBlock}`,
    );
  }

  // Dedup, then sort canonically so the fold is order-deterministic regardless
  // of the input's arrival order.
  const seen = new Set<string>();
  const deduped: TransferEvent[] = [];
  for (const e of events) {
    if (e.blockNumber > opts.snapshotBlock) {
      throw new ReconstructionError(
        'event-after-snapshot',
        `event at block ${e.blockNumber} exceeds snapshot ${opts.snapshotBlock}`,
      );
    }
    const k = eventKey(e);
    if (seen.has(k)) continue;
    seen.add(k);
    deduped.push(e);
  }
  deduped.sort(
    (a, b) =>
      a.blockNumber - b.blockNumber ||
      a.logIndex - b.logIndex ||
      (a.tokenId < b.tokenId ? -1 : a.tokenId > b.tokenId ? 1 : 0),
  );

  const balances =
    opts.standard === 'erc721' ? fold721(deduped) : fold1155(deduped);
  return { standard: opts.standard, snapshotBlock: opts.snapshotBlock, balances };
}

/**
 * ERC-721: each Transfer moves a single tokenId. `from` must be the current
 * owner (or the zero address for a mint); the zero address as `to` is a burn.
 * Any provenance break means the stream is incomplete/corrupt → refuse.
 */
function fold721(events: readonly TransferEvent[]): HolderBalances {
  const owner = new Map<string, string>(); // tokenId -> current owner (lowercased)
  for (const e of events) {
    const from = lc(e.from);
    const to = lc(e.to);
    if (from === ZERO_ADDRESS) {
      if (owner.has(e.tokenId)) {
        throw new ReconstructionError(
          'inconsistent-721-provenance',
          `mint of already-owned tokenId ${e.tokenId}`,
        );
      }
    } else if (owner.get(e.tokenId) !== from) {
      throw new ReconstructionError(
        'inconsistent-721-provenance',
        `transfer of tokenId ${e.tokenId} from non-owner ${from}`,
      );
    }
    if (to === ZERO_ADDRESS) {
      owner.delete(e.tokenId);
    } else {
      owner.set(e.tokenId, to);
    }
  }
  const balances: HolderBalances = new Map();
  for (const holder of owner.values()) {
    balances.set(holder, (balances.get(holder) ?? 0n) + 1n);
  }
  return balances;
}

/**
 * ERC-1155: balance semantics. `value` is required; a mint is from-zero, a burn
 * is to-zero. Balances are tracked per (owner, tokenId) so an incomplete stream
 * that would drive any single token-balance negative is caught and refused; the
 * returned holder balance is the per-owner total across tokenIds (collection-
 * level gating). A `TransferBatch` arrives as one row per (tokenId, value).
 */
function fold1155(events: readonly TransferEvent[]): HolderBalances {
  const book = new Map<string, Map<string, bigint>>(); // owner -> tokenId -> balance
  const adjust = (addr: string, tokenId: string, delta: bigint): void => {
    const inner = book.get(addr) ?? new Map<string, bigint>();
    const next = (inner.get(tokenId) ?? 0n) + delta;
    if (next < 0n) {
      throw new ReconstructionError(
        'negative-balance',
        `balance for ${addr} tokenId ${tokenId} went negative`,
      );
    }
    if (next === 0n) inner.delete(tokenId);
    else inner.set(tokenId, next);
    if (inner.size === 0) book.delete(addr);
    else book.set(addr, inner);
  };

  for (const e of events) {
    if (e.value === undefined) {
      throw new ReconstructionError(
        'missing-erc1155-value',
        `erc1155 transfer at ${e.txHash}:${e.logIndex} has no value`,
      );
    }
    let amount: bigint;
    try {
      amount = BigInt(e.value);
    } catch {
      throw new ReconstructionError(
        'missing-erc1155-value',
        `erc1155 transfer at ${e.txHash}:${e.logIndex} has unparseable value "${e.value}"`,
      );
    }
    if (amount < 0n) {
      throw new ReconstructionError('negative-balance', `negative value "${e.value}"`);
    }
    const from = lc(e.from);
    const to = lc(e.to);
    if (from !== ZERO_ADDRESS) adjust(from, e.tokenId, -amount);
    if (to !== ZERO_ADDRESS) adjust(to, e.tokenId, amount);
  }

  const balances: HolderBalances = new Map();
  for (const [addr, inner] of book) {
    let total = 0n;
    for (const v of inner.values()) total += v;
    if (total > 0n) balances.set(addr, total);
  }
  return balances;
}

/**
 * Qualification diff between a snapshot and a comparison (head) balance set.
 * A wallet "qualifies" iff its balance >= threshold. Deterministic; addresses
 * returned sorted for stable output.
 */
export function diffQualification(
  snapshot: HolderBalances,
  head: HolderBalances,
  threshold: bigint,
): HolderDiff {
  const qualifies = (m: HolderBalances, a: string): boolean => (m.get(a) ?? 0n) >= threshold;
  const all = new Set<string>([...snapshot.keys(), ...head.keys()]);
  const soldLapsed: string[] = [];
  const newlyEligible: string[] = [];
  const retained: string[] = [];
  for (const addr of all) {
    const q0 = qualifies(snapshot, addr);
    const q1 = qualifies(head, addr);
    if (q0 && !q1) soldLapsed.push(addr);
    else if (!q0 && q1) newlyEligible.push(addr);
    else if (q0 && q1) retained.push(addr);
  }
  soldLapsed.sort();
  newlyEligible.sort();
  retained.sort();
  return { soldLapsed, newlyEligible, retained };
}

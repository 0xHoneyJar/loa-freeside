/**
 * Sonar adapter — types for Transfer-replay ownership reconstruction.
 *
 * The belt-gateway indexes ERC-721/1155 Transfer events for the 8 THJ
 * collections. We reconstruct ownership @ a block by folding the event stream;
 * see reconstruct.ts for the SDD §11 validation invariants. The reconstruction
 * REFUSES (throws ReconstructionError) on any inconsistency rather than
 * returning a silently-wrong holder set.
 */

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export type TokenStandard = 'erc721' | 'erc1155';

/**
 * A single Transfer movement. For an ERC-1155 `TransferBatch` the indexer emits
 * one row per (tokenId, value) pair, all sharing (txHash, logIndex). `value` is
 * REQUIRED for erc1155 (balance semantics) and absent for erc721.
 */
export interface TransferEvent {
  blockNumber: number;
  logIndex: number;
  txHash: string;
  from: string;
  to: string;
  tokenId: string;
  /** ERC-1155 amount (stringified non-negative integer). Absent for ERC-721. */
  value?: string;
}

/** Per-holder balance at a block: address (lowercased) → total units held. */
export type HolderBalances = Map<string, bigint>;

export interface OwnershipAtBlock {
  standard: TokenStandard;
  snapshotBlock: number;
  /** address (lowercased) → total units of the collection held at snapshotBlock. */
  balances: HolderBalances;
}

/** Qualification change between a snapshot block and a comparison (head) block. */
export interface HolderDiff {
  /** Qualified at snapshot, no longer qualified at head — the "stale access" set. */
  soldLapsed: string[];
  /** Not qualified at snapshot, qualified at head. */
  newlyEligible: string[];
  /** Qualified at both. */
  retained: string[];
}

/**
 * Reconstruction failure codes. The service layer maps these to the protocol
 * Refusal `reconstruction-failed` (AC-8). "Never silently wrong."
 */
export type ReconstructionFailure =
  | 'missing-erc1155-value'
  | 'negative-balance'
  | 'inconsistent-721-provenance'
  | 'event-after-snapshot'
  | 'within-reorg-window'
  | 'incomplete-pagination';

export class ReconstructionError extends Error {
  constructor(
    readonly code: ReconstructionFailure,
    message: string,
  ) {
    super(message);
    this.name = 'ReconstructionError';
  }
}

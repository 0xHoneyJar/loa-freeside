/**
 * ownership-projection-subscriber.ts — feed the L2 ownership projection from the signed ownership.changed
 * event stream (`nft.activity.recorded.v1`). The "event FLOWING into the spine" half of the keystone flow:
 *
 *   NATS `nft.activity.recorded.>`  ──(envelope verified: ed25519 signature + prev_hash chain — the ACVP
 *                                       layer, upstream in packages/events/subscriber.ts)──►
 *   this handler  ──►  projection.apply  ──►  the audit reads the maintained projection
 *
 * The handler is STRUCTURALLY typed against the event's relevant fields (a subset of `@freeside/events`
 * `NftActivity`) so this module stays dependency-light and verifiable inside shadow-audit. The thin real
 * subscriber glue imports the `@freeside/events` `NftActivity` (structurally compatible — `NftActivity ⊇
 * OwnershipActivity`) and an `EnvelopeHandler<NftActivity>` that calls `applyOwnershipActivity`, wired to the
 * `nft.activity.recorded.>` wildcard subject. At-least-once delivery is safe: idempotency lives in the
 * projection (a duplicate event is not double-counted).
 */
import type { OwnershipProjection, OwnershipChange } from './projection-ownership-source.js';

/** The relevant shape of a signed `nft.activity.recorded.v1` event (EVM). A structural subset of NftActivity. */
export interface OwnershipActivity {
  readonly verb: 'mint' | 'transfer' | 'sale' | 'burn';
  readonly from: string | null;
  readonly to: string | null;
  /** smallest-units decimal string; null for a bare ERC-721 transfer (one token). */
  readonly value: string | null;
  /** ISO-8601 UTC block time (envelope-consistent). */
  readonly timestamp: string;
  readonly metadata: {
    readonly chain: 'evm' | 'svm';
    readonly chain_id?: number;
    readonly contract?: string;
    readonly block_number?: number;
  };
}

/** chain_id → the chain name the audit's OwnershipSource keys by (order.source.chain). Extend as cells onboard. */
const CHAIN_NAME: Record<number, string> = { 1: 'ethereum', 8453: 'base', 80094: 'berachain' };
const chainNameOf = (chainId: number): string => CHAIN_NAME[chainId] ?? `evm:${chainId}`;

/**
 * Map a signed EVM ownership activity into an `OwnershipChange` the projection folds. Returns null for non-EVM
 * or activity missing its EVM enrichment (SVM is a follow-on; the audit is EVM-scoped today) — the caller skips
 * it rather than corrupting the projection with a partial change.
 */
export function ownershipActivityToChange(a: OwnershipActivity): OwnershipChange | null {
  const m = a.metadata;
  if (m.chain !== 'evm' || m.contract === undefined || m.block_number === undefined || m.chain_id === undefined) {
    return null;
  }
  return {
    chain: chainNameOf(m.chain_id),
    contract: m.contract,
    block: m.block_number,
    timestamp: a.timestamp,
    from: a.from,
    to: a.to,
    // ERC-721 transfer moves one token; ERC-1155 carries the amount in `value`.
    amount: a.value !== null ? BigInt(a.value) : 1n,
  };
}

/**
 * The subscriber handler core: apply one VERIFIED ownership activity to the projection. The envelope's
 * signature + hash-chain are already checked by packages/events/subscriber.ts before this runs (ACVP). Safe
 * under at-least-once delivery (the projection de-dups identical changes). Wire this to `nft.activity.recorded.>`.
 */
export function applyOwnershipActivity(projection: OwnershipProjection, a: OwnershipActivity): void {
  const change = ownershipActivityToChange(a);
  if (change !== null) projection.apply(change);
}

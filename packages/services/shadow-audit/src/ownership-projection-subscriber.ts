/**
 * ownership-projection-subscriber.ts — feed the L2 ownership projection from the signed ownership.changed
 * event stream (`nft.activity.recorded.v1`). The "event FLOWING into the spine" half of the keystone:
 *
 *   NATS `nft.activity.recorded.>`  ──(envelope verified: ed25519 + prev_hash — ACVP, upstream)──►
 *   this handler  ──►  projection.apply  ──►  the audit reads the maintained projection
 *
 * Structurally typed against the event's relevant fields (a subset of `@freeside/events` `NftActivity`) so this
 * module stays dependency-light + verifiable in shadow-audit. The thin real subscriber glue imports the
 * `@freeside/events` `NftActivity` (structurally compatible) + an `EnvelopeHandler<NftActivity>` that calls
 * `applyOwnershipActivity`, wired to `nft.activity.recorded.>`.
 *
 * ⚠ FAGAN HIGH-3 (open, cross-repo): `amount` rides on sonar-api's `value` semantics, which are NOT verified
 * here (sonar-api is a different repo; the belt-gateway Transfer table has no `value` column). We guard the
 * null/'0' case (→ 1 token, the ERC-721 form) but CANNOT distinguish "value = amount" (ERC-1155) from
 * "value = tokenId" (a common indexer convention) without a token `standard` on the event. A pinned
 * sonar-api↔shadow-audit contract test for the exact per-standard `value` semantics is required before
 * production cutover.
 */
import type { OwnershipProjection, OwnershipChange } from './projection-ownership-source.js';

/** The relevant shape of a signed `nft.activity.recorded.v1` event (EVM). A structural subset of NftActivity. */
export interface OwnershipActivity {
  readonly verb: 'mint' | 'transfer' | 'sale' | 'burn';
  readonly from: string | null;
  readonly to: string | null;
  /** smallest-units decimal string; null for a bare ERC-721 transfer. */
  readonly value: string | null;
  /** ISO-8601 UTC block time. */
  readonly timestamp: string;
  /** the transaction hash — half of the event's unique identity (with log_index). */
  readonly tx: string;
  readonly metadata: {
    readonly chain: 'evm' | 'svm';
    readonly chain_id?: number;
    readonly contract?: string;
    readonly block_number?: number;
    /** the log index within the tx — the other half of the unique identity. */
    readonly log_index?: number;
  };
}

/** chain_id → the chain name the audit's OwnershipSource keys by (order.source.chain). The SINGLE write-side
 *  source of truth; must agree with the order/registry read side (FAGAN MEDIUM-1 — divergence = silent empty). */
const CHAIN_NAME: Record<number, string> = { 1: 'ethereum', 8453: 'base', 80094: 'berachain' };

/**
 * Map a signed EVM ownership activity into an `OwnershipChange`. Returns null (the caller SKIPS, never corrupts
 * the projection) for: non-EVM, missing EVM enrichment, an UNMAPPED chain_id (don't mint a synthetic `evm:N`
 * key that can never match `order.source.chain` — FAGAN MEDIUM-1), or a missing tx/log_index (no stable identity).
 */
export function ownershipActivityToChange(a: OwnershipActivity): OwnershipChange | null {
  const m = a.metadata;
  if (m.chain !== 'evm' || m.contract === undefined || m.block_number === undefined || m.chain_id === undefined) {
    return null;
  }
  const chain = CHAIN_NAME[m.chain_id];
  if (chain === undefined) return null; // unmapped chain — skip rather than mint a non-matching key
  if (typeof a.tx !== 'string' || a.tx === '' || m.log_index === undefined) return null; // no stable identity
  return {
    chain,
    contract: m.contract,
    block: m.block_number,
    timestamp: a.timestamp,
    tx: a.tx,
    logIndex: m.log_index,
    from: a.from,
    to: a.to,
    // null/'0' → one token (the ERC-721 form). A positive value is the ERC-1155 amount. See HIGH-3 caveat above.
    amount: a.value === null || a.value === '0' ? 1n : BigInt(a.value),
  };
}

/**
 * The subscriber handler core: apply one VERIFIED ownership activity to the projection (envelope checked
 * upstream). Idempotency lives in the projection (at-least-once safe). Wire this to `nft.activity.recorded.>`.
 */
export function applyOwnershipActivity(projection: OwnershipProjection, a: OwnershipActivity): void {
  const change = ownershipActivityToChange(a);
  if (change !== null) projection.apply(change);
}

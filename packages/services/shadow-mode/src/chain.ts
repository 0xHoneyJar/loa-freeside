/**
 * Hash chain over the append-only observation stream (SDD sandwich-line §6a).
 *
 * The chain lives in the STORE layer — protocol v1 schemas stay frozen. Each
 * link: hash = sha256(JCS({chain_version, chain_id, seq, prev_hash, observation})).
 * Ordering is the store-assigned monotonic `seq`; timestamps are payload, never
 * order. Verification failure is tamper-evidence: fail loud, freeze appends,
 * never silently repair.
 */

import { createHash } from 'node:crypto';
import { jcsBytes, type ShadowObservation } from '@freeside/shadow-mode-protocol';

export const CHAIN_VERSION = 'shadow.chain.v1' as const;
export const GENESIS_PREV_HASH = '0'.repeat(64);
/** Synthetic first observation of every chain (seq 0). */
export const GENESIS_EVENT_NAME = 'chain.genesis' as const;

export interface ChainLink {
  chain_id: string;
  seq: number;
  event_id: string;
  prev_hash: string;
  hash: string;
  chain_version: string;
}

export function computeLinkHash(
  chainId: string,
  seq: number,
  prevHash: string,
  observation: ShadowObservation,
  chainVersion: string = CHAIN_VERSION,
): string {
  const bytes = jcsBytes({
    chain_version: chainVersion,
    chain_id: chainId,
    seq,
    prev_hash: prevHash,
    observation,
  });
  return createHash('sha256').update(bytes).digest('hex');
}

/** Build the next link. `prev` is null only for genesis (seq 0). */
export function chainLink(
  chainId: string,
  prev: ChainLink | null,
  observation: ShadowObservation,
): ChainLink {
  const seq = prev ? prev.seq + 1 : 0;
  const prevHash = prev ? prev.hash : GENESIS_PREV_HASH;
  return {
    chain_id: chainId,
    seq,
    event_id: observation.event_id,
    prev_hash: prevHash,
    hash: computeLinkHash(chainId, seq, prevHash, observation),
    chain_version: CHAIN_VERSION,
  };
}

/** Appends to a frozen chain are rejected until an operator-audited clear. */
export class ChainFrozenError extends Error {
  constructor(
    public readonly chainId: string,
    public readonly firstBadSeq: number,
  ) {
    super(`chain ${chainId} is frozen (first bad seq ${firstBadSeq}) — operator clear required`);
  }
}

export type ChainVerdict =
  | { ok: true; length: number }
  | { ok: false; first_bad_seq: number; reason: 'hash_mismatch' | 'broken_linkage' | 'seq_gap' | 'event_id_mismatch' };

/**
 * Recompute every hash from links + their observations. Deterministic replay:
 * a valid chain re-verifies byte-exactly forever.
 */
export function verifyChain(
  links: readonly ChainLink[],
  observationByEventId: (eventId: string) => ShadowObservation | undefined,
): ChainVerdict {
  let prevHash = GENESIS_PREV_HASH;
  for (let i = 0; i < links.length; i++) {
    const link = links[i]!;
    if (link.seq !== i) return { ok: false, first_bad_seq: link.seq, reason: 'seq_gap' };
    if (link.prev_hash !== prevHash) return { ok: false, first_bad_seq: link.seq, reason: 'broken_linkage' };
    const observation = observationByEventId(link.event_id);
    if (!observation || observation.event_id !== link.event_id) {
      return { ok: false, first_bad_seq: link.seq, reason: 'event_id_mismatch' };
    }
    const expected = computeLinkHash(link.chain_id, link.seq, link.prev_hash, observation, link.chain_version);
    if (expected !== link.hash) return { ok: false, first_bad_seq: link.seq, reason: 'hash_mismatch' };
    prevHash = link.hash;
  }
  return { ok: true, length: links.length };
}

/**
 * The synthetic genesis observation for a chain (stored like any other, seq 0).
 * `name` is store-internal and never crosses the ingest validation boundary —
 * the cast below is deliberate; protocol v1's EventName enum stays frozen.
 */
export function genesisObservation(chainId: string, nowIso: string): ShadowObservation {
  return {
    event_id: `genesis:${chainId}`,
    community_id: chainId,
    name: GENESIS_EVENT_NAME as ShadowObservation['name'],
    source: 'system' as ShadowObservation['source'],
    truth_status: 'observed' as ShadowObservation['truth_status'],
    observed_at: nowIso,
    emitted_at: nowIso,
    payload: { chain_version: CHAIN_VERSION },
    ingested_at: nowIso,
  };
}

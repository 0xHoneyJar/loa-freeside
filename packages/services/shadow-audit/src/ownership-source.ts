/**
 * Sprint 2 / S2-T1 — the real `OwnershipSource` (the audit's ownership port), assembled from the sonar
 * adapter. THIS is the gap Sprint 1 left: the service was built against the port but only a test fake of
 * it ever existed. It wires the three real pieces together:
 *   - `resolveSnapshotBlock` ← `snapshotDateToBlock` (date→block, with reorg finality) + a per-chain
 *     `BlockTimeResolver` (block-time-resolver.ts).
 *   - `balancesAt` / `currentBalances` ← `SonarClient.ownershipAtBlock` (Transfer-replay reconstruction).
 *   - the chain+contract → collection+standard mapping ← an injected registry (a `chain/contract` an audit
 *     names that is NOT in the registry is REFUSED, never reconstructed as an unknown collection).
 *
 * Pure assembly over injected seams (sonar / resolverFor / registry), so the wiring is unit-tested with
 * fakes (no live network — the #306 discipline). ⚠ The LIVE correctness rides on block-time-resolver.ts's
 * RPC + the belt-gateway + the registry values — all DEPLOY config the operator must provide + verify.
 */

import type { SonarClient, BlockTimeResolver, TokenStandard } from '@freeside/adapters/sonar';
import { snapshotDateToBlock } from '@freeside/adapters/sonar';
import type { Balances, OwnershipSource } from './audit-service.js';

/** A collection an audit can reconstruct: the belt-gateway collection id + its token standard. */
export interface CollectionRef {
  readonly collection: string;
  readonly standard: TokenStandard;
}

/** Resolve a chain+contract to its belt-gateway collection, or undefined for an unknown one. */
export type CollectionRegistry = (args: { chain: string; contract: string }) => CollectionRef | undefined;

export interface SonarOwnershipOpts {
  /** the sonar reconstruction core (only `ownershipAtBlock` is used). */
  readonly sonar: Pick<SonarClient, 'ownershipAtBlock'>;
  /** a `BlockTimeResolver` for a chain — the RPC differs per chain, so it is resolved by chain id. */
  readonly resolverFor: (chain: string) => BlockTimeResolver;
  readonly registry: CollectionRegistry;
  /** reorg finality depth for both date→block and the "current" comparison block (default 12). */
  readonly confirmations?: number;
}

export function makeSonarOwnershipSource(opts: SonarOwnershipOpts): OwnershipSource {
  const confirmations = opts.confirmations ?? 12;

  const refOrThrow = (chain: string, contract: string): CollectionRef => {
    const ref = opts.registry({ chain, contract });
    if (!ref) {
      // refuse loudly: auditing an unknown collection would silently reconstruct garbage ownership.
      throw new Error(`shadow-audit: no collection registry entry for ${chain}/${contract} — refusing rather than auditing an unknown collection`);
    }
    return ref;
  };

  const balancesAtBlock = async (chain: string, ref: CollectionRef, snapshotBlock: number, headBlock: number): Promise<Balances> => {
    // chainId is LOAD-BEARING: collection ids repeat across chains (Honeycomb + HoneyJar1-6 exist on both
    // Ethereum and Berachain). Querying sonar by collection alone merged every chain's transfers into one
    // replay and reconstruction threw "mint of already-owned tokenId 1" against the live Honeycomb.
    const chainId = Number(chain);
    if (!Number.isInteger(chainId)) {
      throw new Error(`shadow-audit: chain "${chain}" is not a numeric chain id — refusing to query sonar unscoped`);
    }
    const own = await opts.sonar.ownershipAtBlock({
      collection: ref.collection,
      chainId,
      snapshotBlock,
      standard: ref.standard,
      headBlock,
    });
    return own.balances; // HolderBalances === Map<string, bigint> === Balances
  };

  return {
    async resolveSnapshotBlock({ chain, contract, snapshotDate }) {
      refOrThrow(chain, contract); // validate the collection is known BEFORE any chain work
      const { snapshotBlock } = await snapshotDateToBlock(snapshotDate, opts.resolverFor(chain), { confirmations });
      // -1 ⇒ the resolver found NO block at-or-before the date (before chain genesis). REFUSE rather than
      // reconstruct an empty snapshot at block 0 and serve a wrong audit (FAGAN HIGH-1).
      if (snapshotBlock < 0) {
        throw new Error(`shadow-audit: snapshot_date ${snapshotDate} is before chain ${chain} genesis — no block to reconstruct ownership at`);
      }
      return snapshotBlock;
    },

    async balancesAt({ chain, contract, snapshotBlock }) {
      const ref = refOrThrow(chain, contract);
      const head = await opts.resolverFor(chain).headBlock();
      return balancesAtBlock(chain, ref, snapshotBlock, head);
    },

    async currentBalances({ chain, contract }) {
      const ref = refOrThrow(chain, contract);
      const head = await opts.resolverFor(chain).headBlock();
      // "current" = the latest FINAL block (head − confirmations), for finality parity with the snapshot.
      const finalBlock = Math.max(0, head - confirmations);
      return balancesAtBlock(chain, ref, finalBlock, head);
    },
  };
}

/**
 * Build a `CollectionRegistry` from a plain map keyed `"<chain>/<contract>"` (contract lowercased). The
 * map itself is DEPLOY config — `bin/http.ts` parses it from `COLLECTION_REGISTRY` (JSON). Kept here so
 * the lookup (case-normalization) is one tested function, not re-implemented at the composition root.
 */
export function registryFromMap(map: Record<string, CollectionRef>): CollectionRegistry {
  const norm = new Map<string, CollectionRef>();
  for (const [k, v] of Object.entries(map)) norm.set(k.toLowerCase(), v);
  return ({ chain, contract }) => norm.get(`${chain}/${contract}`.toLowerCase());
}

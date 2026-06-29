/**
 * projection-ownership-source.ts — the L2 SPINE read-model + the audit's OwnershipSource that reads it.
 *
 * The keystone of the NATS event-integration (grimoires/loa/proposals/nats-event-integration-brief.md) and
 * the rung `arrakis-audit-reads-member-graph`. Today the audit reconstructs ownership from RAW sonar on every
 * run (`makeSonarOwnershipSource` → `SonarClient.ownershipAtBlock`, Transfer-replay) — reaching L3→L0 PAST the
 * L2 member-graph spine (the WHO×WHAT ladder's reach-past bug). This module is the cure:
 *
 *   sonar publishes `ownership.changed` (≡ nft.activity.recorded.v1)
 *       → this PROJECTION applies each change into a who-holds-what read-model (CQRS, event-fed, once)
 *       → `makeProjectionOwnershipSource` answers the audit's OwnershipSource port FROM the projection
 *
 * The audit swaps `makeSonarOwnershipSource` for `makeProjectionOwnershipSource(projection)` — a hexagonal
 * adapter swap, no audit-logic change — and now READS the spine instead of reconstructing from raw. Events
 * carry the block + timestamp (ACVP: the signed `ownership.changed` is the trace), so the projection answers
 * `balancesAt(block)` / `currentBalances` / `resolveSnapshotBlock(date)` deterministically by folding the
 * ordered change-set. The projection is the materialized view; the audit is a pure reader of it.
 */
import type { Balances, OwnershipSource } from './audit-service.js';

/**
 * One ownership-change fact — the projection's input. Maps from the signed `ownership.changed` /
 * `nft.activity.recorded.v1` event (a Transfer): `from`→`to` of `amount` at `block` (timestamp = block time).
 * A mint has `from === null`; a burn has `to === null`. ERC-721 transfers carry `amount === 1n`.
 */
export interface OwnershipChange {
  readonly chain: string;
  readonly contract: string;
  readonly block: number;
  /** ISO-8601 block time — lets the projection resolve a snapshot DATE to a block without a chain call. */
  readonly timestamp: string;
  readonly from: string | null;
  readonly to: string | null;
  readonly amount: bigint;
}

/** The event-fed read-model the audit reads: apply ownership changes, answer balance/snapshot queries. */
export interface OwnershipProjection {
  /** apply one ownership-change event (idempotent on identical re-delivery — see `apply` note). */
  apply(change: OwnershipChange): void;
  /** balances as-of a block — the fold of all changes at/before it. */
  balancesAt(chain: string, contract: string, block: number): Balances;
  /** balances at the latest observed block. */
  currentBalances(chain: string, contract: string): Balances;
  /** the highest block whose timestamp is at/before `snapshotDate` (ISO) — 0 if none. */
  resolveSnapshotBlock(chain: string, contract: string, snapshotDate: string): number;
}

const keyOf = (chain: string, contract: string): string => `${chain.toLowerCase()}:${contract.toLowerCase()}`;
// A change is identified by (block, from, to, amount) — re-delivery of the SAME event is a no-op (at-least-once
// → idempotent, the brief's keystone law). NATS may deliver an event more than once; the projection must not
// double-count.
const changeId = (c: OwnershipChange): string => `${c.block}:${c.from ?? '0x0'}:${c.to ?? '0x0'}:${c.amount}`;

export function makeOwnershipProjection(): OwnershipProjection {
  const changes = new Map<string, OwnershipChange[]>();
  const seen = new Map<string, Set<string>>(); // per-collection de-dup of applied change ids (idempotency)

  const foldUpTo = (chain: string, contract: string, block: number): Balances => {
    const list = changes.get(keyOf(chain, contract)) ?? [];
    const bal: Balances = new Map();
    for (const c of list) {
      if (c.block > block) break; // list is block-ordered — stop once past the snapshot
      if (c.from !== null) bal.set(c.from, (bal.get(c.from) ?? 0n) - c.amount);
      if (c.to !== null) bal.set(c.to, (bal.get(c.to) ?? 0n) + c.amount);
    }
    for (const [w, b] of bal) if (b <= 0n) bal.delete(w); // a holder at 0 holds nothing
    return bal;
  };

  return {
    apply(change) {
      const k = keyOf(change.chain, change.contract);
      const dedup = seen.get(k) ?? new Set<string>();
      const id = changeId(change);
      if (dedup.has(id)) return; // at-least-once delivery → idempotent: drop the duplicate
      dedup.add(id);
      seen.set(k, dedup);
      const list = changes.get(k) ?? [];
      list.push(change);
      list.sort((a, b) => a.block - b.block); // keep block-ordered so foldUpTo can short-circuit
      changes.set(k, list);
    },
    balancesAt(chain, contract, block) {
      return foldUpTo(chain, contract, block);
    },
    currentBalances(chain, contract) {
      const list = changes.get(keyOf(chain, contract)) ?? [];
      const maxBlock = list.reduce((m, c) => (c.block > m ? c.block : m), 0);
      return foldUpTo(chain, contract, maxBlock);
    },
    resolveSnapshotBlock(chain, contract, snapshotDate) {
      const list = changes.get(keyOf(chain, contract)) ?? [];
      let block = 0;
      for (const c of list) {
        if (c.timestamp <= snapshotDate && c.block > block) block = c.block;
      }
      return block;
    },
  };
}

/**
 * The audit's OwnershipSource, reading the projection instead of raw sonar. Drop-in replacement for
 * `makeSonarOwnershipSource` — same port, no audit-logic change. This is the L3→L2 re-aim: the audit now reads
 * the member-graph spine's materialized ownership, not a per-run raw reconstruction.
 */
export function makeProjectionOwnershipSource(projection: OwnershipProjection): OwnershipSource {
  return {
    async resolveSnapshotBlock(args) {
      return projection.resolveSnapshotBlock(args.chain, args.contract, args.snapshotDate);
    },
    async balancesAt(args) {
      return projection.balancesAt(args.chain, args.contract, args.snapshotBlock);
    },
    async currentBalances(args) {
      return projection.currentBalances(args.chain, args.contract);
    },
  };
}

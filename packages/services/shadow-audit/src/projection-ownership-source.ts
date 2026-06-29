/**
 * projection-ownership-source.ts — the L2 SPINE read-model + the audit's OwnershipSource that reads it.
 *
 * The keystone of the NATS event-integration (grimoires/loa/proposals/nats-event-integration-brief.md) and the
 * rung `arrakis-audit-reads-member-graph`. The audit reconstructs ownership from RAW sonar on every run
 * (`makeSonarOwnershipSource` → `SonarClient.ownershipAtBlock`, Transfer-replay) — reaching L3→L0 PAST the L2
 * member-graph spine. This module is the cure: fold the signed `ownership.changed` stream into a CQRS
 * read-model the audit queries.
 *
 *   sonar publishes `ownership.changed` (≡ nft.activity.recorded.v1)  → this PROJECTION folds it →
 *   `makeProjectionOwnershipSource` answers the audit's OwnershipSource port FROM the projection.
 *
 * ⚠ STATUS (FAGAN review 2026-06-29, applied): the projection now matches sonar's `Balances` CONTRACT on the
 * points that broke parity — addresses are lowercased (`reconstruct.ts` `lc()`), the snapshot boundary is
 * day-INCLUSIVE (sonar's `day-end`), event identity is the true `tx:logIndex` (not the collision-prone
 * `block:from:to:amount`), and an incomplete stream (negative balance) or a missing snapshot block REFUSES
 * loudly (the audit's `reconstruction-failed` invariant) rather than serving a silently-wrong cohort.
 *
 * NOT YET CLOSED (operator-design, see the FAGAN report + the brief): (a) this is a balance-COUNT model, not a
 * per-token-ownership model — it cannot detect a double-mint of the same tokenId the way sonar's `fold721`
 * does; (b) the `value`→`amount` semantics depend on sonar-api's unverified cross-repo contract (needs a
 * pinned contract test + a token `standard` on the event); (c) parity is asserted against a clean fixture, NOT
 * the real `reconstructOwnership` — a DIFFERENTIAL test against `@freeside/adapters/sonar` is the real proof;
 * (d) no backfill — a live subscriber sees events only from deploy-time, so a collection with pre-subscription
 * history needs a genesis replay before its projection is trustworthy (the cutover gate in the runtime).
 */
import type { Balances, OwnershipSource } from './audit-service.js';

/** Raised when the event stream is incomplete (a holder went negative) or the snapshot has no at-or-before
 *  block — the projection's analogue of sonar's loud provenance refusals. The audit turns this into a typed
 *  `reconstruction-failed` refusal rather than a silently-wrong audit. */
export class ProjectionIncompleteError extends Error {
  constructor(reason: string) {
    super(`projection ownership incomplete: ${reason}`);
    this.name = 'ProjectionIncompleteError';
  }
}

/**
 * One ownership-change fact — the projection's input, mapped from a signed `nft.activity.recorded.v1` event.
 * `tx`+`logIndex` are the event's TRUE unique identity (mirrors the belt-gateway row id `<txHash>_<logIndex>`):
 * two distinct transfers in the same block with the same from/to/amount (a batch sale, an ERC-1155 multi-send)
 * are DIFFERENT events and must not be de-duplicated into one. Addresses arrive in any case; the projection
 * lowercases them to match the `Balances` contract.
 */
export interface OwnershipChange {
  readonly chain: string;
  readonly contract: string;
  readonly block: number;
  /** ISO-8601 block time. */
  readonly timestamp: string;
  /** the transaction hash — half of the event's unique identity. */
  readonly tx: string;
  /** the log index within the tx — the other half. */
  readonly logIndex: number;
  readonly from: string | null;
  readonly to: string | null;
  readonly amount: bigint;
}

export interface OwnershipProjection {
  apply(change: OwnershipChange): void;
  /** balances as-of a block. THROWS ProjectionIncompleteError if the stream drove a holder negative. */
  balancesAt(chain: string, contract: string, block: number): Balances;
  /** balances at the latest observed block. THROWS on an incomplete stream. */
  currentBalances(chain: string, contract: string): Balances;
  /** the highest block whose timestamp is at/before `snapshotDate` (day-INCLUSIVE). THROWS if none. */
  resolveSnapshotBlock(chain: string, contract: string, snapshotDate: string): number;
}

const lc = (a: string): string => a.toLowerCase();
const keyOf = (chain: string, contract: string): string => `${lc(chain)}:${lc(contract)}`;
// event identity = tx:logIndex (re-delivery of the SAME event is a no-op; two DISTINCT transfers never collide).
const changeId = (c: OwnershipChange): string => `${lc(c.tx)}:${c.logIndex}`;

export function makeOwnershipProjection(): OwnershipProjection {
  const changes = new Map<string, OwnershipChange[]>();
  const seen = new Map<string, Set<string>>();

  const foldUpTo = (chain: string, contract: string, block: number): Balances => {
    const list = changes.get(keyOf(chain, contract)) ?? [];
    const bal: Balances = new Map();
    for (const c of list) {
      if (c.block > block) break; // block-ordered — stop past the snapshot
      if (c.from !== null) bal.set(lc(c.from), (bal.get(lc(c.from)) ?? 0n) - c.amount);
      if (c.to !== null) bal.set(lc(c.to), (bal.get(lc(c.to)) ?? 0n) + c.amount);
    }
    for (const [w, b] of bal) {
      // a NEGATIVE balance means the stream is incomplete (a transfer-from we never saw the mint/in for) —
      // sonar's `fold721`/`fold1155` REFUSE here; the projection must too, never serve a wrong cohort.
      if (b < 0n) throw new ProjectionIncompleteError(`holder ${w} went negative on ${keyOf(chain, contract)} — incomplete stream`);
      if (b === 0n) bal.delete(w);
    }
    return bal;
  };

  return {
    apply(change) {
      const k = keyOf(change.chain, change.contract);
      const dedup = seen.get(k) ?? new Set<string>();
      const id = changeId(change);
      if (dedup.has(id)) return; // at-least-once delivery → idempotent on the SAME event
      dedup.add(id);
      seen.set(k, dedup);
      const list = changes.get(k) ?? [];
      list.push(change);
      list.sort((a, b) => a.block - b.block);
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
      let found = false;
      for (const c of list) {
        // day-INCLUSIVE: compare the DATE part so an event AT 2026-06-22T10:00 counts for snapshot '2026-06-22'
        // (sonar resolves the snapshot date to its day-END boundary). A bare-date lexical `<=` of a datetime
        // would exclude the whole day (the datetime is longer than, hence lexically > , the bare date).
        if (c.timestamp.slice(0, 10) <= snapshotDate) {
          found = true;
          if (c.block > block) block = c.block;
        }
      }
      if (!found) {
        // no at-or-before block — sonar refuses; do not return 0 (indistinguishable from a genesis snapshot).
        throw new ProjectionIncompleteError(`no ownership event at/before ${snapshotDate} for ${keyOf(chain, contract)}`);
      }
      return block;
    },
  };
}

/**
 * The audit's OwnershipSource, reading the projection instead of raw sonar. Drop-in for `makeSonarOwnershipSource`
 * — same port, no audit-logic change. An incomplete stream / missing snapshot surfaces as a thrown
 * `ProjectionIncompleteError`, which `runAudit` catches into its typed `reconstruction-failed` refusal.
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

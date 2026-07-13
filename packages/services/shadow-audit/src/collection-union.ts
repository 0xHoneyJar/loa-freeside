/**
 * S5-T3 (G-2, G-5) — a collection is the UNION of its declared deployments.
 *
 * The collections BRIDGED. Honeycomb is 2,280 holders on ethereum AND 1,813 on berachain; the
 * audit reconstructed ONE of them, so a berachain-addressed audit saw 44% of the holders and would
 * have branded EVERY ethereum holder as stale access. Reconstructing one deployment of a
 * multi-chain collection is not an approximation of the collection — it is a different collection.
 *
 * TWO rules, both load-bearing:
 *
 *   1. UNION SEMANTICS = `any-source`. A wallet qualifies iff it meets the threshold on AT LEAST
 *      ONE declared deployment; the threshold is applied PER-SOURCE, never to a cross-chain sum.
 *      Summing was the rejected alternative: a token in flight across a bridge would be counted on
 *      both sides, and balances under the threshold everywhere could be added into qualification.
 *      (The two only diverge when threshold > 1 — thj uses 1 — but a semantics nobody named is a
 *      semantics nobody can audit, so it is named here and in the output.)
 *
 *   2. FAIL-CLOSED. If ANY declared source is unreachable, the whole audit REFUSES. A partial union
 *      is not "most of the answer": a holder present only on the missing chain reads as
 *      not-qualifying, which silently OVERSTATES stale access — a confidently-wrong number, in the
 *      direction that gets somebody's access revoked. `reconstructUnion` therefore propagates the
 *      first failure; callers turn it into a typed `reconstruction-failed` refusal.
 */

import type { AccessDecisionPort } from '@freeside/shadow-audit-protocol';
import type { Balances, OwnershipSource } from './audit-service.js';

/** The union's semantics, as emitted in the output. Never inferred by a reader — stated by us. */
export const UNION_SEMANTICS = 'any-source' as const;

/** One declared deployment of a collection. The token standard stays in the registry (only the
 *  sonar adapter needs it); the union only needs to know WHERE the collection lives. */
export interface CollectionSource {
  readonly chain: string;
  readonly contract: string;
}

/**
 * ANY ONE deployment → the FULL set of deployments of the collection it belongs to.
 *
 * `undefined` ⇒ this chain/contract is not a declared collection, which is a REFUSAL, never a
 * fallback to "assume it stands alone". Assuming would resurrect the single-source bug for exactly
 * the collections we failed to declare.
 */
export type SourceResolver = (args: { chain: string; contract: string }) => readonly CollectionSource[] | undefined;

/** One reconstructed deployment: where it was read, at which block, and the two balance maps. */
export interface SourceBalances {
  readonly source: CollectionSource;
  readonly snapshot_block: number;
  readonly snapshot: Balances;
  readonly current: Balances;
}

/**
 * Reconstruct EVERY declared source. Throws on the first failure — a partial union must never
 * escape this function (see rule 2 above).
 */
export async function reconstructUnion(
  ownership: OwnershipSource,
  sources: readonly CollectionSource[],
  snapshotDate: string,
): Promise<SourceBalances[]> {
  return Promise.all(
    sources.map(async (source) => {
      const snapshot_block = await ownership.resolveSnapshotBlock({ ...source, snapshotDate });
      const [snapshot, current] = await Promise.all([
        ownership.balancesAt({ ...source, snapshotBlock: snapshot_block }),
        ownership.currentBalances({ ...source }),
      ]);
      return { source, snapshot_block, snapshot, current };
    }),
  );
}

/** `any-source`: does this wallet meet the gate on AT LEAST ONE deployment? (Never a summed balance.) */
export function qualifiesAnySource(
  policy: AccessDecisionPort<bigint>,
  balances: readonly Balances[],
  wallet: string,
): boolean {
  return balances.some((b) => policy.qualifies(b.get(wallet) ?? 0n));
}

/** Every wallet seen on ANY deployment, deduplicated — the union's address space. */
export function walletsAcross(balances: readonly Balances[]): string[] {
  const all = new Set<string>();
  for (const b of balances) for (const w of b.keys()) all.add(w);
  return [...all];
}

/**
 * The wallet's balance on the deployment where it holds the MOST — the balance that decided its
 * qualification under `any-source`. NOT a cross-chain sum: publishing a sum as evidence would state
 * a holding the wallet does not have on any single chain, and evidence exists to be checked against
 * one chain at one block.
 */
export function maxBalanceAcross(balances: readonly Balances[], wallet: string): bigint {
  let max = 0n;
  for (const b of balances) {
    const v = b.get(wallet) ?? 0n;
    if (v > max) max = v;
  }
  return max;
}

/**
 * Per-wallet balances SUMMED across deployments — for share-of-SUPPLY metrics (whale concentration)
 * ONLY, never for qualification.
 *
 * Why summing is sound here and rejected there: a token exists on exactly one chain at a time (a
 * bridge burns/locks on the origin before minting on the destination), so a cross-chain sum counts
 * each live token once and yields the collection's true circulating supply. Qualification is a
 * different question — "does this wallet meet the gate?" — where summing would let sub-threshold
 * dust on several chains add up into access, and would double-count a token mid-bridge if a chain's
 * view lags. Hence `any-source` for the gate, `sumAcross` for the supply metric.
 */
export function sumAcross(balances: readonly Balances[]): Balances {
  const merged: Balances = new Map();
  for (const b of balances) {
    for (const [w, v] of b) merged.set(w, (merged.get(w) ?? 0n) + v);
  }
  return merged;
}

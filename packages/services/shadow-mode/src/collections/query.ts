/**
 * query — labelled entities, queryable like /recall (SDD collections-sot §5).
 *
 * A lexical query over the folded collection entities with a provenance BADGE
 * (ai-derived / operator-validated / contested), governed by the same trust
 * plane as /recall: contested labels are WITHHELD unless explicitly requested.
 * Lexical this cycle; the entities are also a QMD-registerable document set (one
 * doc per entity, frontmatter = the trust fields) for a later semantic+rerank
 * follow-up — no schema change needed then.
 */

import type { CollectionEntity } from '@freeside/shadow-mode-protocol';
import type { ILedgerStore } from '../ports/ledger-store.js';

export type ProvenanceBadge = 'ai-derived' | 'operator-validated' | 'contested';

export interface CollectionQueryHit {
  entity_id: string;
  chain: string;
  contract: string;
  collection_key: string;
  token_standard: string;
  world?: string;
  role?: string;
  /** The strongest trust signal on the entity: contested > operator-validated > ai-derived. */
  badge: ProvenanceBadge;
  /** Which fields matched the query (for the agent to see WHY it matched). */
  matched: string[];
}

export interface QueryOpts {
  /** Include entities with a contested label (withheld by default, mirroring /recall). */
  showContested?: boolean;
  limit?: number;
}

function badgeOf(e: CollectionEntity): ProvenanceBadge {
  if (e.provenance.some((p) => p.contested)) return 'contested';
  if (e.provenance.some((p) => p.source_type === 'operator-validated')) return 'operator-validated';
  return 'ai-derived';
}

/** Fields a query matches against (collection_key / contract / world / role). */
function matchFields(e: CollectionEntity, q: string): string[] {
  const needle = q.trim().toLowerCase();
  if (needle === '') return [];
  const candidates: Array<[string, string | undefined]> = [
    ['collection_key', e.labels.collection_key],
    ['contract', e.contract],
    ['entity_id', e.entity_id],
    ['world', e.labels.world],
    ['role', e.labels.role],
  ];
  return candidates.filter(([, v]) => v !== undefined && v.toLowerCase().includes(needle)).map(([f]) => f);
}

/** Rank a hit: exact collection_key/world/contract match beats a substring. */
function score(e: CollectionEntity, q: string, matched: string[]): number {
  const needle = q.trim().toLowerCase();
  let s = matched.length;
  if (e.labels.collection_key.toLowerCase() === needle) s += 10;
  if (e.contract.toLowerCase() === needle || e.entity_id.toLowerCase() === needle) s += 10;
  if (e.labels.world?.toLowerCase() === needle) s += 5;
  return s;
}

/** Query the labelled entities (SDD §5). Contested withheld unless opted in. */
export async function queryCollections(
  store: ILedgerStore,
  q: string,
  opts: QueryOpts = {},
): Promise<CollectionQueryHit[]> {
  const entities = await store.listCollectionEntities();
  const hits: Array<{ hit: CollectionQueryHit; s: number }> = [];
  for (const e of entities) {
    const badge = badgeOf(e);
    if (badge === 'contested' && !opts.showContested) continue; // withheld (governed)
    const matched = matchFields(e, q);
    if (matched.length === 0) continue;
    hits.push({
      s: score(e, q, matched),
      hit: {
        entity_id: e.entity_id,
        chain: e.chain,
        contract: e.contract,
        collection_key: e.labels.collection_key,
        token_standard: e.labels.token_standard,
        ...(e.labels.world ? { world: e.labels.world } : {}),
        ...(e.labels.role ? { role: e.labels.role } : {}),
        badge,
        matched,
      },
    });
  }
  hits.sort((a, b) => b.s - a.s);
  const limited = opts.limit ? hits.slice(0, opts.limit) : hits;
  return limited.map((h) => h.hit);
}

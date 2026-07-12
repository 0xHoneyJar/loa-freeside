/**
 * propose — distill derived collections into born-low observations on the ledger
 * (SDD collections-sot §3). Every derived label is a `collection.label.observed`
 * (`ai-derived`); the proposed world is ALSO an observed (subjective, unratified
 * until the operator ratifies). Appends are idempotent (content-addressed
 * event_id) and NEVER overwrite a ratified label (the fold preserves it).
 */

import { collectionLabelObserved, type CollectionLabelName } from '@freeside/shadow-mode-protocol';
import type { ILedgerStore } from '../ports/ledger-store.js';
import type { AppendGrant } from '../auth/append-grant.js';
import type { DerivedCollection } from './distiller.js';

export interface ProposeResult {
  entity_id: string;
  appended: number;
  deduped: number;
}

/** Append the derived labels of ONE collection as observed observations. */
export async function proposeCollection(
  store: ILedgerStore,
  grant: AppendGrant,
  derived: DerivedCollection,
  nowIso: string,
): Promise<ProposeResult> {
  const labels: Array<[CollectionLabelName, string]> = [
    ['collection_key', derived.collection_key],
    ['token_standard', derived.token_standard],
  ];
  // The proposed world is a subjective label — proposed as observed (unratified),
  // never ratified here (only the operator ratifies).
  if (derived.world_proposed) labels.push(['world', derived.world_proposed]);

  let appended = 0;
  let deduped = 0;
  let entity_id = '';
  for (const [label, value] of labels) {
    const obs = collectionLabelObserved(derived.chain, derived.contract, label, value, nowIso);
    if (obs === null) continue; // malformed identity/value already surfaced by sync's diff
    entity_id = obs.community_id;
    const isNew = await store.appendObservationIfAbsent(obs, grant);
    if (isNew) appended++;
    else deduped++;
  }
  return { entity_id, appended, deduped };
}

/** Append every distilled collection (used by `propose` over the belt set). */
export async function proposeAll(
  store: ILedgerStore,
  grant: AppendGrant,
  derived: DerivedCollection[],
  nowIso: string,
): Promise<ProposeResult[]> {
  const out: ProposeResult[] = [];
  for (const d of derived) out.push(await proposeCollection(store, grant, d, nowIso));
  return out;
}

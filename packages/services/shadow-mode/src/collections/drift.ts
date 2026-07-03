/**
 * drift — the coherence sensor (SDD collections-sot §8). Re-derives every
 * DERIVED label (belt + ERC-165) and classifies each entity. A CI/cron check:
 * exits non-zero on any `contested`/`orphaned` (fails loud).
 *
 * Drift on a DERIVED label → auto-overwrite (append a new observed; ground truth
 * wins). Drift on a RATIFIED label → `contested` (append a new observed; the
 * fold preserves the operator value + flags it) — NEVER a silent overwrite.
 */

import type { ILedgerStore } from '../ports/ledger-store.js';
import type { AppendGrant } from '../auth/append-grant.js';
import { collectionLabelObserved, collectionEntityId } from '@freeside/shadow-mode-protocol';
import { ground, type GroundDeps, type DerivedCollection } from './distiller.js';

export type DriftClass =
  | 'coherent'
  | 'drifted' // a derived label changed → auto-overwritten
  | 'orphaned' // in the SoT, no longer belt-tracked
  | 'unratified' // a subjective label still unratified
  | 'unknown_standard' // ERC-165 un-derivable
  | 'contested'; // a ratified label disagrees with a re-derive (operator truth preserved)

export interface DriftFinding {
  entity_id: string;
  class: DriftClass;
  detail?: string;
}

export interface DriftReport {
  findings: DriftFinding[];
  /** True iff any finding is contested-producing or orphaned (CI should fail). */
  failed: boolean;
}

/**
 * Re-derive and reconcile. Appends new `observed` observations for changed
 * derived labels (the fold decides overwrite-vs-contest by label class + seq).
 * Read-heavy but write-minimal: only CHANGED derived values append.
 */
export async function drift(
  store: ILedgerStore,
  grant: AppendGrant,
  deps: GroundDeps,
  nowIso: string,
): Promise<DriftReport> {
  const derived = await ground(deps);
  const byEntity = new Map<string, DerivedCollection>();
  for (const d of derived) {
    const id = collectionEntityId(d.chain, d.contract);
    if (id) byEntity.set(id, d);
  }

  const findings: DriftFinding[] = [];
  let failed = false;
  const current = await store.listCollectionEntities();
  const seen = new Set<string>();

  for (const entity of current) {
    seen.add(entity.entity_id);
    const rederived = byEntity.get(entity.entity_id);

    if (!rederived) {
      findings.push({ entity_id: entity.entity_id, class: 'orphaned', detail: 'no longer belt-tracked' });
      failed = true;
      continue;
    }

    let classified: DriftClass = 'coherent';
    const detail: string[] = [];

    // re-derive DERIVED labels; append on change (fold applies overwrite/contest)
    for (const [label, value] of [
      ['token_standard', rederived.token_standard],
      ['collection_key', rederived.collection_key],
    ] as const) {
      const cur = label === 'token_standard' ? entity.labels.token_standard : entity.labels.collection_key;
      if (value !== cur) {
        const obs = collectionLabelObserved(entity.chain, entity.contract, label, value, nowIso);
        if (obs) await store.appendObservationIfAbsent(obs, grant);
        classified = 'drifted';
        detail.push(`${label}: ${cur} → ${value}`);
      }
    }

    if (rederived.token_standard === 'unknown') {
      classified = 'unknown_standard';
      detail.push('ERC-165 un-derivable');
    }
    // Re-propose the SUBJECTIVE world ONLY when it is NOT operator-settled
    // (FAGAN B-1): a dumb key heuristic must NEVER re-contest operator truth —
    // that would flip the coherence sensor red forever. An unratified proposal
    // is updated freely; an operator-validated world is left alone (a genuine
    // re-binding is an explicit operator re-ratify, not a drift auto-contest).
    const worldProv = entity.provenance.find((p) => p.label === 'world');
    const worldRatified = worldProv?.source_type === 'operator-validated';
    if (rederived.world_proposed && !worldRatified) {
      const wobs = collectionLabelObserved(entity.chain, entity.contract, 'world', rederived.world_proposed, nowIso);
      if (wobs) await store.appendObservationIfAbsent(wobs, grant);
    }
    // a subjective label present but never operator-validated
    if (entity.labels.world && !worldRatified) {
      if (classified === 'coherent') classified = 'unratified';
      detail.push('world unratified');
    }

    findings.push({ entity_id: entity.entity_id, class: classified, ...(detail.length ? { detail: detail.join('; ') } : {}) });
  }

  // Re-check for contested labels the fold now flags (a ratified label a
  // re-derive disagreed with). Update the entity's OWN finding in place (no
  // duplicate row; correct class) — FAGAN L-1.
  const post = await store.listCollectionEntities();
  const byId = new Map(findings.map((f) => [f.entity_id, f]));
  for (const entity of post) {
    if (entity.provenance.some((p) => p.contested)) {
      failed = true;
      const existing = byId.get(entity.entity_id);
      if (existing) existing.class = 'contested';
      else findings.push({ entity_id: entity.entity_id, class: 'contested', detail: 'ratified label disagrees with a re-derive' });
    }
  }

  return { findings, failed };
}

/**
 * Export the ratified-collection SNAPSHOT (SDD collections-sot §6) — the seam
 * shadow-audit's settle gate reads. Folds every collection entity from the
 * ledger into the `collections.snapshot.v1` contract. The snapshot carries the
 * fold's trust signals (world_validated, contested) so the consumer can apply
 * its OWN fail-closed policy — the exporter includes everything, the consumer
 * decides what to serve.
 */

import type { ILedgerStore } from '../ports/ledger-store.js';
import type { CollectionEntity } from '@freeside/shadow-mode-protocol';

export interface CollectionSnapshotRow {
  chain: string;
  contract: string;
  collection_key: string;
  token_standard: 'erc721' | 'erc1155' | 'unknown';
  world?: string;
  world_validated: boolean;
  contested: boolean;
}

export interface CollectionSnapshot {
  schema_version: 'collections.snapshot.v1';
  generated_from_chain_head?: string;
  entities: CollectionSnapshotRow[];
}

/** Map ONE folded entity → a snapshot row (its trust signals made explicit). */
export function entityToSnapshotRow(e: CollectionEntity): CollectionSnapshotRow {
  const worldProv = e.provenance.find((p) => p.label === 'world');
  return {
    chain: e.chain,
    contract: e.contract,
    collection_key: e.labels.collection_key,
    token_standard: e.labels.token_standard,
    ...(e.labels.world ? { world: e.labels.world } : {}),
    world_validated: worldProv?.source_type === 'operator-validated',
    contested: e.provenance.some((p) => p.contested === true),
  };
}

/**
 * Export the snapshot from the ledger. `listCollectionEntities` already
 * verify-on-reads (a tampered chain is excluded), so the snapshot only carries
 * entities on verified worldlines.
 */
export async function exportRatifiedSnapshot(store: ILedgerStore): Promise<CollectionSnapshot> {
  const entities = await store.listCollectionEntities();
  return {
    schema_version: 'collections.snapshot.v1',
    entities: entities.map(entityToSnapshotRow),
  };
}

/**
 * The settle gate (SDD collections-sot §6, §11.5 IMP-002): shadow-audit reads
 * the RATIFIED collection entities from the worldline ledger instead of a
 * hand-authored `COLLECTION_REGISTRY` env. The seam is a ratified-entity
 * SNAPSHOT (shadow-mode exports it from `listCollectionEntities()`; the two
 * services stay decoupled — no cross-dependency, just this JSON contract).
 *
 * FAIL-CLOSED precedence: a collection is served ONLY when its standard is a
 * real token standard AND its world is operator-validated AND no label is
 * contested. A not-yet-true label NEVER produces an audit (money/ops floor).
 */

import { z } from 'zod';
import {
  buildCollectionIndex,
  type CollectionIndexEntry,
  type CollectionRegistry,
} from './ownership-source.js';
import type { SourceResolver } from './collection-union.js';

/** One ratified entity as the ledger folded it (the snapshot row). */
export const EntitySnapshotSchema = z
  .object({
    chain: z.string().min(1),
    contract: z.string().min(1),
    collection_key: z.string().min(1),
    token_standard: z.enum(['erc721', 'erc1155', 'unknown']),
    world: z.string().optional(),
    /** True iff the `world` label is operator-validated (not a bare proposal). */
    world_validated: z.boolean(),
    /** True iff ANY label on the entity is contested. */
    contested: z.boolean(),
  })
  .strict();

export const RatifiedSnapshotSchema = z
  .object({
    schema_version: z.literal('collections.snapshot.v1'),
    generated_from_chain_head: z.string().optional(),
    entities: z.array(EntitySnapshotSchema),
  })
  .strict();

export type RatifiedSnapshot = z.infer<typeof RatifiedSnapshotSchema>;
export type EntitySnapshot = z.infer<typeof EntitySnapshotSchema>;

export interface CollapseResult {
  registry: CollectionRegistry;
  /** S5-T3 — one deployment → the collection's FULL source set (the union the audit reconstructs). */
  sources: SourceResolver;
  chains: Set<string>;
  included: string[];
  /** entity_id → why it was withheld (never served). */
  excluded: Record<string, string>;
}

/** Is this entity safe to serve in an audit? Fail-closed. */
function serveReason(e: EntitySnapshot): string | null {
  if (e.token_standard === 'unknown') return 'unknown_standard';
  if (e.contested) return 'contested';
  if (!e.world || !e.world_validated) return 'unratified_world';
  return null;
}

/**
 * Build the audit registry from a ratified snapshot — fail-closed, at the COLLECTION level (S5-T3).
 *
 * The per-entity gate is not enough once a collection is a UNION of deployments. If Honeycomb-on-bera is
 * ratified and Honeycomb-on-eth is contested, serving "the ratified subset" hands the audit a PARTIAL union
 * — and a partial union silently brands every holder on the withheld chain as stale access. So the gate is
 * collective: one unservable deployment withholds the WHOLE collection. Refusing an audit is recoverable;
 * a confidently-wrong stale-access set is not.
 */
export function buildRegistryFromSnapshot(snapshot: RatifiedSnapshot): CollapseResult {
  const map: Record<string, CollectionIndexEntry> = {};
  const chains = new Set<string>();
  const included: string[] = [];
  const excluded: Record<string, string> = {};

  const groups = new Map<string, EntitySnapshot[]>();
  for (const e of snapshot.entities) {
    const group = groups.get(e.collection_key) ?? [];
    group.push(e);
    groups.set(e.collection_key, group);
  }

  for (const [collectionKey, entities] of groups) {
    const reasons = new Map(entities.map((e) => [e, serveReason(e)] as const));
    const blockers = entities.filter((e) => reasons.get(e) !== null);
    if (blockers.length > 0) {
      const blockedIds = blockers.map((e) => `${e.chain}:${e.contract}`);
      for (const e of entities) {
        const entityId = `${e.chain}:${e.contract}`;
        excluded[entityId] =
          reasons.get(e) ??
          // Servable on its own, but a sibling deployment of the same collection is not — serving this one
          // alone would be a partial union of `collectionKey`.
          `partial_union:${blockedIds.join(',')}`;
      }
      continue;
    }
    for (const e of entities) {
      map[`${e.chain}/${e.contract}`] = {
        collection: collectionKey,
        standard: e.token_standard as 'erc721' | 'erc1155',
        union: collectionKey,
      };
      chains.add(e.chain);
      included.push(`${e.chain}:${e.contract}`);
    }
  }

  const { registry, sources } = buildCollectionIndex(map);
  return { registry, sources, chains, included, excluded };
}

/**
 * Load the audit registry (SDD §6). Precedence:
 *   1. `COLLECTION_REGISTRY` env — deprecated break-glass override (if set, wins).
 *   2. the ratified snapshot — the SoT this cycle collapses onto.
 * A missing/malformed snapshot FAILS LOUD (never fail-open to empty).
 */
export function loadRegistry(opts: {
  envRegistry?: string;
  snapshotJson?: string;
  /** Parses the env JSON into the raw `"<chain>/<contract>"` map. The INDEX (lookup + source set) is built
   *  here, not by the caller, so the env path and the ratified path can never disagree about what a
   *  collection's deployments are (S5-T3). */
  registryFromEnv: (raw: string) => { map: Record<string, CollectionIndexEntry>; chains: Set<string> };
}): CollapseResult {
  if (opts.envRegistry) {
    const { map, chains } = opts.registryFromEnv(opts.envRegistry);
    const { registry, sources } = buildCollectionIndex(map);
    return { registry, sources, chains, included: [], excluded: {} };
  }
  if (!opts.snapshotJson) {
    throw new Error(
      'no collection source: set COLLECTION_REGISTRY (break-glass) or provide a ratified snapshot (COLLECTION_SNAPSHOT_PATH)',
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(opts.snapshotJson);
  } catch (e) {
    throw new Error(`ratified snapshot is not valid JSON: ${(e as Error).message}`);
  }
  return buildRegistryFromSnapshot(RatifiedSnapshotSchema.parse(parsed));
}

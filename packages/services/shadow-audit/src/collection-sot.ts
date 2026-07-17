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
import { registryFromMap, type CollectionRegistry } from './ownership-source.js';

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

/** Build the audit registry from a ratified snapshot — fail-closed. */
export function buildRegistryFromSnapshot(snapshot: RatifiedSnapshot): CollapseResult {
  const map: Record<string, { collection: string; standard: 'erc721' | 'erc1155' }> = {};
  const chains = new Set<string>();
  const included: string[] = [];
  const excluded: Record<string, string> = {};
  for (const e of snapshot.entities) {
    const entityId = `${e.chain}:${e.contract}`;
    const reason = serveReason(e);
    if (reason) {
      excluded[entityId] = reason;
      continue;
    }
    map[`${e.chain}/${e.contract}`] = {
      collection: e.collection_key,
      standard: e.token_standard as 'erc721' | 'erc1155',
    };
    chains.add(e.chain);
    included.push(entityId);
  }
  return { registry: registryFromMap(map), chains, included, excluded };
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
  registryFromEnv: (raw: string) => { registry: CollectionRegistry; chains: Set<string> };
}): CollapseResult {
  if (opts.envRegistry) {
    const { registry, chains } = opts.registryFromEnv(opts.envRegistry);
    return { registry, chains, included: [], excluded: {} };
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

/**
 * CollectionEntity — a labelled entity on the worldline spine (SDD §2, §11.5).
 *
 * A collection/contract is a SIBLING labelled-entity alongside member subjects,
 * not crammed into `ShadowSubject`. Its truth is the append-only observation
 * chain (keyed on the collection's OWN worldline, `chain_id = entity_id`); the
 * `CollectionEntity` below is the FOLDED PROJECTION, never a mutable source.
 *
 * Every label change is an observation:
 *   collection.label.observed  — a derive (belt / ERC-165 / worlds)
 *   collection.label.ratified  — an operator ratification (force-chain)
 * Both are `ShadowObservation`-shaped so they chain on the SAME machinery as
 * members (protocol v1's sealed EventName stays frozen — these use the internal
 * cast, exactly like `chain.genesis`). `event_id` is CONTENT-ADDRESSED: the same
 * (entity, label, value) re-derives to the same id (idempotent), a changed value
 * mints a new id (which IS the drift signal). No wall-clock in identity.
 */

import { createHash } from 'node:crypto';
import { jcsBytes } from '../jcs.js';
import type { ShadowObservation } from './edge.js';
import { collectionEntityId } from './identity.js';

// --- label vocabulary --------------------------------------------------------

export type TokenStandard = 'erc721' | 'erc1155' | 'unknown';
export type CollectionLabelName = 'token_standard' | 'collection_key' | 'world' | 'role';

/** DERIVED labels — the agent grounds + overwrites these freely (ground truth wins). */
export const DERIVED_LABELS = ['token_standard', 'collection_key'] as const;
/** SUBJECTIVE labels — RATIFY-ONLY; the agent proposes, never flips a ratified value. */
export const SUBJECTIVE_LABELS = ['world', 'role'] as const;

export function isDerivedLabel(label: string): label is (typeof DERIVED_LABELS)[number] {
  return (DERIVED_LABELS as readonly string[]).includes(label);
}

export type LabelSourceType = 'ai-derived' | 'operator-validated';

export interface CollectionLabels {
  token_standard: TokenStandard;
  collection_key: string;
  world?: string;
  role?: string;
}

/** Folded provenance for ONE label — its winning value + how it got there. */
export interface LabelProvenance {
  label: CollectionLabelName;
  value: string;
  source_type: LabelSourceType;
  /** The observation that set this value. */
  event_id: string;
  /** Chain seq of that observation — the fold's total order (SDD §11.5). */
  seq: number;
  ratified_by?: string;
  ratified_at?: string;
  /** True when a later derive disagreed with a ratified value (SDD §8). */
  contested?: boolean;
}

export interface CollectionEntity {
  entity_id: string;
  chain: string;
  contract: string;
  labels: CollectionLabels;
  provenance: LabelProvenance[];
}

// --- observation payloads ----------------------------------------------------

export interface CollectionLabelObservedPayload {
  entity_id: string;
  chain: string;
  contract: string;
  label: CollectionLabelName;
  value: string;
  source_type: 'ai-derived';
}

export interface CollectionLabelRatifiedPayload {
  entity_id: string;
  label: CollectionLabelName;
  value: string;
  ratified_by: string;
}

export const COLLECTION_OBSERVED_NAME = 'collection.label.observed' as const;
export const COLLECTION_RATIFIED_NAME = 'collection.label.ratified' as const;
/** Cast source for internal ledger observations (sealed SourceKind, like genesis). */
const COLLECTION_SOURCE = 'collection' as ShadowObservation['source'];

function sha256Jcs(value: unknown): string {
  return createHash('sha256').update(jcsBytes(value)).digest('hex');
}

/**
 * Classify an observation as a collection label event. `name` is typed as the
 * sealed member `EventName`, but collection observations carry an internal name
 * (like `chain.genesis`), so we compare on the string value.
 */
export function collectionObservationKind(o: ShadowObservation): 'observed' | 'ratified' | null {
  const name = o.name as string;
  if (name === COLLECTION_OBSERVED_NAME) return 'observed';
  if (name === COLLECTION_RATIFIED_NAME) return 'ratified';
  return null;
}

/**
 * Content-addressed id for a derive. Same (entity, label, value, source) →
 * same id (dedup); a changed value → new id (drift). No timestamp.
 */
export function observedEventId(p: CollectionLabelObservedPayload): string {
  return `col:obs:${sha256Jcs({
    entity_id: p.entity_id,
    label: p.label,
    value: p.value,
    source_type: p.source_type,
  })}`;
}

/** Content-addressed id for a ratify. */
export function ratifiedEventId(p: CollectionLabelRatifiedPayload): string {
  return `col:rat:${sha256Jcs({
    entity_id: p.entity_id,
    label: p.label,
    value: p.value,
    ratified_by: p.ratified_by,
  })}`;
}

/**
 * Build a `collection.label.observed` ShadowObservation on the collection's own
 * worldline (`community_id = entity_id`). Returns null if identity is malformed.
 */
export function collectionLabelObserved(
  chain: string,
  contract: string,
  label: CollectionLabelName,
  value: string,
  nowIso: string,
): ShadowObservation | null {
  const entity_id = collectionEntityId(chain, contract);
  if (entity_id === null) return null;
  const payload: CollectionLabelObservedPayload = {
    entity_id,
    // store the NORMALIZED components so the projection needs no re-parse
    chain: entity_id.split(':', 1)[0]!,
    contract: entity_id.slice(entity_id.indexOf(':') + 1),
    label,
    value,
    source_type: 'ai-derived',
  };
  return {
    event_id: observedEventId(payload),
    community_id: entity_id,
    name: COLLECTION_OBSERVED_NAME as ShadowObservation['name'],
    source: COLLECTION_SOURCE,
    truth_status: 'inferred' as ShadowObservation['truth_status'],
    observed_at: nowIso,
    emitted_at: nowIso,
    payload,
    ingested_at: nowIso,
  };
}

// --- the fold: observations → projection (SDD §11.5) --------------------------

/** An observation paired with its chain seq — the fold's total order. */
export interface ObservationAtSeq {
  observation: ShadowObservation;
  seq: number;
}

interface LabelWinner {
  value: string;
  seq: number;
  event_id: string;
  ratified_by?: string;
  ratified_at?: string;
}

/**
 * Fold a collection's worldline observations into the current `CollectionEntity`
 * (SDD §11.5). The chain is the source of truth; this is the derived projection.
 *
 * Ordering is chain `seq` (never wall-clock). Per label class:
 *   DERIVED (token_standard, collection_key) — latest `observed` wins (ground
 *     truth overwrites freely).
 *   SUBJECTIVE (world, role) — latest `ratified` wins; a later `observed` that
 *     DISAGREES with the ratified value marks the label `contested` (the ratified
 *     value REMAINS — operator truth is never silently overwritten). Before any
 *     ratify, the latest `observed` stands as an unratified `ai-derived` proposal.
 *
 * Returns null if there are no collection-label observations.
 */
export function foldCollectionEntity(entries: ObservationAtSeq[]): CollectionEntity | null {
  const labelEntries = entries.filter((e) => collectionObservationKind(e.observation) !== null);
  if (labelEntries.length === 0) return null;

  const latestObserved = new Map<string, LabelWinner>();
  const latestRatified = new Map<string, LabelWinner>();
  let entity_id = '';

  for (const { observation, seq } of labelEntries) {
    const p = observation.payload as CollectionLabelObservedPayload & CollectionLabelRatifiedPayload;
    entity_id = p.entity_id;
    const isRatified = collectionObservationKind(observation) === 'ratified';
    const target = isRatified ? latestRatified : latestObserved;
    const cur = target.get(p.label);
    if (!cur || seq > cur.seq) {
      target.set(p.label, {
        value: p.value,
        seq,
        event_id: observation.event_id,
        ...(isRatified ? { ratified_by: p.ratified_by, ratified_at: observation.observed_at } : {}),
      });
    }
  }

  const idx = entity_id.indexOf(':');
  const chain = entity_id.slice(0, idx);
  const contract = entity_id.slice(idx + 1);

  const provenance: LabelProvenance[] = [];
  const values: Partial<Record<CollectionLabelName, string>> = {};
  const allLabels = new Set<string>([...latestObserved.keys(), ...latestRatified.keys()]);

  for (const label of allLabels) {
    const obs = latestObserved.get(label);
    const rat = latestRatified.get(label);
    let winner: LabelProvenance | undefined;

    if (isDerivedLabel(label)) {
      // ground truth wins: latest observed (a ratified derived label is unusual
      // but honored as a fallback when no observed exists)
      if (obs) {
        winner = { label, value: obs.value, source_type: 'ai-derived', event_id: obs.event_id, seq: obs.seq };
      } else if (rat) {
        winner = {
          label: label as CollectionLabelName,
          value: rat.value,
          source_type: 'operator-validated',
          event_id: rat.event_id,
          seq: rat.seq,
          ratified_by: rat.ratified_by,
          ratified_at: rat.ratified_at,
        };
      }
    } else if (rat) {
      // subjective + ratified: operator truth wins; a later disagreeing derive → contested
      const contested = obs !== undefined && obs.seq > rat.seq && obs.value !== rat.value;
      winner = {
        label: label as CollectionLabelName,
        value: rat.value,
        source_type: 'operator-validated',
        event_id: rat.event_id,
        seq: rat.seq,
        ratified_by: rat.ratified_by,
        ratified_at: rat.ratified_at,
        ...(contested ? { contested: true } : {}),
      };
    } else if (obs) {
      // subjective, not yet ratified: the proposal stands (unratified, low-trust)
      winner = { label: label as CollectionLabelName, value: obs.value, source_type: 'ai-derived', event_id: obs.event_id, seq: obs.seq };
    }

    if (winner) {
      provenance.push(winner);
      values[winner.label] = winner.value;
    }
  }

  const labels: CollectionLabels = {
    token_standard: (values.token_standard as TokenStandard) ?? 'unknown',
    collection_key: values.collection_key ?? '',
    ...(values.world ? { world: values.world } : {}),
    ...(values.role ? { role: values.role } : {}),
  };
  return { entity_id, chain, contract, labels, provenance };
}

/** Build a `collection.label.ratified` ShadowObservation. Null on bad identity. */
export function collectionLabelRatified(
  entity_id: string,
  label: CollectionLabelName,
  value: string,
  ratifiedBy: string,
  nowIso: string,
): ShadowObservation | null {
  const [chain, contract] = [entity_id.split(':', 1)[0], entity_id.slice(entity_id.indexOf(':') + 1)];
  if (!chain || !contract || collectionEntityId(chain, contract) !== entity_id) return null;
  const payload: CollectionLabelRatifiedPayload = { entity_id, label, value, ratified_by: ratifiedBy };
  return {
    event_id: ratifiedEventId(payload),
    community_id: entity_id,
    name: COLLECTION_RATIFIED_NAME as ShadowObservation['name'],
    source: COLLECTION_SOURCE,
    truth_status: 'attested' as ShadowObservation['truth_status'],
    observed_at: nowIso,
    emitted_at: nowIso,
    payload,
    ingested_at: nowIso,
  };
}

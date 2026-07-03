import { describe, expect, it } from 'vitest';
import {
  collectionLabelObserved,
  collectionLabelRatified,
  observedEventId,
  isDerivedLabel,
  foldCollectionEntity,
  type ObservationAtSeq,
  COLLECTION_OBSERVED_NAME,
  COLLECTION_RATIFIED_NAME,
} from '../schemas/collection-entity.js';

const CHAIN = '80094';
const CONTRACT = '0xABCDEF0123456789ABCDEF0123456789ABCDEF01';
const ENTITY = '80094:0xabcdef0123456789abcdef0123456789abcdef01';
const NOW = '2026-07-03T00:00:00.000Z';

describe('collection observations (SDD §2, §11.5)', () => {
  it('observed is ShadowObservation-shaped on the collection worldline (community_id = entity_id)', () => {
    const o = collectionLabelObserved(CHAIN, CONTRACT, 'token_standard', 'erc1155', NOW)!;
    expect(o.name).toBe(COLLECTION_OBSERVED_NAME);
    expect(o.community_id).toBe(ENTITY); // its OWN worldline, keyed by contract
    expect((o.payload as { entity_id: string }).entity_id).toBe(ENTITY);
    expect((o.payload as { contract: string }).contract).toBe(ENTITY.slice(ENTITY.indexOf(':') + 1));
  });

  it('event_id is content-addressed: same value → same id (idempotent), changed value → new id (drift)', () => {
    const a = collectionLabelObserved(CHAIN, CONTRACT, 'token_standard', 'erc1155', NOW)!;
    const aAgain = collectionLabelObserved(CHAIN, CONTRACT, 'token_standard', 'erc1155', '2027-01-01T00:00:00.000Z')!;
    const changed = collectionLabelObserved(CHAIN, CONTRACT, 'token_standard', 'erc721', NOW)!;
    expect(a.event_id).toBe(aAgain.event_id); // no wall-clock in identity
    expect(a.event_id).not.toBe(changed.event_id); // a re-derive that disagrees is a new observation
    expect(a.event_id.startsWith('col:obs:')).toBe(true);
  });

  it('normalizes identity through the choke point — mixed case folds to one id', () => {
    const upper = collectionLabelObserved(CHAIN, CONTRACT, 'collection_key', 'apdao-seat', NOW)!;
    const lower = collectionLabelObserved(CHAIN, CONTRACT.toLowerCase(), 'collection_key', 'apdao-seat', NOW)!;
    expect(upper.event_id).toBe(lower.event_id);
  });

  it('rejects malformed identity (null, not a partial observation)', () => {
    expect(collectionLabelObserved(CHAIN, '0xnothex', 'token_standard', 'erc721', NOW)).toBeNull();
    expect(collectionLabelRatified('80094:not-an-address', 'world', 'mibera', 'operator', NOW)).toBeNull();
  });

  it('ratified is attested + content-addressed under the ratifier', () => {
    const r = collectionLabelRatified(ENTITY, 'world', 'mibera', 'operator', NOW)!;
    expect(r.name).toBe(COLLECTION_RATIFIED_NAME);
    expect(r.truth_status).toBe('attested');
    expect(r.event_id.startsWith('col:rat:')).toBe(true);
    const other = collectionLabelRatified(ENTITY, 'world', 'mibera', 'someone-else', NOW)!;
    expect(r.event_id).not.toBe(other.event_id); // ratifier is part of identity
  });

  it('FAGAN HIGH-1: ratifying a DERIVED label is rejected (fail-closed, not an attested no-op)', () => {
    expect(collectionLabelRatified(ENTITY, 'token_standard', 'erc721', 'operator', NOW)).toBeNull();
    expect(collectionLabelRatified(ENTITY, 'collection_key', 'apdao-seat', 'operator', NOW)).toBeNull();
    // subjective labels ARE ratifiable
    expect(collectionLabelRatified(ENTITY, 'world', 'mibera', 'operator', NOW)).not.toBeNull();
    expect(collectionLabelRatified(ENTITY, 'role', 'primary', 'operator', NOW)).not.toBeNull();
  });

  it('FAGAN MEDIUM-1: out-of-vocab token_standard coerced to unknown; empty value rejected', () => {
    const bad = collectionLabelObserved(CHAIN, CONTRACT, 'token_standard', 'erc999', NOW)!;
    expect((bad.payload as { value: string }).value).toBe('unknown'); // no type-lie
    expect(collectionLabelObserved(CHAIN, CONTRACT, 'world', '', NOW)).toBeNull(); // empty is not an observation
    expect(collectionLabelObserved(CHAIN, CONTRACT, 'world', '   ', NOW)).toBeNull();
  });

  it('classifies derived vs subjective labels', () => {
    expect(isDerivedLabel('token_standard')).toBe(true);
    expect(isDerivedLabel('collection_key')).toBe(true);
    expect(isDerivedLabel('world')).toBe(false);
    expect(isDerivedLabel('role')).toBe(false);
  });

  it('foldCollectionEntity: empty / non-collection input → null', () => {
    expect(foldCollectionEntity([])).toBeNull();
  });

  it('foldCollectionEntity: latest-seq wins per label; token_standard defaults to unknown', () => {
    const entries: ObservationAtSeq[] = [
      { observation: collectionLabelObserved(CHAIN, CONTRACT, 'token_standard', 'unknown', NOW)!, seq: 1 },
      { observation: collectionLabelObserved(CHAIN, CONTRACT, 'token_standard', 'erc1155', NOW)!, seq: 2 },
      { observation: collectionLabelObserved(CHAIN, CONTRACT, 'collection_key', 'apdao-seat', NOW)!, seq: 3 },
    ];
    const e = foldCollectionEntity(entries)!;
    expect(e.entity_id).toBe(ENTITY);
    expect(e.labels.token_standard).toBe('erc1155'); // seq 2 > seq 1
    expect(e.labels.collection_key).toBe('apdao-seat');
    expect(e.labels.world).toBeUndefined();
  });

  it('foldCollectionEntity: ratified subjective label wins over an earlier proposal, no contest', () => {
    const entries: ObservationAtSeq[] = [
      { observation: collectionLabelObserved(CHAIN, CONTRACT, 'world', 'apdao', NOW)!, seq: 1 },
      { observation: collectionLabelRatified(ENTITY, 'world', 'mibera', 'operator', NOW)!, seq: 2 },
    ];
    const e = foldCollectionEntity(entries)!;
    expect(e.labels.world).toBe('mibera');
    const prov = e.provenance.find((p) => p.label === 'world')!;
    expect(prov.source_type).toBe('operator-validated');
    expect(prov.contested).toBeUndefined();
  });

  it('foldCollectionEntity: a later disagreeing derive flags contested but preserves ratified value', () => {
    const entries: ObservationAtSeq[] = [
      { observation: collectionLabelRatified(ENTITY, 'world', 'mibera', 'operator', NOW)!, seq: 1 },
      { observation: collectionLabelObserved(CHAIN, CONTRACT, 'world', 'purupuru', NOW)!, seq: 2 },
    ];
    const e = foldCollectionEntity(entries)!;
    expect(e.labels.world).toBe('mibera'); // preserved
    expect(e.provenance.find((p) => p.label === 'world')!.contested).toBe(true);
  });

  it('observedEventId is a pure function of the payload identity fields', () => {
    const id = observedEventId({
      entity_id: ENTITY,
      chain: CHAIN,
      contract: ENTITY.slice(ENTITY.indexOf(':') + 1),
      label: 'token_standard',
      value: 'erc721',
      source_type: 'ai-derived',
    });
    expect(id).toMatch(/^col:obs:[0-9a-f]{64}$/);
  });
});

import { describe, expect, it } from 'vitest';
import {
  collectionLabelObserved,
  collectionLabelRatified,
  collectionEntityId,
} from '@freeside/shadow-mode-protocol';
import { InMemoryLedgerStore } from '../adapters/in-memory-store.js';
import { collectionProducerGrant, testGrant } from '../auth/append-grant.js';

const CHAIN = '80094';
const CONTRACT = '0xABCDEF0123456789ABCDEF0123456789ABCDEF01';
const ENTITY = collectionEntityId(CHAIN, CONTRACT)!;
const NOW = '2026-07-03T00:00:00.000Z';

async function observe(store: InMemoryLedgerStore, label: any, value: string, grant = collectionProducerGrant()) {
  const o = collectionLabelObserved(CHAIN, CONTRACT, label, value, NOW)!;
  return store.appendObservationIfAbsent(o, grant);
}

describe('collection labelled-entity store (S1-T3, SDD §2/§11.5)', () => {
  it('round-trips: append observed labels → getCollectionEntity folds the projection', async () => {
    const store = new InMemoryLedgerStore();
    await observe(store, 'token_standard', 'erc1155');
    await observe(store, 'collection_key', 'apdao-seat');
    const entity = await store.getCollectionEntity(ENTITY);
    expect(entity).toBeDefined();
    expect(entity!.entity_id).toBe(ENTITY);
    expect(entity!.labels.token_standard).toBe('erc1155');
    expect(entity!.labels.collection_key).toBe('apdao-seat');
    // derived labels fold as ai-derived, unratified
    expect(entity!.provenance.find((p) => p.label === 'token_standard')!.source_type).toBe('ai-derived');
  });

  it('the collection lives on its OWN worldline (chain_id = entity_id) and verifies', async () => {
    const store = new InMemoryLedgerStore();
    await observe(store, 'token_standard', 'erc721');
    const verdict = await store.verifyChain(ENTITY);
    expect(verdict.ok).toBe(true);
  });

  it('idempotent: re-observing the SAME value is a no-op (content-addressed event_id)', async () => {
    const store = new InMemoryLedgerStore();
    const first = await observe(store, 'token_standard', 'erc721');
    const second = await observe(store, 'token_standard', 'erc721');
    expect(first).toBe(true);
    expect(second).toBe(false); // dedup
  });

  it('derived re-derive overwrites (ground truth wins, latest seq)', async () => {
    const store = new InMemoryLedgerStore();
    await observe(store, 'token_standard', 'unknown');
    await observe(store, 'token_standard', 'erc1155'); // later derive
    const entity = await store.getCollectionEntity(ENTITY);
    expect(entity!.labels.token_standard).toBe('erc1155');
  });

  it('ratify wins for subjective labels; a later disagreeing derive → contested but operator truth PRESERVED', async () => {
    const store = new InMemoryLedgerStore();
    // propose world = apdao (unratified)
    await observe(store, 'world', 'apdao');
    let entity = await store.getCollectionEntity(ENTITY);
    expect(entity!.labels.world).toBe('apdao');
    expect(entity!.provenance.find((p) => p.label === 'world')!.source_type).toBe('ai-derived');

    // operator ratifies world = mibera
    const ratObs = collectionLabelRatified(ENTITY, 'world', 'mibera', 'operator', NOW)!;
    await store.appendObservationIfAbsent(ratObs, collectionProducerGrant());
    entity = await store.getCollectionEntity(ENTITY);
    expect(entity!.labels.world).toBe('mibera');
    expect(entity!.provenance.find((p) => p.label === 'world')!.source_type).toBe('operator-validated');

    // a NEW post-ratify derive disagrees → contested, but the ratified value stays.
    // (Re-asserting a pre-ratify value would dedup by content-address — the operator
    // already adjudicated it — so a genuine contest is a value not seen before.)
    await observe(store, 'world', 'purupuru');
    entity = await store.getCollectionEntity(ENTITY);
    expect(entity!.labels.world).toBe('mibera'); // operator truth NOT overwritten
    expect(entity!.provenance.find((p) => p.label === 'world')!.contested).toBe(true);
  });

  it('listCollectionEntities returns only collections, not member subjects', async () => {
    const store = new InMemoryLedgerStore();
    await observe(store, 'token_standard', 'erc721');
    const list = await store.listCollectionEntities();
    expect(list).toHaveLength(1);
    expect(list[0]!.entity_id).toBe(ENTITY);
  });

  it('tamper on the collection chain freezes ONLY that chain', async () => {
    const store = new InMemoryLedgerStore();
    const o = collectionLabelObserved(CHAIN, CONTRACT, 'token_standard', 'erc721', NOW)!;
    await store.appendObservationIfAbsent(o, collectionProducerGrant());
    store.unsafeMutateObservationForTest(o.event_id, (obs) => {
      (obs.payload as { value: string }).value = 'erc1155'; // forge
    });
    const verdict = await store.verifyChain(ENTITY);
    expect(verdict.ok).toBe(false);
  });

  it('FAGAN MEDIUM-2: getCollectionEntity REFUSES to serve a tampered chain (fail loud)', async () => {
    const store = new InMemoryLedgerStore();
    const o = collectionLabelObserved(CHAIN, CONTRACT, 'token_standard', 'erc721', NOW)!;
    await store.appendObservationIfAbsent(o, collectionProducerGrant());
    store.unsafeMutateObservationForTest(o.event_id, (obs) => {
      (obs.payload as { value: string }).value = 'erc1155'; // forge
    });
    await expect(store.getCollectionEntity(ENTITY)).rejects.toThrow(/frozen/i);
    // and it is excluded from the list, never served
    expect(await store.listCollectionEntities()).toHaveLength(0);
  });

  it('grant scope is enforced: a member-source grant cannot write a collection observation', async () => {
    const store = new InMemoryLedgerStore();
    const o = collectionLabelObserved(CHAIN, CONTRACT, 'token_standard', 'erc721', NOW)!;
    const wrongGrant = testGrant(['discord'], ['discord.member.snapshot.v1']);
    await expect(store.appendObservationIfAbsent(o, wrongGrant)).rejects.toThrow();
  });
});

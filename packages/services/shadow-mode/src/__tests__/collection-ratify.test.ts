import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  ratifyCollectionLabel,
  consumeCockpitGrant,
  COCKPIT_GRANT_TTL_MS,
} from '../collections/ratify.js';
import { collectionLabelObserved, collectionEntityId } from '@freeside/shadow-mode-protocol';
import { InMemoryLedgerStore } from '../adapters/in-memory-store.js';
import { collectionProducerGrant } from '../auth/append-grant.js';

const CHAIN = '80094';
const CONTRACT = '0x6666397dfe9a8c469bf65dc744cb1c733416c420';
const ENTITY = collectionEntityId(CHAIN, CONTRACT)!;
const NOW = '2026-07-03T00:00:00.000Z';

let dir: string;
let grantPath: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cockpit-'));
  grantPath = join(dir, '.recall-cockpit-grant');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function touchGrant() {
  writeFileSync(grantPath, '');
}

describe('collection ratify — the force-chain gate (S2-T3, SDD §4)', () => {
  it('a self-ratify WITHOUT a grant is blocked', async () => {
    const store = new InMemoryLedgerStore();
    const r = await ratifyCollectionLabel(
      store,
      collectionProducerGrant(),
      { entity_id: ENTITY, label: 'world', value: 'mibera', ratified_by: 'agent' },
      NOW,
      { grantPath }, // no grant file → blocked
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('no_grant');
  });

  it('a fresh grant authorizes exactly ONE ratify (single-consume)', async () => {
    const store = new InMemoryLedgerStore();
    const grant = collectionProducerGrant();
    touchGrant();
    const first = await ratifyCollectionLabel(
      store,
      grant,
      { entity_id: ENTITY, label: 'world', value: 'mibera', ratified_by: 'operator' },
      NOW,
      { grantPath },
    );
    expect(first.ok).toBe(true);
    expect(existsSync(grantPath)).toBe(false); // consumed

    // a SECOND ratify after one grant is blocked
    const second = await ratifyCollectionLabel(
      store,
      grant,
      { entity_id: ENTITY, label: 'role', value: 'primary', ratified_by: 'operator' },
      NOW,
      { grantPath },
    );
    expect(second.ok).toBe(false);
    expect(second.reason).toBe('no_grant');

    // the folded entity shows the operator-validated world
    const entity = await store.getCollectionEntity(ENTITY);
    expect(entity!.labels.world).toBe('mibera');
    expect(entity!.provenance.find((p) => p.label === 'world')!.source_type).toBe('operator-validated');
  });

  it('CSOT-003: a grant already consumed (ENOENT on unlink) does NOT authorize', () => {
    // no grant file exists → the unlink gets ENOENT → not authorized (the race-loser path)
    expect(consumeCockpitGrant({ grantPath })).toBe(false);
  });

  it('a stale grant is refused (and consumed so it cannot be reused)', () => {
    touchGrant();
    const stale = consumeCockpitGrant({ grantPath, nowMs: Date.now() + COCKPIT_GRANT_TTL_MS + 1000 });
    expect(stale).toBe(false);
    expect(existsSync(grantPath)).toBe(false);
  });

  it('ratifying a DERIVED label is rejected even WITH a grant (FAGAN HIGH-1)', async () => {
    const store = new InMemoryLedgerStore();
    touchGrant();
    const r = await ratifyCollectionLabel(
      store,
      collectionProducerGrant(),
      { entity_id: ENTITY, label: 'token_standard', value: 'erc721', ratified_by: 'operator' },
      NOW,
      { grantPath },
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('rejected_label');
  });

  it('a member subject_id (not chain:contract) cannot be collection-ratified', async () => {
    const store = new InMemoryLedgerStore();
    touchGrant();
    const r = await ratifyCollectionLabel(
      store,
      collectionProducerGrant(),
      { entity_id: 'discord:12345', label: 'world', value: 'mibera', ratified_by: 'operator' },
      NOW,
      { grantPath },
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('rejected_label'); // identity guard in collectionLabelRatified
  });

  it('ratify preserves the operator value against a later disagreeing derive (contested)', async () => {
    const store = new InMemoryLedgerStore();
    const grant = collectionProducerGrant();
    // propose world=apdao (unratified)
    await store.appendObservationIfAbsent(collectionLabelObserved(CHAIN, CONTRACT, 'world', 'apdao', NOW)!, grant);
    touchGrant();
    await ratifyCollectionLabel(store, grant, { entity_id: ENTITY, label: 'world', value: 'mibera', ratified_by: 'operator' }, NOW, { grantPath });
    // a NEW post-ratify derive disagrees
    await store.appendObservationIfAbsent(collectionLabelObserved(CHAIN, CONTRACT, 'world', 'purupuru', NOW)!, grant);
    const entity = await store.getCollectionEntity(ENTITY);
    expect(entity!.labels.world).toBe('mibera'); // operator truth preserved
    expect(entity!.provenance.find((p) => p.label === 'world')!.contested).toBe(true);
  });
});

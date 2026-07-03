import { describe, it, expect, beforeEach } from 'vitest';
import type { ShadowEvent } from '@freeside/shadow-mode-protocol';
import { ShadowLedger } from '../shadow-ledger.js';
import { InMemoryLedgerStore } from '../adapters/in-memory-store.js';

const NOW = '2026-06-26T00:00:00.000Z';

function ledger(): ShadowLedger {
  return new ShadowLedger(new InMemoryLedgerStore());
}

function ev(partial: Partial<ShadowEvent> & Pick<ShadowEvent, 'event_id' | 'name' | 'source' | 'payload'>): ShadowEvent {
  return {
    schema_version: 'shadow.event.v1',
    community_id: 'demo',
    truth_status: 'observed',
    observed_at: NOW,
    emitted_at: NOW,
    ...partial,
  } as ShadowEvent;
}

describe('AC-1 idempotent ingest', () => {
  it('replaying the same event_id is a no-op (1 observation, 2nd duplicate)', async () => {
    const l = ledger();
    const e = ev({ event_id: 'e1', name: 'discord.member.snapshot.v1', source: 'discord',
      payload: { discord_user_id: '1001', role_ids: ['role-holder'] } });
    expect((await l.ingest(e)).status).toBe('ingested');
    expect((await l.ingest(e)).status).toBe('duplicate');
    expect((await l.getMemberGraph('demo')).summary.total_subjects).toBe(1);
  });
});

describe('AC-2 discord-only member stays unresolved until verified', () => {
  it('a discord snapshot alone is observed_only, not verified', async () => {
    const l = ledger();
    await l.ingest(ev({ event_id: 'e1', name: 'discord.member.snapshot.v1', source: 'discord',
      payload: { discord_user_id: '1001', role_ids: ['role-holder'] } }));
    const [subj] = (await l.getMemberGraph('demo')).subjects;
    expect(subj!.kind).toBe('discord_member');
    expect(subj!.attribution_quality).not.toBe('verified');
    expect(await l.getUnresolved('demo')).toHaveLength(1);
  });
});

describe('AC-3 wallet-only chain actor stays wallet_only until verified', () => {
  it('a sonar attribution alone is wallet_only, not verified', async () => {
    const l = ledger();
    await l.ingest(ev({ event_id: 'e1', name: 'sonar.wallet.attributed.v1', source: 'sonar',
      payload: { wallet: { chain: 'berachain', address: '0xBBB' }, contract_address: '0xc', edge_kind: 'minted' } }));
    const [subj] = (await l.getMemberGraph('demo')).subjects;
    expect(subj!.kind).toBe('wallet_only');
    expect(subj!.attribution_quality).not.toBe('verified');
  });
});

describe('AC-4 verified link merges conservatively', () => {
  it('discord_member + identity.account.linked(discord) merge into a verified identity_user', async () => {
    const l = ledger();
    await l.ingest(ev({ event_id: 'd1', name: 'discord.member.snapshot.v1', source: 'discord',
      payload: { discord_user_id: '1001', display_name: 'alice', role_ids: ['role-holder'] } }));
    await l.ingest(ev({ event_id: 'i1', name: 'identity.account.linked.v1', source: 'identity_api', truth_status: 'attested',
      payload: { user_id: 'usr_alice', account_kind: 'discord', external_id: '1001' } }));
    const g = await l.getMemberGraph('demo');
    expect(g.summary.total_subjects).toBe(1); // absorbed
    const subj = g.subjects[0]!;
    expect(subj.kind).toBe('identity_user');
    expect(subj.attribution_quality).toBe('verified');
    expect(subj.discord_user_id).toBe('1001');
    expect(subj.current_roles).toContain('role-holder'); // role unioned from absorbed discord subject
    expect(subj.aliases).toContain('discord:1001');
  });

  it('wallet_only + identity.wallet.linked merge the wallet alias into the identity_user', async () => {
    const l = ledger();
    await l.ingest(ev({ event_id: 's1', name: 'sonar.wallet.attributed.v1', source: 'sonar',
      payload: { wallet: { chain: 'berachain', address: '0xAAA' }, contract_address: '0xc', edge_kind: 'minted' } }));
    await l.ingest(ev({ event_id: 'w1', name: 'identity.wallet.linked.v1', source: 'identity_api', truth_status: 'attested',
      payload: { user_id: 'usr_alice', wallet: { chain: 'berachain', address: '0xAAA' } } }));
    const g = await l.getMemberGraph('demo');
    expect(g.summary.total_subjects).toBe(1);
    expect(g.subjects[0]!.attribution_quality).toBe('verified');
    expect(g.subjects[0]!.aliases).toContain('wallet:berachain:0xaaa');
  });
});

describe('AC-5 divergence classification honors role_rank', () => {
  it('incumbent role-holder vs freeside role-core (higher) => freeside_higher', async () => {
    const l = ledger();
    await l.ingest(ev({ event_id: 'cfg', name: 'community.config.updated.v1', source: 'manual_config', truth_status: 'attested',
      payload: { role_rank: { 'role-holder': 1, 'role-core': 2 } } }));
    await l.ingest(ev({ event_id: 'inc', name: 'incumbent.role.observed.v1', source: 'incumbent_bot',
      payload: { discord_user_id: '1001', incumbent: 'collab.land', role_ids: ['role-holder'] } }));
    await l.ingest(ev({ event_id: 'fr', name: 'freeside.role.computed.v1', source: 'freeside', truth_status: 'inferred',
      payload: { locator: { discord_user_id: '1001' }, role_ids: ['role-core'] } }));
    const [div] = await l.getDivergences('demo');
    expect(div!.kind).toBe('freeside_higher');
    expect(div!.reason).toMatch(/higher ranked role/);
  });

  it('equal role sets => match', async () => {
    const l = ledger();
    await l.ingest(ev({ event_id: 'inc', name: 'incumbent.role.observed.v1', source: 'incumbent_bot',
      payload: { discord_user_id: '1001', incumbent: 'collab.land', role_ids: ['role-holder'] } }));
    await l.ingest(ev({ event_id: 'fr', name: 'freeside.role.computed.v1', source: 'freeside', truth_status: 'inferred',
      payload: { locator: { discord_user_id: '1001' }, role_ids: ['role-holder'] } }));
    expect((await l.getDivergences('demo'))[0]!.kind).toBe('match');
  });
});

describe('merge cleans up the absorbed subject (no dangling divergence — FAGAN review)', () => {
  it('a merge that absorbs a subject WITH a divergence leaves no divergence pointing at a deleted subject', async () => {
    const l = ledger();
    await l.ingest(ev({ event_id: 'cfg', name: 'community.config.updated.v1', source: 'manual_config', truth_status: 'attested',
      payload: { role_rank: { 'role-holder': 1, 'role-core': 2 } } }));
    // discord subject accrues incumbent + freeside roles => a divergence keyed on the discord subject_id
    await l.ingest(ev({ event_id: 'd1', name: 'discord.member.snapshot.v1', source: 'discord',
      payload: { discord_user_id: '1001', role_ids: ['role-holder'] } }));
    await l.ingest(ev({ event_id: 'inc', name: 'incumbent.role.observed.v1', source: 'incumbent_bot',
      payload: { discord_user_id: '1001', incumbent: 'collab.land', role_ids: ['role-holder'] } }));
    await l.ingest(ev({ event_id: 'fr', name: 'freeside.role.computed.v1', source: 'freeside', truth_status: 'inferred',
      payload: { locator: { discord_user_id: '1001' }, role_ids: ['role-core'] } }));
    // NOW an identity link merges that discord subject into an identity_user (deletes the discord subject)
    await l.ingest(ev({ event_id: 'i1', name: 'identity.account.linked.v1', source: 'identity_api', truth_status: 'attested',
      payload: { user_id: 'usr_alice', account_kind: 'discord', external_id: '1001' } }));

    const g = await l.getMemberGraph('demo');
    const subjectIds = new Set(g.subjects.map((s) => s.subject_id));
    // every divergence must point at a live subject (FK integrity / no dangling projection row)
    for (const d of g.divergences) {
      expect(subjectIds.has(d.subject_id), `dangling divergence -> ${d.subject_id}`).toBe(true);
    }
    // exactly one divergence for the (now single, merged) member
    expect(g.divergences).toHaveLength(1);
    expect(g.summary.total_subjects).toBe(1);
  });
});

describe('AC-10 merge provenance + revoke downgrade', () => {
  it('a merge records provenance; revoke downgrades verified -> observed_only and flags re-split', async () => {
    const l = ledger();
    await l.ingest(ev({ event_id: 'w1', name: 'identity.wallet.linked.v1', source: 'identity_api', truth_status: 'attested',
      payload: { user_id: 'usr_alice', wallet: { chain: 'berachain', address: '0xAAA' } } }));
    let subj = (await l.getMemberGraph('demo')).subjects[0]!;
    expect(subj.attribution_quality).toBe('verified');

    await l.ingest(ev({ event_id: 'r1', name: 'identity.link.revoked.v1', source: 'identity_api', truth_status: 'attested',
      payload: { user_id: 'usr_alice', link_kind: 'wallet', reason: 'compromised' } }));
    subj = (await l.getMemberGraph('demo')).subjects[0]!;
    expect(subj.attribution_quality).toBe('observed_only');
    expect(subj.pending_resplit).toBe(true);
  });
});

describe('identity-vs-identity conflict is never silently absorbed (FAGAN HIGH)', () => {
  it('two identities linking the SAME wallet stay distinct (no account-takeover collapse)', async () => {
    const l = ledger();
    await l.ingest(ev({ event_id: 'a', name: 'identity.wallet.linked.v1', source: 'identity_api', truth_status: 'attested',
      payload: { user_id: 'usr_alice', wallet: { chain: 'berachain', address: '0xWWW' } } }));
    await l.ingest(ev({ event_id: 'b', name: 'identity.wallet.linked.v1', source: 'identity_api', truth_status: 'attested',
      payload: { user_id: 'usr_bob', wallet: { chain: 'berachain', address: '0xWWW' } } }));
    const g = await l.getMemberGraph('demo');
    const ids = g.subjects.filter((s) => s.kind === 'identity_user').map((s) => s.identity_user_id).sort();
    expect(ids).toEqual(['usr_alice', 'usr_bob']); // both survive — NOT collapsed
    expect(g.edges.some((e) => e.edge_kind === 'identity_conflict_wallet')).toBe(true);
    // the contested wallet alias stays with the ORIGINAL owner (alice), not the last writer (bob)
    const walletKey = 'wallet:berachain:0xwww';
    const alice = g.subjects.find((s) => s.identity_user_id === 'usr_alice')!;
    const bob = g.subjects.find((s) => s.identity_user_id === 'usr_bob')!;
    expect(alice.aliases).toContain(walletKey);
    expect(bob.aliases).not.toContain(walletKey);
  });
});

describe('unresolved freeside fallback is idempotent on retry (FAGAN MEDIUM)', () => {
  it('re-emitting the same unresolvable locator with a new event_id collapses to ONE subject', async () => {
    const l = ledger();
    await l.ingest(ev({ event_id: 'f1', name: 'freeside.role.computed.v1', source: 'freeside', truth_status: 'inferred',
      payload: { locator: { user_id: 'ghost' }, role_ids: ['role-core'] } }));
    await l.ingest(ev({ event_id: 'f2', name: 'freeside.role.computed.v1', source: 'freeside', truth_status: 'inferred',
      payload: { locator: { user_id: 'ghost' }, role_ids: ['role-core'] } }));
    expect((await l.getMemberGraph('demo')).summary.total_subjects).toBe(1);
  });
});

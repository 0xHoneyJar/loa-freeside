import { describe, it, expect } from 'vitest';
import { ShadowLedger } from '../shadow-ledger.js';
import { InMemoryLedgerStore } from '../adapters/in-memory-store.js';
import { StaticProducerPolicy } from '../adapters/static-producer-policy.js';
import { createShadowRouter } from '../http/shadow-router.js';

function app() {
  const ledger = new ShadowLedger(new InMemoryLedgerStore());
  return createShadowRouter({ ledger, policy: new StaticProducerPolicy() });
}

const NOW = '2026-06-26T00:00:00.000Z';
const discordEvent = {
  event_id: 'e1', schema_version: 'shadow.event.v1', community_id: 'demo',
  name: 'discord.member.snapshot.v1', source: 'discord', truth_status: 'observed',
  observed_at: NOW, emitted_at: NOW, payload: { discord_user_id: '1001', role_ids: ['role-holder'] },
};

function post(a: ReturnType<typeof app>, path: string, body: unknown) {
  return a.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function body(res: Response): Promise<any> {
  return res.json();
}

describe('shadow-router', () => {
  it('GET /health → 200', async () => {
    const res = await app().request('/health');
    expect(res.status).toBe(200);
    expect((await body(res)).service).toBe('shadow-mode-api');
  });

  it('POST /events with a valid, authorized event → 202 ingested', async () => {
    const res = await post(app(), '/events', discordEvent);
    expect(res.status).toBe(202);
    expect((await body(res)).status).toBe('ingested');
  });

  it('POST /events rejected by the fail-closed policy → 401 (discord emitting identity.wallet.linked)', async () => {
    const forged = { ...discordEvent, name: 'identity.wallet.linked.v1',
      payload: { user_id: 'usr_x', wallet: { chain: 'berachain', address: '0xabc' } } };
    const res = await post(app(), '/events', forged);
    expect(res.status).toBe(401);
    expect((await body(res)).reason).toBe('unauthorized_source');
  });

  it('POST /events with a malformed envelope → 400', async () => {
    const res = await post(app(), '/events', { not: 'an event' });
    expect(res.status).toBe(400);
  });

  it('read projections after ingest', async () => {
    const a = app();
    await post(a, '/events', discordEvent);
    const graph = await a.request('/communities/demo/member-graph');
    expect(graph.status).toBe(200);
    expect((await body(graph)).summary.total_subjects).toBe(1);

    const unresolved = await a.request('/communities/demo/unresolved');
    expect((await body(unresolved)).subjects).toHaveLength(1);

    const report = await a.request('/communities/demo/reports/access-audit', { method: 'POST' });
    expect(report.status).toBe(201);
    expect((await body(report)).caveats.length).toBeGreaterThanOrEqual(3);
  });
});

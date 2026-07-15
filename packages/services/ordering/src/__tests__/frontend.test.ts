import { describe, it, expect, vi } from 'vitest';
import type { AuditRequest, AuditServiceResult } from '@freeside/shadow-audit-service';
import type { AuditOutput, Cta, DriftReport } from '@freeside/shadow-audit-protocol';
import { createFrontendApp } from '../frontend.js';
import { createIntakeApp } from '../intake.js';
import { InMemoryOrderStore } from '../store.js';
import { OrderOrchestrator } from '../orchestrator.js';
import { ConfigCapabilityResolver } from '../resolver.js';
import { publishOutbox, RecordingPublisher } from '../lifecycle-publisher.js';
import type { AuditPort, OperatedCommunityRegistry } from '../audit-acl.js';

const CONTRACT = '0x' + '2'.repeat(40);
const CTA: Cta = { product: 'https://x.test/p', conversation: 'https://x.test/c' };
const FAKE_OUTPUT = {
  run_id: 'demo',
  aggregate: { holder_turnover: 0.2, stale_access: { kind: 'exact', value: 3 } },
} as unknown as AuditOutput;
const OK: AuditServiceResult = {
  ok: true,
  output: FAKE_OUTPUT,
  uncertain: false,
  uncertainReasons: [],
  unmatchedRoleHolders: 0,
  drift: {} as DriftReport,
};

const VALID_BODY = {
  product: 'access-risk-audit',
  placed_by: 'operator:demo',
  inputs: { chain: '1', contract: CONTRACT, snapshot_date: '2026-06-01', threshold: 1 },
};

function app() {
  const store = new InMemoryOrderStore({ now: () => 1_700_000_000 });
  return { store, app: createFrontendApp({ store, now: () => 1_700_000_000_000 }) };
}

describe('frontend pages (S2)', () => {
  it('GET / serves the placement form posting to /v1/orders (S2-T1)', async () => {
    const res = await app().app.request('/');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<form');
    expect(html).toContain('access-risk-audit');
    expect(html).toContain("fetch('/v1/orders'");
  });

  it('GET /track/:id serves the tracking view that polls the order (S2-T2)', async () => {
    const res = await app().app.request('/track/abc-123');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('abc-123'); // the id is embedded
    expect(html).toContain("'/v1/orders/'"); // it polls the status endpoint
    expect(html).toContain('placed'); // the timeline steps
    expect(html).toContain('producing');
  });

  it('mounts the intake API at the same origin (form → 200 order_id)', async () => {
    const res = await app().app.request('/v1/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(VALID_BODY),
    });
    expect(res.status).toBe(200);
    expect((await res.json() as { order_id: string }).order_id).toBeTruthy();
  });
});

describe('frontend end-to-end demo (S2-T2: place → advance → render aggregate)', () => {
  it('a placed order, once driven, is fulfilled with an aggregate the tracking view can render', async () => {
    const { store, app: feApp } = app();
    const audit: AuditPort = { invoke: async (_r: AuditRequest) => OK };
    const communities: OperatedCommunityRegistry = (c) =>
      c === CONTRACT ? { name: 'Demo DAO', owner_wallet: '0x' + '1'.repeat(40) } : undefined;
    const orchestrator = new OrderOrchestrator({
      store,
      resolver: new ConfigCapabilityResolver({
        'member-graph': { building: 'shadow-mode-api', endpoint: 'http://m' },
        roles: { building: 'worlds-api', endpoint: 'http://w' },
      }),
      audit,
      communities,
      cta: CTA,
      now: () => 1_700_000_000_000,
    });

    // place via the frontend-mounted API
    const placed = await feApp.request('/v1/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(VALID_BODY),
    });
    const { order_id } = (await placed.json()) as { order_id: string };

    // drive it (what the demo's onPlaced / the NATS consumer does)
    await orchestrator.process(order_id);
    await publishOutbox(store, new RecordingPublisher());

    // the tracking view polls this — it must show fulfilled + the aggregate
    const status = await feApp.request(`/v1/orders/${order_id}`);
    const body = (await status.json()) as { state: string; output?: { aggregate?: Record<string, unknown> } };
    expect(body.state).toBe('fulfilled');
    expect(body.output?.aggregate).toBeDefined();
    expect(body.output?.aggregate?.holder_turnover).toBe(0.2);
  });

  it('intake fires onPlaced after persisting (the demo driver seam)', async () => {
    const store = new InMemoryOrderStore({ now: () => 1_700_000_000 });
    const onPlaced = vi.fn();
    const intake = createIntakeApp({ store, now: () => 1_700_000_000_000, onPlaced });
    const res = await intake.request('/v1/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(VALID_BODY),
    });
    const { order_id } = (await res.json()) as { order_id: string };
    expect(onPlaced).toHaveBeenCalledWith(order_id);
  });
});

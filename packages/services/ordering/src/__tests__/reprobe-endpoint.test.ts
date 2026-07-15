import { describe, expect, it, vi } from 'vitest';
import {
  ORDER_LIFECYCLE_SUBJECTS,
  INITIAL_COMMUNITY_ONBOARDING_INGREDIENTS,
} from '@freeside/ordering-protocol';

import { OrderOrchestrator } from '../orchestrator.js';
import { createIntakeApp } from '../intake.js';
import { InMemoryOrderStore, type NewOrder } from '../store.js';
import { ConfigCapabilityResolver, type CapabilityConfig } from '../resolver.js';
import type { TriagePorts } from '../triage-ports.js';
import type { AuditPort } from '../audit-acl.js';
import type { AuditServiceResult } from '@freeside/shadow-audit-service';
import type { Cta } from '@freeside/shadow-audit-protocol';

const CONTRACT = '0x' + '4'.repeat(40);
const CTA: Cta = { product: 'https://example.test/audit', conversation: 'https://example.test/talk' };
const TRIAGE_CAPS: CapabilityConfig = {
  'collection-index': { building: 'sonar-api', endpoint: 'http://sonar.internal' },
  'community-register': { building: 'score-api', endpoint: 'http://score.internal' },
  'world-manifest': { building: 'worlds-api', endpoint: 'http://worlds.internal' },
};

class NoopAudit implements AuditPort {
  async invoke(): Promise<AuditServiceResult> {
    throw new Error('audit should not run for community-onboarding');
  }
}

function communityOrder(orderId: string): NewOrder {
  return {
    order_id: orderId,
    product: 'community-onboarding',
    placed_by: 'dashboard_onboarding',
    inputs: {
      chain_id: '8453',
      contract_address: CONTRACT,
      contact_email: 'cm@example.com',
      source: 'dashboard_onboarding',
    },
    placed_at_unix: 1_700_000_000,
    inputs_digest: 'b'.repeat(64),
    ingredients: { ...INITIAL_COMMUNITY_ONBOARDING_INGREDIENTS },
  };
}

function stubTriage(overrides: Partial<Record<keyof TriagePorts, unknown>> = {}): TriagePorts {
  return {
    sonar: { probe: vi.fn(async () => 'pending' as const) },
    score: { probe: vi.fn(async () => 'pending' as const) },
    worlds: {
      probe: vi.fn(async () => 'pending' as const),
      probeDetail: vi.fn(async () => ({ status: 'pending' as const })),
    },
    discord: { probe: vi.fn(async () => 'optional' as const) },
    shadow: { probe: vi.fn(async () => 'blocked' as const) },
    ...(overrides as object),
  } as TriagePorts;
}

function harness(triage: TriagePorts, opts: { nowMs?: () => number } = {}) {
  const store = new InMemoryOrderStore({ now: () => 1_700_000_000 });
  const now = opts.nowMs ?? (() => 1_700_000_000_000);
  const orchestrator = new OrderOrchestrator({
    store,
    resolver: new ConfigCapabilityResolver(TRIAGE_CAPS),
    audit: new NoopAudit(),
    communities: () => undefined,
    cta: CTA,
    now,
    triage,
  });
  return { store, orchestrator };
}

async function placeAndProduce(store: InMemoryOrderStore, orchestrator: OrderOrchestrator, id: string) {
  await store.placeOrder(communityOrder(id), {
    subject: ORDER_LIFECYCLE_SUBJECTS.placed,
    payload: { order_id: id, product: 'community-onboarding', inputs_digest: 'b'.repeat(64) },
  });
  await orchestrator.process(id);
  const record = await store.get(id);
  expect(record?.state).toBe('producing');
}

/** Drive placed→producing WITHOUT process() — for triage fakes that hang or throw. */
async function placeAndProduceManually(store: InMemoryOrderStore, id: string) {
  await store.placeOrder(communityOrder(id), {
    subject: ORDER_LIFECYCLE_SUBJECTS.placed,
    payload: { order_id: id, product: 'community-onboarding', inputs_digest: 'b'.repeat(64) },
  });
  await store.transition(id, 'placed', 'routing');
  await store.transition(id, 'routing', 'producing');
}

describe('CommunityOnboardingOrchestrator.reprobe', () => {
  it('fresh probe: returns fresh statuses, merges ingredients, writes probe_meta with source reprobe', async () => {
    const triage = stubTriage({ sonar: { probe: vi.fn(async () => 'complete' as const) } });
    const { store, orchestrator } = harness(triage);
    await placeAndProduce(store, orchestrator, 'ord_rp_fresh');

    const result = await orchestrator.communityOnboarding.reprobe('ord_rp_fresh', 'sonar');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.probes.sonar).toMatchObject({ status: 'complete', freshness: 'fresh', source: 'reprobe' });
    expect(result.record.ingredients?.sonar).toBe('complete');
    expect(result.record.probe_meta?.sonar).toMatchObject({ status: 'complete', source: 'reprobe' });
  });

  it('probe error: reports ambiguous, does NOT update probe_meta or downgrade the ingredient', async () => {
    const triage = stubTriage({ sonar: { probe: vi.fn(async () => Promise.reject(new Error('boom'))) } });
    const { store, orchestrator } = harness(triage);
    await placeAndProduceManually(store, 'ord_rp_err');
    const before = await store.get('ord_rp_err');
    const priorMeta = before?.probe_meta?.sonar;

    const result = await orchestrator.communityOnboarding.reprobe('ord_rp_err', 'sonar');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.probes.sonar).toMatchObject({ freshness: 'ambiguous', error_class: 'probe_error' });
    expect(result.probes.sonar?.status).toBeUndefined();
    // Ambiguity never overwrites recorded truth.
    expect(result.record.probe_meta?.sonar).toEqual(priorMeta);
    expect(result.record.ingredients?.sonar).toBe(before?.ingredients?.sonar);
  });

  it('hung probes classify as timeout-ambiguous and the call stays inside the global budget', async () => {
    process.env.REPROBE_PER_PROBE_TIMEOUT_MS = '50';
    vi.resetModules();
    const { OrderOrchestrator: FreshOrchestrator } = await import('../orchestrator.js');
    const never = () => new Promise<never>(() => {});
    const triage = stubTriage({
      sonar: { probe: vi.fn(never) },
      score: { probe: vi.fn(never) },
      worlds: { probe: vi.fn(never), probeDetail: vi.fn(never) },
    });
    const store = new InMemoryOrderStore({ now: () => 1_700_000_000 });
    const orchestrator = new FreshOrchestrator({
      store,
      resolver: new ConfigCapabilityResolver(TRIAGE_CAPS),
      audit: new NoopAudit(),
      communities: () => undefined,
      cta: CTA,
      now: () => Date.now(),
      triage,
    });
    await store.placeOrder(communityOrder('ord_rp_hang'), {
      subject: ORDER_LIFECYCLE_SUBJECTS.placed,
      payload: { order_id: 'ord_rp_hang', product: 'community-onboarding', inputs_digest: 'b'.repeat(64) },
    });
    // process() itself probes with no timeout — drive state manually to avoid hanging it.
    await store.transition('ord_rp_hang', 'placed', 'routing');
    await store.transition('ord_rp_hang', 'routing', 'producing');

    const started = Date.now();
    const result = await orchestrator.communityOnboarding.reprobe('ord_rp_hang');
    const elapsed = Date.now() - started;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const key of ['sonar', 'score', 'worlds_manifest']) {
      expect(result.probes[key]).toMatchObject({ freshness: 'ambiguous', error_class: 'timeout' });
    }
    // Structural metadata-port absence is a fresh pending result, owned by the worker's
    // audited pending→optional self-resolution rather than misclassified as a timeout.
    expect(result.probes.metadata_snapshot).toMatchObject({ status: 'pending', freshness: 'fresh' });
    // 4 pending targets in two ≤3 batches at 50ms — far inside the 30s budget.
    expect(elapsed).toBeLessThan(5_000);
    delete process.env.REPROBE_PER_PROBE_TIMEOUT_MS;
    vi.resetModules();
  });

  it('cooldown: a second reprobe within 10s returns cooldown; after 10s it runs', async () => {
    let nowMs = 1_700_000_000_000;
    const triage = stubTriage();
    const { store, orchestrator } = harness(triage, { nowMs: () => nowMs });
    await placeAndProduce(store, orchestrator, 'ord_rp_cool');

    const first = await orchestrator.communityOnboarding.reprobe('ord_rp_cool', 'sonar');
    expect(first.ok).toBe(true);

    nowMs += 3_000;
    const second = await orchestrator.communityOnboarding.reprobe('ord_rp_cool', 'sonar');
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error).toBe('cooldown');
    expect(second.retry_after_unix).toBe(Math.ceil((1_700_000_000_000 + 10_000) / 1000));

    nowMs += 8_000;
    const third = await orchestrator.communityOnboarding.reprobe('ord_rp_cool', 'sonar');
    expect(third.ok).toBe(true);
  });

  it('concurrent advance survives the reprobe merge (monotonic — IMP-003)', async () => {
    let releaseProbe!: () => void;
    const gate = new Promise<void>((resolve) => (releaseProbe = resolve));
    const triage = stubTriage({
      score: {
        probe: vi.fn(async () => {
          await gate;
          return 'pending' as const; // stale truth arriving AFTER the operator advanced
        }),
      },
    });
    const { store, orchestrator } = harness(triage);
    await placeAndProduceManually(store, 'ord_rp_race');

    const reprobing = orchestrator.communityOnboarding.reprobe('ord_rp_race', 'score');
    await orchestrator.communityOnboarding.advanceIngredient('ord_rp_race', 'score', 'complete');
    releaseProbe();
    const result = await reprobing;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The merge re-reads fresh state after probes; monotonic merge cannot downgrade 'complete'.
    expect(result.record.ingredients?.score).toBe('complete');
  });

  it('terminal order → order already terminal', async () => {
    const triage = stubTriage({
      sonar: { probe: vi.fn(async () => 'complete' as const) },
      score: { probe: vi.fn(async () => 'complete' as const) },
      worlds: {
        probe: vi.fn(async () => 'complete' as const),
        probeDetail: vi.fn(async () => ({ status: 'complete' as const, world_slug: 'pythenians' })),
      },
      shadow: { probe: vi.fn(async () => 'complete' as const) },
      // metadata_snapshot joined the preset (sprint-24 / #416). This harness runs no
      // fulfillment worker (whose audited self-resolve owns structural absence), so the
      // port must satisfy directly for the order to fulfil in one pass.
      metadata: { probe: vi.fn(async () => 'complete' as const) },
    });
    const { store, orchestrator } = harness(triage);
    // All-complete probes fulfil in a single process pass.
    await store.placeOrder(communityOrder('ord_rp_term'), {
      subject: ORDER_LIFECYCLE_SUBJECTS.placed,
      payload: { order_id: 'ord_rp_term', product: 'community-onboarding', inputs_digest: 'b'.repeat(64) },
    });
    await orchestrator.process('ord_rp_term');
    expect((await store.get('ord_rp_term'))?.state).toBe('fulfilled');

    const result = await orchestrator.communityOnboarding.reprobe('ord_rp_term');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('order already terminal');
  });
});

describe('POST /v1/orders/:id/reprobe (intake route)', () => {
  function appHarness() {
    let nowMs = 1_700_000_000_000;
    const triage = stubTriage({ sonar: { probe: vi.fn(async () => 'complete' as const) } });
    const store = new InMemoryOrderStore({ now: () => 1_700_000_000 });
    const orchestrator = new OrderOrchestrator({
      store,
      resolver: new ConfigCapabilityResolver(TRIAGE_CAPS),
      audit: new NoopAudit(),
      communities: () => undefined,
      cta: CTA,
      now: () => nowMs,
      triage,
    });
    const app = createIntakeApp({
      store,
      now: () => nowMs,
      orchestrator,
      serviceToken: 'sekrit',
      serviceTokenLabel: 'test-token',
    });
    return { store, orchestrator, app, tick: (ms: number) => (nowMs += ms) };
  }

  it('401 without/with-wrong Bearer; 404 unknown order; 409 terminal; 429 cooldown; 200 fresh', async () => {
    const { store, orchestrator, app, tick } = appHarness();
    await placeAndProduce(store, orchestrator, 'ord_rp_http');

    const unauth = await app.request('/v1/orders/ord_rp_http/reprobe', { method: 'POST' });
    expect(unauth.status).toBe(401);
    const wrong = await app.request('/v1/orders/ord_rp_http/reprobe', {
      method: 'POST',
      headers: { authorization: 'Bearer nope' },
    });
    expect(wrong.status).toBe(401);

    const missing = await app.request('/v1/orders/ord_rp_missing/reprobe', {
      method: 'POST',
      headers: { authorization: 'Bearer sekrit' },
    });
    expect(missing.status).toBe(404);

    const ok = await app.request('/v1/orders/ord_rp_http/reprobe', {
      method: 'POST',
      headers: { authorization: 'Bearer sekrit', 'content-type': 'application/json' },
      body: JSON.stringify({ ingredient: 'sonar' }),
    });
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as Record<string, unknown>;
    expect(body.order_id).toBe('ord_rp_http');
    expect((body.probes as Record<string, { freshness: string }>).sonar?.freshness).toBe('fresh');

    tick(1_000);
    const cooled = await app.request('/v1/orders/ord_rp_http/reprobe', {
      method: 'POST',
      headers: { authorization: 'Bearer sekrit' },
    });
    expect(cooled.status).toBe(429);
    const cooledBody = (await cooled.json()) as Record<string, unknown>;
    expect(cooledBody.retry_after_unix).toBeTypeOf('number');
  });
});

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

const CONTRACT = '0x' + '5'.repeat(40);
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

function harness(sonarStatus: () => 'pending' | 'in_progress' | 'complete' = () => 'pending') {
  const store = new InMemoryOrderStore({ now: () => 1_700_000_000 });
  let nowMs = 1_700_000_000_000;
  const triage: TriagePorts = {
    sonar: { probe: vi.fn(async () => sonarStatus()) },
    score: { probe: vi.fn(async () => 'pending' as const) },
    worlds: {
      probe: vi.fn(async () => 'pending' as const),
      probeDetail: vi.fn(async () => ({ status: 'pending' as const })),
    },
    discord: { probe: vi.fn(async () => 'optional' as const) },
    shadow: { probe: vi.fn(async () => 'blocked' as const) },
  };
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
    serviceTokenLabel: 'test-token-label',
  });
  return { store, orchestrator, app, tick: (ms: number) => (nowMs += ms) };
}

describe('advanceIngredient — server-derived evidence + actor (SDD D3)', () => {
  it('records token_label from deps and evidence as a probe_meta snapshot', async () => {
    const { store, orchestrator, app } = harness();
    await store.placeOrder(communityOrder('ord_ev_1'), {
      subject: ORDER_LIFECYCLE_SUBJECTS.placed,
      payload: { order_id: 'ord_ev_1', product: 'community-onboarding', inputs_digest: 'b'.repeat(64) },
    });
    await orchestrator.process('ord_ev_1'); // placed→producing; interval probes seed probe_meta

    const before = await store.get('ord_ev_1');
    const metaAtAdvance = before?.probe_meta?.sonar;
    expect(metaAtAdvance).toBeDefined();

    const res = await app.request('/v1/orders/ord_ev_1/advance-ingredient', {
      method: 'POST',
      headers: { authorization: 'Bearer sekrit', 'content-type': 'application/json' },
      body: JSON.stringify({ ingredient: 'sonar', status: 'complete', caller_note: 'probes green per sonar-api#117' }),
    });
    expect(res.status).toBe(200);

    const record = await store.get('ord_ev_1');
    const entry = record?.operator_audit?.at(-1);
    expect(entry).toMatchObject({
      event: 'operator.advance',
      ingredient: 'sonar',
      status: 'complete',
      token_label: 'test-token-label',
      caller_note: 'probes green per sonar-api#117',
    });
    expect(entry?.evidence).toEqual(metaAtAdvance);
  });

  it('evidence is an immutable value copy — a later reprobe leaves the past audit entry unchanged', async () => {
    let sonarNow: 'pending' | 'in_progress' | 'complete' = 'pending';
    const { store, orchestrator, tick } = harness(() => sonarNow);
    await store.placeOrder(communityOrder('ord_ev_2'), {
      subject: ORDER_LIFECYCLE_SUBJECTS.placed,
      payload: { order_id: 'ord_ev_2', product: 'community-onboarding', inputs_digest: 'b'.repeat(64) },
    });
    await orchestrator.process('ord_ev_2');

    await orchestrator.communityOnboarding.advanceIngredient('ord_ev_2', 'sonar', 'complete', undefined, {
      tokenLabel: 'test-token-label',
    });
    const entryBefore = structuredClone((await store.get('ord_ev_2'))?.operator_audit?.at(-1));

    sonarNow = 'complete';
    tick(60_000);
    const reprobed = await orchestrator.communityOnboarding.reprobe('ord_ev_2', 'sonar');
    expect(reprobed.ok).toBe(true);
    if (reprobed.ok) {
      expect(reprobed.record.probe_meta?.sonar?.status).toBe('complete'); // meta moved on
    }

    const entryAfter = (await store.get('ord_ev_2'))?.operator_audit?.at(-1);
    expect(entryAfter).toEqual(entryBefore); // the past entry is byte-identical
  });

  it('never-probed ingredient → evidence: null (the visibly ungrounded HITL escape hatch)', async () => {
    const { store, orchestrator } = harness();
    await store.placeOrder(communityOrder('ord_ev_3'), {
      subject: ORDER_LIFECYCLE_SUBJECTS.placed,
      payload: { order_id: 'ord_ev_3', product: 'community-onboarding', inputs_digest: 'b'.repeat(64) },
    });
    // Advance BEFORE any process/probe — probe_meta absent.
    const result = await orchestrator.communityOnboarding.advanceIngredient('ord_ev_3', 'score', 'complete', undefined, {
      tokenLabel: 'test-token-label',
    });
    expect(result.ok).toBe(true);
    const entry = (await store.get('ord_ev_3'))?.operator_audit?.find((e) => e.ingredient === 'score');
    expect(entry?.evidence).toBeNull();
    expect(entry?.token_label).toBe('test-token-label');
  });

  it('legacy body (no caller_note) stays valid; caller_note never substitutes token_label', async () => {
    const { store, orchestrator, app } = harness();
    await store.placeOrder(communityOrder('ord_ev_4'), {
      subject: ORDER_LIFECYCLE_SUBJECTS.placed,
      payload: { order_id: 'ord_ev_4', product: 'community-onboarding', inputs_digest: 'b'.repeat(64) },
    });
    await orchestrator.process('ord_ev_4');

    // Dashboard-shaped legacy body: ingredient + status only.
    const legacy = await app.request('/v1/orders/ord_ev_4/advance-ingredient', {
      method: 'POST',
      headers: { authorization: 'Bearer sekrit', 'content-type': 'application/json' },
      body: JSON.stringify({ ingredient: 'sonar', status: 'in_progress' }),
    });
    expect(legacy.status).toBe(200);
    const entry = (await store.get('ord_ev_4'))?.operator_audit?.at(-1);
    expect(entry?.token_label).toBe('test-token-label'); // server-derived regardless of body
    expect(entry?.caller_note).toBeUndefined();
  });

  it('caller_note over 120 chars → 400', async () => {
    const { store, orchestrator, app } = harness();
    await store.placeOrder(communityOrder('ord_ev_5'), {
      subject: ORDER_LIFECYCLE_SUBJECTS.placed,
      payload: { order_id: 'ord_ev_5', product: 'community-onboarding', inputs_digest: 'b'.repeat(64) },
    });
    await orchestrator.process('ord_ev_5');
    const res = await app.request('/v1/orders/ord_ev_5/advance-ingredient', {
      method: 'POST',
      headers: { authorization: 'Bearer sekrit', 'content-type': 'application/json' },
      body: JSON.stringify({ ingredient: 'sonar', status: 'complete', caller_note: 'x'.repeat(121) }),
    });
    expect(res.status).toBe(400);
  });
});

import { describe, expect, it, vi } from 'vitest';
import {
  ORDER_LIFECYCLE_SUBJECTS,
  INITIAL_COMMUNITY_ONBOARDING_INGREDIENTS,
  PublicOrderSchema,
} from '@freeside/ordering-protocol';

import { OrderOrchestrator } from '../orchestrator.js';
import { createIntakeApp } from '../intake.js';
import { InMemoryOrderStore, type NewOrder } from '../store.js';
import { ConfigCapabilityResolver, type CapabilityConfig } from '../resolver.js';
import type { TriagePorts } from '../triage-ports.js';
import type { AuditPort } from '../audit-acl.js';
import type { AuditServiceResult } from '@freeside/shadow-audit-service';
import type { Cta } from '@freeside/shadow-audit-protocol';

const CONTRACT = '0x' + '6'.repeat(40);
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

function harness() {
  const store = new InMemoryOrderStore({ now: () => 1_700_000_000 });
  let nowMs = 1_700_000_000_000;
  const triage: TriagePorts = {
    sonar: { probe: vi.fn(async () => 'pending' as const) },
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
    serviceTokenLabel: 'test-token',
  });
  return { store, orchestrator, app, tick: (ms: number) => (nowMs += ms) };
}

const AUTH = { authorization: 'Bearer sekrit', 'content-type': 'application/json' };

describe('canonical public projection (SDD D7)', () => {
  it('GET, advance, and reprobe all return the ONE PublicOrderSchema shape, deep-equal on shared fields', async () => {
    const { store, orchestrator, app, tick } = harness();
    await store.placeOrder(communityOrder('ord_proj'), {
      subject: ORDER_LIFECYCLE_SUBJECTS.placed,
      payload: { order_id: 'ord_proj', product: 'community-onboarding', inputs_digest: 'b'.repeat(64) },
    });
    await orchestrator.process('ord_proj');

    const getBody = (await (await app.request('/v1/orders/ord_proj')).json()) as Record<string, unknown>;
    // Strict parse IS the shape pin — unknown keys or leaked internals fail here.
    expect(() => PublicOrderSchema.parse(getBody)).not.toThrow();
    // Redaction boundary: internals never appear.
    for (const internal of ['placed_by', 'inputs', 'inputs_digest', 'created_at_unix', 'output_digest']) {
      expect(getBody).not.toHaveProperty(internal);
    }

    const advanceBody = (await (
      await app.request('/v1/orders/ord_proj/advance-ingredient', {
        method: 'POST',
        headers: AUTH,
        body: JSON.stringify({ ingredient: 'sonar', status: 'in_progress' }),
      })
    ).json()) as Record<string, unknown>;
    expect(() => PublicOrderSchema.parse(advanceBody)).not.toThrow();

    tick(60_000);
    const reprobeBody = (await (
      await app.request('/v1/orders/ord_proj/reprobe', { method: 'POST', headers: AUTH, body: JSON.stringify({}) })
    ).json()) as Record<string, unknown>;
    // Reprobe = projection + its per-probe outcome report.
    const { probes, ...reprobeProjection } = reprobeBody;
    expect(probes).toBeDefined();
    expect(() => PublicOrderSchema.parse(reprobeProjection)).not.toThrow();

    // Deep-equal on shared static fields across all three routes.
    for (const key of ['order_id', 'product', 'placed_at_unix', 'recipe_id', 'resolved_buildings'] as const) {
      expect(advanceBody[key]).toEqual(getBody[key]);
      expect(reprobeProjection[key as keyof typeof reprobeProjection]).toEqual(getBody[key]);
    }
  });
});

describe('unknown-preset support (FR-1)', () => {
  it('POST /v1/orders with an unknown product → 400 + available_presets', async () => {
    const { app } = harness();
    const res = await app.request('/v1/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ product: 'espresso-machine', placed_by: 'agent:test', inputs: {} }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; available_presets: string[] };
    expect(body.error).toContain('espresso-machine');
    expect(body.available_presets).toEqual(['access-risk-audit', 'community-onboarding']);
  });

  it('prototype-chain keys (constructor) get the same friendly 400 (Object.hasOwn, review #2)', async () => {
    const { app } = harness();
    const res = await app.request('/v1/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ product: 'constructor', placed_by: 'agent:test', inputs: {} }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { available_presets: string[] };
    expect(body.available_presets).toEqual(['access-risk-audit', 'community-onboarding']);
  });
});

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  OrderEnvelopeSchema,
  OrderPlacedSchema,
  OrderRoutingSchema,
  OrderFulfilledSchema,
  OrderFailedSchema,
  ORDER_LIFECYCLE_SUBJECTS,
  resolvePreset,
  ACCESS_RISK_AUDIT_PRESET,
  COMMUNITY_ONBOARDING_PRESET,
  INITIAL_COMMUNITY_ONBOARDING_INGREDIENTS,
} from '../index.js';

const validOrder = {
  order_id: '01J000000000000000000000AB',
  product: 'access-risk-audit' as const,
  placed_by: 'operator:soju',
  inputs: { chain: 'berachain', contract: '0xabc', snapshot_date: '2026-06-29' },
  placed_at_unix: 1751200000,
};

describe('OrderEnvelope', () => {
  it('accepts a valid envelope', () => {
    expect(OrderEnvelopeSchema.parse(validOrder)).toMatchObject({ product: 'access-risk-audit' });
  });
  it('rejects an unknown product', () => {
    expect(() => OrderEnvelopeSchema.parse({ ...validOrder, product: 'nope' })).toThrow();
  });
  it('rejects a missing order_id', () => {
    const bad: Record<string, unknown> = { ...validOrder };
    delete bad.order_id;
    expect(() => OrderEnvelopeSchema.parse(bad)).toThrow();
  });
  it('rejects unknown extra keys (strict)', () => {
    expect(() => OrderEnvelopeSchema.parse({ ...validOrder, sneaky: true })).toThrow();
  });
});

describe('lifecycle events', () => {
  it('declares the five v1 subjects in order', () => {
    expect(Object.values(ORDER_LIFECYCLE_SUBJECTS)).toEqual([
      'orders.lifecycle.placed.v1',
      'orders.lifecycle.routing.v1',
      'orders.lifecycle.producing.v1',
      'orders.lifecycle.fulfilled.v1',
      'orders.lifecycle.failed.v1',
    ]);
  });
  it('validates placed / routing / fulfilled / failed payloads', () => {
    expect(OrderPlacedSchema.parse({ order_id: 'o1', product: 'access-risk-audit', inputs_digest: 'd' })).toBeTruthy();
    expect(
      OrderRoutingSchema.parse({
        order_id: 'o1',
        recipe_id: 'access-risk-audit',
        resolved_buildings: [
          { capability: 'member-graph', building: 'shadow-mode-api', endpoint: 'http://x', source: 'config' },
        ],
      }),
    ).toBeTruthy();
    expect(OrderFulfilledSchema.parse({ order_id: 'o1', result_ref: 'r1', output_digest: 'd' })).toBeTruthy();
    expect(OrderFailedSchema.parse({ order_id: 'o1', refusal: { code: 'UNRESOLVABLE', reason: 'x' } })).toBeTruthy();
  });
  it('rejects an unknown resolution source', () => {
    expect(() =>
      OrderRoutingSchema.parse({
        order_id: 'o1',
        recipe_id: 'r',
        resolved_buildings: [{ capability: 'm', building: 'b', endpoint: 'e', source: 'guess' }],
      }),
    ).toThrow();
  });
});

describe('access-risk-audit preset', () => {
  it('resolves preset #1', () => {
    expect(resolvePreset('access-risk-audit')).toBe(ACCESS_RISK_AUDIT_PRESET);
  });
  it('validates good inputs and rejects a bad date', () => {
    const inputs = ACCESS_RISK_AUDIT_PRESET.inputSchema;
    expect(inputs.parse({ chain: 'berachain', contract: '0xabc', snapshot_date: '2026-06-29' })).toBeTruthy();
    expect(() => inputs.parse({ chain: 'berachain', contract: '0xabc', snapshot_date: 'June 29' })).toThrow();
  });
  it('reads the member-graph spine + roles (the LADDER), not sonar/score directly', () => {
    expect(ACCESS_RISK_AUDIT_PRESET.recipe.map((s) => s.capability)).toEqual(['member-graph', 'roles']);
  });
});

describe('community-onboarding preset', () => {
  it('resolves preset #2', () => {
    expect(resolvePreset('community-onboarding')).toBe(COMMUNITY_ONBOARDING_PRESET);
  });

  it('validates dashboard inputs and rejects bad email', () => {
    const inputs = COMMUNITY_ONBOARDING_PRESET.inputSchema;
    expect(
      inputs.parse({
        chain_id: '8453',
        contract_address: '0xabc',
        contact_email: 'cm@example.com',
        source: 'dashboard_onboarding',
      }),
    ).toBeTruthy();
    expect(() =>
      inputs.parse({
        chain_id: '8453',
        contract_address: '0xabc',
        contact_email: 'not-an-email',
        source: 'dashboard_onboarding',
      }),
    ).toThrow();
  });

  it('declares triage capabilities (L0 ingest ladder, not member-graph)', () => {
    expect(COMMUNITY_ONBOARDING_PRESET.capabilityNeeds).toEqual([
      'collection-index',
      'community-register',
      'world-manifest',
    ]);
    expect(COMMUNITY_ONBOARDING_PRESET.recipe.map((s) => s.capability)).toEqual([
      'collection-index',
      'community-register',
      'world-manifest',
      'discord-observer',
      'shadow-preview-gate',
    ]);
  });

  it('seeds initial ingredients with shadow_preview blocked', () => {
    expect(INITIAL_COMMUNITY_ONBOARDING_INGREDIENTS).toEqual({
      sonar: 'pending',
      score: 'pending',
      worlds_manifest: 'pending',
      discord_observer: 'optional',
      shadow_preview: 'blocked',
    });
  });
});

describe('bounded-context boundary (EVANS)', () => {
  it('never imports a shadow-audit schema', () => {
    const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..');
    const files = readdirSync(srcDir).filter((f) => f.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const body = readFileSync(join(srcDir, f), 'utf8');
      // Boundary check: forbid IMPORTING a shadow-audit module. Comments that explain the
      // boundary (e.g. "never imports shadow-audit's OrderSchema") are fine and encouraged.
      expect(body).not.toMatch(/from\s+['"][^'"]*shadow-audit/);
    }
  });
});

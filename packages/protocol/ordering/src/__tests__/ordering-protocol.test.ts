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
  CapabilityNeed,
  TriageCapabilityNeed,
  CommunityOnboardingIngredients,
  GateLeakInputs,
  GATE_LEAK_PRESET,
  GateLeakCommunityJoinSchema,
  GateLeakInputSuppliedSchema,
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
    expect(inputs.parse({ chain: '80094', contract: '0x' + 'a'.repeat(40), snapshot_date: '2026-06-29' })).toBeTruthy();
    expect(() => inputs.parse({ chain: '80094', contract: '0x' + 'a'.repeat(40), snapshot_date: 'June 29' })).toThrow();
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
        contract_address: '0x' + 'a'.repeat(40),
        contact_email: 'cm@example.com',
        source: 'dashboard_onboarding',
      }),
    ).toBeTruthy();
    expect(() =>
      inputs.parse({
        chain_id: '8453',
        contract_address: '0x' + 'a'.repeat(40),
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
      'metadata-snapshot',
      'world-manifest',
      'discord-observer',
      'shadow-preview-gate',
    ]);
  });

  it('seeds initial ingredients with shadow_preview blocked and metadata_snapshot pending', () => {
    expect(INITIAL_COMMUNITY_ONBOARDING_INGREDIENTS).toEqual({
      sonar: 'pending',
      score: 'pending',
      metadata_snapshot: 'pending',
      worlds_manifest: 'pending',
      discord_observer: 'optional',
      shadow_preview: 'blocked',
    });
  });
});

describe('metadata_snapshot protocol additions (T-1)', () => {
  it('CapabilityNeed contains metadata-snapshot', () => {
    expect(CapabilityNeed.options).toContain('metadata-snapshot');
  });

  it('TriageCapabilityNeed contains metadata-snapshot', () => {
    expect(TriageCapabilityNeed.options).toContain('metadata-snapshot');
  });

  it('INITIAL_COMMUNITY_ONBOARDING_INGREDIENTS has metadata_snapshot: pending', () => {
    expect(INITIAL_COMMUNITY_ONBOARDING_INGREDIENTS.metadata_snapshot).toBe('pending');
  });

  it('COMMUNITY_ONBOARDING_PRESET.recipe has exactly one metadata-snapshot entry, after community-register', () => {
    const recipe = COMMUNITY_ONBOARDING_PRESET.recipe;
    const metaIdx = recipe.findIndex((s) => s.capability === 'metadata-snapshot');
    const registerIdx = recipe.findIndex((s) => s.capability === 'community-register');
    expect(metaIdx).toBeGreaterThan(-1);
    expect(metaIdx).toBe(registerIdx + 1);
    expect(recipe.filter((s) => s.capability === 'metadata-snapshot')).toHaveLength(1);
  });

  it('CommunityOnboardingIngredients schema accepts metadata_snapshot and rejects unknown keys', () => {
    expect(() =>
      CommunityOnboardingIngredients.parse({
        sonar: 'pending',
        score: 'pending',
        metadata_snapshot: 'pending',
        worlds_manifest: 'pending',
        discord_observer: 'optional',
        shadow_preview: 'blocked',
      }),
    ).not.toThrow();
    // strict() — extra keys rejected
    expect(() =>
      CommunityOnboardingIngredients.parse({
        sonar: 'pending',
        score: 'pending',
        metadata_snapshot: 'pending',
        worlds_manifest: 'pending',
        discord_observer: 'optional',
        shadow_preview: 'blocked',
        extra: 'bad',
      }),
    ).toThrow();
  });
});

describe('gate-leak preset — anonymous free rung', () => {
  it('accepts an anonymous submission and keeps contact optional', () => {
    expect(
      GateLeakInputs.parse({
        chain_id: '80094',
        contract_address: '0x' + 'a'.repeat(40),
        source: 'public_gate_leak',
      }),
    ).toEqual({
      chain_id: '80094',
      contract_address: '0x' + 'a'.repeat(40),
      source: 'public_gate_leak',
    });
  });

  it('does not accept the dashboard-onboarding source or unknown keys', () => {
    expect(
      GateLeakInputs.safeParse({
        chain_id: '80094',
        contract_address: '0x' + 'a'.repeat(40),
        source: 'dashboard_onboarding',
      }).success,
    ).toBe(false);
    expect(
      GateLeakInputs.safeParse({
        chain_id: '80094',
        contract_address: '0x' + 'a'.repeat(40),
        source: 'public_gate_leak',
        wallet: '0xmember',
      }).success,
    ).toBe(false);
    expect(
      GateLeakInputs.safeParse({
        chain_id: '80094',
        contract_address: '0x' + 'a'.repeat(40),
        source: 'public_gate_leak',
        contact_email: 'captured-without-consent@example.test',
      }).success,
    ).toBe(false);
  });

  it('resolves a distinct 3-step recipe without widening community-onboarding', () => {
    expect(resolvePreset('gate-leak')).toBe(GATE_LEAK_PRESET);
    expect(GATE_LEAK_PRESET.recipe.map((step) => step.capability)).toEqual([
      'subject-resolution',
      'collection-index',
      'shadow-gate-leak',
    ]);
  });

  it('types the narrow order-id join', () => {
    expect(
      GateLeakCommunityJoinSchema.parse({
        gate_leak_order_id: 'gate-order',
        community_onboarding_order_id: 'onboarding-order',
        joined_at_unix: 1_700_000_000,
      }),
    ).toBeTruthy();
  });

  it('types the value-minimized prerequisite signal', () => {
    expect(
      GateLeakInputSuppliedSchema.parse({
        gate_leak_order_id: 'gate-order',
        input: 'access_started_at',
        supplied_at_unix: 1_700_000_000,
      }),
    ).toBeTruthy();
    expect(
      GateLeakInputSuppliedSchema.safeParse({
        gate_leak_order_id: 'gate-order',
        input: 'access_started_at',
        value: '2026-06-22',
        supplied_at_unix: 1_700_000_000,
      }).success,
    ).toBe(false);
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

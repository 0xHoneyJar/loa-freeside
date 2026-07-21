import { describe, it, expect, vi } from 'vitest';
import { ORDER_LIFECYCLE_SUBJECTS, INITIAL_COMMUNITY_ONBOARDING_INGREDIENTS } from '@freeside/ordering-protocol';
import { OrderOrchestrator } from '../orchestrator.js';
import { InMemoryOrderStore, type NewOrder } from '../store.js';
import { ConfigCapabilityResolver, type CapabilityConfig } from '../resolver.js';
import { StubTriagePorts } from '../triage-ports.js';
import { canFulfillCommunityOnboarding, CommunityOnboardingOrchestrator, mergeProbedIngredients } from '../community-onboarding-orchestrator.js';
import type { AuditPort } from '../audit-acl.js';
import type { AuditServiceResult } from '@freeside/shadow-audit-service';
import type { Cta } from '@freeside/shadow-audit-protocol';

const CONTRACT = '0x' + '3'.repeat(40);
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

function communityOrder(orderId = 'ord_co_1'): NewOrder {
  return {
    order_id: orderId,
    product: 'community-onboarding',
    placed_by: 'dashboard_onboarding',
    inputs: {
      chain_id: '8453',
      contract_address: CONTRACT,
      contact_email: 'cm@example.com',
      community_name: 'Pythenians',
      source: 'dashboard_onboarding',
    },
    placed_at_unix: 1_700_000_000,
    inputs_digest: 'b'.repeat(64),
    ingredients: { ...INITIAL_COMMUNITY_ONBOARDING_INGREDIENTS },
  };
}

function harness() {
  const store = new InMemoryOrderStore({ now: () => 1_700_000_000 });
  const orchestrator = new OrderOrchestrator({
    store,
    resolver: new ConfigCapabilityResolver(TRIAGE_CAPS),
    audit: new NoopAudit(),
    communities: () => undefined,
    cta: CTA,
    now: () => 1_700_000_000_000,
    triage: new StubTriagePorts(),
  });
  return { store, orchestrator };
}

describe('CommunityOnboardingOrchestrator', () => {
  it('starts with sonar pending and shadow_preview blocked', async () => {
    const { store, orchestrator } = harness();
    await store.placeOrder(communityOrder(), {
      subject: ORDER_LIFECYCLE_SUBJECTS.placed,
      payload: { order_id: 'ord_co_1', product: 'community-onboarding', inputs_digest: 'b'.repeat(64) },
    });

    await orchestrator.process('ord_co_1');
    const record = await store.get('ord_co_1');
    expect(record?.state).toBe('producing');
    expect(record?.ingredients?.sonar).toBe('pending');
    expect(record?.ingredients?.shadow_preview).toBe('blocked');
  });

  it('fulfills after operator advances required ingredients + world_slug', async () => {
    const { store, orchestrator } = harness();
    await store.placeOrder(communityOrder(), {
      subject: ORDER_LIFECYCLE_SUBJECTS.placed,
      payload: { order_id: 'ord_co_1', product: 'community-onboarding', inputs_digest: 'b'.repeat(64) },
    });
    await orchestrator.process('ord_co_1');

    for (const ingredient of ['sonar', 'score', 'metadata_snapshot', 'worlds_manifest'] as const) {
      await orchestrator.communityOnboarding.advanceIngredient('ord_co_1', ingredient, 'complete');
    }
    await orchestrator.communityOnboarding.advanceIngredient(
      'ord_co_1',
      'worlds_manifest',
      'complete',
      'pythenians',
    );
    await orchestrator.communityOnboarding.advanceIngredient('ord_co_1', 'shadow_preview', 'complete');

    const record = await store.get('ord_co_1');
    expect(record?.state).toBe('fulfilled');
    expect(record?.fulfillment?.world_slug).toBe('pythenians');
    expect(record?.fulfillment?.contact_email).toBe('cm@example.com');
  });

  it('does not double-fulfill on redelivered placed (CAS idempotency)', async () => {
    const { store, orchestrator } = harness();
    await store.placeOrder(communityOrder(), {
      subject: ORDER_LIFECYCLE_SUBJECTS.placed,
      payload: { order_id: 'ord_co_1', product: 'community-onboarding', inputs_digest: 'b'.repeat(64) },
    });

    for (const ingredient of ['sonar', 'score', 'metadata_snapshot', 'worlds_manifest'] as const) {
      await orchestrator.communityOnboarding.advanceIngredient('ord_co_1', ingredient, 'complete', 'slug-a');
    }
    await orchestrator.communityOnboarding.advanceIngredient('ord_co_1', 'shadow_preview', 'complete');
    expect((await store.get('ord_co_1'))?.state).toBe('fulfilled');

    await orchestrator.process('ord_co_1');
    expect((await store.get('ord_co_1'))?.state).toBe('fulfilled');
  });
});

describe('canFulfillCommunityOnboarding', () => {
  it('requires world_slug and required ingredients complete', () => {
    const ingredients = {
      sonar: 'complete' as const,
      score: 'complete' as const,
      metadata_snapshot: 'complete' as const,
      worlds_manifest: 'complete' as const,
      discord_observer: 'optional' as const,
      shadow_preview: 'complete' as const,
    };
    expect(
      canFulfillCommunityOnboarding(ingredients, {
        world_slug: 'x',
        contact_email: 'a@b.com',
        chain_id: '1',
        contract_address: CONTRACT,
      }),
    ).toBe(true);
    expect(canFulfillCommunityOnboarding(ingredients, undefined)).toBe(false);
  });
});

describe('mergeProbedIngredients', () => {
  it('does not downgrade in_progress to pending on reprobe', () => {
    const existing = { ...INITIAL_COMMUNITY_ONBOARDING_INGREDIENTS, score: 'in_progress' as const };
    const merged = mergeProbedIngredients(existing, { ...INITIAL_COMMUNITY_ONBOARDING_INGREDIENTS, score: 'pending' });
    expect(merged.score).toBe('in_progress');
  });
});

describe('canFulfillCommunityOnboarding — metadata_snapshot gate (T-5)', () => {
  const base = {
    sonar: 'complete' as const,
    score: 'complete' as const,
    worlds_manifest: 'complete' as const,
    discord_observer: 'optional' as const,
    shadow_preview: 'complete' as const,
  };
  const fulfillment = { world_slug: 'x', contact_email: 'a@b.com', chain_id: '1', contract_address: CONTRACT };

  it('returns false when metadata_snapshot is pending', () => {
    expect(canFulfillCommunityOnboarding({ ...base, metadata_snapshot: 'pending' }, fulfillment)).toBe(false);
  });

  it('returns false when metadata_snapshot is in_progress', () => {
    expect(canFulfillCommunityOnboarding({ ...base, metadata_snapshot: 'in_progress' }, fulfillment)).toBe(false);
  });

  it('returns false when metadata_snapshot is blocked', () => {
    expect(canFulfillCommunityOnboarding({ ...base, metadata_snapshot: 'blocked' }, fulfillment)).toBe(false);
  });

  it('returns true when metadata_snapshot is complete', () => {
    expect(canFulfillCommunityOnboarding({ ...base, metadata_snapshot: 'complete' }, fulfillment)).toBe(true);
  });

  it('returns true when metadata_snapshot is optional (NF-6 disabled path)', () => {
    expect(canFulfillCommunityOnboarding({ ...base, metadata_snapshot: 'optional' }, fulfillment)).toBe(true);
  });
});

// ── T-2: discord health gate in advanceIngredient (AC-3, AC-4) ────────────────

function discordAdvanceHarness(discordHealth?: {
  checkChannelHealth(chainId: string, contract: string): Promise<{ healthy: boolean; reason?: string }>;
}) {
  const store = new InMemoryOrderStore({ now: () => 1_700_000_000 });
  const orchestrator = new CommunityOnboardingOrchestrator({
    store,
    resolver: new ConfigCapabilityResolver(TRIAGE_CAPS),
    triage: new StubTriagePorts(),
    now: () => 1_700_000_000_000,
    discordHealth,
  });
  return { store, orchestrator };
}

async function placedAndProducing(store: ReturnType<typeof harness>['store'], orchestratorInstance: InstanceType<typeof CommunityOnboardingOrchestrator>) {
  await store.placeOrder(communityOrder('ord_dc_1'), {
    subject: ORDER_LIFECYCLE_SUBJECTS.placed,
    payload: { order_id: 'ord_dc_1', product: 'community-onboarding', inputs_digest: 'b'.repeat(64) },
  });
  await orchestratorInstance.process('ord_dc_1', (await store.get('ord_dc_1'))!);
  return store.get('ord_dc_1');
}

describe('CommunityOnboardingOrchestrator — discord health gate in advanceIngredient (T-2, AC-3, AC-4)', () => {
  it('AC-3: advanceIngredient discord_observer→complete with unhealthy port returns ok:false and does not patch the store', async () => {
    const spy = vi.fn().mockResolvedValue({ healthy: false, reason: 'channel archived' });
    const { store, orchestrator } = discordAdvanceHarness({ checkChannelHealth: spy });
    const initial = new InMemoryOrderStore({ now: () => 1_700_000_000 });
    // Use own store, orchestrator has its own store.
    await store.placeOrder(communityOrder('ord_dc_1'), {
      subject: ORDER_LIFECYCLE_SUBJECTS.placed,
      payload: { order_id: 'ord_dc_1', product: 'community-onboarding', inputs_digest: 'b'.repeat(64) },
    });
    await orchestrator.process('ord_dc_1', (await store.get('ord_dc_1'))!);
    const recordBefore = await store.get('ord_dc_1');

    const result = await orchestrator.advanceIngredient('ord_dc_1', 'discord_observer', 'complete');

    expect(result.ok).toBe(false);
    expect(result.error).toContain('discord channel-health check failed');
    // Store must be IDENTICAL before and after the rejected advance.
    const recordAfter = await store.get('ord_dc_1');
    expect(recordAfter?.ingredients).toEqual(recordBefore?.ingredients);
    expect(recordAfter?.operator_audit).toEqual(recordBefore?.operator_audit);
    void initial;
  });

  it('AC-4: advanceIngredient discord_observer→optional passes unconditionally (no health check)', async () => {
    const spy = vi.fn();
    const { store, orchestrator } = discordAdvanceHarness({ checkChannelHealth: spy });
    await store.placeOrder(communityOrder('ord_dc_2'), {
      subject: ORDER_LIFECYCLE_SUBJECTS.placed,
      payload: { order_id: 'ord_dc_2', product: 'community-onboarding', inputs_digest: 'b'.repeat(64) },
    });
    await orchestrator.process('ord_dc_2', (await store.get('ord_dc_2'))!);

    const result = await orchestrator.advanceIngredient('ord_dc_2', 'discord_observer', 'optional');

    expect(result.ok).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });
});

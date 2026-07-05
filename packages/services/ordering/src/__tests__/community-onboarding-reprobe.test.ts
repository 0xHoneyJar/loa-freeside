import { describe, expect, it, vi } from 'vitest';
import {
  ORDER_LIFECYCLE_SUBJECTS,
  INITIAL_COMMUNITY_ONBOARDING_INGREDIENTS,
} from '@freeside/ordering-protocol';

import { OrderOrchestrator } from '../orchestrator.js';
import { InMemoryOrderStore, type NewOrder } from '../store.js';
import { ConfigCapabilityResolver, type CapabilityConfig } from '../resolver.js';
import type { TriagePorts } from '../triage-ports.js';
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

function communityOrder(orderId = 'ord_co_reprobe'): NewOrder {
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

type DynamicTriage = TriagePorts & {
  _advance: (next: { sonar?: 'pending' | 'in_progress' | 'complete'; worldSlug?: string }) => void;
};

function makeDynamicTriage(): DynamicTriage {
  let sonarStatus: 'pending' | 'in_progress' | 'complete' = 'pending';
  let worldsSlug: string | undefined;

  const triage: DynamicTriage = {
    sonar: {
      probe: vi.fn(async () => sonarStatus),
    },
    score: {
      probe: vi.fn(async () => 'complete' as const),
    },
    worlds: {
      probe: vi.fn(async () => (worldsSlug ? ('complete' as const) : ('pending' as const))),
      probeDetail: vi.fn(async () => ({
        status: worldsSlug ? ('complete' as const) : ('pending' as const),
        world_slug: worldsSlug,
      })),
    },
    discord: {
      probe: vi.fn(async () => 'optional' as const),
    },
    shadow: {
      probe: vi.fn(async () => 'blocked' as const),
    },
    metadata: {
      probe: vi.fn(async () => 'complete' as const),
    },
    _advance: (next) => {
      if (next.sonar) sonarStatus = next.sonar;
      if (next.worldSlug !== undefined) worldsSlug = next.worldSlug;
    },
  };

  return triage;
}

describe('CommunityOnboardingOrchestrator producing re-probe', () => {
  it('re-probes ingredients in producing and patches world_slug from worlds lookup', async () => {
    const store = new InMemoryOrderStore({ now: () => 1_700_000_000 });
    const triage = makeDynamicTriage();
    const orchestrator = new OrderOrchestrator({
      store,
      resolver: new ConfigCapabilityResolver(TRIAGE_CAPS),
      audit: new NoopAudit(),
      communities: () => undefined,
      cta: CTA,
      now: () => 1_700_000_000_000,
      triage,
    });

    await store.placeOrder(communityOrder(), {
      subject: ORDER_LIFECYCLE_SUBJECTS.placed,
      payload: { order_id: 'ord_co_reprobe', product: 'community-onboarding', inputs_digest: 'b'.repeat(64) },
    });
    await orchestrator.process('ord_co_reprobe');

    let record = await store.get('ord_co_reprobe');
    expect(record?.state).toBe('producing');
    expect(record?.ingredients?.sonar).toBe('pending');

    triage._advance({ sonar: 'complete', worldSlug: 'pythenians' });
    (triage.shadow.probe as ReturnType<typeof vi.fn>).mockResolvedValue('complete');

    await orchestrator.process('ord_co_reprobe');
    record = await store.get('ord_co_reprobe');
    expect(record?.ingredients?.sonar).toBe('complete');
    expect(record?.fulfillment?.world_slug).toBe('pythenians');
    expect(record?.state).toBe('fulfilled');
  });
});

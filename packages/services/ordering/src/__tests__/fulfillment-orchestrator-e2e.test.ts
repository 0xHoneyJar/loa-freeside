import { describe, it, expect } from 'vitest';
import {
  ORDER_LIFECYCLE_SUBJECTS,
  INITIAL_COMMUNITY_ONBOARDING_INGREDIENTS,
  type IngredientStatus,
} from '@freeside/ordering-protocol';

import {
  FulfillmentOrchestrator,
  FulfillmentOrchestratorWorker,
  type FulfillmentDispatchPort,
} from '../fulfillment-orchestrator.js';
import { CommunityOnboardingOrchestrator } from '../community-onboarding-orchestrator.js';
import { InMemoryOrderStore, type NewOrder } from '../store.js';
import { ConfigCapabilityResolver, type CapabilityConfig } from '../resolver.js';
import { ORCHESTRATOR_SUBJECTS } from '../orchestrator-events.js';
import type { DispatchResult, HttpEnqueuePayload } from '../http-building-probes.js';
import type { TriagePorts, WorldsProbeDetail } from '../triage-ports.js';

const CONTRACT = '0x' + 'a'.repeat(40);
const SLUG = 'azuki';
const NOW_MS = 1_700_000_000_000;

const TRIAGE_CAPS: CapabilityConfig = {
  'collection-index': { building: 'sonar-api', endpoint: 'http://sonar.internal' },
  'community-register': { building: 'score-api', endpoint: 'http://score.internal' },
  'world-manifest': { building: 'worlds-api', endpoint: 'http://worlds.internal' },
};

/**
 * Dev-fallback double: each ingredient reads `pending` until its idempotent write lands,
 * then `indexed`/`registered`/`manifested` → `complete`. shadow_preview is producer-less
 * (`optional`), discord optional. Mirrors the three APIs' dev behavior for the CI gate.
 */
class DevFallback implements TriagePorts, FulfillmentDispatchPort {
  private readonly done = new Set<string>();

  private status(key: string): IngredientStatus {
    return this.done.has(key) ? 'complete' : 'pending';
  }

  sonar = { probe: async () => this.status('sonar') };
  score = { probe: async () => this.status('score') };
  worlds = {
    probe: async () => this.status('worlds_manifest'),
    probeDetail: async (): Promise<WorldsProbeDetail> => ({
      status: this.status('worlds_manifest'),
      world_slug: this.done.has('worlds_manifest') ? SLUG : undefined,
    }),
  };
  discord = { probe: async () => 'optional' as const };
  shadow = { probe: async () => 'optional' as const };
  metadata = { probe: async () => this.status('metadata_snapshot') };

  async ingestSonar(_p: HttpEnqueuePayload): Promise<DispatchResult> {
    this.done.add('sonar');
    return { ok: true };
  }
  async registerScore(_p: HttpEnqueuePayload): Promise<DispatchResult> {
    this.done.add('score');
    return { ok: true, world_slug: SLUG };
  }
  async manifestWorlds(_p: HttpEnqueuePayload): Promise<DispatchResult> {
    this.done.add('worlds_manifest');
    return { ok: true, world_slug: SLUG };
  }
  async snapshotMetadata(_p: HttpEnqueuePayload): Promise<DispatchResult> {
    this.done.add('metadata_snapshot');
    return { ok: true };
  }
}

function order(orderId = 'ord_e2e'): NewOrder {
  return {
    order_id: orderId,
    product: 'community-onboarding',
    placed_by: 'dashboard_onboarding',
    inputs: {
      chain_id: '1',
      contract_address: CONTRACT,
      contact_email: 'cm@example.com',
      community_name: 'Azuki',
      source: 'dashboard_onboarding',
    },
    placed_at_unix: 1_700_000_000,
    inputs_digest: 'c'.repeat(64),
    ingredients: { ...INITIAL_COMMUNITY_ONBOARDING_INGREDIENTS },
  };
}

describe('fulfillment-orchestrator E2E (task 23.6)', () => {
  it('drives a freshly placed order to fulfilled with zero manual steps', async () => {
    const store = new InMemoryOrderStore({ now: () => 1_700_000_000 });
    const fallback = new DevFallback();
    const onboarding = new CommunityOnboardingOrchestrator({
      store,
      resolver: new ConfigCapabilityResolver(TRIAGE_CAPS),
      triage: fallback,
      now: () => NOW_MS,
    });
    const orchestrator = new FulfillmentOrchestrator({
      store,
      triage: fallback,
      onboarding,
      dispatch: fallback,
      github: null, // no GITHUB_TOKEN in CI — escalation stays event-only
      now: () => NOW_MS,
      tokenLabel: 'orchestrator-token',
    });
    const worker = new FulfillmentOrchestratorWorker(orchestrator, store, 60_000);

    await store.placeOrder(order(), {
      subject: ORDER_LIFECYCLE_SUBJECTS.placed,
      payload: { order_id: 'ord_e2e', product: 'community-onboarding', inputs_digest: 'c'.repeat(64) },
    });
    expect((await store.get('ord_e2e'))?.state).toBe('placed');

    // Bounded drive — never a hand advance. Tick 1 dispatches, tick 2 sees complete + fulfills.
    for (let i = 0; i < 5 && (await store.get('ord_e2e'))?.state !== 'fulfilled'; i++) {
      await worker.tick();
    }

    const record = await store.get('ord_e2e');
    expect(record?.state).toBe('fulfilled');
    expect(record?.fulfillment?.world_slug).toBe(SLUG);
    expect(record?.fulfillment?.contact_email).toBe('cm@example.com');

    // The audit trail proves the orchestrator (not a human operator) drove every advance.
    // Assert non-empty first — an empty audit trail must not vacuously pass the loop below.
    expect(record?.operator_audit?.length ?? 0).toBeGreaterThan(0);
    for (const entry of record?.operator_audit ?? []) {
      expect(entry.caller_note).toBe('fulfillment-orchestrator');
    }

    const subjects = (await store.pendingOutbox()).map((e) => e.subject);
    expect(subjects).toContain(ORCHESTRATOR_SUBJECTS.probe);
    expect(subjects).toContain(ORCHESTRATOR_SUBJECTS.dispatch);
    expect(subjects).toContain(ORCHESTRATOR_SUBJECTS.advance);
    expect(subjects).toContain(ORDER_LIFECYCLE_SUBJECTS.fulfilled);
  });

  it('re-dispatch after a simulated crash is idempotent (rely on upstream keys)', async () => {
    const store = new InMemoryOrderStore({ now: () => 1_700_000_000 });
    const fallback = new DevFallback();
    const onboarding = new CommunityOnboardingOrchestrator({
      store,
      resolver: new ConfigCapabilityResolver(TRIAGE_CAPS),
      triage: fallback,
      now: () => NOW_MS,
    });
    const makeOrchestrator = () =>
      new FulfillmentOrchestrator({
        store,
        triage: fallback,
        onboarding,
        dispatch: fallback,
        github: null,
        now: () => NOW_MS,
        tokenLabel: 'orchestrator-token',
      });

    await store.placeOrder(order('ord_crash'), {
      subject: ORDER_LIFECYCLE_SUBJECTS.placed,
      payload: { order_id: 'ord_crash', product: 'community-onboarding', inputs_digest: 'c'.repeat(64) },
    });

    // First worker instance dies after one tick (dispatch fired, not yet fulfilled).
    await makeOrchestrator().processOrder('ord_crash');
    expect((await store.get('ord_crash'))?.state).toBe('producing');

    // A FRESH orchestrator (lost in-memory state) resumes and still reaches fulfilled.
    const resumed = makeOrchestrator();
    for (let i = 0; i < 5 && (await store.get('ord_crash'))?.state !== 'fulfilled'; i++) {
      await resumed.processOrder('ord_crash');
    }
    expect((await store.get('ord_crash'))?.state).toBe('fulfilled');
    expect((await store.get('ord_crash'))?.fulfillment?.world_slug).toBe(SLUG);
  });
});

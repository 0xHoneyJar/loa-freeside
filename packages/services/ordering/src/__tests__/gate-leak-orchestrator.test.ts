import { describe, expect, it } from 'vitest';
import {
  ORDER_GATE_LEAK_INPUT_SUBJECT,
  ORDER_LIFECYCLE_SUBJECTS,
  type IngredientStatus,
} from '@freeside/ordering-protocol';
import { projectPublicJourney, type Cta } from '@freeside/shadow-audit-protocol';
import type { AuditServiceResult } from '@freeside/shadow-audit-service';

import type { AuditPort } from '../audit-acl.js';
import { createIntakeApp } from '../intake.js';
import type {
  GateLeakIndexPort,
  GateLeakPort,
  GateLeakSubmission,
  GateLeakSubmissionResult,
} from '../gate-leak-ports.js';
import { RecordingPublisher } from '../lifecycle-publisher.js';
import { OrderOrchestrator } from '../orchestrator.js';
import { ConfigCapabilityResolver, type CapabilityConfig } from '../resolver.js';
import { InMemoryOrderStore, type NewOrder } from '../store.js';

const CONTRACT = '0x' + 'a'.repeat(40);
const CTA: Cta = { product: 'https://example.test/enhance', conversation: 'https://example.test/talk' };
const CAPS: CapabilityConfig = {
  'subject-resolution': { building: 'ordering-service', endpoint: 'local://subject' },
  'collection-index': { building: 'sonar-api', endpoint: 'http://sonar.internal' },
  'shadow-gate-leak': { building: 'shadow-audit-api', endpoint: 'http://shadow.internal' },
};

class NoopAudit implements AuditPort {
  async invoke(): Promise<AuditServiceResult> {
    throw new Error('audit ACL must not run for gate-leak');
  }
}

class FakeIndex implements GateLeakIndexPort {
  status: IngredientStatus = 'pending';
  readonly enqueues: Array<{ orderId: string; chainId: string; contract: string }> = [];

  async probe(): Promise<IngredientStatus> {
    return this.status;
  }

  async enqueue(input: { orderId: string; chainId: string; contract: string }): Promise<boolean> {
    this.enqueues.push(input);
    return true;
  }
}

/** Mirrors the Shadow adapter's subject/input cache while retaining separate journey tokens. */
class CachingGateLeak implements GateLeakPort {
  readonly submissions: GateLeakSubmission[] = [];
  readonly resumes: Array<{ runId: string; accessStartedAt: string }> = [];
  readonly runTokens = new Map<string, string>();
  readonly cache = new Set<string>();
  computeCalls = 0;

  async submit(input: GateLeakSubmission): Promise<GateLeakSubmissionResult> {
    this.submissions.push(input);
    const runId = `gate_${input.journey_token}`;
    this.runTokens.set(runId, input.journey_token);
    if (!input.access_started_at) {
      return {
        journey: projectPublicJourney({
          run_id: runId,
          journey_token: input.journey_token,
          subject: { chain_id: input.chain, contract_address: input.contract.toLowerCase() },
          outcome: 'needs_input',
        }),
      };
    }
    return this.deliver(runId, input.journey_token, input.chain, input.contract, input.access_started_at);
  }

  async resume(runId: string, accessStartedAt: string): Promise<GateLeakSubmissionResult> {
    this.resumes.push({ runId, accessStartedAt });
    const journeyToken = this.runTokens.get(runId);
    if (!journeyToken) throw new Error('unknown fake journey');
    return this.deliver(runId, journeyToken, '1', CONTRACT, accessStartedAt);
  }

  private deliver(
    runId: string,
    journeyToken: string,
    chain: string,
    contract: string,
    accessStartedAt: string,
  ): GateLeakSubmissionResult {
    const key = `${chain}/${contract.toLowerCase()}/${accessStartedAt}`;
    if (!this.cache.has(key)) {
      this.cache.add(key);
      this.computeCalls++;
    }
    return {
      journey: projectPublicJourney({
        run_id: runId,
        journey_token: journeyToken,
        subject: { chain_id: chain, contract_address: contract.toLowerCase() },
        outcome: 'delivered_e1',
      }),
      report: { run_id: runId, stale_access_risk_band: 'elevated' },
    };
  }
}

function order(orderId: string, accessStartedAt?: string): NewOrder {
  return {
    order_id: orderId,
    product: 'gate-leak',
    placed_by: 'anonymous',
    inputs: {
      chain_id: '1',
      contract_address: CONTRACT,
      source: 'public_gate_leak',
      ...(accessStartedAt ? { access_started_at: accessStartedAt } : {}),
    },
    placed_at_unix: 1_700_000_000,
    inputs_digest: `${orderId}:immutable`,
  };
}

function harness(opts: { publish?: boolean } = {}) {
  const store = new InMemoryOrderStore({ now: () => 1_700_000_000 });
  const index = new FakeIndex();
  const gateLeak = new CachingGateLeak();
  const publisher = opts.publish ? new RecordingPublisher() : undefined;
  const orchestrator = new OrderOrchestrator({
    store,
    resolver: new ConfigCapabilityResolver(CAPS),
    audit: new NoopAudit(),
    communities: () => undefined,
    cta: CTA,
    now: () => 1_700_000_000_000,
    gateLeak,
    gateLeakIndex: index,
    lifecyclePublisher: publisher,
  });
  return { store, index, gateLeak, publisher, orchestrator };
}

async function place(store: InMemoryOrderStore, next: NewOrder): Promise<void> {
  await store.placeOrder(next, {
    subject: ORDER_LIFECYCLE_SUBJECTS.placed,
    payload: { order_id: next.order_id, product: next.product, inputs_digest: next.inputs_digest },
  });
}

describe('GateLeakOrchestrator', () => {
  it('moves unknown subject -> indexing -> delivered and publishes each durable lifecycle event', async () => {
    const { store, index, gateLeak, publisher, orchestrator } = harness({ publish: true });
    await place(store, order('journey-1', '2026-06-22'));

    await orchestrator.process('journey-1');
    expect((await store.get('journey-1'))?.state).toBe('producing');
    expect((await store.get('journey-1'))?.output).toMatchObject({ journey: { status: { state: 'indexing' } } });
    expect(index.enqueues).toHaveLength(1);
    expect(await store.pendingOutbox()).toHaveLength(0);

    index.status = 'complete';
    await orchestrator.process('journey-1');
    expect((await store.get('journey-1'))?.state).toBe('fulfilled');
    expect(gateLeak.computeCalls).toBe(1);
    expect(publisher?.published.map((event) => event.subject)).toEqual([
      ORDER_LIFECYCLE_SUBJECTS.placed,
      ORDER_LIFECYCLE_SUBJECTS.routing,
      ORDER_LIFECYCLE_SUBJECTS.producing,
      ORDER_LIFECYCLE_SUBJECTS.producing,
      ORDER_LIFECYCLE_SUBJECTS.producing,
      ORDER_LIFECYCLE_SUBJECTS.fulfilled,
    ]);
  });

  it('dedupes shared indexing/compute work while preserving two demand journeys', async () => {
    const { store, index, gateLeak, orchestrator } = harness();
    await place(store, order('journey-a', '2026-06-22'));
    await place(store, order('journey-b', '2026-06-22'));

    await orchestrator.process('journey-a');
    await orchestrator.process('journey-b');
    expect(index.enqueues.map((call) => call.orderId)).toEqual(['journey-a']);

    index.status = 'complete';
    await orchestrator.process('journey-a');
    await orchestrator.process('journey-b');
    expect(gateLeak.submissions.map((call) => call.journey_token)).toEqual(['journey-a', 'journey-b']);
    expect(gateLeak.computeCalls).toBe(1);
    expect((await store.get('journey-a'))?.state).toBe('fulfilled');
    expect((await store.get('journey-b'))?.state).toBe('fulfilled');
  });

  it('keeps needs_input resumable on the same immutable anonymous order', async () => {
    const { store, index, gateLeak, orchestrator } = harness();
    index.status = 'complete';
    const app = createIntakeApp({
      store,
      now: () => 1_700_000_000_000,
      orchestrator,
    });
    const placed = await app.request('/v1/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        product: 'gate-leak',
        placed_by: 'anonymous',
        inputs: { chain_id: '1', contract_address: CONTRACT, source: 'public_gate_leak' },
      }),
    });
    expect(placed.status).toBe(200);
    const { order_id: orderId } = (await placed.json()) as { order_id: string };
    const original = await store.get(orderId);

    await orchestrator.process(orderId);
    expect((await store.get(orderId))?.state).toBe('producing');
    expect((await store.get(orderId))?.output).toMatchObject({ journey: { status: { state: 'needs_input' } } });

    const resumed = await app.request(`/v1/orders/${orderId}/resume-gate-leak`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ access_started_at: '2026-06-22' }),
    });
    expect(resumed.status).toBe(200);
    expect((await resumed.json()) as unknown).toMatchObject({ state: 'fulfilled' });
    expect(gateLeak.resumes).toEqual([{ runId: `gate_${orderId}`, accessStartedAt: '2026-06-22' }]);
    const completed = await store.get(orderId);
    expect(completed?.inputs).toEqual(original?.inputs);
    expect(completed?.inputs_digest).toBe(original?.inputs_digest);
    expect(await store.getGateLeakInput(orderId)).toMatchObject({ value: '2026-06-22' });
    expect((await store.pendingOutbox()).filter((e) => e.subject === ORDER_GATE_LEAK_INPUT_SUBJECT)).toHaveLength(1);

    const replay = await app.request(`/v1/orders/${orderId}/resume-gate-leak`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ access_started_at: '2026-06-22' }),
    });
    expect(replay.status).toBe(200);
    expect((await store.pendingOutbox()).filter((e) => e.subject === ORDER_GATE_LEAK_INPUT_SUBJECT)).toHaveLength(1);

    const conflict = await app.request(`/v1/orders/${orderId}/resume-gate-leak`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ access_started_at: '2026-06-23' }),
    });
    expect(conflict.status).toBe(409);
  });
});

import { describe, it, expect } from 'vitest';
import type { AuditRequest, AuditServiceResult } from '@freeside/shadow-audit-service';
import type { AuditOutput, Cta } from '@freeside/shadow-audit-protocol';
import { ORDER_LIFECYCLE_SUBJECTS } from '@freeside/ordering-protocol';
import { OrderOrchestrator } from '../orchestrator.js';
import { InMemoryOrderStore, type NewOrder } from '../store.js';
import { ConfigCapabilityResolver, type CapabilityConfig } from '../resolver.js';
import { RecordingPublisher, publishOutbox } from '../lifecycle-publisher.js';
import type { AuditPort, OperatedCommunityRegistry } from '../audit-acl.js';

const CONTRACT = '0x' + '2'.repeat(40);
const OWNER = '0x' + '1'.repeat(40);
const CTA: Cta = { product: 'https://example.test/audit', conversation: 'https://example.test/talk' };

// The orchestrator treats the audit output as OPAQUE (EVANS: the Ordering context does not know the
// audit aggregate's shape). A representative object stands in; the audit's output validity is the
// audit package's own concern.
const FAKE_OUTPUT = { run_id: 'run_test', mode: 'dogfood-full', note: 'opaque-to-ordering' } as unknown as AuditOutput;
const OK_RESULT: AuditServiceResult = { ok: true, output: FAKE_OUTPUT, uncertain: false, uncertainReasons: [], unmatchedRoleHolders: 0 };

class FakeAudit implements AuditPort {
  calls = 0;
  lastReq: AuditRequest | undefined;
  constructor(private readonly behavior: () => Promise<AuditServiceResult> = async () => OK_RESULT) {}
  async invoke(req: AuditRequest): Promise<AuditServiceResult> {
    this.calls++;
    this.lastReq = req;
    return this.behavior();
  }
}

const FULL_CAPS: CapabilityConfig = {
  'member-graph': { building: 'shadow-mode-api', endpoint: 'http://shadow-mode-api.internal' },
  roles: { building: 'worlds-api', endpoint: 'http://worlds-api.internal' },
};

const communities: OperatedCommunityRegistry = (contract) =>
  contract === CONTRACT ? { name: 'Test DAO', owner_wallet: OWNER } : undefined;

function newOrder(orderId = 'ord_1', contract = CONTRACT): NewOrder {
  return {
    order_id: orderId,
    product: 'access-risk-audit',
    placed_by: 'operator:test',
    inputs: { chain: 'ethereum', contract, snapshot_date: '2026-06-01', threshold: 1 },
    placed_at_unix: 1_700_000_000,
    inputs_digest: 'a'.repeat(64),
  };
}

function harness(opts: { caps?: CapabilityConfig; audit?: FakeAudit } = {}) {
  const store = new InMemoryOrderStore({ now: () => 1_700_000_000 });
  const audit = opts.audit ?? new FakeAudit();
  const orchestrator = new OrderOrchestrator({
    store,
    resolver: new ConfigCapabilityResolver(opts.caps ?? FULL_CAPS),
    audit,
    communities,
    cta: CTA,
    now: () => 1_700_000_000_000,
  });
  return { store, audit, orchestrator };
}

async function place(store: InMemoryOrderStore, orderId = 'ord_1', contract = CONTRACT) {
  await store.placeOrder(newOrder(orderId, contract), {
    subject: ORDER_LIFECYCLE_SUBJECTS.placed,
    payload: { order_id: orderId, product: 'access-risk-audit', inputs_digest: 'a'.repeat(64) },
  });
}

describe('OrderOrchestrator', () => {
  it('drives a placed order to fulfilled with the audit output aggregate (S1-T5)', async () => {
    const { store, audit, orchestrator } = harness();
    await place(store);
    const result = await orchestrator.process('ord_1');

    expect(result.success).toBe(true);
    const record = await store.get('ord_1');
    expect(record?.state).toBe('fulfilled');
    expect(record?.output).toBe(FAKE_OUTPUT);
    expect(record?.result_ref).toBe('ord_1');
    expect(record?.output_digest).toMatch(/^[0-9a-f]{64}$/);
    expect(audit.calls).toBe(1);

    // the ACL mapped the generic order onto a real audit AuditRequest (not theater)
    expect(audit.lastReq?.order.source.contract_address).toBe(CONTRACT);
    expect(audit.lastReq?.order.community.owner_wallet).toBe(OWNER);
    expect(audit.lastReq?.snapshotDate).toBe('2026-06-01');
    expect(audit.lastReq?.includeRecords).toBe(false); // anon MVP

    // the full lifecycle landed in the durable outbox, in order
    const subjects = (await store.pendingOutbox()).map((e) => e.subject);
    expect(subjects).toEqual([
      ORDER_LIFECYCLE_SUBJECTS.placed,
      ORDER_LIFECYCLE_SUBJECTS.routing,
      ORDER_LIFECYCLE_SUBJECTS.producing,
      ORDER_LIFECYCLE_SUBJECTS.producing,
      ORDER_LIFECYCLE_SUBJECTS.fulfilled,
    ]);
  });

  it('is idempotent: the same placed delivered twice runs the audit ONCE (H-3)', async () => {
    const { store, audit, orchestrator } = harness();
    await place(store);
    await orchestrator.process('ord_1'); // first delivery → fulfilled
    await orchestrator.process('ord_1'); // redelivery of the same placed
    expect(audit.calls).toBe(1);
    expect((await store.get('ord_1'))?.state).toBe('fulfilled');
  });

  it('fails closed when a required capability cannot be resolved — audit never runs (G-6)', async () => {
    const audit = new FakeAudit();
    const { store, orchestrator } = harness({ caps: { 'member-graph': FULL_CAPS['member-graph']! }, audit });
    await place(store); // roles capability is unmapped
    const result = await orchestrator.process('ord_1');

    expect(result.success).toBe(true); // terminal failure is an ack, not a retry
    const record = await store.get('ord_1');
    expect(record?.state).toBe('failed');
    expect(record?.refusal?.code).toBe('capability-unresolved');
    expect(audit.calls).toBe(0);
    const subjects = (await store.pendingOutbox()).map((e) => e.subject);
    expect(subjects).toContain(ORDER_LIFECYCLE_SUBJECTS.failed);
  });

  it('settles failed on a non-retryable audit refusal, with a SANITIZED reason (M-8)', async () => {
    const audit = new FakeAudit(async () => ({
      ok: false,
      refusal: { code: 'unindexed-contract', reason: 'INTERNAL: sonar index miss for 0x…', retryable: false },
    }));
    const { store, orchestrator } = harness({ audit });
    await place(store);
    const result = await orchestrator.process('ord_1');

    expect(result.success).toBe(true);
    const record = await store.get('ord_1');
    expect(record?.state).toBe('failed');
    expect(record?.refusal?.code).toBe('unindexed-contract');
    // the audit's raw internal reason must NOT leak onto the public failed event
    expect(record?.refusal?.reason).not.toContain('INTERNAL');
    expect(record?.refusal?.reason).toBe('the contract is not indexed for ownership reconstruction');
  });

  it('NAKs (does not settle failed) on a RETRYABLE audit refusal', async () => {
    const audit = new FakeAudit(async () => ({
      ok: false,
      refusal: { code: 'rate-limited', reason: 'slow down', retryable: true },
    }));
    const { store, orchestrator } = harness({ audit });
    await place(store);
    const result = await orchestrator.process('ord_1');

    expect(result.success).toBe(false);
    expect(result.retryable).toBe(true);
    // a retryable refusal is NOT terminal — the order is left mid-flight for redelivery
    expect((await store.get('ord_1'))?.state).toBe('producing');
  });

  it('publishes the terminal event from durable stored state after a kill-before-publish (H-4)', async () => {
    const { store, orchestrator } = harness();
    await place(store);
    await orchestrator.process('ord_1'); // persists fulfilled + enqueues events, but NOTHING is published yet

    // simulate: the process died after persist, before publishing — the terminal event is durable
    const pendingBefore = (await store.pendingOutbox()).map((e) => e.subject);
    expect(pendingBefore).toContain(ORDER_LIFECYCLE_SUBJECTS.fulfilled);

    // "restart": a fresh publisher drains the outbox from stored state
    const publisher = new RecordingPublisher();
    const count = await publishOutbox(store, publisher);
    expect(count).toBeGreaterThan(0);
    expect(publisher.published.map((p) => p.subject)).toContain(ORDER_LIFECYCLE_SUBJECTS.fulfilled);
    // everything is now published — nothing pending
    expect(await store.pendingOutbox()).toHaveLength(0);
  });
});

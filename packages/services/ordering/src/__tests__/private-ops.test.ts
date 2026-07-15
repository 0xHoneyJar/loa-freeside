import { describe, it, expect } from 'vitest';
import type { AuditServiceResult } from '@freeside/shadow-audit-service';
import type { Cta } from '@freeside/shadow-audit-protocol';
import { ORDER_LIFECYCLE_SUBJECTS } from '@freeside/ordering-protocol';
import { OrderOrchestrator } from '../orchestrator.js';
import { InMemoryOrderStore, type NewOrder } from '../store.js';
import { ConfigCapabilityResolver } from '../resolver.js';
import { RecordingPrivateOps } from '../private-ops.js';
import type { AuditPort, OperatedCommunityRegistry } from '../audit-acl.js';

const CONTRACT = '0x' + '2'.repeat(40);
const CTA: Cta = { product: 'https://x/p', conversation: 'https://x/c' };
const communities: OperatedCommunityRegistry = (c) =>
  c === CONTRACT ? { name: 'DAO', owner_wallet: '0x' + '1'.repeat(40) } : undefined;

const REFUSING_AUDIT: AuditPort = {
  invoke: async (): Promise<AuditServiceResult> => ({
    ok: false,
    refusal: { code: 'unindexed-contract', reason: 'INTERNAL: sonar index miss at block 0xdeadbeef', retryable: false },
  }),
};

function newOrder(): NewOrder {
  return {
    order_id: 'ord_ops',
    product: 'access-risk-audit',
    placed_by: 'op',
    inputs: { chain: '1', contract: CONTRACT, snapshot_date: '2026-06-01', threshold: 1 },
    placed_at_unix: 1_700_000_000,
    inputs_digest: 'a'.repeat(64),
  };
}

describe('private ops channel (S4-T3 / M-8)', () => {
  it('a refusal emits sanitized public failed.v1 AND the full raw cause privately', async () => {
    const store = new InMemoryOrderStore({ now: () => 1_700_000_000 });
    const ops = new RecordingPrivateOps();
    const orchestrator = new OrderOrchestrator({
      store,
      resolver: new ConfigCapabilityResolver({
        'member-graph': { building: 'm', endpoint: 'http://m' },
        roles: { building: 'w', endpoint: 'http://w' },
      }),
      audit: REFUSING_AUDIT,
      communities,
      cta: CTA,
      now: () => 1_700_000_000_000,
      opsChannel: ops,
    });

    await store.placeOrder(newOrder(), {
      subject: ORDER_LIFECYCLE_SUBJECTS.placed,
      payload: { order_id: 'ord_ops', product: 'access-risk-audit', inputs_digest: 'a'.repeat(64) },
    });
    await orchestrator.process('ord_ops');

    // public: sanitized — raw internal cause must NOT appear
    const record = await store.get('ord_ops');
    expect(record?.state).toBe('failed');
    expect(record?.refusal?.reason).not.toContain('INTERNAL');
    expect(record?.refusal?.code).toBe('unindexed-contract');

    // private: the FULL raw cause + correlation id
    expect(ops.events).toHaveLength(1);
    expect(ops.events[0]?.order_id).toBe('ord_ops');
    expect(ops.events[0]?.correlation_id).toBe('ord_ops');
    expect(ops.events[0]?.cause.reason).toBe('INTERNAL: sonar index miss at block 0xdeadbeef');
    expect(ops.events[0]?.cause.retryable).toBe(false);
  });

  it('without an ops channel, only the sanitized public event is emitted (back-compat)', async () => {
    const store = new InMemoryOrderStore({ now: () => 1_700_000_000 });
    const orchestrator = new OrderOrchestrator({
      store,
      resolver: new ConfigCapabilityResolver({
        'member-graph': { building: 'm', endpoint: 'http://m' },
        roles: { building: 'w', endpoint: 'http://w' },
      }),
      audit: REFUSING_AUDIT,
      communities,
      cta: CTA,
      now: () => 1_700_000_000_000,
      // no opsChannel
    });
    await store.placeOrder(newOrder(), {
      subject: ORDER_LIFECYCLE_SUBJECTS.placed,
      payload: { order_id: 'ord_ops', product: 'access-risk-audit', inputs_digest: 'a'.repeat(64) },
    });
    const r = await orchestrator.process('ord_ops');
    expect(r.success).toBe(true);
    expect((await store.get('ord_ops'))?.state).toBe('failed');
  });
});

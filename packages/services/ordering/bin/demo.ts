/**
 * Local order-system DEMO (sprint S2 — the /simstim target).
 *
 * Wires the full place→track loop IN-PROCESS so you can open a browser, place an order, and
 * watch it advance placed→routing→producing→fulfilled with a rendered aggregate:
 *
 *   pnpm --dir packages/services/ordering exec tsx bin/demo.ts   # then open http://localhost:8090
 *
 * DEMO-ONLY wiring (clearly NOT production):
 *  - `DemoAuditAdapter` returns sample audit data — the real path is `DeclaredLocalAuditAdapter`
 *    (runAudit) with concrete sonar/score deps, wired at deploy (SDD §13 M-10).
 *  - `onPlaced` drives the orchestrator in-process — the real path is the NATS consumer off `placed`.
 *  - any contract resolves to a demo community — real uses a configured operated-community registry.
 */
import { serve } from '@hono/node-server';
import { AuditOutputSchema, type AuditOutput, type Cta } from '@freeside/shadow-audit-protocol';
import type { AuditRequest, AuditServiceResult } from '@freeside/shadow-audit-service';
import {
  InMemoryOrderStore,
  OrderOrchestrator,
  ConfigCapabilityResolver,
  createFrontendApp,
  publishOutbox,
  RecordingPublisher,
  type AuditPort,
} from '../src/index.js';

const CTA: Cta = {
  product: 'https://freeside.example/audit',
  conversation: 'https://freeside.example/talk',
};

// A schema-valid sample audit output (validated at construction so the demo can't drift from the contract).
const SAMPLE_OUTPUT: AuditOutput = AuditOutputSchema.parse({
  run_id: 'demo-run',
  mode: 'dogfood-full',
  inputs_hash: '0'.repeat(64),
  aggregate: {
    holder_turnover: 0.18,
    sold_lapsed: { kind: 'exact', value: 12 },
    newly_eligible: { kind: 'exact', value: 7 },
    stale_access: { kind: 'exact', value: 9 },
    whale_concentration: 0.34,
    stale_access_risk_band: 'elevated',
    // A demo community we can actually SEE: 8 role-holders unresolved, 92% coverage ⇒ confident.
    // (Below the real service's 50% floor it would REFUSE outright rather than render an aggregate.)
    unmatched_role_holders: { kind: 'exact', value: 8 },
    role_coverage: 0.92,
    coverage_uncertain: false,
  },
  cta: CTA,
});

class DemoAuditAdapter implements AuditPort {
  async invoke(_req: AuditRequest): Promise<AuditServiceResult> {
    return { ok: true, output: SAMPLE_OUTPUT, uncertain: false, uncertainReasons: [], unmatchedRoleHolders: 0 };
  }
}

const store = new InMemoryOrderStore();
const publisher = new RecordingPublisher();
const orchestrator = new OrderOrchestrator({
  store,
  resolver: new ConfigCapabilityResolver({
    'member-graph': { building: 'shadow-mode-api', endpoint: 'http://shadow-mode-api.demo' },
    roles: { building: 'worlds-api', endpoint: 'http://worlds-api.demo' },
  }),
  audit: new DemoAuditAdapter(),
  communities: (contract) => ({ name: `Demo community for ${contract.slice(0, 8)}…`, owner_wallet: '0x' + '1'.repeat(40) }),
  cta: CTA,
  now: () => Date.now(),
});

const app = createFrontendApp({
  store,
  now: () => Date.now(),
  // demo driver: advance the order in-process, then drain the outbox (the NATS consumer's job in prod)
  onPlaced: (orderId) => {
    void orchestrator.process(orderId).then(() => publishOutbox(store, publisher));
  },
});

const port = Number(process.env.PORT ?? 8090);
serve({ fetch: app.fetch, port });
// eslint-disable-next-line no-console
console.log(`order-system demo on http://localhost:${port}`);

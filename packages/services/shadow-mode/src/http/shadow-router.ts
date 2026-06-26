/**
 * Hono router for shadow-mode-api (SDD §10). Mirrors the shadow-audit router.
 *
 * `POST /events` calls `verifyProducer` (the fail-closed trust boundary) BEFORE
 * `ingest`; a rejection short-circuits to 401 and writes no observation. The
 * envelope is Zod-validated (400 on malformed). All other routes are read-only
 * projections.
 */

import { Hono } from 'hono';
import { ShadowEventSchema } from '@freeside/shadow-mode-protocol';
import type { ShadowLedger } from '../shadow-ledger.js';
import type { IProducerPolicy } from '../ports/producer-policy.js';
import { buildAccessAuditReport } from '../access-audit.js';

export interface ShadowRouterDeps {
  ledger: ShadowLedger;
  policy: IProducerPolicy;
}

export function createShadowRouter({ ledger, policy }: ShadowRouterDeps): Hono {
  const app = new Hono();

  app.get('/health', (c) => c.json({ ok: true, service: 'shadow-mode-api' }));

  app.post('/events', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = ShadowEventSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'invalid_envelope', issues: parsed.error.issues }, 400);
    }
    const event = parsed.data;

    const verdict = policy.verifyProducer({
      source: event.source,
      name: event.name,
      communityId: event.community_id,
    });
    if (!verdict.ok) {
      return c.json({ error: 'unauthorized', reason: verdict.reason }, 401);
    }

    return c.json(ledger.ingest(event), 202);
  });

  app.get('/communities/:id/member-graph', (c) =>
    c.json(ledger.getMemberGraph(c.req.param('id'))),
  );

  app.get('/communities/:id/unresolved', (c) =>
    c.json({ subjects: ledger.getUnresolved(c.req.param('id')) }),
  );

  app.get('/communities/:id/shadow/divergences', (c) =>
    c.json({ divergences: ledger.getDivergences(c.req.param('id')) }),
  );

  app.post('/communities/:id/reports/access-audit', (c) => {
    const id = c.req.param('id');
    return c.json(buildAccessAuditReport(id, ledger.getMemberGraph(id)), 201);
  });

  return app;
}

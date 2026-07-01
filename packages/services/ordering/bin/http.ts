/**
 * order-intake composition root — deployable HTTP edge for internal demo + dashboard consumer.
 */
import { serve } from '@hono/node-server';

import { createIntakeApp } from '../src/intake.js';
import { createOrderingComposition, serviceTokenFromEnv } from '../src/composition.js';
import { ReProbeWorker } from '../src/reprobe-worker.js';

const { store, orchestrator, enqueue } = await createOrderingComposition();

const serviceToken = serviceTokenFromEnv();

const app = createIntakeApp({
  store,
  now: () => Date.now(),
  onPlaced: (orderId) => {
    void orchestrator.process(orderId);
  },
  orchestrator,
  serviceToken,
});

app.get('/healthz', (c) =>
  c.json({
    ok: true,
    service: 'ordering-service',
    store: process.env.DATABASE_URL ? 'postgres' : 'memory',
    kitchen_enqueue: Boolean(enqueue),
  }),
);

if (process.env.ENABLE_REPROBE === 'true') {
  const worker = new ReProbeWorker(store, orchestrator);
  worker.start();
}

const port = Number(process.env.PORT ?? 8090);
serve({ fetch: app.fetch, port });
// eslint-disable-next-line no-console
console.log(`ordering-service listening on :${port}`);

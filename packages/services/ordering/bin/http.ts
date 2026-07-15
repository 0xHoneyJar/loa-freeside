/**
 * order-intake composition root — deployable HTTP edge for internal demo + dashboard consumer.
 */
import { serve } from '@hono/node-server';

import { createIntakeApp } from '../src/intake.js';
import {
  createOrderingComposition,
  serviceTokenFromEnv,
  serviceTokenLabelFromEnv,
  writeRoutePostureFromEnv,
} from '../src/composition.js';
import { ReProbeWorker } from '../src/reprobe-worker.js';

const { store, orchestrator, enqueue, gateLeakReady } = await createOrderingComposition();

const serviceToken = serviceTokenFromEnv();
const writeRoutes = writeRoutePostureFromEnv();

// FR-10a fail-closed: in a deployed environment with no SERVICE_TOKEN, the write routes
// (advance-ingredient, reprobe) are never mounted. Reads + /healthz stay available.
const mountWrites = writeRoutes !== 'disabled_no_token';
if (!mountWrites) {
  // eslint-disable-next-line no-console
  console.error(
    '[ordering-service] SERVICE_TOKEN is unset in a deployed environment — write routes are DISABLED (fail-closed, FR-10a). Set SERVICE_TOKEN to enable advance-ingredient/reprobe.',
  );
}

const app = createIntakeApp({
  store,
  now: () => Date.now(),
  onPlaced: (orderId) => {
    void orchestrator.process(orderId).catch((error: unknown) => {
      // eslint-disable-next-line no-console
      console.error(
        '[ordering-service] order process failed:',
        orderId,
        error instanceof Error ? error.message : error,
      );
    });
  },
  orchestrator: mountWrites ? orchestrator : undefined,
  serviceToken,
  serviceTokenLabel: serviceTokenLabelFromEnv(),
  gateLeakEnabled: gateLeakReady,
  healthz: {
    store: process.env.DATABASE_URL ? 'postgres' : 'memory',
    kitchen_enqueue: Boolean(enqueue),
    gate_leak: gateLeakReady ? 'ready' : 'disabled_or_partial',
    write_routes: writeRoutes,
  },
});

if (process.env.ENABLE_REPROBE === 'true' || gateLeakReady) {
  const worker = new ReProbeWorker(store, orchestrator);
  worker.start();
}

const port = Number(process.env.PORT ?? 8090);
serve({ fetch: app.fetch, port });
// eslint-disable-next-line no-console
console.log(`ordering-service listening on :${port} (write_routes=${writeRoutes})`);

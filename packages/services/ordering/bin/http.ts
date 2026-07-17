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
import { createCatalogResolveProbePort } from '../src/catalog-resolve-probe.js';
import { mountCollectionResolutionRoutes } from '../src/resolution-http.js';
import { mountCollectionReportRoutes } from '../src/collection-report-http.js';
import { createResolutionStore } from '../src/resolution-store-factory.js';
import { CollectionResolutionService } from '../src/resolution-service.js';
import { sonarResolveProbeFromEnv } from '../src/sonar-resolve-probe-client.js';
import { PostgresOrderStore } from '../src/store-postgres.js';

const { store, orchestrator, enqueue } = await createOrderingComposition();

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

const resolutionStore = await createResolutionStore({
  orderStore: store instanceof PostgresOrderStore ? store : undefined,
});
// COLLECTION_RESOLVE_PROBE_MODE=catalog forces the local catalog even when
// SONAR_* URLs are set (kitchen image lag / token mismatch). Default: http when
// configured, else catalog.
const probeModeOverride = process.env.COLLECTION_RESOLVE_PROBE_MODE?.trim().toLowerCase();
const httpSonarProbe =
  probeModeOverride === 'catalog' ? undefined : sonarResolveProbeFromEnv();
const sonarProbe = httpSonarProbe ?? createCatalogResolveProbePort();
const resolutionProbeMode = httpSonarProbe ? 'http' : 'catalog';const resolutionService = new CollectionResolutionService({
  store: resolutionStore,
  sonar: sonarProbe,
});

const app = createIntakeApp({
  store,
  now: () => Date.now(),
  onPlaced: (orderId) => {
    void orchestrator.process(orderId);
  },
  orchestrator: mountWrites ? orchestrator : undefined,
  serviceToken,
  serviceTokenLabel: serviceTokenLabelFromEnv(),
  resolutionService,
  resolutionStore,
  healthz: {
    store: process.env.DATABASE_URL ? 'postgres' : 'memory',
    kitchen_enqueue: Boolean(enqueue),
    write_routes: writeRoutes,
    collection_resolutions: true,
    collection_reports: true,
    resolve_probe: resolutionProbeMode,
  },
});

// CR-006: mount create/confirm/refresh. Token posture matches write routes —
// when SERVICE_TOKEN is set, Bearer is required; open_dev allows tokenless.
mountCollectionResolutionRoutes(app, {
  store: resolutionStore,
  sonar: sonarProbe,
  service: resolutionService,
  serviceToken: writeRoutes === 'token' ? serviceToken : undefined,
});

// CR-206: authenticated collection-report list/detail projections.
mountCollectionReportRoutes(app, {
  store,
  resolutionStore,
  serviceToken: writeRoutes === 'token' ? serviceToken : undefined,
});

if (process.env.ENABLE_REPROBE === 'true') {
  const worker = new ReProbeWorker(store, orchestrator);
  worker.start();
}

const port = Number(process.env.PORT ?? 8090);
serve({ fetch: app.fetch, port });
// eslint-disable-next-line no-console
console.log(
  `ordering-service listening on :${port} (write_routes=${writeRoutes}, resolve_probe=${resolutionProbeMode})`,
);
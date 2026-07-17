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
import { mountReportAttentionRoutes } from '../src/report-attention-http.js';
import { createResolutionStore } from '../src/resolution-store-factory.js';
import { CollectionResolutionService } from '../src/resolution-service.js';
import { sonarResolveProbeFromEnv } from '../src/sonar-resolve-probe-client.js';
import { PostgresOrderStore } from '../src/store-postgres.js';
import { InMemoryReportAttentionStore } from '../src/report-attention-store.js';
import { PostgresReportAttentionStore } from '../src/report-attention-store-postgres.js';
import {
  createFixturePublicAuthorizationService,
} from '../src/public-authorization-service.js';
import { DEFAULT_BASELINE_FIXTURE } from '../src/public-authorization-projections.js';
import { InMemoryCapabilityDemandStore } from '../src/capability-demand-store.js';
import { mountCapabilityDemandRoutes } from '../src/capability-demand-http.js';
import {
  publicAuthPostureFromEnv,
  serviceTokenForPublicAuthMounts,
} from '../src/public-auth-posture.js';

const { store, orchestrator, enqueue } = await createOrderingComposition();

const serviceToken = serviceTokenFromEnv();
const writeRoutes = writeRoutePostureFromEnv();
const publicAuthPosture = publicAuthPostureFromEnv();

// FR-10a fail-closed: in a deployed environment with no SERVICE_TOKEN, the write routes
// (advance-ingredient, reprobe) are never mounted. Reads + /healthz stay available.
const mountWrites = writeRoutes !== 'disabled_no_token';
if (!mountWrites) {
  // eslint-disable-next-line no-console
  console.error(
    '[ordering-service] SERVICE_TOKEN is unset in a deployed environment — write routes are DISABLED (fail-closed, FR-10a). Set SERVICE_TOKEN to enable advance-ingredient/reprobe.',
  );
}

// CR-007A: never silently wire fixture ACL in deployed envs (BB review #496).
const publicAuth = publicAuthPosture.allowFixture
  ? createFixturePublicAuthorizationService(DEFAULT_BASELINE_FIXTURE)
  : undefined;
if (!publicAuth) {
  // eslint-disable-next-line no-console
  console.error(
    `[ordering-service] public authorization DISABLED (${publicAuthPosture.mode}` +
      `${publicAuthPosture.reason ? `: ${publicAuthPosture.reason}` : ''}). ` +
      'Set PUBLIC_AUTH_MODE=fixture and PUBLIC_AUTH_FIXTURE_WAIVER=t0_t1 for lab-only, or wait for CR-007B identity projections.',
  );
}
const publicAuthToken = serviceTokenForPublicAuthMounts(writeRoutes, serviceToken);
if (publicAuthToken.kind === 'refuse') {
  // eslint-disable-next-line no-console
  console.error(
    '[ordering-service] public-auth mounts REFUSED — deployed without SERVICE_TOKEN (FR-10a parity).',
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
const resolutionProbeMode = httpSonarProbe ? 'http' : 'catalog';
const resolutionService = new CollectionResolutionService({
  store: resolutionStore,
  sonar: sonarProbe,
});

const capabilityDemandStore = new InMemoryCapabilityDemandStore();
const mountPublicAuthRoutes =
  publicAuth !== undefined && publicAuthToken.kind !== 'refuse';
const publicAuthServiceToken =
  publicAuthToken.kind === 'token' ? publicAuthToken.token : undefined;

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
  publicAuth: mountPublicAuthRoutes ? publicAuth : undefined,
  healthz: {
    store: process.env.DATABASE_URL ? 'postgres' : 'memory',
    kitchen_enqueue: Boolean(enqueue),
    write_routes: writeRoutes,
    collection_resolutions: true,
    collection_reports: mountPublicAuthRoutes,
    report_attention: true,
    capability_demands: {
      enabled: mountPublicAuthRoutes,
      store: 'memory',
    },
    public_authorization: {
      mode: publicAuthPosture.mode,
      wired: mountPublicAuthRoutes,
      reason: publicAuthPosture.reason,
    },
    resolve_probe: resolutionProbeMode,
  },
});

const attentionStore =
  store instanceof PostgresOrderStore
    ? new PostgresReportAttentionStore(store.getPool())
    : new InMemoryReportAttentionStore();

// CR-006: mount create/confirm/refresh. When public-auth is refused/disabled,
// mount without auth so probe/read paths stay available; mutable ACL paths
// inside the mount fail closed if auth is required by the handler.
mountCollectionResolutionRoutes(app, {
  store: resolutionStore,
  sonar: sonarProbe,
  service: resolutionService,
  serviceToken: publicAuthServiceToken,
  auth: mountPublicAuthRoutes ? publicAuth : undefined,
});

// CR-206: authenticated collection-report list/detail — require wired public auth.
if (mountPublicAuthRoutes && publicAuth) {
  mountCollectionReportRoutes(app, {
    store,
    resolutionStore,
    attentionStore,
    serviceToken: publicAuthServiceToken,
    auth: publicAuth,
  });

  // CR-007A: capability-demand authorization contract (CR-208 extends lifecycle).
  mountCapabilityDemandRoutes(app, {
    store: capabilityDemandStore,
    auth: publicAuth,
    serviceToken: publicAuthServiceToken,
    now: () => Date.now(),
  });
}

// CR-305: idempotent mark-seen for report attention.
mountReportAttentionRoutes(app, {
  store,
  attentionStore,
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
  `ordering-service listening on :${port} (write_routes=${writeRoutes}, resolve_probe=${resolutionProbeMode}, public_auth=${publicAuthPosture.mode}/wired=${mountPublicAuthRoutes})`,
);
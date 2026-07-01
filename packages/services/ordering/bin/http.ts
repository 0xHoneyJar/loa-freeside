/**
 * order-intake composition root — deployable HTTP edge for internal demo + dashboard consumer.
 *
 * Wires intake + CommunityOnboardingOrchestrator in-process (NATS consumer is prod hardening).
 * Dashboard: ORDERING_SERVICE_URL → POST/GET /v1/orders, advance-ingredient for operator triage.
 */
import { serve } from '@hono/node-server';
import type { Cta } from '@freeside/shadow-audit-protocol';
import type { AuditServiceResult } from '@freeside/shadow-audit-service';
import {
  ConfigCapabilityResolver,
  createIntakeApp,
  InMemoryOrderStore,
  OrderOrchestrator,
  StubTriagePorts,
  type AuditPort,
  type CapabilityConfig,
} from '../src/index.js';

class NoopAudit implements AuditPort {
  async invoke(): Promise<AuditServiceResult> {
    throw new Error('audit port unused for community-onboarding intake');
  }
}

function triageCapabilityConfig(): CapabilityConfig {
  return {
    'collection-index': {
      building: 'sonar-api',
      endpoint: process.env.SONAR_API_URL?.trim() || 'http://sonar.internal',
    },
    'community-register': {
      building: 'score-api',
      endpoint: process.env.SCORE_API_URL?.trim() || 'http://score.internal',
    },
    'world-manifest': {
      building: 'worlds-api',
      endpoint: process.env.WORLDS_API_URL?.trim() || 'http://worlds.internal',
    },
  };
}

function ctaFromEnv(): Cta {
  const product = process.env.CTA_PRODUCT?.trim() || 'https://freeside.app';
  const conversation = process.env.CTA_CONVERSATION?.trim() || 'https://freeside.app';
  return { product, conversation };
}

const store = new InMemoryOrderStore();
const orchestrator = new OrderOrchestrator({
  store,
  resolver: new ConfigCapabilityResolver(triageCapabilityConfig()),
  audit: new NoopAudit(),
  communities: () => undefined,
  cta: ctaFromEnv(),
  now: () => Date.now(),
  triage: new StubTriagePorts(),
});

const serviceToken = process.env.SERVICE_TOKEN?.trim() || process.env.ORDERING_SERVICE_TOKEN?.trim();

const app = createIntakeApp({
  store,
  now: () => Date.now(),
  onPlaced: (orderId) => {
    void orchestrator.process(orderId);
  },
  orchestrator,
  serviceToken: serviceToken || undefined,
});

app.get('/healthz', (c) => c.json({ ok: true, service: 'ordering-service' }));

const port = Number(process.env.PORT ?? 8090);
serve({ fetch: app.fetch, port });
// eslint-disable-next-line no-console
console.log(`ordering-service listening on :${port}`);

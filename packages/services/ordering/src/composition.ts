import type { Cta } from '@freeside/shadow-audit-protocol';
import type { AuditServiceResult } from '@freeside/shadow-audit-service';

import {
  ConfigCapabilityResolver,
  type CapabilityConfig,
} from './resolver.js';
import { OrderOrchestrator } from './orchestrator.js';
import type { AuditPort } from './audit-acl.js';
import type { OrderStore } from './store.js';
import { createGitHubIssuePort } from './github-issue-port.js';
import { IngredientEnqueueService } from './ingredient-enqueue.js';
import { createKitchenTriagePorts, KitchenTriagePorts } from './kitchen-triage-ports.js';
import { createOrderStore } from './store-factory.js';

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

export function ctaFromEnv(): Cta {
  const product = process.env.CTA_PRODUCT?.trim() || 'https://freeside.app';
  const conversation = process.env.CTA_CONVERSATION?.trim() || 'https://freeside.app';
  return { product, conversation };
}

export interface OrderingComposition {
  store: OrderStore;
  orchestrator: OrderOrchestrator;
  enqueue: IngredientEnqueueService | undefined;
}

export async function createOrderingComposition(): Promise<OrderingComposition> {
  const store = await createOrderStore();
  const triage = createKitchenTriagePorts();
  const httpProbes = triage instanceof KitchenTriagePorts ? triage.httpProbes : null;
  const github = createGitHubIssuePort();
  const enqueue = github || httpProbes ? new IngredientEnqueueService(store, github, httpProbes) : undefined;

  const orchestrator = new OrderOrchestrator({
    store,
    resolver: new ConfigCapabilityResolver(triageCapabilityConfig()),
    audit: new NoopAudit(),
    communities: () => undefined,
    cta: ctaFromEnv(),
    now: () => Date.now(),
    triage,
    enqueue,
  });

  return { store, orchestrator, enqueue };
}

export function serviceTokenFromEnv(): string | undefined {
  const token = process.env.SERVICE_TOKEN?.trim() || process.env.ORDERING_SERVICE_TOKEN?.trim();
  return token || undefined;
}

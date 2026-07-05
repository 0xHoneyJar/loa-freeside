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
import { FulfillmentOrchestrator, FulfillmentOrchestratorWorker } from './fulfillment-orchestrator.js';

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
      endpoint: process.env.SCORE_API_URL?.trim() || 'https://score.0xhoneyjar.xyz',
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

export function orchestratorEnabled(): boolean {
  return process.env.ORCHESTRATOR_ENABLED?.trim() === 'true';
}

/**
 * Wire the sibling fulfillment-orchestrator worker (SDD §4.1, D-1). Reuses the intake
 * composition's store + triage + in-process advance path; sources idempotent dispatch from
 * the HTTP probes and escalation from the GitHub port (both null-safe for CI/dev).
 */
export async function createFulfillmentOrchestratorWorker(): Promise<FulfillmentOrchestratorWorker> {
  const { store, orchestrator } = await createOrderingComposition();
  const triage = createKitchenTriagePorts();
  const dispatch = triage instanceof KitchenTriagePorts ? triage.httpProbes : null;
  const discordHealth = triage instanceof KitchenTriagePorts ? triage.discordHealth : undefined;

  const fulfillment = new FulfillmentOrchestrator({
    store,
    triage,
    onboarding: orchestrator.communityOnboarding,
    dispatch,
    github: createGitHubIssuePort(),
    now: () => Date.now(),
    tokenLabel: serviceTokenLabelFromEnv(),
    discordHealth,
  });

  return new FulfillmentOrchestratorWorker(fulfillment, store);
}

export function serviceTokenFromEnv(): string | undefined {
  const token = process.env.SERVICE_TOKEN?.trim() || process.env.ORDERING_SERVICE_TOKEN?.trim();
  return token || undefined;
}

/** Write-route posture (SDD D4/D8 — FR-10a fail-closed). */
export type WriteRoutePosture = 'open_dev' | 'token' | 'disabled_no_token';

export interface WriteRoutePostureEnv {
  serviceToken?: string;
  railwayEnvironment?: string;
  nodeEnv?: string;
}

/**
 * D8 auth matrix, one row per (deployed?, token?) combination:
 *
 * | env        | token | posture             | write routes |
 * |------------|-------|---------------------|--------------|
 * | local/dev  | unset | `open_dev`          | mounted, tokenless (in-memory convenience) |
 * | local/dev  | set   | `token`             | mounted, Bearer required |
 * | deployed   | unset | `disabled_no_token` | NOT mounted (fail-closed, FR-10a) |
 * | deployed   | set   | `token`             | mounted, Bearer required |
 *
 * "Deployed" marker: RAILWAY_ENVIRONMENT set OR NODE_ENV=production. GET routes and
 * /healthz stay open in EVERY row by design (registry doctor probes tokenless).
 */
export function resolveWriteRoutePosture(env: WriteRoutePostureEnv): WriteRoutePosture {
  const deployed = Boolean(env.railwayEnvironment?.trim()) || env.nodeEnv === 'production';
  if (env.serviceToken) return 'token';
  return deployed ? 'disabled_no_token' : 'open_dev';
}

export function writeRoutePostureFromEnv(): WriteRoutePosture {
  return resolveWriteRoutePosture({
    serviceToken: serviceTokenFromEnv(),
    railwayEnvironment: process.env.RAILWAY_ENVIRONMENT,
    nodeEnv: process.env.NODE_ENV,
  });
}

/** Label naming the write credential — recorded as audit actor identity (NFR-8b). */
export function serviceTokenLabelFromEnv(): string {
  return process.env.SERVICE_TOKEN_LABEL?.trim() || 'ordering-service-token';
}

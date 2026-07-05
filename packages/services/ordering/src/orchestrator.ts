import type { Cta } from '@freeside/shadow-audit-protocol';
import { isTerminal } from './order-state.js';
import type { OrderStore } from './store.js';
import { type CapabilityResolver } from './resolver.js';
import { type AuditPort, type OperatedCommunityRegistry } from './audit-acl.js';
import type { PrivateOpsPublisher } from './private-ops.js';
import { AccessRiskAuditOrchestrator } from './access-risk-audit-orchestrator.js';
import { CommunityOnboardingOrchestrator, type CommunityOnboardingOrchestratorDeps } from './community-onboarding-orchestrator.js';
import type { TriagePorts } from './triage-ports.js';
import { StubTriagePorts } from './triage-ports.js';
import type { IngredientEnqueueService } from './ingredient-enqueue.js';

/**
 * The thin orchestrator (SDD §6) — dispatches by product to preset-specific handlers.
 *
 * `process(order_id)` drives a `placed` order toward a terminal state, emitting lifecycle
 * events into the durable outbox as it goes (the publisher drains them separately — H-4, no
 * dual-write). It is idempotent + resumable under at-least-once delivery.
 */
export interface ProcessResult {
  success: boolean;
  retryable?: boolean;
  error?: Error;
}

export interface OrchestratorDeps {
  store: OrderStore;
  resolver: CapabilityResolver;
  audit: AuditPort;
  communities: OperatedCommunityRegistry;
  cta: Cta;
  /** Injected clock, unix MILLIseconds (matches BaseNatsConsumer's `now`). */
  now: () => number;
  /** Preset #2 ingredient probes — defaults to stub (operator advance MVP). */
  triage?: TriagePorts;
  /** Kitchen V1 — GitHub issue fan-out per ingredient. */
  enqueue?: IngredientEnqueueService;
  /** Optional private ops channel (SDD §13 M-8). */
  opsChannel?: PrivateOpsPublisher;
  /** Discord channel-health port — the advanceIngredient gate (T-2/FR-1) needs it on
   *  EVERY CommunityOnboardingOrchestrator instance, intake included, or the choke
   *  point has teeth only on the worker path. */
  discordHealth?: CommunityOnboardingOrchestratorDeps['discordHealth'];
}

export class OrderOrchestrator {
  private readonly accessRiskAudit: AccessRiskAuditOrchestrator;
  readonly communityOnboarding: CommunityOnboardingOrchestrator;

  constructor(private readonly deps: OrchestratorDeps) {
    const shared = {
      store: deps.store,
      resolver: deps.resolver,
      now: deps.now,
      opsChannel: deps.opsChannel,
    };
    this.accessRiskAudit = new AccessRiskAuditOrchestrator({
      ...shared,
      audit: deps.audit,
      communities: deps.communities,
      cta: deps.cta,
    });
    this.communityOnboarding = new CommunityOnboardingOrchestrator({
      ...shared,
      triage: deps.triage ?? new StubTriagePorts(),
      enqueue: deps.enqueue,
      discordHealth: deps.discordHealth,
    });
  }

  async process(orderId: string): Promise<ProcessResult> {
    const record = await this.deps.store.get(orderId);
    if (!record) {
      return { success: false, retryable: true, error: new Error(`order not persisted: ${orderId}`) };
    }
    if (isTerminal(record.state)) return { success: true };

    if (record.product === 'community-onboarding') {
      return this.communityOnboarding.process(orderId, record);
    }
    return this.accessRiskAudit.process(orderId, record);
  }
}

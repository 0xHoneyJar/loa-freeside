/**
 * @freeside/ordering-service
 *
 * The Ordering bounded context's runtime (EVANS): intake + thin orchestrator over a durable
 * order-state store with idempotency (H-3) and a transactional outbox (H-4). Product-agnostic
 * core; the audit ACL is the one place the generic order meets the sealed shadow-audit Order.
 */

export {
  ORDER_STATES,
  type OrderState,
  isTerminal,
  canTransition,
  assertTransition,
  IllegalTransitionError,
} from './order-state.js';

export { canonicalJson, sha256Hex, digestOf } from './digest.js';

export {
  type OutboxEvent,
  type OutboxEntry,
  type NewOrder,
  type OrderRecord,
  type OrderPatch,
  type TransitionOpts,
  type OrderStore,
  OrderNotFoundError,
  type InMemoryOrderStoreOptions,
  InMemoryOrderStore,
} from './store.js';

export {
  type LifecyclePublisher,
  RecordingPublisher,
  publishOutbox,
} from './lifecycle-publisher.js';

export {
  type ResolvedEndpoint,
  type CapabilityResolver,
  CapabilityUnresolvedError,
  type CapabilityConfig,
  ConfigCapabilityResolver,
} from './resolver.js';

export {
  type AuditPort,
  type OperatedCommunity,
  type OperatedCommunityRegistry,
  type AuditAclOptions,
  type AclResult,
  buildAuditRequest,
  sanitizeRefusal,
} from './audit-acl.js';

export { DeclaredLocalAuditAdapter } from './declared-local-audit-adapter.js';

export { type ProcessResult, type OrchestratorDeps, OrderOrchestrator } from './orchestrator.js';

export {
  AccessRiskAuditOrchestrator,
  type AccessRiskAuditOrchestratorDeps,
} from './access-risk-audit-orchestrator.js';

export {
  CommunityOnboardingOrchestrator,
  type CommunityOnboardingOrchestratorDeps,
  canFulfillCommunityOnboarding,
} from './community-onboarding-orchestrator.js';

export { type TriagePorts, StubTriagePorts, type WorldsProbeDetail } from './triage-ports.js';

export { type IntakeDeps, createIntakeApp } from './intake.js';

export {
  type CommunityOnboardingOpsNotice,
  buildCommunityOnboardingOpsNotice,
  fireCommunityOnboardingOpsWebhook,
  fireCommunityOnboardingIssueLinks,
  opsWebhookUrl,
} from './order-ops-webhook.js';

export {
  type EnqueueIngredientKey,
  type IngredientJob,
  type OperatorAuditEntry,
  ingredientJobIdempotencyKey,
} from './kitchen-types.js';

export {
  type GitHubIssuePort,
  type GitHubIssueResult,
  RecordingGitHubIssuePort,
  FetchGitHubIssuePort,
  createGitHubIssuePort,
  repoForIngredient,
} from './github-issue-port.js';

export {
  IngredientEnqueueService,
  kitchenEnqueueEnabled,
  kitchenHttpEnqueueEnabled,
  fireEnqueue,
} from './ingredient-enqueue.js';

export { PostgresOrderStore } from './store-postgres.js';
export { createOrderStore } from './store-factory.js';
export { KitchenTriagePorts, createKitchenTriagePorts } from './kitchen-triage-ports.js';
export {
  HttpBuildingProbes,
  httpBuildingProbesFromEnv,
  type HttpBuildingProbesConfig,
  type HttpEnqueuePayload,
} from './http-building-probes.js';
export { normalizeContractAddress, normalizeChainId } from './contract-address.js';
export { ReProbeWorker, reprobeIntervalMs } from './reprobe-worker.js';
export { createOrderingComposition, serviceTokenFromEnv, ctaFromEnv } from './composition.js';

export { createFrontendApp } from './frontend.js';

export {
  type LoaWhereResult,
  type LoaWhereInvoker,
  LoaWhereCapabilityResolver,
  makeLoaWhereInvoker,
} from './loa-where-resolver.js';

export {
  type SignedDeclaration,
  type TrustPolicy,
  TrustViolationError,
  TrustRootedResolver,
} from './trust-rooted-resolver.js';

export { type CanonicalOrder, type SignedOrder, signOrder, verifyOrder } from './order-signer.js';

export {
  type OperatorAuthEnv,
  type NonceStore,
  InMemoryNonceStore,
  type IntakeAuditEntry,
  type IntakeAuthDeps,
  requireOperatorAuth,
} from './intake-auth.js';

export {
  type PrivateOpsEvent,
  type PrivateOpsPublisher,
  RecordingPrivateOps,
} from './private-ops.js';

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
export {
  resolvePublicAuthPosture,
  publicAuthPostureFromEnv,
  serviceTokenForPublicAuthMounts,
  isDeployedEnv,
} from './public-auth-posture.js';
export type { PublicAuthMode, PublicAuthPosture } from './public-auth-posture.js';

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

export {
  type ResolutionOperation,
  type IdempotencyRecord,
  type ResolutionStore,
  InMemoryResolutionStore,
} from './resolution-store.js';

export {
  type SonarResolveProbePort,
  type ResolutionServiceClock,
  type ResolutionIdGenerator,
  type CollectionResolutionServiceOptions,
  CollectionResolutionService,
} from './resolution-service.js';

export { PostgresResolutionStore } from './resolution-store-postgres.js';
export { createResolutionStore } from './resolution-store-factory.js';
export { mountCollectionResolutionRoutes } from './resolution-http.js';
export {
  PublicAuthorizationService,
  createFixturePublicAuthorizationService,
  type PublicAuthorizationProjections,
  type PublicAuthorizationProjectionPort,
} from './public-authorization-service.js';
export {
  FixturePublicAuthorizationProjectionPort,
  publicAuthFixtureFromEnv,
  DEFAULT_BASELINE_FIXTURE,
} from './public-authorization-projections.js';
export { mountCapabilityDemandRoutes } from './capability-demand-http.js';
export {
  OPEN_DEMAND_LIMIT_PER_SUBJECT,
  OPEN_DEMAND_LIMIT_PER_COMMUNITY,
  OPEN_DEMAND_TTL_MS,
  CAPABILITY_DEMAND_ATTENTION_KIND,
  CAPABILITY_DEMAND_SOURCE_KIND,
} from './capability-demand-constants.js';
export {
  buildCapabilityDemandSupportedIntent,
  stableCapabilityDemandIntentId,
  type CapabilityDemandAttentionIntent,
} from './capability-demand-intent.js';
export {
  buildTriageAggregate,
  mapSupportRequestUserStatus,
  toSupportRequestListItem,
  type CapabilityDemandTriageAggregate,
  type CapabilityDemandTriageBucket,
  type SupportRequestListItem,
  type SupportRequestUserStatus,
} from './capability-demand-projection.js';
export {
  InMemoryCapabilityDemandStore,
  toPublicCapabilityDemandProjection,
  type CapabilityDemandStore,
  type CapabilityDemandRecord,
  type CapabilityDemandState,
} from './capability-demand-store.js';
export {
  createHttpSonarResolveProbePort,
  sonarResolveProbeFromEnv,
} from './sonar-resolve-probe-client.js';
export { createCatalogResolveProbePort } from './catalog-resolve-probe.js';
export {
  InMemoryDependencyLedgerStore,
  type DependencyLedgerStore,
} from './dependency-ledger-store.js';
export {
  DependencyLedgerService,
  createFixtureDependencyLedgerService,
} from './dependency-ledger-service.js';
export { mountDependencyLedgerRoutes } from './dependency-ledger-http.js';
export {
  PUBLIC_PREP_CAPABILITIES,
  PUBLIC_PREP_LIMITS,
  LEASABLE_PUBLIC_WORK_STATES,
  isLeasablePublicWorkState,
  type PublicPrepCapability,
  type PublicPreparationWorkKeyMaterial,
  type SharedPreparationWorkRecord,
  type PreparationWorkItemRecord,
  type ReportWorkLinkRecord,
  type ReadinessEvidenceEnvelope,
} from './shared-preparation-types.js';
export {
  buildPublicWorkKeyMaterial,
  digestPublicWorkKey,
  deploymentSetDigest,
} from './shared-preparation-work-key.js';
export {
  InMemorySharedPreparationStore,
  SharedPreparationFencingError,
  SharedPreparationStateError,
  assertReadinessEvidenceQualified,
  type SharedPreparationStore,
  type JoinPublicWorkInput,
  type JoinPublicWorkResult,
} from './shared-preparation-store.js';
export {
  PostgresSharedPreparationStore,
} from './shared-preparation-store-postgres.js';
export {
  createSharedPreparationService,
  type SharedPreparationService,
} from './shared-preparation-service.js';

export {
  COLLECTION_PREP_POOL_CAPABILITY,
  REPORT_GENERATION_POOL_CAPABILITY,
  PUBLIC_PREP_WORKER_LEASE_MS,
  publicPrepWorkerEnabled,
  publicPrepWorkerIntervalMs,
} from './public-preparation-constants.js';
export { sonarCommandInboxKey, sonarPhysicalJobRef } from './public-preparation-dispatch-key.js';
export {
  InMemoryPublicPrepDispatchStore,
  type PublicPrepDispatchStore,
  type PrepDispatchRecord,
} from './public-preparation-dispatch-store.js';
export {
  FixturePublicPreparationSonarPort,
  type PublicPreparationSonarPort,
  type SonarPrepDispatchRequest,
  type SonarPrepDispatchResult,
} from './public-preparation-sonar-port.js';
export {
  PublicPreparationAdapter,
  type PublicPreparationAdapterDeps,
  type PublicPrepProcessResult,
} from './public-preparation-adapter.js';
export { PublicPreparationWorker } from './public-preparation-worker.js';
export {
  aggregateReadinessEvidence,
  buildReadinessEvidenceFromDeployments,
} from './public-preparation-evidence.js';

export {
  CAPACITY_LEDGER_KINDS,
  CAPACITY_RESERVATION_STATES,
  CapacityUnavailableError,
  AdmissionIdempotencyConflictError,
  type CapacityLedgerKind,
  type CapacityPoolRecord,
  type CapacityReservationRecord,
  type RecipeExpansionCertificate,
  type CapacityUnavailableReason,
} from './admission-capacity-types.js';
export {
  V1_MAX_RECIPE_NODES,
  DEFAULT_ADMISSION_RATE_LIMIT,
  DEFAULT_QUEUED_WORK_LIMIT,
  DEFAULT_ACTIVE_EXECUTION_LIMIT,
  ACTIVE_EXECUTION_LEASE_MS,
} from './admission-capacity-constants.js';
export {
  buildRecipeExpansionCertificate,
  fixtureGateLeakCertificate,
  assertCertificateAdmissible,
} from './recipe-expansion-certificate.js';
export {
  InMemoryAdmissionCapacityStore,
  type AdmissionCapacityStore,
  type AdmitOrderInput,
  type AdmitOrderResult,
} from './admission-capacity-store.js';
export { PostgresAdmissionCapacityStore } from './admission-capacity-store-postgres.js';
export {
  createAdmissionCapacityService,
  type AdmissionCapacityService,
} from './admission-capacity-service.js';

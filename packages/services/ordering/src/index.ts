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

export { type IntakeDeps, createIntakeApp } from './intake.js';

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

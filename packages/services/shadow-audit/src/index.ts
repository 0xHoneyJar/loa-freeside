/**
 * @freeside/shadow-audit-service
 *
 * Stateless audit compute for the Shadow Access Audit. Hexagonal: the service
 * declares ports (ownership/score/role sources) and the concrete adapters are
 * injected at the composition root (the gateway). No member data is persisted.
 */

export {
  resolveEligibility,
  classifyBand,
  type RequestedGating,
  type EligibilityResult,
} from './eligibility-resolver.js';
export {
  RoleSnapshotSchema,
  RoleSnapshotEntrySchema,
  SnapshotCollectionSchema,
  collectionKey,
  isSnapshotFresh,
  resolveRoles,
  type RoleSnapshot,
  type RoleSnapshotEntry,
  type SnapshotCollection,
  type RoleResolution,
} from './role-snapshot.js';
export {
  resolveMode,
  type ModeContext,
  type ModeResult,
} from './mode-resolver.js';
export {
  DEFAULT_K,
  kAnonCohort,
  holderTurnover,
  staleRiskBand,
} from './metrics.js';
export {
  runAudit,
  type Balances,
  type OwnershipSource,
  type WhaleSource,
  type RoleSource,
  type AuditRequest,
  type AuditDeps,
  type AuditServiceResult,
} from './audit-service.js';
export {
  RunEventSchema,
  ContactRecordSchema,
  ReactionSchema,
  CtaInteractionSchema,
  InMemoryEventStore,
  isRunWithinWindow,
  type RunEvent,
  type ContactRecord,
  type Reaction,
  type EventStore,
} from './event-store.js';
export {
  verifyAssociation,
  canonicalAuthMessage,
  InMemoryNonceStore,
  SignedAuthMessageSchema,
  type SignedAuthMessage,
  type AuthRequest,
  type AuthExpectations,
  type AuthResult,
  type RecoverSigner,
  type NonceStore,
  type CommunityOwnerCheck,
  type AssociationVerifierDeps,
} from './association-verifier.js';
export {
  FixedWindowRateLimiter,
  type RateLimiter,
  type ReconstructionBudget,
  type RateLimiterConfig,
  type RateDecision,
} from './rate-limiter.js';
export {
  PostgresFixedWindowRateLimiter,
  type PostgresFixedWindowRateLimiterConfig,
} from './postgres-rate-limiter.js';
export { createAuditRouter, type AuditRouterDeps } from './http/audit-router.js';
export {
  RoleSnapshotConflictError,
} from './role-store.js';
export {
  makeRepositoryRoleStore,
  PostgresRoleSnapshotRepository,
  connectPostgresRoleSnapshotRepository,
  type RoleSnapshotRecord,
  type RoleSnapshotRepository,
  type PostgresRoleSnapshotConnection,
} from './role-store-postgres.js';
export {
  comparisonArtifact,
  exportComparisonJson,
  exportComparisonCsv,
  ComparisonUnavailableError,
  type ComparisonArtifact,
} from './comparison-export.js';

export {
  computeDifferential,
  differentialEnabled,
  differentialLogLine,
  type DifferentialInput,
  type DifferentialResult,
  type DivergentWallet,
} from './differential.js';

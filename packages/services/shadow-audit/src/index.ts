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
  isSnapshotFresh,
  resolveRoles,
  type RoleSnapshot,
  type RoleSnapshotEntry,
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

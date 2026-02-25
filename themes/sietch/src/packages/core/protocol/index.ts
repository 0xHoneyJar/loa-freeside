/**
 * Commons Protocol — Arrakis Protocol Types — Barrel Export
 *
 * The Commons Protocol is a community-governed economic protocol for AI inference
 * with conservation invariants, conviction-gated access, and transparent
 * disagreement resolution.
 *
 * Re-exports arrakis-specific protocol types and extensions.
 * Canonical types should be imported directly from @0xhoneyjar/loa-hounfour.
 *
 * Extension modules:
 *   arrakis-arithmetic.ts  — Branded types + arrakis arithmetic helpers
 *   arrakis-compat.ts      — Protocol version negotiation + boundary normalization
 *   arrakis-conservation.ts — Conservation error taxonomy adapter
 *   graduation.ts          — Shadow-to-enforce graduation criteria (cycle-040)
 *   micro-usd-schema.ts    — Mode-aware Zod gateway schema (cycle-040)
 *
 * @module packages/core/protocol
 */

// Billing domain types (Freeside-local — distinct from canonical hounfour BillingEntry)
export type {
  AgentBillingConfig,
  CreditBalance,
  UsageRecord,
  BillingMode,
  EntityType,
  SourceType,
  EntryType,
  ProtocolEntryType,
  SystemConfigStatus,
  ParamSource,
  SystemConfig,
  ResolvedParam,
  ProposeOpts,
} from './billing-types.js';

export {
  ENTITY_TYPES,
  SOURCE_TYPES,
  ENTRY_TYPES,
  buildEntryTypeCheck,
  buildSourceTypeCheck,
} from './billing-types.js';

// Guard types (Freeside-local — distinct from canonical hounfour GuardResult)
export type {
  GuardResult,
  BillingGuardResponse,
} from './guard-types.js';

// State machine definitions (Freeside-local — distinct from canonical hounfour lifecycle machines)
export type {
  StateMachineDefinition,
  ReservationState,
  RevenueRuleState,
  PaymentState,
  SystemConfigState,
} from './state-machines.js';

export {
  RESERVATION_MACHINE,
  REVENUE_RULE_MACHINE,
  PAYMENT_MACHINE,
  SYSTEM_CONFIG_MACHINE,
  STATE_MACHINES,
  isValidTransition,
  isTerminal,
} from './state-machines.js';

// Arithmetic — re-export from arrakis extension module
export type {
  MicroUSD,
  BasisPoints,
  AccountId,
} from './arrakis-arithmetic.js';

export {
  microUSD,
  basisPoints,
  accountId,
  MICRO_USD_PER_DOLLAR,
  TOTAL_BPS,
  MAX_MICRO_USD,
  SafeArithmeticError,
  dollarsToMicro,
  microToDollarsDisplay,
  assertMicroUSD,
  addMicroUSD,
  subtractMicroUSD,
  multiplyBPS,
  divideWithFloor,
  microUsdSchema,
  microUsdWithCeilingSchema,
  serializeBigInt,
  bpsShare,
  assertBpsSum,
} from './arrakis-arithmetic.js';

// Conservation — re-export from arrakis extension module
export type {
  ConservationErrorCode,
  ReconciliationFailureCode,
  ConservationProperty,
  EnforcementMechanism,
  PropertyUniverse,
  PropertyKind,
} from './arrakis-conservation.js';



export {
  ConservationViolationError,
  getCanonicalProperties,
  getProperty,
  getPropertiesByEnforcement,
  CANONICAL_CONSERVATION_PROPERTIES,
} from './arrakis-conservation.js';

// ============================================================================
// Canonical hounfour types — imported from @0xhoneyjar/loa-hounfour v7.0.0
// Organized by sub-package domain (Sprint 322–324)
// ============================================================================

// --- Identity, Lifecycle & Trust (Sprint 322–323) ---
export type {
  AgentLifecycleState,
  AgentIdentity,
  TrustLevel as CanonicalTrustLevel,
  CapabilityScope,
  CapabilityScopedTrust,
} from '@0xhoneyjar/loa-hounfour';

export {
  AGENT_LIFECYCLE_STATES,
  AGENT_LIFECYCLE_TRANSITIONS,
  isValidTransition as isValidLifecycleTransition,
  TRUST_LEVELS,
  CAPABILITY_SCOPES,
  trustLevelIndex,
  trustLevelForScope,
  meetsThresholdForScope,
  effectiveTrustLevel,
  flatTrustToScoped,
  parseAgentIdentity,
} from '@0xhoneyjar/loa-hounfour';

// --- Events (Sprint 323) ---
export type {
  DomainEvent,
  DomainEventBatch,
  StreamEvent,
  StreamStart,
  StreamChunk,
  StreamToolCall,
  StreamUsage,
  StreamEnd,
  StreamError,
} from '@0xhoneyjar/loa-hounfour';

export {
  DomainEventSchema,
  DomainEventBatchSchema,
  isAgentEvent,
  isBillingEvent,
  isConversationEvent,
  isTransferEvent,
  isToolEvent,
  StreamEventSchema,
  STREAM_RECONNECT_HEADER,
} from '@0xhoneyjar/loa-hounfour';

// --- Discovery & Routing (Sprint 324) ---
export type {
  ProtocolDiscovery,
  RoutingPolicy,
  TaskType,
  PersonalityRouting,
} from '@0xhoneyjar/loa-hounfour';

export {
  ProtocolDiscoverySchema,
  buildDiscoveryDocument,
  RoutingPolicySchema,
  TaskTypeSchema,
  PersonalityRoutingSchema,
} from '@0xhoneyjar/loa-hounfour';

// --- Conversations (Sprint 324) ---
export type {
  Conversation,
  ConversationSealingPolicy,
  AccessPolicy,
  Message,
  MessageRole,
} from '@0xhoneyjar/loa-hounfour';

export {
  ConversationSchema,
  validateSealingPolicy,
  validateAccessPolicy,
  MessageSchema,
  MessageRoleSchema,
} from '@0xhoneyjar/loa-hounfour';

// --- Model (Sprint 323–324) ---
export type {
  CompletionRequest,
  CompletionResult,
  BudgetScope,
  PreferenceSignal,
} from '@0xhoneyjar/loa-hounfour/model';

// --- Economy: NftId (Sprint 323) ---
export type {
  NftId,
  ParsedNftId,
} from '@0xhoneyjar/loa-hounfour/economy';

export {
  parseNftId,
  formatNftId,
  isValidNftId,
  NFT_ID_PATTERN,
} from '@0xhoneyjar/loa-hounfour/economy';

// --- Economy: Escrow & Monetary Policy (Sprint 324) ---
export type {
  EscrowEntry,
  MonetaryPolicy,
  MintingPolicy,
} from '@0xhoneyjar/loa-hounfour/economy';

export {
  EscrowEntrySchema,
  ESCROW_TRANSITIONS,
  isValidEscrowTransition,
  MonetaryPolicySchema,
  MintingPolicySchema,
} from '@0xhoneyjar/loa-hounfour/economy';

// ============================================================================
// Canonical hounfour types — v7.1–v7.9 expansion (Sprint 344, cycle-039)
// Per SDD §3.3, exports map audit: grimoires/loa/a2a/v792-exports-map.md
// ============================================================================

// ─── Reputation & Trust (v7.1–v7.6) ────────────────────────────────────────
// evaluateAccessPolicy, isKnownReputationState, ReputationStateName are
// root-only exports (not on /governance subpath) per exports map audit §2.
export {
  evaluateAccessPolicy,
  type AccessPolicyContext,
  type AccessPolicyResult,
} from '@0xhoneyjar/loa-hounfour';

export {
  isKnownReputationState,
  type ReputationStateName,
} from '@0xhoneyjar/loa-hounfour';

// REPUTATION_STATES and REPUTATION_STATE_ORDER are available on both root
// and /governance. Use /governance for subpath alignment.
export {
  REPUTATION_STATES,
  REPUTATION_STATE_ORDER,
} from '@0xhoneyjar/loa-hounfour/governance';

export {
  ReputationScoreSchema,
  type ReputationScore,
} from '@0xhoneyjar/loa-hounfour/governance';

// ─── Event Sourcing & Replay (v7.3) ────────────────────────────────────────
// Root-only exports per exports map audit §2.
export {
  reconstructAggregateFromEvents,
  verifyAggregateConsistency,
  computeEventStreamHash,
  type ReconstructedAggregate,
  type ConsistencyReport,
} from '@0xhoneyjar/loa-hounfour';

export {
  computeCredentialPrior,
  isCredentialExpired,
  CREDENTIAL_CONFIDENCE_THRESHOLD,
} from '@0xhoneyjar/loa-hounfour';

// ─── Governance (v7.3–v7.7) ────────────────────────────────────────────────
export {
  SanctionSchema,
  type Sanction,
  SANCTION_SEVERITY_LEVELS,
  VIOLATION_TYPES,
  ESCALATION_RULES,
} from '@0xhoneyjar/loa-hounfour/governance';

export {
  DisputeRecordSchema,
  type DisputeRecord,
} from '@0xhoneyjar/loa-hounfour/governance';

export {
  ValidatedOutcomeSchema,
  type ValidatedOutcome,
} from '@0xhoneyjar/loa-hounfour/governance';

export {
  PerformanceRecordSchema,
  PerformanceOutcomeSchema,
  type PerformanceRecord,
  type PerformanceOutcome,
} from '@0xhoneyjar/loa-hounfour/governance';

export {
  ContributionRecordSchema,
  type ContributionRecord,
} from '@0xhoneyjar/loa-hounfour/governance';

// ─── Economy Extensions (v7.5–v7.9) ────────────────────────────────────────
// parseMicroUsd (strict boundary parser) is root-only per exports map audit §3.
// Note: parseMicroUSD (uppercase D, /economy) is a DIFFERENT function for pricing.
export {
  parseMicroUsd,
  type ParseMicroUsdResult,
} from '@0xhoneyjar/loa-hounfour';

// evaluateEconomicBoundary and evaluateFromBoundary are root-only exports.
export {
  evaluateEconomicBoundary,
  evaluateFromBoundary,
} from '@0xhoneyjar/loa-hounfour';

export {
  subtractMicroSigned,
  negateMicro,
  isNegativeMicro,
} from '@0xhoneyjar/loa-hounfour/economy';

export {
  StakePositionSchema,
  type StakePosition,
} from '@0xhoneyjar/loa-hounfour/economy';

export {
  CommonsDividendSchema,
  type CommonsDividend,
} from '@0xhoneyjar/loa-hounfour/economy';

export {
  MutualCreditSchema,
  type MutualCredit,
} from '@0xhoneyjar/loa-hounfour/economy';

export {
  TRANSFER_CHOREOGRAPHY,
  TRANSFER_INVARIANTS,
} from '@0xhoneyjar/loa-hounfour/economy';

// ─── Integrity Extensions (v6.0–v7.8) ──────────────────────────────────────
export {
  LivenessPropertySchema,
  CANONICAL_LIVENESS_PROPERTIES,
  type LivenessProperty,
} from '@0xhoneyjar/loa-hounfour/integrity';

// detectReservedNameCollisions is root-only per exports map audit §2.
export {
  detectReservedNameCollisions,
  type NameCollision,
} from '@0xhoneyjar/loa-hounfour';

// ============================================================================
// Canonical hounfour types — v7.10–v7.11 governance expansion (Sprint 353, cycle-041)
// Per SDD §3.1.1, all symbols verified via Task 1.2 export mapping table.
//
// ADR-001: Root Barrel Precedence
//   Governance types use Governance* prefix at barrel level to avoid collision
//   with the routing-policy TaskType/TaskTypeSchema already exported above.
//   Only aliased Governance* variants are exported — no unaliased governance
//   TaskType or ReputationEvent re-exported under their original names.
// ============================================================================

// ─── Task-Dimensional Reputation (v7.10) ───────────────────────────────────
// GovernanceTaskTypeSchema and GovernanceReputationEventSchema are already
// Governance*-prefixed at the hounfour root — import from root, not /governance.
export type {
  GovernanceTaskType,
  GovernanceReputationEvent,
} from '@0xhoneyjar/loa-hounfour';

export {
  GovernanceTaskTypeSchema,
  GovernanceReputationEventSchema,
} from '@0xhoneyjar/loa-hounfour';

// Governance-specific domain schemas (no naming collision — exported as-is)
export {
  TASK_TYPES as GovernanceTaskTypes,
  validateTaskCohortUniqueness,
  TaskTypeCohortSchema,
  QualitySignalEventSchema,
  TaskCompletedEventSchema,
  CredentialUpdateEventSchema,
  ScoringPathSchema,
  ScoringPathLogSchema,
} from '@0xhoneyjar/loa-hounfour/governance';

export type {
  TaskTypeCohort,
} from '@0xhoneyjar/loa-hounfour/governance';

// ─── Tamper-Evident Hash Chains (v7.11) ────────────────────────────────────
// computeScoringPathHash and SCORING_PATH_GENESIS_HASH are governance-subpath
// exports per Task 1.2 verification.
export {
  computeScoringPathHash,
  SCORING_PATH_GENESIS_HASH,
} from '@0xhoneyjar/loa-hounfour/governance';

// ─── Evaluation Geometry (v7.10–v7.11) ─────────────────────────────────────
// NativeEnforcement is type-only (no runtime export). Re-exported for
// type-level constraint evaluation geometry support.
export type {
  NativeEnforcement,
} from '@0xhoneyjar/loa-hounfour/constraints';

// ============================================================================
// Canonical hounfour types — v8.0.0 Commons Module (cycle-043)
// Governance substrate: conservation laws, audit trails, dynamic contracts,
// governed resources, enforcement SDK, error taxonomy.
// ============================================================================

// ─── Foundation Schemas ──────────────────────────────────────────────────────
export {
  InvariantSchema,
  type Invariant,
} from '@0xhoneyjar/loa-hounfour/commons';

export {
  ConservationLawSchema,
  type ConservationLaw,
} from '@0xhoneyjar/loa-hounfour/commons';

export {
  AuditEntrySchema,
  AuditTrailSchema,
  AUDIT_TRAIL_GENESIS_HASH,
  type AuditEntry,
  type AuditTrail,
} from '@0xhoneyjar/loa-hounfour/commons';

// State/Transition/StateMachineConfig aliased with Commons prefix to avoid
// collision with Freeside-local state-machines.js types (lines 53-69).
export {
  StateSchema as CommonsStateSchema,
  TransitionSchema as CommonsTransitionSchema,
  StateMachineConfigSchema as CommonsStateMachineConfigSchema,
} from '@0xhoneyjar/loa-hounfour/commons';

export type {
  State as CommonsState,
  Transition as CommonsTransition,
  StateMachineConfig as CommonsStateMachineConfig,
} from '@0xhoneyjar/loa-hounfour/commons';

export {
  GovernanceClassSchema,
  GOVERNED_RESOURCE_FIELDS,
  GovernanceMutationSchema,
  type GovernanceClass,
  type GovernanceMutation,
} from '@0xhoneyjar/loa-hounfour/commons';

// ─── Governed Resources ──────────────────────────────────────────────────────
export {
  GovernedCreditsSchema,
  type GovernedCredits,
} from '@0xhoneyjar/loa-hounfour/commons';

export {
  GovernedReputationSchema,
  type GovernedReputation,
} from '@0xhoneyjar/loa-hounfour/commons';

export {
  GovernedFreshnessSchema,
  type GovernedFreshness,
} from '@0xhoneyjar/loa-hounfour/commons';

// ─── Hash Chain Operations (ADR-006) ─────────────────────────────────────────
export {
  HashChainDiscontinuitySchema,
  type HashChainDiscontinuity,
} from '@0xhoneyjar/loa-hounfour/commons';

export {
  QuarantineStatusSchema,
  QuarantineRecordSchema,
  type QuarantineStatus,
  type QuarantineRecord,
} from '@0xhoneyjar/loa-hounfour/commons';

export {
  buildDomainTag,
  computeAuditEntryHash,
  verifyAuditTrailIntegrity,
  type AuditEntryHashInput,
  type AuditTrailVerificationResult,
} from '@0xhoneyjar/loa-hounfour/commons';

export {
  createCheckpoint,
  verifyCheckpointContinuity,
  pruneBeforeCheckpoint,
  type CheckpointResult,
} from '@0xhoneyjar/loa-hounfour/commons';

// ─── Dynamic Contracts (ADR-009) ─────────────────────────────────────────────
export {
  ProtocolCapabilitySchema,
  RateLimitTierSchema,
  ProtocolSurfaceSchema,
  DynamicContractSchema,
  type ProtocolCapability,
  type RateLimitTier,
  type ProtocolSurface,
  type DynamicContract,
} from '@0xhoneyjar/loa-hounfour/commons';

export {
  AssertionMethodSchema,
  ContractNegotiationSchema,
  type AssertionMethod,
  type ContractNegotiation,
} from '@0xhoneyjar/loa-hounfour/commons';

export {
  isNegotiationValid,
  computeNegotiationExpiry,
  type NegotiationValidityResult,
} from '@0xhoneyjar/loa-hounfour/commons';

export {
  verifyMonotonicExpansion,
  type MonotonicViolation,
  type MonotonicExpansionResult,
} from '@0xhoneyjar/loa-hounfour/commons';

// ─── Enforcement SDK (ADR-008) ───────────────────────────────────────────────
export {
  evaluateGovernanceMutation,
  type GovernanceMutationEvalResult,
} from '@0xhoneyjar/loa-hounfour/commons';

export {
  buildSumInvariant,
  buildNonNegativeInvariant,
  buildBoundedInvariant,
  createBalanceConservation,
  createNonNegativeConservation,
  createBoundedConservation,
  createMonotonicConservation,
  resetFactoryCounter,
} from '@0xhoneyjar/loa-hounfour/commons';

// ─── Error Taxonomy ──────────────────────────────────────────────────────────
export {
  InvariantViolationSchema,
  InvalidTransitionSchema,
  GuardFailureSchema,
  EvaluationErrorSchema,
  HashDiscontinuityErrorSchema,
  PartialApplicationSchema,
  GovernanceErrorSchema,
  type InvariantViolation,
  type InvalidTransition,
  type GuardFailure,
  type EvaluationError,
  type HashDiscontinuityError,
  type PartialApplication,
  type GovernanceError,
} from '@0xhoneyjar/loa-hounfour/commons';

// ============================================================================
// Canonical hounfour types — v8.2.0 Governance Extensions (cycle-043)
// ModelPerformanceEvent (4th ReputationEvent variant), QualityObservation.
// ============================================================================

export {
  ModelPerformanceEventSchema,
  type ModelPerformanceEvent,
} from '@0xhoneyjar/loa-hounfour/governance';

export {
  QualityObservationSchema,
  type QualityObservation,
} from '@0xhoneyjar/loa-hounfour/governance';

// Compatibility — re-export from arrakis extension module
export {
  CONTRACT_VERSION,
  validateCompatibility,
  negotiateVersion,
  normalizeInboundClaims,
  normalizeCoordinationMessage,
  ClaimNormalizationError,
  isV7NormalizationEnabled,
  setClaimVersionLogger,
} from './arrakis-compat.js';

export type {
  TrustScope,
  TrustLevel,
  NormalizedClaims,
  VersionNegotiation,
  CoordinationMessage,
  NormalizedCoordinationMessage,
} from './arrakis-compat.js';

// JWT boundary — cross-system economic verification (arrakis-specific)
export type {
  JwtErrorCode,
  OutboundClaims,
  InboundClaims,
  IdempotencyStore,
  ActiveReservations,
} from './jwt-boundary.js';

export {
  JwtBoundaryError,
  inboundClaimsSchema,
  verifyUsageJWT,
} from './jwt-boundary.js';

// Atomic counter primitive (arrakis-specific)
export type {
  ICounterBackend,
  IAtomicCounter,
  AtomicCounterConfig,
} from './atomic-counter.js';

export { createAtomicCounter } from './atomic-counter.js';

// Identity trust (arrakis-specific)
export type {
  IdentityTrustConfig,
  IdentityCheckResult,
  AnchorVerificationResult,
  AnchorLookupFn,
} from './identity-trust.js';

export {
  DEFAULT_IDENTITY_TRUST,
  evaluateIdentityTrust,
  verifyIdentityAnchor,
} from './identity-trust.js';

// BillingEntry — arrakis schema (different from v7.0.0 BillingEntry)
export type {
  BillingEntry,
} from './billing-entry.js';

export {
  BILLING_ENTRY_CONTRACT_VERSION,
} from './billing-entry.js';

// Config schema registry (arrakis-specific)
export type {
  ParamSchema,
  ValidationResult,
} from './config-schema.js';

export {
  CONFIG_SCHEMA,
  CONFIG_FALLBACKS,
  validateConfigValue,
} from './config-schema.js';

// Boundary parsing — parseMicroUsd dual-parse wrapper (Sprint 346, cycle-039)
export {
  parseBoundaryMicroUsd,
  checkSafetyFloor,
  resolveParseMode,
  MAX_SAFE_MICRO_USD,
  MAX_INPUT_LENGTH,
} from './parse-boundary-micro-usd.js';

export type {
  BoundaryParseResult,
  BoundaryContext,
  BoundaryErrorCode,
  BoundaryLogger,
  BoundaryMetrics,
  ParseMode,
} from './parse-boundary-micro-usd.js';

// Graduation — shadow-to-enforce graduation criteria (cycle-040, FR-1)
export {
  DEFAULT_GRADUATION_CRITERIA,
  evaluateGraduation,
  computeGraduationGauge,
} from './graduation.js';

export type {
  BoundaryGraduationCriteria,
  GraduationCounters,
  GraduationStatus,
} from './graduation.js';

// Micro-USD gateway schema — mode-aware Zod validation (cycle-040, FR-3)
export {
  createMicroUsdSchema,
  buildMicroUsdError,
  CANONICAL_MICRO_USD_PATTERN,
} from './micro-usd-schema.js';

export type {
  MicroUsdValidationError,
} from './micro-usd-schema.js';

// Dynamic Contract — reputation-gated capability resolution (cycle-043, FR-4)
export {
  loadDynamicContract,
  resetDynamicContract,
  resolveProtocolSurface,
  isCapabilityGranted,
  validateContractFile,
  DynamicContractError,
} from './arrakis-dynamic-contract.js';

export type {
  ReputationStateName,
  DynamicContract,
  ProtocolSurface,
  DynamicContractFailure,
} from './arrakis-dynamic-contract.js';

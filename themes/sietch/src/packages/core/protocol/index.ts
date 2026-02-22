/**
 * Arrakis Protocol Types — Barrel Export
 *
 * Re-exports arrakis-specific protocol types and extensions.
 * Canonical types should be imported directly from @0xhoneyjar/loa-hounfour.
 *
 * Extension modules:
 *   arrakis-arithmetic.ts  — Branded types + arrakis arithmetic helpers
 *   arrakis-compat.ts      — Protocol version negotiation + boundary normalization
 *   arrakis-conservation.ts — Conservation error taxonomy adapter
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

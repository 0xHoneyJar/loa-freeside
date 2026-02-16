/**
 * Vendored loa-hounfour Protocol Types — Barrel Export
 *
 * Re-exports all protocol types for convenient imports:
 *   import { CreditBalance, GuardResult, STATE_MACHINES } from '../../protocol/index.js';
 *
 * @module packages/core/protocol
 */

// Billing domain types
export type {
  AgentBillingConfig,
  CreditBalance,
  UsageRecord,
  BillingMode,
  EntityType,
  SourceType,
  EntryType,
  SystemConfigStatus,
  ParamSource,
  SystemConfig,
  ResolvedParam,
  ProposeOpts,
} from './billing-types.js';

// Guard types
export type {
  GuardResult,
  BillingGuardResponse,
} from './guard-types.js';

// State machine definitions
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

// Arithmetic helpers
export {
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
} from './arithmetic.js';

// Compatibility check
export {
  PROTOCOL_VERSION,
  validateCompatibility,
} from './compatibility.js';

export type { CompatibilityResult } from './compatibility.js';

// Atomic counter primitive
export type {
  ICounterBackend,
  IAtomicCounter,
  AtomicCounterConfig,
} from './atomic-counter.js';

export { createAtomicCounter } from './atomic-counter.js';

// Identity trust
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

// BillingEntry — loa-hounfour protocol type
export type {
  BillingEntry,
  ProtocolEntryType,
} from './billing-entry.js';

export {
  BILLING_ENTRY_CONTRACT_VERSION,
} from './billing-entry.js';

// Config schema registry
export type {
  ParamSchema,
  ValidationResult,
} from './config-schema.js';

export {
  CONFIG_SCHEMA,
  CONFIG_FALLBACKS,
  validateConfigValue,
} from './config-schema.js';

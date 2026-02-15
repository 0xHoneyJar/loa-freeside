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
} from './state-machines.js';

export {
  RESERVATION_MACHINE,
  REVENUE_RULE_MACHINE,
  PAYMENT_MACHINE,
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

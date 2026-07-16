/**
 * @freeside/ordering-protocol
 *
 * Generic Order envelope + lifecycle event payload schemas + Preset (fixed recipe) types
 * for the Freeside order system. Product-agnostic by design: this package NEVER imports a
 * product's own input schema (e.g. shadow-audit's OrderSchema). The order→product
 * translation (the anti-corruption layer) lives in the ordering SERVICE, not here. (EVANS.)
 */

export { ProductId, OrderEnvelopeSchema, type OrderEnvelope } from './order.js';

export {
  ORDER_LIFECYCLE_SUBJECTS,
  type OrderLifecyclePhase,
  ResolutionSourceSchema,
  type ResolutionSource,
  ResolvedBuildingSchema,
  type ResolvedBuilding,
  OrderPlacedSchema,
  type OrderPlaced,
  OrderRoutingSchema,
  type OrderRouting,
  OrderProducingSchema,
  type OrderProducing,
  OrderFulfilledSchema,
  type OrderFulfilled,
  OrderRefusalSchema,
  type OrderRefusal,
  OrderFailedSchema,
  type OrderFailed,
  ORDER_GATE_LEAK_JOIN_SUBJECT,
  ORDER_GATE_LEAK_INPUT_SUBJECT,
  GateLeakInputSuppliedSchema,
  type GateLeakInputSupplied,
  GateLeakCommunityJoinSchema,
  type GateLeakCommunityJoin,
} from './events.js';

export {
  CapabilityNeed,
  TriageCapabilityNeed,
  RecipeStepSchema,
  type RecipeStep,
  type Preset,
  AccessRiskAuditInputs,
  ACCESS_RISK_AUDIT_PRESET,
  CommunityOnboardingInputs,
  GateLeakInputs,
  IngredientStatus,
  CommunityOnboardingIngredients,
  CommunityOnboardingOutput,
  INITIAL_COMMUNITY_ONBOARDING_INGREDIENTS,
  COMMUNITY_ONBOARDING_PRESET,
  GATE_LEAK_PRESET,
  PRESETS,
  resolvePreset,
} from './preset.js';

export {
  EnqueueIngredientKey,
  IngredientJob,
  ProbeSource,
  IngredientProbeMeta,
  OrderProbeMeta,
  OperatorAuditEntry,
  PublicOrderSchema,
  type PublicOrder,
  ingredientJobIdempotencyKey,
} from './kitchen.js';

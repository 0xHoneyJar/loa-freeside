/**
 * @freeside/eligibility-protocol
 *
 * The sealed `EligibilityRule` noun (the reconciliation of three legacy shapes) +
 * the `EligibilityVerdict` (the decision output). Published language for the Freeside
 * order/access system. Product-agnostic by design: this package NEVER imports a product's
 * own schema (e.g. shadow-audit's AccessDecisionRecord). The rule→checker and
 * verdict→OrderRefusal translations (the anti-corruption layers) live in the SERVICES,
 * not here. (EVANS bounded-context boundary.)
 */

export {
  ChainIdSchema,
  type ChainId,
  EligibilityRuleType,
  EligibilityThreshold,
  EligibilityRuleSchema,
  type EligibilityRule,
} from './eligibility-rule.js';

export {
  EligibilitySource,
  EligibilityStatus,
  EligibilityVerdictSchema,
  type EligibilityVerdict,
} from './eligibility-verdict.js';

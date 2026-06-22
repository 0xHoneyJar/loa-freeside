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

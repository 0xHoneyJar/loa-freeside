/**
 * Infrastructure Package - Policy-as-Code Pre-Gate
 *
 * Exports all components for OPA policy evaluation, Infracost integration,
 * and risk scoring for Terraform infrastructure changes.
 */

export { PolicyAsCodePreGate } from './PolicyAsCodePreGate.js';
export { InfracostClient } from './InfracostClient.js';
export { RiskScorer } from './RiskScorer.js';

export type {
  TerraformPlan,
  TerraformResourceChange,
  TerraformAction,
  PolicyEvaluationResult,
  PolicyViolation,
  InfracostEstimate,
  InfracostResource,
  RiskScore,
  PreGateDecision,
  PreGateConfig,
  BudgetViolation,
} from './types.js';

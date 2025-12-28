/**
 * Infrastructure Package - Policy-as-Code Pre-Gate & HITL Approval
 *
 * Exports all components for OPA policy evaluation, Infracost integration,
 * risk scoring, and Human-in-the-Loop approval workflow for Terraform
 * infrastructure changes.
 */

export { PolicyAsCodePreGate } from './PolicyAsCodePreGate.js';
export type { Logger, PreGateConfigWithLogger } from './PolicyAsCodePreGate.js';
export { InfracostClient } from './InfracostClient.js';
export { RiskScorer } from './RiskScorer.js';
export { EnhancedHITLApprovalGate } from './EnhancedHITLApprovalGate.js';
export type {
  HttpClient,
  MfaVerifier,
  AuthVerifier,
  ApprovalStorage,
  HITLConfigWithDeps,
} from './EnhancedHITLApprovalGate.js';

export type {
  // Policy-as-Code types
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
  // HITL Approval types
  ApprovalStatus,
  NotificationChannel,
  ApprovalRequest,
  ApprovalRequester,
  ApprovalResolver,
  ApprovalAuditEntry,
  ApprovalAuditAction,
  HITLConfig,
  HITLResult,
  SlackApprovalMessage,
  SlackBlock,
  SlackBlockElement,
  DiscordApprovalMessage,
  DiscordEmbed,
  DiscordComponent,
} from './types.js';

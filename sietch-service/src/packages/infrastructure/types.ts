/**
 * Policy-as-Code Pre-Gate Type Definitions
 *
 * Types for OPA policy evaluation, Infracost integration, and risk scoring
 * for Terraform infrastructure changes.
 */

/**
 * Terraform plan JSON structure (subset relevant to policy evaluation)
 */
export interface TerraformPlan {
  format_version: string;
  terraform_version: string;
  planned_values?: {
    root_module?: {
      resources?: Array<{
        address: string;
        mode: string;
        type: string;
        name: string;
        values?: Record<string, unknown>;
      }>;
    };
  };
  resource_changes?: TerraformResourceChange[];
  configuration?: {
    root_module?: {
      resources?: Array<{
        type: string;
        name: string;
        expressions?: Record<string, unknown>;
      }>;
    };
  };
}

/**
 * Individual resource change in Terraform plan
 */
export interface TerraformResourceChange {
  address: string;
  mode: 'managed' | 'data';
  type: string;
  name: string;
  provider_name: string;
  change: {
    actions: TerraformAction[];
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
    after_unknown?: Record<string, unknown>;
  };
}

/**
 * Terraform actions: create, delete, update, replace, etc.
 */
export type TerraformAction = 'create' | 'delete' | 'update' | 'read' | 'no-op';

/**
 * OPA policy evaluation result
 */
export interface PolicyEvaluationResult {
  /** Whether the policy allows the change */
  allowed: boolean;
  /** Hard blocks that cannot be overridden */
  hardBlocks: PolicyViolation[];
  /** Warnings that require human review */
  warnings: PolicyViolation[];
  /** Metadata about the evaluation */
  metadata: {
    /** Time taken to evaluate policies (ms) */
    evaluationTimeMs: number;
    /** OPA version used */
    opaVersion?: string;
    /** Policy file path */
    policyPath: string;
  };
}

/**
 * Individual policy violation
 */
export interface PolicyViolation {
  /** Unique violation code */
  code: string;
  /** Severity level */
  severity: 'critical' | 'high' | 'medium' | 'low';
  /** Human-readable message */
  message: string;
  /** Resource address that triggered the violation */
  resource: string;
  /** Can this violation be overridden by human? */
  canOverride: boolean;
  /** Additional context */
  details?: Record<string, unknown>;
}

/**
 * Infracost API response structure
 */
export interface InfracostEstimate {
  /** Total monthly cost differential (new - old) */
  totalMonthlyCostDiff: number;
  /** Currency (e.g., "USD") */
  currency: string;
  /** Breakdown by resource */
  resources: InfracostResource[];
  /** Summary statistics */
  summary: {
    totalMonthlyCost: number;
    totalMonthlyCostBefore: number;
  };
}

/**
 * Individual resource cost estimate
 */
export interface InfracostResource {
  /** Resource address */
  name: string;
  /** Resource type */
  resourceType: string;
  /** Monthly cost */
  monthlyCost: number;
  /** Cost components (e.g., storage, compute) */
  costComponents: Array<{
    name: string;
    unit: string;
    monthlyCost: number;
  }>;
}

/**
 * Risk score calculation result (0-100)
 */
export interface RiskScore {
  /** Overall risk score (0-100, higher = more risky) */
  score: number;
  /** Risk level category */
  level: 'low' | 'medium' | 'high' | 'critical';
  /** Breakdown of risk factors */
  factors: {
    /** Risk from resource type (e.g., database vs static file) */
    resourceTypeRisk: number;
    /** Risk from operation type (delete > update > create) */
    operationTypeRisk: number;
    /** Risk from cost impact */
    costImpactRisk: number;
    /** Risk from blast radius (number of resources affected) */
    blastRadiusRisk: number;
  };
  /** Human-readable explanation */
  explanation: string;
}

/**
 * Overall pre-gate decision
 */
export interface PreGateDecision {
  /** Final decision */
  verdict: 'APPROVE' | 'REJECT' | 'REVIEW_REQUIRED';
  /** Policy evaluation results */
  policyEvaluation: PolicyEvaluationResult;
  /** Infracost estimate (if available) */
  costEstimate?: InfracostEstimate;
  /** Risk score */
  riskScore: RiskScore;
  /** Timestamp of decision */
  timestamp: Date;
  /** Reason for decision */
  reason: string;
  /** Recommended actions */
  recommendations: string[];
}

/**
 * Configuration for PolicyAsCodePreGate
 */
export interface PreGateConfig {
  /** Path to OPA policy file (.rego) */
  policyPath: string;
  /** Infracost API key (optional, if not provided, cost checks are skipped) */
  infracostApiKey?: string;
  /** Budget threshold in USD/month (if exceeded, auto-reject) */
  budgetThresholdUsd: number;
  /** Risk score threshold (0-100, above which requires human review) */
  riskScoreThreshold: number;
  /** Timeout for policy evaluation (ms) */
  evaluationTimeoutMs: number;
}

/**
 * Budget threshold violation
 */
export interface BudgetViolation {
  /** Threshold that was exceeded */
  thresholdUsd: number;
  /** Actual cost differential */
  actualDiffUsd: number;
  /** Amount over threshold */
  excessUsd: number;
}

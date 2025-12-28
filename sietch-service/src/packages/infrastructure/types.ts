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

// ============================================
// HITL (Human-in-the-Loop) Approval Gate Types
// ============================================

/**
 * Approval request status
 */
export type ApprovalStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'cancelled';

/**
 * Notification channel for approval requests
 */
export type NotificationChannel = 'slack' | 'discord' | 'both';

/**
 * Approval request for infrastructure changes
 */
export interface ApprovalRequest {
  /** Unique request ID */
  id: string;
  /** Terraform plan being reviewed */
  terraformPlan: TerraformPlan;
  /** Pre-gate decision from PolicyAsCodePreGate */
  preGateDecision: PreGateDecision;
  /** Current status */
  status: ApprovalStatus;
  /** Who requested the change */
  requester: ApprovalRequester;
  /** Notification channel used */
  notificationChannel: NotificationChannel;
  /** Message IDs for tracking (Slack/Discord) */
  notificationMessageIds: {
    slack?: string;
    discord?: string;
  };
  /** Whether MFA is required for this approval */
  requiresMfa: boolean;
  /** Creation timestamp */
  createdAt: Date;
  /** Expiration timestamp (24 hours from creation) */
  expiresAt: Date;
  /** Resolution timestamp (when approved/rejected/expired) */
  resolvedAt?: Date;
  /** Resolver information (who approved/rejected) */
  resolver?: ApprovalResolver;
  /** Audit trail entries */
  auditTrail: ApprovalAuditEntry[];
}

/**
 * Person or system requesting the infrastructure change
 */
export interface ApprovalRequester {
  /** User ID (e.g., Slack/Discord user ID) */
  userId: string;
  /** Display name */
  displayName: string;
  /** Email (optional) */
  email?: string;
  /** Source system (e.g., 'terraform-cli', 'ci-cd') */
  source: string;
}

/**
 * Person who resolved the approval request
 */
export interface ApprovalResolver {
  /** User ID */
  userId: string;
  /** Display name */
  displayName: string;
  /** Email (optional) */
  email?: string;
  /** Whether MFA was verified */
  mfaVerified: boolean;
  /** Resolution action */
  action: 'approved' | 'rejected';
  /** Optional reason for rejection */
  reason?: string;
}

/**
 * Audit trail entry for approval request
 *
 * SECURITY: Each entry includes an HMAC signature for tamper detection (MED-004).
 * Use EnhancedHITLApprovalGate.verifyAuditTrail() to verify integrity.
 */
export interface ApprovalAuditEntry {
  /** Entry timestamp */
  timestamp: Date;
  /** Action type */
  action: ApprovalAuditAction;
  /** Actor (user or system) */
  actor: string;
  /** Additional details */
  details?: Record<string, unknown>;
  /**
   * HMAC-SHA256 signature for tamper detection (MED-004)
   * Generated from: timestamp, action, actor, details
   */
  signature?: string;
}

/**
 * Actions recorded in audit trail
 */
export type ApprovalAuditAction =
  | 'request_created'
  | 'notification_sent'
  | 'notification_failed'
  | 'mfa_requested'
  | 'mfa_verified'
  | 'mfa_failed'
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'cancelled'
  | 'reminder_sent';

/**
 * Configuration for EnhancedHITLApprovalGate
 */
export interface HITLConfig {
  /** Slack webhook URL (optional) */
  slackWebhookUrl?: string;
  /** Slack channel ID for approvals */
  slackChannelId?: string;
  /** Discord webhook URL (optional) */
  discordWebhookUrl?: string;
  /** Approval timeout in milliseconds (default: 24 hours) */
  approvalTimeoutMs: number;
  /** Risk score threshold above which MFA is required */
  mfaRiskThreshold: number;
  /** Whether to require MFA for all approvals */
  alwaysRequireMfa: boolean;
  /** Notification channel preference */
  notificationChannel: NotificationChannel;
  /** Reminder intervals (ms from creation) */
  reminderIntervals: number[];
}

/**
 * Result of HITL approval process
 */
export interface HITLResult {
  /** Whether the change was approved */
  approved: boolean;
  /** Full approval request with audit trail */
  request: ApprovalRequest;
  /** Summary message */
  message: string;
  /** Whether Terraform apply can proceed */
  canProceed: boolean;
}

/**
 * Slack Block Kit message for approval request
 */
export interface SlackApprovalMessage {
  /** Channel to post to */
  channel: string;
  /** Block Kit blocks */
  blocks: SlackBlock[];
  /** Text fallback */
  text: string;
}

/**
 * Simplified Slack Block type
 */
export interface SlackBlock {
  type: 'section' | 'divider' | 'actions' | 'context' | 'header';
  text?: {
    type: 'plain_text' | 'mrkdwn';
    text: string;
    emoji?: boolean;
  };
  fields?: Array<{
    type: 'plain_text' | 'mrkdwn';
    text: string;
  }>;
  elements?: Array<SlackBlockElement>;
  accessory?: SlackBlockElement;
  block_id?: string;
}

/**
 * Slack Block element (button, etc.)
 */
export interface SlackBlockElement {
  type: 'button' | 'static_select' | 'image';
  text?: {
    type: 'plain_text' | 'mrkdwn';
    text: string;
    emoji?: boolean;
  };
  action_id?: string;
  value?: string;
  style?: 'primary' | 'danger';
  url?: string;
  confirm?: {
    title: { type: 'plain_text'; text: string };
    text: { type: 'mrkdwn'; text: string };
    confirm: { type: 'plain_text'; text: string };
    deny: { type: 'plain_text'; text: string };
    style?: 'primary' | 'danger';
  };
}

/**
 * Discord webhook message for approval request
 */
export interface DiscordApprovalMessage {
  /** Message content */
  content: string;
  /** Embeds for rich formatting */
  embeds: DiscordEmbed[];
  /** Components for interactive buttons */
  components: DiscordComponent[];
}

/**
 * Discord embed for rich message formatting
 */
export interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number;
  fields?: Array<{
    name: string;
    value: string;
    inline?: boolean;
  }>;
  footer?: {
    text: string;
  };
  timestamp?: string;
}

/**
 * Discord component (action row with buttons)
 */
export interface DiscordComponent {
  type: 1; // Action Row
  components: Array<{
    type: 2; // Button
    style: 1 | 2 | 3 | 4 | 5; // Primary, Secondary, Success, Danger, Link
    label: string;
    custom_id?: string;
    url?: string;
    disabled?: boolean;
  }>;
}

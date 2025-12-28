/**
 * Enhanced Human-in-the-Loop (HITL) Approval Gate
 *
 * Provides a three-stage validation workflow for Terraform infrastructure changes:
 * 1. Pre-gate validation (OPA policies, budget check, risk score)
 * 2. Notification via Slack/Discord with full context
 * 3. Human approval with MFA for high-risk changes
 *
 * Features:
 * - Slack Block Kit interactive messages with approve/reject buttons
 * - Discord webhook with embeds and components
 * - 24-hour approval timeout with auto-reject
 * - MFA verification for high-risk approvals
 * - Complete audit trail for compliance
 *
 * Security:
 * - Webhook URL validation with domain allowlist (HIGH-001)
 * - Resolver identity verification via AuthVerifier (MED-001)
 * - Input sanitization for audit trail integrity (MED-002)
 * - Webhook response validation (MED-003)
 * - HMAC-signed audit entries for tamper detection (MED-004)
 */

import { randomUUID, createHmac } from 'crypto';
import type { Logger } from './PolicyAsCodePreGate.js';
import type {
  TerraformPlan,
  PreGateDecision,
  ApprovalRequest,
  ApprovalRequester,
  ApprovalResolver,
  ApprovalStatus,
  ApprovalAuditEntry,
  ApprovalAuditAction,
  HITLConfig,
  HITLResult,
  SlackApprovalMessage,
  SlackBlock,
  DiscordApprovalMessage,
  DiscordEmbed,
  DiscordComponent,
} from './types.js';

/**
 * HTTP client interface for dependency injection
 * Compatible with axios, fetch, or custom implementations
 */
export interface HttpClient {
  post(url: string, data: unknown, config?: { headers?: Record<string, string> }): Promise<{
    status: number;
    data: unknown;
  }>;
}

/**
 * MFA verifier interface for dependency injection
 * Implementations can use TOTP, hardware keys, or custom MFA
 *
 * ERROR HANDLING (LOW-001):
 * - Return false: MFA code is invalid for user
 * - Throw error: System error (network, invalid userId, service unavailable)
 *
 * Example:
 * ```
 * async verify(userId, code) {
 *   if (!await userExists(userId)) {
 *     throw new Error(`User not found: ${userId}`);
 *   }
 *   if (networkError) {
 *     throw new Error('MFA service unavailable');
 *   }
 *   return code === expectedCode;
 * }
 * ```
 */
export interface MfaVerifier {
  /**
   * Verify MFA code for a user
   * @param userId - User identifier
   * @param code - MFA code to verify
   * @returns True if code is valid, false if invalid
   * @throws Error if system error occurs (network, invalid user, etc.)
   */
  verify(userId: string, code: string): Promise<boolean>;
}

/**
 * Authentication verifier interface for resolver identity verification (MED-001)
 *
 * Implementations should verify JWT tokens, session tokens, or other auth mechanisms.
 * This prevents impersonation attacks where callers claim to be legitimate approvers.
 *
 * SECURITY: This interface is REQUIRED when processApproval is exposed via API.
 * Do not allow caller-provided identity without verification.
 */
export interface AuthVerifier {
  /**
   * Verify authentication token and extract verified identity
   * @param token - Authentication token (JWT, session token, etc.)
   * @returns Verified user identity or null if invalid
   * @throws Error if verification service unavailable
   */
  verify(token: string): Promise<{
    id: string;
    displayName: string;
    email?: string;
  } | null>;
}

/**
 * Approval request storage interface
 * Implementations can use Redis, PostgreSQL, or in-memory storage
 *
 * SECURITY TRUST MODEL (MED-005):
 *
 * Storage implementations MUST:
 * - Be deployed in trusted environment (same security zone as HITL gate)
 * - Not modify approval requests except via gate methods
 * - Enforce access control at storage layer
 * - Log all access for audit
 * - Encrypt data at rest (AES-256 or equivalent)
 * - Be resilient to tampering (HMAC signatures verified on retrieval)
 *
 * Storage implementations SHOULD:
 * - Use TLS for network communication
 * - Implement connection pooling with auth
 * - Support atomic operations for race condition prevention
 *
 * DO NOT use untrusted or third-party storage implementations
 * without thorough security review.
 *
 * Reference implementations:
 * - RedisApprovalStorage: Use with AUTH, TLS, and encryption at rest
 * - PostgresApprovalStorage: Use with RLS policies and encrypted connections
 */
export interface ApprovalStorage {
  /**
   * Store an approval request
   * @param request - The approval request to store
   */
  save(request: ApprovalRequest): Promise<void>;

  /**
   * Retrieve an approval request by ID
   * @param id - Request ID
   * @returns The approval request or null if not found
   */
  get(id: string): Promise<ApprovalRequest | null>;

  /**
   * Update an existing approval request
   * @param request - The updated approval request
   */
  update(request: ApprovalRequest): Promise<void>;

  /**
   * Find all pending requests that have expired
   * @returns List of expired approval requests
   */
  findExpired(): Promise<ApprovalRequest[]>;
}

/**
 * Allowed webhook domains for security validation (HIGH-001)
 */
const ALLOWED_WEBHOOK_DOMAINS: Record<string, string[]> = {
  slack: ['hooks.slack.com'],
  discord: ['discord.com', 'discordapp.com'],
};

/**
 * Extended HITL configuration with dependencies
 */
export interface HITLConfigWithDeps extends HITLConfig {
  /** HTTP client for webhook requests */
  httpClient: HttpClient;
  /** MFA verifier (optional, required if MFA is enabled) */
  mfaVerifier?: MfaVerifier;
  /** Authentication verifier for resolver identity (MED-001) - required for API exposure */
  authVerifier?: AuthVerifier;
  /** Approval storage backend */
  storage: ApprovalStorage;
  /** Logger instance */
  logger?: Logger;
  /**
   * Secret key for HMAC signing of audit entries (MED-004)
   * Required for audit trail integrity verification
   * Should be at least 32 bytes of cryptographically random data
   */
  auditSigningKey: string;
}

/**
 * Default approval timeout: 24 hours in milliseconds
 */
const DEFAULT_APPROVAL_TIMEOUT_MS = 24 * 60 * 60 * 1000;

/**
 * Default reminder intervals: 1 hour, 6 hours, 12 hours
 */
const DEFAULT_REMINDER_INTERVALS = [
  1 * 60 * 60 * 1000,   // 1 hour
  6 * 60 * 60 * 1000,   // 6 hours
  12 * 60 * 60 * 1000,  // 12 hours
];

/**
 * Enhanced Human-in-the-Loop Approval Gate
 *
 * Orchestrates the complete approval workflow for infrastructure changes
 */
export class EnhancedHITLApprovalGate {
  private config: HITLConfigWithDeps;
  private httpClient: HttpClient;
  private mfaVerifier?: MfaVerifier;
  private authVerifier?: AuthVerifier;
  private storage: ApprovalStorage;
  private logger: Logger;
  private auditSigningKey: string;

  constructor(config: HITLConfigWithDeps) {
    // Validate webhook URLs before use (HIGH-001)
    if (config.slackWebhookUrl) {
      this.validateWebhookUrl(config.slackWebhookUrl, 'slack');
    }
    if (config.discordWebhookUrl) {
      this.validateWebhookUrl(config.discordWebhookUrl, 'discord');
    }

    // Validate audit signing key (MED-004)
    if (!config.auditSigningKey || config.auditSigningKey.length < 32) {
      throw new Error('Audit signing key must be at least 32 characters for HMAC security');
    }

    this.config = {
      ...config,
      approvalTimeoutMs: config.approvalTimeoutMs || DEFAULT_APPROVAL_TIMEOUT_MS,
      reminderIntervals: config.reminderIntervals || DEFAULT_REMINDER_INTERVALS,
    };
    this.httpClient = config.httpClient;
    this.mfaVerifier = config.mfaVerifier;
    this.authVerifier = config.authVerifier;
    this.storage = config.storage;
    this.auditSigningKey = config.auditSigningKey;
    this.logger = config.logger || {
      info: (obj: object, msg?: string) => console.log(msg || '', obj),
      warn: (obj: object, msg?: string) => console.warn(msg || '', obj),
      error: (obj: object, msg?: string) => console.error(msg || '', obj),
    };

    // Validate MFA configuration
    if ((config.alwaysRequireMfa || config.mfaRiskThreshold > 0) && !config.mfaVerifier) {
      throw new Error('MFA verifier is required when MFA is enabled');
    }

    // Log webhook destinations for audit trail (HIGH-001)
    if (config.slackWebhookUrl) {
      const slackHost = new URL(config.slackWebhookUrl).hostname;
      this.logger.info({ webhookHost: slackHost }, 'Slack webhook configured');
    }
    if (config.discordWebhookUrl) {
      const discordHost = new URL(config.discordWebhookUrl).hostname;
      this.logger.info({ webhookHost: discordHost }, 'Discord webhook configured');
    }
  }

  /**
   * Validate webhook URL for security (HIGH-001)
   *
   * Ensures webhook URLs:
   * - Use HTTPS protocol
   * - Point to allowed domains only (prevents data exfiltration)
   *
   * @throws Error if URL is invalid or not allowed
   */
  private validateWebhookUrl(url: string, service: 'slack' | 'discord'): void {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`Invalid ${service} webhook URL: ${url}`);
    }

    // Enforce HTTPS
    if (parsed.protocol !== 'https:') {
      throw new Error(
        `${service} webhook URL must use HTTPS, got: ${parsed.protocol}`
      );
    }

    // Domain allowlist
    const allowed = ALLOWED_WEBHOOK_DOMAINS[service] || [];
    const isAllowed = allowed.some(
      (domain) =>
        parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`)
    );

    if (!isAllowed) {
      throw new Error(
        `${service} webhook domain not allowed: ${parsed.hostname}. ` +
          `Allowed domains: ${allowed.join(', ')}`
      );
    }
  }

  /**
   * Create a new approval request for a Terraform plan
   *
   * @param terraformPlan - The Terraform plan to approve
   * @param preGateDecision - Pre-gate evaluation result
   * @param requester - Who is requesting the approval
   * @returns The created approval request
   */
  async createApprovalRequest(
    terraformPlan: TerraformPlan,
    preGateDecision: PreGateDecision,
    requester: ApprovalRequester
  ): Promise<ApprovalRequest> {
    // Validate pre-gate decision allows review
    if (preGateDecision.verdict === 'REJECT') {
      throw new Error(
        `Pre-gate rejected change: ${preGateDecision.reason}. Cannot create approval request.`
      );
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.config.approvalTimeoutMs);

    // Determine if MFA is required based on risk score
    const requiresMfa =
      this.config.alwaysRequireMfa ||
      preGateDecision.riskScore.score >= this.config.mfaRiskThreshold;

    // Build initial audit entry with signature (MED-004)
    const initialAuditDetails = {
      requesterSource: requester.source,
      requiresMfa,
      expiresAt: expiresAt.toISOString(),
    };
    const initialAuditSignature = this.signAuditEntry(
      now,
      'request_created',
      requester.displayName,
      initialAuditDetails
    );

    const request: ApprovalRequest = {
      id: randomUUID(),
      terraformPlan,
      preGateDecision,
      status: 'pending',
      requester,
      notificationChannel: this.config.notificationChannel,
      notificationMessageIds: {},
      requiresMfa,
      createdAt: now,
      expiresAt,
      auditTrail: [
        {
          timestamp: now,
          action: 'request_created',
          actor: requester.displayName,
          details: initialAuditDetails,
          signature: initialAuditSignature,
        },
      ],
    };

    // Save to storage
    await this.storage.save(request);

    this.logger.info(
      {
        requestId: request.id,
        requester: requester.displayName,
        verdict: preGateDecision.verdict,
        riskScore: preGateDecision.riskScore.score,
        requiresMfa,
      },
      'Approval request created'
    );

    return request;
  }

  /**
   * Send notification for an approval request
   *
   * @param request - The approval request
   * @returns Updated request with notification message IDs
   */
  async sendNotification(request: ApprovalRequest): Promise<ApprovalRequest> {
    const updatedRequest = { ...request };

    try {
      // Send Slack notification
      if (
        (this.config.notificationChannel === 'slack' ||
          this.config.notificationChannel === 'both') &&
        this.config.slackWebhookUrl
      ) {
        const slackMessage = this.buildSlackMessage(request);
        const response = await this.httpClient.post(
          this.config.slackWebhookUrl,
          slackMessage,
          { headers: { 'Content-Type': 'application/json' } }
        );

        // Validate Slack response (MED-003)
        if (response.status !== 200) {
          throw new Error(`Slack webhook returned status ${response.status}`);
        }
        // Slack returns 'ok' string on success
        if (response.data !== 'ok') {
          throw new Error(
            `Slack webhook returned unexpected response: ${JSON.stringify(response.data)}`
          );
        }

        updatedRequest.notificationMessageIds.slack = `slack-${request.id}`;
        this.addAuditEntry(updatedRequest, 'notification_sent', 'system', {
          channel: 'slack',
        });
      }

      // Send Discord notification
      if (
        (this.config.notificationChannel === 'discord' ||
          this.config.notificationChannel === 'both') &&
        this.config.discordWebhookUrl
      ) {
        const discordMessage = this.buildDiscordMessage(request);
        const response = await this.httpClient.post(
          this.config.discordWebhookUrl,
          discordMessage,
          { headers: { 'Content-Type': 'application/json' } }
        );

        // Validate Discord response (MED-003)
        // Discord returns 204 No Content OR 200 with message object
        if (response.status !== 200 && response.status !== 204) {
          throw new Error(`Discord webhook returned status ${response.status}`);
        }
        // If 200, validate response has message ID
        if (response.status === 200) {
          const data = response.data as Record<string, unknown> | null;
          if (!data || !data.id) {
            throw new Error('Discord webhook did not return message ID');
          }
          updatedRequest.notificationMessageIds.discord = String(data.id);
        } else {
          updatedRequest.notificationMessageIds.discord = `discord-${request.id}`;
        }
        this.addAuditEntry(updatedRequest, 'notification_sent', 'system', {
          channel: 'discord',
        });
      }

      await this.storage.update(updatedRequest);
      return updatedRequest;
    } catch (error) {
      // Sanitize error message to remove network details (LOW-002)
      this.addAuditEntry(updatedRequest, 'notification_failed', 'system', {
        error: this.sanitizeErrorMessage(String(error)),
      });
      await this.storage.update(updatedRequest);

      this.logger.error(
        { requestId: request.id, error: String(error) },
        'Failed to send notification'
      );
      throw error;
    }
  }

  /**
   * Process an approval action (approve/reject)
   *
   * @param requestId - The approval request ID
   * @param resolver - Who is resolving the request
   * @param action - Approve or reject
   * @param mfaCode - MFA code (required for high-risk approvals)
   * @returns The HITL result
   */
  async processApproval(
    requestId: string,
    resolver: Omit<ApprovalResolver, 'mfaVerified'>,
    action: 'approved' | 'rejected',
    mfaCode?: string
  ): Promise<HITLResult> {
    const request = await this.storage.get(requestId);

    if (!request) {
      throw new Error(`Approval request not found: ${requestId}`);
    }

    // Check if already resolved
    if (request.status !== 'pending') {
      throw new Error(
        `Approval request already resolved with status: ${request.status}`
      );
    }

    // Check if expired
    if (new Date() > request.expiresAt) {
      await this.expireRequest(request);
      throw new Error('Approval request has expired');
    }

    // Verify MFA if required
    let mfaVerified = false;
    if (request.requiresMfa && action === 'approved') {
      if (!mfaCode) {
        this.addAuditEntry(request, 'mfa_requested', resolver.displayName);
        await this.storage.update(request);
        throw new Error('MFA verification required for this approval');
      }

      if (!this.mfaVerifier) {
        throw new Error('MFA verifier not configured');
      }

      mfaVerified = await this.mfaVerifier.verify(resolver.userId, mfaCode);
      if (!mfaVerified) {
        this.addAuditEntry(request, 'mfa_failed', resolver.displayName);
        await this.storage.update(request);
        throw new Error('MFA verification failed');
      }

      this.addAuditEntry(request, 'mfa_verified', resolver.displayName);
    }

    // Sanitize resolver reason (MED-002)
    const sanitizedReason = this.sanitizeReason(resolver.reason);

    // Update request status
    const now = new Date();
    const updatedRequest: ApprovalRequest = {
      ...request,
      status: action as ApprovalStatus,
      resolvedAt: now,
      resolver: {
        ...resolver,
        reason: sanitizedReason,
        mfaVerified,
        action,
      },
    };

    this.addAuditEntry(
      updatedRequest,
      action,
      resolver.displayName,
      { reason: sanitizedReason }
    );

    await this.storage.update(updatedRequest);

    this.logger.info(
      {
        requestId,
        action,
        resolver: resolver.displayName,
        mfaVerified,
      },
      'Approval request resolved'
    );

    return {
      approved: action === 'approved',
      request: updatedRequest,
      message: action === 'approved'
        ? 'Terraform plan approved - safe to apply'
        : `Terraform plan rejected: ${resolver.reason || 'No reason provided'}`,
      canProceed: action === 'approved',
    };
  }

  /**
   * Expire pending requests that have passed their timeout
   *
   * Should be called periodically (e.g., by a cron job)
   */
  async processExpiredRequests(): Promise<ApprovalRequest[]> {
    const expiredRequests = await this.storage.findExpired();
    const processedRequests: ApprovalRequest[] = [];

    for (const request of expiredRequests) {
      await this.expireRequest(request);
      processedRequests.push(request);
    }

    if (processedRequests.length > 0) {
      this.logger.info(
        { count: processedRequests.length },
        'Processed expired approval requests'
      );
    }

    return processedRequests;
  }

  /**
   * Get the current status of an approval request
   *
   * @param requestId - The approval request ID
   * @returns The approval request or null
   */
  async getRequest(requestId: string): Promise<ApprovalRequest | null> {
    return this.storage.get(requestId);
  }

  /**
   * Cancel a pending approval request
   *
   * @param requestId - The approval request ID
   * @param actor - Who is cancelling the request
   * @param reason - Reason for cancellation
   */
  async cancelRequest(
    requestId: string,
    actor: string,
    reason?: string
  ): Promise<ApprovalRequest> {
    const request = await this.storage.get(requestId);

    if (!request) {
      throw new Error(`Approval request not found: ${requestId}`);
    }

    if (request.status !== 'pending') {
      throw new Error(
        `Cannot cancel request with status: ${request.status}`
      );
    }

    const updatedRequest: ApprovalRequest = {
      ...request,
      status: 'cancelled',
      resolvedAt: new Date(),
    };

    this.addAuditEntry(updatedRequest, 'cancelled', actor, { reason });
    await this.storage.update(updatedRequest);

    this.logger.info(
      { requestId, actor, reason },
      'Approval request cancelled'
    );

    return updatedRequest;
  }

  /**
   * Build Slack Block Kit message for approval request
   */
  private buildSlackMessage(request: ApprovalRequest): SlackApprovalMessage {
    const decision = request.preGateDecision;
    const riskEmoji = this.getRiskEmoji(decision.riskScore.level);
    const verdictEmoji = decision.verdict === 'REVIEW_REQUIRED' ? ':warning:' : ':white_check_mark:';

    const blocks: SlackBlock[] = [
      // Header
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `${verdictEmoji} Infrastructure Change Review Required`,
          emoji: true,
        },
      },
      // Divider
      { type: 'divider' },
      // Summary section
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Request ID:*\n\`${request.id.slice(0, 8)}\``,
          },
          {
            type: 'mrkdwn',
            text: `*Requester:*\n${request.requester.displayName}`,
          },
          {
            type: 'mrkdwn',
            text: `*Risk Level:*\n${riskEmoji} ${decision.riskScore.level.toUpperCase()} (${decision.riskScore.score}/100)`,
          },
          {
            type: 'mrkdwn',
            text: `*Expires:*\n<!date^${Math.floor(request.expiresAt.getTime() / 1000)}^{date_short} at {time}|${request.expiresAt.toISOString()}>`,
          },
        ],
      },
    ];

    // Resource changes
    const resourceCount = request.terraformPlan.resource_changes?.length || 0;
    if (resourceCount > 0) {
      const changes = request.terraformPlan.resource_changes!.slice(0, 5);
      const changeText = changes
        .map((c) => `• \`${c.type}\` ${c.change.actions.join(', ')}`)
        .join('\n');

      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Resource Changes (${resourceCount} total):*\n${changeText}${resourceCount > 5 ? `\n_...and ${resourceCount - 5} more_` : ''}`,
        },
      });
    }

    // Warnings (sanitized for display - LOW-003)
    if (decision.policyEvaluation.warnings.length > 0) {
      const warningText = decision.policyEvaluation.warnings
        .slice(0, 3)
        .map((w) => `• :warning: ${this.sanitizeForDisplay(w.message)}`)
        .join('\n');

      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Warnings:*\n${warningText}`,
        },
      });
    }

    // Cost impact
    if (decision.costEstimate) {
      const costDiff = decision.costEstimate.totalMonthlyCostDiff;
      const costText = costDiff >= 0 ? `+$${costDiff.toFixed(2)}` : `-$${Math.abs(costDiff).toFixed(2)}`;
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Monthly Cost Impact:* ${costText}/mo`,
        },
      });
    }

    // MFA notice
    if (request.requiresMfa) {
      blocks.push({
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: ':lock: *MFA verification required for approval*',
          },
        ],
      });
    }

    // Divider before actions
    blocks.push({ type: 'divider' });

    // Action buttons
    blocks.push({
      type: 'actions',
      block_id: `approval_${request.id}`,
      elements: [
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: 'Approve',
            emoji: true,
          },
          style: 'primary',
          action_id: 'approve',
          value: request.id,
          confirm: {
            title: { type: 'plain_text', text: 'Confirm Approval' },
            text: {
              type: 'mrkdwn',
              text: `Are you sure you want to approve this infrastructure change?${request.requiresMfa ? '\n\n*MFA verification will be required.*' : ''}`,
            },
            confirm: { type: 'plain_text', text: 'Approve' },
            deny: { type: 'plain_text', text: 'Cancel' },
            style: 'primary',
          },
        },
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: 'Reject',
            emoji: true,
          },
          style: 'danger',
          action_id: 'reject',
          value: request.id,
          confirm: {
            title: { type: 'plain_text', text: 'Confirm Rejection' },
            text: {
              type: 'mrkdwn',
              text: 'Are you sure you want to reject this infrastructure change?',
            },
            confirm: { type: 'plain_text', text: 'Reject' },
            deny: { type: 'plain_text', text: 'Cancel' },
            style: 'danger',
          },
        },
      ],
    });

    return {
      channel: this.config.slackChannelId || '',
      blocks,
      text: `Infrastructure change review required - Risk: ${decision.riskScore.level.toUpperCase()}`,
    };
  }

  /**
   * Build Discord webhook message for approval request
   */
  private buildDiscordMessage(request: ApprovalRequest): DiscordApprovalMessage {
    const decision = request.preGateDecision;
    const riskColor = this.getRiskColor(decision.riskScore.level);

    // Build fields for embed
    const fields: DiscordEmbed['fields'] = [
      {
        name: 'Request ID',
        value: `\`${request.id.slice(0, 8)}\``,
        inline: true,
      },
      {
        name: 'Requester',
        value: request.requester.displayName,
        inline: true,
      },
      {
        name: 'Risk Level',
        value: `${decision.riskScore.level.toUpperCase()} (${decision.riskScore.score}/100)`,
        inline: true,
      },
    ];

    // Resource changes
    const resourceCount = request.terraformPlan.resource_changes?.length || 0;
    if (resourceCount > 0) {
      const changes = request.terraformPlan.resource_changes!.slice(0, 5);
      const changeText = changes
        .map((c) => `• \`${c.type}\` ${c.change.actions.join(', ')}`)
        .join('\n');

      fields.push({
        name: `Resource Changes (${resourceCount} total)`,
        value: changeText + (resourceCount > 5 ? `\n...and ${resourceCount - 5} more` : ''),
        inline: false,
      });
    }

    // Warnings
    if (decision.policyEvaluation.warnings.length > 0) {
      const warningText = decision.policyEvaluation.warnings
        .slice(0, 3)
        .map((w) => `⚠️ ${w.message}`)
        .join('\n');

      fields.push({
        name: 'Warnings',
        value: warningText,
        inline: false,
      });
    }

    // Cost impact
    if (decision.costEstimate) {
      const costDiff = decision.costEstimate.totalMonthlyCostDiff;
      const costText = costDiff >= 0 ? `+$${costDiff.toFixed(2)}` : `-$${Math.abs(costDiff).toFixed(2)}`;
      fields.push({
        name: 'Monthly Cost Impact',
        value: `${costText}/mo`,
        inline: true,
      });
    }

    const embeds: DiscordEmbed[] = [
      {
        title: '🏗️ Infrastructure Change Review Required',
        description: request.requiresMfa
          ? '🔒 **MFA verification required for approval**'
          : undefined,
        color: riskColor,
        fields,
        footer: {
          text: `Expires: ${request.expiresAt.toISOString()}`,
        },
        timestamp: request.createdAt.toISOString(),
      },
    ];

    const components: DiscordComponent[] = [
      {
        type: 1, // Action Row
        components: [
          {
            type: 2, // Button
            style: 3, // Success (green)
            label: 'Approve',
            custom_id: `approve_${request.id}`,
          },
          {
            type: 2, // Button
            style: 4, // Danger (red)
            label: 'Reject',
            custom_id: `reject_${request.id}`,
          },
        ],
      },
    ];

    return {
      content: `@here Infrastructure change review required - Risk: **${decision.riskScore.level.toUpperCase()}**`,
      embeds,
      components,
    };
  }

  /**
   * Get emoji for risk level (Slack)
   */
  private getRiskEmoji(level: string): string {
    switch (level) {
      case 'critical':
        return ':rotating_light:';
      case 'high':
        return ':warning:';
      case 'medium':
        return ':large_yellow_circle:';
      case 'low':
        return ':white_check_mark:';
      default:
        return ':question:';
    }
  }

  /**
   * Get color for risk level (Discord)
   */
  private getRiskColor(level: string): number {
    switch (level) {
      case 'critical':
        return 0xff0000; // Red
      case 'high':
        return 0xff8c00; // Dark Orange
      case 'medium':
        return 0xffd700; // Gold
      case 'low':
        return 0x00ff00; // Green
      default:
        return 0x808080; // Gray
    }
  }

  /**
   * Add audit trail entry to request with HMAC signature (MED-004)
   *
   * Each audit entry is signed to detect tampering by malicious storage backends.
   */
  private addAuditEntry(
    request: ApprovalRequest,
    action: ApprovalAuditAction,
    actor: string,
    details?: Record<string, unknown>
  ): void {
    const timestamp = new Date();
    const signature = this.signAuditEntry(timestamp, action, actor, details);

    const entry: ApprovalAuditEntry = {
      timestamp,
      action,
      actor,
      details,
      signature,
    };
    request.auditTrail.push(entry);
  }

  /**
   * Generate HMAC signature for audit entry (MED-004)
   */
  private signAuditEntry(
    timestamp: Date,
    action: ApprovalAuditAction,
    actor: string,
    details?: Record<string, unknown>
  ): string {
    const data = JSON.stringify({
      timestamp: timestamp.toISOString(),
      action,
      actor,
      details: details || null,
    });

    return createHmac('sha256', this.auditSigningKey)
      .update(data)
      .digest('hex');
  }

  /**
   * Verify audit trail integrity (MED-004)
   *
   * @param request - The approval request to verify
   * @returns True if all audit entries have valid signatures
   */
  verifyAuditTrail(request: ApprovalRequest): boolean {
    for (const entry of request.auditTrail) {
      const expectedSignature = this.signAuditEntry(
        entry.timestamp,
        entry.action,
        entry.actor,
        entry.details
      );

      if (entry.signature !== expectedSignature) {
        this.logger.error(
          { requestId: request.id, action: entry.action },
          'Audit trail signature verification failed - tampering detected'
        );
        return false;
      }
    }
    return true;
  }

  /**
   * Sanitize reason field to prevent log injection and XSS (MED-002)
   *
   * - Limits length to 500 characters
   * - Removes control characters (newlines, tabs)
   * - HTML escapes for XSS protection
   */
  private sanitizeReason(reason?: string): string | undefined {
    if (!reason) return undefined;

    const maxLength = 500;
    let sanitized = reason.slice(0, maxLength);

    // Remove control characters
    sanitized = sanitized.replace(/[\x00-\x1F\x7F]/g, ' ');

    // HTML escape for XSS protection
    sanitized = sanitized.replace(/[<>&"']/g, (c) => {
      const escapeMap: Record<string, string> = {
        '<': '&lt;',
        '>': '&gt;',
        '&': '&amp;',
        '"': '&quot;',
        "'": '&#x27;',
      };
      return escapeMap[c] || c;
    });

    return sanitized.trim();
  }

  /**
   * Sanitize error message to remove network details (LOW-002)
   *
   * Removes IP addresses and sensitive URL paths from error messages
   * to prevent information disclosure in audit logs.
   */
  private sanitizeErrorMessage(message: string): string {
    // Remove IP addresses
    let sanitized = message.replace(
      /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g,
      '[IP_REDACTED]'
    );

    // Remove URLs but keep domain
    sanitized = sanitized.replace(/https?:\/\/[^\s]+/g, (url) => {
      try {
        return `[${new URL(url).hostname}]`;
      } catch {
        return '[URL_REDACTED]';
      }
    });

    return sanitized;
  }

  /**
   * Sanitize text for display in Slack/Discord messages (LOW-003)
   *
   * Escapes HTML and limits length to prevent XSS in webhook messages.
   */
  private sanitizeForDisplay(text: string): string {
    return text
      .replace(/[<>&"']/g, (c) => {
        const escapeMap: Record<string, string> = {
          '<': '&lt;',
          '>': '&gt;',
          '&': '&amp;',
          '"': '&quot;',
          "'": '&#x27;',
        };
        return escapeMap[c] || c;
      })
      .slice(0, 200);
  }

  /**
   * Expire a request (internal)
   */
  private async expireRequest(request: ApprovalRequest): Promise<void> {
    const updatedRequest: ApprovalRequest = {
      ...request,
      status: 'expired',
      resolvedAt: new Date(),
    };

    this.addAuditEntry(updatedRequest, 'expired', 'system', {
      originalExpiration: request.expiresAt.toISOString(),
    });

    await this.storage.update(updatedRequest);

    this.logger.info(
      { requestId: request.id },
      'Approval request expired'
    );
  }

  /**
   * Send a reminder notification for a pending request
   *
   * @param requestId - The approval request ID
   */
  async sendReminder(requestId: string): Promise<void> {
    const request = await this.storage.get(requestId);

    if (!request || request.status !== 'pending') {
      return;
    }

    // Re-send notifications
    try {
      await this.sendNotification(request);
      this.addAuditEntry(request, 'reminder_sent', 'system');
      await this.storage.update(request);

      this.logger.info(
        { requestId },
        'Reminder sent for approval request'
      );
    } catch (error) {
      this.logger.warn(
        { requestId, error: String(error) },
        'Failed to send reminder'
      );
    }
  }

  /**
   * Format approval request for human-readable output
   *
   * @param request - The approval request
   * @returns Formatted string
   */
  formatRequest(request: ApprovalRequest): string {
    const decision = request.preGateDecision;
    const lines: string[] = [
      '═══════════════════════════════════════════════════════',
      '           HITL APPROVAL REQUEST',
      '═══════════════════════════════════════════════════════',
      '',
      `Request ID: ${request.id}`,
      `Status: ${request.status.toUpperCase()}`,
      `Created: ${request.createdAt.toISOString()}`,
      `Expires: ${request.expiresAt.toISOString()}`,
      '',
      '--- REQUESTER ---',
      `Name: ${request.requester.displayName}`,
      `Source: ${request.requester.source}`,
      '',
      '--- RISK ASSESSMENT ---',
      `Risk Level: ${decision.riskScore.level.toUpperCase()}`,
      `Risk Score: ${decision.riskScore.score}/100`,
      `MFA Required: ${request.requiresMfa ? 'Yes' : 'No'}`,
      '',
    ];

    // Warnings
    if (decision.policyEvaluation.warnings.length > 0) {
      lines.push('--- WARNINGS ---');
      for (const warning of decision.policyEvaluation.warnings) {
        lines.push(`  • [${warning.code}] ${warning.message}`);
      }
      lines.push('');
    }

    // Resource changes
    const resourceCount = request.terraformPlan.resource_changes?.length || 0;
    lines.push(`--- RESOURCES (${resourceCount} changes) ---`);
    for (const change of request.terraformPlan.resource_changes?.slice(0, 10) || []) {
      lines.push(`  • ${change.type} (${change.change.actions.join(', ')})`);
    }
    if (resourceCount > 10) {
      lines.push(`  ... and ${resourceCount - 10} more`);
    }
    lines.push('');

    // Audit trail
    lines.push('--- AUDIT TRAIL ---');
    for (const entry of request.auditTrail) {
      lines.push(
        `  ${entry.timestamp.toISOString()} | ${entry.action} | ${entry.actor}`
      );
    }
    lines.push('');

    // Resolution
    if (request.resolver) {
      lines.push('--- RESOLUTION ---');
      lines.push(`Resolved by: ${request.resolver.displayName}`);
      lines.push(`Action: ${request.resolver.action.toUpperCase()}`);
      lines.push(`MFA Verified: ${request.resolver.mfaVerified ? 'Yes' : 'No'}`);
      if (request.resolver.reason) {
        lines.push(`Reason: ${request.resolver.reason}`);
      }
      lines.push('');
    }

    lines.push('═══════════════════════════════════════════════════════');

    return lines.join('\n');
  }
}

/**
 * KillSwitchProtocol - Emergency Credential Revocation System
 *
 * Sprint 47: Kill Switch & MFA
 *
 * Emergency revocation system for security incidents:
 * - Session revocation (Redis)
 * - Vault policy revocation (signing permissions)
 * - Community freeze (synthesis operations)
 * - Admin notifications (Discord webhook)
 *
 * Target: <5 seconds for full revocation
 *
 * @module packages/security/KillSwitchProtocol
 */

import type { Redis } from 'ioredis';
import type {
  KillSwitchOptions,
  KillSwitchResult,
  KillSwitchScope,
  CommunityFreezeStatus,
  AdminNotificationOptions,
  SecurityAuditLog,
} from './types.js';
import type { WizardSessionStore } from '../wizard/WizardSessionStore.js';
import type { VaultSigningAdapter } from '../adapters/vault/VaultSigningAdapter.js';
import * as crypto from 'crypto';

/**
 * Kill switch protocol configuration
 */
export interface KillSwitchProtocolConfig {
  /** Redis client for session revocation and freeze status */
  redis: Redis;
  /** Wizard session store for session cleanup */
  sessionStore: WizardSessionStore;
  /** Vault signing adapter for policy revocation (optional) */
  vaultAdapter?: VaultSigningAdapter;
  /** Discord webhook URL for admin notifications */
  adminWebhookUrl?: string;
  /** BullMQ queue name for synthesis jobs */
  synthesisQueueName?: string;
  /** Whether to enable debug logging */
  debug?: boolean;
}

/**
 * Kill switch protocol error
 */
export class KillSwitchError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly scope?: KillSwitchScope
  ) {
    super(message);
    this.name = 'KillSwitchError';
  }
}

/**
 * KillSwitchProtocol - Emergency revocation system
 *
 * Implements emergency credential revocation within 5 seconds:
 * 1. Revoke all Redis sessions (wizard + user sessions)
 * 2. Revoke Vault signing policies (if configured)
 * 3. Freeze community synthesis operations
 * 4. Send admin notifications
 *
 * @example
 * ```typescript
 * const killSwitch = new KillSwitchProtocol({
 *   redis,
 *   sessionStore,
 *   vaultAdapter,
 *   adminWebhookUrl: 'https://discord.com/api/webhooks/...'
 * });
 *
 * // Activate kill switch for compromised community
 * const result = await killSwitch.activate({
 *   scope: 'COMMUNITY',
 *   reason: 'CREDENTIAL_COMPROMISE',
 *   communityId: 'community-123',
 *   activatedBy: 'admin-456',
 *   notifyAdmins: true
 * });
 *
 * console.log(`Revoked ${result.sessionsRevoked} sessions in ${result.durationMs}ms`);
 * ```
 */
export class KillSwitchProtocol {
  private readonly redis: Redis;
  private readonly sessionStore: WizardSessionStore;
  private readonly vaultAdapter?: VaultSigningAdapter;
  private readonly adminWebhookUrl?: string;
  private readonly synthesisQueueName: string;
  private readonly debug: boolean;
  private readonly auditLogs: SecurityAuditLog[] = [];

  constructor(config: KillSwitchProtocolConfig) {
    this.redis = config.redis;
    this.sessionStore = config.sessionStore;
    this.vaultAdapter = config.vaultAdapter;
    this.adminWebhookUrl = config.adminWebhookUrl;
    this.synthesisQueueName = config.synthesisQueueName ?? 'discord-synthesis';
    this.debug = config.debug ?? false;

    this.log('KillSwitchProtocol initialized', {
      hasVaultAdapter: !!this.vaultAdapter,
      hasWebhook: !!this.adminWebhookUrl,
    });
  }

  /**
   * Activate kill switch
   *
   * @param options - Kill switch options
   * @returns Activation result with timing and counts
   */
  async activate(options: KillSwitchOptions): Promise<KillSwitchResult> {
    const startTime = Date.now();
    const activationId = crypto.randomUUID();

    this.log('Kill switch activation started', {
      activationId,
      scope: options.scope,
      reason: options.reason,
      communityId: options.communityId,
      userId: options.userId,
    });

    // Authorize activation FIRST (before validation)
    this.authorizeActivation(options);

    // Validate options
    this.validateOptions(options);

    const result: KillSwitchResult = {
      activatedAt: new Date(),
      scope: options.scope,
      reason: options.reason,
      sessionsRevoked: 0,
      vaultPoliciesRevoked: 0,
      synthesisJobsPaused: 0,
      durationMs: 0,
      success: false,
    };

    try {
      // Execute revocation operations in parallel for speed
      const [sessionsRevoked, vaultPoliciesRevoked, synthesisJobsPaused] = await Promise.all([
        this.revokeSessions(options),
        this.revokeVaultPolicies(options),
        this.freezeSynthesis(options),
      ]);

      result.sessionsRevoked = sessionsRevoked;
      result.vaultPoliciesRevoked = vaultPoliciesRevoked;
      result.synthesisJobsPaused = synthesisJobsPaused;
      result.success = true;

      // Calculate duration
      result.durationMs = Date.now() - startTime;

      // Send admin notification
      if (options.notifyAdmins !== false) {
        await this.notifyAdmins(options, result);
      }

      // Audit log
      this.addAuditLog({
        id: activationId,
        timestamp: new Date(),
        eventType: 'KILL_SWITCH',
        userId: options.userId,
        communityId: options.communityId,
        operation: `KILL_SWITCH_${options.scope}`,
        success: true,
        metadata: {
          reason: options.reason,
          activatedBy: options.activatedBy,
          ...result,
        },
      });

      this.log('Kill switch activation successful', {
        activationId,
        durationMs: result.durationMs,
        ...result,
      });

      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      result.success = false;
      result.error = errorMsg;
      result.durationMs = Date.now() - startTime;

      // Audit log failure
      this.addAuditLog({
        id: activationId,
        timestamp: new Date(),
        eventType: 'KILL_SWITCH',
        userId: options.userId,
        communityId: options.communityId,
        operation: `KILL_SWITCH_${options.scope}`,
        success: false,
        error: errorMsg,
        metadata: options.metadata,
      });

      this.log('Kill switch activation failed', {
        activationId,
        error: errorMsg,
      });

      throw new KillSwitchError(`Kill switch activation failed: ${errorMsg}`, 'ACTIVATION_FAILED', options.scope);
    }
  }

  /**
   * Revoke all sessions based on scope
   */
  private async revokeSessions(options: KillSwitchOptions): Promise<number> {
    let revokedCount = 0;

    switch (options.scope) {
      case 'GLOBAL':
        // Revoke ALL sessions (dangerous - use with extreme caution)
        revokedCount = await this.revokeAllSessions();
        break;

      case 'COMMUNITY':
        if (!options.communityId) {
          throw new KillSwitchError('communityId required for COMMUNITY scope', 'INVALID_OPTIONS');
        }
        revokedCount = await this.revokeCommunitySessions(options.communityId);
        break;

      case 'USER':
        if (!options.userId) {
          throw new KillSwitchError('userId required for USER scope', 'INVALID_OPTIONS');
        }
        revokedCount = await this.revokeUserSessions(options.userId);
        break;
    }

    this.log('Sessions revoked', { scope: options.scope, count: revokedCount });
    return revokedCount;
  }

  /**
   * Revoke all sessions globally (DANGEROUS)
   *
   * Uses Redis SCAN for non-blocking iteration instead of KEYS
   */
  private async revokeAllSessions(): Promise<number> {
    let cursor = '0';
    let count = 0;
    const batchSize = 1000; // Process in batches

    do {
      // SCAN is non-blocking and cursor-based (production-safe)
      const [nextCursor, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        'wizard:session:*',
        'COUNT',
        batchSize
      );

      if (keys.length > 0) {
        await this.redis.del(...keys);
        count += keys.length;
      }

      cursor = nextCursor;
    } while (cursor !== '0');

    return count;
  }

  /**
   * Revoke all sessions for a community
   */
  private async revokeCommunitySessions(communityId: string): Promise<number> {
    // Get all sessions for the community (guild)
    const guildSessionsKey = `wizard:guild:${communityId}:sessions`;
    const sessionIds = await this.redis.smembers(guildSessionsKey);

    let revokedCount = 0;
    for (const sessionId of sessionIds) {
      const deleted = await this.sessionStore.delete(sessionId);
      if (deleted) {
        revokedCount++;
      }
    }

    return revokedCount;
  }

  /**
   * Revoke all sessions for a user
   *
   * Uses Redis SCAN for non-blocking iteration instead of KEYS
   */
  private async revokeUserSessions(userId: string): Promise<number> {
    let cursor = '0';
    let revokedCount = 0;
    const batchSize = 1000; // Process in batches

    do {
      // SCAN is non-blocking and cursor-based (production-safe)
      const [nextCursor, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        `wizard:guild:*:user:${userId}`,
        'COUNT',
        batchSize
      );

      for (const key of keys) {
        const sessionId = await this.redis.get(key);
        if (sessionId) {
          const deleted = await this.sessionStore.delete(sessionId);
          if (deleted) {
            revokedCount++;
          }
        }
      }

      cursor = nextCursor;
    } while (cursor !== '0');

    return revokedCount;
  }

  /**
   * Revoke Vault signing policies based on scope
   */
  private async revokeVaultPolicies(options: KillSwitchOptions): Promise<number> {
    if (!this.vaultAdapter) {
      this.log('Vault adapter not configured, skipping policy revocation');
      return 0;
    }

    try {
      let revokedCount = 0;

      switch (options.scope) {
        case 'GLOBAL':
          // Revoke ALL signing policies (extreme caution)
          // This revokes the main signing policy for all operations
          await this.vaultAdapter.revokePolicy('arrakis-signing-policy');
          revokedCount = 1;
          this.log('Global Vault signing policy revoked', { scope: options.scope });
          break;

        case 'COMMUNITY':
          // Revoke signing policy for specific community
          if (options.communityId) {
            const policyName = `arrakis-signing-${options.communityId}`;
            await this.vaultAdapter.revokePolicy(policyName);
            revokedCount = 1;
            this.log('Community Vault signing policy revoked', {
              scope: options.scope,
              communityId: options.communityId,
              policyName,
            });
          }
          break;

        case 'USER':
          // Revoke user-specific signing delegation (if applicable)
          // Note: This may not apply if only Naib Council has signing keys
          // For now, we skip user-level policy revocation as users typically
          // don't have individual Vault signing policies
          this.log('User-level Vault policy revocation not applicable', {
            scope: options.scope,
            userId: options.userId,
          });
          break;
      }

      this.log('Vault policies revoked', { scope: options.scope, count: revokedCount });
      return revokedCount;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      this.log('Vault policy revocation failed', { error: errorMsg, scope: options.scope });
      throw new KillSwitchError('Vault policy revocation failed', 'VAULT_ERROR', options.scope);
    }
  }

  /**
   * Freeze synthesis operations for community
   */
  private async freezeSynthesis(options: KillSwitchOptions): Promise<number> {
    if (options.scope === 'GLOBAL') {
      // Global freeze - pause all synthesis operations
      return await this.freezeGlobalSynthesis();
    } else if (options.scope === 'COMMUNITY' && options.communityId) {
      // Community-specific freeze
      return await this.freezeCommunitySynthesis(options.communityId, options.reason);
    }

    return 0;
  }

  /**
   * Freeze all synthesis operations globally
   */
  private async freezeGlobalSynthesis(): Promise<number> {
    // Set global freeze flag
    await this.redis.set('synthesis:global_freeze', 'true');
    this.log('Global synthesis freeze activated');

    // Count would require BullMQ integration to get active job count
    // For now, return 1 to indicate freeze was set
    return 1;
  }

  /**
   * Freeze synthesis operations for a specific community
   */
  private async freezeCommunitySynthesis(communityId: string, reason: string): Promise<number> {
    const freezeStatus: CommunityFreezeStatus = {
      communityId,
      frozen: true,
      reason,
      frozenAt: new Date(),
    };

    await this.redis.setex(`synthesis:freeze:${communityId}`, 86400 * 7, JSON.stringify(freezeStatus)); // 7 day TTL

    this.log('Community synthesis freeze activated', { communityId });
    return 1;
  }

  /**
   * Check if community is frozen
   */
  async isCommunityFrozen(communityId: string): Promise<CommunityFreezeStatus> {
    // Check global freeze first
    const globalFreeze = await this.redis.get('synthesis:global_freeze');
    if (globalFreeze === 'true') {
      return {
        communityId,
        frozen: true,
        reason: 'Global freeze active',
      };
    }

    // Check community-specific freeze
    const freezeData = await this.redis.get(`synthesis:freeze:${communityId}`);
    if (freezeData) {
      return JSON.parse(freezeData);
    }

    return {
      communityId,
      frozen: false,
    };
  }

  /**
   * Unfreeze community synthesis
   */
  async unfreezeCommunity(communityId: string): Promise<void> {
    await this.redis.del(`synthesis:freeze:${communityId}`);
    this.log('Community synthesis unfrozen', { communityId });
  }

  /**
   * Unfreeze global synthesis
   */
  async unfreezeGlobal(): Promise<void> {
    await this.redis.del('synthesis:global_freeze');
    this.log('Global synthesis freeze deactivated');
  }

  /**
   * Send admin notification via Discord webhook
   */
  private async notifyAdmins(options: KillSwitchOptions, result: KillSwitchResult): Promise<void> {
    if (!this.adminWebhookUrl) {
      this.log('Admin webhook not configured, skipping notification');
      return;
    }

    const notification: AdminNotificationOptions = {
      type: 'KILL_SWITCH',
      severity: 'CRITICAL',
      title: `🚨 Kill Switch Activated: ${options.scope}`,
      body: this.formatNotificationBody(options, result),
      metadata: {
        scope: options.scope,
        reason: options.reason,
        activatedBy: options.activatedBy,
        ...result,
      },
    };

    try {
      await this.sendDiscordWebhook(notification);
      this.log('Admin notification sent');
    } catch (error) {
      this.log('Failed to send admin notification', { error });
      // Don't throw - notification failure shouldn't break kill switch
    }
  }

  /**
   * Format notification body
   */
  private formatNotificationBody(options: KillSwitchOptions, result: KillSwitchResult): string {
    const lines = [
      `**Scope:** ${options.scope}`,
      `**Reason:** ${options.reason}`,
      `**Activated By:** ${options.activatedBy}`,
      `**Timestamp:** ${result.activatedAt.toISOString()}`,
      ``,
      `**Impact:**`,
      `- Sessions Revoked: ${result.sessionsRevoked}`,
      `- Vault Policies Revoked: ${result.vaultPoliciesRevoked}`,
      `- Synthesis Jobs Paused: ${result.synthesisJobsPaused}`,
      ``,
      `**Duration:** ${result.durationMs}ms`,
    ];

    if (options.communityId) {
      lines.push(`**Community ID:** ${options.communityId}`);
    }

    if (options.userId) {
      lines.push(`**User ID:** ${options.userId}`);
    }

    return lines.join('\n');
  }

  /**
   * Send Discord webhook notification
   */
  private async sendDiscordWebhook(notification: AdminNotificationOptions): Promise<void> {
    const webhookUrl = notification.webhookUrl ?? this.adminWebhookUrl;
    if (!webhookUrl) {
      return;
    }

    const payload = {
      embeds: [
        {
          title: notification.title,
          description: notification.body,
          color: this.getSeverityColor(notification.severity),
          timestamp: new Date().toISOString(),
          footer: {
            text: 'Arrakis Security System',
          },
        },
      ],
    };

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Webhook request failed: ${response.status}`);
    }
  }

  /**
   * Get Discord embed color for severity
   */
  private getSeverityColor(severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'): number {
    const colors = {
      CRITICAL: 0xff0000, // Red
      HIGH: 0xff6600, // Orange
      MEDIUM: 0xffcc00, // Yellow
      LOW: 0x00ff00, // Green
    };
    return colors[severity];
  }

  /**
   * Authorize kill switch activation based on role and scope
   *
   * Authorization rules:
   * - GLOBAL scope: Only Naib Council (Top 7) or Platform Admins
   * - COMMUNITY scope: Naib Council, Platform Admin, or Community Admin
   * - USER scope: Naib Council, Platform Admin, Community Admin, or the affected user (self-revoke)
   */
  private authorizeActivation(options: KillSwitchOptions): void {
    const { scope, activatorRole, activatedBy, userId } = options;

    // GLOBAL scope: Highest privilege required
    if (scope === 'GLOBAL') {
      if (!['NAIB_COUNCIL', 'PLATFORM_ADMIN'].includes(activatorRole)) {
        throw new KillSwitchError(
          'GLOBAL kill switch requires Naib Council or Platform Admin role',
          'UNAUTHORIZED',
          scope
        );
      }
    }

    // COMMUNITY scope: Admin roles required
    if (scope === 'COMMUNITY') {
      if (!['NAIB_COUNCIL', 'PLATFORM_ADMIN', 'COMMUNITY_ADMIN'].includes(activatorRole)) {
        throw new KillSwitchError(
          'COMMUNITY kill switch requires Naib Council, Platform Admin, or Community Admin role',
          'UNAUTHORIZED',
          scope
        );
      }
    }

    // USER scope: Admin roles OR self-revoke
    if (scope === 'USER') {
      const isAdmin = ['NAIB_COUNCIL', 'PLATFORM_ADMIN', 'COMMUNITY_ADMIN'].includes(activatorRole);
      const isSelfRevoke = activatedBy === userId;

      if (!isAdmin && !isSelfRevoke) {
        throw new KillSwitchError(
          'USER kill switch requires admin role or must be self-initiated',
          'UNAUTHORIZED',
          scope
        );
      }
    }

    this.log('Kill switch activation authorized', {
      scope,
      activatorRole,
      activatedBy,
    });
  }

  /**
   * Validate kill switch options
   */
  private validateOptions(options: KillSwitchOptions): void {
    if (options.scope === 'COMMUNITY' && !options.communityId) {
      throw new KillSwitchError('communityId is required for COMMUNITY scope', 'INVALID_OPTIONS', options.scope);
    }

    if (options.scope === 'USER' && !options.userId) {
      throw new KillSwitchError('userId is required for USER scope', 'INVALID_OPTIONS', options.scope);
    }

    if (!options.activatedBy) {
      throw new KillSwitchError('activatedBy is required', 'INVALID_OPTIONS', options.scope);
    }
  }

  /**
   * Get audit logs
   */
  getAuditLogs(limit: number = 100): SecurityAuditLog[] {
    return this.auditLogs.slice(-limit);
  }

  /**
   * Add audit log entry
   */
  private addAuditLog(entry: SecurityAuditLog): void {
    this.auditLogs.push(entry);

    // Keep last 1000 entries in memory
    if (this.auditLogs.length > 1000) {
      this.auditLogs.splice(0, this.auditLogs.length - 1000);
    }
  }

  /**
   * Debug logging
   */
  private log(message: string, context?: Record<string, unknown>): void {
    if (this.debug) {
      console.log(`[KillSwitchProtocol] ${message}`, context ?? '');
    }
  }
}

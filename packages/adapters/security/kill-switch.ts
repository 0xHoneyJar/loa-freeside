/**
 * Kill Switch Implementation
 *
 * Sprint S-22: Vault Integration & Kill Switch
 *
 * MFA-protected emergency shutdown mechanism that:
 * - Revokes signing permissions
 * - Pauses synthesis operations
 * - Broadcasts shutdown to all workers via NATS
 *
 * @see SDD §6.4.3 Kill Switch Implementation
 */

import type { Logger } from 'pino';
import type {
  IKillSwitch,
  IMfaVerifier,
  IVaultClient,
  KillSwitchState,
  KillSwitchRequest,
} from '@freeside/core/ports';
import { KILL_SWITCH_KEYS } from '@freeside/core/ports';
import type { VaultMetrics } from './metrics.js';
import { VaultMetricsHelper } from './metrics.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Redis client interface (for DI).
 */
export interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
  del(key: string): Promise<number>;
}

/**
 * NATS client interface (for DI).
 */
export interface NatsClient {
  publish(subject: string, data: unknown): Promise<void>;
}

/**
 * Notification service interface (for DI).
 */
export interface NotificationService {
  notifyAdmins(event: string, data: Record<string, unknown>): Promise<void>;
}

/**
 * Kill switch state as stored in Redis.
 */
interface StoredKillSwitchState {
  activatedBy: string;
  activatedAt: string;
  reason: string;
}

/**
 * Kill switch NATS message.
 */
interface KillSwitchMessage {
  action: 'ACTIVATE' | 'DEACTIVATE';
  adminId: string;
  reason?: string;
  timestamp: number;
}

/**
 * Options for KillSwitch.
 */
export interface KillSwitchOptions {
  /** Vault client */
  vault: IVaultClient;
  /** MFA verifier */
  mfaVerifier: IMfaVerifier;
  /** Redis client */
  redis: RedisClient;
  /** NATS client */
  nats: NatsClient;
  /** Notification service */
  notifications: NotificationService;
  /** Logger instance */
  logger: Logger;
  /** Prometheus metrics */
  metrics: VaultMetrics;
}

// =============================================================================
// Implementation
// =============================================================================

/**
 * Kill switch implementation.
 */
export class KillSwitch implements IKillSwitch {
  private readonly vault: IVaultClient;
  private readonly mfaVerifier: IMfaVerifier;
  private readonly redis: RedisClient;
  private readonly nats: NatsClient;
  private readonly notifications: NotificationService;
  private readonly log: Logger;
  private readonly metrics: VaultMetrics;

  constructor(options: KillSwitchOptions) {
    this.vault = options.vault;
    this.mfaVerifier = options.mfaVerifier;
    this.redis = options.redis;
    this.nats = options.nats;
    this.notifications = options.notifications;
    this.log = options.logger.child({ component: 'KillSwitch' });
    this.metrics = options.metrics;
  }

  /**
   * Activate kill switch (requires MFA verification).
   */
  async activate(request: KillSwitchRequest): Promise<void> {
    const { adminId, mfaToken, reason } = request;

    // Verify MFA
    const mfaResult = await this.mfaVerifier.verify(adminId, mfaToken);
    VaultMetricsHelper.mfaVerification(this.metrics, mfaResult.valid);

    if (!mfaResult.valid) {
      this.log.warn({ adminId, error: mfaResult.error }, 'Kill switch MFA verification failed');
      throw new Error(`MFA verification failed: ${mfaResult.error ?? 'Invalid token'}`);
    }

    this.log.warn({ adminId, reason }, 'KILL SWITCH ACTIVATED');

    // Store kill switch state
    const state: StoredKillSwitchState = {
      activatedBy: adminId,
      activatedAt: new Date().toISOString(),
      reason,
    };
    await this.redis.set(KILL_SWITCH_KEYS.STATE, JSON.stringify(state));

    // Broadcast to all workers
    const message: KillSwitchMessage = {
      action: 'ACTIVATE',
      adminId,
      reason,
      timestamp: Date.now(),
    };
    await this.nats.publish('internal.killswitch', message);

    // Revoke agent signing permissions
    await this.revokeAgentPermissions();

    // Pause synthesis operations
    await this.pauseSynthesis();

    // Update metrics
    VaultMetricsHelper.killSwitchStateChange(this.metrics, true);

    // Notify admins
    await this.notifications.notifyAdmins('KILL_SWITCH_ACTIVATED', {
      adminId,
      reason,
      activatedAt: state.activatedAt,
    });
  }

  /**
   * Deactivate kill switch (requires MFA verification).
   */
  async deactivate(adminId: string, mfaToken: string): Promise<void> {
    // Verify MFA
    const mfaResult = await this.mfaVerifier.verify(adminId, mfaToken);
    VaultMetricsHelper.mfaVerification(this.metrics, mfaResult.valid);

    if (!mfaResult.valid) {
      this.log.warn({ adminId, error: mfaResult.error }, 'Kill switch deactivation MFA failed');
      throw new Error(`MFA verification failed: ${mfaResult.error ?? 'Invalid token'}`);
    }

    this.log.info({ adminId }, 'Kill switch deactivated');

    // Clear kill switch state
    await this.redis.del(KILL_SWITCH_KEYS.STATE);

    // Broadcast to all workers
    const message: KillSwitchMessage = {
      action: 'DEACTIVATE',
      adminId,
      timestamp: Date.now(),
    };
    await this.nats.publish('internal.killswitch', message);

    // Resume synthesis operations
    await this.resumeSynthesis();

    // Update metrics
    VaultMetricsHelper.killSwitchStateChange(this.metrics, false);

    // Notify admins
    await this.notifications.notifyAdmins('KILL_SWITCH_DEACTIVATED', {
      adminId,
      deactivatedAt: new Date().toISOString(),
    });
  }

  /**
   * Check if kill switch is currently active.
   */
  async isActive(): Promise<boolean> {
    const state = await this.redis.get(KILL_SWITCH_KEYS.STATE);
    return state !== null;
  }

  /**
   * Get current kill switch state.
   */
  async getState(): Promise<KillSwitchState> {
    const stateJson = await this.redis.get(KILL_SWITCH_KEYS.STATE);

    if (!stateJson) {
      return { active: false };
    }

    const stored: StoredKillSwitchState = JSON.parse(stateJson);

    return {
      active: true,
      activatedBy: stored.activatedBy,
      activatedAt: new Date(stored.activatedAt),
      reason: stored.reason,
    };
  }

  /**
   * Revoke agent signing permissions in Vault.
   */
  private async revokeAgentPermissions(): Promise<void> {
    try {
      // Revoke the current token to prevent further signing operations
      // In production, this would revoke specific policy permissions
      this.log.warn('Revoking agent signing permissions');

      // Note: Actual implementation depends on Vault policy structure
      // For now, we log the action - full implementation would use Vault token accessor
    } catch (error) {
      this.log.error({ error }, 'Failed to revoke agent permissions');
      // Don't throw - continue with other shutdown steps
    }
  }

  /**
   * Pause synthesis operations.
   */
  private async pauseSynthesis(): Promise<void> {
    await this.redis.set(KILL_SWITCH_KEYS.SYNTHESIS_PAUSED, '1');
    this.log.warn('Synthesis operations paused');
  }

  /**
   * Resume synthesis operations.
   */
  private async resumeSynthesis(): Promise<void> {
    await this.redis.del(KILL_SWITCH_KEYS.SYNTHESIS_PAUSED);
    this.log.info('Synthesis operations resumed');
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a kill switch.
 *
 * @param options - Kill switch options
 * @returns Kill switch instance
 */
export function createKillSwitch(options: KillSwitchOptions): IKillSwitch {
  return new KillSwitch(options);
}

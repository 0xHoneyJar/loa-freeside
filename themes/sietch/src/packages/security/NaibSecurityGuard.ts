/**
 * NaibSecurityGuard - MFA Middleware for Destructive Operations
 *
 * Sprint 47: Kill Switch & MFA
 *
 * Security middleware that requires MFA verification for destructive operations.
 *
 * Protected operations:
 * - DELETE_CHANNEL
 * - DELETE_ROLE
 * - DELETE_COMMUNITY
 * - KILL_SWITCH
 * - VAULT_KEY_ROTATION
 * - PURGE_DATA
 *
 * @module packages/security/NaibSecurityGuard
 */

import type { MFAService } from './MFAService.js';
import type {
  SecurityGuardRequest,
  SecurityGuardResult,
  SecurityGuardConfig,
  ProtectedOperation,
  SecurityAuditLog,
} from './types.js';
import * as crypto from 'crypto';

/**
 * Default protected operations requiring MFA
 */
export const DEFAULT_PROTECTED_OPERATIONS: ProtectedOperation[] = [
  'DELETE_CHANNEL',
  'DELETE_ROLE',
  'DELETE_COMMUNITY',
  'KILL_SWITCH',
  'VAULT_KEY_ROTATION',
  'PURGE_DATA',
  'ADMIN_OVERRIDE',
];

// =============================================================================
// MFA Verification Metrics (Sprint 83 - LOW-3)
// =============================================================================

/**
 * MFA verification metrics for monitoring and alerting
 *
 * Sprint 83 (LOW-3): Track MFA success/failure for security monitoring
 */
export interface MFAVerificationMetrics {
  /** Total successful verifications */
  successCount: number;
  /** Total failed verifications */
  failureCount: number;
  /** Failures by user (for repeated failure alerting) */
  failuresByUser: Map<string, number>;
  /** Failures by operation */
  failuresByOperation: Map<string, number>;
  /** Timestamp of last failure (for alert windows) */
  lastFailureAt?: Date;
}

// Global metrics instance
const mfaMetrics: MFAVerificationMetrics = {
  successCount: 0,
  failureCount: 0,
  failuresByUser: new Map(),
  failuresByOperation: new Map(),
};

/**
 * Get MFA verification metrics
 *
 * Sprint 83 (LOW-3): Returns current MFA metrics for monitoring
 */
export function getMFAVerificationMetrics(): {
  successCount: number;
  failureCount: number;
  totalCount: number;
  successRate: number;
  lastFailureAt?: Date;
} {
  const totalCount = mfaMetrics.successCount + mfaMetrics.failureCount;
  return {
    successCount: mfaMetrics.successCount,
    failureCount: mfaMetrics.failureCount,
    totalCount,
    successRate: totalCount > 0 ? mfaMetrics.successCount / totalCount : 1,
    lastFailureAt: mfaMetrics.lastFailureAt,
  };
}

/**
 * Get repeated failure alerts
 *
 * Sprint 83 (LOW-3): Returns users with repeated MFA failures
 * Default threshold: 5 failures triggers alert
 *
 * @param threshold - Number of failures to trigger alert (default: 5)
 */
export function getMFAFailureAlerts(threshold = 5): Array<{
  userId: string;
  failureCount: number;
}> {
  const alerts: Array<{ userId: string; failureCount: number }> = [];
  for (const [userId, count] of mfaMetrics.failuresByUser) {
    if (count >= threshold) {
      alerts.push({ userId, failureCount: count });
    }
  }
  return alerts;
}

/**
 * Reset MFA metrics (for testing)
 */
export function resetMFAVerificationMetrics(): void {
  mfaMetrics.successCount = 0;
  mfaMetrics.failureCount = 0;
  mfaMetrics.failuresByUser.clear();
  mfaMetrics.failuresByOperation.clear();
  mfaMetrics.lastFailureAt = undefined;
}

/**
 * Record MFA verification result
 *
 * @internal Called by NaibSecurityGuard.verify()
 */
function recordMFAMetric(
  success: boolean,
  userId: string,
  operation: ProtectedOperation
): void {
  if (success) {
    mfaMetrics.successCount++;
    // Reset user failure count on success
    mfaMetrics.failuresByUser.delete(userId);
  } else {
    mfaMetrics.failureCount++;
    mfaMetrics.lastFailureAt = new Date();

    // Track per-user failures
    const userFailures = mfaMetrics.failuresByUser.get(userId) ?? 0;
    mfaMetrics.failuresByUser.set(userId, userFailures + 1);

    // Track per-operation failures
    const opFailures = mfaMetrics.failuresByOperation.get(operation) ?? 0;
    mfaMetrics.failuresByOperation.set(operation, opFailures + 1);
  }
}

/**
 * Security guard error
 */
export class SecurityGuardError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly operation?: ProtectedOperation
  ) {
    super(message);
    this.name = 'SecurityGuardError';
  }
}

/**
 * NaibSecurityGuard - MFA-protected operation middleware
 *
 * Enforces MFA verification before allowing destructive operations.
 * All verification attempts are logged for audit purposes.
 *
 * @example
 * ```typescript
 * const guard = new NaibSecurityGuard({
 *   mfaService,
 *   protectedOperations: DEFAULT_PROTECTED_OPERATIONS,
 *   requireMfaForDestructive: true,
 *   maxVerificationAttempts: 5,
 *   notifyAdmins: true
 * });
 *
 * // Verify operation is allowed
 * const result = await guard.verify({
 *   operation: 'DELETE_CHANNEL',
 *   userId: 'user-123',
 *   communityId: 'community-456',
 *   mfaVerification: {
 *     userId: 'user-123',
 *     operation: 'DELETE_CHANNEL',
 *     totpCode: '123456'
 *   }
 * });
 *
 * if (result.allowed) {
 *   // Proceed with operation
 * } else {
 *   // Deny operation
 *   console.log(result.denialReason);
 * }
 * ```
 */
export class NaibSecurityGuard {
  private readonly mfaService: MFAService;
  private readonly config: SecurityGuardConfig;
  private readonly auditLogs: SecurityAuditLog[] = [];

  constructor(mfaService: MFAService, config?: Partial<SecurityGuardConfig>) {
    this.mfaService = mfaService;
    this.config = {
      protectedOperations: config?.protectedOperations ?? DEFAULT_PROTECTED_OPERATIONS,
      requireMfaForDestructive: config?.requireMfaForDestructive ?? true,
      maxVerificationAttempts: config?.maxVerificationAttempts ?? 5,
      verificationWindow: config?.verificationWindow ?? 300, // 5 minutes
      notifyAdmins: config?.notifyAdmins ?? false,
    };
  }

  /**
   * Verify if operation is allowed
   *
   * @param request - Security guard request
   * @returns Verification result
   */
  async verify(request: SecurityGuardRequest): Promise<SecurityGuardResult> {
    const auditLogId = crypto.randomUUID();
    const verifiedAt = new Date();

    // Check if operation requires protection
    if (!this.isProtectedOperation(request.operation)) {
      // Operation doesn't require MFA - allow
      return {
        allowed: true,
        verifiedAt,
        mfaResult: {
          valid: true,
          verifiedAt,
        },
      };
    }

    // Verify MFA
    const mfaResult = await this.mfaService.verify(request.mfaVerification);

    // Sprint 83 (LOW-3): Record MFA metrics for monitoring
    recordMFAMetric(mfaResult.valid, request.userId, request.operation);

    const result: SecurityGuardResult = {
      allowed: mfaResult.valid,
      verifiedAt,
      mfaResult,
      auditLogId,
    };

    if (!mfaResult.valid) {
      result.denialReason = mfaResult.error ?? 'MFA verification failed';
    }

    // Audit log
    this.addAuditLog({
      id: auditLogId,
      timestamp: verifiedAt,
      eventType: 'SECURITY_GUARD',
      userId: request.userId,
      communityId: request.communityId,
      operation: request.operation,
      success: mfaResult.valid,
      error: mfaResult.valid ? undefined : mfaResult.error,
      metadata: {
        mfaMethod: mfaResult.method,
        metric: mfaResult.valid ? 'sietch_mfa_verification_success_total' : 'sietch_mfa_verification_failure_total',
        ...request.metadata,
      },
    });

    return result;
  }

  /**
   * Check if operation is protected
   *
   * @param operation - Operation to check
   * @returns Whether operation requires MFA
   */
  isProtectedOperation(operation: ProtectedOperation): boolean {
    return this.config.protectedOperations.includes(operation);
  }

  /**
   * Add operation to protected list
   *
   * @param operation - Operation to protect
   */
  addProtectedOperation(operation: ProtectedOperation): void {
    if (!this.config.protectedOperations.includes(operation)) {
      this.config.protectedOperations.push(operation);
    }
  }

  /**
   * Remove operation from protected list
   *
   * @param operation - Operation to unprotect
   */
  removeProtectedOperation(operation: ProtectedOperation): void {
    const index = this.config.protectedOperations.indexOf(operation);
    if (index !== -1) {
      this.config.protectedOperations.splice(index, 1);
    }
  }

  /**
   * Get configuration
   */
  getConfig(): SecurityGuardConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<SecurityGuardConfig>): void {
    Object.assign(this.config, updates);
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
   * Express middleware factory
   *
   * Creates Express middleware for protecting routes
   *
   * @param operation - Operation to protect
   * @returns Express middleware function
   *
   * @example
   * ```typescript
   * app.delete('/channel/:id',
   *   guard.middleware('DELETE_CHANNEL'),
   *   async (req, res) => {
   *     // Operation is MFA-verified at this point
   *   }
   * );
   * ```
   */
  middleware(operation: ProtectedOperation) {
    return async (req: any, res: any, next: any) => {
      // Extract MFA verification from request
      // This assumes MFA code is in request body or headers
      const mfaVerification = {
        userId: req.user?.id ?? req.body?.userId,
        operation,
        totpCode: req.body?.totpCode ?? req.headers['x-totp-code'],
        backupCode: req.body?.backupCode,
      };

      const request: SecurityGuardRequest = {
        operation,
        userId: mfaVerification.userId,
        communityId: req.params?.communityId ?? req.body?.communityId,
        mfaVerification,
        metadata: {
          ip: req.ip,
          userAgent: req.headers['user-agent'],
        },
      };

      try {
        const result = await this.verify(request);

        if (result.allowed) {
          // Attach verification result to request for downstream use
          req.securityGuardResult = result;
          next();
        } else {
          res.status(403).json({
            error: 'Operation denied',
            reason: result.denialReason,
            auditLogId: result.auditLogId,
          });
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({
          error: 'Security guard verification failed',
          message: errorMsg,
        });
      }
    };
  }

  /**
   * Discord.js interaction guard
   *
   * Guards Discord interactions (slash commands, buttons, etc.)
   *
   * @param operation - Operation to protect
   * @returns Guard function for Discord interactions
   *
   * @example
   * ```typescript
   * client.on('interactionCreate', async (interaction) => {
   *   if (interaction.commandName === 'delete-channel') {
   *     const allowed = await guard.guardInteraction('DELETE_CHANNEL', interaction);
   *     if (!allowed) {
   *       await interaction.reply({ content: 'MFA verification required', ephemeral: true });
   *       return;
   *     }
   *     // Proceed with deletion
   *   }
   * });
   * ```
   */
  async guardInteraction(operation: ProtectedOperation, interaction: any): Promise<boolean> {
    // Extract MFA code from interaction options or modal
    const totpCode = interaction.options?.getString('totp_code');
    const backupCode = interaction.options?.getString('backup_code');

    const request: SecurityGuardRequest = {
      operation,
      userId: interaction.user.id,
      communityId: interaction.guildId,
      mfaVerification: {
        userId: interaction.user.id,
        operation,
        totpCode,
        backupCode,
      },
      metadata: {
        interactionType: interaction.type,
        commandName: interaction.commandName,
      },
    };

    const result = await this.verify(request);
    return result.allowed;
  }
}

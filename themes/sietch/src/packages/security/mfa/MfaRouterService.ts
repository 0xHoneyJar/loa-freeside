/**
 * MFA Router Service - Tier-Based MFA Provider Routing
 *
 * Sprint 68: MFA Hardening & Observability
 *
 * Routes MFA verification requests to the appropriate provider based on
 * operation risk tier. Ensures CRITICAL operations use hardware MFA (Duo).
 *
 * Risk Tier Routing:
 * | Risk Tier | MFA Provider |
 * |-----------|--------------|
 * | LOW       | None required |
 * | MEDIUM    | TOTP (software) |
 * | HIGH      | TOTP or Duo |
 * | CRITICAL  | Duo required (hardware) |
 *
 * @module packages/security/mfa/MfaRouterService
 */

import type { MfaVerifier } from '../../infrastructure/EnhancedHITLApprovalGate.js';
import type { MFAService } from '../MFAService.js';
import type { DuoMfaVerifier } from './DuoMfaVerifier.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Risk tier levels for MFA routing
 */
export type RiskTier = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/**
 * MFA methods available
 */
export type MfaMethod = 'none' | 'totp' | 'duo';

/**
 * MFA Router configuration
 */
export interface MfaRouterConfig {
  /** TOTP verifier (MFAService) for software MFA */
  totpVerifier: MFAService;
  /** Duo verifier for hardware MFA (optional, but required for CRITICAL) */
  duoVerifier?: DuoMfaVerifier;
  /** Custom tier routing rules (optional) */
  tierRouting?: Record<RiskTier, MfaMethod[]>;
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * MFA verification request with tier context
 */
export interface TieredMfaRequest {
  /** User ID */
  userId: string;
  /** Risk tier for this operation */
  riskTier: RiskTier;
  /** MFA code (TOTP code, Duo passcode, or 'push') */
  code: string;
  /** Preferred method (optional - will use routing rules if not specified) */
  preferredMethod?: MfaMethod;
  /** Operation type for audit logging */
  operationType?: string;
}

/**
 * MFA verification result with method tracking
 */
export interface TieredMfaResult {
  /** Whether verification succeeded */
  valid: boolean;
  /** Method used for verification */
  methodUsed: MfaMethod;
  /** Risk tier of the operation */
  riskTier: RiskTier;
  /** Error message if failed */
  error?: string;
  /** Whether Duo was required but unavailable */
  duoRequired: boolean;
  /** Timestamp of verification */
  verifiedAt?: Date;
}

// =============================================================================
// Constants
// =============================================================================

/**
 * Default tier routing rules
 */
const DEFAULT_TIER_ROUTING: Record<RiskTier, MfaMethod[]> = {
  LOW: ['none'],
  MEDIUM: ['totp'],
  HIGH: ['totp', 'duo'],
  CRITICAL: ['duo'], // Duo required for CRITICAL
};

// =============================================================================
// Implementation
// =============================================================================

/**
 * MFA Router Service
 *
 * Routes MFA verification to appropriate provider based on risk tier.
 * Implements the MfaVerifier interface for use with EnhancedHITLApprovalGate.
 *
 * @example
 * ```typescript
 * const router = new MfaRouterService({
 *   totpVerifier: mfaService,
 *   duoVerifier: duoVerifier,
 * });
 *
 * // Verify CRITICAL operation (Duo required)
 * const result = await router.verifyWithTier({
 *   userId: 'user123',
 *   riskTier: 'CRITICAL',
 *   code: 'push', // Duo push
 * });
 *
 * // Verify MEDIUM operation (TOTP)
 * const result = await router.verifyWithTier({
 *   userId: 'user123',
 *   riskTier: 'MEDIUM',
 *   code: '123456', // TOTP code
 * });
 * ```
 */
export class MfaRouterService implements MfaVerifier {
  private readonly totpVerifier: MFAService;
  private readonly duoVerifier?: DuoMfaVerifier;
  private readonly tierRouting: Record<RiskTier, MfaMethod[]>;
  private readonly debug: boolean;

  // Metrics (Sprint 68.5 will add Prometheus counters)
  private mfaAttemptCount = 0;
  private mfaSuccessCount = 0;
  private mfaTimeoutCount = 0;
  private duoFallbackCount = 0;

  constructor(config: MfaRouterConfig) {
    this.totpVerifier = config.totpVerifier;
    this.duoVerifier = config.duoVerifier;
    this.tierRouting = config.tierRouting ?? DEFAULT_TIER_ROUTING;
    this.debug = config.debug ?? false;
  }

  /**
   * Verify MFA code using IMfaVerifier interface
   *
   * Default implementation assumes MEDIUM tier (TOTP).
   * For tier-aware verification, use verifyWithTier().
   *
   * @param userId - User identifier
   * @param code - MFA code
   * @returns True if verified, false if not
   */
  async verify(userId: string, code: string): Promise<boolean> {
    // Default to MEDIUM tier for standard interface
    const result = await this.verifyWithTier({
      userId,
      riskTier: 'MEDIUM',
      code,
    });
    return result.valid;
  }

  /**
   * Verify MFA with tier-based routing
   *
   * @param request - Tiered MFA request
   * @returns Detailed verification result
   */
  async verifyWithTier(request: TieredMfaRequest): Promise<TieredMfaResult> {
    const { userId, riskTier, code, preferredMethod, operationType } = request;

    this.log('Starting tier-based MFA verification', {
      userId,
      riskTier,
      preferredMethod,
      operationType,
    });

    this.mfaAttemptCount++;

    // Get allowed methods for this tier
    const allowedMethods = this.tierRouting[riskTier];
    const duoRequired = allowedMethods.length === 1 && allowedMethods[0] === 'duo';

    // Check if Duo is required but not configured
    if (duoRequired && !this.duoVerifier) {
      this.log('Duo required but not configured', { riskTier });
      return {
        valid: false,
        methodUsed: 'none',
        riskTier,
        error: 'Hardware MFA (Duo) is required for CRITICAL operations but not configured',
        duoRequired: true,
      };
    }

    // Handle LOW tier (no MFA required)
    if (allowedMethods.includes('none') && !code) {
      this.log('LOW tier - MFA not required', { userId });
      this.mfaSuccessCount++;
      return {
        valid: true,
        methodUsed: 'none',
        riskTier,
        duoRequired: false,
        verifiedAt: new Date(),
      };
    }

    // Determine which method to use
    let methodToUse = this.selectMethod(allowedMethods, preferredMethod, code);

    // If preferred method is Duo but not available, check if fallback is allowed
    if (methodToUse === 'duo' && !this.duoVerifier) {
      if (allowedMethods.includes('totp') && !duoRequired) {
        this.log('Duo unavailable, falling back to TOTP', { userId, riskTier });
        methodToUse = 'totp';
        this.duoFallbackCount++;
      } else {
        return {
          valid: false,
          methodUsed: 'none',
          riskTier,
          error: 'Duo MFA not available and no fallback allowed for this tier',
          duoRequired: true,
        };
      }
    }

    // Perform verification
    try {
      const verified = await this.executeVerification(userId, code, methodToUse);

      if (verified) {
        this.mfaSuccessCount++;
        this.log('MFA verification successful', { userId, methodUsed: methodToUse });
        return {
          valid: true,
          methodUsed: methodToUse,
          riskTier,
          duoRequired,
          verifiedAt: new Date(),
        };
      }

      this.log('MFA verification failed', { userId, methodUsed: methodToUse });
      return {
        valid: false,
        methodUsed: methodToUse,
        riskTier,
        error: 'Invalid verification code',
        duoRequired,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Check if this is a timeout
      if (errorMessage.toLowerCase().includes('timeout')) {
        this.mfaTimeoutCount++;
      }

      this.log('MFA verification error', { userId, methodUsed: methodToUse, error: errorMessage });

      return {
        valid: false,
        methodUsed: methodToUse,
        riskTier,
        error: errorMessage,
        duoRequired,
      };
    }
  }

  /**
   * Check if Duo is available for CRITICAL operations
   */
  isDuoAvailable(): boolean {
    return this.duoVerifier !== undefined;
  }

  /**
   * Get allowed methods for a risk tier
   */
  getAllowedMethods(riskTier: RiskTier): MfaMethod[] {
    return [...this.tierRouting[riskTier]];
  }

  /**
   * Check if MFA is required for a risk tier
   */
  isMfaRequired(riskTier: RiskTier): boolean {
    const methods = this.tierRouting[riskTier];
    return !methods.includes('none');
  }

  /**
   * Get metrics for monitoring
   */
  getMetrics(): {
    attemptCount: number;
    successCount: number;
    timeoutCount: number;
    fallbackCount: number;
    successRate: number;
    timeoutRate: number;
  } {
    const successRate = this.mfaAttemptCount > 0
      ? (this.mfaSuccessCount / this.mfaAttemptCount) * 100
      : 0;
    const timeoutRate = this.mfaAttemptCount > 0
      ? (this.mfaTimeoutCount / this.mfaAttemptCount) * 100
      : 0;

    return {
      attemptCount: this.mfaAttemptCount,
      successCount: this.mfaSuccessCount,
      timeoutCount: this.mfaTimeoutCount,
      fallbackCount: this.duoFallbackCount,
      successRate,
      timeoutRate,
    };
  }

  /**
   * Reset metrics (for testing)
   */
  resetMetrics(): void {
    this.mfaAttemptCount = 0;
    this.mfaSuccessCount = 0;
    this.mfaTimeoutCount = 0;
    this.duoFallbackCount = 0;
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Select the best MFA method based on allowed methods and code type
   */
  private selectMethod(
    allowedMethods: MfaMethod[],
    preferredMethod?: MfaMethod,
    code?: string
  ): MfaMethod {
    // If preferred method is specified and allowed, use it
    if (preferredMethod && allowedMethods.includes(preferredMethod)) {
      return preferredMethod;
    }

    // Infer method from code format
    if (code) {
      // 'push' keyword indicates Duo push
      if (code.toLowerCase() === 'push' && allowedMethods.includes('duo')) {
        return 'duo';
      }

      // 8-digit codes could be Duo hardware token
      if (/^\d{8}$/.test(code) && allowedMethods.includes('duo')) {
        return 'duo';
      }

      // 6-digit codes are typically TOTP
      if (/^\d{6}$/.test(code)) {
        return allowedMethods.includes('totp') ? 'totp' : (allowedMethods[0] ?? 'none');
      }
    }

    // Default to first allowed method
    return allowedMethods[0] ?? 'none';
  }

  /**
   * Execute verification with the specified method
   */
  private async executeVerification(
    userId: string,
    code: string,
    method: MfaMethod
  ): Promise<boolean> {
    switch (method) {
      case 'none':
        return true;

      case 'totp':
        const totpResult = await this.totpVerifier.verifyTOTP(userId, code);
        return totpResult.valid;

      case 'duo':
        if (!this.duoVerifier) {
          throw new Error('Duo verifier not configured');
        }
        return await this.duoVerifier.verify(userId, code);

      default:
        throw new Error(`Unknown MFA method: ${method}`);
    }
  }

  /**
   * Debug logging
   */
  private log(message: string, context?: Record<string, unknown>): void {
    if (this.debug) {
      console.log(`[MfaRouterService] ${message}`, context ?? '');
    }
  }
}

/**
 * Factory function to create MfaRouterService
 */
export function createMfaRouter(config: MfaRouterConfig): MfaRouterService {
  return new MfaRouterService(config);
}

/**
 * Get risk tier from a risk score (0-100)
 */
export function getRiskTierFromScore(score: number): RiskTier {
  if (score >= 90) return 'CRITICAL';
  if (score >= 70) return 'HIGH';
  if (score >= 40) return 'MEDIUM';
  return 'LOW';
}

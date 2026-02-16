/**
 * Billing Startup Validation — Environment & Configuration Checks
 *
 * Fail-fast validation of required environment variables and
 * configuration settings before the billing module initializes.
 *
 * SDD refs: §4.5 Startup Validation
 * Sprint refs: Task 16.3 (BB-67-005)
 *
 * @module packages/adapters/billing/startup-validation
 */

import { logger } from '../../../utils/logger.js';

// =============================================================================
// Types
// =============================================================================

export interface StartupValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// =============================================================================
// Validation
// =============================================================================

/**
 * Validate billing startup configuration.
 * Checks required env vars, pool IDs, and SQLite settings.
 * Returns errors and warnings — caller decides whether to fail-fast.
 */
export function validateStartupConfig(opts?: {
  requirePayments?: boolean;
}): StartupValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const requirePayments = opts?.requirePayments ?? false;

  // ------------------------------------------
  // Payment Provider (required if payout enabled)
  // ------------------------------------------
  if (requirePayments) {
    if (!process.env.NOWPAYMENTS_API_KEY) {
      errors.push('NOWPAYMENTS_API_KEY is required for payout processing');
    }

    if (!process.env.NOWPAYMENTS_IPN_SECRET) {
      errors.push('NOWPAYMENTS_IPN_SECRET is required for webhook verification');
    }
  } else {
    if (!process.env.NOWPAYMENTS_API_KEY) {
      warnings.push('NOWPAYMENTS_API_KEY not set — payout processing will be unavailable');
    }
  }

  // ------------------------------------------
  // Admin JWT
  // ------------------------------------------
  if (!process.env.BILLING_ADMIN_JWT_SECRET) {
    warnings.push('BILLING_ADMIN_JWT_SECRET not set — admin endpoints will reject all requests');
  }

  // ------------------------------------------
  // X-Forwarded-For Trust Boundary
  // ------------------------------------------
  const trustProxy = process.env.TRUST_PROXY;
  if (!trustProxy) {
    warnings.push(
      'TRUST_PROXY not set — rate limiter may use wrong client IP. ' +
      'Set to number of trusted proxy hops (e.g., "1" for single reverse proxy).',
    );
  }

  // ------------------------------------------
  // Log Results
  // ------------------------------------------
  if (errors.length > 0) {
    logger.error({
      event: 'billing.startup.validation_failed',
      errors,
      warnings,
    }, `Billing startup validation failed: ${errors.length} error(s)`);
  } else if (warnings.length > 0) {
    logger.warn({
      event: 'billing.startup.validation_warnings',
      warnings,
    }, `Billing startup validation: ${warnings.length} warning(s)`);
  } else {
    logger.info({
      event: 'billing.startup.validation_passed',
    }, 'Billing startup validation passed');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

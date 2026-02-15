/**
 * Identity Trust Configuration
 *
 * Graduated trust model for billing operations:
 * - Below threshold: basic auth sufficient
 * - Above threshold: identity anchor required
 * - Feature flag disabled: all operations pass regardless
 *
 * CROSS-SYSTEM VERIFICATION (Bridge Review, strategic finding strategic-1):
 * Currently identity anchor verification happens within arrakis only. For
 * multi-service deployments where loa-finn or other services need to verify
 * anchors, two approaches exist:
 *
 * 1. JWT-embedded anchors (preferred for latency):
 *    Include `identity_anchor_hash` in JWT claims. Services verify the claim
 *    statelessly without calling back to arrakis. Suitable for low-value ops.
 *
 * 2. Synchronous S2S endpoint (for high-value ops):
 *    Define POST /api/internal/verify-anchor accepting { accountId, anchor }.
 *    Services call arrakis for real-time verification. Higher latency but
 *    guarantees current anchor state (handles rotation, revocation).
 *
 * The graduated trust model maps naturally: low-value → JWT-embedded (fast),
 * high-value → synchronous verification (authoritative).
 *
 * Sprint refs: Task 3.1
 *
 * @module packages/core/protocol/identity-trust
 */

import { createHash } from 'crypto';

// =============================================================================
// Configuration
// =============================================================================

export interface IdentityTrustConfig {
  /** Master feature flag — when false, all checks are skipped */
  enabled: boolean;
  /** Micro-USD threshold above which anchor is required */
  highValueThresholdMicro: bigint;
  /** Whether to require anchor above threshold (vs advisory-only) */
  requireAnchorAboveThreshold: boolean;
}

/** Default configuration — feature flag OFF for backward compatibility */
export const DEFAULT_IDENTITY_TRUST: IdentityTrustConfig = {
  enabled: false,
  highValueThresholdMicro: 100_000_000n, // $100 USD
  requireAnchorAboveThreshold: true,
};

// =============================================================================
// Check Result
// =============================================================================

export interface IdentityCheckResult {
  /** Whether the operation is allowed to proceed */
  allowed: boolean;
  /** If not allowed, the denial reason code */
  reason?: string;
  /** Whether identity was actually checked (false if feature flag off or below threshold) */
  checked: boolean;
}

// =============================================================================
// Anchor Verification (Sprint 253, Task 2.2)
// =============================================================================

/** Typed result from anchor verification — decoupled from HTTP layer */
export interface AnchorVerificationResult {
  /** Whether the provided anchor matches the stored one */
  verified: boolean;
  /** SHA-256 hash of the stored anchor (for cross-system reference via JWT claims) */
  anchorHash?: string;
  /** ISO 8601 timestamp of when verification was performed */
  checkedAt: string;
  /** Reason code when verification fails */
  reason?: 'anchor_mismatch' | 'no_anchor_bound' | 'account_not_found';
}

/** Lookup function signature — injected for testability */
export type AnchorLookupFn = (accountId: string) => { anchor: string } | null | undefined;

/**
 * Verify an identity anchor against the stored value for an account.
 *
 * Design decisions:
 * - Accepts a lookup function rather than DB dependency for testability
 * - Compares raw anchors (matching existing finalize endpoint behavior)
 * - Returns SHA-256 hash in result for cross-system JWT embedding
 * - `account_not_found` vs `no_anchor_bound` distinction lets callers
 *   differentiate "bad account ID" from "account exists but no anchor set"
 *
 * @param accountId - The agent account ID to verify against
 * @param anchor - The anchor string provided by the calling service
 * @param lookupAnchor - Function to look up stored anchor by accountId
 */
export function verifyIdentityAnchor(
  accountId: string,
  anchor: string,
  lookupAnchor: AnchorLookupFn,
): AnchorVerificationResult {
  const checkedAt = new Date().toISOString();

  const stored = lookupAnchor(accountId);

  // Account not found or lookup returned null
  if (stored === null || stored === undefined) {
    return { verified: false, checkedAt, reason: 'account_not_found' };
  }

  // Account exists but no anchor bound
  if (!stored.anchor) {
    return { verified: false, checkedAt, reason: 'no_anchor_bound' };
  }

  // Compare raw anchors (consistent with finalize endpoint at billing-routes.ts:443)
  if (anchor !== stored.anchor) {
    return { verified: false, checkedAt, reason: 'anchor_mismatch' };
  }

  // Derive SHA-256 hash for cross-system reference
  const anchorHash = 'sha256:' + createHash('sha256').update(stored.anchor).digest('hex');

  return { verified: true, anchorHash, checkedAt };
}

// =============================================================================
// Identity Check Logic
// =============================================================================

/**
 * Evaluate whether an operation should be allowed based on identity trust.
 *
 * @param config - Trust configuration
 * @param amountMicro - Operation amount in micro-USD
 * @param hasAnchor - Whether the account has a stored identity anchor
 * @param isPurchaseRoute - Whether this is a credit pack purchase (exempt)
 */
export function evaluateIdentityTrust(
  config: IdentityTrustConfig,
  amountMicro: bigint,
  hasAnchor: boolean,
  isPurchaseRoute = false,
): IdentityCheckResult {
  // Feature flag off — always allow
  if (!config.enabled) {
    return { allowed: true, checked: false };
  }

  // Purchase routes are exempt from anchor check
  if (isPurchaseRoute) {
    return { allowed: true, checked: false };
  }

  // Below threshold — basic auth sufficient
  if (amountMicro <= config.highValueThresholdMicro) {
    return { allowed: true, checked: false };
  }

  // Above threshold — anchor required
  if (!hasAnchor && config.requireAnchorAboveThreshold) {
    return {
      allowed: false,
      reason: 'identity_anchor_required_for_high_value',
      checked: true,
    };
  }

  return { allowed: true, checked: true };
}

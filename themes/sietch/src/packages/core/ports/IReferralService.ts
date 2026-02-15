/**
 * IReferralService — Referral Management Port
 *
 * Defines the contract for referral code management, registration,
 * attribution tracking, and bonus triggering.
 *
 * SDD refs: §4.1 ReferralService
 * Sprint refs: Task 1.2
 *
 * @module packages/core/ports/IReferralService
 */

// =============================================================================
// Types
// =============================================================================

export type ReferralCodeStatus = 'active' | 'expired' | 'revoked';

export type AttributionOutcome =
  | 'bound'
  | 'rebound_grace'
  | 'admin_rebind'
  | 'dispute_resolved'
  | 'rejected_existing'
  | 'rejected_self'
  | 'rejected_expired'
  | 'rejected_max_uses';

export type QualifyingActionType = 'dnft_creation' | 'credit_purchase';

export type BonusStatus = 'pending' | 'cleared' | 'granted' | 'withheld' | 'flagged' | 'denied' | 'expired';

export interface ReferralCode {
  id: string;
  accountId: string;
  code: string;
  status: ReferralCodeStatus;
  maxUses: number | null;
  useCount: number;
  expiresAt: string | null;
  createdAt: string;
  revokedAt: string | null;
  revokedBy: string | null;
}

export interface ReferralRegistration {
  id: string;
  refereeAccountId: string;
  referrerAccountId: string;
  referralCodeId: string;
  createdAt: string;
  attributionExpiresAt: string;
}

export interface QualifyingAction {
  type: QualifyingActionType;
  actionId: string;
  amountMicro: bigint;
}

export interface ReferralStats {
  totalReferees: number;
  activeReferees: number;
  totalEarningsMicro: bigint;
  pendingBonuses: number;
}

export interface AttributionLogEntry {
  id: number;
  refereeAccountId: string;
  referralCode: string;
  outcome: AttributionOutcome;
  effectiveAt: string;
  createdAt: string;
}

export interface ReferralBonus {
  id: string;
  refereeAccountId: string;
  referrerAccountId: string;
  registrationId: string;
  qualifyingAction: QualifyingActionType;
  qualifyingActionId: string;
  amountMicro: bigint;
  status: BonusStatus;
  riskScore: number | null;
  flagReason: string | null;
  reviewedBy: string | null;
  fraudCheckAt: string | null;
  grantedAt: string | null;
  grantId: string | null;
  createdAt: string;
}

// =============================================================================
// Interface
// =============================================================================

export interface IReferralService {
  /** Create a new referral code for an account (one active per account) */
  createCode(accountId: string): Promise<ReferralCode>;

  /** Get the active referral code for an account */
  getCode(accountId: string): Promise<ReferralCode | null>;

  /** Revoke a referral code */
  revokeCode(codeId: string, revokedBy: string): Promise<void>;

  /**
   * Register a referee with a referral code.
   * 7-step atomic transaction per SDD §4.1.
   * Supports 24h grace period rebind with strict rules:
   * - First-touch is immutable after any qualifying action
   * - Rebind only if no qualifying actions for current attribution
   */
  register(refereeAccountId: string, code: string): Promise<ReferralRegistration>;

  /** Get the referrer for a referee account */
  getReferrer(refereeAccountId: string): Promise<ReferralRegistration | null>;

  /**
   * Check if attribution is still active at a given point in time.
   * Returns true if `at` is before attribution_expires_at.
   */
  isAttributionActive(registration: ReferralRegistration, at: Date): boolean;

  /** Trigger bonus evaluation for a qualifying action */
  onQualifyingAction(refereeAccountId: string, action: QualifyingAction): Promise<void>;

  /** Get referral stats for a referrer */
  getReferralStats(referrerAccountId: string): Promise<ReferralStats>;
}

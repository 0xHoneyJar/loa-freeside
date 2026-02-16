/**
 * Unified billing event type vocabulary.
 *
 * Every monetary operation in the billing system has a corresponding event type.
 * Events are emitted within the same transaction as the primary write (dual-write),
 * stored in the append-only `billing_events` table.
 *
 * Each event includes:
 * - `type` — discriminant for the union
 * - `timestamp` — SQLite format (ADR-013)
 * - `aggregateId` — entity this event belongs to
 * - `aggregateType` — entity class (account, earning, payout, etc.)
 * - `payload` — event-specific data
 * - `causationId` — what triggered this event (idempotency key or parent event ID)
 *
 * SDD refs: §3 Data Architecture, §13 Key Decisions (ADR-014)
 * Sprint refs: Task 18.1
 *
 * @module protocol/billing-events
 */

// ---------------------------------------------------------------------------
// Base event shape
// ---------------------------------------------------------------------------

export interface BillingEventBase {
  type: string;
  timestamp: string; // SQLite format: YYYY-MM-DD HH:MM:SS
  aggregateId: string;
  aggregateType: AggregateType;
  causationId: string | null;
}

export type AggregateType =
  | 'account'
  | 'lot'
  | 'reservation'
  | 'referral'
  | 'earning'
  | 'payout'
  | 'score'
  | 'wallet'
  | 'rule';

// ---------------------------------------------------------------------------
// Account events
// ---------------------------------------------------------------------------

export interface AccountCreated extends BillingEventBase {
  type: 'AccountCreated';
  aggregateType: 'account';
  payload: {
    entityType: string;
    entityId: string;
  };
}

// ---------------------------------------------------------------------------
// Lot events
// ---------------------------------------------------------------------------

export interface LotMinted extends BillingEventBase {
  type: 'LotMinted';
  aggregateType: 'lot';
  payload: {
    accountId: string;
    poolId: string | null;
    sourceType: string;
    sourceId: string | null;
    amountMicro: string; // BigInt serialized as string
  };
}

export interface LotExpired extends BillingEventBase {
  type: 'LotExpired';
  aggregateType: 'lot';
  payload: {
    accountId: string;
    remainingMicro: string;
  };
}

// ---------------------------------------------------------------------------
// Reservation events
// ---------------------------------------------------------------------------

export interface ReservationCreated extends BillingEventBase {
  type: 'ReservationCreated';
  aggregateType: 'reservation';
  payload: {
    accountId: string;
    amountMicro: string;
    lotId: string;
  };
}

export interface ReservationFinalized extends BillingEventBase {
  type: 'ReservationFinalized';
  aggregateType: 'reservation';
  payload: {
    accountId: string;
    amountMicro: string;
    lotId: string;
    deltaMicro: string; // signed: negative = consumed
    poolId: string | null;
  };
}

export interface ReservationReleased extends BillingEventBase {
  type: 'ReservationReleased';
  aggregateType: 'reservation';
  payload: {
    accountId: string;
    amountMicro: string;
    lotId: string;
  };
}

// ---------------------------------------------------------------------------
// Referral events
// ---------------------------------------------------------------------------

export interface ReferralRegistered extends BillingEventBase {
  type: 'ReferralRegistered';
  aggregateType: 'referral';
  payload: {
    refereeAccountId: string;
    referrerAccountId: string;
    referralCodeId: string;
    registrationId: string;
  };
}

export interface BonusGranted extends BillingEventBase {
  type: 'BonusGranted';
  aggregateType: 'referral';
  payload: {
    refereeAccountId: string;
    amountMicro: string;
    campaignId: string;
  };
}

export interface BonusFlagged extends BillingEventBase {
  type: 'BonusFlagged';
  aggregateType: 'referral';
  payload: {
    registrationId: string;
    riskScore: number;
    signals: string[];
  };
}

export interface BonusWithheld extends BillingEventBase {
  type: 'BonusWithheld';
  aggregateType: 'referral';
  payload: {
    registrationId: string;
    riskScore: number;
    reason: string;
  };
}

// ---------------------------------------------------------------------------
// Earning events
// ---------------------------------------------------------------------------

export interface EarningRecorded extends BillingEventBase {
  type: 'EarningRecorded';
  aggregateType: 'earning';
  payload: {
    referrerAccountId: string;
    refereeAccountId: string;
    amountMicro: string;
    referrerBps: number;
    sourceChargeMicro: string;
    settleAfter: string;
    earningLotId: string;
  };
}

export interface EarningSettled extends BillingEventBase {
  type: 'EarningSettled';
  aggregateType: 'earning';
  payload: {
    referrerAccountId: string;
    amountMicro: string;
    earningLotId: string;
  };
}

export interface EarningClawedBack extends BillingEventBase {
  type: 'EarningClawedBack';
  aggregateType: 'earning';
  payload: {
    referrerAccountId: string;
    amountMicro: string;
    earningLotId: string;
    reason: string;
  };
}

export interface AgentSettlementInstant extends BillingEventBase {
  type: 'AgentSettlementInstant';
  aggregateType: 'earning';
  payload: {
    referrerAccountId: string;
    amountMicro: string;
    earningId: string;
    configVersion: number;
  };
}

export interface AgentClawbackPartial extends BillingEventBase {
  type: 'AgentClawbackPartial';
  aggregateType: 'earning';
  payload: {
    accountId: string;
    originalAmountMicro: string;
    appliedAmountMicro: string;
    receivableAmountMicro: string;
    earningId: string;
  };
}

export interface AgentClawbackReceivableCreated extends BillingEventBase {
  type: 'AgentClawbackReceivableCreated';
  aggregateType: 'earning';
  payload: {
    receivableId: string;
    accountId: string;
    sourceClawbackId: string;
    balanceMicro: string;
  };
}

// ---------------------------------------------------------------------------
// Payout events
// ---------------------------------------------------------------------------

export interface PayoutRequested extends BillingEventBase {
  type: 'PayoutRequested';
  aggregateType: 'payout';
  payload: {
    accountId: string;
    amountMicro: string;
    walletAddress: string;
    chainId: number;
  };
}

export interface PayoutApproved extends BillingEventBase {
  type: 'PayoutApproved';
  aggregateType: 'payout';
  payload: {
    approvedBy: string;
  };
}

export interface PayoutProcessing extends BillingEventBase {
  type: 'PayoutProcessing';
  aggregateType: 'payout';
  payload: {
    providerReference: string;
  };
}

export interface PayoutCompleted extends BillingEventBase {
  type: 'PayoutCompleted';
  aggregateType: 'payout';
  payload: {
    providerReference: string;
    txHash: string | null;
  };
}

export interface PayoutFailed extends BillingEventBase {
  type: 'PayoutFailed';
  aggregateType: 'payout';
  payload: {
    providerReference: string | null;
    reason: string;
  };
}

// ---------------------------------------------------------------------------
// Score / Rewards events
// ---------------------------------------------------------------------------

export interface RewardsDistributed extends BillingEventBase {
  type: 'RewardsDistributed';
  aggregateType: 'score';
  payload: {
    distributionId: string;
    totalRecipients: number;
    totalMicro: string;
    budgetPoolId: string;
  };
}

export interface ScoreImported extends BillingEventBase {
  type: 'ScoreImported';
  aggregateType: 'score';
  payload: {
    snapshotId: string;
    source: string;
    accountCount: number;
  };
}

// ---------------------------------------------------------------------------
// Wallet events
// ---------------------------------------------------------------------------

export interface WalletLinked extends BillingEventBase {
  type: 'WalletLinked';
  aggregateType: 'wallet';
  payload: {
    accountId: string;
    walletAddress: string;
    chainId: number;
  };
}

export interface WalletUnlinked extends BillingEventBase {
  type: 'WalletUnlinked';
  aggregateType: 'wallet';
  payload: {
    accountId: string;
    walletAddress: string;
    chainId: number;
  };
}

// ---------------------------------------------------------------------------
// Budget events
// ---------------------------------------------------------------------------

export interface AgentBudgetWarning extends BillingEventBase {
  type: 'AgentBudgetWarning';
  aggregateType: 'account';
  payload: {
    accountId: string;
    currentSpendMicro: string;
    dailyCapMicro: string;
    pctUsed: number;
  };
}

export interface AgentBudgetExhausted extends BillingEventBase {
  type: 'AgentBudgetExhausted';
  aggregateType: 'account';
  payload: {
    accountId: string;
    currentSpendMicro: string;
    dailyCapMicro: string;
  };
}

// ---------------------------------------------------------------------------
// Discriminated union
// ---------------------------------------------------------------------------

export type BillingEvent =
  | AccountCreated
  | LotMinted
  | LotExpired
  | ReservationCreated
  | ReservationFinalized
  | ReservationReleased
  | ReferralRegistered
  | BonusGranted
  | BonusFlagged
  | BonusWithheld
  | EarningRecorded
  | EarningSettled
  | EarningClawedBack
  | AgentSettlementInstant
  | AgentClawbackPartial
  | AgentClawbackReceivableCreated
  | AgentBudgetWarning
  | AgentBudgetExhausted
  | PayoutRequested
  | PayoutApproved
  | PayoutProcessing
  | PayoutCompleted
  | PayoutFailed
  | RewardsDistributed
  | ScoreImported
  | WalletLinked
  | WalletUnlinked;

/**
 * All valid event type strings.
 */
export const BILLING_EVENT_TYPES = [
  'AccountCreated',
  'LotMinted',
  'LotExpired',
  'ReservationCreated',
  'ReservationFinalized',
  'ReservationReleased',
  'ReferralRegistered',
  'BonusGranted',
  'BonusFlagged',
  'BonusWithheld',
  'EarningRecorded',
  'EarningSettled',
  'EarningClawedBack',
  'AgentSettlementInstant',
  'AgentClawbackPartial',
  'AgentClawbackReceivableCreated',
  'AgentBudgetWarning',
  'AgentBudgetExhausted',
  'PayoutRequested',
  'PayoutApproved',
  'PayoutProcessing',
  'PayoutCompleted',
  'PayoutFailed',
  'RewardsDistributed',
  'ScoreImported',
  'WalletLinked',
  'WalletUnlinked',
] as const;

export type BillingEventType = (typeof BILLING_EVENT_TYPES)[number];

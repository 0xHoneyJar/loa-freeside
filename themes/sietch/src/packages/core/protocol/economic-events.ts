/**
 * EconomicEvent — Unified economic event type vocabulary
 *
 * All monetary and governance operations emit economic events via the outbox.
 * Events are written within the same transaction as the primary write.
 *
 * SDD refs: §SS4.3
 * PRD refs: FR-7, FR-8
 *
 * @module core/protocol/economic-events
 */

// =============================================================================
// Event Types
// =============================================================================

export const ECONOMIC_EVENT_TYPES = [
  // Credit ledger operations
  'LotMinted',
  'ReservationCreated',
  'ReservationFinalized',
  'ReservationReleased',
  // Referral operations
  'ReferralRegistered',
  'BonusGranted',
  'BonusFlagged',
  // Earning operations
  'EarningRecorded',
  'EarningSettled',
  'EarningClawedBack',
  // Payout operations
  'PayoutRequested',
  'PayoutApproved',
  'PayoutCompleted',
  'PayoutFailed',
  // Score/rewards operations
  'RewardsDistributed',
  'ScoreImported',
  // Agent budget operations
  'AgentBudgetWarning',
  'AgentBudgetExhausted',
  // Agent settlement operations
  'AgentSettlementInstant',
  'AgentClawbackPartial',
  'AgentClawbackReceivableCreated',
  // Constitutional governance operations
  'ConfigProposed',
  'ConfigApproved',
  'ConfigActivated',
  // Reconciliation operations
  'ReconciliationCompleted',
  'ReconciliationDivergence',
  // Peer transfer operations (cycle-031)
  'PeerTransferInitiated',
  'PeerTransferCompleted',
  'PeerTransferRejected',
  // TBA binding & deposit operations (cycle-031)
  'TbaBound',
  'TbaDepositDetected',
  'TbaDepositBridged',
  'TbaDepositFailed',
  // Agent governance participation (cycle-031)
  'AgentProposalSubmitted',
  'AgentProposalQuorumReached',
  'AgentProposalActivated',
  'AgentProposalRejected',
] as const;

export type EconomicEventType = (typeof ECONOMIC_EVENT_TYPES)[number];

// =============================================================================
// Event Interfaces
// =============================================================================

/**
 * Full economic event (as stored in outbox table).
 */
export interface EconomicEvent {
  eventId: string;
  eventType: EconomicEventType;
  entityType: string;
  entityId: string;
  correlationId: string | null;
  idempotencyKey: string | null;
  configVersion: number | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

/**
 * Input for emitting an economic event (without auto-generated fields).
 */
export interface EconomicEventInput {
  eventType: EconomicEventType;
  entityType: string;
  entityId: string;
  correlationId?: string;
  idempotencyKey?: string;
  configVersion?: number;
  payload: Record<string, unknown>;
}

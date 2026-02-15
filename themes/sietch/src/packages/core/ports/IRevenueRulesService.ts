/**
 * IRevenueRulesService — Revenue Rules Governance Port
 *
 * Defines the interface for managing revenue distribution rules with
 * lifecycle state machine, mandatory cooldown periods, and audit trail.
 *
 * State machine: draft → pending_approval → cooling_down → active → superseded
 * Terminal states: rejected, superseded
 *
 * SDD refs: §1.4 CreditLedgerService
 * Sprint refs: Task 8.2
 *
 * @module packages/core/ports/IRevenueRulesService
 */

import type { RevenueRuleState } from '../protocol/index.js';
import { REVENUE_RULE_MACHINE, isValidTransition as protocolIsValid } from '../protocol/index.js';

// =============================================================================
// Types
// =============================================================================

/**
 * RuleStatus — aligned with protocol RevenueRuleState.
 * Kept as local alias for backward compatibility across existing adapters.
 */
export type RuleStatus = RevenueRuleState;

export interface RevenueRule {
  id: string;
  name: string;
  status: RuleStatus;
  commonsBps: number;
  communityBps: number;
  foundationBps: number;
  proposedBy: string;
  approvedBy: string | null;
  proposedAt: string;
  approvedAt: string | null;
  activatesAt: string | null;
  activatedAt: string | null;
  supersededAt: string | null;
  supersededBy: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RuleProposal {
  name: string;
  commonsBps: number;
  communityBps: number;
  foundationBps: number;
  proposedBy: string;
  notes?: string;
}

export interface RuleAuditEntry {
  id: string;
  ruleId: string;
  action: string;
  actor: string;
  reason: string | null;
  previousStatus: string | null;
  newStatus: string;
  createdAt: string;
}

// =============================================================================
// Allowed State Transitions
// =============================================================================

export const ALLOWED_TRANSITIONS: Record<RuleStatus, RuleStatus[]> = {
  draft: ['pending_approval'],
  pending_approval: ['cooling_down', 'rejected'],
  cooling_down: ['active', 'rejected'],
  active: ['superseded'],
  superseded: [],
  rejected: [],
};

// =============================================================================
// IRevenueRulesService Interface
// =============================================================================

export interface IRevenueRulesService {
  /** Create a new draft revenue rule */
  proposeRule(proposal: RuleProposal): Promise<RevenueRule>;

  /** Submit a draft rule for approval: draft → pending_approval */
  submitForApproval(ruleId: string, actor: string): Promise<RevenueRule>;

  /** Approve a pending rule: pending_approval → cooling_down */
  approveRule(ruleId: string, approvedBy: string): Promise<RevenueRule>;

  /** Reject a rule: pending_approval|cooling_down → rejected */
  rejectRule(ruleId: string, rejectedBy: string, reason: string): Promise<RevenueRule>;

  /** Emergency cooldown override: cooling_down → active (requires reason) */
  overrideCooldown(ruleId: string, actor: string, reason: string): Promise<RevenueRule>;

  /** Get the currently active rule (null if none) */
  getActiveRule(): Promise<RevenueRule | null>;

  /** Get all non-terminal rules (draft, pending_approval, cooling_down) */
  getPendingRules(): Promise<RevenueRule[]>;

  /** Get rule history (all rules, ordered by created_at DESC) */
  getRuleHistory(limit?: number): Promise<RevenueRule[]>;

  /** Get audit log for a specific rule */
  getRuleAudit(ruleId: string): Promise<RuleAuditEntry[]>;

  /** Check and activate rules whose cooldown has elapsed */
  activateReadyRules(): Promise<RevenueRule[]>;
}

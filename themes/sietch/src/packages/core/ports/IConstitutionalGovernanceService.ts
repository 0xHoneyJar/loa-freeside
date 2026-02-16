/**
 * IConstitutionalGovernanceService — Constitutional Parameter Governance
 *
 * Port interface for constitutional governance lifecycle:
 *   draft → pending_approval → cooling_down → active → superseded
 *   Terminal: rejected, superseded
 *
 * Three-tier parameter resolution:
 *   1. Entity-specific override (e.g., 'agent' gets instant settlement)
 *   2. Global default (e.g., 48h hold for everyone)
 *   3. Compile-time fallback (hardcoded constants)
 *
 * SDD refs: §4.1 ConstitutionalGovernanceService
 * Sprint refs: Sprint 276, Task 2.1
 *
 * @module packages/core/ports/IConstitutionalGovernanceService
 */

import type { EntityType, SystemConfig, ResolvedParam, ProposeOpts } from '../protocol/billing-types.js';

/** Transaction handle from better-sqlite3 (passed through for in-transaction reads) */
export type Transaction = { prepare(sql: string): any };

export interface IConstitutionalGovernanceService {
  // =========================================================================
  // Parameter resolution (used by all services)
  // =========================================================================

  /**
   * Resolve a constitutional parameter through the three-tier chain.
   * For non-transactional reads (dashboards, API queries).
   */
  resolve<T>(paramKey: string, entityType?: EntityType): Promise<ResolvedParam<T>>;

  /**
   * Resolve within an existing SQLite transaction.
   * For money-moving operations (reserve, finalize, settlement, payout).
   */
  resolveInTransaction<T>(tx: Transaction, paramKey: string, entityType?: EntityType): ResolvedParam<T>;

  // =========================================================================
  // Governance lifecycle
  // =========================================================================

  /**
   * Create a draft proposal for a parameter change.
   * Validates value against CONFIG_SCHEMA. Allocates version from version_seq.
   */
  propose(paramKey: string, value: unknown, opts: ProposeOpts): Promise<SystemConfig>;

  /**
   * Submit a draft proposal for approval review.
   * Only the original proposer can submit their own draft.
   * Transitions: draft → pending_approval
   */
  submit(configId: string, proposerAdminId: string): Promise<SystemConfig>;

  /**
   * Approve a pending proposal. Enforces four-eyes (proposer ≠ approver).
   * When approval_count >= required_approvals, transitions to cooling_down.
   */
  approve(configId: string, approverAdminId: string): Promise<SystemConfig>;

  /**
   * Reject a proposal. Valid from pending_approval or cooling_down.
   */
  reject(configId: string, rejectorAdminId: string, reason: string): Promise<SystemConfig>;

  /**
   * Activate configs past their 7-day cooldown period.
   * Called by BullMQ cron job. Supersedes previous active config.
   * @returns Count of configs activated.
   */
  activateExpiredCooldowns(): Promise<number>;

  /**
   * Emergency override: bypass cooldown with 3+ admin approvals.
   * Config goes directly to 'active'. Writes emergency_override audit entry.
   */
  emergencyOverride(configId: string, approvers: string[], justification: string): Promise<SystemConfig>;

  // =========================================================================
  // Query
  // =========================================================================

  getActiveConfig(paramKey: string, entityType?: EntityType): Promise<SystemConfig | null>;
  getConfigHistory(paramKey: string): Promise<SystemConfig[]>;
  getPendingProposals(): Promise<SystemConfig[]>;
}

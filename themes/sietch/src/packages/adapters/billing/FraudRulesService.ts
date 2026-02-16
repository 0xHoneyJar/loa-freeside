/**
 * FraudRulesService — Fraud Rules Governance Implementation
 *
 * Manages configurable fraud scoring weights and thresholds with
 * the same governance lifecycle as RevenueRulesAdapter:
 *   draft → pending_approval → cooling_down → active → superseded
 *
 * Weights stored as integer basis points (out of 10000).
 * Four-eyes enforcement on approval.
 *
 * SDD refs: §4.4 Fraud Rules Engine
 * Sprint refs: Task 15.2
 *
 * @module packages/adapters/billing/FraudRulesService
 */

import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import type { RuleStatus } from '../../core/ports/IRevenueRulesService.js';
import { ALLOWED_TRANSITIONS } from '../../core/ports/IRevenueRulesService.js';
import { InvalidStateError, FourEyesViolationError } from './CreditLedgerAdapter.js';
import { logger } from '../../../utils/logger.js';
import { sqliteTimestamp } from './protocol/timestamps';
import type { IConstitutionalGovernanceService } from '../../core/ports/IConstitutionalGovernanceService.js';
import { CONFIG_FALLBACKS } from '../../core/protocol/config-schema.js';

// =============================================================================
// Types
// =============================================================================

export interface FraudRule {
  id: string;
  name: string;
  status: RuleStatus;
  ipClusterWeight: number;
  uaFingerprintWeight: number;
  velocityWeight: number;
  activityWeight: number;
  flagThreshold: number;
  withholdThreshold: number;
  proposedBy: string;
  approvedBy: string | null;
  proposedAt: string;
  approvedAt: string | null;
  activatesAt: string | null;
  activatedAt: string | null;
  supersededAt: string | null;
  supersededBy: string | null;
  notes: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface FraudRuleProposal {
  name: string;
  ipClusterWeight: number;
  uaFingerprintWeight: number;
  velocityWeight: number;
  activityWeight: number;
  flagThreshold: number;
  withholdThreshold: number;
  proposedBy: string;
  notes?: string;
}

export interface FraudRuleAuditEntry {
  id: string;
  ruleId: string;
  action: string;
  actor: string;
  reason: string | null;
  previousStatus: string | null;
  newStatus: string;
  createdAt: string;
}

/** Weights in normalized form (0.0–1.0) for FraudCheckService consumption */
export interface FraudWeights {
  ipCluster: number;
  uaFingerprint: number;
  velocity: number;
  activityCheck: number;
  flagThreshold: number;
  withholdThreshold: number;
}

// =============================================================================
// Row Types
// =============================================================================

interface FraudRuleRow {
  id: string;
  name: string;
  status: string;
  ip_cluster_weight: number;
  ua_fingerprint_weight: number;
  velocity_weight: number;
  activity_weight: number;
  flag_threshold: number;
  withhold_threshold: number;
  proposed_by: string;
  approved_by: string | null;
  proposed_at: string;
  approved_at: string | null;
  activates_at: string | null;
  activated_at: string | null;
  superseded_at: string | null;
  superseded_by: string | null;
  notes: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

interface AuditRow {
  id: string;
  rule_id: string;
  action: string;
  actor: string;
  reason: string | null;
  previous_status: string | null;
  new_status: string;
  created_at: string;
}

// =============================================================================
// Constants
// =============================================================================

/** Legacy constant — now resolved from system_config as fraud_rule.cooldown_seconds (604800s) */
const DEFAULT_COOLDOWN_SECONDS = 604_800; // 7 days

// =============================================================================
// Row Mappers
// =============================================================================

function rowToRule(row: FraudRuleRow): FraudRule {
  return {
    id: row.id,
    name: row.name,
    status: row.status as RuleStatus,
    ipClusterWeight: row.ip_cluster_weight,
    uaFingerprintWeight: row.ua_fingerprint_weight,
    velocityWeight: row.velocity_weight,
    activityWeight: row.activity_weight,
    flagThreshold: row.flag_threshold,
    withholdThreshold: row.withhold_threshold,
    proposedBy: row.proposed_by,
    approvedBy: row.approved_by,
    proposedAt: row.proposed_at,
    approvedAt: row.approved_at,
    activatesAt: row.activates_at,
    activatedAt: row.activated_at,
    supersededAt: row.superseded_at,
    supersededBy: row.superseded_by,
    notes: row.notes,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToAudit(row: AuditRow): FraudRuleAuditEntry {
  return {
    id: row.id,
    ruleId: row.rule_id,
    action: row.action,
    actor: row.actor,
    reason: row.reason,
    previousStatus: row.previous_status,
    newStatus: row.new_status,
    createdAt: row.created_at,
  };
}

const sqliteNow = sqliteTimestamp;

// =============================================================================
// FraudRulesService
// =============================================================================

export class FraudRulesService {
  private db: Database.Database;
  private governance: IConstitutionalGovernanceService | null;

  constructor(db: Database.Database, governance?: IConstitutionalGovernanceService) {
    this.db = db;
    this.governance = governance ?? null;
  }

  // ---------------------------------------------------------------------------
  // Propose
  // ---------------------------------------------------------------------------

  async proposeRule(proposal: FraudRuleProposal): Promise<FraudRule> {
    const id = randomUUID();
    const now = sqliteNow();

    this.db.prepare(`
      INSERT INTO fraud_rules
        (id, name, status, ip_cluster_weight, ua_fingerprint_weight,
         velocity_weight, activity_weight, flag_threshold, withhold_threshold,
         proposed_by, proposed_at, notes, created_at, updated_at)
      VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, proposal.name,
      proposal.ipClusterWeight, proposal.uaFingerprintWeight,
      proposal.velocityWeight, proposal.activityWeight,
      proposal.flagThreshold, proposal.withholdThreshold,
      proposal.proposedBy, now, proposal.notes ?? null, now, now,
    );

    this.logAudit(id, 'proposed', proposal.proposedBy, null, null, 'draft');

    return this.getRule(id);
  }

  // ---------------------------------------------------------------------------
  // Submit for Approval
  // ---------------------------------------------------------------------------

  async submitForApproval(ruleId: string, actor: string): Promise<FraudRule> {
    return this.transition(ruleId, 'pending_approval', actor, 'submitted');
  }

  // ---------------------------------------------------------------------------
  // Approve
  // ---------------------------------------------------------------------------

  async approveRule(ruleId: string, approvedBy: string): Promise<FraudRule> {
    const cooldownSeconds = this.resolveCooldownSeconds();
    const now = sqliteNow();

    return this.db.transaction(() => {
      const rule = this.getRuleRow(ruleId);
      this.assertTransition(rule.status as RuleStatus, 'cooling_down', ruleId);

      // Four-eyes enforcement: approver must differ from proposer
      if (rule.proposed_by === approvedBy) {
        throw new FourEyesViolationError(ruleId, approvedBy);
      }

      this.db.prepare(`
        UPDATE fraud_rules
        SET status = 'cooling_down',
            approved_by = ?,
            approved_at = ?,
            activates_at = datetime(?, '+' || ? || ' seconds'),
            updated_at = ?
        WHERE id = ?
      `).run(approvedBy, now, now, cooldownSeconds, now, ruleId);

      this.logAudit(ruleId, 'approved', approvedBy, null, 'pending_approval', 'cooling_down');

      return this.getRule(ruleId);
    })();
  }

  // ---------------------------------------------------------------------------
  // Reject
  // ---------------------------------------------------------------------------

  async rejectRule(ruleId: string, rejectedBy: string, reason: string): Promise<FraudRule> {
    const now = sqliteNow();

    return this.db.transaction(() => {
      const rule = this.getRuleRow(ruleId);
      const currentStatus = rule.status as RuleStatus;

      if (currentStatus !== 'pending_approval' && currentStatus !== 'cooling_down') {
        throw new InvalidStateError(ruleId, currentStatus, 'reject');
      }

      this.db.prepare(`
        UPDATE fraud_rules
        SET status = 'rejected', notes = COALESCE(notes || ' | ', '') || ?, updated_at = ?
        WHERE id = ?
      `).run(`Rejected: ${reason}`, now, ruleId);

      this.logAudit(ruleId, 'rejected', rejectedBy, reason, currentStatus, 'rejected');

      return this.getRule(ruleId);
    })();
  }

  // ---------------------------------------------------------------------------
  // Override Cooldown (Emergency)
  // ---------------------------------------------------------------------------

  async overrideCooldown(ruleId: string, actor: string, reason: string): Promise<FraudRule> {
    const now = sqliteNow();

    return this.db.transaction(() => {
      const rule = this.getRuleRow(ruleId);
      this.assertTransition(rule.status as RuleStatus, 'active', ruleId);

      this.supersedeActiveRule(ruleId, now);

      this.db.prepare(`
        UPDATE fraud_rules
        SET status = 'active', activated_at = ?, updated_at = ?
        WHERE id = ?
      `).run(now, now, ruleId);

      this.logAudit(ruleId, 'cooldown_overridden', actor, reason, 'cooling_down', 'active');

      logger.warn({
        event: 'billing.fraud_rules.cooldown_override',
        ruleId,
        actor,
        reason,
      }, 'Fraud rule cooldown overridden — emergency activation');

      return this.getRule(ruleId);
    })();
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  async getActiveRule(): Promise<FraudRule | null> {
    const row = this.db.prepare(
      `SELECT * FROM fraud_rules WHERE status = 'active' LIMIT 1`
    ).get() as FraudRuleRow | undefined;

    return row ? rowToRule(row) : null;
  }

  /**
   * Get active weights in normalized form (0.0–1.0) for FraudCheckService.
   * Returns null if no active rule.
   */
  getActiveWeights(): FraudWeights | null {
    try {
      const row = this.db.prepare(
        `SELECT ip_cluster_weight, ua_fingerprint_weight, velocity_weight,
                activity_weight, flag_threshold, withhold_threshold
         FROM fraud_rules WHERE status = 'active' LIMIT 1`
      ).get() as {
        ip_cluster_weight: number;
        ua_fingerprint_weight: number;
        velocity_weight: number;
        activity_weight: number;
        flag_threshold: number;
        withhold_threshold: number;
      } | undefined;

      if (!row) return null;

      return {
        ipCluster: row.ip_cluster_weight / 10000,
        uaFingerprint: row.ua_fingerprint_weight / 10000,
        velocity: row.velocity_weight / 10000,
        activityCheck: row.activity_weight / 10000,
        flagThreshold: row.flag_threshold / 10000,
        withholdThreshold: row.withhold_threshold / 10000,
      };
    } catch {
      return null;
    }
  }

  async getPendingRules(): Promise<FraudRule[]> {
    const rows = this.db.prepare(
      `SELECT * FROM fraud_rules
       WHERE status IN ('draft', 'pending_approval', 'cooling_down')
       ORDER BY created_at DESC`
    ).all() as FraudRuleRow[];

    return rows.map(rowToRule);
  }

  async getRuleHistory(limit?: number): Promise<FraudRule[]> {
    const rows = this.db.prepare(
      `SELECT * FROM fraud_rules ORDER BY created_at DESC LIMIT ?`
    ).all(limit ?? 50) as FraudRuleRow[];

    return rows.map(rowToRule);
  }

  async getRuleAudit(ruleId: string): Promise<FraudRuleAuditEntry[]> {
    const rows = this.db.prepare(
      `SELECT * FROM fraud_rule_audit_log
       WHERE rule_id = ?
       ORDER BY created_at DESC`
    ).all(ruleId) as AuditRow[];

    return rows.map(rowToAudit);
  }

  // ---------------------------------------------------------------------------
  // Activation Job
  // ---------------------------------------------------------------------------

  async activateReadyRules(): Promise<FraudRule[]> {
    const activated: FraudRule[] = [];

    return this.db.transaction(() => {
      const ready = this.db.prepare(`
        SELECT * FROM fraud_rules
        WHERE status = 'cooling_down'
          AND activates_at <= datetime('now')
        ORDER BY activates_at ASC
      `).all() as FraudRuleRow[];

      for (const row of ready) {
        const now = sqliteNow();

        this.supersedeActiveRule(row.id, now);

        const result = this.db.prepare(`
          UPDATE fraud_rules
          SET status = 'active', activated_at = ?, updated_at = ?
          WHERE id = ? AND status = 'cooling_down'
            AND NOT EXISTS (SELECT 1 FROM fraud_rules WHERE status = 'active')
        `).run(now, now, row.id);

        if (result.changes > 0) {
          this.logAudit(row.id, 'activated', 'system', null, 'cooling_down', 'active');

          logger.info({
            event: 'billing.fraud_rules.activated',
            rule_id: row.id,
            ip_cluster_weight: row.ip_cluster_weight,
            velocity_weight: row.velocity_weight,
            flag_threshold: row.flag_threshold,
          }, `Fraud rule activated: ${row.name}`);

          activated.push(this.getRule(row.id));
        }
      }

      return activated;
    })();
  }

  // ---------------------------------------------------------------------------
  // Internal Helpers
  // ---------------------------------------------------------------------------

  private getRule(ruleId: string): FraudRule {
    const row = this.db.prepare(
      `SELECT * FROM fraud_rules WHERE id = ?`
    ).get(ruleId) as FraudRuleRow | undefined;

    if (!row) throw new Error(`Fraud rule ${ruleId} not found`);
    return rowToRule(row);
  }

  private getRuleRow(ruleId: string): FraudRuleRow {
    const row = this.db.prepare(
      `SELECT * FROM fraud_rules WHERE id = ?`
    ).get(ruleId) as FraudRuleRow | undefined;

    if (!row) throw new Error(`Fraud rule ${ruleId} not found`);
    return row;
  }

  private assertTransition(current: RuleStatus, target: RuleStatus, ruleId: string): void {
    const allowed = ALLOWED_TRANSITIONS[current];
    if (!allowed.includes(target)) {
      throw new InvalidStateError(ruleId, current, `transition to ${target}`);
    }
  }

  private transition(
    ruleId: string,
    targetStatus: RuleStatus,
    actor: string,
    action: string,
  ): FraudRule {
    const now = sqliteNow();

    return this.db.transaction(() => {
      const rule = this.getRuleRow(ruleId);
      const currentStatus = rule.status as RuleStatus;
      this.assertTransition(currentStatus, targetStatus, ruleId);

      this.db.prepare(`
        UPDATE fraud_rules SET status = ?, updated_at = ? WHERE id = ?
      `).run(targetStatus, now, ruleId);

      this.logAudit(ruleId, action, actor, null, currentStatus, targetStatus);

      return this.getRule(ruleId);
    })();
  }

  private supersedeActiveRule(newRuleId: string, now: string): void {
    const active = this.db.prepare(
      `SELECT id FROM fraud_rules WHERE status = 'active' LIMIT 1`
    ).get() as { id: string } | undefined;

    if (active) {
      this.db.prepare(`
        UPDATE fraud_rules
        SET status = 'superseded', superseded_at = ?, superseded_by = ?, updated_at = ?
        WHERE id = ?
      `).run(now, newRuleId, now, active.id);

      this.logAudit(active.id, 'superseded', 'system',
        `Superseded by rule ${newRuleId}`, 'active', 'superseded');
    }
  }

  private resolveCooldownSeconds(): number {
    if (this.governance) {
      try {
        const resolved = this.governance.resolveInTransaction<number>(
          this.db, 'fraud_rule.cooldown_seconds',
        );
        return resolved.value;
      } catch {
        // Governance table may not exist yet
      }
    }
    return (CONFIG_FALLBACKS['fraud_rule.cooldown_seconds'] as number) ?? DEFAULT_COOLDOWN_SECONDS;
  }

  private logAudit(
    ruleId: string,
    action: string,
    actor: string,
    reason: string | null,
    previousStatus: string | null,
    newStatus: string,
  ): void {
    this.db.prepare(`
      INSERT INTO fraud_rule_audit_log
        (id, rule_id, action, actor, reason, previous_status, new_status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(randomUUID(), ruleId, action, actor, reason, previousStatus, newStatus);
  }
}

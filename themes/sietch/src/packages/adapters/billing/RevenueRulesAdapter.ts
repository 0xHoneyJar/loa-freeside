/**
 * RevenueRulesAdapter — Revenue Rules Governance Implementation
 *
 * Implements IRevenueRulesService with SQLite storage, strict state machine
 * enforcement, mandatory cooldown, and comprehensive audit logging.
 *
 * State machine: draft → pending_approval → cooling_down → active → superseded
 * Terminal states: rejected, superseded
 *
 * SDD refs: §1.4 CreditLedgerService
 * Sprint refs: Task 8.2
 *
 * @module packages/adapters/billing/RevenueRulesAdapter
 */

import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import type {
  IRevenueRulesService,
  RevenueRule,
  RuleProposal,
  RuleAuditEntry,
  RuleStatus,
} from '../../core/ports/IRevenueRulesService.js';
import { ALLOWED_TRANSITIONS } from '../../core/ports/IRevenueRulesService.js';
import { InvalidStateError, FourEyesViolationError } from './CreditLedgerAdapter.js';
import { logger } from '../../../utils/logger.js';
import type { IConstitutionalGovernanceService } from '../../core/ports/IConstitutionalGovernanceService.js';
import { CONFIG_FALLBACKS } from '../../core/protocol/config-schema.js';

// =============================================================================
// Constants
// =============================================================================

/** Legacy constant — now resolved from system_config as revenue_rule.cooldown_seconds (172800s) */
const DEFAULT_COOLDOWN_SECONDS = 172_800; // 48 hours

// =============================================================================
// Row Types
// =============================================================================

interface RevenueRuleRow {
  id: string;
  name: string;
  status: string;
  commons_bps: number;
  community_bps: number;
  foundation_bps: number;
  proposed_by: string;
  approved_by: string | null;
  proposed_at: string;
  approved_at: string | null;
  activates_at: string | null;
  activated_at: string | null;
  superseded_at: string | null;
  superseded_by: string | null;
  notes: string | null;
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
// Row Mappers
// =============================================================================

function rowToRule(row: RevenueRuleRow): RevenueRule {
  return {
    id: row.id,
    name: row.name,
    status: row.status as RuleStatus,
    commonsBps: row.commons_bps,
    communityBps: row.community_bps,
    foundationBps: row.foundation_bps,
    proposedBy: row.proposed_by,
    approvedBy: row.approved_by,
    proposedAt: row.proposed_at,
    approvedAt: row.approved_at,
    activatesAt: row.activates_at,
    activatedAt: row.activated_at,
    supersededAt: row.superseded_at,
    supersededBy: row.superseded_by,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToAudit(row: AuditRow): RuleAuditEntry {
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

import { sqliteTimestamp } from './protocol/timestamps';

const sqliteNow = sqliteTimestamp;

// =============================================================================
// RevenueRulesAdapter
// =============================================================================

export class RevenueRulesAdapter implements IRevenueRulesService {
  private db: Database.Database;
  private governance: IConstitutionalGovernanceService | null;

  constructor(db: Database.Database, governance?: IConstitutionalGovernanceService) {
    this.db = db;
    this.governance = governance ?? null;
  }

  // ---------------------------------------------------------------------------
  // Propose
  // ---------------------------------------------------------------------------

  async proposeRule(proposal: RuleProposal): Promise<RevenueRule> {
    const id = randomUUID();
    const now = sqliteNow();

    this.db.prepare(`
      INSERT INTO revenue_rules
        (id, name, status, commons_bps, community_bps, foundation_bps,
         proposed_by, proposed_at, notes, created_at, updated_at)
      VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, proposal.name,
      proposal.commonsBps, proposal.communityBps, proposal.foundationBps,
      proposal.proposedBy, now, proposal.notes ?? null, now, now,
    );

    this.logAudit(id, 'proposed', proposal.proposedBy, null, null, 'draft');

    return this.getRule(id);
  }

  // ---------------------------------------------------------------------------
  // Submit for Approval
  // ---------------------------------------------------------------------------

  async submitForApproval(ruleId: string, actor: string): Promise<RevenueRule> {
    return this.transition(ruleId, 'pending_approval', actor, 'submitted');
  }

  // ---------------------------------------------------------------------------
  // Approve
  // ---------------------------------------------------------------------------

  async approveRule(ruleId: string, approvedBy: string): Promise<RevenueRule> {
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
        UPDATE revenue_rules
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

  async rejectRule(ruleId: string, rejectedBy: string, reason: string): Promise<RevenueRule> {
    const now = sqliteNow();

    return this.db.transaction(() => {
      const rule = this.getRuleRow(ruleId);
      const currentStatus = rule.status as RuleStatus;

      // Reject allowed from pending_approval or cooling_down
      if (currentStatus !== 'pending_approval' && currentStatus !== 'cooling_down') {
        throw new InvalidStateError(ruleId, currentStatus, 'reject');
      }

      this.db.prepare(`
        UPDATE revenue_rules
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

  async overrideCooldown(ruleId: string, actor: string, reason: string): Promise<RevenueRule> {
    const now = sqliteNow();

    return this.db.transaction(() => {
      const rule = this.getRuleRow(ruleId);
      this.assertTransition(rule.status as RuleStatus, 'active', ruleId);

      // Supersede currently active rule
      this.supersedeActiveRule(ruleId, now);

      this.db.prepare(`
        UPDATE revenue_rules
        SET status = 'active', activated_at = ?, updated_at = ?
        WHERE id = ?
      `).run(now, now, ruleId);

      this.logAudit(ruleId, 'cooldown_overridden', actor, reason, 'cooling_down', 'active');

      // Urgent notification for emergency activation
      this.createNotification(ruleId, 'emergency_activate', actor, 'urgent', rule);

      logger.warn({
        event: 'billing.revenue_rules.cooldown_override',
        ruleId,
        actor,
        reason,
      }, 'Revenue rule cooldown overridden — emergency activation');

      return this.getRule(ruleId);
    })();
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  async getActiveRule(): Promise<RevenueRule | null> {
    const row = this.db.prepare(
      `SELECT * FROM revenue_rules WHERE status = 'active' LIMIT 1`
    ).get() as RevenueRuleRow | undefined;

    return row ? rowToRule(row) : null;
  }

  async getPendingRules(): Promise<RevenueRule[]> {
    const rows = this.db.prepare(
      `SELECT * FROM revenue_rules
       WHERE status IN ('draft', 'pending_approval', 'cooling_down')
       ORDER BY created_at DESC`
    ).all() as RevenueRuleRow[];

    return rows.map(rowToRule);
  }

  async getRuleHistory(limit?: number): Promise<RevenueRule[]> {
    const rows = this.db.prepare(
      `SELECT * FROM revenue_rules ORDER BY created_at DESC LIMIT ?`
    ).all(limit ?? 50) as RevenueRuleRow[];

    return rows.map(rowToRule);
  }

  async getRuleAudit(ruleId: string): Promise<RuleAuditEntry[]> {
    const rows = this.db.prepare(
      `SELECT * FROM revenue_rule_audit_log
       WHERE rule_id = ?
       ORDER BY created_at DESC`
    ).all(ruleId) as AuditRow[];

    return rows.map(rowToAudit);
  }

  // ---------------------------------------------------------------------------
  // Activation Job
  // ---------------------------------------------------------------------------

  async activateReadyRules(): Promise<RevenueRule[]> {
    const activated: RevenueRule[] = [];

    return this.db.transaction(() => {
      // Find rules whose cooldown has elapsed
      const ready = this.db.prepare(`
        SELECT * FROM revenue_rules
        WHERE status = 'cooling_down'
          AND activates_at <= datetime('now')
        ORDER BY activates_at ASC
      `).all() as RevenueRuleRow[];

      for (const row of ready) {
        const now = sqliteNow();

        // Predicate-guarded activation: only if no active rule OR supersede it
        this.supersedeActiveRule(row.id, now);

        // Activate with predicate check
        const result = this.db.prepare(`
          UPDATE revenue_rules
          SET status = 'active', activated_at = ?, updated_at = ?
          WHERE id = ? AND status = 'cooling_down'
            AND NOT EXISTS (SELECT 1 FROM revenue_rules WHERE status = 'active')
        `).run(now, now, row.id);

        if (result.changes > 0) {
          this.logAudit(row.id, 'activated', 'system', null, 'cooling_down', 'active');

          // Normal notification for scheduled activation
          this.createNotification(row.id, 'activate', 'system', 'normal', row);

          logger.info({
            event: 'billing.revenue_rules.activated',
            rule_id: row.id,
            commons_bps: row.commons_bps,
            community_bps: row.community_bps,
            foundation_bps: row.foundation_bps,
          }, `Revenue rule activated: ${row.name}`);

          activated.push(this.getRule(row.id));
        }
      }

      return activated;
    })();
  }

  // ---------------------------------------------------------------------------
  // Internal Helpers
  // ---------------------------------------------------------------------------

  private getRule(ruleId: string): RevenueRule {
    const row = this.db.prepare(
      `SELECT * FROM revenue_rules WHERE id = ?`
    ).get(ruleId) as RevenueRuleRow | undefined;

    if (!row) throw new Error(`Revenue rule ${ruleId} not found`);
    return rowToRule(row);
  }

  private getRuleRow(ruleId: string): RevenueRuleRow {
    const row = this.db.prepare(
      `SELECT * FROM revenue_rules WHERE id = ?`
    ).get(ruleId) as RevenueRuleRow | undefined;

    if (!row) throw new Error(`Revenue rule ${ruleId} not found`);
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
  ): RevenueRule {
    const now = sqliteNow();

    return this.db.transaction(() => {
      const rule = this.getRuleRow(ruleId);
      const currentStatus = rule.status as RuleStatus;
      this.assertTransition(currentStatus, targetStatus, ruleId);

      this.db.prepare(`
        UPDATE revenue_rules SET status = ?, updated_at = ? WHERE id = ?
      `).run(targetStatus, now, ruleId);

      this.logAudit(ruleId, action, actor, null, currentStatus, targetStatus);

      return this.getRule(ruleId);
    })();
  }

  private supersedeActiveRule(newRuleId: string, now: string): void {
    const active = this.db.prepare(
      `SELECT id FROM revenue_rules WHERE status = 'active' LIMIT 1`
    ).get() as { id: string } | undefined;

    if (active) {
      this.db.prepare(`
        UPDATE revenue_rules
        SET status = 'superseded', superseded_at = ?, superseded_by = ?, updated_at = ?
        WHERE id = ?
      `).run(now, newRuleId, now, active.id);

      this.logAudit(active.id, 'superseded', 'system',
        `Superseded by rule ${newRuleId}`, 'active', 'superseded');
    }
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
      INSERT INTO revenue_rule_audit_log
        (id, rule_id, action, actor, reason, previous_status, new_status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(randomUUID(), ruleId, action, actor, reason, previousStatus, newStatus);
  }

  /**
   * Create a billing notification for governance events.
   * Called on activate and emergency-activate transitions.
   */
  private createNotification(
    ruleId: string,
    transition: string,
    actor: string,
    urgency: 'normal' | 'urgent',
    newRule: RevenueRuleRow,
  ): void {
    try {
      // Get the old (superseded) rule's splits for comparison
      const oldActive = this.db.prepare(
        `SELECT commons_bps, community_bps, foundation_bps FROM revenue_rules
         WHERE status = 'superseded' AND superseded_by = ? LIMIT 1`
      ).get(ruleId) as { commons_bps: number; community_bps: number; foundation_bps: number } | undefined;

      const oldSplits = oldActive
        ? JSON.stringify({ commons_bps: oldActive.commons_bps, community_bps: oldActive.community_bps, foundation_bps: oldActive.foundation_bps })
        : null;

      const newSplits = JSON.stringify({
        commons_bps: newRule.commons_bps,
        community_bps: newRule.community_bps,
        foundation_bps: newRule.foundation_bps,
      });

      this.db.prepare(`
        INSERT INTO billing_notifications
          (id, rule_id, transition, old_splits, new_splits, actor_id, urgency)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(randomUUID(), ruleId, transition, oldSplits, newSplits, actor, urgency);
    } catch (err) {
      // Notification failure must not break activation
      logger.warn({ err, ruleId, transition }, 'Failed to create billing notification');
    }
  }

  private resolveCooldownSeconds(): number {
    if (this.governance) {
      try {
        const resolved = this.governance.resolveInTransaction<number>(
          this.db, 'revenue_rule.cooldown_seconds',
        );
        return resolved.value;
      } catch {
        // Governance table may not exist yet
      }
    }
    // Legacy fallback: try billing_config table (hours → seconds)
    try {
      const row = this.db.prepare(
        `SELECT value FROM billing_config WHERE key = 'revenue_rule_cooldown_hours'`
      ).get() as { value: string } | undefined;

      if (row) {
        const hours = parseInt(row.value, 10);
        if (hours > 0) return hours * 3600;
      }
    } catch {
      // billing_config may not exist in test setup
    }
    return (CONFIG_FALLBACKS['revenue_rule.cooldown_seconds'] as number) ?? DEFAULT_COOLDOWN_SECONDS;
  }
}

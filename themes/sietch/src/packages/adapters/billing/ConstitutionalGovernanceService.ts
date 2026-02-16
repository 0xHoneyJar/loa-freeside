/**
 * ConstitutionalGovernanceService — Constitutional Parameter Governance Adapter
 *
 * Full governance lifecycle for constitutional parameters:
 *   draft → pending_approval → cooling_down → active → superseded
 *
 * Three-tier parameter resolution:
 *   1. Entity-specific override (WHERE entity_type = ?)
 *   2. Global default (WHERE entity_type IS NULL)
 *   3. Compile-time fallback (CONFIG_FALLBACKS)
 *
 * SDD refs: §4.1 ConstitutionalGovernanceService
 * Sprint refs: Sprint 276, Task 2.2
 *
 * @module packages/adapters/billing/ConstitutionalGovernanceService
 */

import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import type {
  IConstitutionalGovernanceService,
  Transaction,
} from '../../core/ports/IConstitutionalGovernanceService.js';
import type {
  EntityType,
  SystemConfig,
  SystemConfigStatus,
  ResolvedParam,
  ProposeOpts,
  ParamSource,
} from '../../core/protocol/billing-types.js';
import { isValidTransition, SYSTEM_CONFIG_MACHINE } from '../../core/protocol/state-machines.js';
import { validateConfigValue, CONFIG_FALLBACKS } from '../../core/protocol/config-schema.js';
import { logger } from '../../../utils/logger.js';

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_COOLDOWN_SECONDS = 7 * 24 * 60 * 60; // 7 days
const DEFAULT_REQUIRED_APPROVALS = 2;
const EMERGENCY_MIN_APPROVERS = 3;

// =============================================================================
// Row Types (snake_case from SQLite)
// =============================================================================

interface SystemConfigRow {
  id: string;
  param_key: string;
  entity_type: string | null;
  value_json: string;
  config_version: number;
  active_from: string | null;
  status: string;
  proposed_by: string;
  proposed_at: string;
  approved_by: string | null;
  approval_count: number;
  required_approvals: number;
  cooldown_ends_at: string | null;
  activated_at: string | null;
  superseded_at: string | null;
  superseded_by: string | null;
  metadata: string | null;
  created_at: string;
}

// =============================================================================
// Row Mapper
// =============================================================================

function rowToConfig(row: SystemConfigRow): SystemConfig {
  return {
    id: row.id,
    paramKey: row.param_key,
    entityType: row.entity_type,
    valueJson: row.value_json,
    configVersion: row.config_version,
    activeFrom: row.active_from,
    status: row.status as SystemConfigStatus,
    proposedBy: row.proposed_by,
    proposedAt: row.proposed_at,
    approvedBy: row.approved_by,
    approvalCount: row.approval_count,
    requiredApprovals: row.required_approvals,
    cooldownEndsAt: row.cooldown_ends_at,
    activatedAt: row.activated_at,
    supersededAt: row.superseded_at,
    supersededBy: row.superseded_by,
    metadata: row.metadata,
    createdAt: row.created_at,
  };
}

// =============================================================================
// Error Classes
// =============================================================================

export class InvalidStateError extends Error {
  constructor(configId: string, currentStatus: string, attemptedAction: string) {
    super(`Cannot ${attemptedAction} config ${configId}: current status is '${currentStatus}'`);
    this.name = 'InvalidStateError';
  }
}

export class FourEyesViolationError extends Error {
  constructor(configId: string, actor: string) {
    super(`Four-eyes violation on config ${configId}: actor '${actor}' cannot approve their own proposal`);
    this.name = 'FourEyesViolationError';
  }
}

export class SchemaValidationError extends Error {
  constructor(paramKey: string, detail: string) {
    super(`Schema validation failed for '${paramKey}': ${detail}`);
    this.name = 'SchemaValidationError';
  }
}

// =============================================================================
// Service Implementation
// =============================================================================

export class ConstitutionalGovernanceService implements IConstitutionalGovernanceService {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  // =========================================================================
  // Parameter Resolution
  // =========================================================================

  async resolve<T>(paramKey: string, entityType?: EntityType): Promise<ResolvedParam<T>> {
    return this.resolveFromDb(this.db, paramKey, entityType);
  }

  resolveInTransaction<T>(tx: Transaction, paramKey: string, entityType?: EntityType): ResolvedParam<T> {
    return this.resolveFromDb(tx as any, paramKey, entityType);
  }

  private resolveFromDb<T>(db: { prepare(sql: string): any }, paramKey: string, entityType?: EntityType): ResolvedParam<T> {
    // Tier 1: Entity-specific override
    if (entityType) {
      const row = db.prepare(
        `SELECT * FROM system_config WHERE param_key = ? AND entity_type = ? AND status = 'active' LIMIT 1`,
      ).get(paramKey, entityType) as SystemConfigRow | undefined;

      if (row) {
        return {
          value: JSON.parse(row.value_json) as T,
          configVersion: row.config_version,
          source: 'entity_override' as ParamSource,
          configId: row.id,
        };
      }
    }

    // Tier 2: Global default
    const globalRow = db.prepare(
      `SELECT * FROM system_config WHERE param_key = ? AND entity_type IS NULL AND status = 'active' LIMIT 1`,
    ).get(paramKey) as SystemConfigRow | undefined;

    if (globalRow) {
      return {
        value: JSON.parse(globalRow.value_json) as T,
        configVersion: globalRow.config_version,
        source: 'global_config' as ParamSource,
        configId: globalRow.id,
      };
    }

    // Tier 3: Compile-time fallback
    const fallback = CONFIG_FALLBACKS[paramKey];
    if (fallback !== undefined) {
      return {
        value: fallback as T,
        configVersion: 0,
        source: 'compile_fallback' as ParamSource,
        configId: null,
      };
    }

    // Unknown parameter — return 0 as safe default
    logger.warn({ paramKey, entityType }, 'No config found and no compile-time fallback');
    return {
      value: 0 as T,
      configVersion: 0,
      source: 'compile_fallback' as ParamSource,
      configId: null,
    };
  }

  // =========================================================================
  // Governance Lifecycle
  // =========================================================================

  async propose(paramKey: string, value: unknown, opts: ProposeOpts): Promise<SystemConfig> {
    // Validate against schema
    const validation = validateConfigValue(paramKey, value);
    if (!validation.valid) {
      throw new SchemaValidationError(paramKey, validation.error!);
    }

    const entityType = opts.entityType ?? null;

    return this.db.transaction(() => {
      // Allocate version from sequence counter under BEGIN IMMEDIATE
      const seqRow = this.db.prepare(
        `SELECT current_version FROM system_config_version_seq
         WHERE param_key = ? AND COALESCE(entity_type, '__global__') = COALESCE(?, '__global__')`,
      ).get(paramKey, entityType) as { current_version: number } | undefined;

      let nextVersion: number;
      if (seqRow) {
        nextVersion = seqRow.current_version + 1;
        this.db.prepare(
          `UPDATE system_config_version_seq SET current_version = ?
           WHERE param_key = ? AND COALESCE(entity_type, '__global__') = COALESCE(?, '__global__')`,
        ).run(nextVersion, paramKey, entityType);
      } else {
        nextVersion = 1;
        this.db.prepare(
          `INSERT INTO system_config_version_seq (param_key, entity_type, current_version)
           VALUES (?, ?, ?)`,
        ).run(paramKey, entityType, nextVersion);
      }

      const id = randomUUID();
      const valueJson = String(value);
      const metadata = opts.justification ? JSON.stringify({ justification: opts.justification }) : null;

      this.db.prepare(`
        INSERT INTO system_config
          (id, param_key, entity_type, value_json, config_version, status, proposed_by, metadata)
        VALUES (?, ?, ?, ?, ?, 'draft', ?, ?)
      `).run(id, paramKey, entityType, valueJson, nextVersion, opts.proposerAdminId, metadata);

      this.logAudit(id, 'proposed', opts.proposerAdminId, null, 'draft', nextVersion, metadata);

      return this.getConfigRow(id);
    })();
  }

  async submit(configId: string, proposerAdminId: string): Promise<SystemConfig> {
    return this.db.transaction(() => {
      const row = this.getConfigRowRaw(configId);

      // Only the original proposer can submit
      if (row.proposed_by !== proposerAdminId) {
        throw new InvalidStateError(configId, row.status, 'submit (not original proposer)');
      }

      this.assertTransition(row.status as SystemConfigStatus, 'pending_approval', configId);

      this.db.prepare(
        `UPDATE system_config SET status = 'pending_approval' WHERE id = ?`,
      ).run(configId);

      this.logAudit(configId, 'approved', proposerAdminId, 'draft', 'pending_approval', row.config_version, null);

      return this.getConfigRow(configId);
    })();
  }

  async approve(configId: string, approverAdminId: string): Promise<SystemConfig> {
    return this.db.transaction(() => {
      const row = this.getConfigRowRaw(configId);

      if (row.status !== 'pending_approval') {
        throw new InvalidStateError(configId, row.status, 'approve');
      }

      // Four-eyes: proposer cannot approve
      if (row.proposed_by === approverAdminId) {
        throw new FourEyesViolationError(configId, approverAdminId);
      }

      // Check if already approved by this admin
      const existingApprovers: string[] = row.approved_by ? JSON.parse(row.approved_by) : [];
      if (existingApprovers.includes(approverAdminId)) {
        throw new InvalidStateError(configId, row.status, 'approve (already approved by this admin)');
      }

      const newApprovers = [...existingApprovers, approverAdminId];
      const newCount = row.approval_count + 1;

      if (newCount >= row.required_approvals) {
        // Enough approvals — transition to cooling_down
        const cooldownEndsAt = new Date(Date.now() + DEFAULT_COOLDOWN_SECONDS * 1000).toISOString();
        this.db.prepare(`
          UPDATE system_config
          SET status = 'cooling_down', approved_by = ?, approval_count = ?, cooldown_ends_at = ?
          WHERE id = ?
        `).run(JSON.stringify(newApprovers), newCount, cooldownEndsAt, configId);

        this.logAudit(configId, 'cooling_started', approverAdminId, 'pending_approval', 'cooling_down', row.config_version, null);
      } else {
        // Not enough yet — stay in pending_approval
        this.db.prepare(`
          UPDATE system_config SET approved_by = ?, approval_count = ? WHERE id = ?
        `).run(JSON.stringify(newApprovers), newCount, configId);

        this.logAudit(configId, 'approved', approverAdminId, 'pending_approval', 'pending_approval', row.config_version, null);
      }

      return this.getConfigRow(configId);
    })();
  }

  async reject(configId: string, rejectorAdminId: string, reason: string): Promise<SystemConfig> {
    return this.db.transaction(() => {
      const row = this.getConfigRowRaw(configId);

      this.assertTransition(row.status as SystemConfigStatus, 'rejected', configId);

      this.db.prepare(
        `UPDATE system_config SET status = 'rejected' WHERE id = ?`,
      ).run(configId);

      this.logAudit(configId, 'rejected', rejectorAdminId, row.status, 'rejected', row.config_version,
        JSON.stringify({ reason }));

      return this.getConfigRow(configId);
    })();
  }

  async activateExpiredCooldowns(): Promise<number> {
    const now = new Date().toISOString();

    return this.db.transaction(() => {
      const expiredRows = this.db.prepare(`
        SELECT * FROM system_config
        WHERE status = 'cooling_down' AND cooldown_ends_at <= ?
      `).all(now) as SystemConfigRow[];

      let activated = 0;
      for (const row of expiredRows) {
        // Supersede previous active config for same (param_key, entity_type)
        const prevActive = this.db.prepare(`
          SELECT id FROM system_config
          WHERE param_key = ? AND COALESCE(entity_type, '__global__') = COALESCE(?, '__global__')
            AND status = 'active'
        `).get(row.param_key, row.entity_type) as { id: string } | undefined;

        if (prevActive) {
          this.db.prepare(`
            UPDATE system_config SET status = 'superseded', superseded_at = ?, superseded_by = ?
            WHERE id = ?
          `).run(now, row.id, prevActive.id);

          this.logAudit(prevActive.id, 'superseded', 'system', 'active', 'superseded', row.config_version, null);
        }

        // Activate the new config
        this.db.prepare(`
          UPDATE system_config SET status = 'active', activated_at = ? WHERE id = ?
        `).run(now, row.id);

        this.logAudit(row.id, 'activated', 'system', 'cooling_down', 'active', row.config_version, null);
        activated++;
      }

      if (activated > 0) {
        logger.info({ activated, event: 'constitutional.cooldown.activated' },
          `Activated ${activated} config(s) past cooldown`);
      }

      return activated;
    })();
  }

  async emergencyOverride(configId: string, approvers: string[], justification: string): Promise<SystemConfig> {
    if (approvers.length < EMERGENCY_MIN_APPROVERS) {
      throw new InvalidStateError(configId, 'n/a',
        `emergency override (requires ${EMERGENCY_MIN_APPROVERS}+ approvers, got ${approvers.length})`);
    }

    return this.db.transaction(() => {
      const row = this.getConfigRowRaw(configId);

      // Emergency can activate from pending_approval or cooling_down
      if (row.status !== 'pending_approval' && row.status !== 'cooling_down') {
        throw new InvalidStateError(configId, row.status, 'emergency override');
      }

      const now = new Date().toISOString();

      // Supersede previous active
      const prevActive = this.db.prepare(`
        SELECT id FROM system_config
        WHERE param_key = ? AND COALESCE(entity_type, '__global__') = COALESCE(?, '__global__')
          AND status = 'active'
      `).get(row.param_key, row.entity_type) as { id: string } | undefined;

      if (prevActive) {
        this.db.prepare(`
          UPDATE system_config SET status = 'superseded', superseded_at = ?, superseded_by = ?
          WHERE id = ?
        `).run(now, configId, prevActive.id);
        this.logAudit(prevActive.id, 'superseded', 'system', 'active', 'superseded', row.config_version, null);
      }

      // Activate directly (bypass cooldown)
      this.db.prepare(`
        UPDATE system_config
        SET status = 'active', activated_at = ?, approved_by = ?, approval_count = ?
        WHERE id = ?
      `).run(now, JSON.stringify(approvers), approvers.length, configId);

      this.logAudit(configId, 'emergency_override', approvers[0], row.status, 'active', row.config_version,
        JSON.stringify({ approvers, justification }));

      logger.warn({
        configId,
        paramKey: row.param_key,
        approvers,
        event: 'constitutional.emergency_override',
      }, 'Emergency override activated');

      return this.getConfigRow(configId);
    })();
  }

  // =========================================================================
  // Query Methods
  // =========================================================================

  async getActiveConfig(paramKey: string, entityType?: EntityType): Promise<SystemConfig | null> {
    const row = entityType
      ? this.db.prepare(
          `SELECT * FROM system_config WHERE param_key = ? AND entity_type = ? AND status = 'active'`,
        ).get(paramKey, entityType)
      : this.db.prepare(
          `SELECT * FROM system_config WHERE param_key = ? AND entity_type IS NULL AND status = 'active'`,
        ).get(paramKey);

    return row ? rowToConfig(row as SystemConfigRow) : null;
  }

  async getConfigHistory(paramKey: string): Promise<SystemConfig[]> {
    const rows = this.db.prepare(
      `SELECT * FROM system_config WHERE param_key = ? ORDER BY config_version DESC`,
    ).all(paramKey) as SystemConfigRow[];

    return rows.map(rowToConfig);
  }

  async getPendingProposals(): Promise<SystemConfig[]> {
    const rows = this.db.prepare(
      `SELECT * FROM system_config WHERE status IN ('draft', 'pending_approval', 'cooling_down') ORDER BY proposed_at DESC`,
    ).all() as SystemConfigRow[];

    return rows.map(rowToConfig);
  }

  // =========================================================================
  // Private Helpers
  // =========================================================================

  private getConfigRowRaw(configId: string): SystemConfigRow {
    const row = this.db.prepare(
      `SELECT * FROM system_config WHERE id = ?`,
    ).get(configId) as SystemConfigRow | undefined;

    if (!row) {
      throw new Error(`Config not found: ${configId}`);
    }
    return row;
  }

  private getConfigRow(configId: string): SystemConfig {
    return rowToConfig(this.getConfigRowRaw(configId));
  }

  private assertTransition(currentStatus: SystemConfigStatus, targetStatus: SystemConfigStatus, configId: string): void {
    if (!isValidTransition(SYSTEM_CONFIG_MACHINE, currentStatus, targetStatus)) {
      throw new InvalidStateError(configId, currentStatus, `transition to '${targetStatus}'`);
    }
  }

  private logAudit(
    configId: string,
    action: string,
    actor: string,
    previousStatus: string | null,
    newStatus: string,
    configVersion: number,
    metadata: string | null,
  ): void {
    this.db.prepare(`
      INSERT INTO system_config_audit
        (config_id, action, actor, previous_status, new_status, config_version, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(configId, action, actor, previousStatus, newStatus, configVersion, metadata);
  }
}

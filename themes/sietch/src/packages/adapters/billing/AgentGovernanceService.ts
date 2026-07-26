/**
 * AgentGovernanceService — Agent Governance Participation Adapter
 *
 * Implements weighted governance proposals, voting, delegation-based weight
 * computation, quorum tracking, cooldown activation, and parameter whitelist.
 *
 * Weight computation strategies (configurable via governance.agent_weight_source):
 *   - delegation: sum of active creator delegations (per-creator capped)
 *   - earned_reputation: EarningSettled events within window, scaled by factor
 *   - fixed_allocation: fixed weight per agent
 *
 * Agents CANNOT propose changes to sensitive parameters (kyc.*, payout.*,
 * fraud_rule.*, settlement.*) — enforced by AGENT_PROPOSABLE_KEYS whitelist.
 *
 * SDD refs: §4.4 AgentGovernanceService, §4.4.2 Weight, §4.4.3 Whitelist
 * PRD refs: FR-3.1 through FR-3.8, G-3
 * Sprint refs: Sprint 289, Task 6.4
 *
 * @module adapters/billing/AgentGovernanceService
 */

import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import { logger } from '../../../utils/logger.js';
import { sqliteTimestamp } from './protocol/timestamps.js';
import { validateConfigValue, CONFIG_FALLBACKS } from '../../core/protocol/config-schema.js';
import type { IEconomicEventEmitter } from '../../core/ports/IEconomicEventEmitter.js';
import type { IConstitutionalGovernanceService } from '../../core/ports/IConstitutionalGovernanceService.js';
import type { IAgentProvenanceVerifier } from '../../core/ports/IAgentProvenanceVerifier.js';
import type {
  IAgentGovernanceService,
  AgentProposalOptions,
  AgentVoteOptions,
  AgentGovernanceProposal,
  AgentGovernanceWeightResult,
} from '../../core/ports/IAgentGovernanceService.js';

// =============================================================================
// Constants
// =============================================================================

/**
 * Parameter key prefixes that agents are BLOCKED from proposing.
 * These require admin-only governance (security-sensitive).
 * Per SDD §4.4.3 Parameter Whitelist.
 */
const BLOCKED_PREFIXES = ['kyc.', 'payout.', 'fraud_rule.', 'settlement.'];

/** Reserved COALESCE sentinel for a NULL (global) entity_type — never a real scope. */
const GLOBAL_ENTITY_SENTINEL = '__global__';

/** Default proposal expiry: 7 days from creation */
const DEFAULT_PROPOSAL_EXPIRY_SECONDS = 7 * 24 * 60 * 60;

/**
 * Grace window added past cooldown_ends_at when a proposal reaches quorum.
 * activateExpiredCooldowns gates on expires_at > now, and expireStaleProposals
 * expires quorum_reached rows once expires_at passes. Without extending
 * expires_at at quorum, a cooldown that ends near (or after) the original
 * voting deadline — a long configured cooldown, or quorum reached late in the
 * window — would let the proposal expire before it can be activated. Extending
 * to cooldown_ends_at + this grace guarantees the hourly activation cron has a
 * window to apply the approved change, while still expiring proposals that sit
 * un-activated through genuine extended downtime.
 */
const ACTIVATION_GRACE_SECONDS = 24 * 60 * 60;

// =============================================================================
// AgentGovernanceService
// =============================================================================

export class AgentGovernanceService implements IAgentGovernanceService {
  private db: Database.Database;
  private eventEmitter: IEconomicEventEmitter | null;
  private governance: IConstitutionalGovernanceService | null;
  private provenance: IAgentProvenanceVerifier | null;

  constructor(
    db: Database.Database,
    eventEmitter?: IEconomicEventEmitter,
    governance?: IConstitutionalGovernanceService,
    provenance?: IAgentProvenanceVerifier,
  ) {
    this.db = db;
    this.eventEmitter = eventEmitter ?? null;
    this.governance = governance ?? null;
    this.provenance = provenance ?? null;
  }

  // ---------------------------------------------------------------------------
  // proposeAsAgent
  // ---------------------------------------------------------------------------

  async proposeAsAgent(
    proposerAccountId: string,
    options: AgentProposalOptions,
  ): Promise<AgentGovernanceProposal> {
    const { paramKey, value, entityType, justification } = options;

    // Step 1: Whitelist check
    if (BLOCKED_PREFIXES.some(prefix => paramKey.startsWith(prefix))) {
      throw Object.assign(
        new Error(`Parameter '${paramKey}' is not proposable by agents`),
        { code: 'VALIDATION_ERROR', statusCode: 400 },
      );
    }

    // '__global__' is the reserved COALESCE sentinel for a NULL (global)
    // entity_type. A literal '__global__' scope would supersede the real
    // global config yet store a phantom-scoped row that global resolution
    // (entity_type IS NULL) never finds — reject it at the boundary.
    if (entityType === GLOBAL_ENTITY_SENTINEL) {
      throw Object.assign(
        new Error(`entityType '${GLOBAL_ENTITY_SENTINEL}' is reserved; omit entityType for a global scope`),
        { code: 'VALIDATION_ERROR', statusCode: 400 },
      );
    }

    // Step 2: Schema validation
    const validation = validateConfigValue(paramKey, value);
    if (!validation.valid) {
      throw Object.assign(
        new Error(validation.error),
        { code: 'VALIDATION_ERROR', statusCode: 400 },
      );
    }

    // Step 3: Verify agent identity
    if (this.provenance) {
      try {
        await this.provenance.verifyProvenance(proposerAccountId);
      } catch (err: any) {
        if (err.code === 'NOT_FOUND') {
          throw Object.assign(
            new Error('Proposer must have verified agent identity'),
            { code: 'FORBIDDEN', statusCode: 403 },
          );
        }
        throw err;
      }
    }

    // Step 4: Compute proposer weight
    const weightResult = await this.computeAgentWeight(proposerAccountId);

    // Step 5: Resolve quorum threshold
    const requiredWeight = this.resolveNumericParam('governance.agent_quorum_weight');
    const cooldownSeconds = this.resolveNumericParam('governance.agent_cooldown_seconds');

    const now = sqliteTimestamp();
    const expiresAt = sqliteTimestamp(new Date(Date.now() + DEFAULT_PROPOSAL_EXPIRY_SECONDS * 1000));
    const proposalId = randomUUID();
    const valueJson = JSON.stringify(value);
    const entityTypeNorm = entityType ?? null;

    return this.db.transaction(() => {
      // Step 6: Check for existing open proposal (partial unique index enforces this too)
      const existing = this.db.prepare(`
        SELECT id FROM agent_governance_proposals
        WHERE param_key = ? AND COALESCE(entity_type, '__global__') = ? AND status = 'open'
      `).get(paramKey, entityTypeNorm ?? '__global__') as { id: string } | undefined;

      if (existing) {
        throw Object.assign(
          new Error(`Active proposal already exists for '${paramKey}': ${existing.id}`),
          { code: 'CONFLICT', statusCode: 409 },
        );
      }

      // Step 7: Insert proposal (proposer's weight counted as initial vote)
      this.db.prepare(`
        INSERT INTO agent_governance_proposals
          (id, param_key, entity_type, proposed_value, justification,
           proposer_account_id, proposer_weight, total_weight, required_weight,
           status, expires_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)
      `).run(
        proposalId, paramKey, entityTypeNorm, valueJson, justification ?? null,
        proposerAccountId, weightResult.totalWeight, weightResult.totalWeight,
        requiredWeight, expiresAt, now, now,
      );

      // Step 8: Record proposer's implicit 'support' vote
      this.db.prepare(`
        INSERT INTO agent_governance_votes
          (proposal_id, voter_account_id, vote, weight, created_at)
        VALUES (?, ?, 'support', ?, ?)
      `).run(proposalId, proposerAccountId, weightResult.totalWeight, now);

      // Step 9: Check if quorum reached immediately (single agent with enough weight)
      let status: AgentGovernanceProposal['status'] = 'open';
      let cooldownEndsAt: string | null = null;

      if (weightResult.totalWeight >= requiredWeight) {
        const cooldownEndsMs = Date.now() + cooldownSeconds * 1000;
        cooldownEndsAt = sqliteTimestamp(new Date(cooldownEndsMs));
        status = 'quorum_reached';

        // Ensure the voting deadline never pre-empts a legitimate cooldown.
        const quorumExpiresAt = sqliteTimestamp(
          new Date(Math.max(Date.parse(expiresAt), cooldownEndsMs + ACTIVATION_GRACE_SECONDS * 1000)),
        );
        this.db.prepare(`
          UPDATE agent_governance_proposals
          SET status = 'quorum_reached', cooldown_ends_at = ?, expires_at = ?, updated_at = ?
          WHERE id = ?
        `).run(cooldownEndsAt, quorumExpiresAt, now, proposalId);

        this.emitEventInTx('AgentProposalQuorumReached', proposerAccountId, {
          proposalId, paramKey, totalWeight: weightResult.totalWeight,
          requiredWeight, cooldownEndsAt, timestamp: now,
        });
      }

      // Step 10: Emit proposal submitted event
      this.emitEventInTx('AgentProposalSubmitted', proposerAccountId, {
        proposalId, paramKey, proposedValue: valueJson,
        proposerWeight: weightResult.totalWeight,
        requiredWeight, entityType: entityTypeNorm, timestamp: now,
      });

      return this.readProposal(proposalId)!;
    })();
  }

  // ---------------------------------------------------------------------------
  // voteAsAgent
  // ---------------------------------------------------------------------------

  async voteAsAgent(
    voterAccountId: string,
    proposalId: string,
    options: AgentVoteOptions,
  ): Promise<AgentGovernanceProposal> {
    // Step 1: Verify agent identity
    if (this.provenance) {
      try {
        await this.provenance.verifyProvenance(voterAccountId);
      } catch (err: any) {
        if (err.code === 'NOT_FOUND') {
          throw Object.assign(
            new Error('Voter must have verified agent identity'),
            { code: 'FORBIDDEN', statusCode: 403 },
          );
        }
        throw err;
      }
    }

    // Step 2: Compute voter weight
    const weightResult = await this.computeAgentWeight(voterAccountId);

    const now = sqliteTimestamp();

    return this.db.transaction(() => {
      // Step 3: Verify proposal exists and is open
      const proposal = this.readProposal(proposalId);
      if (!proposal) {
        throw Object.assign(
          new Error(`Proposal not found: ${proposalId}`),
          { code: 'NOT_FOUND', statusCode: 404 },
        );
      }
      if (proposal.status !== 'open') {
        throw Object.assign(
          new Error(`Proposal ${proposalId} is not open for voting (status: ${proposal.status})`),
          { code: 'CONFLICT', statusCode: 409 },
        );
      }

      // Step 4: Check duplicate vote (PK constraint also enforces this)
      const existingVote = this.db.prepare(`
        SELECT 1 FROM agent_governance_votes
        WHERE proposal_id = ? AND voter_account_id = ?
      `).get(proposalId, voterAccountId);

      if (existingVote) {
        throw Object.assign(
          new Error(`Agent ${voterAccountId} has already voted on proposal ${proposalId}`),
          { code: 'CONFLICT', statusCode: 409 },
        );
      }

      // Step 5: Record vote
      this.db.prepare(`
        INSERT INTO agent_governance_votes
          (proposal_id, voter_account_id, vote, weight, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(proposalId, voterAccountId, options.vote, weightResult.totalWeight, now);

      // Step 6: Update total weight (only 'support' votes count toward quorum)
      if (options.vote === 'support') {
        this.db.prepare(`
          UPDATE agent_governance_proposals
          SET total_weight = total_weight + ?, updated_at = ?
          WHERE id = ?
        `).run(weightResult.totalWeight, now, proposalId);
      }

      // Step 7: Check quorum
      const updated = this.readProposal(proposalId)!;
      if (updated.status === 'open' && updated.totalWeight >= updated.requiredWeight) {
        const cooldownSeconds = this.resolveNumericParam('governance.agent_cooldown_seconds');
        const cooldownEndsMs = Date.now() + cooldownSeconds * 1000;
        const cooldownEndsAt = sqliteTimestamp(new Date(cooldownEndsMs));

        // Ensure the voting deadline never pre-empts a legitimate cooldown.
        const quorumExpiresAt = sqliteTimestamp(
          new Date(Math.max(Date.parse(updated.expiresAt), cooldownEndsMs + ACTIVATION_GRACE_SECONDS * 1000)),
        );
        this.db.prepare(`
          UPDATE agent_governance_proposals
          SET status = 'quorum_reached', cooldown_ends_at = ?, expires_at = ?, updated_at = ?
          WHERE id = ?
        `).run(cooldownEndsAt, quorumExpiresAt, now, proposalId);

        this.emitEventInTx('AgentProposalQuorumReached', updated.proposerAccountId, {
          proposalId, paramKey: updated.paramKey,
          totalWeight: updated.totalWeight, requiredWeight: updated.requiredWeight,
          cooldownEndsAt, voterAccountId, timestamp: now,
        });

        return this.readProposal(proposalId)!;
      }

      return updated;
    })();
  }

  // ---------------------------------------------------------------------------
  // computeAgentWeight
  // ---------------------------------------------------------------------------

  async computeAgentWeight(agentAccountId: string): Promise<AgentGovernanceWeightResult> {
    const source = this.resolveStringParam('governance.agent_weight_source') as
      'delegation' | 'earned_reputation' | 'fixed_allocation';
    const maxWeight = this.resolveNumericParam('governance.max_weight_per_agent');

    let delegation = 0;
    let earnedReputation = 0;
    let fixedAllocation = 0;
    let total = 0;

    switch (source) {
      case 'delegation': {
        // Sum active delegations for this agent (per-creator capped by max_delegation_per_creator)
        const rows = this.db.prepare(`
          SELECT weight FROM agent_governance_delegations
          WHERE agent_account_id = ? AND active = 1
        `).all(agentAccountId) as { weight: number }[];

        delegation = rows.reduce((sum, r) => sum + r.weight, 0);
        total = delegation;
        break;
      }

      case 'earned_reputation': {
        const windowSeconds = this.resolveNumericParam('governance.reputation_window_seconds');
        const scaleFactor = this.resolveNumericParam('governance.reputation_scale_factor');
        const cutoff = sqliteTimestamp(new Date(Date.now() - windowSeconds * 1000));

        // Sum EarningSettled events within the reputation window
        const row = this.db.prepare(`
          SELECT COALESCE(SUM(
            CAST(json_extract(payload, '$.amountMicro') AS REAL)
          ), 0) as total_earned
          FROM economic_events
          WHERE entity_id = ?
            AND event_type = 'EarningSettled'
            AND created_at >= ?
        `).get(agentAccountId, cutoff) as { total_earned: number };

        // Scale: earned micro-USD → weight units
        earnedReputation = (row.total_earned / 1_000_000) * scaleFactor;
        total = earnedReputation;
        break;
      }

      case 'fixed_allocation': {
        fixedAllocation = this.resolveNumericParam('governance.fixed_weight_per_agent');
        total = fixedAllocation;
        break;
      }

      default:
        // Unknown source — use fixed allocation as safe fallback
        fixedAllocation = this.resolveNumericParam('governance.fixed_weight_per_agent');
        total = fixedAllocation;
    }

    // Cap at max weight
    total = Math.min(total, maxWeight);

    return {
      agentAccountId,
      totalWeight: total,
      source,
      breakdown: { delegation, earnedReputation, fixedAllocation },
    };
  }

  // ---------------------------------------------------------------------------
  // Query methods
  // ---------------------------------------------------------------------------

  async getProposal(proposalId: string): Promise<AgentGovernanceProposal | null> {
    return this.readProposal(proposalId);
  }

  async getActiveProposals(opts?: { limit?: number; offset?: number }): Promise<AgentGovernanceProposal[]> {
    const limit = Math.min(opts?.limit ?? 20, 100);
    const offset = opts?.offset ?? 0;

    const rows = this.db.prepare(`
      SELECT * FROM agent_governance_proposals
      WHERE status IN ('open', 'quorum_reached')
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset) as ProposalRow[];

    return rows.map(r => this.mapProposal(r));
  }

  // ---------------------------------------------------------------------------
  // Cron: activateExpiredCooldowns
  // ---------------------------------------------------------------------------

  async activateExpiredCooldowns(): Promise<number> {
    const now = sqliteTimestamp();
    let activated = 0;

    // Fail closed: activation REQUIRES the constitutional governance service to
    // create the active config a proposal applies. Without it, claiming a
    // proposal 'activated' would silently drop the approved change — no config,
    // and the terminal status hides the row from both expireStaleProposals and
    // the orphan-recovery arm below. Activate nothing so proposals stay
    // quorum_reached and are applied once governance is wired in.
    if (!this.governance) {
      logger.error({
        event: 'agent.governance.activation_skipped_no_service',
      }, 'activateExpiredCooldowns has no constitutional governance service — activating nothing (proposals remain quorum_reached)');
      return 0;
    }

    const proposals = this.db.prepare(`
      SELECT * FROM agent_governance_proposals
      WHERE status = 'quorum_reached' AND cooldown_ends_at <= ? AND expires_at > ?
    `).all(now, now) as ProposalRow[];

    for (const row of proposals) {
      // CLAIM the proposal atomically before doing any work: overlapping
      // sweeps (multiple app instances running the cron) can both read the
      // same quorum_reached row; the conditional UPDATE lets exactly one
      // sweep win, so one proposal can never produce duplicate config
      // versions. (The proposal-status CHECK constraint has no in-progress
      // state, so the claim writes the terminal status directly; the
      // orphan-recovery arm below closes the crash window that leaves.)
      // expires_at > now is the authoritative gate: the hourly lifecycle job
      // runs activation BEFORE expiry, so after scheduler downtime a
      // quorum_reached proposal past its expires_at would otherwise be
      // activated here instead of expired. expireStaleProposals covers
      // 'quorum_reached', so a proposal that missed its window must expire,
      // not apply its config.
      const claim = this.db.prepare(`
        UPDATE agent_governance_proposals
        SET status = 'activated', updated_at = ?
        WHERE id = ? AND status = 'quorum_reached' AND expires_at > ?
      `).run(now, row.id, now);
      if (claim.changes === 0) continue; // another sweep claimed it, or it expired

      try {
        await this.activateProposalConfig(row, now);
        activated++;
        logger.info({
          event: 'agent.governance.proposal_activated',
          proposalId: row.id,
          paramKey: row.param_key,
        }, 'Agent governance proposal activated');
      } catch (err: any) {
        // Release the claim so the next sweep retries; without this the
        // proposal would be closed with no active config behind it.
        this.db.prepare(`
          UPDATE agent_governance_proposals
          SET status = 'quorum_reached', updated_at = ?
          WHERE id = ? AND status = 'activated'
        `).run(now, row.id);
        logger.error({
          event: 'agent.governance.activation_error',
          proposalId: row.id,
          err: err.message,
        }, 'Failed to activate proposal — claim released for retry');
      }
    }

    // Crash recovery — LINK ONLY. Recover exactly the window where
    // activateFromAgentGovernance committed the config (stamping this
    // proposal's agentProposalId provenance) but the follow-up transaction
    // that writes activated_config_id + emits AgentProposalActivated did not
    // run. Those rows are matched by the EXISTS provenance subquery; linking
    // them is safe and idempotent — no config is created or superseded.
    //
    // We deliberately do NOT recover 'activated' rows with activated_config_id
    // NULL and no provenance-stamped config. That set conflates a rare
    // hard-crash-before-config-create orphan with pre-recovery-mechanism
    // LEGACY activations (whose configs, if any, were created without the
    // provenance metadata). The two are indistinguishable, and re-running
    // activation for a legacy row would CREATE a config that supersedes
    // whatever is currently active — clobbering newer values on upgrade. A
    // stranded hard-crash orphan can be re-proposed; silent config corruption
    // cannot be undone.
    if (this.governance) {
      const linkable = this.db.prepare(`
        SELECT p.* FROM agent_governance_proposals p
        WHERE p.status = 'activated' AND p.activated_config_id IS NULL
          AND EXISTS (
            SELECT 1 FROM system_config c
            WHERE c.metadata LIKE '%"agentProposalId":"' || p.id || '"%'
          )
      `).all() as ProposalRow[];

      for (const row of linkable) {
        const config = this.db.prepare(`
          SELECT id FROM system_config
          WHERE metadata LIKE '%"agentProposalId":"' || ? || '"%'
          LIMIT 1
        `).get(row.id) as { id: string } | undefined;
        if (!config) continue;
        try {
          this.db.transaction(() => {
            this.db.prepare(`
              UPDATE agent_governance_proposals
              SET activated_config_id = ?, updated_at = ?
              WHERE id = ? AND activated_config_id IS NULL
            `).run(config.id, now, row.id);
            this.emitEventInTx('AgentProposalActivated', row.proposer_account_id, {
              proposalId: row.id,
              paramKey: row.param_key,
              proposedValue: row.proposed_value,
              totalWeight: row.total_weight,
              timestamp: now,
            });
          })();
          activated++;
          logger.warn({
            event: 'agent.governance.proposal_link_recovered',
            proposalId: row.id,
            paramKey: row.param_key,
          }, 'Linked agent proposal to its already-committed config (link/event transaction had not run)');
        } catch (err: any) {
          logger.error({
            event: 'agent.governance.link_recovery_error',
            proposalId: row.id,
            err: err.message,
          }, 'Failed to link orphaned agent proposal activation');
        }
      }
    }

    return activated;
  }

  /**
   * Create-and-activate the constitutional config for a claimed proposal,
   * then emit the activation event. Awaited OUTSIDE any sync transaction:
   * an un-awaited async call inside db.transaction() turns failures into
   * unhandled rejections. The event is emitted after the config commits,
   * so an orphan-recovered proposal (config missing) has never emitted it.
   */
  private async activateProposalConfig(row: ProposalRow, now: string): Promise<void> {
    // A draft would never apply (resolution reads only active configs);
    // quorum + cooldown were enforced in this layer, so
    // activateFromAgentGovernance runs the supersede + activate + audit
    // path in one transaction.
    let activatedConfigId: string | null = null;
    if (this.governance) {
      const config = await this.governance.activateFromAgentGovernance(
        row.param_key,
        JSON.parse(row.proposed_value),
        {
          proposerAccountId: row.proposer_account_id,
          agentProposalId: row.id,
          totalWeight: row.total_weight,
          entityType: row.entity_type,
        },
      );
      activatedConfigId = config.id;
    }

    this.db.transaction(() => {
      // Record the FK audit link (activated_config_id → system_config.id).
      // activateFromAgentGovernance is idempotent by proposal id, so a
      // retry/orphan-recovery returns the same config and this UPDATE is a
      // stable no-op-in-value.
      if (activatedConfigId !== null) {
        this.db.prepare(`
          UPDATE agent_governance_proposals
          SET activated_config_id = ?, updated_at = ?
          WHERE id = ?
        `).run(activatedConfigId, now, row.id);
      }
      this.emitEventInTx('AgentProposalActivated', row.proposer_account_id, {
        proposalId: row.id,
        paramKey: row.param_key,
        proposedValue: row.proposed_value,
        totalWeight: row.total_weight,
        timestamp: now,
      });
    })();
  }

  // ---------------------------------------------------------------------------
  // Cron: expireStaleProposals
  // ---------------------------------------------------------------------------

  async expireStaleProposals(): Promise<number> {
    const now = sqliteTimestamp();

    const result = this.db.prepare(`
      UPDATE agent_governance_proposals
      SET status = 'expired', updated_at = ?
      WHERE status IN ('open', 'quorum_reached') AND expires_at <= ?
    `).run(now, now);

    if (result.changes > 0) {
      logger.info({
        event: 'agent.governance.proposals_expired',
        count: result.changes,
      }, `Expired ${result.changes} stale governance proposal(s)`);
    }

    return result.changes;
  }

  // ---------------------------------------------------------------------------
  // Private: Parameter resolution
  // ---------------------------------------------------------------------------

  private resolveNumericParam(key: string): number {
    if (this.governance) {
      try {
        const resolved = this.governance.resolveInTransaction(this.db as any, key);
        return Number(resolved.value);
      } catch {
        // Governance table may not exist yet
      }
    }
    return Number(CONFIG_FALLBACKS[key] ?? 0);
  }

  private resolveStringParam(key: string): string {
    if (this.governance) {
      try {
        const resolved = this.governance.resolveInTransaction(this.db as any, key);
        return String(resolved.value);
      } catch {
        // Governance table may not exist yet
      }
    }
    return String(CONFIG_FALLBACKS[key] ?? '');
  }

  // ---------------------------------------------------------------------------
  // Private: Event emission
  // ---------------------------------------------------------------------------

  private emitEventInTx(eventType: string, entityId: string, payload: Record<string, unknown>): void {
    if (!this.eventEmitter) return;

    try {
      this.eventEmitter.emitInTransaction(this.db as any, {
        eventType: eventType as any,
        entityType: 'account',
        entityId,
        correlationId: `governance:${payload.proposalId}`,
        idempotencyKey: `governance:${eventType}:${payload.proposalId}`,
        payload,
      });
    } catch {
      logger.warn({ event: `agent.governance.${eventType}_event_failed` }, `${eventType} event emission failed`);
    }
  }

  // ---------------------------------------------------------------------------
  // Private: Row mapping
  // ---------------------------------------------------------------------------

  private readProposal(proposalId: string): AgentGovernanceProposal | null {
    const row = this.db.prepare(
      `SELECT * FROM agent_governance_proposals WHERE id = ?`
    ).get(proposalId) as ProposalRow | undefined;

    return row ? this.mapProposal(row) : null;
  }

  private mapProposal(row: ProposalRow): AgentGovernanceProposal {
    return {
      id: row.id,
      paramKey: row.param_key,
      entityType: row.entity_type,
      proposedValue: row.proposed_value,
      justification: row.justification,
      proposerAccountId: row.proposer_account_id,
      proposerWeight: row.proposer_weight,
      totalWeight: row.total_weight,
      requiredWeight: row.required_weight,
      status: row.status as AgentGovernanceProposal['status'],
      cooldownEndsAt: row.cooldown_ends_at,
      activatedConfigId: row.activated_config_id,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

// =============================================================================
// Internal Types
// =============================================================================

interface ProposalRow {
  id: string;
  param_key: string;
  entity_type: string | null;
  proposed_value: string;
  justification: string | null;
  proposer_account_id: string;
  proposer_weight: number;
  total_weight: number;
  required_weight: number;
  status: string;
  cooldown_ends_at: string | null;
  activated_config_id: string | null;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

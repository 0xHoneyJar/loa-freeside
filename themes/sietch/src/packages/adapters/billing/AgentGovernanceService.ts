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

/** Default proposal expiry: 7 days from creation */
const DEFAULT_PROPOSAL_EXPIRY_SECONDS = 7 * 24 * 60 * 60;

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

    // Step 2: Schema validation
    const validation = validateConfigValue(paramKey, value);
    if (!validation.valid) {
      throw Object.assign(
        new Error(validation.error!),
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
        cooldownEndsAt = sqliteTimestamp(new Date(Date.now() + cooldownSeconds * 1000));
        status = 'quorum_reached';

        this.db.prepare(`
          UPDATE agent_governance_proposals
          SET status = 'quorum_reached', cooldown_ends_at = ?, updated_at = ?
          WHERE id = ?
        `).run(cooldownEndsAt, now, proposalId);

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
        const cooldownEndsAt = sqliteTimestamp(new Date(Date.now() + cooldownSeconds * 1000));

        this.db.prepare(`
          UPDATE agent_governance_proposals
          SET status = 'quorum_reached', cooldown_ends_at = ?, updated_at = ?
          WHERE id = ?
        `).run(cooldownEndsAt, now, proposalId);

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

    const proposals = this.db.prepare(`
      SELECT * FROM agent_governance_proposals
      WHERE status = 'quorum_reached' AND cooldown_ends_at <= ?
    `).all(now) as ProposalRow[];

    for (const row of proposals) {
      try {
        this.db.transaction(() => {
          // Create system_config entry via constitutional governance
          if (this.governance) {
            const config = this.governance.propose(
              row.param_key,
              JSON.parse(row.proposed_value),
              {
                proposer: `agent-governance:${row.proposer_account_id}`,
                justification: `Agent governance proposal ${row.id} activated after cooldown`,
                skipApproval: true, // Auto-approved (quorum met)
              } as any,
            );
          }

          // Update proposal status
          this.db.prepare(`
            UPDATE agent_governance_proposals
            SET status = 'activated', updated_at = ?
            WHERE id = ?
          `).run(now, row.id);

          // Emit activation event
          this.emitEventInTx('AgentProposalActivated', row.proposer_account_id, {
            proposalId: row.id,
            paramKey: row.param_key,
            proposedValue: row.proposed_value,
            totalWeight: row.total_weight,
            timestamp: now,
          });
        })();

        activated++;

        logger.info({
          event: 'agent.governance.proposal_activated',
          proposalId: row.id,
          paramKey: row.param_key,
        }, 'Agent governance proposal activated');
      } catch (err: any) {
        logger.error({
          event: 'agent.governance.activation_error',
          proposalId: row.id,
          err: err.message,
        }, 'Failed to activate proposal');
      }
    }

    return activated;
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

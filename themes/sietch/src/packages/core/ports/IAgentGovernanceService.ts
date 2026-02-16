/**
 * IAgentGovernanceService — Agent Governance Participation Port
 *
 * Defines the contract for agent-driven governance: weighted proposals,
 * voting, delegation, quorum tracking, and parameter activation.
 *
 * Agents are first-class governance participants. Their weight is computed
 * server-side via one of three strategies: delegation, earned_reputation,
 * or fixed_allocation (configurable via governance.agent_weight_source).
 *
 * SDD refs: §4.4 AgentGovernanceService, §4.4.1 Interface, §4.4.2 Weight
 * PRD refs: FR-3.1 through FR-3.8, G-3
 *
 * @module core/ports/IAgentGovernanceService
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Options for creating a governance proposal.
 */
export interface AgentProposalOptions {
  /** The governance parameter key to change */
  paramKey: string;
  /** Proposed new value (must pass CONFIG_SCHEMA validation) */
  value: unknown;
  /** Entity type scope (null = global) */
  entityType?: string | null;
  /** Optional justification text */
  justification?: string;
}

/**
 * Options for casting a vote.
 */
export interface AgentVoteOptions {
  /** 'support' or 'oppose' */
  vote: 'support' | 'oppose';
}

/**
 * Stored governance proposal.
 */
export interface AgentGovernanceProposal {
  id: string;
  paramKey: string;
  entityType: string | null;
  proposedValue: string;
  justification: string | null;
  proposerAccountId: string;
  proposerWeight: number;
  totalWeight: number;
  requiredWeight: number;
  status: AgentProposalStatus;
  cooldownEndsAt: string | null;
  activatedConfigId: string | null;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Proposal status lifecycle:
 *   open → quorum_reached → activated (or expired or admin_overridden)
 *   open → expired
 *   open → rejected
 *   quorum_reached → activated
 *   quorum_reached → expired
 *   any open/quorum → admin_overridden
 */
export type AgentProposalStatus =
  | 'open'
  | 'quorum_reached'
  | 'activated'
  | 'rejected'
  | 'expired'
  | 'admin_overridden';

/**
 * Result of weight computation for an agent.
 */
export interface AgentGovernanceWeightResult {
  /** The agent's account ID */
  agentAccountId: string;
  /** Total computed weight */
  totalWeight: number;
  /** Weight source used */
  source: 'delegation' | 'earned_reputation' | 'fixed_allocation';
  /** Breakdown by component */
  breakdown: {
    delegation: number;
    earnedReputation: number;
    fixedAllocation: number;
  };
}

/**
 * Stored vote record.
 */
export interface AgentGovernanceVote {
  proposalId: string;
  voterAccountId: string;
  vote: 'support' | 'oppose';
  weight: number;
  createdAt: string;
}

/**
 * Stored delegation record.
 */
export interface AgentGovernanceDelegation {
  id: string;
  creatorAccountId: string;
  agentAccountId: string;
  weight: number;
  active: boolean;
  createdAt: string;
  revokedAt: string | null;
}

// =============================================================================
// Port Interface
// =============================================================================

export interface IAgentGovernanceService {
  /**
   * Submit a governance proposal as an agent.
   *
   * Validates:
   *   - param_key is in AGENT_PROPOSABLE_KEYS whitelist
   *   - value passes CONFIG_SCHEMA validation
   *   - no existing open proposal for (param_key, entity_type)
   *   - proposer has agent identity with provenance
   *
   * The proposer's weight is computed server-side and recorded.
   * The proposer's vote is automatically cast as 'support'.
   */
  proposeAsAgent(
    proposerAccountId: string,
    options: AgentProposalOptions,
  ): Promise<AgentGovernanceProposal>;

  /**
   * Cast a weighted vote on an existing proposal.
   *
   * Validates:
   *   - proposal exists and is 'open'
   *   - voter has agent identity
   *   - voter has not already voted
   *
   * After voting, checks if quorum is reached.
   * If quorum reached, transitions to 'quorum_reached' and sets cooldown.
   */
  voteAsAgent(
    voterAccountId: string,
    proposalId: string,
    options: AgentVoteOptions,
  ): Promise<AgentGovernanceProposal>;

  /**
   * Compute governance weight for an agent.
   *
   * Strategy determined by governance.agent_weight_source:
   *   - delegation: sum of active delegations from creators (per-creator capped)
   *   - earned_reputation: EarningSettled events within window, scaled
   *   - fixed_allocation: fixed weight per agent
   *
   * Weight is capped at governance.max_weight_per_agent.
   */
  computeAgentWeight(agentAccountId: string): Promise<AgentGovernanceWeightResult>;

  /**
   * Get a proposal by ID.
   */
  getProposal(proposalId: string): Promise<AgentGovernanceProposal | null>;

  /**
   * Get active proposals (open or quorum_reached).
   */
  getActiveProposals(opts?: { limit?: number; offset?: number }): Promise<AgentGovernanceProposal[]>;

  /**
   * Activate proposals that have passed their cooldown period.
   * Called by cron job. Creates system_config entries via constitutional governance.
   * Returns count of activated proposals.
   */
  activateExpiredCooldowns(): Promise<number>;

  /**
   * Expire stale proposals past their expires_at timestamp.
   * Called by cron job. Returns count of expired proposals.
   */
  expireStaleProposals(): Promise<number>;
}

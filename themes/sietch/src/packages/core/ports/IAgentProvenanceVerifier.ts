/**
 * IAgentProvenanceVerifier — Agent Identity & Provenance Port
 *
 * Manages agent on-chain identity anchoring and creator provenance.
 * Each agent has a canonical identity: (chain_id, contract_address, token_id).
 * Creator KYC level cascades to agent verification status.
 *
 * SDD refs: §SS4.5
 * PRD refs: FR-3
 *
 * @module packages/core/ports/IAgentProvenanceVerifier
 */

import type { CreditAccount } from './ICreditLedgerService.js';

// =============================================================================
// Types
// =============================================================================

export interface RegisterAgentOpts {
  /** The agent's credit account ID */
  agentAccountId: string;
  /** The creator's credit account ID */
  creatorAccountId: string;
  /** Blockchain chain ID (e.g., 1 for Ethereum mainnet) */
  chainId: number;
  /** NFT contract address */
  contractAddress: string;
  /** Token ID within the NFT collection */
  tokenId: string;
  /** Optional creator wallet signature attesting to agent creation */
  creatorSignature?: string;
}

export interface AgentIdentity {
  id: string;
  accountId: string;
  chainId: number;
  contractAddress: string;
  tokenId: string;
  tbaAddress: string | null;
  creatorAccountId: string;
  creatorSignature: string | null;
  verifiedAt: string | null;
  createdAt: string;
}

export interface ProvenanceResult {
  agentAccountId: string;
  creatorAccountId: string;
  chainId: number;
  contractAddress: string;
  tokenId: string;
  creatorKycLevel: number;
  verified: boolean;
  verifiedAt: string | null;
}

// =============================================================================
// IAgentProvenanceVerifier Interface
// =============================================================================

export interface IAgentProvenanceVerifier {
  /**
   * Register an agent's canonical on-chain identity.
   * Validates uniqueness of (chain_id, contract_address, token_id).
   * Links agent to its creator account for KYC cascade.
   *
   * @throws {ConflictError} if canonical identity anchor already registered
   * @throws {NotFoundError} if creator_account_id doesn't exist
   */
  registerAgent(opts: RegisterAgentOpts): Promise<AgentIdentity>;

  /**
   * Verify an agent's provenance chain.
   * Returns creator's KYC level and verification status.
   */
  verifyProvenance(agentAccountId: string): Promise<ProvenanceResult>;

  /**
   * Resolve the creator account for an agent.
   */
  getCreator(agentAccountId: string): Promise<CreditAccount>;

  /**
   * Bind an ERC-6551 Token Bound Account to this agent.
   * Phase 2 stub — throws NotImplementedError.
   */
  bindTBA(accountId: string, tbaAddress: string): Promise<AgentIdentity>;
}

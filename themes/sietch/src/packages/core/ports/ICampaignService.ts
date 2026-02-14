/**
 * ICampaignService — Campaign Management Port
 *
 * Defines the contract for campaign lifecycle and batch grant operations.
 *
 * SDD refs: §1.4 CampaignService
 * Sprint refs: Task 4.2
 *
 * @module packages/core/ports/ICampaignService
 */

// =============================================================================
// Types
// =============================================================================

export type CampaignType = 'reverse_airdrop' | 'promotional' | 'loyalty' | 'referral';
export type CampaignStatus = 'draft' | 'active' | 'paused' | 'completed' | 'expired';
export type GrantFormula = 'proportional_loss' | 'fixed_amount' | 'tiered';
export type GrantStatus = 'pending' | 'granted' | 'failed' | 'revoked';

export interface CampaignConfig {
  name: string;
  description?: string;
  campaignType: CampaignType;
  budgetMicro: bigint;
  grantFormula: GrantFormula;
  grantConfig?: Record<string, unknown>;
  poolId?: string;
  perWalletCapMicro?: bigint;
  expiresAt?: string;
  createdBy?: string;
}

export interface Campaign {
  id: string;
  name: string;
  description: string | null;
  campaignType: CampaignType;
  status: CampaignStatus;
  budgetMicro: bigint;
  spentMicro: bigint;
  grantFormula: GrantFormula;
  grantConfig: Record<string, unknown> | null;
  poolId: string | null;
  perWalletCapMicro: bigint;
  expiresAt: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface GrantInput {
  accountId: string;
  amountMicro: bigint;
  formulaInput?: Record<string, unknown>;
}

export interface GrantResult {
  grantId: string;
  accountId: string;
  lotId: string;
  amountMicro: bigint;
  status: GrantStatus;
}

export interface BatchGrantResult {
  campaignId: string;
  totalGranted: number;
  totalFailed: number;
  totalAmountMicro: bigint;
  grants: GrantResult[];
}

// =============================================================================
// Interface
// =============================================================================

export interface ICampaignService {
  /** Create a new campaign in draft status */
  createCampaign(config: CampaignConfig): Promise<Campaign>;

  /** Transition campaign to active status */
  activateCampaign(campaignId: string): Promise<Campaign>;

  /** Pause an active campaign */
  pauseCampaign(campaignId: string): Promise<Campaign>;

  /** Complete a campaign (no more grants) */
  completeCampaign(campaignId: string): Promise<Campaign>;

  /** Get campaign by ID */
  getCampaign(campaignId: string): Promise<Campaign | null>;

  /** Execute batch grants for a campaign */
  batchGrant(campaignId: string, grants: GrantInput[]): Promise<BatchGrantResult>;
}

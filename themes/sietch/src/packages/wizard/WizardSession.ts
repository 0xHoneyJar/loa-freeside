/**
 * WizardSession Interface
 *
 * Sprint 42: WizardEngine & Session Store
 *
 * Defines the session data structure for the community onboarding wizard.
 * Sessions are stored in Redis with 15-minute TTL and survive container restarts.
 *
 * Session ID serves as the idempotency key for the wizard flow.
 *
 * @module packages/wizard/WizardSession
 */

import { WizardState } from './WizardState.js';

/**
 * Supported blockchain networks.
 */
export type ChainId =
  | 'berachain'
  | 'ethereum'
  | 'arbitrum'
  | 'base'
  | 'polygon'
  | 'optimism'
  | 'avalanche';

/**
 * Asset type for eligibility.
 */
export type AssetType = 'native' | 'erc20' | 'erc721' | 'erc1155';

/**
 * Asset configuration for a single token/NFT.
 */
export interface AssetConfig {
  /** Asset type */
  type: AssetType;
  /** Token/contract address (null for native token) */
  address: string | null;
  /** Token symbol for display */
  symbol: string;
  /** Token decimals (for ERC20) */
  decimals?: number;
  /** Minimum balance required */
  minBalance?: string;
  /** For NFTs, specific token IDs */
  tokenIds?: string[];
}

/**
 * Tier configuration for eligibility.
 */
export interface TierConfig {
  /** Tier name (e.g., "Gold", "Naib") */
  name: string;
  /** Minimum rank for this tier (inclusive) */
  minRank: number;
  /** Maximum rank for this tier (inclusive) */
  maxRank: number;
  /** Discord role ID (set during role mapping) */
  roleId?: string;
  /** Tier color in hex format */
  color?: string;
}

/**
 * Role mapping entry.
 */
export interface RoleMapping {
  /** Tier name */
  tierName: string;
  /** Discord role ID */
  roleId: string;
  /** Whether to create a new role */
  createNew: boolean;
  /** Role name (if creating new) */
  roleName?: string;
  /** Role color (if creating new) */
  roleColor?: string;
}

/**
 * Channel configuration entry.
 */
export interface ChannelConfig {
  /** Channel name */
  name: string;
  /** Channel type */
  type: 'text' | 'voice' | 'category' | 'forum';
  /** Parent category ID or name */
  parent?: string;
  /** Tier(s) that can access this channel */
  accessTiers: string[];
  /** Channel topic */
  topic?: string;
}

/**
 * Wizard step data - stores configuration from each step.
 */
export interface WizardStepData {
  /** Selected blockchain network */
  chainId?: ChainId;
  /** RPC URL override (optional) */
  rpcUrl?: string;

  /** Asset configurations */
  assets?: AssetConfig[];

  /** Tier configurations */
  tiers?: TierConfig[];

  /** Role mappings */
  roleMappings?: RoleMapping[];

  /** Channel configurations */
  channels?: ChannelConfig[];

  /** Deployment results */
  deploymentResults?: DeploymentResult;
}

/**
 * Deployment result data.
 */
export interface DeploymentResult {
  /** Community ID in database */
  communityId?: string;
  /** Created role IDs */
  roleIds: string[];
  /** Created channel IDs */
  channelIds: string[];
  /** Created category IDs */
  categoryIds: string[];
  /** Any errors during deployment */
  errors: string[];
  /** Timestamp of completion */
  completedAt?: string;
}

/**
 * Wizard session - complete state for a wizard instance.
 */
export interface WizardSession {
  /** Unique session ID (idempotency key) */
  id: string;

  /** Discord guild ID */
  guildId: string;

  /** Discord user ID of the wizard initiator */
  userId: string;

  /** Discord channel ID where wizard was started */
  channelId: string;

  /** Current wizard state */
  state: WizardState;

  /** Accumulated step data */
  data: WizardStepData;

  /** Timestamp when session was created (ISO 8601) */
  createdAt: string;

  /** Timestamp of last update (ISO 8601) */
  updatedAt: string;

  /** Timestamp when session expires (ISO 8601) */
  expiresAt: string;

  /** Number of state transitions */
  stepCount: number;

  /** Error message if failed */
  error?: string;

  /** Previous states for back navigation */
  history: WizardState[];

  /** Metadata for tracking */
  metadata?: {
    /** Discord interaction ID for tracking */
    interactionId?: string;
    /** Message ID for editing */
    messageId?: string;
    /** User's locale */
    locale?: string;
    /** Client version */
    clientVersion?: string;
  };
}

/**
 * Session creation parameters.
 */
export interface CreateSessionParams {
  /** Discord guild ID */
  guildId: string;
  /** Discord user ID */
  userId: string;
  /** Discord channel ID */
  channelId: string;
  /** Optional interaction ID */
  interactionId?: string;
  /** Optional locale */
  locale?: string;
}

/**
 * Session update parameters.
 */
export interface UpdateSessionParams {
  /** New state (optional) */
  state?: WizardState;
  /** Partial data update (merged with existing) */
  data?: Partial<WizardStepData>;
  /** Error message (optional) */
  error?: string;
  /** Message ID for editing */
  messageId?: string;
}

/**
 * Session query result.
 */
export interface SessionQueryResult {
  /** Found sessions */
  sessions: WizardSession[];
  /** Total count */
  total: number;
}

/**
 * Session filter options.
 */
export interface SessionFilter {
  /** Filter by guild ID */
  guildId?: string;
  /** Filter by user ID */
  userId?: string;
  /** Filter by state */
  state?: WizardState;
  /** Filter by states (any of) */
  states?: WizardState[];
  /** Filter by creation time (after) */
  createdAfter?: Date;
  /** Filter by creation time (before) */
  createdBefore?: Date;
  /** Include expired sessions */
  includeExpired?: boolean;
}

/**
 * Default session TTL in seconds (15 minutes).
 */
export const DEFAULT_SESSION_TTL = 15 * 60; // 15 minutes

/**
 * Generate a unique session ID.
 */
export function generateSessionId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `wiz_${timestamp}_${random}`;
}

/**
 * Create a new wizard session.
 */
export function createWizardSession(params: CreateSessionParams): WizardSession {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + DEFAULT_SESSION_TTL * 1000);

  return {
    id: generateSessionId(),
    guildId: params.guildId,
    userId: params.userId,
    channelId: params.channelId,
    state: WizardState.INIT,
    data: {},
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    stepCount: 0,
    history: [],
    metadata: {
      interactionId: params.interactionId,
      locale: params.locale,
    },
  };
}

/**
 * Check if a session has expired.
 */
export function isSessionExpired(session: WizardSession): boolean {
  return new Date(session.expiresAt) < new Date();
}

/**
 * Serialize a session for Redis storage.
 */
export function serializeSession(session: WizardSession): string {
  return JSON.stringify(session);
}

/**
 * Deserialize a session from Redis storage.
 */
export function deserializeSession(data: string): WizardSession {
  return JSON.parse(data) as WizardSession;
}

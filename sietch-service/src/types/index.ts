import type { Address } from 'viem';

/**
 * BGT eligibility entry representing a wallet's claim/burn status
 */
export interface EligibilityEntry {
  /** Wallet address */
  address: Address;
  /** Total BGT claimed from reward vaults (raw bigint) */
  bgtClaimed: bigint;
  /** Total BGT burned/redeemed (raw bigint) */
  bgtBurned: bigint;
  /** Net BGT held (claimed - burned, raw bigint) */
  bgtHeld: bigint;
  /** Rank in the eligibility list (1-69 for eligible, undefined for others) */
  rank?: number;
  /** Assigned role based on rank */
  role: 'naib' | 'fedaykin' | 'none';
}

/**
 * Serialized eligibility entry for API responses and database storage
 */
export interface SerializedEligibilityEntry {
  address: string;
  bgtClaimed: string;
  bgtBurned: string;
  bgtHeld: string;
  rank?: number;
  role: 'naib' | 'fedaykin' | 'none';
}

/**
 * Diff result comparing previous and current eligibility snapshots
 */
export interface EligibilityDiff {
  /** Wallets that became newly eligible */
  added: EligibilityEntry[];
  /** Wallets that lost eligibility */
  removed: EligibilityEntry[];
  /** Wallets promoted to Naib (entered top 7) */
  promotedToNaib: EligibilityEntry[];
  /** Wallets demoted from Naib (left top 7) */
  demotedFromNaib: EligibilityEntry[];
}

/**
 * Claim event from reward vault RewardPaid event
 */
export interface ClaimEvent {
  /** Wallet that received the reward */
  recipient: Address;
  /** Amount of BGT claimed */
  amount: bigint;
}

/**
 * Burn event from BGT Transfer to 0x0
 */
export interface BurnEvent {
  /** Wallet that burned BGT */
  from: Address;
  /** Amount of BGT burned */
  amount: bigint;
}

/**
 * Health status of the service
 */
export interface HealthStatus {
  /** Last successful RPC query timestamp */
  lastSuccessfulQuery: Date | null;
  /** Last query attempt timestamp */
  lastQueryAttempt: Date | null;
  /** Number of consecutive query failures */
  consecutiveFailures: number;
  /** Whether service is in grace period (no revocations) */
  inGracePeriod: boolean;
}

/**
 * Admin override for manual eligibility adjustments
 */
export interface AdminOverride {
  id: number;
  /** Wallet address to override */
  address: string;
  /** Override action */
  action: 'add' | 'remove';
  /** Reason for the override */
  reason: string;
  /** Admin who created the override */
  createdBy: string;
  /** When the override was created */
  createdAt: Date;
  /** When the override expires (null = permanent) */
  expiresAt: Date | null;
  /** Whether the override is currently active */
  active: boolean;
}

/**
 * Audit log entry
 */
export interface AuditLogEntry {
  id: number;
  /** Type of event */
  eventType:
    | 'eligibility_update'
    | 'admin_override'
    | 'member_removed'
    | 'member_added'
    | 'naib_promotion'
    | 'naib_demotion'
    | 'grace_period_entered'
    | 'grace_period_exited';
  /** Event-specific data */
  eventData: Record<string, unknown>;
  /** When the event occurred */
  createdAt: Date;
}

/**
 * Discord wallet mapping (wallet address to Discord user ID)
 */
export interface WalletMapping {
  discordUserId: string;
  walletAddress: string;
  verifiedAt: Date;
}

/**
 * API response for /eligibility endpoint
 */
export interface EligibilityResponse {
  /** When the eligibility data was last updated */
  updated_at: string;
  /** Whether service is in grace period */
  grace_period: boolean;
  /** Top 69 eligible wallets */
  top_69: Array<{
    rank: number;
    address: string;
    bgt_held: number;
  }>;
  /** Top 7 wallet addresses (Naib council) */
  top_7: string[];
}

/**
 * API response for /health endpoint
 */
export interface HealthResponse {
  /** Service status */
  status: 'healthy' | 'degraded';
  /** Last successful query timestamp */
  last_successful_query: string | null;
  /** Next scheduled query timestamp */
  next_query: string;
  /** Whether service is in grace period */
  grace_period: boolean;
}

/**
 * Request body for POST /admin/override
 */
export interface AdminOverrideRequest {
  address: string;
  action: 'add' | 'remove';
  reason: string;
}

// =============================================================================
// Social Layer Types (v2.0)
// =============================================================================

/**
 * Member profile with privacy separation
 * Private fields (discordUserId) are NEVER exposed in public API responses
 */
export interface MemberProfile {
  /** Internal UUID used for public identity and avatar generation */
  memberId: string;
  /** Discord user ID - PRIVATE, never exposed in public API */
  discordUserId: string;
  /** Pseudonymous name chosen by member */
  nym: string;
  /** Optional bio (URLs stripped for privacy) */
  bio: string | null;
  /** Profile picture URL (Discord CDN or null) */
  pfpUrl: string | null;
  /** Type of profile picture */
  pfpType: 'custom' | 'generated' | 'none';
  /** Member tier from eligibility (naib or fedaykin) */
  tier: 'naib' | 'fedaykin';
  /** When profile was created */
  createdAt: Date;
  /** Last profile update */
  updatedAt: Date;
  /** Last nym change timestamp */
  nymLastChanged: Date | null;
  /** Whether onboarding is complete */
  onboardingComplete: boolean;
  /** Current onboarding step (0-3) */
  onboardingStep: number;
}

/**
 * Public profile view - privacy-filtered
 * NEVER contains discordUserId, wallet address, or other private data
 */
export interface PublicProfile {
  /** Internal member ID (for avatar generation) */
  memberId: string;
  /** Pseudonymous name */
  nym: string;
  /** Optional bio */
  bio: string | null;
  /** Profile picture URL */
  pfpUrl: string | null;
  /** Profile picture type */
  pfpType: 'custom' | 'generated' | 'none';
  /** Member tier */
  tier: 'naib' | 'fedaykin';
  /** Tenure category derived from membership duration */
  tenureCategory: 'og' | 'veteran' | 'elder' | 'member';
  /** Badges earned (public info only) */
  badges: PublicBadge[];
  /** Total badge count */
  badgeCount: number;
  /** Member since (for tenure display) */
  memberSince: Date;
}

/**
 * Badge definition
 */
export interface Badge {
  /** Unique badge identifier */
  badgeId: string;
  /** Display name */
  name: string;
  /** Badge description */
  description: string;
  /** Badge category */
  category: 'tenure' | 'engagement' | 'contribution' | 'special';
  /** Emoji for display */
  emoji: string | null;
  /** Auto-award criteria type (null = manual only) */
  autoCriteriaType: 'tenure_days' | 'activity_balance' | 'badge_count' | null;
  /** Auto-award criteria value */
  autoCriteriaValue: number | null;
  /** Display order within category */
  displayOrder: number;
}

/**
 * Public badge info (for profile display)
 */
export interface PublicBadge {
  badgeId: string;
  name: string;
  description: string;
  category: 'tenure' | 'engagement' | 'contribution' | 'special';
  emoji: string | null;
  awardedAt: Date;
}

/**
 * Member badge record (junction table)
 */
export interface MemberBadge {
  id: number;
  memberId: string;
  badgeId: string;
  awardedAt: Date;
  /** null = automatic, otherwise admin discordUserId */
  awardedBy: string | null;
  /** Reason for manual award */
  awardReason: string | null;
  /** Whether badge was revoked */
  revoked: boolean;
  revokedAt: Date | null;
  revokedBy: string | null;
}

/**
 * Member activity tracking with demurrage
 */
export interface MemberActivity {
  memberId: string;
  /** Current activity balance (decays 10% every 6 hours) */
  activityBalance: number;
  /** Last time decay was applied */
  lastDecayAt: Date;
  /** Lifetime message count (never decays) */
  totalMessages: number;
  /** Lifetime reactions given (never decays) */
  totalReactionsGiven: number;
  /** Lifetime reactions received (never decays) */
  totalReactionsReceived: number;
  /** Last activity timestamp */
  lastActiveAt: Date | null;
  /** Peak activity balance achieved */
  peakBalance: number;
  updatedAt: Date;
}

/**
 * Activity points configuration
 */
export interface ActivityPoints {
  message: number;
  reactionGiven: number;
  reactionReceived: number;
}

/**
 * Member perk/access record
 */
export interface MemberPerk {
  id: number;
  memberId: string;
  perkType: 'channel_access' | 'role' | 'custom';
  perkId: string;
  grantedBy: 'automatic' | 'admin' | 'badge';
  grantedReason: string | null;
  grantedAt: Date;
  expiresAt: Date | null;
}

/**
 * Onboarding state (in-memory tracking during wizard)
 */
export interface OnboardingState {
  discordUserId: string;
  currentStep: number;
  nym: string | null;
  bio: string | null;
  pfpUrl: string | null;
  pfpType: 'custom' | 'generated' | 'none';
  startedAt: Date;
  lastInteractionAt: Date;
}

/**
 * Directory filters for member browsing
 */
export interface DirectoryFilters {
  /** Filter by tier */
  tier?: 'naib' | 'fedaykin';
  /** Filter by badge (has this badge) */
  badge?: string;
  /** Filter by tenure category */
  tenureCategory?: 'og' | 'veteran' | 'elder' | 'member';
  /** Sort field */
  sortBy?: 'nym' | 'tenure' | 'badgeCount';
  /** Sort direction */
  sortDir?: 'asc' | 'desc';
  /** Pagination */
  page?: number;
  pageSize?: number;
}

/**
 * Directory result with pagination
 */
export interface DirectoryResult {
  members: PublicProfile[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * Leaderboard entry
 */
export interface LeaderboardEntry {
  rank: number;
  nym: string;
  pfpUrl: string | null;
  tier: 'naib' | 'fedaykin';
  badgeCount: number;
  tenureCategory: 'og' | 'veteran' | 'elder' | 'member';
}

/**
 * Profile update request (from API or Discord)
 */
export interface ProfileUpdateRequest {
  nym?: string;
  bio?: string | null;
  pfpUrl?: string | null;
  pfpType?: 'custom' | 'generated' | 'none';
}

/**
 * Badge award request (admin)
 */
export interface BadgeAwardRequest {
  memberId: string;
  badgeId: string;
  reason?: string;
}

/**
 * API response for /api/profile/:memberId
 */
export interface ProfileResponse {
  profile: PublicProfile;
}

/**
 * API response for /api/directory
 */
export interface DirectoryResponse {
  members: PublicProfile[];
  pagination: {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
}

/**
 * API response for /api/leaderboard
 */
export interface LeaderboardResponse {
  leaderboard: LeaderboardEntry[];
  updated_at: string;
}

/**
 * API response for /api/badges
 */
export interface BadgesResponse {
  badges: Badge[];
}

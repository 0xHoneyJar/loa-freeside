import type { Address } from 'viem';

// Re-export billing types (v4.0 - Sprint 23)
export * from './billing.js';

// Re-export theme builder types (Sprint 1 - WYSIWYG Theme Builder)
export * from './theme.types.js';
export * from './theme-component.types.js';
export * from './theme-web3.types.js';

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
    | 'grace_period_exited'
    | 'admin_badge_award'
    | 'admin_badge_revoke'
    | 'role_assigned'
    | 'role_removed'
    | 'migration_prompt_sent'
    | 'waitlist_registration'
    | 'waitlist_unregistration'
    | 'waitlist_eligible'
    | 'alert_sent'
    | 'admin_test_alert'
    | 'admin_reset_alert_counters'
    // Sprint 14: Integration event types
    | 'naib_seats_evaluated'
    | 'weekly_reset'
    // Sprint 15-16: Tier system event types
    | 'tier_change'
    | 'tier_role_sync'
    | 'tier_roles_assigned'
    | 'tier_roles_removed'
    // Sprint 17: Water Sharer event types
    | 'water_sharer_grant'
    | 'water_sharer_revoke'
    // Sprint 20: Weekly Digest event types
    | 'weekly_digest_posted'
    | 'weekly_digest_skipped'
    | 'weekly_digest_failed'
    | 'weekly_digest_error'
    // Sprint 28: Boost event types
    | 'boost_expiry_check'
    // Sprint 79: Native Wallet Verification event types
    | 'wallet_verification'
    | 'wallet_verification_failed';
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

// =============================================================================
// Naib Dynamics Types (v2.1 - Sprint 11)
// =============================================================================

/**
 * Reason for unseating a Naib member
 */
export type UnseatReason = 'bumped' | 'left_server' | 'ineligible' | 'manual';

/**
 * Naib seat record from database
 */
export interface NaibSeat {
  /** Auto-incrementing ID */
  id: number;
  /** Seat number (1-7) */
  seatNumber: number;
  /** Member holding/held this seat */
  memberId: string;
  /** When the member was seated */
  seatedAt: Date;
  /** When the member was unseated (null if currently seated) */
  unseatedAt: Date | null;
  /** Reason for unseating */
  unseatReason: UnseatReason | null;
  /** Member ID who bumped this member (if bumped) */
  bumpedByMemberId: string | null;
  /** BGT holdings at time of seating (wei as string) */
  bgtAtSeating: string;
  /** BGT holdings at time of unseating (wei as string) */
  bgtAtUnseating: string | null;
}

/**
 * Current Naib member with profile and BGT info
 */
export interface NaibMember {
  /** Seat record */
  seat: NaibSeat;
  /** Member profile */
  profile: MemberProfile;
  /** Current BGT holdings (wei as string) */
  currentBgt: string;
  /** Rank in overall eligibility list */
  eligibilityRank: number;
  /** Whether this is a founding Naib (first 7 ever) */
  isFounding: boolean;
}

/**
 * Result of a bump operation
 */
export interface BumpResult {
  /** Whether a bump occurred */
  bumped: boolean;
  /** The member who was bumped (if any) */
  bumpedMember: NaibMember | null;
  /** The new Naib member */
  newNaib: NaibMember | null;
  /** Seat number affected */
  seatNumber: number;
}

/**
 * Result of evaluating a new member for Naib status
 */
export interface NaibEvaluationResult {
  /** Whether the member became a Naib */
  becameNaib: boolean;
  /** Seat assigned (if became Naib) */
  seatNumber: number | null;
  /** Whether someone was bumped */
  causedBump: boolean;
  /** Details of bump (if any) */
  bumpResult: BumpResult | null;
}

/**
 * Type of change during seat evaluation
 */
export type NaibChangeType =
  | 'seated'      // New member took an empty seat
  | 'bumped'      // Member was bumped by higher BGT holder
  | 'unseated'    // Member left server or became ineligible
  | 'defended';   // Member defended seat against potential bumper

/**
 * Record of a seat change during evaluation
 */
export interface NaibChange {
  /** Type of change */
  type: NaibChangeType;
  /** Seat number affected */
  seatNumber: number;
  /** Member involved */
  memberId: string;
  /** Member nym for logging */
  memberNym: string;
  /** For bumps: the member who did the bumping */
  bumpedBy?: {
    memberId: string;
    nym: string;
  };
  /** BGT at time of change */
  bgt: string;
}

/**
 * Result of full seat evaluation (during sync)
 */
export interface NaibEvaluationSyncResult {
  /** All changes that occurred */
  changes: NaibChange[];
  /** Current Naib members after evaluation */
  currentNaib: NaibMember[];
  /** Number of empty seats remaining */
  emptySeats: number;
}

/**
 * Public Naib member info (for API/display)
 * Privacy-filtered: no wallet addresses or Discord IDs
 */
export interface PublicNaibMember {
  /** Seat number (1-7) */
  seatNumber: number;
  /** Member nym */
  nym: string;
  /** Member ID (for avatar) */
  memberId: string;
  /** Profile picture URL */
  pfpUrl: string | null;
  /** When they were seated */
  seatedAt: Date;
  /** Whether this is a founding Naib */
  isFounding: boolean;
  /** Current eligibility rank */
  rank: number;
}

/**
 * Public Former Naib info
 */
export interface PublicFormerNaib {
  /** Member nym */
  nym: string;
  /** Member ID (for avatar) */
  memberId: string;
  /** Profile picture URL */
  pfpUrl: string | null;
  /** When they first became Naib */
  firstSeatedAt: Date;
  /** When they were last unseated */
  lastUnseatedAt: Date;
  /** Total time as Naib (milliseconds) */
  totalTenureMs: number;
  /** Number of times they held a seat */
  seatCount: number;
}

/**
 * API response for GET /api/naib
 */
export interface NaibResponse {
  /** Current Naib members (seats 1-7) */
  current: PublicNaibMember[];
  /** Former Naib members */
  former: PublicFormerNaib[];
  /** When data was last updated */
  updatedAt: string;
}

/**
 * API response for GET /api/naib/history
 */
export interface NaibHistoryResponse {
  /** Recent seat changes */
  changes: Array<{
    type: NaibChangeType;
    seatNumber: number;
    memberNym: string;
    bumpedByNym?: string;
    timestamp: string;
  }>;
  /** Total number of changes */
  total: number;
}

// =============================================================================
// Threshold & Waitlist Types (v2.1 - Sprint 12: Cave Entrance)
// =============================================================================

/**
 * Waitlist registration record from database
 */
export interface WaitlistRegistration {
  /** Auto-incrementing ID */
  id: number;
  /** Discord user ID (not necessarily a Sietch member) */
  discordUserId: string;
  /** Wallet address being tracked */
  walletAddress: string;
  /** Position (70-100) at time of registration */
  positionAtRegistration: number;
  /** BGT holdings at registration (wei as string) */
  bgtAtRegistration: string;
  /** When they registered */
  registeredAt: Date;
  /** Whether they've been notified of eligibility */
  notified: boolean;
  /** When they were notified (if notified) */
  notifiedAt: Date | null;
  /** Whether registration is active */
  active: boolean;
}

/**
 * Threshold snapshot record from database
 */
export interface ThresholdSnapshot {
  /** Auto-incrementing ID */
  id: number;
  /** BGT required to enter top 69 (position 69's holdings, wei as string) */
  entryThresholdBgt: string;
  /** Total wallets in positions 1-69 */
  eligibleCount: number;
  /** Total wallets in positions 70-100 */
  waitlistCount: number;
  /** Position 70's BGT (first waitlist position, wei as string) */
  waitlistTopBgt: string | null;
  /** Position 100's BGT (last tracked position, wei as string) */
  waitlistBottomBgt: string | null;
  /** Gap between position 69 and 70 (distance to entry, wei as string) */
  gapToEntry: string | null;
  /** When this snapshot was taken */
  snapshotAt: Date;
}

/**
 * Position distance information for a wallet
 * Used for showing how far a wallet is from entry or from being bumped
 */
export interface PositionDistance {
  /** Wallet address */
  address: string;
  /** Current position in eligibility ranking */
  position: number;
  /** Current BGT holdings (wei as string) */
  bgt: string;
  /** BGT needed to move up one position (wei as string, null if position 1) */
  distanceToAbove: string | null;
  /** BGT buffer before being passed by position below (wei as string, null if last) */
  distanceToBelow: string | null;
  /** BGT needed to enter top 69 (wei as string, null if already eligible) */
  distanceToEntry: string | null;
}

/**
 * Threshold data for API responses and embeds
 */
export interface ThresholdData {
  /** BGT required to enter top 69 (human-readable number) */
  entryThreshold: number;
  /** BGT required to enter top 69 (wei as string for precision) */
  entryThresholdWei: string;
  /** Total eligible members (positions 1-69) */
  eligibleCount: number;
  /** Total waitlist positions (70-100) */
  waitlistCount: number;
  /** Gap from position 70 to entry (human-readable) */
  gapToEntry: number | null;
  /** When data was last updated */
  updatedAt: Date;
}

/**
 * Waitlist position with distance info for display
 */
export interface WaitlistPosition {
  /** Position (70-100) */
  position: number;
  /** Wallet address (truncated for display: 0x1234...5678) */
  addressDisplay: string;
  /** Full wallet address */
  address: string;
  /** Current BGT holdings (human-readable) */
  bgt: number;
  /** BGT needed to enter top 69 (human-readable) */
  distanceToEntry: number;
  /** Whether this wallet is registered for alerts */
  isRegistered: boolean;
}

/**
 * Result of registering for waitlist
 */
export interface WaitlistRegistrationResult {
  /** Whether registration was successful */
  success: boolean;
  /** Registration record (if successful) */
  registration: WaitlistRegistration | null;
  /** Error message (if failed) */
  error: string | null;
  /** Current position info (if successful) */
  position: WaitlistPosition | null;
}

/**
 * Result of checking waitlist for newly eligible members
 */
export interface WaitlistEligibilityCheck {
  /** Registrations that are now eligible */
  newlyEligible: WaitlistRegistration[];
  /** Registrations that are no longer in 70-100 range (dropped out) */
  droppedOut: WaitlistRegistration[];
}

/**
 * API response for GET /api/threshold
 */
export interface ThresholdResponse {
  /** Entry threshold BGT (human-readable) */
  entry_threshold: number;
  /** Number of eligible members (in top 69) */
  eligible_count: number;
  /** Number in waitlist range (70-100) */
  waitlist_count: number;
  /** Gap from position 70 to entry */
  gap_to_entry: number | null;
  /** Top waitlist positions */
  top_waitlist: Array<{
    position: number;
    address_display: string;
    bgt: number;
    distance_to_entry: number;
    is_registered: boolean;
  }>;
  /** When data was last updated */
  updated_at: string;
}

/**
 * API response for GET /api/threshold/history
 */
export interface ThresholdHistoryResponse {
  /** Historical snapshots */
  snapshots: Array<{
    id: number;
    entry_threshold: number;
    eligible_count: number;
    waitlist_count: number;
    created_at: string;
  }>;
  /** Number of snapshots returned */
  count: number;
}

/**
 * API response for GET /api/waitlist/status/:address
 */
export interface WaitlistStatusResponse {
  /** Wallet address */
  address: string;
  /** Whether wallet is in positions 70-100 */
  is_in_waitlist_range: boolean;
  /** Current position (if in 70-100 range) */
  position: number | null;
  /** Current BGT (human-readable) */
  bgt: number | null;
  /** Distance to entry (if applicable) */
  distance_to_entry: number | null;
  /** Whether registered for alerts */
  is_registered: boolean;
  /** When registered (if applicable) */
  registered_at: string | null;
}

// =============================================================================
// Notification Types (v2.1 - Sprint 13: Notification System)
// =============================================================================

/**
 * Types of alerts that can be sent
 */
export type AlertType =
  | 'position_update'     // Regular position distance update
  | 'at_risk_warning'     // Bottom 10% warning (positions 63-69)
  | 'naib_threat'         // Naib seat at risk from challenger
  | 'naib_bump'           // Naib member was bumped
  | 'naib_seated'         // Member just got Naib seat
  | 'waitlist_eligible'   // Waitlist member became eligible
  | 'tier_promotion'      // Member promoted to higher tier (Sprint 18)
  | 'badge_award';        // Badge awarded to member (Sprint 18)

/**
 * Alert frequency preferences
 */
export type AlertFrequency = '1_per_week' | '2_per_week' | '3_per_week' | 'daily';

/**
 * Notification preferences record from database
 */
export interface NotificationPreferences {
  /** Auto-incrementing ID */
  id: number;
  /** Member this preference belongs to */
  memberId: string;
  /** Enable position distance updates */
  positionUpdates: boolean;
  /** Enable at-risk warnings (bottom 10%) */
  atRiskWarnings: boolean;
  /** Enable Naib-specific alerts (seat threats) */
  naibAlerts: boolean;
  /** How many alerts per week */
  frequency: AlertFrequency;
  /** Number of alerts sent this week */
  alertsSentThisWeek: number;
  /** Start of current week for rate limiting */
  weekStartTimestamp: Date;
  /** When preferences were created */
  createdAt: Date;
  /** When preferences were last updated */
  updatedAt: Date;
}

/**
 * Alert history record from database
 */
export interface AlertRecord {
  /** Auto-incrementing ID */
  id: number;
  /** Recipient ID (member_id or discord_user_id) */
  recipientId: string;
  /** Type of recipient */
  recipientType: 'member' | 'waitlist';
  /** Type of alert sent */
  alertType: AlertType;
  /** Alert data (JSON parsed) */
  alertData: AlertData;
  /** Whether alert was successfully delivered */
  delivered: boolean;
  /** Error message if delivery failed */
  deliveryError: string | null;
  /** When alert was sent */
  sentAt: Date;
}

/**
 * Data payload for different alert types
 */
export type AlertData =
  | PositionUpdateAlertData
  | AtRiskWarningAlertData
  | NaibThreatAlertData
  | NaibBumpAlertData
  | NaibSeatedAlertData
  | WaitlistEligibleAlertData
  | TierPromotionAlertData
  | BadgeAwardAlertData;

/**
 * Position update alert data
 */
export interface PositionUpdateAlertData {
  type: 'position_update';
  position: number;
  bgt: number;
  distanceToAbove: number | null;
  distanceToBelow: number | null;
  distanceToEntry: number | null;
  isNaib: boolean;
  isFedaykin: boolean;
}

/**
 * At-risk warning alert data (bottom 10% - positions 63-69)
 */
export interface AtRiskWarningAlertData {
  type: 'at_risk_warning';
  position: number;
  bgt: number;
  distanceToBelow: number;
  positionsAtRisk: number; // How many positions until safe (out of bottom 10%)
}

/**
 * Naib threat alert data (someone challenging your seat)
 */
export interface NaibThreatAlertData {
  type: 'naib_threat';
  seatNumber: number;
  currentBgt: number;
  challengerBgt: number;
  deficit: number; // How much more BGT you need to stay safe
}

/**
 * Naib bump alert data (you were bumped from Naib)
 */
export interface NaibBumpAlertData {
  type: 'naib_bump';
  seatNumber: number;
  bgtAtBump: number;
  bumpedByBgt: number;
  deficit: number;
}

/**
 * Naib seated alert data (congratulations, you're now Naib)
 */
export interface NaibSeatedAlertData {
  type: 'naib_seated';
  seatNumber: number;
  bgt: number;
  bumpedPreviousHolder: boolean;
}

/**
 * Waitlist eligible alert data
 */
export interface WaitlistEligibleAlertData {
  type: 'waitlist_eligible';
  previousPosition: number;
  currentPosition: number;
  bgt: number;
}

/**
 * Tier promotion alert data (v3.0 - Sprint 18)
 * Sent when member is promoted to a higher tier
 */
export interface TierPromotionAlertData {
  type: 'tier_promotion';
  /** Previous tier */
  oldTier: string;
  /** New (higher) tier */
  newTier: string;
  /** Display name of new tier */
  newTierName: string;
  /** BGT threshold for new tier (null if rank-based) */
  bgtThreshold: number | null;
  /** Whether new tier is rank-based (Fedaykin/Naib) */
  isRankBased: boolean;
}

/**
 * Badge award alert data (v3.0 - Sprint 18)
 * Sent when admin awards a badge to a member
 */
export interface BadgeAwardAlertData {
  type: 'badge_award';
  /** Badge ID */
  badgeId: string;
  /** Badge display name */
  badgeName: string;
  /** Badge description */
  badgeDescription: string;
  /** Badge emoji */
  badgeEmoji: string | null;
  /** Reason for awarding (admin-provided) */
  awardReason: string | null;
  /** Whether this is Water Sharer badge (for special messaging) */
  isWaterSharer: boolean;
}

/**
 * Result of checking if alert can be sent
 */
export interface CanSendAlertResult {
  /** Whether alert can be sent */
  canSend: boolean;
  /** Reason if cannot send */
  reason: string | null;
  /** Current alerts sent this week */
  alertsSentThisWeek: number;
  /** Max alerts allowed per week based on frequency */
  maxAlertsPerWeek: number;
}

/**
 * Result of sending an alert
 */
export interface SendAlertResult {
  /** Whether alert was successfully sent */
  success: boolean;
  /** Alert record ID */
  alertId: number | null;
  /** Error message if failed */
  error: string | null;
}

/**
 * API response for GET /api/notifications/preferences
 */
export interface NotificationPreferencesResponse {
  /** Position updates enabled */
  position_updates: boolean;
  /** At-risk warnings enabled */
  at_risk_warnings: boolean;
  /** Naib alerts enabled */
  naib_alerts: boolean;
  /** Alert frequency */
  frequency: AlertFrequency;
  /** Alerts sent this week */
  alerts_sent_this_week: number;
  /** Max alerts based on frequency */
  max_alerts_per_week: number;
}

/**
 * API request for PUT /api/notifications/preferences
 */
export interface UpdateNotificationPreferencesRequest {
  /** Position updates enabled */
  position_updates?: boolean;
  /** At-risk warnings enabled */
  at_risk_warnings?: boolean;
  /** Naib alerts enabled */
  naib_alerts?: boolean;
  /** Alert frequency */
  frequency?: AlertFrequency;
}

/**
 * API response for GET /api/notifications/history
 */
export interface NotificationHistoryResponse {
  /** Alert history records */
  alerts: Array<{
    id: number;
    alert_type: AlertType;
    delivered: boolean;
    sent_at: string;
    alert_data: AlertData;
  }>;
  /** Total count */
  total: number;
}

/**
 * API response for GET /api/position
 */
export interface PositionResponse {
  /** Current position in eligibility ranking */
  position: number;
  /** Current BGT holdings (human-readable) */
  bgt: number;
  /** BGT needed to move up one position */
  distance_to_above: number | null;
  /** BGT buffer before being passed */
  distance_to_below: number | null;
  /** BGT needed to enter top 69 (null if already eligible) */
  distance_to_entry: number | null;
  /** Whether member is Naib */
  is_naib: boolean;
  /** Whether member is Fedaykin */
  is_fedaykin: boolean;
  /** Whether member is at risk (bottom 10%) */
  is_at_risk: boolean;
}

/**
 * Admin stats response for GET /admin/alerts/stats
 */
export interface AlertStatsResponse {
  /** Total alerts sent (all time) */
  total_sent: number;
  /** Alerts sent this week */
  sent_this_week: number;
  /** Breakdown by alert type */
  by_type: Record<AlertType, number>;
  /** Delivery success rate (0-1) */
  delivery_rate: number;
  /** Percentage of members with alerts disabled */
  opt_out_rate: number;
  /** Members with position_updates disabled */
  position_updates_disabled: number;
  /** Members with at_risk_warnings disabled */
  at_risk_warnings_disabled: number;
}

// =============================================================================
// Tier System Types (v3.0 - Sprint 15: Tier Foundation)
// =============================================================================

/**
 * Valid tier names in the Sietch v3.0 system
 * Ordered from lowest to highest (except Naib/Fedaykin are rank-based)
 */
export type Tier =
  | 'hajra'       // 6.9+ BGT - Entry level
  | 'ichwan'      // 69+ BGT - Brotherhood
  | 'qanat'       // 222+ BGT - Underground channels
  | 'sihaya'      // 420+ BGT - Desert spring
  | 'mushtamal'   // 690+ BGT - Inner garden
  | 'sayyadina'   // 888+ BGT - Priestess rank
  | 'usul'        // 1111+ BGT - Base of the pillar
  | 'fedaykin'    // Top 8-69 - Elite warriors (rank-based)
  | 'naib';       // Top 7 - Tribal leaders (rank-based)

/**
 * Tier history entry tracking member progression
 */
export interface TierHistoryEntry {
  /** Auto-incrementing ID */
  id: number;
  /** Member whose tier changed */
  memberId: string;
  /** Previous tier (null for initial assignment) */
  oldTier: Tier | null;
  /** New tier */
  newTier: Tier;
  /** BGT holdings at time of change (wei as string) */
  bgtAtChange: string;
  /** Eligibility rank at time of change */
  rankAtChange: number | null;
  /** When the change occurred */
  changedAt: Date;
}

/**
 * Water Sharer grant record (v3.0 - Sprint 17)
 * Tracks badge sharing between existing members
 */
export interface WaterSharerGrant {
  /** Unique grant identifier (UUID) */
  id: string;
  /** Member who shared the badge (must have Water Sharer badge) */
  granterMemberId: string;
  /** Member who received the badge */
  recipientMemberId: string;
  /** When the grant was made (unix timestamp) */
  grantedAt: Date;
  /** When the grant was revoked (null if active) */
  revokedAt: Date | null;
}

/**
 * Water Sharer sharing status for a member
 */
export interface WaterSharerStatus {
  /** Does the member have the Water Sharer badge? */
  hasBadge: boolean;
  /** Can the member share their badge? (has badge AND hasn't shared yet) */
  canShare: boolean;
  /** If they've shared, who did they share with? */
  sharedWith: {
    memberId: string;
    nym: string;
    grantedAt: Date;
  } | null;
  /** If they received the badge via sharing, who from? */
  receivedFrom: {
    memberId: string;
    nym: string;
    grantedAt: Date;
  } | null;
}

/**
 * @deprecated Use WaterSharerGrant instead - kept for backwards compatibility
 * Sponsor invite record (legacy - not used in v3.0.1)
 */
export interface SponsorInvite {
  /** Auto-incrementing ID */
  id: number;
  /** Sponsor member ID (must have Water Sharer badge) */
  sponsorMemberId: string;
  /** Invitee Discord user ID */
  inviteeDiscordUserId: string;
  /** Sponsor's tier at time of invite (invitee inherits this) */
  sponsorTierAtInvite: Tier;
  /** Invite status */
  status: 'pending' | 'accepted' | 'expired' | 'revoked';
  /** When invite was created */
  createdAt: Date;
  /** When invite was accepted (null if not accepted) */
  acceptedAt: Date | null;
  /** Member ID created after acceptance (null if not accepted) */
  inviteeMemberId: string | null;
  /** Admin who revoked (if status = 'revoked') */
  revokedBy: string | null;
  /** Reason for revocation */
  revokeReason: string | null;
  /** When revoked */
  revokedAt: Date | null;
}

/**
 * Story fragment for elite member joins
 */
export interface StoryFragment {
  /** Auto-incrementing ID */
  id: number;
  /** Fragment category (determines when it's used) */
  category: 'fedaykin_join' | 'naib_join';
  /** The narrative text (Markdown supported) */
  fragmentText: string;
  /** How many times this fragment has been used */
  usageCount: number;
  /** When fragment was added */
  createdAt: Date;
  /** When fragment was last used */
  lastUsedAt: Date | null;
}

/**
 * Weekly digest record
 */
export interface WeeklyDigest {
  /** Auto-incrementing ID */
  id: number;
  /** Week identifier (ISO 8601 week: YYYY-Wnn) */
  weekIdentifier: string;
  /** Total members at time of digest */
  totalMembers: number;
  /** New members this week */
  newMembers: number;
  /** Total BGT represented (wei as string) */
  totalBgt: string;
  /** Tier distribution (JSON parsed) */
  tierDistribution: Record<Tier, number>;
  /** Most active tier this week */
  mostActiveTier: Tier | null;
  /** Total promotions this week */
  promotionsCount: number;
  /** Notable promotions (JSON parsed array) */
  notablePromotions: Array<{
    memberNym: string;
    oldTier: Tier;
    newTier: Tier;
    timestamp: Date;
  }> | null;
  /** Badges awarded this week */
  badgesAwarded: number;
  /** Top new member by BGT (nym) */
  topNewMemberNym: string | null;
  /** Discord message ID of posted digest */
  messageId: string | null;
  /** Discord channel ID where posted */
  channelId: string | null;
  /** When digest was generated */
  generatedAt: Date;
  /** When digest was posted to Discord */
  postedAt: Date | null;
}

/**
 * Tier progress information for a member
 * Shows current tier, next tier, and progress toward it
 */
export interface TierProgress {
  /** Member's current tier */
  currentTier: Tier;
  /** Next tier in progression (null if at Naib) */
  nextTier: Tier | null;
  /** BGT needed to reach next tier (null if rank-based or at max) */
  bgtToNextTier: string | null;
  /** Human-readable BGT needed */
  bgtToNextTierFormatted: number | null;
  /** Current BGT holdings (wei as string) */
  currentBgt: string;
  /** Human-readable current BGT */
  currentBgtFormatted: number;
  /** Current eligibility rank */
  currentRank: number | null;
  /** Whether current tier is rank-based (Fedaykin/Naib) */
  isRankBased: boolean;
}

/**
 * Personal stats for /stats command
 * Combines profile, activity, badges, and tier information
 */
export interface PersonalStats {
  /** Member nym */
  nym: string;
  /** Member ID */
  memberId: string;
  /** Current tier */
  tier: Tier;
  /** Tier progress */
  tierProgress: TierProgress;
  /** Member since */
  memberSince: Date;
  /** Tenure category */
  tenureCategory: 'og' | 'veteran' | 'elder' | 'member';
  /** Messages this week */
  messagesThisWeek: number;
  /** Current activity streak (days) */
  currentStreak: number;
  /** Longest activity streak (days) */
  longestStreak: number;
  /** Total badges earned */
  badgeCount: number;
  /** Badge list */
  badges: PublicBadge[];
}

/**
 * Admin analytics data
 * Full community health metrics for admin dashboard
 */
export interface AdminAnalytics {
  /** Total members across all tiers */
  totalMembers: number;
  /** Members by tier */
  membersByTier: Record<Tier, number>;
  /** Total BGT represented (human-readable) */
  totalBgt: number;
  /** Total BGT represented (wei as string) */
  totalBgtWei: string;
  /** Weekly active members (active in last 7 days) */
  weeklyActive: number;
  /** New members this week */
  newThisWeek: number;
  /** Promotions this week */
  promotionsThisWeek: number;
  /** Badges awarded this week */
  badgesAwardedThisWeek: number;
  /** Average messages per member this week */
  avgMessagesPerMember: number;
  /** Tier with highest activity */
  mostActiveTier: Tier | null;
  /** Generated at timestamp */
  generatedAt: Date;
}

/**
 * Tier distribution data
 * Count of members in each tier for analytics
 */
export interface TierDistribution {
  hajra: number;
  ichwan: number;
  qanat: number;
  sihaya: number;
  mushtamal: number;
  sayyadina: number;
  usul: number;
  fedaykin: number;
  naib: number;
}

/**
 * API response for GET /api/tiers
 */
export interface TiersResponse {
  /** All tier definitions with thresholds */
  tiers: Array<{
    name: Tier;
    bgt_threshold: number | null; // null for rank-based tiers
    rank_requirement: string | null; // "Top 7" or "Top 8-69" for rank-based
    description: string;
  }>;
}

/**
 * API response for GET /api/stats/community
 */
export interface CommunityStatsResponse {
  /** Total members */
  total_members: number;
  /** Members by tier */
  members_by_tier: Record<Tier, number>;
  /** Total BGT represented */
  total_bgt: number;
  /** Weekly active members */
  weekly_active: number;
  /** When data was generated */
  generated_at: string;
}

/**
 * API response for GET /api/me/stats
 */
export interface MemberStatsResponse {
  /** Member nym */
  nym: string;
  /** Current tier */
  tier: Tier;
  /** Tier progress */
  tier_progress: {
    current_tier: Tier;
    next_tier: Tier | null;
    bgt_to_next_tier: number | null;
    current_bgt: number;
    current_rank: number | null;
    is_rank_based: boolean;
  };
  /** Member since */
  member_since: string;
  /** Tenure category */
  tenure_category: 'og' | 'veteran' | 'elder' | 'member';
  /** Activity stats */
  activity: {
    messages_this_week: number;
    current_streak: number;
    longest_streak: number;
  };
  /** Badge count */
  badge_count: number;
}

/**
 * API response for GET /api/me/tier-progress
 */
export interface TierProgressResponse {
  /** Current tier */
  current_tier: Tier;
  /** Next tier */
  next_tier: Tier | null;
  /** BGT needed to reach next tier */
  bgt_to_next_tier: number | null;
  /** Current BGT holdings */
  current_bgt: number;
  /** Current eligibility rank */
  current_rank: number | null;
  /** Whether current tier is rank-based */
  is_rank_based: boolean;
}

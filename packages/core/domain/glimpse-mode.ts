/**
 * Glimpse Mode Domain Types
 *
 * Sprint S-27: Glimpse Mode & Migration Readiness
 *
 * Defines types for the Glimpse Mode feature which shows features exist
 * without full access, driving migration interest.
 *
 * @see SDD §7.2.3 Glimpse Mode
 */

// =============================================================================
// Glimpse Mode Configuration
// =============================================================================

/**
 * Glimpse mode visibility levels.
 */
export type GlimpseVisibility =
  | 'hidden'       // Completely hidden
  | 'blurred'      // Visible but blurred/obscured
  | 'locked'       // Visible with lock icon
  | 'preview'      // Partial preview available
  | 'full';        // Full access (no glimpse mode)

/**
 * Glimpse mode configuration for a community.
 */
export interface GlimpseModeConfig {
  /** Community ID */
  communityId: string;
  /** Guild ID */
  guildId: string;
  /** Whether glimpse mode is enabled */
  enabled: boolean;
  /** Leaderboard visibility */
  leaderboardVisibility: GlimpseVisibility;
  /** Profile directory visibility */
  profileDirectoryVisibility: GlimpseVisibility;
  /** Badge showcase visibility */
  badgeShowcaseVisibility: GlimpseVisibility;
  /** Whether to show unlock CTAs */
  showUnlockCTA: boolean;
  /** Custom unlock message */
  customUnlockMessage?: string;
}

/**
 * Default glimpse mode configuration.
 */
export const DEFAULT_GLIMPSE_MODE_CONFIG: Omit<GlimpseModeConfig, 'communityId' | 'guildId'> = {
  enabled: true,
  leaderboardVisibility: 'preview',
  profileDirectoryVisibility: 'blurred',
  badgeShowcaseVisibility: 'locked',
  showUnlockCTA: true,
};

// =============================================================================
// Leaderboard Glimpse
// =============================================================================

/**
 * Leaderboard entry in glimpse mode.
 *
 * Shows position but hides competitor details.
 */
export interface GlimpseLeaderboardEntry {
  /** Rank position */
  rank: number;
  /** Whether this is the viewing user */
  isViewer: boolean;
  /** Display name (hidden if not viewer in glimpse mode) */
  displayName: string | null;
  /** Score (hidden if not viewer in glimpse mode) */
  score: number | null;
  /** Tier (hidden if not viewer in glimpse mode) */
  tier: string | null;
  /** Whether details are hidden due to glimpse mode */
  isGlimpsed: boolean;
}

/**
 * Glimpse leaderboard response.
 */
export interface GlimpseLeaderboard {
  /** Community ID */
  communityId: string;
  /** Guild ID */
  guildId: string;
  /** Leaderboard entries */
  entries: GlimpseLeaderboardEntry[];
  /** Viewer's entry (always shown) */
  viewerEntry: GlimpseLeaderboardEntry | null;
  /** Total members on leaderboard */
  totalMembers: number;
  /** Whether glimpse mode is active */
  isGlimpseMode: boolean;
  /** Unlock message if in glimpse mode */
  unlockMessage?: string;
}

// =============================================================================
// Profile Directory Glimpse
// =============================================================================

/**
 * Profile card in glimpse mode.
 *
 * Shows profile exists but blurs details.
 */
export interface GlimpseProfileCard {
  /** User ID */
  userId: string;
  /** Whether this is the viewing user */
  isViewer: boolean;
  /** Display name (blurred if not viewer) */
  displayName: string | null;
  /** Avatar URL (blurred if not viewer) */
  avatarUrl: string | null;
  /** Tier name (blurred if not viewer) */
  tierName: string | null;
  /** Conviction score (blurred if not viewer) */
  convictionScore: number | null;
  /** Badge count (shown) */
  badgeCount: number;
  /** Whether profile is blurred due to glimpse mode */
  isBlurred: boolean;
}

/**
 * Glimpse profile directory response.
 */
export interface GlimpseProfileDirectory {
  /** Community ID */
  communityId: string;
  /** Guild ID */
  guildId: string;
  /** Profile cards */
  profiles: GlimpseProfileCard[];
  /** Viewer's profile (always shown in full) */
  viewerProfile: GlimpseProfileCard | null;
  /** Total profiles in directory */
  totalProfiles: number;
  /** Whether glimpse mode is active */
  isGlimpseMode: boolean;
  /** Unlock message if in glimpse mode */
  unlockMessage?: string;
}

// =============================================================================
// Badge Showcase Glimpse
// =============================================================================

/**
 * Badge in glimpse mode.
 *
 * Shows badge exists but locked.
 */
export interface GlimpseBadge {
  /** Badge ID */
  badgeId: string;
  /** Badge name */
  name: string;
  /** Badge description */
  description: string;
  /** Badge icon URL */
  iconUrl: string | null;
  /** Whether badge is locked due to glimpse mode */
  isLocked: boolean;
  /** Whether viewer has earned this badge */
  viewerEarned: boolean;
  /** Total holders (shown) */
  totalHolders: number;
  /** Rarity tier */
  rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
}

/**
 * Glimpse badge showcase response.
 */
export interface GlimpseBadgeShowcase {
  /** Community ID */
  communityId: string;
  /** Guild ID */
  guildId: string;
  /** Badge list */
  badges: GlimpseBadge[];
  /** Viewer's earned badges (always shown in full) */
  viewerBadges: GlimpseBadge[];
  /** Total badges available */
  totalBadges: number;
  /** Whether glimpse mode is active */
  isGlimpseMode: boolean;
  /** Unlock message if in glimpse mode */
  unlockMessage?: string;
}

// =============================================================================
// Preview Profile
// =============================================================================

/**
 * Full preview profile for the viewing user.
 *
 * Always shows complete stats regardless of community tier.
 */
export interface PreviewProfile {
  /** User ID */
  userId: string;
  /** Display name */
  displayName: string;
  /** Avatar URL */
  avatarUrl: string | null;
  /** Current tier */
  tier: {
    name: string;
    rank: number;
    color: string;
    icon: string | null;
  };
  /** Conviction score */
  convictionScore: number;
  /** Position on leaderboard */
  leaderboardPosition: number;
  /** Total members */
  totalMembers: number;
  /** Percentile (e.g., "top 5%") */
  percentile: number;
  /** Earned badges */
  earnedBadges: {
    id: string;
    name: string;
    iconUrl: string | null;
    earnedAt: Date;
  }[];
  /** Total badges available */
  totalBadgesAvailable: number;
  /** Member since */
  memberSince: Date;
  /** Days as member */
  daysAsMember: number;
  /** Wallet addresses (if verified) */
  walletAddresses: string[];
  /** NFT holdings summary */
  nftHoldings: {
    collection: string;
    count: number;
  }[];
  /** Token holdings summary */
  tokenHoldings: {
    token: string;
    balance: string;
    usdValue: number | null;
  }[];
}

// =============================================================================
// Unlock Messaging
// =============================================================================

/**
 * Unlock message types.
 */
export type UnlockMessageType =
  | 'migration_cta'
  | 'admin_action_required'
  | 'readiness_check'
  | 'custom';

/**
 * Unlock message for glimpse mode features.
 */
export interface UnlockMessage {
  /** Message type */
  type: UnlockMessageType;
  /** Primary message */
  message: string;
  /** Secondary description */
  description?: string;
  /** Call-to-action text */
  ctaText?: string;
  /** Call-to-action URL */
  ctaUrl?: string;
  /** Whether to show to admins only */
  adminOnly: boolean;
}

/**
 * Default unlock messages.
 */
export const DEFAULT_UNLOCK_MESSAGES: Record<UnlockMessageType, UnlockMessage> = {
  migration_cta: {
    type: 'migration_cta',
    message: 'Full profiles unlock when your community migrates',
    description: 'Your community admin can enable full Arrakis features anytime.',
    ctaText: 'Learn More',
    adminOnly: false,
  },
  admin_action_required: {
    type: 'admin_action_required',
    message: 'Admin action required to unlock',
    description: 'Contact your community admin to enable full Arrakis features.',
    adminOnly: false,
  },
  readiness_check: {
    type: 'readiness_check',
    message: 'Readiness requirements not met',
    description: 'Your community needs more time in shadow mode before unlocking.',
    adminOnly: true,
  },
  custom: {
    type: 'custom',
    message: 'Features locked',
    adminOnly: false,
  },
};

// =============================================================================
// Migration Readiness
// =============================================================================

/**
 * Migration readiness check result.
 */
export interface MigrationReadinessCheck {
  /** Check name */
  name: string;
  /** Check description */
  description: string;
  /** Whether check passed */
  passed: boolean;
  /** Current value */
  current: number | string;
  /** Required value */
  required: number | string;
  /** Severity if not passed */
  severity: 'blocker' | 'warning' | 'info';
}

/**
 * Migration readiness requirements.
 */
export interface MigrationReadinessRequirements {
  /** Minimum days in shadow mode */
  minShadowDays: number;
  /** Minimum shadow accuracy (0-1) */
  minAccuracy: number;
  /** Whether incumbent must be healthy (optional) */
  requireHealthyIncumbent?: boolean;
  /** Maximum acceptable divergence rate (0-1) */
  maxDivergenceRate?: number;
}

/**
 * Default migration readiness requirements.
 */
export const DEFAULT_MIGRATION_READINESS_REQUIREMENTS: MigrationReadinessRequirements = {
  minShadowDays: 14,
  minAccuracy: 0.95,
  requireHealthyIncumbent: false,
  maxDivergenceRate: 0.05,
};

/**
 * Migration readiness result.
 */
export interface MigrationReadinessResult {
  /** Community ID */
  communityId: string;
  /** Guild ID */
  guildId: string;
  /** Whether community is ready for migration */
  ready: boolean;
  /** Individual checks */
  checks: MigrationReadinessCheck[];
  /** Blockers preventing migration */
  blockers: string[];
  /** Warnings (not blocking) */
  warnings: string[];
  /** Estimated days until ready (if not ready) */
  estimatedDaysUntilReady: number | null;
  /** Recommended migration strategy */
  recommendedStrategy: 'instant' | 'gradual' | 'parallel_forever' | null;
}

// =============================================================================
// Glimpse Mode Status
// =============================================================================

/**
 * Glimpse mode status for a community.
 */
export interface GlimpseModeStatus {
  /** Community ID */
  communityId: string;
  /** Guild ID */
  guildId: string;
  /** Whether glimpse mode is active */
  active: boolean;
  /** Current verification tier */
  verificationTier: 'incumbent_only' | 'arrakis_basic' | 'arrakis_full';
  /** Migration readiness */
  migrationReadiness: MigrationReadinessResult;
  /** Available features in current tier */
  availableFeatures: string[];
  /** Locked features (requiring migration) */
  lockedFeatures: string[];
  /** Last updated */
  updatedAt: Date;
}

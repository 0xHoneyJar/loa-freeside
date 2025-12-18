import { randomUUID } from 'crypto';
import { logger } from '../utils/logger.js';
import {
  createMemberProfile,
  getMemberProfileById,
  getMemberProfileByDiscordId,
  getMemberProfileByNym,
  updateMemberProfile,
  deleteMemberProfile,
  isNymAvailable,
  getPublicProfile,
  getMemberDirectory,
  searchMembersByNym,
  getMemberCount,
  getMemberCountByTier,
  getWalletByDiscordId,
  getEligibilityByAddress,
  logAuditEvent,
} from '../db/index.js';
import type {
  MemberProfile,
  PublicProfile,
  ProfileUpdateRequest,
  DirectoryFilters,
  DirectoryResult,
} from '../types/index.js';

/**
 * Nym validation rules:
 * - 3-20 characters
 * - Alphanumeric, underscore, hyphen only
 * - Cannot start or end with underscore/hyphen
 * - Case-insensitive uniqueness
 */
const NYM_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,18}[a-zA-Z0-9]$/;
const NYM_MIN_LENGTH = 3;
const NYM_MAX_LENGTH = 20;

/**
 * Blocked nym patterns (reserved words)
 */
const BLOCKED_NYMS = new Set([
  'admin',
  'administrator',
  'mod',
  'moderator',
  'system',
  'sietch',
  'naib',
  'fedaykin',
  'fremen',
  'muaddib',
  'bot',
  'official',
  'support',
  'help',
  'staff',
]);

/**
 * Bio validation rules
 */
const BIO_MAX_LENGTH = 160;
const URL_REGEX = /https?:\/\/[^\s]+/gi;

/**
 * Nym change cooldown period (30 days in ms)
 */
const NYM_CHANGE_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Profile Service
 *
 * Manages member profiles with privacy separation, nym validation,
 * and tier-based access control.
 */
class ProfileService {
  /**
   * Validate a nym against rules
   */
  validateNym(nym: string): { valid: boolean; error?: string } {
    // Length check
    if (nym.length < NYM_MIN_LENGTH) {
      return { valid: false, error: `Nym must be at least ${NYM_MIN_LENGTH} characters` };
    }
    if (nym.length > NYM_MAX_LENGTH) {
      return { valid: false, error: `Nym must be at most ${NYM_MAX_LENGTH} characters` };
    }

    // Pattern check
    if (!NYM_REGEX.test(nym)) {
      return {
        valid: false,
        error: 'Nym must be alphanumeric (can include _ or -) and cannot start/end with _ or -',
      };
    }

    // Blocked words check (case-insensitive)
    if (BLOCKED_NYMS.has(nym.toLowerCase())) {
      return { valid: false, error: 'This nym is reserved and cannot be used' };
    }

    return { valid: true };
  }

  /**
   * Sanitize bio content (strip URLs for privacy)
   */
  sanitizeBio(bio: string | null | undefined): string | null {
    if (!bio) return null;

    // Trim and truncate
    let sanitized = bio.trim().slice(0, BIO_MAX_LENGTH);

    // Strip URLs
    sanitized = sanitized.replace(URL_REGEX, '[link removed]');

    return sanitized || null;
  }

  /**
   * Check if a Discord user can create a profile
   * (must have verified wallet and be eligible)
   */
  async canCreateProfile(discordUserId: string): Promise<{
    canCreate: boolean;
    reason?: string;
    tier?: 'naib' | 'fedaykin';
  }> {
    // Check if already has profile
    const existingProfile = getMemberProfileByDiscordId(discordUserId);
    if (existingProfile) {
      return { canCreate: false, reason: 'You already have a profile' };
    }

    // Check for verified wallet
    const walletAddress = getWalletByDiscordId(discordUserId);
    if (!walletAddress) {
      return { canCreate: false, reason: 'No verified wallet found. Please verify your wallet first.' };
    }

    // Check eligibility
    const eligibility = getEligibilityByAddress(walletAddress);
    if (!eligibility || eligibility.rank === undefined || eligibility.rank > 69) {
      return {
        canCreate: false,
        reason: 'Your wallet is not in the top 69 eligible. You need to claim and hold BGT.',
      };
    }

    // Determine tier
    const tier = eligibility.role === 'naib' ? 'naib' : 'fedaykin';

    return { canCreate: true, tier };
  }

  /**
   * Create a new member profile
   */
  async createProfile(
    discordUserId: string,
    nym: string,
    options: { bio?: string; pfpUrl?: string; pfpType?: 'custom' | 'generated' | 'none' } = {}
  ): Promise<{ profile?: MemberProfile; error?: string }> {
    // Check eligibility
    const eligibilityCheck = await this.canCreateProfile(discordUserId);
    if (!eligibilityCheck.canCreate) {
      return { error: eligibilityCheck.reason };
    }

    // Validate nym
    const nymValidation = this.validateNym(nym);
    if (!nymValidation.valid) {
      return { error: nymValidation.error };
    }

    // Check nym availability
    if (!isNymAvailable(nym)) {
      return { error: 'This nym is already taken. Please choose another.' };
    }

    // Sanitize bio
    const sanitizedBio = this.sanitizeBio(options.bio);

    // Generate member ID
    const memberId = randomUUID();

    try {
      const profile = createMemberProfile({
        memberId,
        discordUserId,
        nym,
        tier: eligibilityCheck.tier!,
        bio: sanitizedBio,
        pfpUrl: options.pfpUrl ?? null,
        pfpType: options.pfpType ?? 'none',
      });

      logAuditEvent('member_added', {
        memberId,
        discordUserId,
        nym,
        tier: eligibilityCheck.tier,
        source: 'profile_creation',
      });

      logger.info({ memberId, nym, tier: eligibilityCheck.tier }, 'Created member profile');

      return { profile };
    } catch (error) {
      logger.error({ error, discordUserId, nym }, 'Failed to create member profile');
      return { error: 'Failed to create profile. Please try again.' };
    }
  }

  /**
   * Get member profile by ID (internal use - includes private data)
   */
  getProfileById(memberId: string): MemberProfile | null {
    return getMemberProfileById(memberId);
  }

  /**
   * Get member profile by Discord ID (internal use - includes private data)
   */
  getProfileByDiscordId(discordUserId: string): MemberProfile | null {
    return getMemberProfileByDiscordId(discordUserId);
  }

  /**
   * Get member profile by nym (internal use - includes private data)
   */
  getProfileByNym(nym: string): MemberProfile | null {
    return getMemberProfileByNym(nym);
  }

  /**
   * Get public profile (safe for API responses - no private data)
   */
  getPublicProfile(memberId: string): PublicProfile | null {
    return getPublicProfile(memberId);
  }

  /**
   * Check if user can change their nym (30-day cooldown)
   */
  canChangeNym(profile: MemberProfile): { canChange: boolean; cooldownEnds?: Date } {
    if (!profile.nymLastChanged) {
      return { canChange: true };
    }

    const cooldownEnds = new Date(profile.nymLastChanged.getTime() + NYM_CHANGE_COOLDOWN_MS);
    const now = new Date();

    if (now >= cooldownEnds) {
      return { canChange: true };
    }

    return { canChange: false, cooldownEnds };
  }

  /**
   * Update member profile
   */
  async updateProfile(
    memberId: string,
    updates: ProfileUpdateRequest,
    requesterId: string
  ): Promise<{ profile?: MemberProfile; error?: string }> {
    const existingProfile = getMemberProfileById(memberId);
    if (!existingProfile) {
      return { error: 'Profile not found' };
    }

    // Verify requester is the profile owner
    if (existingProfile.discordUserId !== requesterId) {
      return { error: 'You can only update your own profile' };
    }

    // Validate nym if changing
    if (updates.nym !== undefined && updates.nym !== existingProfile.nym) {
      // Check cooldown
      const cooldownCheck = this.canChangeNym(existingProfile);
      if (!cooldownCheck.canChange) {
        const daysRemaining = Math.ceil(
          (cooldownCheck.cooldownEnds!.getTime() - Date.now()) / (24 * 60 * 60 * 1000)
        );
        return { error: `You can change your nym in ${daysRemaining} days` };
      }

      // Validate new nym
      const nymValidation = this.validateNym(updates.nym);
      if (!nymValidation.valid) {
        return { error: nymValidation.error };
      }

      // Check availability
      if (!isNymAvailable(updates.nym, memberId)) {
        return { error: 'This nym is already taken' };
      }
    }

    // Sanitize bio if provided
    if (updates.bio !== undefined) {
      updates.bio = this.sanitizeBio(updates.bio);
    }

    try {
      const profile = updateMemberProfile(memberId, updates);
      if (!profile) {
        return { error: 'Failed to update profile' };
      }

      logger.info({ memberId, updates: Object.keys(updates) }, 'Updated member profile');

      return { profile };
    } catch (error) {
      logger.error({ error, memberId }, 'Failed to update member profile');
      return { error: 'Failed to update profile. Please try again.' };
    }
  }

  /**
   * Update member tier (called by eligibility sync)
   */
  updateMemberTier(memberId: string, newTier: 'naib' | 'fedaykin'): boolean {
    const profile = getMemberProfileById(memberId);
    if (!profile) return false;

    if (profile.tier === newTier) return true;

    const updated = updateMemberProfile(memberId, { tier: newTier });
    if (updated) {
      logAuditEvent(newTier === 'naib' ? 'naib_promotion' : 'naib_demotion', {
        memberId,
        previousTier: profile.tier,
        newTier,
        source: 'eligibility_sync',
      });
      logger.info({ memberId, previousTier: profile.tier, newTier }, 'Updated member tier');
    }

    return !!updated;
  }

  /**
   * Complete onboarding
   */
  completeOnboarding(memberId: string): boolean {
    const updated = updateMemberProfile(memberId, {
      onboardingComplete: true,
      onboardingStep: 3, // Final step
    });
    return !!updated;
  }

  /**
   * Update onboarding step
   */
  updateOnboardingStep(memberId: string, step: number): boolean {
    const updated = updateMemberProfile(memberId, { onboardingStep: step });
    return !!updated;
  }

  /**
   * Delete member profile (for when eligibility is lost)
   */
  deleteProfile(memberId: string): boolean {
    const profile = getMemberProfileById(memberId);
    if (!profile) return false;

    const deleted = deleteMemberProfile(memberId);
    if (deleted) {
      logAuditEvent('member_removed', {
        memberId,
        nym: profile.nym,
        source: 'profile_deletion',
      });
    }

    return deleted;
  }

  /**
   * Get member directory with filters
   */
  getDirectory(filters: DirectoryFilters = {}): DirectoryResult {
    return getMemberDirectory(filters);
  }

  /**
   * Search members by nym
   */
  searchByNym(query: string, limit: number = 10): PublicProfile[] {
    return searchMembersByNym(query, limit);
  }

  /**
   * Get member statistics
   */
  getStats(): { total: number; naib: number; fedaykin: number } {
    const total = getMemberCount();
    const byTier = getMemberCountByTier();
    return {
      total,
      naib: byTier.naib,
      fedaykin: byTier.fedaykin,
    };
  }

  /**
   * Sync member profiles with current eligibility
   * Called after eligibility updates to:
   * - Update tiers for existing members
   * - Mark profiles for removal if no longer eligible
   */
  async syncWithEligibility(): Promise<{
    updated: number;
    markedForRemoval: string[];
  }> {
    const directory = getMemberDirectory({ pageSize: 1000 });
    let updated = 0;
    const markedForRemoval: string[] = [];

    for (const member of directory.members) {
      const profile = getMemberProfileById(member.memberId);
      if (!profile) continue;

      // Get current wallet and eligibility
      const wallet = getWalletByDiscordId(profile.discordUserId);
      if (!wallet) {
        markedForRemoval.push(member.memberId);
        continue;
      }

      const eligibility = getEligibilityByAddress(wallet);
      if (!eligibility || eligibility.rank === undefined || eligibility.rank > 69) {
        markedForRemoval.push(member.memberId);
        continue;
      }

      // Update tier if changed
      const newTier = eligibility.role === 'naib' ? 'naib' : 'fedaykin';
      if (profile.tier !== newTier) {
        this.updateMemberTier(member.memberId, newTier);
        updated++;
      }
    }

    if (markedForRemoval.length > 0) {
      logger.warn(
        { count: markedForRemoval.length },
        'Members marked for removal due to eligibility loss'
      );
    }

    return { updated, markedForRemoval };
  }
}

/**
 * Singleton profile service instance
 */
export const profileService = new ProfileService();

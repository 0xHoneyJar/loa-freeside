/**
 * Test Fixtures for Sietch Theme
 *
 * Centralized test data for tier, eligibility, and role testing.
 * Sprint 10 (Global ID 173): Comprehensive Tier Testing Suite
 */

import { parseUnits } from 'viem';
import type { Tier, EligibilityEntry, MemberProfile } from '../types/index.js';

// =============================================================================
// BGT Threshold Fixtures (in wei)
// =============================================================================

/**
 * BGT thresholds for each tier in wei (18 decimals)
 */
export const BGT_THRESHOLDS = {
  hajra: parseUnits('6.9', 18),
  ichwan: parseUnits('69', 18),
  qanat: parseUnits('222', 18),
  sihaya: parseUnits('420', 18),
  mushtamal: parseUnits('690', 18),
  sayyadina: parseUnits('888', 18),
  usul: parseUnits('1111', 18),
} as const;

/**
 * Boundary test values - just below and just above each threshold
 */
export const BGT_BOUNDARIES = {
  hajra: {
    below: parseUnits('6.8999', 18),
    exact: parseUnits('6.9', 18),
    above: parseUnits('6.9001', 18),
  },
  ichwan: {
    below: parseUnits('68.9999', 18),
    exact: parseUnits('69', 18),
    above: parseUnits('69.0001', 18),
  },
  qanat: {
    below: parseUnits('221.9999', 18),
    exact: parseUnits('222', 18),
    above: parseUnits('222.0001', 18),
  },
  sihaya: {
    below: parseUnits('419.9999', 18),
    exact: parseUnits('420', 18),
    above: parseUnits('420.0001', 18),
  },
  mushtamal: {
    below: parseUnits('689.9999', 18),
    exact: parseUnits('690', 18),
    above: parseUnits('690.0001', 18),
  },
  sayyadina: {
    below: parseUnits('887.9999', 18),
    exact: parseUnits('888', 18),
    above: parseUnits('888.0001', 18),
  },
  usul: {
    below: parseUnits('1110.9999', 18),
    exact: parseUnits('1111', 18),
    above: parseUnits('1111.0001', 18),
  },
} as const;

// =============================================================================
// Tier Transition Test Cases
// =============================================================================

/**
 * Common tier transition scenarios for testing
 */
export const TIER_TRANSITIONS = {
  // Promotions
  hajraToIchwan: { from: 'hajra' as Tier, to: 'ichwan' as Tier, isPromotion: true },
  ichwanToQanat: { from: 'ichwan' as Tier, to: 'qanat' as Tier, isPromotion: true },
  qanatToSihaya: { from: 'qanat' as Tier, to: 'sihaya' as Tier, isPromotion: true },
  sihayaToMushtamal: { from: 'sihaya' as Tier, to: 'mushtamal' as Tier, isPromotion: true },
  mushtamalToSayyadina: { from: 'mushtamal' as Tier, to: 'sayyadina' as Tier, isPromotion: true },
  sayyadinaToUsul: { from: 'sayyadina' as Tier, to: 'usul' as Tier, isPromotion: true },
  usulToFedaykin: { from: 'usul' as Tier, to: 'fedaykin' as Tier, isPromotion: true },
  fedaykinToNaib: { from: 'fedaykin' as Tier, to: 'naib' as Tier, isPromotion: true },

  // Demotions
  naibToFedaykin: { from: 'naib' as Tier, to: 'fedaykin' as Tier, isPromotion: false },
  fedaykinToUsul: { from: 'fedaykin' as Tier, to: 'usul' as Tier, isPromotion: false },
  usulToSayyadina: { from: 'usul' as Tier, to: 'sayyadina' as Tier, isPromotion: false },
  ichwanToHajra: { from: 'ichwan' as Tier, to: 'hajra' as Tier, isPromotion: false },

  // Skip tiers
  hajraToUsul: { from: 'hajra' as Tier, to: 'usul' as Tier, isPromotion: true },
  naibToHajra: { from: 'naib' as Tier, to: 'hajra' as Tier, isPromotion: false },
} as const;

// =============================================================================
// Member Profile Factories
// =============================================================================

let memberCounter = 0;

/**
 * Create a test member profile with sensible defaults
 */
export function createMemberProfile(overrides: Partial<MemberProfile> = {}): MemberProfile {
  memberCounter++;
  return {
    memberId: overrides.memberId ?? `member-${memberCounter}`,
    discordUserId: overrides.discordUserId ?? `discord-${memberCounter}`,
    discordUsername: overrides.discordUsername ?? `user${memberCounter}`,
    walletAddress: overrides.walletAddress ?? `0x${memberCounter.toString().padStart(40, '0')}`,
    nym: overrides.nym ?? null,
    pfpUrl: overrides.pfpUrl ?? null,
    bio: overrides.bio ?? null,
    tier: overrides.tier ?? 'hajra',
    tierUpdatedAt: overrides.tierUpdatedAt ?? Date.now(),
    onboardingComplete: overrides.onboardingComplete ?? true,
    onboardingStep: overrides.onboardingStep ?? 'complete',
    createdAt: overrides.createdAt ?? new Date(),
    updatedAt: overrides.updatedAt ?? new Date(),
    lastActive: overrides.lastActive ?? new Date(),
    ...overrides,
  } as MemberProfile;
}

/**
 * Create a member at a specific tier
 */
export function createMemberAtTier(tier: Tier, overrides: Partial<MemberProfile> = {}): MemberProfile {
  return createMemberProfile({ tier, ...overrides });
}

/**
 * Create a Naib member (rank 1-7)
 */
export function createNaibMember(rank: number = 1, overrides: Partial<MemberProfile> = {}): MemberProfile {
  if (rank < 1 || rank > 7) {
    throw new Error('Naib rank must be 1-7');
  }
  return createMemberProfile({ tier: 'naib', ...overrides });
}

/**
 * Create a Fedaykin member (rank 8-69)
 */
export function createFedaykinMember(rank: number = 30, overrides: Partial<MemberProfile> = {}): MemberProfile {
  if (rank < 8 || rank > 69) {
    throw new Error('Fedaykin rank must be 8-69');
  }
  return createMemberProfile({ tier: 'fedaykin', ...overrides });
}

// =============================================================================
// Eligibility Entry Factories
// =============================================================================

/**
 * Create a test eligibility entry
 */
export function createEligibilityEntry(
  address: string,
  bgtHeld: bigint,
  rank?: number
): EligibilityEntry {
  let role: 'naib' | 'fedaykin' | 'none' = 'none';
  if (rank !== undefined) {
    if (rank <= 7) role = 'naib';
    else if (rank <= 69) role = 'fedaykin';
  }

  return {
    address: address as `0x${string}`,
    bgtClaimed: bgtHeld,
    bgtBurned: 0n,
    bgtHeld,
    rank,
    role,
  };
}

/**
 * Create a full eligibility list (69 members)
 */
export function createFullEligibilityList(count: number = 69): EligibilityEntry[] {
  return Array.from({ length: count }, (_, i) => {
    const rank = i + 1;
    const bgt = parseUnits(String(1000 - i * 10), 18); // Decreasing BGT
    return createEligibilityEntry(
      `0x${(i + 1).toString().padStart(40, '0')}`,
      bgt,
      rank <= 69 ? rank : undefined
    );
  });
}

/**
 * Create Naib council (top 7)
 */
export function createNaibCouncil(): EligibilityEntry[] {
  return createFullEligibilityList(69).slice(0, 7);
}

/**
 * Create Fedaykin corps (rank 8-69)
 */
export function createFedaykinCorps(): EligibilityEntry[] {
  return createFullEligibilityList(69).slice(7, 69);
}

// =============================================================================
// Role ID Fixtures
// =============================================================================

/**
 * Mock Discord role IDs for testing
 */
export const MOCK_ROLE_IDS = {
  hajra: 'role-hajra-123',
  ichwan: 'role-ichwan-456',
  qanat: 'role-qanat-789',
  sihaya: 'role-sihaya-abc',
  mushtamal: 'role-mushtamal-def',
  sayyadina: 'role-sayyadina-ghi',
  usul: 'role-usul-jkl',
  fedaykin: 'role-fedaykin-mno',
  naib: 'role-naib-pqr',
  formerNaib: 'role-former-naib-stu',
  taqwa: 'role-taqwa-vwx',
  onboarded: 'role-onboarded-yz',
  engaged: 'role-engaged-111',
  veteran: 'role-veteran-222',
  trusted: 'role-trusted-333',
} as const;

/**
 * Mock channel IDs for testing
 */
export const MOCK_CHANNEL_IDS = {
  theDoor: 'channel-the-door',
  census: 'channel-census',
  naibChamber: 'channel-naib-chamber',
  caveEntrance: 'channel-cave-entrance',
} as const;

// =============================================================================
// Reset Helper
// =============================================================================

/**
 * Reset all counters (call in beforeEach)
 */
export function resetFixtures(): void {
  memberCounter = 0;
}
